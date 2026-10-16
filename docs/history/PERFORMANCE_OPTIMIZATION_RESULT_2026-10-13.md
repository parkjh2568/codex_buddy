# 성능 분석·최적화 결과

2026-10-13, `my_budy` / OnggiBot `0.1.0-alpha.20`. 기존 미커밋 작업을 시작 사본으로 보존하고 실제 코드·실제 Electron·실제 파일 I/O를 확인했다. **표시 확인의 반복 전체 저장을 배치 저장으로 바꾸고, 변경 없는 카드의 중복 계산을 제거하며, 일반 첨부 용량 검사 중 이벤트 루프를 양보했다.** 새 의존성·helper·worker·DB·저장 스키마는 도입하지 않았다.

단위 **156/156**, 실제 격리 Electron **14/14**, lint·check를 통과했다. 현재 소스와 검사 입력 63개 해시가 일치한다. 새 앱 패키지를 생성하거나 기존 설치본·실사용 기록·인증을 바꾸지 않았다. 새 `+` 메뉴·30초 전체 숨김·모서리 드래그는 [UI 후속 계획](CHAT_UI_REDESIGN_PLAN_2026-10-13.md)의 범위로 유지한다.

## 네 역할과 독립 검토

| 역할 | 수행 내용 | 독립 판단·근거 |
|---|---|---|
| Architect | 비용·책임 경계·trade-off와 채택/보류 결정 | main 객체는 변경될 수 있으므로 renderer 객체 동일성 최적화를 main에 적용하지 않음. [설계 검토](../../artifacts/performance-team-2026-10-13/architecture.json) |
| Implementation Engineer | 기존 함수 안에서 production 코드·회귀 검사 구현 | 배치 확인의 소유권/저장 실패, 첨부 검사 중 폴더 변경을 구현 단계에서 보완 |
| Reviewer | 실제 수정 코드·security·correctness·maintainability 독립 검토 | 대상 검사 15개, 별도 오류 주입 4종, 계측 fixture 경합 발견·수정 재검토. [리뷰](../../artifacts/performance-team-2026-10-13/review.json) |
| SRE/Optimizer | 시작 사본·비용 계측·반복 비교·전체 회귀·해시 대조 | 순차 벤치마크, 성공 JSON·정상 종료·프로필 정리 확인. [비교 수치](../../artifacts/performance-team-2026-10-13/comparison.json), [최종 통합 검사](../../artifacts/performance-team-2026-10-13/integration-final/integration.json) |

설계 → 구현 → 독립 리뷰 → 보완 → 최종 검증을 수행했다. 저장 대기 중 대화/표시 세대/객체 소유권 변경, 전체 배치 rollback, 첨부 검사 중 폴더 교체/목록 변경을 보완했다. 계측에서는 이전 ACK가 예약한 publish가 다음 fixture를 먼저 표시하는 경합을 발견했다. DOM에 새 ID가 존재하는 것만 기다리던 계측을 **현재 sample의 실제 reset onState 수신**을 기다리도록 수정했고 리뷰어가 독립 확인했다. 실패 기록은 제품 회귀나 성공 수치로 집계하지 않았다.

## 비용 분해와 측정 가설

대상은 실행 모듈·renderer/preload·Store/worker·첨부/응답 이미지·CLI 연결·검사/팩 경계다. 시작 파일 목록·해시는 [시작 사본](../../artifacts/performance-team-2026-10-13/baseline.json)에 있다. 이전 전체 참조·레거시 확인은 [정리 결과](LEGACY_CLEANUP_RESULT_2026-10-13.md)를 따른다. 제삼자 라이브러리 전체나 모든 OS/원격 서비스의 성능을 감사했다고 주장하지 않는다.

