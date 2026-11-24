# 7개 엔지니어링 기준 재평가와 첫 개선 · 2026-10-28

## 판단: 기준은 유지하고, 큰 구조 변경은 측정 이후 선택한다

사용자의 7개 항목은 이 제품에도 유효한 품질 기준이다. 다만 새 앱 구축·레거시 재설계·장애 대응·100배 확장을 매번 모두 구현하는 순차 작업으로 적용하면 범위가 과도해진다. 현재는 실행 가능한 Electron 로컬 앱과 v2 저장·복구·권한 계약이 있다. 그 위에서 **현재 계약 확인 → 재현/측정 → 가장 작은 변경 → 독립 리뷰 → 회귀/비교 검증**을 변경 단위마다 반복하는 편이 적절하다.

[10월 27일 상세 계획](../plans/ENGINEERING_FOLLOWUP_DETAIL_2026-10-27.md)의 복구 소유권·commit 정산·캐시 publish·역변환 계약은 큰 변경을 채택했을 때 필요한 조건으로 유지한다. 그러나 `계측 → 통합 worker → boot 이전 → 전환 lease`를 확정 실행 순서로 두지는 않는다. 통합 worker가 가장 작은 해결책이라는 근거는 아직 없다.

| 사용자 기준 | 현재 제품에 적용할 판단 | 지금의 실행 범위 |
|---|---|---|
| 1. 제품 전체 설계/MVP | 기존 로컬 앱의 요구·도메인·IPC·저장·배포 계약을 유지 | 서버/회원 DB/새 인증 도입을 추가하지 않음 |
| 2. 인수인계/구조 개선 | main 결합도와 동기 처리 비용을 조사하되 줄 수 자체를 결함으로 보지 않음 | 작은 중복 제거와 검증 경계부터 개선 |
| 3. RCA | 실제 장애/재현과 성능 가설을 구분 | 이전 Major A/B는 닫힌 상태 유지. 이번 중복 비용은 별도 성능 과제 |
| 4. 100배 확장 | 현재는 대화/파일 수와 본문 크기를 키운 합성 입력 | 클라우드 QPS·다중 사용자·분산 큐를 가정하지 않음 |
| 5. 성능 측정 | CPU·파일 I/O·main 지연·복사·worker 비용을 분리 | 비교 모듈 묶음을 고정한 M0 도구와 작은 후보의 전후 비교 |
| 6. 4인 독립 검토 | Architect·주 구현·Reviewer·SRE가 서로 다른 근거를 확인 | 구조 후보를 반려하고 작은 후보로 범위 축소, 경계 회귀 보완 |
| 7. PR 직전 검증 | 정확성·보존·권한·동시성·성능·관측성을 변경 범위에 맞게 검토 | 관련 테스트·기본 verify/build·실측. GUI/설치는 별도 수용 |

실제 사용자별 기록 규모, 긴 기록 전환 빈도, 서비스 지연 목표는 아직 주어지지 않았다. 합성 30MiB 결과를 실제 사용자 p95·배터리·프로덕션 수용으로 확대하지 않는다. Slack 대기·실제 모델 비용·사용자 포커스 보호 규칙도 유지한다.

## 재조정한 우선순위와 의사결정 gate

