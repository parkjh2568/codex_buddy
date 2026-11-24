# 엔지니어링 후속 이슈 상세 작업계획 · 2026-10-27

**2026-10-30 후속:** [예외 정합성 수정·T1 고정 조사·캐시 탐색 결과](../history/ENGINEERING_SAFETY_EXECUTION_2026-10-30.md)를 반영했다. verify 332개·build 통과와 성능/배포 수용 보류를 구분한다. 아래 ENG06에는 현재 후보의 v2 유지 ADR을 추가했으며, worker/새 포맷/진단/실환경 수용이 모두 구현된 것은 아니다.

**2026-10-28 재평가:** 아래 worker 설계는 채택 시 필요한 안전 계약이다. 확정 실행 순서는 [재평가·작업 결과](../history/ENGINEERING_REASSESSMENT_2026-10-28.md)를 따른다. M0 대표 계측 → 정상 v2 중복 제거 S1 → 잔여 비용 판단을 먼저 수행하며, 통합 worker/boot 이전은 작은 수정으로 부족하다는 근거 이후 선택한다.

## 1. 이번 계획의 범위와 판단

이 문서는 [선행 보고·전체 계획](PRODUCTION_ENGINEERING_PLAN_2026-10-27.md)의 ENG04–10을 실제 구현 단위로 구체화한다. 이번 작업은 코드·증거·호출 경로의 재검토와 계획 작성이다. 제품 코드 수정, 새 성능 측정, GUI·실제 모델·패키지 실행은 하지 않는다. 이전 300개 테스트·빌드 성공은 **이전 실행 결과**이며 이번 문서 변경으로 새로 얻은 결과가 아니다.

이미 완료한 ENG02/03의 history identity 검사와 초기 읽기 실패 시 쓰기 차단은 선행 조건이다. 이를 다시 미구현 과제로 열지 않는다. 이전 수정 범위는 [Store](../../src/store.cjs:90), [회귀 11개](../../test/history-identity.test.cjs), [실행 증거](../../artifacts/engineering-2026-10-27/verification.json)에서 확인한다. 현재 Store·회귀 소스 hash와 선행 증거의 hash를 대조하는 것은 새 테스트 실행과 구분한다.

재검토에서 다음 설계 조건을 구체적으로 확인했다. 아래 내용은 새로운 재현 완료 장애가 아니라 **후속 변경에서 지켜야 할 조건**이다.

| 확인한 조건 | 계획에 주는 영향 |
|---|---|
| Store 생성자는 읽기 외에 저널 복구·설정 백업·v1 이관·삭제 복구를 수행 | 읽기 worker마다 `new Store`를 실행하는 설계 금지. 복구·쓰기 소유자를 하나로 정해야 함 |
| registryRevision은 모든 설정/위치 변경의 revision이 아님 | 이 값만으로 비동기 전환 중 설정 변경·늦은 저장을 검출할 수 없음 |
| historyLoading만으로 모든 상태 변경이 차단되지 않음 | 이름·설정·모델·OS 위치 이벤트까지 쓰기 경로를 조사하고 전환 소유권을 적용해야 함 |
| 디스크 commit을 시작한 결과는 단순히 늦은 응답으로 폐기할 수 없음 | commit 전 취소와 commit 후 정산을 분리. 메모리·디스크를 같은 확정 상태로 맞춰야 함 |
| 캐시 최종 검사→내용 확인→linkSync 사이에는 현재 await가 없음 | 검사만 worker로 이동하면 publish까지의 비동기 간격이 추가됨 |
| load-older는 로컬 확장 후 사용자 요청마다 원격 한 페이지를 읽음 | 자동 다중 페이지 batch는 UX·네트워크·취소 계약을 바꾸는 별도 선택 |
| 삭제의 30초는 주로 관계 read/delete/부재 확인 RPC의 공유 예산 | 저장 대기·connect·로컬 commit까지 항상 30초라는 보장은 현재 근거에 없음 |
| 새 state version을 거절하는 구버전이 항상 쓰기 차단 상태가 되는 것은 아님 | 새 포맷의 rollback을 단순 바이너리 교체로 설계하면 안 됨 |

기존 사용자 데이터, 미커밋 변경, v2 파일·저널, 실제/체험 구분, FIFO·자동 재전송 금지, 포커스 보호를 공통 불변조건으로 유지한다. 서버·Redis·새 DB·프레임워크 도입은 확정하지 않는다. Slack 대기와 기존 조건부 기능은 계속 별도 범위다.

## 2. 근거·우선순위·의존성

### 현재 확인할 수 있는 기준선

| 항목 | 선행 근거 | 해석의 한계 |
|---|---|---|
| 기본 검증 | lint/check·300/300, 실패/skip 0; build 성공 | 실제 창/설치·현재 변경 전체의 독립 승인과 다름 |
| 약 30MB 로드 | 29,998,539B, 두 반복 중앙값 50.05/46.82ms | read/parse/정규화/hash의 개별 비용은 분리되지 않음 |
| 변경 없는 sync save | 중앙값 37.72/34.88ms | 전체 직렬화/SHA를 하는 경로. 건너뛰기 가능성을 증명한 것은 아님 |
| 변경된 worker save | 중앙값 76.78/71.26ms | main→worker 복사와 worker 실행·대기를 포함 |
| 40페이지 쓰기 | 25,663,250B/120회, 최종 1,250,589B, 20.52093배 | 성공 payload 쓰기량. 실제 클릭 빈도·물리 디스크 쓰기량이 아님 |

원자료는 [baseline](../../artifacts/engineering-2026-10-27/store-baseline.json), [측정 제약](../../artifacts/engineering-2026-10-27/store-baseline-metadata.json)에 있다. 두 라벨은 동일 소스 반복이며 개선 전후 비교가 아니다. 안정성 수정 전의 합성 기준선이므로 이후 최적화의 정확한 비교 기준은 착수 시 현 소스를 다시 고정한다.

### 실행 순서와 릴리스 필수 조건의 구분