| 비용 | 실제 코드의 원인 | 측정 가능한 가설·판정 |
|---|---|---|
| CPU | JSON 직렬화/parse·SHA-256·IPC structured clone·Markdown/sanitize·파일 metadata 조사 | ACK마다 전체 저장하면 N×기록 바이트만큼 반복 비용이 발생. 실제 save 횟수/CPU/완료 시간을 비교해 확인 |
| 메모리 | main/worker 기록 사본·IPC 전송·DOM·decode 이미지·base64·임시 metadata 객체 | 변경 없는 card metadata 객체 생성 제거를 호출 수로 확인. RSS/heap/renderer 메모리 표본은 수집했지만 GC/캐시 변동 때문에 메모리 감소는 결론 내리지 않음 |
| I/O | 전체 history+registry+복구 journal 저장, 동기 기록 읽기, 첨부마다 전체 cache lstat | ACK 저장 횟수 축소. 첨부 검사 양보로 timer 지연은 감소하되 파일 검사 횟수는 유지 |
| 네트워크/CLI | initialize·모델 조회·turn RPC·스트림·도구·이미지 결과 | 모델 조회에는 기존 5분 TTL와 single-flight가 있음. 이 작업에서 원격 중복 요청/캐시 hit ratio·실제 모델 latency를 측정하지 않았으며 개선 수치 없음 |
| DB/저장 | SQL DB가 아니라 JSON Store+직렬 worker+journal | SQL N+1 Query는 적용되지 않음. 유사한 N회 전체 저장 fan-out은 실제로 존재해 수정. schema/index/DB 교체 근거 없음 |
| 렌더링 | 매 상태에서 카드 순회·metadata JSON·geometry 조회·이미지/관찰자·CSS | 변경 없는 N개 카드에서 geometry/metadata 호출이 N→0인지 실제 renderer에서 계측. 전체 onState 순회는 여전히 O(N) |

파일 복잡도는 기록 바이트 H, 표시 응답 N, 첨부 입력 K, cache 파일 F로 구분했다. ACK의 전체 저장은 N×O(H)에서 최대 100개씩 묶은 ceil(N/100)×O(H)로 줄었다. main은 각 배치에서 전체 메시지 ID Map을 구성하므로 메시지 수에 따른 O(M) 조회 준비 비용이 남는다. 첨부는 여전히 O(KF)이며 캐시를 도입해 외부 변경을 놓치는 방식으로 줄이지 않았다.

## 영향도 순서와 적용 결과

### 1. 표시 확인의 전체 저장 fan-out

**측정 기준:** 아직 renderedAt이 없는 과거 완료 답변을 실제 DOM에 표시하고 두 frame 뒤 확인·실제 worker 저장·파일 내용 검증이 끝날 때까지 측정. 10개/1MiB와 50개/8MiB, 각각 전후 5회.

**원인:** 이전 renderer는 답변마다 `response-rendered` IPC를 보냈고 main이 각 확인마다 전체 기록을 저장했다. 저장 worker가 있어도 복사·직렬화·journal I/O가 반복됐다.

**수정:** [renderer](../../src/ui/renderer.mjs)의 `acknowledgeRenderedMessages()`에서 최대 100개씩 보내고, [main](../../src/main.cjs)의 action 분기에서 모두 검증한 뒤 timing을 변경하고 `saveAsync()`를 한 번 호출한다. 예전 단일 payload도 유지한다.

| 조건 | 저장 횟수 전→후, 모든 반복 | 완료 p50 전→후 | 완료 p95 전→후 | main 프로세스 CPU p50 전→후 |
|---|---|---|---|---|
| 10개 / 1MiB | 10 → 1 | 108.67 → 72.04ms | 125.54 → 75.26ms | 45.32 → 7.42ms |
| 50개 / 8MiB | 50 → 1 | 1,023.43 → 103.42ms | 1,122.21 → 105.74ms | 998.23 → 32.93ms |

50개 조건의 완료 p50은 약 **89.9% 감소**했다. CPU는 `process.cpuUsage`의 user+system이며 **worker thread를 포함한 main 프로세스** 값이다. renderer/CLI CPU나 모델 추론 시간이 아니다. 완료 시간에는 sync/debounce/frame/IPC/save/poll 및 마지막 `readHistory` 검증도 포함된다.

[수정 전 5회](../../artifacts/performance-team-2026-10-13/before-ack-verified/performance/performance-ui-smoke.json), [수정 후 5회](../../artifacts/performance-team-2026-10-13/after-verified/performance/performance-ui-smoke.json).

**오류·예외:** 배치 전체 형식·중복 ID·finite 시각·대화/completedAt을 변경 전에 확인한다. 저장 대기 전후 같은 대화·messages 배열·reply/timing 객체·표시 세대·main frame을 확인한다. 숨김/다른 탭/잠금/절전/보관 작업/쓰기 차단에서는 확인하지 않는다. 이미 반영된 응답은 재저장하지 않는다. 실패 시 여전히 소유하는 timing을 모두 복구한다. renderer는 늦은 이미지·실패·대화 교체 시 자기 토큰만 해제하며 새 토큰을 지우지 않는다.