| 순서 / ID | 작업 | 선택·완료 조건 |
|---|---|---|
| P0 / 기존 ENG02–03 | history 교체 검사와 startup fail-closed 유지 | 신규 변경에서 기존 보존 회귀를 그대로 통과 |
| P1 / ENG04-M0a | 도구 격리·정상 v2 대표 계측 | 동시점 Store+worker+로컬 모듈, 동일 fixture, source 순서 교차, 계측 on/off·실제 결과 검증 |
| P1 / ENG04-S1 | 정상 v2 전환의 마지막 중복 직렬화 제거 | 기존 본문/metadata·정규화·32MiB·state 실패 rollback 동등, 전후 효과 확인 |
| 조건부 / ENG04-M0b | 8/24MiB·다수 짧은 메시지·복구·목록 규모 확대 | 대표 결과로 부족한 질문을 정한 뒤 해당 입력만 추가 |
| 조건부 / ENG04-A/B/C | 비동기 읽기/통합 worker 대안 비교·선택 | S1 이후 남는 read/parse/hash 차단이 지원 범위에서 중요할 때. 선택된 안에만 protocol/boot/lease 구현 |
| P1 / ENG05 | 큰 캐시 비용 측정 후 publish 경계 개선 | 기존 전체 identity·root 소유권·최종 확정 순서 보존. 검사만 await로 이동 금지 |
| P1 / ENG06 | 페이지 쓰기 증폭 ADR | 실제 사용 비용과 UX·복구/역변환 비용 비교. 포맷 변경이나 자동 batch를 미리 확정하지 않음 |
| P2 / ENG07–08 | 삭제 예산/조회·bounded 진단 | capability/시간 예산 근거, 원문 없는 고정 enum·상한·실패 격리 |
| 수용 / ENG09–10 | 실제 화면·패키지·설치·플랫폼/장시간 | 사용자 검증 시간 허용 후 최신 변경 묶음별 별도 실행 |

판단 gate는 다음과 같다.

- 작은 중복 제거로 목표가 충족되면 큰 worker 변경은 보류한다.
- 남는 비용이 read/parse/hash이면 순수 reader와 통합 worker의 준비·복사·복구 비용을 비교한다.
- 복사가 주원인이면 worker 수명 통합만으로 해결됐다고 판단하지 않고 전송 범위를 검토한다.
- 차이가 반복 변동보다 작으면 해당 성능 변경을 채택하지 않는다.
- main 지연 개선과 전체 시간/RSS 악화를 모두 기록한다. 정확성·보존 회귀 실패는 성능과 무관하게 반려한다.

## ENG04-S1: 발견 경로와 제한된 수정

변경 전 [openConversation](../../src/store.cjs:381) 경로는 대상 본문을 읽고 현재 대화를 저장한 뒤, 대상의 fingerprint를 계산하고 최종 `save()`에서 같은 본문을 다시 직렬화·SHA 처리했다. 앱이 쓰는 정상 v2는 이 fingerprint가 같아 실제로는 state만 교체했다. 따라서 최종 본문 재계산을 피할 수 있다. 링크는 현재 수정 코드이며, 변경 전 묶음은 이번 before snapshot에 보존한다.

무조건 `includeHistory:false`로 바꾸면 안 된다. 읽은 기록의 root key 순서·추가 필드·누락/비정상 threadId가 있으면 현재 최종 save가 canonical 형식으로 재저장하기 때문이다. 또한 읽기 전 32MiB 이내여도 status/createdAt 정규화로 payload가 한도를 넘을 수 있다.

구현 후보는 snapshot 계산용 직렬화 결과를 한 번 보관하고 다음을 **모두** 만족할 때만 기존 state-only 저장을 사용한다.

1. root key 집합과 순서가 `id,source,threadId,messages`다.
2. 읽은 threadId가 활성 상태에 적용한 threadId와 같다.
3. 정규화 후 직렬화 결과가 32MiB 이하다.

나머지는 기존 full save로 돌아가 canonical 재저장·용량 오류를 유지한다. state-only도 기존 save의 파일 경로·미복구 저널·목록 크기 검사와 rollback을 그대로 사용한다. 새 helper·포맷·worker·IPC를 추가하지 않는다. 초기 로드와 현재 대화 저장, 남은 동기 읽기 비용은 그대로 남는다.