| 순서 | 작업 단위 | 위험 / 수정 비용 | 선행 조건·산출물 |
|---|---|---|---|
| 0 | ENG04-M0 공통 계측·fixture 계약 | 낮음 / 중간 | 현재 모듈 묶음·실제 byte/hash, 단계별 baseline, 실패 주입 기반 |
| 1 | ENG04-A 저장 worker 요청·소유권 계약 | 높음 / 중간~큼 | 기존 동작 유지 상태의 protocol/직렬화 회귀 |
| 2 | ENG04-B 초기 로드 비동기화 | 높음 / 큼 | 단일 복구 주체, 초기화 전 동작 차단·종료 처리 |
| 3 | ENG04-C 대화/새 대화 전환 비동기화 | 높음 / 큼 | 전환 lease·설정/위치·commit 결과 정산 |
| 4 | ENG04-D 중복 직렬화·복사 최적화 | 높음 / 조건부 | dirty/revision 완결성·실측 비용이 채택을 지지할 때 |
| 5 | ENG05 최종 캐시 publish 경계 개선 | 높음 / 큼 | 대규모 cache 실측, 검증과 publish의 동일 소유자 |
| 6 | ENG06 쓰기 증폭 ADR·선택안 구현 | 매우 높음 / 큼 | 사용자 흐름·포맷·소비자·이관/역변환 결정 |
| 7 | ENG07 삭제 RPC/예산 개선 | 높음 / 중간 | 현재 4개 동시성 유지, capability·관계 완결성 근거 |
| 병행 가능한 설계 | ENG08 장애 집계·진단 계약 | 중간 / 중간 | reason/상한/개인정보 검사, 구현은 저장 오류 경계 안정 후 |
| 별도 검증 시간 | ENG09 DOM·클래식 수용 | 중간 / 측정 후 결정 | 실제 GUI 시간 허용과 `--interactive` |
| 릴리스 게이트 | ENG10 패키지·설치·실환경 | 높음 / 대상별 상이 | 최신 소스·패키지 hash, 지원 플랫폼·배포 대상별 근거 |

ENG10은 성능 과제를 전부 끝낸 뒤에만 생각하는 후순위가 아니다. **릴리스하려는 각 변경 묶음마다 필요한 수용 게이트**다. 반면 성능 과제의 일부를 보류한 상태에서도 현재 지원 범위와 제한을 명시한 후보를 검증할 수 있다. GUI 시간이 없는 동안 가능한 구현 순서는 위 표를 따른다.

## 3. ENG04-M0 — 측정부터 보완

### 측정 설계

현재 [store-cost-benchmark](../../scripts/store-cost-benchmark.cjs)는 단일 약 30MB/300메시지와 40페이지를 측정한다. 비교 대상 Store는 복사하지만 **양쪽에 현재 worker를 사용**한다. worker protocol이 바뀐 뒤 이 도구를 그대로 사용하면 구버전 Store와 신버전 worker의 혼합 비교가 된다. 먼저 비교 대상별 worker·종속 모듈 묶음을 고정하도록 계측을 보강한다. 파일을 임의로 주입하는 fixture monkey patch는 제품 코드에 넣지 않는다.

| 영역 | fixture / 단계 | 필수 기록 |
|---|---|---|
| 초기화 | 새 프로필·정상 v2·v1·저널 복구·읽기 차단 × 1/8/24/30MiB | read/decode/parse/정규화/stringify/SHA·worker 준비/복사·전체 완료 |
| 메시지 형태 | 같은 byte의 긴 소수 메시지 / 짧은 다수 메시지, 한글·escape, 자료 metadata | 메시지 수·실제 UTF-8 bytes·완료/중단 정규화 일치 |
| 저장 | 무변경·설정만·본문 변경·등록부만·첫 저장 worker | 직렬화/hash·postMessage·worker wait/commit·ACK 채택 시간 |
| 전환 | A→B, A→A, 새 대화, 다른 CLI/작업 폴더 | 이전 저장/대상 읽기/활성 확정·전체 시간, 설정/본문 identity |
| 100배 규모 | 목록 50→5,000개, 캐시 100→10,000개, 본문 0.3→30MiB | 한도 내 실제 크기와 개수, 한도 초과는 성능 표본 대신 거절 회귀 |

원자료에는 runtime·OS/CPU·전원 조건·동시 부하·fixture seed/hash·모듈 hash·계측 on/off를 기록한다. 시간은 monotonic clock으로 측정한다. warm 조건은 3회 준비 후 20표본씩, 전후 순서를 교차한다. 새 프로세스 시작은 각 5회 이상 별도로 기록하되 OS 파일 캐시까지 비운 cold I/O라고 부르지 않는다. n=20의 p95는 nearest-rank 19번째 값과 원자료를 함께 제시한다.

main event-loop delay, 제어 callback 왕복 지연, 프로세스 CPU, heap delta/GC 후 retained, 관찰 RSS와 peak의 차이를 구분한다. process CPU에는 worker가 포함되지만 renderer/CLI 전체 CPU는 포함하지 않는다. 성공 payload bytes·횟수와 파일시스템 metadata·실패 부분 쓰기·물리 쓰기를 구분한다.

### 채택·중단 조건

- 잠정 주지표는 해당 경로의 **main 차단/제어 지연**이다. 완료시간과 worker CPU·메모리는 보조 지표로 기록한다. 비동기화가 전체 완료시간을 늘릴 수 있는 trade-off를 숨기지 않는다.
- 채택 후보는 주지표 중앙값 20% 이상 개선 또는 지정한 큰 JSON 구간이 main에서 사라지는 구조적 목표 달성이다. 보조 p95/RSS의 10% 초과 악화가 반복되면 채택 전에 원인을 검토한다. 작은 절대시간에는 비율만 적용하지 않고 측정 오차를 함께 보고한다.
- 안전성 회귀 실패, 반복 표본보다 작은 효과, 최악 입력에서 큰 악화가 있으면 범위를 줄이거나 보류한다. 이 기준은 제품 SLO나 이미 달성한 성과가 아니다.
- 실패/이상치를 지우지 않는다. 재실행 횟수와 추가 표본 기준은 사전에 정하고 결과가 좋아질 때까지 반복하지 않는다.

완료 산출물은 계측 스크립트 변경, fixture 규격, 단계별 원자료, baseline 요약, 관련 비용을 분리해 설명한 채택 판단이다. 이 단계만 끝났으면 상태는 **계측 완료**이며 제품 성능 개선 완료가 아니다.

## 4. ENG04-A/B/C/D — 저장과 전환의 비동기 범위

### 현재 경로와 숨은 결합