### 2. 일반 첨부 cache의 동기 metadata 조사

**측정 기준:** 실제 일반 파일 cache 100/1,000/10,000개에 작은 합성 입력 1/8개. 중복 저장 경로를 warm-up한 뒤 각각 5회 import, 1ms timer의 최대 간격, lstat 횟수와 실제 파일 내용 검증.

**원인:** 입력마다 cache 전체를 동기 lstat하여 최대 8회 연속 조사한다. 작은 입력도 cache가 크면 main 이벤트 루프를 오래 점유한다.

**수정:** [attachments.cjs](../../src/attachments.cjs)의 기존 quota loop에서 128개마다 `await setImmediate()` 후 root를 다시 검증하고 마지막 부분 구간도 확인한다. 캐시 합계를 재사용하거나 검사를 생략하지 않았다.

| 조건 | import p50 전→후 | timer 최대 간격 전→후 | cache 자식 lstat 전→후 |
|---|---|---|---|
| 실제 10,001개 / 입력 1개 | 47.51 → 54.57ms | 51.49 → 7.28ms | 10,002 → 10,002 |
| 실제 10,008개 / 입력 8개 | 381.18 → 386.87ms | 393.19 → 7.46ms | 80,072 → 80,072 |

**개선은 응답성이다. 총 처리 시간이나 I/O 횟수 감소는 아니다.** 8개 조건의 timer 최대 간격은 약 98.1% 감소했지만 import p50은 약 1.5% 늘었다. timer는 실제 syscall의 개별 시간이나 OS 전체 정지 시간을 측정하지 않는다. 이 counter는 cache 자식 검사만 세며 추가 root 검사는 포함하지 않는다.

[수정 전](../../artifacts/performance-team-2026-10-13/quota-before.json), [수정 후 순차 재검증](../../artifacts/performance-team-2026-10-13/quota-after-isolated.json), [재현 측정기](../../artifacts/performance-team-2026-10-13/quota-heartbeat.cjs).

**오류·예외:** realpath·일반 디렉터리·링크·dev/ino·mtime/ctime을 확인하며 yield 중 root 교체·링크·파일 추가/제거를 거부한다. 파일 FD/no-follow·해시·크기·배타 저장·512MiB 상한·중복 파일 경계를 유지했다. main의 `attachmentPicking`이 진입과 보관 작업을 직렬화한다. 클래스 자체의 병렬 import, 외부 프로세스의 기존 파일 내부 변경에 대한 원자적 스냅샷은 보장하지 않는다. readdir와 개별 lstat은 여전히 동기이며 느린 파일시스템의 단일 syscall 비용과 이미지 decode는 남는다.

### 3. 변경 없는 카드의 중복 계산

**측정 기준:** 실제 Electron에서 100/1,000/5,000개 짧은 고정 카드를 확장 표시한 뒤 변경 없는 sync 22회 중 첫 2회 제외. 실제 onState 뒤 elapsed와 `getClientRects`, metadata `JSON.stringify` 호출을 세었다.

**원인:** ACK 부적격 메시지에도 먼저 geometry를 조회하고, 같은 renderer message 객체여도 metadata 객체/문자열을 다시 만들었다.

**수정:** ACK role/timing/기존 확인/token 조건을 geometry보다 먼저 검사한다. renderer cache는 IPC upsert에서 객체를 교체하므로 같은 객체·측정 옵션·버디 이름이면 기존 함수에서 바로 continue한다. 새 객체지만 같은 내용이면 기존 metadata 비교 경로를 사용한다. 카드 순서·compact class·스킨·이미지 수명·scroll은 이전 경로를 유지한다. main의 제자리 변경 객체에는 이 identity 규칙을 적용하지 않았다.

| 카드 수 | geometry/metadata 각 호출 전→후 | sync p50 전→후 | sync p95 전→후 |
|---|---|---|---|
| 100 | 100 → 0 | 56.30 → 57.35ms | 61.30 → 60.00ms |
| 1,000 | 1,000 → 0 | 62.50 → 59.95ms | 65.00 → 63.70ms |
| 5,000 | 5,000 → 0 | 68.50 → 62.55ms | 70.40 → 70.70ms |

