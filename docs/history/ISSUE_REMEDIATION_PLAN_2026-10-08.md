# 옹기봇 코드 검토 이슈 수정 계획

2026-10-08 KST. 대상은 alpha.11/build26의 현재 작업 폴더다. [전체 코드 검토 보고서](FULL_CODE_REVIEW_2026-10-08.md)의 재현 9건과 추가 확인 대상, 구조·성능·문서 개선을 실제 작업 단위로 구체화했다. 이번에는 관련 구현과 재현 결과를 다시 읽고 계획을 작성했다. 제품 코드 수정, 새 테스트 실행, 모델 호출, 패키징과 앱 교체는 수행하지 않았다.

계획 작성 전 이전 inventory의 119개 파일 해시를 비교했고 변경은 없었다. 기존 구문·린트·58개 테스트 통과는 앞선 검토 시점의 결과다. 이번 계획의 수용 테스트는 앞으로 실행할 항목이며 통과한 검사로 표기하지 않는다.

작업은 **팩 정적 보호 → 턴 식별자 → 질문 접수와 중단 → 저장·삭제 범위 → 개인화 → 화면 복구 → 추가 오류 경계 → 정리·문서 → 측정 기반 최적화 → 최종 전달 검증** 순서로 한다. 기존 모듈 경계와 인라인 작성 규칙을 유지한다. 구조를 크게 바꾸기보다 잘못된 상태 전이와 검증 불일치를 먼저 고치는 것이 목적이다.

## 작업 범위와 유지할 계약

- 단일 실행과 최대 10개 대기를 유지한다. 저장 전 접수 예약도 실행되지 않은 대기량으로 계산한다.
- 질문별 모델·추론·서비스 속도·캐릭터·말투 지시문·이름을 고정한다. 이후 설정 변경이 이전 질문을 다시 해석하지 않는다.
- 중단 신호와 승인 응답은 진행 중 저장에 불필요하게 묶지 않는다. 최종 메시지와 저장 순서는 기존 직렬 경계를 유지한다.
- 종료·절전·연결 실패·화면 복구 뒤 모델 질문을 자동 재전송하지 않는다. CLI 전송 여부가 불확실하면 중단 상태와 이유를 남긴다.
- 저장된 대화·사용자 MD·등록부·팩 archive를 보존한다. 불확실한 소유권·경로·복구 상태는 자동 삭제/덮어쓰기로 해결하지 않는다.
- 캐릭터 팩은 선언형 데이터다. 장식 움직임은 앱이 제어하는 v2 프레임 또는 본체 CSS로만 실행한다.
- 기본 Luna/high·사용자 모델·읽기 전용·승인 정책·인증 저장소·캐릭터 크기/앵커를 그대로 존중한다.
- 단순 검증·대입·조건·rollback은 기존 함수 안에 쓴다. 새 generic dispatcher, 큐 프레임워크, SVG/CSS 엔진, DB와 런타임 의존성을 기본 해법으로 추가하지 않는다.

Slack/FIFO·음성·장기 기억·배회·다중 버디·외부 배포 인증 마법사는 이번 이슈 수정 범위에 넣지 않는다. 기존 후속 작업은 계속 별도 관리한다.

## 근거의 강도와 우선순위

| 대상 | 확인 수준 | 구현에 주는 의미 |
|---|---|---|
| F06 SVG 자동 재생 | 로더·실제 decoder 수용, Electron 픽셀 변화 | 보호 경계 수정부터 착수할 근거가 충분함 |
| F02 접수 한도 | 현재 main VM과 실제 저장 워커에서 12개 대기 | 접수 예약·저장 확정·FIFO를 함께 수정해야 함 |
| F09 중단 지연 | 저장 Promise를 보류하면 interrupt 미전송 | 취소의 제어 동작과 저장 완료를 분리해야 함 |
| F04 취소 대상 소실 | 로컬 JSONL에서 다른 턴 완료 후 active=null | 연결 계층도 thread/turn 식별자를 보존해야 함 |
| F01 이름 검증 | API가 받아 저장한 비BMP 이름이 재로드에서 오류 | 생성·로드·복구·폼에 같은 문자 기준 필요. 현재 maxlength의 직접 입력 제한과 구분 |
| F05 재가져오기 충돌 | clone→편집 export→동일 개인화 경로 재로드 오류 | 같은 ID의 사용자 소유권·중복 집계를 정의해야 함 |
| F03 안내 클릭 캐시 | 메인 무효화 흐름·notice VM의 재등록 누락 | pet-only 생존 조건과 실제 OS 클릭까지 후속 검증 필요 |
| F07 Store 링크 | 임시 state.tmp 링크를 따라 별도 파일에 씀 | 기존 링크/복구 파일 경계 보호 필요. 원격 exploit이나 권한 상승으로 설명하지 않음 |
| F08 삭제 문맥 | 다른 workspace에 같은 thread ID인 상태에서 두 로컬 대화 삭제 | 복사/중복 ID 조건을 보존하는 범위 검증 필요. 정상 UUID 충돌 빈도는 추정하지 않음 |
| 기타 오류·성능 | 정적 흐름·미측정 후보 | 재현 또는 측정 후 필요한 수정만 확정 |

위험도는 구현 순서에 반영하되 F03의 네이티브 클릭, F07의 동시 로컬 파일 교체, Windows·실절전의 미확인 범위를 완료로 바꾸지 않는다.

## 작업 묶음과 의존 관계

| ID | 작업 | 대상 | 선행 조건 | 완료 판정 |
|---|---|---|---|---|
| W00 | 구현 직전 기준 고정 | source hash·재현·테스트·프로필 | 없음 | 기준과 수정 전 실패/정상 비교 확보 |
| W01 | 정적 SVG 보호 | F06 | W00 | 자동 재생 입력 거절·기본 팩/프레임 유지 |
| W02 | 턴 식별자·취소 대상 | F04 | W00 | 늦은/다른 턴이 현재 interrupt 대상을 바꾸지 않음 |
| W03 | 접수 예약·즉시 중단 | F02/F09·준비 중 상태 변화 | W02 | 한도/FIFO·제출·중단·저장 경쟁 수용 |
| W04 | 저장 경로·삭제 범위 | F07/F08 | W00, 통합 검증은 W03 | 링크 원본 보존·같은 연결 문맥만 정리 |
| W05 | 말투 이름·팩 재가져오기 | F01/F05·손상 항목 종류 | W01/W04 | 동일 프로필·새 프로필 왕복과 사용자 MD 보존 |
| W06 | 안내 클릭 영역 복구 | F03 | W00, 통합 검증은 W03 | 세대/ACK 일치·pet/notice 복구 후 클릭 유지 |
| W07 | 승인·기록·작은 오류 | 추가 확인 대상 | W02–W06 | 재현 확정 항목의 정상/실패 양쪽 검사 |
| W08 | 코드·주석·문서 정리 | 인라인·데드 계산·현재 안내 | 관련 동작 수정 후 | 기능/스타일 회귀 없이 현재 계약 명확화 |
| W09 | 성능 측정과 선택적 개선 | 긴 기록·스트림·숨김·팩 수 | W03–W08 | 동일 조건 원자료와 기능 무회귀 |
| W10 | 통합·staging·전달 | source/worker/bundle·플랫폼 | W01–W08, 성능 변경 시 W09 | 검증 범위와 미검증을 분리해 최종 기록 |