| 경로 | 현재 위치·처리 | 후속 변경의 검토점 |
|---|---|---|
| 앱 시작 | [main:479](../../src/main.cjs:479) → Store constructor | 팩/설정/창 초기화가 읽은 settings에 의존. Promise만 감싸도 동기 비용은 이동하지 않음 |
| Store 시작 | [store:27](../../src/store.cjs:27), [store:71](../../src/store.cjs:71), [store:90](../../src/store.cjs:90), [store:108](../../src/store.cjs:108) | 저장 복구·백업/v1·활성 읽기/hash·삭제 복구가 같은 생성자에 있음 |
| worker 시작 | [store-worker:3](../../src/store-worker.cjs:3) | 다시 Store를 생성. 새 reader를 별도로 만들면 복구 주체가 중복될 수 있음 |
| 전환 | [store:381](../../src/store.cjs:381), [main:1049](../../src/main.cjs:1049) | 대상 읽기→현재 저장→활성 변경→다시 저장. 재직렬화와 같은 ID 재열기 영향 측정 |
| 새 대화/연결 변경 | [store:373](../../src/store.cjs:373), [main:1173](../../src/main.cjs:1173), [main:1391](../../src/main.cjs:1391) | 현재 저장과 새 활성 확정을 함께 바꿔야 함 |
| 비활성 기록 내보내기 | [main:1017](../../src/main.cjs:1017) → readHistory | 우선 잔여 동기 소비자로 추적, 전환/worker 쓰기와 겹치지 않는 소유권 확인 |
| 종료 | [main:1596](../../src/main.cjs:1596) | 현재 save만 기다림. 새 boot/read/transition도 정산한 뒤 마지막 저장/worker 종료 필요 |

선호 목표는 기존 저장 worker를 **boot/read/save/state 확정의 명시적 요청을 직렬 처리하는 저장 소유자**로 확장하는 것이다. 별도 읽기 worker는 복구를 절대 실행하지 않는 순수 읽기 경계와 파일 소유권이 입증될 때만 대안으로 비교한다. main을 통째로 context 객체로 옮기거나 공용 IPC dispatcher로 재작성하지 않는다.

### ENG04-A: 먼저 동작을 바꾸지 않고 protocol과 소유권을 고정

1. 요청을 `requestId/op/operationToken/expectedRevision`으로 구분하고 응답을 해당 요청에만 매칭한다. 현재 saveAsync의 `once('message')`를 그대로 둔 채 다른 응답을 섞지 않는다. A에서는 기존 lazy save 경로만 활성화하고 boot/read op는 후속 B/C의 계약으로 예약한다.
2. A에서는 현재 main 초기화/첫 저장 worker 생성 동작을 유지한다. deferred 초기화·단일 boot 복구 소유권·startup/종료 연결의 실제 전환은 B에서 함께 활성화한다. 이 경계로 protocol 변경과 복구 소유권 변경의 원인을 분리한다.
3. sync save와 worker 작업의 동시 파일 접근을 금지한다. 전환 중 상태 저장을 기다리게 하거나 명시적으로 거절하는 경로를 조사한다. 단순 boolean busy를 추가해 일부 호출만 막지 않는다.
4. 프로토콜 위반·다른 ID·중복 ACK·옛 worker 세대 응답·timeout/exit에 대해 Promise/listener/timer를 한 번 정리한다. 읽기 실패와 불확실한 쓰기 실패의 writeBlocked 정책을 분리한다.
5. 기존 정상 저장·fingerprint/registry invalidation·삭제 복구·설정만 저장·최초 등록 결과가 그대로인지 먼저 확인한다. 이 단계는 병목 개선보다 프로토콜 회귀를 줄이는 변경 단위다.

### ENG04-B: 초기 로드 이동

복구·이관은 worker boot에서 한 번 소유한다. main의 Store는 명시적 deferred 상태를 지원하되, 준비 전 저장/질문/자동 복구를 허용하지 않는다. 기존 기본 생성자의 동기 계약을 유지할 호환 소비자/테스트를 확인한다. 이 단계에서 기존 lazy save 경로를 boot한 worker 재사용 경로로 바꿔 복구 주체가 중복되지 않게 한다.

boot 응답에는 검증한 data, snapshot, pendingDeletion, warning, writeBlocked와 소유 revision을 포함한다. main은 준비 중 임시 빈 상태를 정상 상태처럼 저장하지 않는다. 준비 전 진입 가능한 IPC·activate/second-instance·종료 이벤트를 점검한다. 기존 설정이 확정된 뒤 팩/스킨/이름/창 구성을 이어간다.

main은 Store와 초기화 Promise를 종료 경로에서 찾을 수 있게 먼저 등록한다. boot를 기다린 뒤 `quitting`을 재확인하고 후속 초기화를 진행한다. 현재 시작 순서를 유지하면 첫 창은 여전히 Store·팩 준비 이후에 생성되므로, main 지연 감소를 첫 창 표시 시간 단축과 동일하게 주장하지 않는다.

기존 8MiB/32MiB, bounded 읽기, path/FD/named identity, UTF-8, 백업 실패 차단, 활성 본문 실패 차단, v1/저널 복구·질문 자동 재실행 금지를 그대로 worker에 적용한다. 초기화 실패 시 원본과 경고/차단 상태를 반환하며 정상 빈 프로필로 덮지 않는다. 준비 중 종료하면 boot 완료·실패를 정산하고, 미초기화 data를 마지막 저장으로 쓰지 않는다.

worker 재생성 정책도 B의 수용 범위다. 최초 boot 실패와 boot 이후 read/idle/commit 중 exit를 구분한다. 첫 구현은 boot 이후 worker를 무조건 재생성해 `new Store` 복구를 반복하지 않고 저장 degraded/차단 상태로 정산해 재시작을 안내하는 보수적 안을 우선한다. 이 안은 현재 idle worker 재생성 동작과의 의도된 차이이므로 UX/회귀에 명시한다. 자동 재boot를 채택하려면 진행 작업이 없고 모든 쓰기가 정산된 상태에서만 가능해야 하며, 새 disk 결과가 main의 dirty 설정/위치·pending deletion을 덮지 않는 동기화 계약을 별도로 검증한다.

### ENG04-C: 전환 lease와 commit 정산

비동기 전환의 제안 상태는 다음과 같다. `lease`는 전환 작업이 상태 변경/파일 접근 순서를 소유하는 표식이다.

```text
idle → admitted → saving-current → reading-candidate → candidate-ready
                                                   → committing-active → settled
commit 전 취소/대상 변경 → 이전 활성 유지
commit 중 불확실한 실패 → 원본·저널 보존 + 쓰기 차단
commit 성공 → 디스크/메모리 확정, UI 소유자가 바뀌었으면 새 화면에 게시
```

