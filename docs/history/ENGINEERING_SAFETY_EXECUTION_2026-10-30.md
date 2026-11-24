# 우선순위 실행과 예외 정합성 보강 · 2026-10-30

## 범위와 실행 순서

기존 [재평가](ENGINEERING_REASSESSMENT_2026-10-28.md)와 [상세 계획](../plans/ENGINEERING_FOLLOWUP_DETAIL_2026-10-27.md)을 이어서 진행했다. Architect는 캐시·페이지·삭제 경계를, Reviewer는 저장 예외와 새 계측 도구를, SRE는 이전 원자료와 캐시 계측을 독립 검토했다. 주 구현자는 재현된 제품 결함을 우선 수정하고 결과를 통합했다.

새 장애 재현이 나와 성능 작업보다 먼저 데이터 보존을 수정했다. 단순 조건·상태 준비·rollback은 기존 함수 안에 두었으며 제품 helper·worker·저장 포맷을 추가하지 않았다. 기존 미커밋 변경은 보존하고 시작 시 228개 소스·문서 fingerprint와 Git 상태를 기록했다.

## 재현 → 원인 → 수정

| 분류 | 발생 조건·실제 영향 | 근본 원인 | 수정·회귀 |
|---|---|---|---|
| Major / 전환 준비 실패 | 정상 JSON 안의 깊은 중첩이 read 이후 stringify에서 실패하면 메모리 활성 ID·설정은 대상, 디스크는 이전 대화로 남음 | 활성 상태 변경 후의 직렬화·해시가 rollback try 밖에 있었음 | 대상 read/직렬화/hash/저장 조건을 활성 변경 전에 준비. deep JSON·stringify·hash 오류 주입에서 상태·파일 보존 |
| Major / startup 후처리 실패 | 활성 본문 parse 뒤 stringify/hash 실패 시 state 백업 성공을 근거로 쓰기가 열리고 worker가 원본을 덮을 수 있음 | 쓰기 차단 범위가 readHistory 호출만 포함하고 snapshot 준비를 제외 | read와 snapshot 준비 전체 실패를 차단. sync/async save 거절·worker 실패·cli-deleted 저널 자동 정리 금지 |
| Major / v1 이관 실패 | 깊은 legacy JSON 또는 ENOSPC로 이관 저장 실패 후 빈 기본 상태로 후속 저장 가능 | 이관 실패를 일반 설정 복구와 같은 외부 catch로 처리 | v1 백업/저장 실패는 writeBlocked 유지. 원본 bytes·백업 보존·후속 worker 생성 금지 |
| Major / 같은 대화 다시 열기 | 현재 메시지/thread가 미저장 상태일 때 같은 ID를 열면 메모리는 옛 본문, 디스크는 새 본문. 다음 저장에서 옛 본문으로 퇴행 가능 | read(old) → save(dirty) → old 적용 순서 | 같은 ID만 현재 저장 후 재읽기. 다른 ID는 대상 준비 후 현재 저장 순서 유지. 다음 worker 저장·재시작까지 새 본문/thread 보존 |
| Major / 삭제 예산 | 삭제 중 시스템 시각이 뒤로 이동하면 30초를 넘겨도 destructive RPC 허용, 앞으로 이동하면 조기 실패 | 경과 시간을 Date.now로 계산 | 삭제 범위의 deadline/remaining 계산을 performance.now로 통일. 시각 전후 이동·연결/조회 후 소진·늦은 성공 ACK 정산 검사 |

전환 후처리와 같은 ID 문제는 이전 코드에서도 존재했다. 같은 ID의 dirty 본문은 main의 일반 작업 guard로 상당 부분 제한되지만 Store의 직접 호출 계약에서는 재현됐으며 이 구분을 유지한다. main의 모든 정상 사용자 흐름에서 발생했다고 확대하지 않는다.