실행은 위 순서를 따른다. 각 묶음은 관련 회귀를 먼저 통과한 뒤 다음으로 넘어간다. W01·W02·W04·W06에 별도 책임이 있다는 이유로 같은 main/Store 파일을 여러 작업자가 동시에 변경하는 운영을 요구하지 않는다. 본 계획에는 병렬 에이전트 작업을 추가하지 않는다.

## W00 구현 직전 기준 고정

현재 변경이 많은 작업 폴더이므로 HEAD diff만 기준으로 삼지 않는다. tracked/untracked 소스·규격·템플릿의 현재 hash를 기록하고, 해당 작업 범위만 수정한다. 기존 변경을 reset하거나 기존 테스트 프로필을 일괄 삭제하지 않는다.

기존 `artifacts/review-2026-10-08/`는 수정 전 관찰 자료로 보존한다. `reproduce.cjs`는 결함이 존재하는 것을 assertion하는 관찰 스크립트다. 수정 후 실행 실패를 새 기능 실패로 해석하거나, 파일을 수정해 과거 증거를 바꾸지 않는다. 필요한 시나리오를 기존 test 파일/fixture에 **수정된 결과를 요구하는 회귀 테스트**로 옮긴다.

구현 시작 시 기존 check/lint/test를 한 번 실행해 시작 상태를 고정하고 새 결과 디렉터리에 저장한다. 문서 계획만 작성한 이번에는 같은 검사를 다시 실행하지 않았다. 실패 주입·삭제·이미지 실험은 새 임시 프로필에서 진행한다. 실제 앱 데이터는 실패 fixture로 사용하지 않는다.

**산출물:** 기준 source hash, 검사 로그, 재현 ID→회귀 테스트 매핑, 격리 프로필 위치·정리 범위. 새 test 개수는 실행 결과가 나온 뒤 기록한다.

## W01 SVG의 정적 표현 정책

**수정 위치:** `src/packs.cjs`의 SVG 사전 검사, `src/asset-validator.cjs`의 SVG DOM 검증, `src/main.cjs`의 preview/startup/export 경로, `test/buddy.test.cjs`, `scripts/asset-validation-smoke.cjs`, `docs/CHARACTER_PACKS.md`.

첫 수정 정책은 **SVG의 style 요소와 style 속성을 허용하지 않고, 단순 도형의 presentation attribute를 유지**하는 것이다. animation 문자열만 찾아 거절하는 방식은 CSS escape·표현 변형·정적 스타일과 실행 정책의 경계를 계속 복잡하게 만든다. 현재 기본 팩은 style 요소 없이 표현되므로 이 선택이 가장 작고 검증 가능하다. 기존 사용자 팩의 정적 inline CSS도 거절될 수 있다는 호환 영향을 명시한다.

로더의 텍스트 검사는 빠른 사전 거절로 사용한다. 실제 XML 의미 검증은 기존 sandbox DOMParser 경계에서 root namespace/localName과 전체 요소/속성을 확인한다. style·script·foreignObject·SMIL 등의 제한을 namespace/localName 기준으로 검사하고, event·참조·외부 자원 속성도 다룬다. XML entity/대소문자/접두사가 단순 텍스트 검사에서 달라져도 의미 검증에서 빠져나가지 않아야 한다. 브라우저 파서 전에 기존 DOCTYPE/ENTITY와 바이트/크기 한도를 유지한다.

정적 스타일을 자동으로 SVG에 다시 써 주거나 pack 원본을 변환하지 않는다. 오류는 기존 캐릭터를 유지하고, presentation attribute 또는 PNG/WebP로 정적으로 내보내라는 짧은 안내를 제공한다. v2의 공통 캔버스·피벗·frame duration·loop는 그대로 유지한다. 캐릭터 움직임을 위해 SVG 내부 CSS를 허용하는 예외는 만들지 않는다.

새 DOM 검사가 startup/preview만 보호하지 않도록 실제 자산이 사용되는 경로를 점검한다. 특히 pack-export는 현재 root를 `loadPack`으로 다시 읽으므로, 변경된 파일을 내보낼 때도 동일한 정적 검증을 거쳐야 한다. 검증은 원본 bytes/revision을 기준으로 하고 manifest의 자기 주장 필드를 신뢰하지 않는다. PackLibrary의 sync change를 비동기 decoder로 바꾸는 대신 이미 비동기인 메인 경로에서 검증 후 확정한다. Node만 사용하는 check와 실제 DOM/decode 검사의 보장 범위를 문서에서 구분한다.

**순서:** 악성/정상 fixture → 로더 사전 검사 → DOM 의미 검사 → export 등 호출 경로 대조 → 기존 팩/v2 회귀 → 규격 갱신.

**수용 기준:**

- `<style>`, style animation/transition, escaped CSS, SMIL, namespace 변형이 설치·업데이트·활성화 경계를 통과하지 않는다.
- 기본 3팩과 정상 정적 SVG/PNG/WebP, APNG/WebP poster, v1/v2 fallback은 유지된다.
- 후보 거절/timeout/crash에서 선택·대화·MD·원본/기존 팩을 변경하지 않는다.
- reduced-motion/정숙/숨김 조건에서 내부 이미지가 자동 변화하지 않는다. 과거 공격 SVG 픽셀 재생과 수정 후 거절을 같은 fixture로 확인한다.
- export 전 root 수정·복구 archive·앱 재시작에서도 검증을 우회하지 않는다.

**되돌림:** 제품 코드만 이전으로 되돌릴 수 있지만 내부 CSS 팩의 보호도 함께 약해진다. 거절된 사용자 원본은 그대로 남겨 수동 정적 변환이 가능하게 한다. 사용자의 팩을 소급 삭제하거나 재생성하지 않는다.