5,000개 p50은 약 8.7% 낮아졌으나 **모든 크기·percentile의 지연 개선은 확인되지 않았다.** 100개 p50과 5,000개 p95는 증가했다. 약 50ms publish debounce와 IPC/main 경로를 포함한 시간이며 renderer만의 CPU 측정이 아니다. geometry API 호출 수는 forced reflow 횟수와 같지 않다. 전체 DOM·state 순회 O(N)은 남는다.

[최종 동일 측정기·수정 전](../../artifacts/performance-team-2026-10-13/before-renderer-verified/performance/performance-ui-smoke.json), [수정 후](../../artifacts/performance-team-2026-10-13/after-verified/performance/performance-ui-smoke.json).

## 실제 수정 코드의 핵심

전체 예외/소유권 조건은 링크한 원본 코드와 시작 사본 대비 diff에 있다. 아래는 실제 코드에서 핵심 구간만 발췌한 것으로 전체 함수 대체 코드가 아니다.

```js
// src/ui/renderer.mjs — 순서/compact 처리를 마친 뒤
if (card.renderedMessage===message&&card.renderedMeasure===state.settings.measureResponseTime&&card.renderedBuddyName===buddyName) continue;
const metadata=JSON.stringify({...message,text:undefined});
card.renderedMessage=message;
```

```js
// src/main.cjs — 검증·변경 후 한 번 저장, 실패 복구
if(!changed.length)return{ok:true};
try{await store.saveAsync();}catch(error){for(const target of changed)if(target.reply.timing===target.timing)target.reply.timing=target.previous;publish(true);throw error;}
publish(true);return{ok:true};
```

```js
// src/attachments.cjs — 기존 quota 순회 안
if(++checked%128===0){
  await setImmediate();
  const current=fs.lstatSync(this.root);
  if(!current.isDirectory()||current.isSymbolicLink()||fs.realpathSync(this.root)!==this.root||['dev','ino','mtimeMs','ctimeMs'].some(key=>current[key]!==rootBefore[key]))throw Error('첨부 폴더가 변경됐어요. 다시 첨부해주세요.');
}
```

메시지 동일성 설명 주석은 최적화 안전 조건을 기록하므로 유지한다. 작업 완료 TODO나 임시 해결 주석을 추가하지 않았다. 단순 조건/반복은 함수 안에 두었고 범용 helper·과분리·별도 캐시 계층을 추가하지 않았다.

## 남은 병목과 다음 측정 기준

| 우선순위 | 확인된 비용·trade-off | 다음 작업 전 필요한 기준 |
|---|---|---|
| 1 | 전체 기록 저장의 structured clone·직렬화·journal은 O(H). 최종 30MiB 표본 saveAsync p50 60.73ms, postMessage 9.99ms | 실제 streaming/save 횟수·동일 기록 바이트·event-loop p95를 반복 계측. delta 저장/worker 경계 변경은 동기 save·저널/복구·실패 소유권 검증을 먼저 설계 |
| 2 | 동기 history read/parse·본문 검색. 최종 30MiB read p50 14.46ms, 검색 IPC p50 15.62ms | 기존 검색 최대 100파일·32MiB 정책을 유지한 다파일 합계/중단 지연 측정. worker 도입 시 경로·no-follow·UTF-8·바이트 한도·기록 검증 보존 |
| 3 | 일반 첨부 O(KF), 응답 이미지 quota/hash/decode·preview·export 비용 | 실제 사용자 파일 분포/원본·preview 캐시 hit와 개별 syscall latency, decode 메모리 확인. 외부 변경·보관/복원 때문에 무검증 quota cache는 보류 |
| 4 | renderer/main 상태 순회·metadata·DOM/관찰자, 큰 기록의 메모리 | 50ms debounce와 renderer 순수 비용을 별도 측정, GC/DOM/이미지 메모리 profile. 무조건적인 virtualization/모듈 재분리는 보류 |
| 5 | 모델 목록 dedup의 `.some()` 반복 O(M²), 원격 조회 cache miss | 모델 상한 200·기존 TTL/single-flight 때문에 현재 측정 병목보다 낮음. 요청 수·cache hit/miss·원격 RTT 근거 후 변경 |

저장/검색 표본은 잔여 비용의 관측이며 해당 코드를 이번에 최적화했다는 뜻이 아니다. CLI 프레임 parsing·요청/timeout·FIFO는 기존 경계를 유지한다. 보이지 않는 모델/DB N+1·중복 네트워크 요청을 확인했다고 쓰지 않는다.

