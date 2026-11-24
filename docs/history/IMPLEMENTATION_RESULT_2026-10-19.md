> 과거 검토·구현 기록입니다. 각 절의 현재/최신 표현은 당시 기준이며, 현재 후보 상태는 [릴리스 현황](../ALPHA_REPORT.md)을 따릅니다.

# alpha23 구현·성능 검증 결과

> 이후 제품 코드 변경 없이 문서와 검사 실행기를 정리했다. 현재 검사 정책·248개 단위/15종 통합과 측정은 [후속 정리](PROJECT_REVIEW_ALPHA23_2026-10-20.md#문서와-테스트-정리-2026-10-19)를 따른다. 아래 검사 수와 script hash는 해당 구현 검증 시점의 기록이다.

기준 커밋은 `f4cb7ebcf5fd2b3db4856a9f4f71693a88739b5a`이며, 미커밋 변경으로 `0.1.0-alpha.23`/build39를 준비했다. [전체 분석과 계획](STAFF_ENGINEERING_REVIEW_f4cb7eb.md)의 F01–F11과 성능 P01–P07을 대상으로 삼았다. 기존 Electron·FIFO·JSON 저널·데이터형 팩 구조를 유지했다. 단순 로직은 기존 함수에 두고, 제한 읽기와 검색 worker만 실제 책임 경계로 분리했다.

2026-10-19에 최종 소스와 패키지의 검증을 마쳤다. 완료 범위와 남은 조건은 아래 근거를 기준으로 구분한다.

## 구현과 예외 처리

| ID | 변경과 검증 경계 |
|---|---|
| F10 승인 | 내용을 확인할 수 있는 명령 또는 유효한 네트워크 전용 대상만 허용. null/미지원 kind·writeStdin·제어문자·공백/URL 형태 host는 허용 차단. 거절/취소와 소유 요청 확인 유지. main과 화면 양쪽 검사 |
| F03 MD | 원시 바이트 SHA를 읽은 버전으로 전달. 외부 변경 시 파일/앱 초안 모두 보존하고 비교·재읽기·검토한 최신 hash로 저장. 삭제/손상은 무조건 덮어쓰지 않음. 저장/기본 복원 도중 새 입력과 외부 임시 파일 변경도 보존 |
| F05 추가 질문 | request/question ID별 실제 DOM 유지. 재정렬에도 입력·선택·포커스 보존. 질문 의미 변경 시 기존 답변을 별도 보존하고 새 입력으로 구분. 응답 중 중복 전송 제한 |
| F02 복구 | batch 내부 wx staging 완성·fsync·검사 후 hard link로 최종 이름 확정. 부분 쓰기/중간 종료/기존 목적 파일·교체된 staging·정리 실패에서도 백업과 외부 파일 보존. no-clobber가 안 되면 실패 처리 |
| F07 조작 | 제목과 삭제 버튼의 absolute 겹침 제거. 3너비×3스킨×3글자 배율의 좌표/클릭과 Tab/Enter/Escape를 실제 Chromium에서 검사 |
| F01 metadata | 제목·즐겨찾기 저장 성공 후 목록 revision 갱신. 추가 메시지 없이 정렬/검색 반영. 실패 rollback 및 후속 worker 저장·재시작 보존 |
| F04 읽기 | 팩 manifest/MD/이미지·스킨·말투 registry/journal·팩 복구·캐시 복원에 각 상한을 유지한 FD 크기+1 읽기 적용. 부분 읽기·성장·교체·UTF-8·close 검사. 자기 ASAR의 가상 정보·FD·물리 archive를 구분해 실제 runtime 검증 |
| F06 검색 | 방문/성공/실패·불완전 결과 구분. 손상/권한 실패 뒤 정상 hit 유지. 100기록/32MiB/50hit 한도, 실패 설명 최대 10건 |
| F09 회귀 | 실제 표시 상태와 publish된 메시지/원격 cursor를 기다림. 4→54→104→124 단계와 심플 assistant 1개 계약 검증 |
| F08 생성기 | 4팩 전체 사전 검증·메모리 출력 준비 후 생성. 수정 MD/모드/추가 파일 보존, 없는 템플릿만 배타 생성. 링크·손상·용량 초과는 쓰기 전 거절. 실제 프로젝트 팩은 재생성하지 않음 |
| F11 안내 | 현재 15종/alpha23·심플 답변 1개·설정 단축키 안내로 정리. 사용하지 않는 CSS/향후 안내 제거. Slack 대기와 과거 검증 이력 유지 |

주요 구현은 [main](../../src/main.cjs), [renderer](../../src/ui/renderer.mjs), [MD 저장](../../src/personas.cjs), [복원](../../src/storage-maintenance.cjs), [제한 읽기](../../src/bounded-file.cjs), [검색 worker](../../src/history-search-worker.cjs), [Store](../../src/store.cjs), [이미지](../../src/response-images.cjs), [생성기](../../scripts/create-characters.cjs)에 있다. 예외 검사는 기존 test 파일과 [생성기 회귀](../../test/generator.test.cjs)·[검색 회귀](../../test/history-search.test.cjs)에 포함했다.

실제 추가 질문 카드 재정렬은 동일 input 노드·값·focus·selection과 합성 composition 이벤트로 확인했다. 실제 한국어 입력기 검증을 대신하지 않는다. MD 충돌은 실제 창에서 비교 후 최신 hash를 제출하는 경로까지 확인했다.

## 비용별 가설과 채택 결과

원자료는 `artifacts/implementation-f4cb7eb/`에 보존한다. 반복 벤치마크의 중앙값은 정렬한 20표본의 10·11번째 평균, p95는 19번째 값이다. 원자료의 일부 초기 요약은 상위 중앙값을 사용했으므로 최종 비교는 `performance-summary.json`의 재계산 값을 따른다. 실험별 프로세스/입력과 측정 범위가 달라 수치를 합산하거나 전체 앱 개선률로 해석하지 않는다.

| 우선순위 / 비용 | 측정 기준 → 원인 → 수정 → 결과 |
|---|---|
| P01 CPU·복사·메모리 | 약 30MB JSON(29,998,539B)의 worker 왕복 snapshot 문자열 → SHA fingerprint 64B. 비동기 저장 106.63→80.88ms, 메인 이벤트 루프 최대 지연의 중앙값 16.90→4.55ms. 저널 historyHash 재사용. 초기 로드 40.43→55.01ms, 변경 없는 동기 저장 31.86→43.77ms로 증가해 반복 비동기 경로 응답성 개선을 우선한 trade-off |
| P02 decode·allocation | 동일 PNG 반복 decode → SHA/정책/validator에 맞는 성공 metadata LRU 128개. 매번 현재 원본/미리보기 SHA 재검사. 2048²·약 45.8KB 합성 PNG 중복 154.67→0.59ms, decode 20→0회. 새 이미지 160.68→158.38ms로 유의미한 개선 주장 없음 |
| P03 렌더 | 전체 목록 DOM → 전체 정렬/검색 유지하면서 100개씩 표시·formatter 재사용. 5,000개 첫 표시 1,034.50→34.65ms, DOM 자손 60,000→1,200. 1,000개는 207.35→26.20ms. IPC+DOM+frame 측정이며 전체 확장 시 비용은 남음 |
| P04 I/O·quota | 첨부 캐시 파일별 stat과 중복 SHA. 폴더 mtime 캐시로 기존 파일 내부 성장/변경을 놓칠 수 있어 검증 생략 기각. 성장·동일 크기 변조 회귀 추가. 제품 I/O 감소 변경 없음 |
| P05 쓰기 I/O | 40페이지 전체 JSON 재저장 누적 논리 쓰기 약 20.52배. 현재 포맷/commit cursor 경계를 유지하므로 감소하지 않음. 증분 포맷·batch commit은 별도 복구/호환 설계 필요 |
| P06 RPC 지연 | 소유 관계 순차 조회 → 최대 4개 동시, 실패 시 진행 중 조회 종료를 기다리고 전체 30초 deadline. read 지연 1ms fixture의 1,000기록 1,186.93→301.10ms. read N회+delete 1회는 동일하며 실제 CLI/network 속도 개선 수치가 아님 |
| P07 메인 blocking I/O·parse | query별 최대 worker 1개로 제한 읽기/parse/검색 이동. 30MiB급 비활성 기록의 메인 지연 39.39→1.94ms, 전체 시간 43.04→71.28ms. worker 생성/종료 비용으로 전체 검색은 느려져 UI 응답성을 우선. 1MiB는 4.93→28.06ms. 활성 메시지 구조화 복사 비용은 별도 미측정 |

P01은 20표본 순서를 뒤집어서도 비교했고, P02/P03/P06/P07은 예열 후 baseline/current 교대로 20개씩 측정했다. P04는 파일 수와 호출 횟수 조사 및 예외 재현이며 속도 개선 벤치마크가 아니다. RSS/heap 변화는 프로세스 전후 관찰로 peak/장기 누수를 증명하지 않는다. DB는 현재 사용하지 않으며 RPC N회 조회를 DB N+1 query로 표시하지 않는다.

검색은 저장 대기 전 요청 revision/대화를 고정하고 취소·reload·대화 전환·잠금/절전 및 종료 await 뒤에도 소유권을 확인한다. 이전 worker 종료 후 다음 worker를 시작하며, 삭제되어 버릴 결과도 실제 읽은 바이트를 예산에서 차감한다. 실패/timeout은 기존 기록을 쓰거나 고치지 않는다. 최종 예외 재검토에서는 최초 lstat 뒤 파일이 커지고 읽기가 실패하면 실제 읽기보다 적은 예약량을 청구할 수 있음을 재현했다. reader의 상한을 최초 확인한 크기로 제한해 성장 파일은 큰 할당/읽기 전에 거절한다. 32MiB는 논리 payload 예산이며 제한 읽기의 EOF/성장 확인용 1바이트는 방문 최대 100파일에서 최대 100바이트 별도다. 이 최종 수정은 정상 파일의 읽기/검색 경로를 유지하며 실패 주입 회귀와 패키지 재검증을 통과했다.

## 독립 검토와 수정 반복

root가 Architect/통합 역할을 맡고, Implementation·Reviewer·SRE/Optimizer 역할을 나누어 독립적으로 검토했다. F08은 구현자 외 재검토, P04는 검사 생략의 안전성 반증, P07은 저장 대기 전 취소·종료 await 중 취소·삭제 결과 바이트 청구 문제를 발견해 수정 후 회귀를 추가했다. 부분 복구의 종료 시점과 임시 파일 교체·변조, MD 외부 변경도 실패 주입으로 검증했다.

첫 전체 통합에서는 검색을 worker로 옮긴 뒤 예전 fs.stat 대기를 사용한 expansion fixture가 실패했다. 제품 취소를 무시하지 않고 worker postMessage/종료를 기다리는 fixture로 수정한 뒤 15종을 다시 실행했다. MD 기본 복원 뒤 파일을 다시 읽어 반환 버전을 정하던 경합도 발견해 실제 저장 결과의 hash를 반환하도록 수정했다. 첫 ASAR 자원 실행에서는 가상 inode와 추출 FD inode 차이로 정상 스킨 읽기를 거절했다. 후속 실제 진단에서 virtual inode가 조회마다 증가함을 확인해 자기 번들에서만 합성 inode 비교를 제외하고 FD/물리 archive의 identity 검사를 유지했다. 패키지 검증에 실제 ASAR의 3스킨·4팩 로드를 추가해 같은 오류가 파일 해시 검사만 통과하지 못하도록 했다. 실패 로그는 삭제하지 않았다.

## 검증 기록

결과 JSON은 파일 hash/실행 시각과 함께 읽어야 한다. 최종 검사는 다음과 같다.

| 검사 | 최종 결과와 근거 |
|---|---|
| 정적·단위 | lint/check 통과, 단위 238/238·실패/skip 0. [단위 로그](../../artifacts/implementation-f4cb7eb/unit-final.log) |
| Electron 통합 | 15/15, 성공 종료·결과 JSON·격리 profile 정리까지 확인. [결과](../../artifacts/implementation-f4cb7eb/integration-release/integration.json) |
| history 경합 | 전체 통합 1회+같은 최종 runtime 소스의 추가 4회, 5/5. [추가 4회째](../../artifacts/implementation-f4cb7eb/history-release-4/integration.json) |
| 실제 UI | 390/460/720px×3스킨×글자 100/110/120%의 27조건 좌표/클릭, 같은 27조건 키보드 동작. [좌표·입력·벤치](../../artifacts/implementation-f4cb7eb/ui-regressions.json), [키보드](../../artifacts/implementation-f4cb7eb/keyboard-regressions.json) |
| 실제 ASAR | 원본 일치 87파일, 예상 3스킨/4팩의 실제 loader 실행, 대형 합성 이미지 원본/preview·첨부 사본·Store 재시작·캐시 복구·실제 packaged 검색 worker 통과. [결과](../../artifacts/implementation-f4cb7eb/package-verification-release/package-verification.json) |
| 로컬 서명 | build39 strict ad-hoc 검증 성공. [로그](../../artifacts/implementation-f4cb7eb/codesign-final.log) |
| 성능 | 20표본 raw와 올바른 중앙값으로 비교. [최종 요약](../../artifacts/implementation-f4cb7eb/performance-summary.json), [Store 원자료](../../artifacts/implementation-f4cb7eb/store-cost-reverse.json), [최종 main 원자료](../../artifacts/implementation-f4cb7eb/main-cost-benchmark.json), [이미지](../../artifacts/implementation-f4cb7eb/image-benchmark.json) |

패키지 검사기의 초기 출력에서 비어 있던 팩 식별자를 실제 manifest ID와 예상 4개 ID 검증으로 고쳤다. 마지막 검색 파일 성장 경합 수정 뒤에는 패키지·전체 통합·history 반복·자원 관찰을 모두 다시 실행해 통과했다. 위 UI 좌표/키보드 전용 측정 뒤의 제품 변경은 검색/MD 반환/ASAR 읽기 경계이며 최종 통합에서 다시 검증했다. P07 정상 파일의 성능 계측 이후 추가한 파일별 상한 변경은 외부 성장/읽기 실패 경합을 다룬다. 이 수정 자체의 별도 속도 개선을 주장하지 않는다.

최종 ASAR의 격리 demo 실행에서 5상태×60초·50표본을 수집하고 정상 종료했다. 아래는 Electron 자체 프로세스 CPU 백분율 합의 관찰값이다. 중앙값은 10표본의 중앙 두 값 평균으로 재계산했으며 p95는 최대값이다. 메모리는 공유 영역을 중복 포함할 수 있어 고유 RAM/장기 누수로 해석하지 않는다. 이 검사는 개발 Electron이 최종 ASAR를 읽는 격리 runtime 실행이며, signed 앱 묶음을 사용자가 직접 실행한 전체 OS 수용과 구분한다.

| 상태 | 표본 | CPU 합 중앙값(%) | p95(%) |
|---|---:|---:|---:|
| visible-motion | 10 | 1.025 | 1.069 |
| visible-reduced-motion | 10 | 0.047 | 0.098 |
| visible-quiet | 10 | 0.044 | 0.077 |
| visible-daily | 10 | 0.099 | 1.039 |
| hidden | 10 | 0.047 | 0.081 |

전원 표본은 AC 50개/배터리 0개, 유휴 상태는 active, 전환 이벤트는 0건이었다. 데스크톱 활동은 통제하지 않았으며 배터리 지속시간·전체 시스템 개선률을 측정하지 않았다. [최종 자원 원자료](../../artifacts/implementation-f4cb7eb/packaged-resources-verified/resource-smoke.json)를 따른다.

캐릭터·스킨·아이콘 등 63개 원본은 기준 hash와 일치한다. 최종 통합의 runtime/script hash와 패키지 파일 hash를 현재 소스와 대조했고, 자원 관찰 전후 ASAR hash도 동일했다. 문서 82개의 로컬 링크 823개·앵커 17개에 깨진 참조가 없고 diff 공백 검사도 통과했다. [최종 검증 JSON](../../artifacts/implementation-f4cb7eb/verification.json)에 현재 소스·후보 hash와 결과를 기록했다.

## 보존과 남은 조건

일반 실행 앱 `dist/OnggiBot-darwin-arm64/`의 alpha14/build30은 교체하지 않았다. 직전 alpha22/build38 전체 앱을 `dist/rollback-alpha22-build38/OnggiBot-darwin-arm64/OnggiBot.app`에 보존했다. 이번 실행은 실제 모델 질문·실제 외부 서비스 검증·실제 캐릭터 재생성을 추가하지 않았다. 사용자 원본·MD·저널·백업을 정리 대상으로 삭제하지 않았다.

P04 첨부 quota 조사와 P05 페이지별 전체 JSON 재저장은 남는다. 초기/일부 동기 JSON 경로와 활성 메시지 구조화 복사도 남는다. 같은 UID의 외부 프로세스와 마지막 검사→확정 사이 완전한 filesystem CAS 또는 전원 장애 내구성을 보장하지 않는다. Windows/Intel·물리 한국어 IME·절전/잠금/Spaces·배터리·OS 배너 클릭/소리·새 PC 설치·실제 미로그인 callback/다른 제공자는 별도 수용 대상이다. 로컬 ad-hoc 서명은 Developer ID/공증·외부 배포 완료가 아니다. Slack·음성·기억·Live2D 등 조건부 항목은 [TASKS](../../TASKS.md)에 유지한다.