## W02 연결의 턴 식별자와 취소 대상

**수정 위치:** `src/codex.cjs`의 turn 이벤트/request/interrupt, `src/main.cjs`의 runQueue·notification·cancel, `test/core.test.cjs`, `test/stability.test.cjs`, `test/fixtures/protocol-codex.cjs`.

최소 수정은 완료 이벤트의 threadId/turnId가 현재 active와 일치할 때만 해제하는 것이다. 여기에 메인이 **중단할 job의 실제 thread/turn을 명시해 interrupt하는 경로**를 연결한다. 전역 active 하나만 읽는 방식은 다른 대화의 알림에 영향을 받을 수 있다. 기존 메인의 필터와 연결 계층의 필터는 각자 소유 상태를 보호하므로 둘 다 필요하다.

`turn/start` 요청과 해당 응답의 ID를 기준으로 실행 대상을 연결한다. 알림이 RPC 응답보다 먼저 도착하는 순서도 fixture로 검사한다. 늦은 `turn/started`가 새 작업의 대상을 덮어쓰지 않도록 요청 문맥·응답에서 확정한 턴과 알림을 대조한다. 응답 이후 늦게 온 이전 완료는 새 active에 영향을 주지 않는다. 시작 응답과 이벤트의 필수 ID가 어긋나면 자동 재시작 대신 프로토콜 실패를 명확히 정리한다.

아직 turn ID가 없는 연결/thread 준비 단계의 취소는 cancelled 의도를 기록하고, 다음 await 경계에서 `turn/start` 전에 중단한다. 명시적 대상 없는 interrupt가 엉뚱한 현재 턴을 대신 취소하게 하지 않는다. connection 교체/stop 후 이전 child의 결과가 새 프로세스를 정리하지 않는 기존 보호도 유지한다.

**수용 기준:** 같은 thread의 이전 턴·다른 thread의 시작/완료, notification-before-RPC, RPC-before-notification, 연결 교체·중단 중 완료·중복 완료·필드 불일치. interrupt가 정확한 대상에 한 번 전달되고 pending이 끝나며 새 프로세스/대상을 보존해야 한다. 기존 5초 취소 완료 watchdog과 10분 작업 제한은 유지하고 그 시간을 신규 지연의 해법으로 늘리지 않는다.

## W03 접수 예약과 저장 중 제어 동작

**수정 위치:** `src/main.cjs`의 IPC 입구·send·cancel/respond·finishJob/runQueue·종료/절전, `src/ui/renderer.mjs`의 composer와 state 적용, `test/stability.test.cjs`, `scripts/timing-ui-smoke.cjs`, `scripts/model-ui-smoke.cjs`, `scripts/buddy-lifecycle-smoke.cjs`.

### 접수 예약과 FIFO

`queue.length + 저장 확정 전 접수 예약 수 <= 10`을 메인 불변식으로 둔다. 현재 실행 중 작업은 이 대기 수에 넣지 않는다. 실행 슬롯이 비어 있어도 모델 조회/저장 중인 질문은 아직 실행되지 않은 질문으로 보수적으로 계산한다. renderer 비활성화만으로 IPC 한도를 보장하지 않는다.

형식·소유자·접수 가능 상태를 검사한 뒤 ID와 제출 문맥을 캡처하고, 첫 await 전에 예약한다. 이름·캐릭터/말투·모델/추론/tier·workspace/CLI·대화 식별자·측정 옵션을 같은 접수 시점에 고정한다. 새 대화는 activeConversationId=null 상태도 정상 문맥이므로 첫 저장이 발급한 ID를 후속 예약에 연결해야 한다. 모든 작업에서 무조건 동일 ID 비교만 하는 방식은 첫 대화를 잘못 취소할 수 있다.

현재 IPC 공통 Store 대기는 send 분기보다 앞에 있다. send는 소유자/형식 확인과 예약을 먼저 처리하고 자기 접수 확정 경계에서 Store 저장을 기다리도록 입구 순서를 조정한다. cancel/respond의 우선 처리도 같은 소유자 검사 뒤에 둔다. 나머지 설정·전환 action의 기존 저장 대기는 유지한다. 기다린 뒤 sender/주 프레임이 종료되거나 교체됐다면 확정 전에 다시 확인한다.

접수 확정은 작은 Promise 직렬 경계로 접수 순서를 유지한다. 모델 조회를 먼저 끝낸 질문이 뒤에서 앞질러 저장/실행하지 않는다. 기존 Store 워커의 쓰기 직렬화와 **질문의 접수 순서**는 다른 계약이다. send 내부에서 캡처한 순서대로 검증→공간 확인→해당 두 메시지 추가→저장→queue 등록을 처리한다. 작업 완료를 기다리는 모델 실행 큐와 접수 확정 경계를 합치지 않는다.

개별 접수 실패는 해당 호출자에게 전달하지만 다음 접수가 기다리는 직렬 경계 자체를 영구 reject 상태로 남기지 않는다. recoverable 실패 후 다음 요청은 다시 검사하고, writeBlocked 실패 후에는 다음 예약을 실행 없이 명시적으로 거절·해제한다. unhandled rejection·남은 예약·종료를 막는 Promise가 없는지 함께 검사한다.

후속 send는 자기 확정 차례와 그때 진행 중인 Store 저장이 끝났는지 확인한다. queued/running 메시지의 예약 공간과 아직 메시지를 만들지 않은 접수를 중복 합산하지 않는다. 실패는 해당 id/replyId의 메시지만 제거하고 자신의 예약만 해제한다. `splice(-2)`처럼 마지막 두 메시지를 가정하지 않는다. 저장 저널이 확정된 뒤 실패한 경우 디스크 복구 자료를 삭제하지 않고 기존 writeBlocked·재시작 중단 표시를 유지한다.

예약·preparing은 실제 저장/등록 확정까지 유지해 그 사이 대화 전환·삭제·연결 변경이 끼어들지 않게 한다. await 뒤에는 종료·절전·삭제 pending·writeBlocked·팩 작업과 제출 문맥을 재확인한다. 예약 수와 Promise 수명은 성공/실패/취소/종료의 finally에서 정리한다. UI에 내부 예약 자료를 그대로 노출하지 않고 접수 중 상태만 표시한다.

### 같은 폼의 재진입 방지