저장 실패 5개 테스트 그룹은 같은 최종 회귀를 과거 candidate Store에 실행했을 때 5개 모두 실패했고, 수정 후 모두 통과했다. 실제 worker는 main보다 stack 여유가 커서 100,000단계·약 200KB의 유효 JSON으로 실패를 재현했다. 32MiB를 넘는 파일을 사용한 크기 제한 테스트가 아니다. [수정 전 로그](../../artifacts/engineering-2026-10-30/store-transition-before.log)와 [회귀 코드](../../test/store-transition-failure.test.cjs)를 보존한다.

삭제의 벽시계 역행 회귀도 수정 전 실패했다. [수정 전 로그](../../artifacts/engineering-2026-10-30/deletion-before.log). 원격 성공 이후 로컬 정산을 시간 초과로 취소하지 않으며, 파생 세션 확인 실패는 기존처럼 저널·기록을 보존한다. 연결 API의 공유 initialize까지 요청별 예산으로 끊는 기능은 추가하지 않았다. 전체 버튼 처리가 항상 30초 이내라는 주장은 하지 않는다. [삭제 계약](../DELETE_CONVERSATIONS.md)을 따른다.

## ENG04-M0b/T1: 성능 원인 분리

이전 비교의 30MiB read 표본 160개를 순서·CPU·heap/RSS·stage로 재분석했다. 느린 표본에서도 heap 증가는 약 60.13MiB로 비슷했다. 동일 소스 A/A after는 p95 52.56ms지만 최대 189.22ms, 그 표본의 process CPU는 62.55ms였다. p95 하나만으로 긴 지연이 사라졌다고 판단할 수 없다. process CPU는 여러 thread를 포함하므로 wall−CPU를 순수 대기 시간으로 해석하지 않는다.

기존 하네스는 측정 전에 두 30MiB 본문 문자열·두 기대값 객체·활성 Store를 함께 유지했고 source별 fork slot도 고정이었다. schema4는 준비 단계·GC 전후 메모리/시간, 기대값 생성 시점과 fork 순서를 분리 기록한다. `--expectations after`도 fixture 문자열은 유지하며 기대값 검증 자체를 생략하지 않는다.

실험 전 [가설·고정 4회·종료 기준](../../artifacts/engineering-2026-10-30/preregistration.json)을 보존했다. 같은 archived before bundle만 A/A로 사용하고 expectations before/after × fork normal/reversed, 30MiB long/read/off, 준비 3회·각 label 20표본으로 고정했다. 160개 측정 표본과 24개 준비 표본을 실행했고 정합성·source/tool/fixture hash·명시적 GC 사용을 확인했다. 추가 재실행은 0회다.

| 기대값 생성 / fork 순서 | label 1/2 중앙값 ms | label 1/2 p95 ms | label 1/2 최대 ms |
|---|---|---|---|
| 측정 전 / 정상 | 44.84 / 44.01 | 72.88 / 55.46 | 77.24 / 57.22 |
| 측정 후 / 반전 | 42.78 / 43.12 | 47.84 / 53.66 | 62.09 / 79.25 |
| 측정 후 / 정상 | 42.78 / 42.41 | 50.70 / 55.94 | 129.48 / 70.51 |
| 측정 전 / 반전 | 43.04 / 43.38 | 44.12 / 55.48 | 44.14 / 65.68 |

두 label은 **같은 소스**다. 네 조건 모두 사전 기준인 label 간 p95 편차 10%를 넘었다. 기대값 생성 시점을 뒤로 옮기면 GC 직후 heap 중앙값은 약 304.23→184.23MiB로 120MiB 줄었지만 긴 지연은 사라지지 않았다. 이는 하네스의 live 객체가 메모리 기준선에 영향을 준다는 확인이며 제품 메모리 개선률이 아니다. fork slot·자연 GC·스케줄링 중 어느 것이 tail 원인인지는 확정하지 못했다. [전체 집계와 가설 판정](../../artifacts/engineering-2026-10-30/read-tail-fixed-summary.json)에 순서·초반/후반·CPU·heap/RSS·GC 수치를 함께 보존한다.