이 순서는 제안 설계다. 현행은 대상 읽기가 먼저이므로 **대상 읽기 실패 전에 현재 저장이 일어나는 의미 차이**도 회귀/비용 비교에 포함한다. 데이터 보존과 같은 ID 재열기 정합성을 우선하며, 실제 순서는 ENG04-A 리뷰에서 고정한다.

- admission에 from/to ID, 메시지 배열 소유자, 요청 token, worker 세대, 창/frame generation, 설정/상태 revision을 고정한다. `registryRevision`을 모든 변경을 뜻하는 값으로 재사용하지 않는다.
- lease가 소유한 saving-current/commit의 성공으로 증가한 revision은 단계별 accepted revision으로 갱신한다. 자기 저장 결과를 stale로 버리지 않으면서 다른 mutation은 구분해야 한다.
- 후보 read 완료 후 원본/선택 대상·삭제 pending·대화 문맥을 확인하고, commit 전에 취소를 마지막으로 수용한다. candidate는 아직 활성 data가 아니다.
- 대상 대화의 workspace/codexPath/demo 적용만 기존 전환 계약대로 수행하며, 현재 앱에서 선택한 model/effort/serviceTier를 옛 대화 값으로 되돌리지 않는다. 로컬 전환이 확정된 뒤 필요한 CLI 연결을 바꾸고 기존 원격 조회를 이어간다. 원격 조회 실패가 이미 성공한 로컬 전환을 되돌리지는 않는다.
- worker에서 동기 JSON parse 중인 작업은 취소 메시지로 즉시 멈추지 않는다. commit 전 논리 취소 결과는 폐기하되 해당 작업이 정리될 때까지 다음 worker 작업이 기다린다는 지연을 계측한다. 공유 저장 worker를 취소만을 위해 강제 종료하지 않는다.
- committing 이후 취소는 받지 않는다. 성공 ACK는 원래 renderer가 닫혔더라도 Store 메모리에 확정해야 한다. 화면 소유권 변경은 UI 게시/탭 이동을 막는 조건이지 디스크 commit을 없애는 조건이 아니다.
- commit 전 실패는 이전 활성/본문/settings/snapshot을 유지한다. commit이 일어났는지 모르는 timeout/exit는 낙관적으로 이전 data로 돌아가 다음 저장으로 덮지 않는다.
- 전환 완료 정산 뒤에만 마지막 종료 저장을 수행한다. 새 boot/transition 실패를 질문 재전송으로 복구하지 않는다.

전환 도중 mutation별 정책을 별도 확정한다.

| mutation | 기본 권고 |
|---|---|
| send·새 대화·삭제·workspace/CLI·mode 전환 | lease 동안 새 접수를 거절하거나 정산 이후 재검증. 이미 접수한 입력을 자동 재시도하지 않음 |
| 이름·모델·스킨·말투·설정·대화 metadata | 메모리 수정 전 기다림/거절. 단축키 등록 같은 OS 부수효과도 순서와 rollback 유지 |
| pet move·drag-end·recover-position | 표시/이동은 유지, 최신 position을 별도 임시 상태로 보관하고 lease 정산 후 소유 state에 한 번 저장. worker가 반환한 옛 position으로 덮지 않음 |
| pointer·show/hide·copy·cancel/승인 제어 | 필요한 소유권 검사하에 계속 처리. 파일 mutation과 묶어 대기시키지 않음 |
| response-rendered·queue edit/cancel·종료 | 이미 진행 중인 저장과 변경 대상 소유권을 다시 확인, 전환 admission과 충돌하지 않도록 기존 guard 대조 |

구체 조사 대상은 [위치 이벤트](../../src/main.cjs:575), [모델 설정](../../src/main.cjs:1257), [이름](../../src/main.cjs:1397), [설정](../../src/main.cjs:1406)과 main의 모든 Store save/new/open/delete 호출이다. 위치 저장 버퍼는 새 영구 저장 포맷이 아니다. 종료 직전에 dirty position을 포함할 순서도 시험한다.

### ENG04-D: 남은 직렬화/복사

먼저 작은 상태·설정 저장은 본문 전송/직렬화 없이 처리할 수 있는지 계측한다. 본문이 바뀌지 않았다는 사실을 dirty revision으로 보증할 수 있을 때만 큰 stringify/SHA를 생략한다. 현재 메시지는 여러 경로에서 인라인 수정되므로 모든 변경 지점의 revision 반영을 확인하기 전에는 캐시를 도입하지 않는다.

큰 메시지 객체를 worker와 main 양쪽에 무제한 보관하거나 전체 snapshot을 재전송해 최적화를 상쇄하지 않는다. main→worker·worker→main 복사 bytes와 ACK 후 main 정규화/hash 비용을 별도로 측정한다. 저장된 진행 상태와 재시작 때 interrupted로 정규화한 상태의 fingerprint 의미를 유지한다.

### 필수 회귀·산출물

| 조건 | 확인할 결과 |
|---|---|
| 정상 v2 / 빈 상태 / v1 / 저장 저널 | 기존 결과와 동등, 복구·백업 한 번 소유, 질문 자동 재실행 없음 |
| 교체·FIFO·손상·32MiB 정확 경계/초과 | ENG02/03 회귀 유지, FD close·원본/저널 보존 |
| A→B / A→A / 새 대화 / 다른 문맥 | 활성·메시지·settings·thread·snapshot·디스크 일치 |
| read 중 설정/모델/이름/위치 이벤트 | 변경 유실·옛 응답 덮어쓰기·동시 sync write 없음 |
| commit 전 취소/잠금/reload/삭제 pending | 후보 폐기, 이전 활성 유지 |
| commit 직후 reload/종료/ACK 지연 | 확정 Store 결과 채택, 옛 UI 강제 표시 없음, 종료 저장 순서 유지 |
| worker crash/timeout·duplicate/foreign ACK | 한 번 정리, 불확실한 쓰기 차단, late ACK로 새 작업 정산 안 함 |
| ENOSPC·state 교체 실패·저널 확정 전/후 | precommit rollback / 불명 commit 차단, 새 질문 실행 금지 |

예상 변경 파일은 store.cjs/store-worker.cjs/main.cjs, 관련 core/stability/history-identity/store-io 테스트, store benchmark, packaging 포함 목록·검증이다. 새 프로세스 파일을 만들면 ASAR unpack/import 경로를 함께 갱신한다. 완료는 각 단계의 독립 리뷰·기본 verify/build·동일 조건 실측과 명시한 실패 행렬을 모두 통과한 범위에만 부여한다.