composer submit 시작 시 플래그를 즉시 설정한다. Enter·클릭·프로그램 submit 모두 같은 플래그를 확인하고 state 갱신이 잠금을 풀지 못하게 한다. pending 동안 사용자가 작성한 새 입력은 유지한다. 성공 시 제출한 문자열이 현재 값과 같을 때만 지우는 기존 계약을 유지하고, 실패 시 원문과 다음 초안을 보존한다. 서버가 동일 문장의 정상적인 두 질문을 영구 중복으로 취급하지 않도록 텍스트 내용으로 dedup하지 않는다.

### 중단과 승인 응답

소유 창/주 프레임 검사는 저장 대기보다 앞에서 완료한다. 실행 중 cancel은 캡처한 job에 cancelled 의도를 먼저 표시하고 W02의 대상 RPC를 보낸다. 제어 신호의 전송을 기다리는 동안 새 current에 적용되지 않게 job ID를 유지한다. final 상태·측정치의 저장은 기존 Store 직렬 경계로 이어 간다.

대기 질문 취소는 queue에서 해당 job을 실행 대상에서 제외한 뒤 안전한 순서로 상태를 저장한다. 저장 실패를 성공으로 숨기지 않고, 해당 질문이 다시 실행되지 않는 메모리 정책과 재시작 상태를 명확히 기록한다. 아직 준비 중인 접수에 취소 UI를 노출한다면 예약 ID를 대상으로만 취소한다. 이번 첫 구현에서는 새 복잡한 접수 관리 화면을 추가하지 않는다.

respond도 현재 request와 job/turn이 맞는지 전송 직전 확인한다. 빠른 응답과 serverRequest/resolved의 경쟁에서 중복 응답·이미 완료된 턴에 대한 accept가 발생하지 않게 한다. 화면에서 보이는 요청을 제외한 임의 자동 승인은 추가하지 않는다.

finishJob은 해당 job의 종료 상태 확정과 저장을 한 번만 소유한다. 중복 완료/취소 watchdog/disconnected가 겹쳐도 동일 종료 Promise로 수명을 정리하고, 이전 저장 응답이 최신 중단 상태를 되돌리지 않는다. worker가 넘겨주는 등록부/snapshot과 현재 메모리 메시지가 서로 다른 시점이면 마지막 terminal 상태를 후속 저장해 일치시킨다. 저장 실패에서는 다음 실행을 계속하지 않는다.

**수용 기준:**

| 경쟁/실패 | 기대 결과 |
|---|---|
| 현재 실행 + 동시에 send 12개 | 미실행 예약/대기 합계 10 이하, 초과 접수에는 메시지·등록·실행 없음 |
| 모델 조회 완료 순서 역전 | 수락된 접수의 순서대로 queue/turn 실행 |
| 첫 대화에 여러 접수 | 하나의 소유 대화로 연결, 정상 null→발급 ID 전환 허용 |
| 중간 접수 저장 실패 | 해당 ID만 복구, 다른 질문과 초안 보존, 저널 확정 여부에 따른 writeBlocked |
| 빠른 Enter/더블클릭 | 한 submit 중복 실행 없음, 이후 같은 문장을 다시 보내는 정상 요청은 가능 |
| 저장 Promise 보류 중 cancel | 저장을 풀기 전에 정확한 interrupt가 관찰됨 |
| 저장 중 respond·완료·취소 교차 | 현재 요청에만 응답, 중복 accept/완료 저장·낡은 상태 부활 없음 |
| 준비 중 절전/종료/연결 변경 | 새 turn 자동 전송 없음, 예약 해제/중단 이유 기록 |
| 미니 입력·큐 재개·측정 ACK | 기존 제한·초안·수동 계속과 시각 측정 의미 유지 |

시간 검증은 실제 30초 기다리는 테스트보다 deferred Promise와 RPC 관찰 순서를 우선한다. 실제 긴 저장에서는 취소 전달·총 저장·최종 디스크 상태를 별도 측정한다. 메인 수신 시각이 저장 대기 뒤 기록되는 기존 측정 위치도 대조하고, 지표 의미를 바꾸면 RESPONSE_TIMING에 함께 명시한다.

## W04 저장 파일 경로와 삭제 범위

**수정 위치:** `src/store.cjs`의 constructor/read/save/saveAsync·저널·삭제, `src/store-worker.cjs`, `src/main.cjs`의 delete-conversation, `test/core.test.cjs`, `test/stability.test.cjs`, `scripts/deletion-ui-smoke.cjs`.

### 파일 경로와 임시 파일

Store의 루트와 conversations는 실제 canonical 경계를 소유하게 한다. OS의 `/tmp` 같은 상위 경로 별칭과 앱 데이터 디렉터리 자체의 링크를 구분하고, 초기 mkdir이 이미 외부 링크를 따라가는지 확인한다. 루트/하위 디렉터리 교체, state/history/저널·임시 파일의 symlink·일반 파일 여부를 읽기/복구/쓰기 전에 검사한다. 백업도 링크된 외부 원본을 무심코 읽는 경로가 없어야 한다.

고정 `.tmp` 파일에 기존 내용을 따라 쓰는 대신, **배타적 생성**으로 새 staged 파일을 준비한다. 기존 일반 `.tmp`가 남아 있으면 활성 저널을 먼저 복구하고, 저널 없는 잔여 파일은 소유 범위/일반 파일 여부를 검사하여 고유 보존 이름으로 옮긴 뒤 새 파일을 만든다. 기존 링크나 불확실한 잔여 파일은 삭제하거나 따라 쓰지 않고 쓰기를 차단한다. 저장 저널 v1과 고정 staged 경로는 가능한 한 유지하여 이 수정만으로 새 데이터 schema를 만들지 않는다.

`lstat` 후 사용 사이의 race도 고려한다. 지원되는 OS에서는 no-follow/배타 open과 파일 descriptor 기반 확인을 사용하고, 디렉터리 canonical 상태도 다시 대조한다. 지원하지 않는 플랫폼에서 같은 보장을 가진다고 문서화하지 않는다. 동일 권한의 다른 프로세스가 모든 상위 디렉터리를 악의적으로 바꾸는 상황까지 완전히 격리한 것으로 표현하지 않는다.

기존 두 파일 교체 순서와 해시/소유 검사는 유지한다. worker에도 동일 Store 구현을 적용하고 새 path guard를 main 전용으로 만들지 않는다. 오류에서 원본/저널을 보존하고 현재 메모리 복구와 writeBlocked를 일관되게 유지한다. 단순 경로 검사는 Store의 각 책임 메서드에서 작성하고 범용 파일 시스템 추상화 계층을 추가하지 않는다.