새 [회귀 7개](../../test/store-open-cost.test.cjs)는 정상 payload 직렬화 2회→1회, 본문/metadata·worker/재시작·같은 ID 전환 보존, 비정규 root 4종의 저널/canonical 재저장, raw 정확 32MiB의 정규화 후 초과 거절, 최종 state 저장 실패 rollback을 확인한다. 변경 전에는 중복 직렬화 조건 한 개가 실패했고 나머지 보존 조건은 통과했다. 변경 후 관련 62개를 주 구현자와 Reviewer가 각각 실행해 통과했다.

이는 새 데이터 손실 결함을 고쳤다는 보고가 아니라 정상 v2 경로의 불필요한 계산을 줄이는 성능 변경이다. 신규 Blocker/Major는 조사 범위에서 발견하지 못했으며, 실제 개선 비율은 비교 계측 후 확정한다.

## ENG04-M0a: 비교 도구의 범위

이전 도구는 과거 Store에 현재 worker를 혼용했고, 첫 worker 비용을 숨긴 warm 저장만 측정했다. 이번 도구는 before/after의 프로젝트 디렉터리를 각각 고정하며 원본 묶음 hash와 도구 hash를 기록한다. 단일 과거 Store 파일에 현재 worker를 자동 보충하지 않는다.

도구는 Node CLI·격리 runner·worker probe·계측 probe 경계로 나눈다. 제품 프로세스에는 probe를 설치하지 않는다. 각 operation은 같은 fixture에서 새 임시 프로필을 만들고 실제 data/state/history 결과를 검사한 뒤 성공 표본으로 집계한다. fixture 준비·정답 검사·정리는 측정 구간 밖이다. 첫 worker와 warm worker를 나누고 before/after 순서를 교차한다.

계측 on/off는 별도 child에서 비교하며 fs/JSON/decode/SHA는 inclusive stage다. stage 합계를 전체 시간이라고 하지 않고, 직접 분리하지 않은 잔차를 정규화 시간으로 부르지 않는다. postMessage 시간은 복사 bytes와 다르다. endpoint RSS·heap delta는 peak/retained가 아니다. 성공 write payload bytes도 물리 쓰기량과 다르다.

대표 실행은 정상 canonical v2 1/30MiB·긴 메시지, 준비 3회+20표본, on/off로 constructor/read/unchanged/settings/first-worker/warm-worker/open-other/open-same/new를 비교한다. 이 범위가 성공해도 v1/저널/손상·8/24MiB·다수 짧은 메시지·5,000개 목록·캐시/삭제·GUI까지 M0 전체 완료로 표시하지 않는다.

## 실행 결과와 한계

착수 기준 `npm run verify`는 300/300, 실패/skip 0이었다. [기준 로그](../../artifacts/engineering-2026-10-28/baseline-verify.log)에 보존했다. source snapshot은 `artifacts/engineering-2026-10-28/before/`에 고정했다.

### 1차 비교와 추가 검증 결정

[1차 원자료](../../artifacts/engineering-2026-10-28/comparison.json)와 [요약](../../artifacts/engineering-2026-10-28/comparison-summary.json)은 72그룹·측정 1,440표본을 보존한다. 1MiB 목표는 실제 1,048,624B/12메시지, 30MiB 목표는 31,457,330B/319메시지다. 전후 묶음에서 다른 제품 파일은 store.cjs 하나다.

| 계측 off / 동작 | 전 중앙값 → 후 (ms) | 전 p95 → 후 (ms) |
|---|---:|---:|
| 1MiB 다른 대화 열기 | 13.36 → 10.49 (−21.5%) | 14.49 → 10.93 |
| 1MiB 같은 대화 열기 | 13.29 → 10.35 (−22.2%) | 13.75 → 11.10 |
| 30MiB 다른 대화 열기 | 379.85 → 291.95 (−23.1%) | 548.24 → 456.14 |
| 30MiB 같은 대화 열기 | 428.47 → 291.36 (−32.0%) | 744.58 → 579.71 |