메모리 표본의 예로 최종 5,000개 측정 전후 main RSS는 약 221.1→225.8MiB, heapUsed는 약 23.7→10.9MiB로 움직였고 renderer working set은 약 354.5MiB였다. 서로 다른 프로세스/GC 시점의 표본이므로 leak 부재·전체 peak 감소·최적화 전후 메모리 절감률은 판정하지 않았다. worker 복사·base64·decode 이미지의 retained memory는 별도 profile 과제다.

## 검증·재현·한계

환경: macOS arm64, Node `v24.21.0`, Electron `44.5.1`. 합성 데이터·격리 프로필·테스트 CLI를 사용했다. 실제 유료 모델/원격 네트워크 호출·로그인·사용자 기록 조작은 하지 않았다. 실기 OS 알림/배터리/다른 플랫폼의 새 수용 결과도 아니다.

p50은 median, p95는 nearest-rank `ceil(0.95*n)-1`이다. ACK/첨부 5회 p95는 최대값이므로 안정적 population p95로 일반화하지 않는다. renderer는 20회 warm sample이다. cold startup·OS peak memory·서비스 부하 분포·통계적 유의성은 평가하지 않았다. 성공 여부는 결과 JSON만으로 판단하지 않고 프로세스 exit0와 성공 프로필 정리를 함께 확인했다.

재현 명령은 프로젝트 루트에서 실행한다. `ONGGI_SMOKE_ROOT`는 새 격리 결과 폴더로 지정하며 Electron 실행에는 데스크톱 세션이 필요하다. 성능 비교 시 다른 벤치마크·전체 테스트와 동시에 실행하지 않는다.

```sh
npm run lint
npm test
npm run check
ONGGI_RENDERER_COST_REVIEW=1 ONGGI_ACK_COST_REVIEW=1 ONGGI_PERFORMANCE_DETAIL=1 \
  ONGGI_SMOKE_ROOT=/tmp/my-budy-performance-new npm run build
ONGGI_RENDERER_COST_REVIEW=1 ONGGI_ACK_COST_REVIEW=1 ONGGI_PERFORMANCE_DETAIL=1 \
  ONGGI_SMOKE_ROOT=/tmp/my-budy-performance-new node scripts/integration-smoke.cjs performance
ONGGI_SMOKE_ROOT=/tmp/my-budy-integration-new npm run smoke:integration
ONGGI_QUOTA_RESULT_NAME=quota-local-repeat.json \
  node artifacts/performance-team-2026-10-13/quota-heartbeat.cjs
```

최적화 전 비교는 보존된 `baseline-app`에서 같은 최종 측정기·의존성을 사용했다. 실행 cwd에 충돌한 `baseline-app.json`을 별도 manifest 이름으로 바꾸었으며 원본 production 사본은 수정하지 않았다. 초기 renderer reset/structured clone/메모리 API 오류와 ACK fixture 경합·잘못된 첨부 결과 접근을 고친 실패 이력을 보존했다. 겹친 실행인 `quota-after.json`/`ack-before-repeated`는 [제외 기록](../../artifacts/performance-team-2026-10-13/overlapping-measurements.json)에 명시하고 순차 최종 실행으로 대체했다. 실패 프로필은 성공 정리 대상이라고 표시하지 않는다.

최종 증거:

- [단위 156개](../../artifacts/performance-team-2026-10-13/test-final.log), [lint](../../artifacts/performance-team-2026-10-13/lint-final.log), [정적·팩 검사](../../artifacts/performance-team-2026-10-13/check-final.log).
- [Electron 14종](../../artifacts/performance-team-2026-10-13/integration-final/integration.json): expansion·attachments·connection-images·assets·models·history·timing·delete·performance·buddy·floating·stability·lifecycle·zero-pack 모두 정상 종료/성공/프로필 정리.
- [안전 회귀](../../test/stability.test.cjs), [첨부 회귀](../../test/attachments.test.cjs): 205개 배치 100/100/5, 늦은 이미지/새 token, 혼합 invalid batch, 재확인 save0, 실제 worker/restart, 저장 실패 전체 rollback/retry, 소유권 변경 15종, root 교체/링크/목록 변경/late child link, 512MiB 경계, yield heartbeat와 내용 보존.
- [최종 비교](../../artifacts/performance-team-2026-10-13/comparison.json), [소스·검증 대조](../../artifacts/performance-team-2026-10-13/final-verification.json), [시작 대비 실제 코드 diff](../../artifacts/performance-team-2026-10-13/source-diff.patch).