**수용 기준:** root/conversations/state/history/.tmp/save/delete journal 각각의 링크, dangling link, 경로 이탈·일반 잔여 .tmp·pre/post journal crash, EPERM·disk full·동기/worker 저장·정상 재시도. 임시 외부 대상의 bytes가 전후 동일해야 한다. packaged worker의 실제 경로도 W10에서 확인한다.

### 로컬 삭제 문맥

최종 삭제 대상은 **저장된 pendingDeletion.ids와 같은 codexPath/workspace의 검증된 소유 ID**로 제한한다. removedThreads는 그 범위 안에서 원격 결과를 대응시키는 자료이며 전체 로컬 목록을 탐색해 새 삭제 범위를 늘리는 기준이 아니다.

메인뿐 아니라 Store.completeDeletion도 입력 ID가 승인된 pending scope의 부분집합인지 검사한다. 범위 확장은 원격 삭제 전에 beginDeletion으로 기록해야 한다. 같은 thread ID라도 다른 연결 문맥이면 로컬 정리 대상에 넣지 않는다. pending 재시작에서는 기록된 범위를 사용하고 새 목록과의 소유 정보를 다시 대조한다.

`cli-deleted` 복구는 이미 인덱스만 제거되고 파일 정리가 남은 상태를 허용해야 한다. 모든 ID가 현재 목록에 반드시 존재하도록 강화하면 정상적인 부분 완료 복구가 막힌다. 저널·남은 파일의 source/id·기존 scope를 단계별로 검사한다. 잘못된 옛 저널을 조용히 범위 축소하거나 확대하지 않고 보존 후 진단한다.

**수용 기준:** 같은 ID/다른 workspace·다른 CLI, 정상 부모/자식, 부모 순서 역전·늦은 알림, 원격 실패, 이미 삭제된 세션 재확인, 인덱스 제거 후 파일 정리 실패와 재시작, 위조 scope. 다른 문맥의 파일·목록·활성 대화/CLI 연결은 그대로 남아야 한다.

## W05 개인화의 검증과 소유권

**수정 위치:** `src/personas.cjs`, `src/packs.cjs`의 persona 이름/모드 검증, `src/pack-library.cjs`의 export, `src/main.cjs`의 선택/fallback·팩 확정, `src/ui/index.html`과 `renderer.mjs`, `test/personalization.test.cjs`, `test/buddy.test.cjs`, `scripts/buddy-lifecycle-smoke.cjs`.

### 이름의 단일 기준

이름 기준은 기존 buddyName과 맞춰 **trim→NFC 정규화→Unicode 코드 포인트 1~60개·제어 문자 불허**로 한다. 생성·rename·registry load·mode-create journal·manifest persona 이름의 적용 범위를 모두 확인한다. 검증 직전과 저장 직후 서로 다른 기준을 사용하지 않는다.

폼의 UTF-16 maxlength는 60 코드 포인트를 잘라내지 않도록 조정하고, 실제 유효성은 같은 문자 기준으로 안내한다. input을 제한하려다 surrogate pair나 IME 조합을 자르지 않는다. 코드 포인트가 grapheme cluster의 화면상 한 글자와 같다는 보장은 없으므로 규격에 기준을 명시한다.

기존 잘못된 이름을 silent truncate하지 않는다. 허용한 이름의 저장/재로드는 동일하게 성공해야 하며, 외부 등록부 손상은 원본과 오류를 보존한다. `catalog()`는 MD 읽기에 실패해도 kind/ID/name/archived 같은 관리 metadata를 유지해 사용자 모드에 기본 복원 버튼이 잘못 활성화되지 않게 한다. 오류 UI가 MD 문제와 registry 문제를 구분하도록 검증한다.

**수용 기준:** ASCII/한글·NFC 분해/합성·비BMP 31/60/61개·앞뒤 공백·줄바꿈/제어 문자, clone/rename→reload·생성 journal 복구·export→loadPack. 현재 maxlength와 IPC 직접 입력을 별도 검사한다.

### 같은 팩을 다시 가져올 때의 사용자 소유권

ID를 새로 바꾸는 export 방식은 자기 모드를 중복 생성하고 선택 ID를 잃을 수 있다. 동일 ID의 MD가 같다는 이유로 registry 항목을 삭제하면 rename·archived·나중 편집이 손실된다. 첫 수정은 **기존 사용자 registry가 보유한 user-UUID의 소유권을 유지하고, 같은 ID의 제공 템플릿은 활성 목록에서 중복 집계하지 않는 방식**을 선택한다.

| 상황 | 처리 정책 |
|---|---|
| 새 프로필에 edited export 설치 | manifest 모드를 제공 템플릿으로 읽고 새 프로필의 편집 MD를 생성 |
| 원래 프로필에서 같은 user-UUID와 겹침 | 기존 사용자 metadata·MD·선택 ID 우선, 같은 ID는 한 항목으로 표시/집계 |
| 기존 사용자 모드가 archived | 제공 모드로 자동 부활시키지 않고 보관 상태 유지 |
| 기존 MD가 export 원문과 다름 | 현재 사용자 MD 보존. 과거 export로 덮어쓰지 않음 |
| MD 없음/잘못된 UTF-8·registry 변조 | 정상 재가져오기와 다른 오류로 안내. 같은 ID라는 이유로 손상 원본 덮어쓰기 금지 |
| 이름만 같고 ID가 다름 | 별도 항목. 자동 병합하지 않음 |

이 규칙은 등록부의 형식/ID/중복 검증을 느슨하게 하는 예외가 아니다. 유효한 사용자 UUID가 유효한 제공 모드와 겹치는 경우만 효과적인 목록에서 한 번 취급한다. registry 안 자체 중복·잘못된 ID·외부 변경은 계속 거절한다.

constructor·catalog·read/save/resolve·manage·총량 검사·export·활성 fallback을 같은 소유권 규칙으로 맞춘다. 보관 포함 custom 32개와 활성 8개(base 제외)는 중복 ID를 한 번 계산한다. read의 현재 제공 모드 우선 순서를 그대로 두면 kind가 잘못되므로 함께 수정한다. 사용자 소유 ID는 manifest에도 존재하더라도 default reset으로 초기화하지 못하게 한다.

현재 constructor는 registry를 읽기 전에 없는 제공 MD를 복사한다. 겹치는 user-UUID가 새 manifest에 포함된 상태에서는 누락된 사용자 파일을 이 단계에서 새 템플릿으로 채울 수 있다. registry·생성 journal의 소유 범위를 먼저 검증하고, 그 결과로 제공 템플릿을 seed할 대상을 결정하도록 순서를 맞춘다. 사용자 소유 MD의 부재/손상을 정상 첫 설치의 누락과 구분한다. 같은 효과적인 중복/총량 규칙은 mode-create 복구의 개수 검사에도 적용한다.