처음 수용 범위를 startup·대화/새 대화 전환으로 한정할 수 있다. 비활성 기록 내보내기의 readHistory, 삭제·유지보수/팩 복구의 sync 저장처럼 남은 동기 소비자는 따로 목록화하고 같은 lease와 충돌하지 않는지 확인한다. 이 잔여가 있으면 “모든 읽기/저장 비동기화 완료”라고 표시하지 않는다.

## 5. ENG05 — 캐시 최종 O(N) 검사

### 원인과 선택

[prepare](../../src/cache-quota.cjs:15)는 128개마다 yield하고 호출 내 snapshot을 재사용한다. [verify](../../src/cache-quota.cjs:35)는 publish 직전 모든 기존 파일을 다시 stat한다. 이는 신규 쓰기 중 외부 파일 성장·교체를 잡는 현재 안전 계약이다. [첨부](../../src/attachments.cjs:51)와 [이미지](../../src/response-images.cjs:90)는 이어서 임시 파일 내용 확인과 no-overwrite link를 동기 수행한다.

최종 검사를 생략하거나 directory mtime만으로 재사용하는 안은 채택하지 않는다. 검사만 worker로 옮긴 뒤 main이 ACK를 기다려 link하는 안도 기존 무-await 경계를 깨므로 채택하지 않는다. 우선 측정 후, worker가 **전체 최종 검증→staging 내용 확인→publish를 한 작업으로 끝내는 안**을 비교한다. 총 O(N)은 남고 main 차단을 줄이는 선택이다.

### 세부 작업

| ID | 작업 | 완료 조건 |
|---|---|---|
| ENG05-M | 0/1,000/10,000파일 × 신규/중복 1/8개, 1×16MiB・8×≤4MiB 등 합계32MiB 내 조합, 파일→이미지→파일 | prepare/verify/hash/read/link/복사·ACK 시간, main loop·RSS·기존 파일 stat 횟수 구분. 초과 입력은 거절 회귀 |
| ENG05-A | canonical root별 main 소유 lease + worker publish 계약 | 기존 writer·worker·storage-maintenance quarantine/restore·임시 정리까지 동일 root 소유권 참여. worker마다 별도 Map을 공용 lock으로 취급하지 않음; 다른 root는 병렬 |
| ENG05-B | worker가 마지막 검증과 확정 수행, ACK 후 metadata 반영 | 임시 identity·bytes/hash·예산·기존 최종 파일 검증, EEXIST는 내용 확인 후 재사용 |
| ENG05-C | 취소·crash/timeout·ACK 유실 정산 | worker 종료 확인 전 lock 해제 금지. publish됐을 수 있는 파일 삭제/자동 재시도 금지 |
| ENG05-V | 기존 회귀+실측+ASAR 수용 | 안전성 유지, main 지연 개선과 복사/RSS 비용을 함께 채택 판단 |

원본과 미리보기는 현재처럼 순서대로 publish할 수 있다. 둘을 새 atomic pair라고 주장하지 않으며 일부 파일만 생긴 실패에서도 반환 metadata와 보존 정책을 명시한다. main은 성공 ACK 전 ready 참조를 공개하지 않는다. 알려진 파일이 이미 publish됐는지 불명인 상태는 다음 소유권 아래 전체 검증으로 재확인한다.

ACK 유실/부분 publish 뒤에는 영향 root의 observed/used snapshot과 관련 검증 metadata를 무효화한다. 원본만 publish됐으면 ready 참조를 공개하거나 파일을 자동 삭제하지 않으며, 다음 명시적 요청이 전체 디스크 검증을 거쳐 재사용 여부를 결정한다. 유지보수 UI의 busy flag만으로 worker 종료 뒤의 정리가 보장된다고 보지 않는다. 여러 root가 필요한 유지보수는 고정 획득 순서 또는 한 root씩 정산하는 계약을 정하고, 파일→이미지 경로의 기존 lock 해제/재획득을 보존한다.

회귀에는 기존 파일 성장·추가·삭제·같은 개수 교체·root/link 교체·staging 교체·512MiB 정확 경계/초과·동일 root 두 store·서로 다른 root·중복 hit 무조사와 함께 **worker 지연, publish 전/후 crash, ACK 유실, 잠금 해제 순서**를 포함한다. 이전 안전 검사를 모두 유지한 상태에서 이점이 작으면 현 구현을 유지하고 측정 결과만 남긴다.

## 6. ENG06 — 원격 페이지 저장 증폭

현재 [로컬 확장](../../src/main.cjs:876)은 최대 100개/256KiB를 먼저 표시하고, 원격 요청은 [한 번에 최대 25턴](../../src/main.cjs:1078)이다. [저장 후 cursor 확정](../../src/main.cjs:1147)을 유지한다. 40페이지 벤치는 이 저장 메커니즘의 누적 비용을 보여주며 자동 40페이지 수집을 뜻하지 않는다.

### ENG06-A: 선택안을 ADR로 고정

| 대안 | 장점 | 비용·채택 조건 |
|---|---|---|
| v2 snapshot 유지 + ENG04 CPU/복사 감소 | 파일·검색·삭제·rollback 호환 유지 | 전체 쓰기 증폭은 남음. 실제 사용 빈도/지연이 낮으면 유효한 선택 |
| 명시적 다중 페이지 가져오기 | 여러 페이지를 한 번 확정해 재쓰기 감소 가능 | 새 UX·최대 페이지/byte/시간·진행/취소 단위 필요. 기존 load-older에 자동 prefetch를 숨기지 않음 |
| immutable segment/operation log + manifest | 페이지 변경량에 비례하는 쓰기 가능 | 읽기·검색·정리·압축/이관·역변환 복잡도와 crash 단계 증가 |
| SQLite 등 저장소 전환 | 트랜잭션·색인 활용 가능성 | 별도 엔진 선택/스키마·의존성·이관 설계. 이번 계획에서 도입 확정 안 함 |

단순 debounce는 사용자에게 저장됐다고 표시한 페이지를 아직 미확정 상태로 만들 수 있어 해법으로 채택하지 않는다. v2 전체 JSON을 계속 dual-write하면 호환은 쉽지만 목표인 전체 쓰기 절감은 사라진다. ADR에 UX 유지 여부, byte/시간 목표, rollback 대상 바이너리, 허용 디스크 임시 증폭을 기록한다.

### ENG06-B/C: 포맷을 선택했을 때만 진행할 작업