**T1 고정 조사와 하네스 보강은 완료, read tail 원인 확정과 현재 제품의 전체 성능·배포 수용은 보류**한다. 이번 안전성 수정 소스는 이 과거 소스 A/A에 포함하지 않았으므로 이전 전환 개선율을 현재 후보에 재부여하지 않는다. 새 조사는 자연 GC/스케줄링 관측 또는 통제된 실행 환경이라는 별도 질문과 종료 조건이 있어야 하며, 같은 벤치를 성공할 때까지 반복하지 않는다.

## ENG05–08의 진행 범위

ENG05-M 도구는 기존 파일 수에 따른 prepare·최종 verify·staging read/hash/link/cleanup 비용을 구분한다. 실제 반환 metadata/저장 bytes/기존 파일 identity/예상 목록/lock 해제를 확인하고 정리 성공 뒤에만 결과를 쓴다. 제품의 verify → staging 검증 → publish 경계와 quota 안전 검사는 그대로 유지한다.

새 도구 리뷰에서 임시 root 정리 실패 뒤 성공 JSON이 남을 수 있는 문제를 발견해 출력 순서를 수정했다. 도구와 소스 hash 대조, 정상/쓰기 실패 시 probe 복원·lock 해제, 출력 덮어쓰기 방지와 cleanup 실패도 회귀 대상으로 추가했다. 이미지 validator는 source를 preview로 쓰는 fixture이므로 decode·축소 비용은 측정하지 않는다.

[고정 탐색 계획](../../artifacts/engineering-2026-10-30/cache-preregistration.json)에 따라 기존 파일 0/1,000/10,000개 × 신규 1/8개·중복 8개·혼합 순서 × on/off, 파일당 64KiB·각 1표본으로 총 24개를 실행했다. 모든 bytes/metadata/기존 파일 보존 검사를 통과했고 임시 root 정리를 확인했다. 추가 계측은 0회다.

| 기존 파일 수 / root | 신규 파일 8개의 sync stat 수 | 최종 verify 8회 합계 ms | import 전체 ms (동일 on 표본) |
|---|---|---|---|
| 0 | 150 | 1.43 | 14.94 |
| 1,000 | 9,157 | 47.91 | 73.27 |
| 10,000 | 90,228 | 359.08 | 438.09 |

중복 파일 8개는 세 규모 모두 quota prepare/verify·성공 쓰기 0, sync stat 16회였다. 이미 구현된 중복 재사용을 새 최적화로 계산하지 않는다. 전체 [24개 집계](../../artifacts/engineering-2026-10-30/cache-exploration-summary.json)와 on/off 원자료를 보존한다. 표본당 기존 파일을 사전 읽고 검증하므로 warm 조건이다. 각 조건 n=1이며 최대 지연·p95·개선율이나 worker 채택의 증거로 쓰지 않는다. verify 합계는 8번의 호출 합계로, 한 번에 359ms 동안 계속 멈췄다는 뜻이 아니다.

이 탐색은 소스의 O(N) 순회와 일치하는 stat 증가를 관찰했다. 실행 시간이 항상 같은 비율로 증가한다는 주장은 하지 않는다. 검사 생략·mtime 캐시·검사와 publish 사이 await 도입으로 줄이지 않는다. 후속은 대표 사용자 규모와 통제 조건을 정한 반복 측정, 그리고 전체 검증→publish를 옮길 경우 root 소유권/유지보수/실패 정산 비용의 비교다. 제품 캐시 구현은 변경하지 않았다.