처음에는 디스크 modes.json·MD를 자동 변환하지 않고 효과적인 목록을 파생한다. 새 registry schema·ID 변경·대규모 마이그레이션을 피할 수 있다. 원본 제공 템플릿은 팩 snapshot에 유지하고 다음 수정이 실제 disk migration을 요구할 때 별도 저널/되돌림을 설계한다.

**수용 기준:** 원래 프로필 update·remove/reinstall·archive restore·깨끗한 프로필 설치·같은 ID 다른 MD·보관된 충돌·활성 8개 경계·registry 32개·reset 보호·현재/대기 질문 snapshot. pack 변경 실패·EPERM·종료 재시작에서 기존 사용자 MD/registry hash와 선택이 보존돼야 한다.

## W06 안내 클릭 영역 복구

**수정 위치:** `src/main.cjs`의 notice-hit·publish·renderer 수명·포인터 판정, `src/ui/notice.js`, `scripts/stability-ui-smoke.cjs`, `scripts/pet-notice-smoke.cjs`, 관련 VM 회귀.

메인이 클릭 영역을 무효화할 때 런타임 `noticeHitRevision`을 증가시키고 notice 상태에 전송하는 방식으로 계획한다. notice는 **revision + rect signature**를 캐시하고 현재 revision과 함께 영역을 등록한다. 메인은 오래된 revision의 지연 등록을 받아 현재 hit을 되살리지 않는다. registration ACK가 성공한 뒤 그 signature를 확정한다.

같은 rect로 재표시되어도 revision이 바뀌면 다시 등록한다. 실패/renderer reload에서는 캐시를 비우고 현재 상태를 재동기화한다. 숨김·drag·잠금·재로드에서 불필요한 매 프레임 IPC는 만들지 않는다. `pet` 복구와 `notice` 복구를 함께 reload하는 해법은 동작은 단순하지만 불필요한 이미지/창 수명을 바꾸므로 클릭 영역의 실제 소유자부터 맞춘다.

**수용 기준:** pet-only/notice-only/동시 renderer 종료·살아 있는 notice의 동일 rect·여러번 무효화·늦은 ACK·거절 후 retry·배율/위치 변화·드래그/잠금. inside는 안내가 받고 outside는 뒤 앱에 전달돼야 한다. `.click()` 합성 검사와 실제 `setIgnoreMouseEvents`/OS 클릭 관찰은 따로 기록한다. 원래 대화/turn과 캐릭터 move/resize 0 계약은 유지한다.

## W07 추가 오류 경계의 재현과 수정