on에서도 30MiB 두 전환의 중앙값은 각각 22.3%/23.2% 감소했다. 전체 호출의 stringify 횟수 5→4와 CPU 감소는 수정 경로와 일치한다. 이 결과는 **합성 동기 호출 완료시간·CPU·중복 계산 감소**의 근거다.

반대 신호도 보존한다. 30MiB first-worker/off 중앙값 +12.6%·p95 +32.5%, read/off p95 +26.0%, warm-worker/on RSS endpoint 중앙값 +10.54%가 관찰됐다. 이 경로들은 수정 분기를 호출하지 않으며 worker hash도 같다. 그러나 그것만으로 노이즈나 제품 회귀 어느 쪽으로도 확정하지 않는다. paired 결과와 source 실행 순서에 따른 차이도 함께 검토한다. endpoint RSS는 누수율·retained/peak가 아니다.

특히 동기 전환이 수백 ms인데 histogram 최대 지연 중앙값은 1~5ms에 불과했다. 이 샘플링 지표는 동기 차단 교정을 통과하지 못한 것으로 보고 **반응성 채택 근거에서 제외**한다. 원자료의 `passed`는 실행·정합성 검사를 뜻하며 성능 게이트 전체 통과가 아니다.

추가 확인은 원자료를 버리지 않고 다음 **고정 행렬을 각 1회** 실행한다. 좋은 결과가 나올 때까지 반복하지 않는다.

1. 알려진 동기 차단과 비동기 대기로 검증한 예정 callback 지연을 추가한다. 이전 측정 도구 소스/hash를 별도 보존해 측정 버전을 구분한다.
2. 동일 제품 묶음의 30MiB/off: read·first-worker·warm-worker·open-other·open-same, 준비 3회+20쌍.
3. 동일 제품 묶음의 30MiB/on: warm-worker, 준비 3회+20쌍.
4. 동일 소스 A/A 대조: 30MiB/off read·first-worker, 30MiB/on warm-worker, 각각 준비 3회+20쌍.

보조 p95/RSS 악화가 같은 방향으로 반복되면 게이트를 통과로 표시하지 않고 원인 조사·채택 보류로 남긴다. 새 결과와 최종 코드 검증은 아래에 별도 확정한다.

### 추가 확인 결과와 최종 판정

예정 callback 계측은 noop·동기 30ms 차단·비동기 30ms 대기·취소 정리와 실제 runner 주입 교정을 통과했다. callback의 기다림을 operation 완료시간에 더하지 않는다. **직전 예약한 첫 callback 지연**이며 async 작업 중 모든 정지나 실제 Electron IPC/입력 지연을 측정한 것은 아니다. v2 도구와 v3 도구의 정확한 소스/hash를 각각 `measurement-tools-v2/`, `measurement-tools-v3/`에 보존했다.

고정 4회 [추가 결과 요약](../../artifacts/engineering-2026-10-28/validation-summary.json)은 18그룹·측정 360표본이다. 원자료는 [A/B off](../../artifacts/engineering-2026-10-28/validation-off.json), [A/B on](../../artifacts/engineering-2026-10-28/validation-on.json), [A/A off](../../artifacts/engineering-2026-10-28/control-aa-off.json), [A/A on](../../artifacts/engineering-2026-10-28/control-aa-on.json)에 있다. source/fixture/tool hash를 대조했으며 A/A는 양쪽 bundle hash가 완전히 같다.

| 30MiB/off | 호출 중앙값 전→후 (ms) | p95 전→후 (ms) | 첫 callback 중앙값 전→후 (ms) |
|---|---:|---:|---:|
| 다른 대화 열기 | 349.38 → 268.07 (−23.3%) | 433.99 → 290.19 | 349.61 → 268.20 (−23.3%) |
| 같은 대화 열기 | 390.70 → 275.05 (−29.6%) | 517.72 → 334.34 | 391.17 → 275.13 (−29.7%) |
| read | 44.23 → 43.72 | **55.61 → 69.58 (+25.1%)** | 44.29 → 43.78 |
| 첫 worker 저장 | 389.89 → 384.88 | 457.67 → 463.06 (+1.2%) | 7.11 → 7.59 |
| warm worker 저장 | 256.91 → 241.94 | 455.54 → 357.54 | 7.34 → 6.81 |