ENG06-A는 현재 후보의 v2 snapshot 유지 결정을 [계획 내 ADR](../plans/ENGINEERING_FOLLOWUP_DETAIL_2026-10-27.md#eng06-bc-포맷을-선택했을-때만-진행할-작업)로 기록했다. 40페이지 쓰기 증폭은 남는다. 실제 페이지 사용 빈도/지연 기준이 없는 상태에서 자동 prefetch·새 포맷·DB 전환을 선택하지 않는다. cursor 확정·검색·내보내기·삭제·캐시 참조·역변환 영향표를 유지한다.

ENG07은 위 monotonic 예산 수정까지다. 관계 read RPC 감소는 CLI의 소유 조회/cascade 완결성이 확인되지 않아 구현하지 않았다. ENG08의 고정 enum·상한 진단 집계는 별도 구현 과제로 유지하며 완료로 올리지 않는다.

## 검증과 수용 상태

관련 저장 회귀 67개와 계측 schema4 회귀 12개는 Reviewer가 독립 재실행해 통과했다. 캐시 도구 회귀 7개도 SRE가 독립 실행했다.

| 최종 검사 | 실제 결과 |
|---|---|
| `npm run verify` | **332/332**, 실패·skip 0. [로그](../../artifacts/engineering-2026-10-30/final-verify.log) |
| `npm run build` | **RENDERER_BUNDLE_OK**. [로그](../../artifacts/engineering-2026-10-30/final-build.log) |
| 수정 전 실패 근거 | 저장 예외 5개 그룹과 삭제 벽시계 역행 회귀 실패를 별도 보존 |
| source 보존 | 시작 fingerprint와 현재 변경 목록 대조. 제품 변경은 Store와 main의 삭제 deadline 범위 |
| 고정 성능 조사 | 같은 소스 A/A 160표본·캐시 탐색 24표본의 실제 내용/소스/도구 검증. 전체 성능 수용 보류 |

이전 318개에 저장 예외 5개·삭제 1개·Store 계측 1개·캐시 계측 7개가 추가됐다. 제품·테스트의 마지막 변경 후 실행했으며 이후 문서와 ignored 원자료만 정리했다. 검증 성공은 현재 코드의 정확성 검사 결과이며 전체 성능/플랫폼 수용을 대신하지 않는다.

GUI·OS 입력·클립보드·선택기·알림·실제 모델·설치·배포는 실행하지 않는다. 실제 화면 수용은 [AGENTS.md](../../AGENTS.md)의 사용자 검증 시간 허용이 필요한 별도 작업이다. 새로운 오류 원인을 확인한 것과 제품 전체의 성능/배포 승인을 구분한다.

## 다음 작업의 경계

1. 현재 제품 소스를 고정한 성능 수용은 별도다. T1에서 보인 측정 변동과 자연 GC/스케줄링 관측을 분리할 조건을 먼저 정한다. 원인 미확정 상태로 통합 worker/boot 이전을 확정하지 않는다.
2. 캐시 최종 검증은 O(N) 비용과 안전 계약을 함께 비교한다. 반복 측정·root ownership·유지보수·ACK 유실 정산까지 준비되기 전 worker로 이전하지 않는다.
3. 페이지 쓰기는 v2 유지 ADR을 따른다. 실제 사용/지연 기준 또는 명시적 다중 페이지 UX가 생겼을 때 새 포맷/역변환을 다시 선택한다.
4. 삭제 연결 포함 예산·관계 RPC 감소, bounded 진단 집계는 미완료다. 현재 mono clock 수정이나 문서 설계를 그 구현 완료로 표시하지 않는다.
5. 최신 변경 묶음의 GUI·패키지 실행·설치·플랫폼·장시간 수용은 별도다. 새 worker/ASAR/사용자 프로필 이관을 실행한 결과는 없다.

현재 코드·테스트·CJS 후보 snapshot·원자료 hash와 문서 링크 검증은 [최종 기록](../../artifacts/engineering-2026-10-30/verification.json)에 둔다. rollback은 이번 두 제품 파일의 좁은 변경 단위만 검토해 되돌리는 방식이며, 다른 미커밋 변경이나 사용자 기록을 초기화하지 않는다. 저장 포맷 변경이 없어 데이터 역변환은 필요하지 않지만 되돌린 코드에는 위 재현된 결함이 다시 존재한다.