정적 후보를 일괄 확정 결함으로 바꾸지 않는다. 아래 입력/실패를 fixture로 만들고 정상 경로와 대조한 뒤 수정한다. 해당 공개 프로토콜 필드는 앞선 검토에서 열어 확인한 [공식 App Server 계약](https://learn.chatgpt.com/docs/app-server)을 기준으로 하되, 설치 CLI의 schema와 실제 지원 범위를 함께 확인한다.

| ID | 대상과 위치 | 계획·판정 기준 |
|---|---|---|
| Q01 | networkApprovalContext, main request/renderer 승인 UI | host/protocol·요청 종류를 안전한 일반 텍스트로 표시. command가 없다는 이유로 일반 실행 승인처럼 설명하지 않음. malformed context는 모호한 accept를 제공하지 않도록 정책 검사 |
| Q02 | fileChange 미리보기 누락, main respond | itemId·현재 turn·bounded changes의 표시 가능성을 확인한 경우만 accept. 누락/truncated는 decline/cancel 유지. command 요청의 충분한 대체 preview와 구분 |
| Q03 | 잘못된 thread/read 응답, open-conversation | selected.threadId 일치와 turns/items/필수 텍스트 최소 구조 검사. 모르는 도구 유형은 안전하게 건너뛰되 잘못된 사용자/agent 텍스트는 이전 로컬 기록 보존 |
| Q04 | remote history 병합 후 저장 실패 | previous messages와 후보를 분리해 크기 확인·저장. pre-journal 실패는 이전 메모리 복구, post-journal 실패는 원본/저널과 writeBlocked 보존. UI가 실제 로컬/미저장 원격 표시를 정확히 설명 |
| Q05 | shell.openPath 반환 문자열 | 오류 문자열이면 ok:true 금지·기존 toast 경로 안내. 폴더 부재·OS 오류 fixture와 정상 열기 확인 |
| Q06 | 성공 후 pack journal 정리 실패 | 변경 성공은 유지하되 store/UI에 후처리 경고 전달. 다음 변경의 복구 필요 상태 안내, 성공한 설치를 다시 rollback하지 않음 |
| Q07 | 유효 팩 0개 | 제한된 본체 fallback을 선택하여 접근/기록 복구 경로 유지. 복구 화면에서는 없는 pack 접근·persona 선택을 막고 임시 fallback을 일반 설치 팩으로 저장하지 않음 |
| Q08 | 질문 준비 중 문맥/설정 변화 | W03의 capture·예약·await 재검사를 통해 확정. 첫 대화 ID 발급과 단순 캐릭터/이름 변경의 snapshot을 구분 |
| Q09 | 손상 persona entry의 kind | W05에서 관리 metadata를 보존. MD 오류로 사용자 rename/archive/reset 정책이 뒤집히지 않음 |
| Q10 | 실모델 smoke의 고정 cliVersion | 선택 executable의 실제 --version을 shell:false·timeout으로 읽거나 미확인으로 기록. 모델 응답 성공이 버전 확인 성공을 대신하지 않음 |

Q04는 Store.save가 active ID/index/snapshot을 일부 복구해도 messages 자체는 복구하지 않는 점을 반영한다. 기존 journal을 건드리기 전에 실패 단계가 어디인지 확정해야 한다. 같은 파일에 async 도우미를 많이 추가하기보다 기존 open-conversation의 후보/확정/실패 블록을 명확하게 작성한다.

Q07의 fallback 자산은 기존 본체 placeholder를 활용하되 preload에 임의 파일 read·새 외부 URL을 추가하지 않는다. 내장 팩 손상과 사용자 팩 한 개 실패는 다른 오류 범위이므로 후자가 앱 전체 fallback을 트리거하지 않게 한다.

**검증 묶음:** 프로토콜/승인 fixture는 core/stability와 model/timing UI, 기록/삭제는 history/deletion UI, 팩 경고/0팩은 asset/lifecycle·격리 시작, persona 종류는 personalization/UI. 실제 파일 변경 허용이나 사용자 대화 삭제로 검증하지 않는다.

## W08 인라인 정리와 문서 갱신

main action과 renderer onState를 역할 블록과 읽을 수 있는 줄바꿈으로 정리한다. 검증·확정·rollback이 같은 함수 안에서 보이게 하며 단순 필드별 helper를 만들지 않는다. W01–W07의 수정 주변부터 정리하고 unrelated 파일에 전역 formatter를 적용하지 않는다.

유지할 설명 주석은 연결 실패 귀속·늦은 삭제 알림·저장/복구 순서·클릭 영역 세대다. 실제 코드 의미가 바뀔 때 주석을 함께 맞춘다. 완료된 TODO나 주석 처리된 옛 구현은 앞선 검토에서 발견하지 못했으므로 이를 지웠다는 작업을 만들지 않는다. 디자인 문구를 줄이더라도 기능 오류 수정과 같은 완료 근거로 취급하지 않는다.

작은 정리는 `renderCharacter` 중복 호출과 숨긴 pet-bubble의 효과 없는 꼬리 계산부터 검토한다. pet-bubble.hidden은 실제 notice 상태를 관리하므로 DOM 전체를 제거하지 않는다. 명시적 상태로 전환이 필요한 경우 W06 회귀와 함께 독립 변경으로 진행한다. 두 labels 사전과 목적별 fixture 중복은 새 공유 프레임워크를 만드는 근거로 삼지 않는다.

legacy import-pack은 UI 사용이 없지만 테스트가 호출하므로 호환 범위를 먼저 확인한다. 내부 개발 호환이 필요하면 기존 action을 preview/apply와 같은 설치 확정 책임에 연결하되 필요한 트랜잭션 경계만 공유한다. 제거하면 테스트를 현재 경로로 옮기고 지원 동작 변경을 기록한다. 이 통합은 F05 소유권 수정 뒤 수행한다.

문서는 다음 위치만 현재 상태에 맞춘다. 과거 검사 수와 측정치를 현재 숫자로 일괄 치환하지 않는다.

- README: v2 전체 캔버스 blink 지원과 atlas/crop/범용 타임라인 미지원 구분, 최신 이슈 수정 결과 연결.
- BUILD_GUIDE: 배포 build/프로젝트 version·검사 개수·명령의 실제 시점, 새 프로필·기존 앱 보존 절차.
- ARCHITECTURE: worker·asset-validator·pack-library·persona의 현재 소유 경계, 접수 예약/중단·notice revision.
- CHARACTER_PACKS: 정적 SVG 제한과 호환 안내, edited export 재가져오기 소유권·모드 총량.
- CONVERSATIONS/DELETE_CONVERSATIONS/LOCAL_STABILITY/RESPONSE_TIMING: 문맥별 삭제 scope·경로 보존·취소/저장·시각 정의 변경.
- ALPHA_REPORT/PROJECT_REVIEW/BUDDY_MODES_REVIEW/FIRST_RUN_REVIEW: 현재 결과로 바로 가는 링크와 당시 기록의 범위 유지.
- TASKS: 아래 W/Q 항목의 실제 완료·미검증 상태를 갱신. planned 테스트를 완료로 옮기지 않음.

ESLint는 현재 검사와 앞서 통과한 추가 규칙의 도입 적합성을 각각 본다. 템플릿 문자열 내부 JS까지 현재 lint가 검사한다고 설명하지 않는다. CSS 동일 selector/스킨 cascade는 computed 결과와 함께 검사하며 같은 속성이 보인다는 이유로 responsive/compact 재정의를 삭제하지 않는다. 문서·공백만 바꾸는 항목에 구현을 그대로 복제한 새 테스트를 추가하지 않는다.

## W09 측정 기반 최적화

정확성 수정 후에 동일 source/runtime·프로필 크기·모션·창 표시·전원 조건을 고정한다. 작은 warm-up과 조건별 반복 표본을 수집하고 중앙값/p95·최대 이벤트 지연·표본 수·해시를 기록한다. 적은 표본의 p95를 모든 환경의 통계 보장으로 쓰지 않는다.

| 조건 | 기록할 값 | 최적화 착수 기준 |
|---|---|---|
| 대화 약 1/16/30MiB·많은 작은 메시지 | 저장 총 시간·메인 heartbeat·접수/interrupt 전달·구조화 복사 | 저장 밖 메인 비용이 반복해서 지연을 만드는지 확인 |
| 100,000자·많은 작은 delta·여러 항목 | delta CPU·문자 결합·첫 답변/완료 표시·상한 | publish 주기에서 결합하거나 job.reply 참조로 find를 줄일 실익 |
| 메시지 100/1000개와 추가 펼침 | patch bytes·metadata 계산·카드 순회·입력 이벤트 | 실제 확대 상태의 비용이 병목일 때 dirty 범위를 줄임 |
| panel 표시/숨김/미니 | 전송·DOM 갱신·재표시 복구·ACK | 숨김 중 큰 messagePatch 생략과 표시 시 reset이 손실 없이 가능한지 확인 |
| 설정/ACK·내용 동일 저장 | registryRevision·정렬/목록 전송 횟수 | 본문 저장 revision과 목록 변경을 구분할 실익이 있을 때만 변경 |
| 작은 팩 3/20개·상한 근처 테스트 팩 | startup·검증 창 수명·메모리·보유 bytes | 캐시/전체 자원 예산·검증 순서 개선 필요성 판단 |
| motion/reduced/hidden 최종 번들 | 자기 프로세스 CPU·표시 상태·10분씩 총 30분 | OS 잠금·다른 활동·전원 조건을 기록하고 배터리와 별도 해석 |

우선 후보는 delta마다 join/find의 반복, 숨김 panel의 patch 구성, 불변 목록의 revision 증가다. 메인 저장 워커의 snapshot 전체 반환을 줄이려면 이전 snapshot과 다음 저장의 dirty 판정까지 바뀌므로 측정 없이 제거하지 않는다. light pet 페이지 분리는 Markdown 번들 비용이 목표를 넘을 때만 검토한다.

성능을 고친 뒤에도 큐 순서·메시지 원문/상한·누락 없는 최종 갱신·Markdown 정제·숨김 복구·시각 ACK·선택 자산/표시가 일치해야 한다. 적은 bytes나 짧은 함수만으로 최적화 완료라고 하지 않는다. 실제 개선이 없거나 기능 비용이 더 커진 변경은 해당 묶음의 코드만 되돌린다.

## W10 통합 검사와 전달 기준

각 작업은 관련 테스트와 smoke를 먼저 실행한다. main/Store/Codex 연결·큐·종료가 바뀐 W02–W04와 W07은 최종에 check/lint/전체 Node test, build, model/history/timing/delete/performance/buddy/stability/lifecycle/asset/floating의 관련 통합 경로를 확인한다. 같은 검사를 변경 없이 반복해 시간을 쓰지 않는다. 최종 보고의 테스트 수는 실제 실행 로그에서 읽는다.

smoke:assets는 renderer 번들을 사용하지 않는 decoder 검사이고 다른 UI smoke는 npm script가 build를 먼저 실행한다. 빌드 산출물은 생성 명령으로 갱신하고 bundle을 직접 편집하지 않는다. 모든 smoke는 새 격리 프로필 또는 이전 결과를 보존한 분리 프로필을 사용한다. 여러 실행이 같은 파일을 덮어쓴 과거 자료를 새 검증의 근거로 읽지 않도록 날짜/빌드/hash를 결과에 붙인다.

실제 모델 검증은 연결/interrupt API 계약을 바꾼 경우 필요성을 판단해 최소 격리 질문으로 진행한다. 팩·이름·문서·색상만 바뀐 단계에는 모델을 호출할 이유가 없다. 실제 삭제가 필요하면 테스트가 생성한 세션의 ID/출처/작업 폴더를 대조한 범위만 사용한다. 사용자 기존 대화는 대상에 포함하지 않는다.

최종 파일 검증은 staging에 먼저 만든다. app.asar의 main/preload/renderer/validator·캐릭터·스킨·고지·projectVersion과 ASAR 밖 Store/worker를 소스와 비교한다. packaged worker의 저장/복구와 기존 v1/v2 파일 호환을 격리 데이터로 실행한다. 이후 정상 종료·전달 가능한 환경에서 실제 앱 적용을 진행하며 기존 앱/개인 데이터의 복구 범위를 보존한다. package overwrite를 곧바로 정상 실행 검증으로 표기하지 않는다.

Windows native spawn 모의 검사·EPERM 주입과 실제 Windows 잠금·DPI·Snap·IME·절전은 구분한다. Windows 환경이 없으면 Mac/공통 기능은 완료할 수 있지만 Windows 실기 완료 조건은 남겨 둔다. F03은 가능한 native 입력 조건에서 실제 click-through를 확인하고 합성 `.click()` 통과만으로 완료하지 않는다.

최신 npm audit는 앞선 외부 전송 거절 상태를 유지한다. 프로젝트 의존성 메타데이터를 npm 레지스트리로 보내는 명시적 승인 전에는 재시도하지 않으며, 이 계획 작성에 필요하지 않다. 따라서 취약점 수 0 또는 최신 의존성 보안 확인 완료를 배포 근거에 넣지 않는다.

### 최종 완료 조건

- 재현 F01–F09 각각에 수정된 기대 동작을 확인하는 회귀가 있고, 원래 관찰 자료와 구분된다.
- 접수/취소·저장·삭제 scope·개인화·UI 복구의 정상/실패/재시작이 일치한다.
- 기본 3팩·사용자 편집 MD·모델/추론/속도·대화·초안·window anchor 계약이 유지된다.
- 소스/번들/패키지/worker가 같은 버전이고 실행 결과를 가진다. 미실행 배포/플랫폼 검증은 별도 상태로 남는다.
- 주석·린트·문서의 현재 계약과 실제 결과가 일치한다. 성능 개선은 원자료로 설명하고 새 기능 수와 혼동하지 않는다.

## 범위별 되돌림과 실행 전 결정

| 결정/위험 | 이번 계획의 선택 | 변경이 필요한 경우 |
|---|---|---|
| SVG static inline CSS 호환 | 첫 수정에서 style 요소/속성 거절, 단순 attribute 유지 | 실제 사용자 정상 팩 요구가 있으면 허용 정적 속성을 제한적으로 재설계. 자동 재생 허용으로 복귀하지 않음 |
| 접수/실행 직렬화 | 접수 확정 Promise와 Store 직렬 저장, 모델 실행 큐를 구분 | 모델 조회 병렬화가 실제 필요할 때도 확정/예약/FIFO 유지 |
| 개인화 충돌 | 기존 user-UUID 소유권/MD/archived 유지, 효과적 목록에서 중복 제외 | 디스크 schema 변경이 필요하면 별도 migration journal/이전 버전 호환 계획 |
| Store 잔여 .tmp | 저널 복구 우선·일반 잔여는 보존·링크/불확실은 차단 | 디스크 공간/반복 보존 관리 요구가 생기면 명시적 정리 기능 |
| 부재·삭제 판정 | 설치 CLI의 정확한 응답과 저장 scope 기준 | CLI 버전이 바뀌면 schema/fixture부터 대조. 임의 오류를 부재로 취급하지 않음 |
| 작업 규모 | 기본 모듈 유지·수정 주변 인라인 블록 정리 | 실제 별도 책임이 생길 때만 모듈 경계 확장 |

현재 정책에 필요한 routine 결정은 위와 같이 제안해 두었다. 사용자 프로필을 삭제하거나 데이터 migration을 새로 요구하는 구현으로 범위가 커지면 구체적인 변경/복구안을 먼저 검토한다. 문서 작성 요청을 제품 구현 승인으로 간주하지 않는다.

파일 되돌림은 해당 묶음에서 수정한 부분만 대상으로 한다. 저장 저널·생성 registry·팩 archive가 있는 상태에서는 앱 코드 파일만 과거로 복사해 데이터까지 안전하게 복구됐다고 판단하지 않는다. 사용자 데이터는 해당 소유 저널의 복구 규칙을 따른다.

이번 산출물은 상세 분석과 실행 가능한 작업 계획이다. W00–W10의 구현·회귀·전달 작업은 아직 미착수다. 바로 착수할 첫 범위는 **W00 기준 고정과 W01 정적 SVG 보호**, 이어서 **W02→W03의 연결·접수·중단 묶음**이다.


2026-10-08 구현 후 상태와 계획에서 추가 발견된 초안/삭제/0팩 경계는 [수정 결과](ISSUE_REMEDIATION_RESULT_2026-10-08.md)를 따른다. 위 미착수 표현은 계획 작성 시점의 기록이다.