**2026-10-30 ADR · 현재 후보는 v2 snapshot을 유지한다.** 40페이지 합성 쓰기 증폭은 확인됐지만 실제 사용자의 페이지 호출 빈도·기록 분포·허용 지연은 아직 없다. 이번에는 기존 포맷과 사용자 요청 1회당 페이지 범위를 유지하고, 읽기/전환 정확성 수정과 독립 계측을 먼저 적용한다. 자동 prefetch·debounce·새 DB·segment 도입은 채택하지 않는다. 이 결정은 쓰기 증폭 해결 완료가 아니다.

후속 선택은 동일 페이지 fixture에서 논리 payload/성공 write bytes/전체 시간/메모리와 오류 후 재개를 비교한다. 명시적 batch는 페이지·byte·시간·취소 UX를 정한 별도 기능이어야 한다. segment나 DB는 아래 소비자와 rollback 계약까지 구현 비용에 포함한다. 허용 기준이 없는 상태에서 합성 비율 하나만으로 저장소를 교체하지 않는다.

| 유지해야 할 계약 | v2 유지 시 | 새 포맷을 선택할 때 필요한 검증 |
|---|---|---|
| 페이지 확정 | 저장 성공 뒤 cursor 갱신 | manifest/transaction 확정 전 cursor 이동 금지 |
| 중단·재시작 | 기존 저장 저널 복구, 질문 자동 재전송 금지 | 각 commit 단계 실패·중복 페이지·기존 블록 교체 |
| 검색·내보내기 | 기존 한도·동일 history 읽기 | 같은 revision의 전체 내용·방문/byte 예산 |
| 삭제·캐시 정리 | 기존 소유 파일·참조 조사 | segment 참조 누락으로 사용 중 파일을 지우지 않음 |
| 구버전 복귀 | 기존 v2 소비자 유지 | 원본을 보존한 별도 역변환과 구버전 소비자 실행 |

1. message/turn stable ID, 페이지의 삽입·기존 block 교체, 로컬 자료/수동 metadata 보존, 중복 제거·순서를 정의한다. 현재 병합은 단순 prepend만 하지 않으므로 텍스트 append 로그만으로 대체하지 않는다.
2. segment staging→내용/소유권/hash 검증→manifest/state commit→확정 결과 채택의 실패 경계를 정의한다. orphan을 추측 삭제하지 않는다. 압축 중 read와 manifest revision의 일관성도 고정한다.
3. v2→새 포맷 변환과 **별도 staging의 완전한 v2 역변환**을 먼저 시험한다. 원본·새 포맷을 보존하고 검증 완료 후 프로필을 전환한다. 알 수 없는 version을 구버전이 거부한다는 사실만으로 안전한 rollback이라고 판단하지 않는다.
4. worker boot·v1 이관·recoverPendingSave/recoverPendingDeletion을 포함한 포맷 판별/복구, 검색 worker의 전체 32MiB byte/방문 예산, 내보내기 시점 snapshot, 삭제 소유 파일 집합, storage-maintenance의 첨부/이미지 참조 조사를 같은 논리 revision으로 전환한다. [참조 조사](../../src/storage-maintenance.cjs:15)가 segment를 놓치면 참조 중인 자료를 미참조로 판단할 수 있다.
5. cursor는 commit 성공 뒤에만 확정한다. 재시작은 opaque cursor의 영속 재사용을 가정하지 않고 기존 ID 기반 중복 제거와 처음 페이지 재조회 계약을 검토한다.

회귀는 각 페이지/manifest 확정 단계의 crash, ENOSPC, 중복/역순/ID 불일치, 과거 블록 교체, 자료 metadata 유지, 취소, 32MiB 경계, 재시작, 구형 읽기·역변환, export/search/delete/자료 정리 전 범위를 포함한다. 40페이지 원자료와 같은 fixture를 유지하고 저장 bytes·성공/실패 write 횟수·이관/재시작/압축 비용도 기록한다.

역변환 검증은 JSON 모양 대조로 끝내지 않는다. 지정한 rollback 대상 구버전 모듈/바이너리에서 프로필 재개·검색·내보내기·삭제·캐시 참조 조사까지 확인한다. 실제 앱 실행이 필요한 검사는 GUI 시간 허용 후 별도 수행한다.

예상 영향 파일은 Store/worker/main, history-search-worker, storage-maintenance, 관련 tests, docs의 저장·조회·삭제 계약, 패키징이다. ADR만 완료한 상태를 증폭 개선 완료로 표시하지 않는다. 포맷을 바꾸는 작업은 ENG04 변경과 같은 PR에 섞지 않는다.

## 7. ENG07 — 삭제 관계 조회와 시간 예산

[현재 삭제 경로](../../src/main.cjs:893)는 관계 read 동시성을 4개로 제한하고 read/delete/부재 확인에 남은 30초를 전달한다. [현재 테스트](../../test/stability.test.cjs:1246)는 12개 대화·최대 동시성·실패 정리·timeout 인수를 확인한다. 느린 connect와 실제 예산 소진, OS 시각 이동까지 검증한 결과는 아니다.

| ID | 작업 | 수용 조건 |
|---|---|---|
| ENG07-M | 접수/저장대기·connect·관계 조회·삭제·부재 확인·로컬 commit을 분리 계측 | 전체 시간과 원격 예산 시간 구분, 현재 RPC 수와 최대 동시성 보존 |
| ENG07-A | deadline 시작점과 monotonic clock 결정 | 승인 후 접수부터의 관찰 시간을 별도 기록. 연결 포함 원격 예산을 명시하고 소진 후 새 destructive RPC 0건 |
| ENG07-B | CLI bulk/list/관계 필드 조사 | pagination 완결성, 소유 필터, 미로드/삭제 상태, parent/ancestor와 cascade 의미 근거 확보 |
| ENG07-C | 동등한 소유 집합이 증명된 조회 감소만 적용 | 불확실하면 삭제 금지; 로컬 관계 캐시만 믿거나 인증 오류를 부재로 취급하지 않음 |

원격 예산에 연결을 포함하려면 CodexConnection.connect/initialize에도 남은 시간을 전달할 계약이 필요하다. 현재 timeout 인자만 확인하고 전체 연결 예산을 달성했다고 쓰지 않는다. 이미 진행한 read는 정리하고, 원격 삭제 성공 후 확인 실패는 부분 완료·저널 보존으로 정산한다. 로컬 원자적 commit 중간을 deadline 타이머로 끊지 않는다.