warm-worker/on의 RSS endpoint 중앙값은 1120.29→1063.06MiB(−5.1%)였다. 첫 worker/off 지연과 warm/on RSS의 첫 관찰 악화는 추가 확인에서 반복되지 않았다. 반면 read/off p95 악화는 반복됐다.

동일 소스 A/A read의 p95도 86.95→52.56ms로 약 39.6% 역방향 변동했다. A/A first-worker/off p95는 407.14→409.82ms, warm/on p95는 267.62→294.04ms였고 RSS endpoint는 1077.83→1099.95MiB였다. 이는 하네스/환경 변동이 존재한다는 음성대조 근거이지, A/B read 악화를 지워도 된다는 근거가 아니다. 표본 순서·GC/할당·스케줄링 등 원인은 아직 확정하지 않았다.

**최종 판정은 S1 코드·정합성 승인, 전환 경과시간/첫 callback 개선 확인, read tail 관문 미해결로 전체 성능 채택·배포 수용 보류다.** 후보는 현재 작업 트리와 `candidate/` snapshot에 보존한다. 성능 수용 완료로 표시하지 않으며 이 후보를 설치본에 반영하거나 배포하지 않았다. 불리한 원자료를 폐기하거나 좋은 재실행 결과로 대체하지 않았다.

Architect·Reviewer·SRE가 이 판정과 수치/범위를 독립 확인했다. 추가 벤치는 여기서 종료하고 다음 우선순위를 **ENG04-M0b/T1: read tail 원인 분리**로 둔다. 다음 실행 전에 표본별 순서·CPU·heap/RSS·on/off를 재분석하고, 준비 fixture의 대규모 할당/강제 GC와 read 구간 자체를 분리하는 가설·대조·종료 조건을 새로 고정한다. 통합 worker·boot·새 포맷으로 원인 확인을 건너뛰지 않는다.

| 최종 검증 | 실제 결과 |
|---|---|
| 관련 저장 회귀 | 62개 통과, Reviewer 직접 재실행·코드 범위 승인 |
| 도구 회귀 | 11개 통과, worker 혼용·정합 실패·SIGTERM 무시·spawn 실패·교정/취소 포함, Reviewer 직접 재실행 |
| `npm run verify` | **318/318**, 실패/skip 0. [v3 최종 로그](../../artifacts/engineering-2026-10-28/final-verify-v3.log) |
| `npm run build` | RENDERER_BUNDLE_OK. [빌드 로그](../../artifacts/engineering-2026-10-28/final-build.log). 이후 변경은 개발용 계측/테스트/문서이며 제품·renderer 소스는 그대로 |
| 코드/원자료 검증 | before/candidate 묶음과 tool v2/v3 hash 보존. [검증 기록](../../artifacts/engineering-2026-10-28/verification.json) |

이전 300개에 제품 회귀 7개·도구 회귀 11개가 추가됐다. `verify` 성공과 자료의 `passed`는 기능/수집 성공이다. 성능 수용 관문과 실제 환경 수용을 대신하지 않는다. 계측 도중 데스크톱 부하는 통제하지 못했고 초기 일부 구간에 짧은 독립 도구 테스트가 겹쳤을 수 있다. 전원 상태·전체 앱 peak RSS·실기 입력·배터리 성능은 미측정이다.

GUI·실제 모델·설치·배포는 실행하지 않는다. 이번 저장 변경의 rollback은 변경한 Store 코드와 함께 후보를 되돌리는 방식이며 v2 사용자 파일을 삭제/이관하지 않는다. 기존 미커밋 변경은 보존한다.