fixture는 소유 1/100/1,000개 × read 지연 0/10/100ms, 재사용/신규 연결, 깊은 체인·분기·순환·누락 부모·다른 문맥이다. 느린 initialize·deadline 직전/소진·벽시계 전후 이동·첫 조회 실패·늦은 응답·ID 불일치·원격 삭제 후 확인 실패를 별도 회귀로 둔다. capability가 부족하면 RPC 감소는 보류하고 예산/관측성 개선만 완료로 기록한다.

## 8. ENG08 — 기존 진단 내보내기에 bounded 집계 추가

[export-diagnostics](../../src/main.cjs:781)는 이미 존재한다. 새로 필요한 것은 원인별 횟수·시간의 제한된 메모리 집계다. 사용자가 명시적으로 export할 때만 저장하며 기본 지속 로그·외부 전송·OS 알림을 추가하지 않는다.

| 설계 요소 | 제안 계약 |
|---|---|
| 집계 | 고정 reason enum별 count·duration bucket, O(1) 갱신, overflow는 saturated/dropped로 표시 |
| 후보 상한 | reason ≤32, 최근 사건 ≤128, export 추가 JSON ≤64KiB. 구현 전 상한 확정·경계 회귀 |
| reason 예시 | storage_write_failed / storage_worker_exit / storage_worker_timeout / protocol_invalid_frame / rpc_timeout / renderer_recovered |
| 허용 값 | reason·phase·상태 enum, 시간/횟수/byte의 제한된 수치. 식별자가 필요한 경우 외부 원문에서 파생하지 않은 일시 내부 번호만 검토 |
| 제외 값 | Error.message/stack/stderr, RPC params/result, 대화/턴 ID·원문·파일명/경로·환경변수·토큰/이메일/로그인 URL. 원문의 hash도 저장하지 않음 |
| 기존 features | auth/plan/review/skills/rateLimits의 허용 key/값만 export. 무제한 객체 spread 계약으로 확장하지 않음 |

ENG08-A는 schema/enum/상한·초기화/재시작 정책, ENG08-B는 저장·연결·renderer의 사건 경계 연결, ENG08-C는 기존 export에 additive schemaVersion 호환을 반영하는 순서다. 스트리밍 delta마다 집계 전체를 직렬화·파일 저장·publish하지 않는다. 진단 자체 오류는 모델 작업·저장을 실패시키지 않는다.

회귀는 오류·설정·계정·RPC에 원문/경로/토큰 sentinel을 넣어도 export에 남지 않는지, unknown reason/객체 거부, 상한/overflow, export 취소·EEXIST·쓰기 실패·창 종료를 포함한다. 선택기는 stub으로 검증 가능하다. 계측 on/off 각 20표본에서 제어 경로와 저장 경로 오버헤드를 확인하고 채택 기준을 실행 전에 고정한다.

## 9. ENG09 — DOM 비용과 클래식 미완료 수용

대화 목록의 [historyLimit=100·formatter 재사용](../../src/ui/renderer.mjs:9)은 이미 구현돼 있다. [renderHistory](../../src/ui/renderer.mjs:168)는 signature가 달라지면 목록을 다시 만들고 preview Markdown을 해석한다. 메시지 카드의 부분 갱신과 대화 목록의 재생성 비용을 같은 것으로 다루지 않는다.

기존 performance smoke에는 최초 100/200카드 기능 검사와 별도로 warm unchanged sync 20표본이 있다. 그 반복 계측만으로 최초 전체 펼침·실제 paint·물리 입력 지연 개선을 증명하지 않는다.

| 단계 | 측정 / 확인 |
|---|---|
| ENG09-M | 대화 목록 100/1,000/5,000개와 메시지 카드 100/1,000/5,000개를 별개 fixture로 측정 |
| 최초 경로 | 첫 100개, 다음 100개, 최초 전체 펼침: DOM 수·Markdown 해석·long task·조작 가능 시점 |
| 반복 경로 | 전체 표시 후 무변경, 한 메시지 변경·stream, metadata/pin·검색/선택 전환 |
| 보존 회귀 | 메뉴 상태·키보드 포커스·scroll anchor·선택/복사·검색 anchor·숨김/복귀·draft/IME |
| ENG09-A | 병목이면 keyed row 재사용·preview 결과의 제한된 재사용부터 비교. 메모리·무효화/포커스 비용 포함 |
| ENG09-B | 가상화는 여전히 병목일 때만 별도 선택. 접근성·키보드·선택/복사·검색 이동 계약 선행 |
| ENG09-C | classic 360/400px·위/아래 배치의 삭제 확인/승인 모달: 취소 기본 focus·Tab·Esc·처리 중 제어·대비 |

main/renderer CPU·메모리, state 도착→DOM 적용·RAF 후 시간은 구분한다. 두 번의 RAF도 사용자가 실제 픽셀을 보았다는 절대 증거가 아니다. prototype 계측은 on/off 대조와 finally 복구가 필요하다. 물리 한국어 IME·선택/입력은 합성 이벤트 성공으로 대체하지 않는다.

이 단계의 실제 화면 검사는 사용자 검증 시간 허용과 `--interactive`가 모두 필요하다. 허용 전에는 fixture·계측 설계·정적 검토만 진행하고 화면 성능/클래식 수용을 미검증으로 남긴다.

## 10. ENG10 — 변경 묶음별 릴리스 게이트

| 게이트 | 작업·근거 | 구분할 한계 |
|---|---|---|
| R0 | 최신 source hash·변경 목록, verify/build·관련 실패 회귀 고정 | 이전 300개/이전 build42 성공을 새 실행으로 재기록하지 않음 |
| R1 | 격리 staging 패키지의 모듈·unpacked worker·preload·bundle·팩/스킨·고지 bytes 대조 | 새 worker 추가 시 package/verify-package 목록·unpack·실제 import 확인 필요 |
| R2 | 허용된 시간에 최신 ASAR 저장/검색/첨부·이미지·복구 실행 | require 성공은 전체 앱 기능 성공과 다름 |
| R3 | 일반 앱 설치·독립 실행·기존 프로필 보존/이관·CLI 존재/누락/변경 | 개발 checkout/ASAR 실행이 설치 검증을 대신하지 않음 |
| R4 | 물리 IME·붙여넣기/Finder drop·다중 모니터/Spaces·클래식 미완료 모달 | 자동 fixture와 실기를 따로 기록 |
| R5 | 잠금·절전·복귀·전원 전환·실행/대기/저장 중 상태 | 중단 질문 자동 재전송 금지·큐/저널 보존 |
| R6 | 지원 대상별 Windows/Intel/DPI·설치/잠금, Developer ID/공증 | Mac ARM 성공·ad-hoc 서명이 타 플랫폼/배포 신뢰를 보장하지 않음 |

기존 명령은 [빌드 가이드](../BUILD_GUIDE.md)를 따른다. 검증 도구를 실행하기 전 해당 명령이 창을 사용하는지 확인한다. `verify:package`·packaged-resource 검사도 현재 interactive launcher를 통과하므로 일반 headless 검사처럼 실행하지 않는다. 화면/알림/클립보드·선택기는 사용자 검증 시간 허용 전 실행하지 않는다.

장시간 관찰은 visible-motion/reduced-motion/quiet/daily/hidden, 같은 캐릭터·크기·전원·밝기·모델 미호출을 기준으로 상태별 최소 10분을 후보로 고정한다. 준비 구간·다른 앱 부하·예외를 기록하며 10분을 장시간 배터리 개선의 충분한 근거라고 간주하지 않는다. 기존 2초 표본은 단기 안정성 근거로 유지한다. 배터리 개선률 주장은 방전량/시간·다른 활동을 통제한 별도 실험이 필요하다.

외부 배포는 이 계획 작성으로 실행하지 않는다. 지원 플랫폼과 배포 대상별 미완료 게이트를 릴리스 기록에 명시하고, 사용자 프로필/설치본을 교체하는 동작은 구체적인 대상과 복구 방법을 확정한 별도 작업으로 진행한다.

## 11. 구현 변경 단위·독립 검토·완료 정의

실제 PR 생성이나 커밋을 이번에 수행하는 것은 아니다. 아래는 변경을 작게 검토하기 위한 제안 단위다.

| 단위 | 포함할 범위 | 분리할 범위 |
|---|---|---|
| A | ENG04-M0: benchmark 모듈 묶음·단계/fixture·원자료 규격 | 제품 병목 수정 |
| B | ENG04-A: worker protocol·직렬화·실패 수명, 기존 계약 유지 | 새 포맷·캐시 worker |
| C | ENG04-B: boot 비동기·준비/종료·복구 회귀 | 화면 구조 변경·새 대화 전환 |
| D | ENG04-C: open/new/context 전환·mutation lease·commit 정산 | dirty revision 기반 추가 생략 |
| E | ENG04-D: 측정 근거가 있는 본문 재직렬화/복사 감소 | 전역 범용 store/dispatcher 도입 |
| F | ENG05: 캐시 publish 소유권·worker·정산·패키지 | 저장 포맷 변경 |
| G | ENG06 ADR → 역변환/소비자/복구 → 새 쓰기 활성화의 순차 변경 | v2 원본 삭제·압축 자동 정리 |
| H | ENG07 예산 계약/조회 감소와 ENG08 진단을 서로 다른 변경으로 | GUI·실제 CLI capability 검증의 자동 수행 |
| I | ENG09 측정 후 채택안과 ENG10 최신 후보 수용 기록 | 미실행 환경의 완료 표시 |

각 단위에서 Architect는 계약·대안·범위를, Implementation은 최소 수정과 실패 회귀를, Reviewer는 correctness/security/concurrency·원본 보존을, SRE는 계측·오류/종료·성능·검증 한계를 독립 확인한다. 승인된 설계를 다시 구현 리뷰에서 반려할 수 있다. 제품 코드는 수정→관련 회귀→독립 리뷰→수정→verify/build→필요한 수용 순서를 통과해야 한다.

Blocker 기준은 데이터 손실/소유권 위반·불명 commit 뒤 덮어쓰기·취소/종료 불능 같은 재현된 정확성 실패다. Major는 정상 조건의 기능 실패·확정 목표의 심각한 회귀, Minor는 제한된 사용성·유지보수 결함으로 분리하고 발생 조건/영향/수정안을 기록한다. 단순 줄 수·문서상 가설을 재현된 결함으로 올리지 않는다.

새 단위가 완료될 때 변경 파일·계약·실행 명령과 exit/result·source/fixture hash·원자료·미검증 범위·rollback을 함께 남긴다. 이전 날짜의 검증 JSON/log를 수정해 새 성공처럼 만들지 않는다. 코드가 바뀌지 않은 이 계획 작업에서는 단위/GUI/패키지 검사를 새로 실행하지 않고 문서 링크와 제품 소스 hash 보존을 검증한다.

## 12. 이번 계획 작성의 검토 기록과 바로 다음 작업

4인 역할을 유지해 독립적으로 재검토했다. Architect는 ENG04의 복구 소유자·설정/위치 mutation·commit 정산을, Reviewer는 ENG05 검증/publish 경계와 ENG06 UX/역변환·소비자 영향을, SRE/Optimizer는 ENG07 deadline과 ENG08–10 계측·개인정보·실환경 수용을 확인했다. 주 에이전트는 현재 호출부·기존 근거와 대조해 작업 단위·의존성과 수용 기준을 통합했다. 이 검토는 제품 구현 승인이 아니다.

10월 27일에 정한 다음 범위는 **ENG04-M0: 현 소스·worker 묶음을 고정한 계측/fixture 보강과 단계별 기준선 확보**였다. 10월 28일 재평가에서는 M0 대표 계측과 작은 중복 제거 S1을 먼저 수행하고, 남은 비용으로 ENG04-A의 요청·복구 소유권 계약을 실제 구현할지 선택하도록 수정했다. 초기 읽기·전환·캐시·새 저장 포맷을 한 변경에 합치지 않는다. ENG05–10은 이 문서의 선행 조건과 수용 게이트를 충족한 단위부터 진행한다.

초안 독립 리뷰에서 A/B 변경 경계, worker 재생성, accepted revision, 유지보수 root lease, ACK 유실 무효화, 정상 fixture의 32MiB 합계 한도, 역변환 소비자 범위를 보완했다. Architect와 Reviewer가 반영 내용을 다시 확인해 계획 범위의 잔여 주요 문제를 발견하지 못했다. 이는 실행 가능성과 안전 계약 검토이며 제품 코드·성능·배포 승인이 아니다.

문서 경로/행 링크·제품 소스 보존의 정적 확인은 [이번 계획 검증 기록](../../artifacts/engineering-plan-2026-10-27/validation.json)에 남긴다. 이 파일은 로컬 ignored artifact이며 원래 실행 증거를 대체하지 않는다.
