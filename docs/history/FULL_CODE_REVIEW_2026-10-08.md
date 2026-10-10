# 옹기봇 전체 코드 검토 보고서

2026-10-08 KST, 프로젝트 `0.1.0-alpha.11`, 패키징 스크립트 build26의 현재 작업 폴더 기준이다. 이미 수정되거나 새로 추가된 파일도 포함해 읽었다. 이번 검토에서는 제품 소스, 기존 문서, 사용자 프로필과 실행 앱을 수정하지 않았다. 이 보고서와 별도 격리 재현 산출물만 추가했다.

기본 검사와 기존 58개 테스트는 통과했다. 그러나 저장·입력·개인화·화면 복구 경계에서 추가 재현 9건을 확인했다. 가장 먼저 처리할 것은 **SVG 안의 CSS 자동 재생을 허용하는 팩 검증 공백**이다. 함수와 모듈의 개수보다 비동기 접수의 원자성, 연결의 턴 식별자, 메인과 렌더러 캐시의 동기화가 현재 품질을 좌우한다. 과도한 단순 헬퍼 추출은 뚜렷하지 않으며, 조밀한 한 줄과 큰 콜백이 검토를 더 어렵게 하고 있다.

## 검토 범위와 판정 기준

직접 작성한 소스 17개, 개발·검증 스크립트 27개, 테스트·fixture 9개, 캐릭터 데이터 39개, 스킨 3개, 문서 16개와 루트 설정·안내 파일 8개를 대상으로 했다. 기준 목록은 119개 텍스트 파일이며 아이콘 등 바이너리 7개를 별도로 확인했다. 캐릭터 데이터는 manifest 3개, SVG 21개, 말투 MD 15개다. JS 계열 소스는 ESLint 설정까지 50개다. 전체 목록·파일 크기·줄 수·SHA-256은 `artifacts/review-2026-10-08/inventory.json`에 있다.

런타임과 테스트의 직접 작성 코드는 실제 구현을 읽고 연결 관계를 확인했다. 캐릭터 SVG는 생성 코드·XML 구조·팩 검증·실제 decode를 대조했다. `package-lock.json`은 선언·설치 버전과 등록 항목을 확인했으며, 생성 번들은 소스로부터 메모리에서 다시 빌드해 기존 파일과 비교했다. Electron 네이티브 구현과 node_modules의 모든 제삼자 코드를 전수 감사했다는 의미는 아니다. 기존 dist 앱을 다시 패키징하거나 새로 실행하여 전체 동작을 인증한 보고서도 아니다.

프로젝트 `AGENTS.md`의 다음 기준을 적용했다.

- 단순 조건·필드·동기 로직은 인라인으로 유지한다.
- 프로세스 연결, 저장, 팩의 검증·복구처럼 책임과 실패 경계가 다를 때 모듈을 분리한다.
- 팩에는 실행 코드를 허용하지 않고 실제 응답과 체험 응답을 구분한다.
- 검증 결과와 제안, 이전 빌드 기록과 현재 상태를 섞지 않는다.

Codex 프로토콜은 OpenAI Docs 스킬과 실제 열어 읽은 [공식 App Server 문서](https://learn.chatgpt.com/docs/app-server)를 대조했다. 보고서는 기존 저장소의 Markdown 문서 형식을 유지하고 `pages:write-page`의 근거·현재 상태·독자 중심 작성 기준을 적용했다. 게임 모딩·DB 모델링·새 UI 제작 스킬은 이번 코드 검토의 작업 경계와 맞지 않아 실행하지 않았다.

판정은 **재현됨**, **정적 확인**, **추가 확인 필요**, **개선 제안**으로 구분한다. P1은 다음 기능 확장 전에 처리할 보호 경계 문제, P2는 조건부 데이터·기능·예외 처리 결함, P3는 정리·가독성·문서 개선이다. 사용자 피해나 외부 공격이 발생했다는 등급이 아니다.

## 이번에 실행한 검증

| 검사 | 결과 | 의미와 범위 |
|---|---|---|
| `npm run check` | 통과 | JS 구문, 기본 팩 3개의 로더 검증 |
| `npm run lint` | 통과 | 현재 ESLint의 미정의·미사용 식별자와 CSS-tree 구문·값·블록 내부 중복 속성 |
| `npm test` | 58개 통과, 실패 0 | 기존 테스트 범위의 결과, 추가 발견 사항의 부재 증명은 아님 |
| 추가 ESLint 규칙 | 통과 | no-unreachable, no-constant-condition, no-dupe-keys, no-dupe-else-if, no-unsafe-finally, no-async-promise-executor, eqeqeq의 null 예외 포함 |
| `git diff --check` | 통과 | 기존 추적 변경의 공백 검사. 미추적 파일 전체의 스타일 검사는 아님 |
| esbuild 메모리 빌드 | 기존 번들과 일치 | `write:false`; renderer 186,788bytes, 외부 고지 536bytes 모두 동일 |
| 직접 의존성 버전 | 8개 일치 | package.json·lockfile·설치된 package.json을 대조. lockfile 등록 159개 |
| 기본 이미지 실제 decode | 3팩 모두 성공 | Electron 44.5.1 숨김 검증 창, 팩마다 7개 고유 이미지와 썸네일 |
| SVG CSS 애니메이션 | 필터·decode 통과와 실제 색상 변화 확인 | 별도 임시 팩, 10개 픽셀 표본에서 빨강/파랑이 반복 변화 |
| 추가 경계 재현 | 9개 관찰 확인 | VM의 현재 main 코드·실제 Store/PersonaLibrary/PackLibrary·로컬 protocol fixture; 수정 완료 테스트가 아님 |
| HTML ID·아이콘 구조 | 정적 참조 누락 없음, 헤더/범위 정상 | ICO 16/32/48/256px, ICNS 길이 일치, PNG 치수 확인. Windows 표시 결과는 아님 |
| 최신 `npm audit` | 미완료 | 최초 실행은 DNS 실패, 외부 조회 재시도는 자동 승인 검토가 거절. 이번 취약점 수를 0이라고 쓰지 않음 |

Node.js 24.21.0, npm 11.19.0에서 검사했다. 숨긴 Electron 실행은 제한된 실행에서 SIGABRT가 발생해 허용된 실행 경로로 수행했다. SVG 검증 스크립트의 첫 시도는 마지막 검증 창을 닫으면 앱이 종료되는 테스트 수명 때문에 실패했고, 스크립트의 `window-all-closed` 수명을 보완한 뒤 재현했다. 이를 제품 결함이나 최초 성공으로 기록하지 않는다.

이번에 실제 모델을 호출하거나 실제 대화를 삭제하지 않았다. 전체 기존 GUI smoke, 장시간 성능 측정, OS 실절전·Windows·서명/공증 검증은 새로 실행하지 않았다. 이전 문서의 통과 기록은 해당 빌드·환경의 기록으로 유지한다.

## 재현한 결함과 수정 기준

### F06 SVG 내부 CSS가 자동 재생 정책을 우회한다

**P1, 실제 Electron 재현.** 위치: `src/packs.cjs:59–62`, `src/asset-validator.cjs:19–23`, `src/ui/style.css:8,142`, `src/ui/renderer.mjs:140–160`.

로더는 script·이벤트·animate/set·외부 참조·url을 거절하지만 `<style>`과 `@keyframes`, CSS animation은 허용한다. `<style>@keyframes flash{…}rect{animation:flash 1s linear infinite}</style>`를 가진 SVG가 `loadPack`과 `AssetValidator.validate`를 통과했다. 그 이미지의 픽셀을 숨긴 Electron 창에서 160ms 간격으로 읽자 `[255,0,0,255]`와 `[0,0,255,255]`가 반복됐다. DOM 스크립트 실행이나 외부 통신 exploit을 재현한 것은 아니다.

앱의 reduced-motion CSS와 blink 타이머 정리는 외부 `<img>`와 본체의 재생 경계를 관리한다. SVG 이미지 내부의 CSS 타임라인을 제어하지 않는다. 따라서 사용자 팩이 정숙·움직임 줄이기 정책과 무관하게 자동 재생될 수 있고, 이미지 형식 검증 성공을 정적 이미지 보장으로 설명할 수 없다. 기본 제공 SVG 21개에는 해당 style 요소가 없다.

**조치:** 기존 팩에서 필요한 SVG 표현 범위를 먼저 정하고, 정적 SVG에 허용하지 않는 style/animation 경계를 검사한다. 현재 기본 팩은 단순 도형이므로 전체 CSS 엔진이나 일반 SVG 정제 프레임워크를 추가할 필요는 없다. 정적 poster로 대체할 경우에는 표시 결과와 원본 보존을 구분한다. regex 키워드 몇 개를 보태는 것으로 모든 CSS 표현을 통제했다고 주장하지 않는다.

**회귀 기준:** style 요소·style 속성의 animation/transition, SMIL, CSS 표현 변형, 정상 정적 SVG, v1/v2 폴백을 검사한다. 정숙·OS reduced-motion·잠금/숨김에서는 실제 이미지 내용이 자동 변화하지 않는지 확인한다. 근거: `svg-native.cjs`, `css-animation.svg`, `svg-native.json`.

### F02 동시 질문 접수가 대기 한도를 넘을 수 있다

**P2, 현재 main과 실제 저장 워커 재현.** 위치: `src/main.cjs:784–819`, `src/ui/renderer.mjs:562–567`.

질문은 모델 조회와 저장을 기다리며, `queue.length >= 10` 검사는 실제 `queue.push`보다 앞이다. 실행 중 작업을 유지한 채 모델 조회를 함께 기다리는 send 12개를 풀면 모두 검사 시점에 빈 대기 큐를 보고 통과한다. 실제 Store 저장을 거친 뒤 대기 큐가 12개, 디스크 메시지가 24개가 됐다. 입력 접수 수와 저장 완료 전 예약 수를 한도로 계산하지 않는다.

렌더러 submit에도 진행 중 제출을 막는 즉시 플래그가 없다. 버튼은 메인 publish를 받아 나중에 비활성화되고, Enter 핸들러는 직접 `requestSubmit()`을 호출한다. 빠른 반복 입력의 중복 접수도 따로 검사해야 한다. 단일 실행 자체가 병렬로 바뀐 것은 아니며, 확인한 문제는 접수 중복 가능성과 10개 대기 상한의 무효화다.

**조치:** 접수 예약과 성공/실패 해제를 send 내부에서 일관되게 처리해 저장 전 접수도 한도에 포함한다. 동일 제출의 재진입은 렌더러에서 즉시 막고, 메인 보호도 유지한다. 일반 이벤트마다 별도 helper나 범용 큐 프레임워크를 만들 필요는 없다.

**회귀 기준:** 9/10개 경계, 동시에 12개 접수, 느린 모델 조회·느린 저장·저장 실패, Enter 반복, 미니/전체 입력, 접수 순서와 메시지 ID별 롤백을 확인한다. 근거: `reproductions.json` F02. 재현은 실행 중 작업의 생성을 모의했고, 새 질문의 저장에는 실제 워커를 사용했다.

### F09 저장 대기가 중단 RPC보다 먼저 실행된다

**P2, 모의 저장 대기 재현.** 위치: `src/main.cjs:447–449,821–843`, `src/store.cjs:249`.

IPC 입구의 저장 대기 예외 목록에 `cancel`과 `respond`가 없다. 따라서 작업 취소를 눌러도 진행 중 저장이 풀리기 전에는 `codex.interrupt()`에 도달하지 않는다. 저장 Promise를 보류한 재현에서 interrupt 관찰값이 false였고, 저장 대기를 푼 뒤에야 true가 됐다. 저장 워커의 제한 시간은 30초이므로 느리거나 멈춘 저장에서는 취소의 전송도 그 대기에 묶일 수 있다. 실제 30초 디스크 장애를 발생시킨 결과는 아니다.

**조치:** 실행 중단 신호·승인 응답과 해당 결과의 저장 경계를 구분한다. 프로토콜 제어는 신속히 처리하면서 메시지 상태와 저장은 기존 직렬 경계를 지킨다. cancel을 allowlist에 추가하기만 하면 상태 변이·완료 이벤트와 저장 snapshot이 경쟁할 수 있으므로 함께 검증한다.

**회귀 기준:** 저장 중 interrupt 전송 시각, 완료/중단 이벤트 경쟁, 승인 해소, writeBlocked, 저장 성공/실패 후 최종 상태를 대조한다. 근거: `reproductions.json` F09.

### F04 다른 턴 완료 이벤트가 현재 취소 대상을 지운다

**P2, 로컬 JSONL fixture 재현.** 위치: `src/codex.cjs:77–78,120–121`, `src/main.cjs:240–245`.

CodexConnection은 모든 `turn/started`에서 active를 덮어쓰고 모든 `turn/completed`에서 null로 만든다. 메인의 thread/turn 필터는 이 처리보다 나중이다. 새 thread/turn 시작 뒤 다른 thread의 옛 턴 완료를 보내면 active가 null이 되고, 이후 interrupt는 RPC를 보내지 않는다. 메인 필터가 정상이어도 연결 계층의 취소 대상은 이미 사라진다.

현재 CLI에서 이 순서가 실사용 중 발생했다는 주장은 하지 않는다. 이전에 구독한 대화의 늦은 알림이나 향후 이벤트 확장을 고려할 때 연결 경계가 식별자를 유지해야 하는 이유다. 메인의 5초 중단 watchdog은 일부 상황에서 최종 연결 종료를 하더라도 즉시 올바른 turn/interrupt를 보내는 계약을 대신하지 않는다.

**조치:** 완료 이벤트는 현재 active의 threadId/turnId와 일치할 때만 해제한다. 시작 이벤트도 앱이 현재 요청한 턴과의 연결 정책을 정한다. 위치가 다른 두 단순 필터를 범용 이벤트 버스로 추상화할 필요는 없다.

**회귀 기준:** 같은 thread의 이전 턴·다른 thread의 턴·늦은 시작/완료·연결 교체·취소 중 완료를 확인한다. 근거: `reproductions.json` F04.

### F03 캐릭터 화면만 복구되면 안내 클릭 영역이 재등록되지 않을 수 있다

**P2, 메인 정적 흐름과 notice 렌더러 VM 재현.** 위치: `src/main.cjs:362–364,55–57`, `src/ui/notice.js:2,14–15`.

pet renderer 종료 시 메인은 noticeHit도 null로 지운다. 반면 살아 있는 notice renderer의 lastHit에는 기존 사각형 signature가 남는다. 안내를 다시 표시해도 크기와 위치가 같으면 notice-hit을 보내지 않는다. VM에서 최초 표시→숨김→같은 크기 재표시를 반복해 등록 호출은 1회에 머물렀다. 메인의 hit은 null인데 렌더러는 등록됐다고 기억하는 상황이다.

**영향:** notice renderer가 살아 있고 같은 사각형으로 복귀하는 조건에서 안내가 보이더라도 마우스 클릭은 통과할 수 있다. 프로그램으로 `.click()`을 호출하는 검사는 네이티브 mouse-ignore 문제를 잡지 못한다. 실제 pet만 강제 종료한 뒤 OS 클릭까지 이번에 재현한 것은 아니다.

**조치:** 메인이 무효화한 클릭 영역과 notice 캐시를 함께 재동기화하거나 영역 등록의 세대/ACK를 사용한다. UI 복구 수명에서 처리하고, 매 상태마다 같은 IPC를 무조건 반복하는 방식은 피한다.

**회귀 기준:** pet만 종료·notice만 종료·동시 종료·같은 위치 재표시·크기 변화 후 실제 inside/outside click-through를 확인한다. 근거: `reproductions.json` F03.

### F01 말투 이름의 저장 기준과 재로드 기준이 다르다

**P2, 실제 PersonaLibrary 재현.** 위치: `src/personas.cjs:23,36,77–78`, `src/ui/index.html:120` 부근의 `persona-mode-name`.

manage는 이름을 `Array.from(name.trim()).length <= 60`으로 검사한다. 재로드와 생성 저널 검사는 `name.length <= 60`으로 검사한다. 이모지 31개는 코드 포인트 31개·UTF-16 길이 62여서 생성이 성공하지만 재로드하면 해당 캐릭터의 사용자 등록부를 오류로 처리하고 custom 목록을 빈 배열로 둔다. 파일은 보존되지만 사용자는 자신의 목록을 사용할 수 없다.

현재 HTML maxlength=60은 UTF-16 기준으로 일반 사용자 입력을 더 일찍 제한한다. 따라서 이 재현은 **허용된 IPC/API 입력의 검증 불일치**이며 현재 폼에서 이모지 31개를 직접 타이핑해 저장했다는 결과는 아니다. 표시상 60자 설명과 UI의 코드 단위 제한도 함께 정리할 대상이다.

**조치:** 생성·이름 변경·저널 복구·등록부 재로드에서 같은 정규화와 글자 수 기준을 인라인으로 적용한다. 새 이름 validator helper가 반드시 필요한 변경은 아니다.

**회귀 기준:** 한글·비BMP 문자·NFC 합성·앞뒤 공백·제어 문자·경계 길이를 저장→재로드→생성 복구까지 왕복한다. 잘못된 한 항목이 목록 전체를 가릴 때의 오류 안내도 확인한다. 근거: `reproductions.json` F01.

### F05 편집 말투를 포함한 팩이 자기 등록부와 충돌한다

**P2, 실제 export·재로드 재현.** 위치: `src/pack-library.cjs:94–98`, `src/personas.cjs:36`, `src/main.cjs:684–696`.

편집 말투 내보내기는 활성 사용자 모드를 manifest.personas.modes에 추가한다. 같은 팩 ID로 다시 가져오면 기존 modes.json에 같은 user-UUID가 남아 있고, PersonaLibrary는 새 제공 모드와 기존 사용자 모드의 ID 중복을 등록부 오류로 처리한다. 실제 clone→includeEdited export→같은 개인화 경로로 reload에서 `사용자 말투 목록을 확인해주세요.`가 발생했다.

현대 팩 적용 경로는 entry.warning 때문에 업데이트를 거절한다. 원본·사용자 MD를 무조건 삭제하면 해결되는 문제가 아니다. 다른 깨끗한 프로필에 배포하는 경우와 자신의 프로필로 재가져오는 경우의 소유권/모드 종류 전환을 정의해야 한다.

**조치:** export 시 ID 보존·변환 규칙을 정하거나, 같은 내용을 가진 기존 사용자 모드와 제공 모드의 합치기/충돌 안내를 처리한다. 이름만 같다고 병합하지 않고 내용·ID·사용자 편집을 보존한다.

**회귀 기준:** 원래 프로필로 업데이트·제거 후 재설치·깨끗한 프로필로 가져오기·보관 모드·수정 MD·선택 모드·총량 한도를 확인한다. 근거: `reproductions.json` F05.

### F07 Store의 임시 경로가 기존 심볼릭 링크를 따라 쓴다

**P2, 임시 데이터 디렉터리 재현.** 위치: `src/store.cjs:20,120,128,156,166–178,209–213`.

persona·팩은 링크/정규화 경로를 검사하지만 Store의 여러 고정 `.tmp`와 저널 경로는 같은 보호를 적용하지 않는다. `state.json.tmp`를 별도 파일로 향하는 symlink로 만든 뒤 settings-only save를 실행하면 writeFileSync가 외부 파일에 state JSON을 쓴다. 이후 rename되어 프로필의 state 경로 자체에 링크가 놓일 수도 있다. 임시 폴더 밖의 사용자 파일로 이 동작을 실행하지 않았다.

전제는 로컬 데이터 폴더에 기존 링크가 있다는 것이다. 원격 코드 실행이나 권한 상승을 의미하지 않으며 일반 앱 사용에서 링크가 저절로 생기는 경로를 발견한 것은 아니다. 그러나 복구·백업·동기화 도구 또는 잘못된 로컬 파일 상태를 다루는 Store의 경로 보존 계약에는 빈틈이다.

**조치:** 루트와 conversations 디렉터리의 canonical 경계를 확인하고 staged/final/저널 파일의 링크·일반 파일 여부를 검사한다. 안전한 임시 파일 생성과 rename 순서를 기존 저널 계약에 맞춘다. 비슷한 파일 쓰기를 모두 하나의 generic helper로 묶는 것보다 Store 경계에서 같은 정책을 적용하는 것이 우선이다.

**회귀 기준:** state/history/.tmp/저널·디렉터리 링크, 기존 일반 파일, crash recovery, 경로 변조, 정상 retry, Windows 파일 잠금을 확인한다. 근거: `reproductions.json` F07.

### F08 삭제의 마지막 로컬 범위에서 연결 문맥 필터가 빠진다

**P2, 조건부 데이터 정리 결함 재현.** 위치: `src/main.cjs:495,531`, `src/store.cjs:126–129`.

파생 세션 확인은 선택 대화와 같은 codexPath/workspace를 필터링한다. 그러나 최종 deletedIds는 전체 conversations에서 threadId가 removedThreads에 있으면 추가한다. 별도 workspace의 두 소유 대화에 같은 threadId가 있는 상태를 만들고 첫 대화 삭제의 RPC를 모의하면 두 로컬 대화가 모두 삭제됐다.

필수 전제는 CLI 데이터 복사 등으로 서로 다른 문맥에 같은 thread ID가 등록되는 것이다. 정상 CLI가 새 UUID를 발급하는 일반 시나리오의 충돌 발생을 주장하지 않는다. 다만 앱이 이미 문맥별 소유 범위를 검증한다면 마지막 로컬 정리에도 동일한 범위를 유지해야 한다.

**조치:** 저장한 pendingDeletion.ids와 검증한 같은 연결 문맥의 대화 ID를 기준으로 최종 삭제 범위를 만든다. 전역 threadId 매칭으로 범위를 넓히지 않는다.

**회귀 기준:** 같은 ID/다른 workspace·다른 CLI, 부모/자식, 늦은 알림, pending 재시작·재시도에서 다른 문맥의 파일·활성 대화가 그대로 남는지 확인한다. 근거: `reproductions.json` F08. 원격 삭제는 모의이며 실제 사용자 세션은 삭제하지 않았다.

## 추가 확인 대상과 작은 오류 처리

| 항목 | 근거와 위험 | 처리 방향 |
|---|---|---|
| 네트워크 승인 내용 | `renderer.mjs:431–437`은 command/cwd/reason/changes/permissions만 표시한다. 공식 문서의 networkApprovalContext host/protocol을 표시하지 않아 대상이 모호해질 수 있다. 현재 CLI가 앱에 그 요청을 보낸 실재현은 없음 | 해당 계약을 fixture로 넣고 네트워크 대상·승인 종류를 표시. [공식 승인 설명](https://learn.chatgpt.com/docs/app-server#approvals) |
| 누락된 변경 미리보기 | `main.cjs:286,863`은 details.truncated만 막는다. fileChange details가 아예 없으면 accept를 허용할 수 있다. 공식 정상 순서는 item/started→approval이므로 손상/누락 이벤트 조건 확인 필요 | 승인별 필수 확인 내용을 정의하고 없으면 거절/취소만 허용. 정상 command 요청의 대안 preview와 구분 |
| 잘못된 thread/read 응답 | open-conversation의 `main.cjs:555–575`는 응답 thread.id 일치를 확인하지 않고 가져온 텍스트를 합친다. 조회 실패는 보존하지만 정상 JSON/잘못된 대상 응답은 별도 | 대상 ID와 turns/items의 최소 스키마를 읽기 경계에서 검사. ID 불일치에서 기존 로컬 내용을 유지 |
| 긴 remote history 저장 실패 | 위 경로는 새 messages를 메모리에 넣은 후 동기 save한다. 32MiB 초과·쓰기 실패 시 catch는 로컬 기록 표시라고 안내하지만 메모리 messages는 이전으로 복구하지 않음 | 기존 messages snapshot을 보존하고 실패 후 실제 화면·디스크가 무엇을 보여주는지 명시. GUI/실패 fixture로 확인 |
| 폴더 열기 성공 오인 | `main.cjs:761,876`은 shell.openPath의 오류 문자열을 확인하지 않고 ok:true를 반환 | 반환 오류를 안내하고 디렉터리 부재·권한·OS 연동 실패를 검사 |
| 팩 성공 경고 미전달 | `PackLibrary.change:76`은 저널 삭제 실패를 warning으로 저장해 성공 반환. main의 성공 경로는 그 warning을 store.warning으로 전달하지 않음 | 변경 자체는 성공으로 유지하되 다음 작업을 막을 잔여 저널의 정리 안내를 표시 |
| 캐릭터 기본값 전부 실패 | startup은 팩 오류를 모으지만 유효 팩이 0개면 pet-layout의 pack 접근이 실패할 수 있음 | 설치 파일 손상 조건에서 내장 placeholder/시작 오류를 의도적으로 선택하고 트레이·복구 경로 확인 |
| 질문 준비 중 상태 변경 | send는 최초 검사 후 모델 조회·저장을 기다린다. 종료·절전·팩 작업·이름 변경의 재검사와 snapshot 시점이 일치하는지 추가 확인 | 질문별 접수 시점과 저장 확정 시점의 계약을 정하고 F02/F09 회귀에 결합 |

위 항목은 관찰 수준을 재현 9건과 구분한다. 특히 App Server의 오류 문구를 부재 판정에 사용하는 삭제 경로는 버전 변화에 민감하다. 현재 공식 문서의 저장 thread 읽기와 runtime `notLoaded` 상태는 영구 삭제와 같은 의미가 아니다. 현재 사용한 정확한 오류 메시지의 의미는 설치 CLI 버전 fixture와 함께 유지하고, 임의 오류를 삭제 성공으로 확대하지 않는다. [공식 thread 읽기·삭제 계약](https://learn.chatgpt.com/docs/app-server)

## 구조와 함수 분리 판단

현재 모듈 분리는 대체로 합리적이다. `codex.cjs`는 자식 프로세스·JSONL·pending RPC, `models.cjs`는 카탈로그/기본값/호환성, `store.cjs`와 worker는 저장/복구·프로세스 수명, `packs.cjs`는 파일/자산 형식, `asset-validator.cjs`는 격리 decode, `pack-library.cjs`는 stage/archive/rollback, `personas.cjs`는 사용자 MD/등록부/복구를 맡는다. 코드 줄이 적다는 이유만으로 `skins.cjs`를 main에 합칠 필요도 없다. 고정 색상 스키마의 파일 입력 경계가 독립되어 있다.

`preload.cjs`는 context isolation 경계이고 notice 전용 페이지는 클릭 영역·권한·자원 경계다. 이 분리를 합치면 캐릭터 창을 고정한 채 안내창만 숨기는 계약과 네트워크/Node 접근 제약을 다시 검증해야 한다. 짧은 파일을 줄이는 것은 자체로 최적화 근거가 아니다.

`publish`, `runQueue`, `finishJob`, `showPanel`, `syncPetPointer`, renderer의 `renderHistory`, `renderCharacter`, `syncAnimation`, `syncPetLayout`, `acknowledgeRenderedMessages`, `act`는 반복되는 동작과 비동기/화면 수명이 있다. 단순 한 필드를 설정하기 위해 만든 과도한 helper의 대표 사례로 판정하지 않는다. animation의 advance 콜백도 타이머를 이어가는 실제 수명이다.

오히려 main 898줄, action 핸들러 약 432줄, renderer 663줄과 onState 약 262줄의 높은 밀도가 문제다. 긴 조건식·다중 대입·try/catch가 한 줄에 섞이면 rollback 대상이나 await 전후 상태 검사를 놓치기 쉽다. **기존 함수 안에서 검증→준비→확정→실패 복구 블록을 읽기 좋게 정리하는 것이 우선**이다. 범용 dispatch table, 클래스 계층, 한 줄 action helper를 추가하지 않는다.

import-pack의 기존 즉시 설치와 pack-preview/pack-apply의 새 흐름은 유사한 설치 확정 블록이 두 군데다(`main.cjs:664–670,681–699`). 현재 UI는 pack-preview를 사용하고 `import-pack` action은 기존 재현 테스트에서 사용된다. 전체를 무작정 데드코드로 지우면 테스트/기존 동작을 바꾼다. 구 경로 유지 계약을 확인한 뒤 제거하거나, 필요한 설치 확정 책임만 한 곳에서 소유하게 할 수 있다. 분리 이유는 문자열 중복 감소가 아니라 validation/commit 일관성이다.

## 성능과 과작업 검토

| 경로 | 현재 구현과 판단 | 우선 개선/검증 |
|---|---|---|
| 대화 저장 | worker로 직렬화·해시·파일 교체를 넘긴 선택은 유효. data 구조화 복사와 결과 snapshot 반환은 여전히 큰 비용 | 16/30MiB의 메인 이벤트 지연·총 저장·취소 전송을 함께 측정. worker라는 이유로 무조건 빠르다고 쓰지 않음 |
| 대화 전환·CLI 기록 | 전체 파일 읽기·remote turns 합치기·일부 save는 동기. 긴 기록에서 input/포인터와 경쟁 | 페이지 조회·파일 전체 읽기의 실제 지연을 측정하고 C09 범위와 연결 |
| 스트림 텍스트 | delta마다 이전 문자열 결합, 전체 item values.join, messages.find가 실행. 100,000자/128항목으로 메모리 총량은 제한됨 | 높은 delta 빈도의 CPU/지연 측정. 현재 job의 reply 참조와 publish 주기에서의 결합 등 필요한 인라인 최적화 검토 |
| 화면 갱신 | 변경분 upsert·카드 Map·미니 2카드·숨김 DOM 보류는 유지 가치가 큼 | 확대해 둔 많은 카드의 metadata JSON/순회가 매 갱신에 남음. 긴 기록·50ms 스트림에서 측정 |
| 숨긴 패널 | DOM은 보류하지만 메인에서 messagePatch 구성·전송·렌더러 캐시 갱신은 계속 | 숨김 중 필요한 제어 상태와 메시지 dirty 표시의 범위를 검토. 표시 시 누락·ACK·카탈로그 복구 보장 |
| 캐릭터 창 | panel과 같은 전체 HTML/186,788byte Markdown 번들을 로드하고 숨긴 panel DOM에도 이름/스킨을 갱신 | 유휴 비용이 실제 목표를 넘을 때 가벼운 pet 페이지 검토. 현재 통합이 곧 결함은 아님 |
| 저장 용량 계산 | 텍스트 JSON bytes는 WeakMap 캐시, 각 질문에서 metadata 직렬화와 전체 메시지 순회는 남음 | 많은 작은 메시지와 긴 텍스트를 분리 측정. 외부에서 읽은 임의 metadata의 상한도 검토 |
| 목록 정렬 | registryRevision 기반 캐시는 적절. saveAsync 성공은 내용이 안 바뀌어도 revision을 증가시킴 | ACK/같은 내용 저장에서도 불필요한 목록 재정렬·전송이 발생하는지 측정 |
| 팩과 말투 목록 | 선택 자산만 전송하지만 메인은 모든 팩 원본·data URL과 모든 말투를 메모리에 보유 | 팩 수/전체 decoded 자원·startup 시간 측정. 팩 하나의 24MiB 제한이 전체 라이브러리 상한은 아님 |
| 팩 startup | 각 팩마다 검증 창을 만들고 순서대로 최대 10초 기다림 | 큰 라이브러리의 시작 지연과 개별 실패 처리. 검증 생략이나 무제한 병렬 decode는 피함 |
| 자산/저널 백업 | archive·MD backup은 보존 정책이며 현재 자동 만료 없음 | 사용자에게 범위/크기를 보여주는 명시적 정리 기능. 실제 개인 파일 자동 삭제는 제안하지 않음 |
| 포인터 폴링 | 80ms 타이머는 숨김/잠금에서 빨리 반환. 정지 커서 아래 창 이동도 처리 | 실제 클릭 통과와 CPU를 함께 검사한 뒤 주기 변경. 이벤트만으로 바꿔 회귀시키지 않음 |

이 표는 새 성능 수치를 측정한 결과가 아니다. 이번에 확인한 수치는 현재 번들 크기, 파일 크기와 기능 재현 결과다. 과거 30분 CPU·짧은 blink 측정을 현재 소스의 전후 향상률로 전용하지 않는다. DB·브로커·프레임워크·런타임 교체를 지금 추가할 근거는 부족하다.

## 주석과 컨벤션

직접 작성한 코드에 실제 설명 주석은 6곳이다. `codex.cjs:101`의 연결 교체 실패 귀속, `main.cjs:333`의 창·OS 검증 제한, `main.cjs:521`의 늦은 삭제 알림, `lint-css.cjs:18`의 literal palette 해석, `style.css:1,145`의 디자인/스킨 설명이다. URL 문자열과 테스트용 HTML/Markdown은 설명 주석으로 세지 않았다.

연결 귀속·늦은 알림·CSS 값 검사 주석은 비자명한 이유가 있어 유지하는 편이 낫다. main의 macOS 주석은 현재 OS별 미검증 범위를 과장하지 않는다. CSS 첫 디자인 주석은 선언형 취향 설명이라 삭제해도 동작 이해에 영향이 작지만 잘못된 주석은 아니다. 스킨은 실행 CSS가 아니라 palette라는 주석도 현재 skins 검증과 일치한다.

TODO/FIXME/HACK/XXX나 큰 주석 처리된 옛 구현, 작업 완료 후 남은 임시 메모는 발견하지 못했다. 모든 줄에 설명을 달 필요는 없다. 대신 저장 저널 확정 순서, pack rollback의 소유 해시, worker 반환 상태와 메인 상태의 연결, UI hit 영역 무효화처럼 오류 분석에 필요한 이유를 짧게 남기는 것이 좋다. 스크립트의 성공/실패 로그는 개발 검증 출력이며 사용자 런타임 잡음으로 취급해 일괄 제거하지 않는다.

컨벤션상 CJS/ESM 분리는 Node/browser 경계로 적절하다. 함수·변수 camelCase, 파일 kebab-case, CSS class/ID kebab-case와 테스트의 기능 중심 이름은 대체로 유지된다. 다만 오래된 `const fs = require(...)`와 최근 `const fs=require(...)`, `new Error`와 `Error`, 조건식·예외를 압축한 한 줄 표현은 혼재한다. 기존 2칸 들여쓰기와 읽을 수 있는 블록으로 맞추되 자동 formatter의 전역 변경과 단순 helper 대량 추출은 피한다.

현재 ESLint는 args/caughtErrors 검사를 완화하고 스타일·일반 복잡도 규칙은 적용하지 않는다. 테스트 스크립트의 `executeJavaScript` 템플릿 문자열 안은 일반 ESLint의 JS AST 대상이 아니다. 예를 들어 `ui-layout-smoke.cjs` 안의 `buttons` 변수는 문자열 내부에서 선언 후 쓰이지 않지만 현재 lint는 그 의미를 검사하지 않는다. 이를 앱 런타임 린트 오류나 큰 메모리 결함으로 확대하지 않는다. 문자열 안 코드는 실제 UI 시나리오 또는 필요한 부분의 별도 구문/린트 검사로 보완한다.

CSS 검사도 한 Block의 중복 속성·구문·기본 literal 값 검사다. 동일 selector의 다른 Block, responsive cascade, JS 주입 토큰, 모든 스킨의 computed 값과 사용하지 않는 selector까지 확인한 것은 아니다. stylesheet 전체에서 마지막 선언된 custom property를 Map에 넣는 검사 방식은 범위별 CSS cascade를 대신하지 않는다.

## 데드코드와 통합 후보

| 대상 | 판단 |
|---|---|
| `pickerSettingsSignature`, `lastWarning` | 현재 선언·사용됨. 제거 대상 아님 |
| `#pet-bubble` | pet에서는 CSS로 안 보이지만 hidden 상태·타이머가 실제 notice 표시를 결정함. DOM 통째 삭제는 회귀 위험 |
| 숨긴 pet-bubble의 `--tail`·텍스트/접근성 갱신 | 실제 안내는 notice.js가 별도로 담당. 시각 효과가 없는 잔존 계산이며 명시적 notice 상태로 전환할 때 함께 정리 가능 |
| 두 페이지의 labels 사전 | 같은 7문구 중복. 작은 데이터 중복만으로 공유 runtime 모듈을 새로 만들 필요는 없음. 두 문구 변경의 동기화는 확인 |
| 캐릭터 renderCharacter의 중복 호출 | 카탈로그 dirty 상태에서 같은 갱신에 두 번 호출됨(`renderer:237,240`). 이미지/레이아웃 signature가 중복 부작용을 줄이지만 한 번으로 정리할 후보 |
| `import-pack` 구 IPC | 현재 UI가 직접 호출하지 않으나 stability 테스트가 사용함. 공개/호환 계약 확인 후 통합 또는 제거 |
| smoke dispatch와 테스트 helper | 개발 플래그에서만 실행하고 실제 실패 수명을 검증함. 개발 스크립트 전체는 데드코드가 아님 |
| model/delete/persona fixture | 비슷한 프로토콜 중복은 있지만 저장·삭제·지시문 목적이 다름. 범용 mock 프레임워크로 바꿀 이유는 약함 |
| 아이콘/캐릭터 생성기·번들·LICENSE | npm 명령·빌드·배포에서 사용됨. 생성 파일도 재현·배포 계약의 일부 |
| CSS cascade | 스킨·작은 화면·compact 재정의는 의도된 사용. 같은 background/color 재선언 일부는 정리 가능하나 selector 병합 전 실제 상태 검사 필요 |

현재 미사용 선언이 남아 있다는 ESLint 결과는 없다. 스타일·HTML·동적 분기까지 데드코드가 전혀 없다고 보장하지 않는다. 가장 좋은 정리 순서는 숨긴 pet-bubble의 상태 역할을 명시하고, obsolete 시각 계산을 줄이며, 구 IPC 설치 경로의 필요성을 결정하는 것이다.

## 문서 정합성

| 위치 | 현재 코드와의 차이 | 권장 갱신 |
|---|---|---|
| README:132 | 앞에서는 v2 blink 구현을 설명하지만 끝에서는 상태 이미지+공통 움직임만 지원하고 프레임 타임라인이 미지원이라고 넓게 설명 | 전체 공통 캔버스 기반 blink 프레임은 지원, atlas/crop/범용 timeline은 미지원으로 정확히 구분 |
| BUILD_GUIDE:3,178 | 현재 package buildVersion은 26인데 첫 기준은 build25. 현재 검사표의 테스트 수가 51 | 현재 기준 alpha.11/build26·58개로 갱신. 과거 빌드 수용 기록은 보존 |
| ALPHA_REPORT 마지막 | build25 현재 검증 설명과 51개가 마지막이며 build26 최신 결과 연결이 없음 | 최신 build26 보고와 이번 검토를 먼저 연결. 과거 alpha 테스트 수를 일괄 58로 덮어쓰지 않음 |
| PROJECT_REVIEW:3 | 갱신 안내는 alpha.7까지라고 쓰지만 뒤에 build25/26까지 누적됨 | 현재 결론/최신 링크를 앞에 두고 과거 검토 구간의 범위 표시 |
| ARCHITECTURE 다이어그램 | Store와 packs 중심이며 최신 decode·팩 수명·persona·worker 경계는 후반 추가 절에 있음 | 현재 소유자·입출력·worker/validator 수명을 첫 도식에 반영 |
| BUDDY_MODES_REVIEW | 409줄에 조사→계획→구현이 누적. 당시 미착수 설명은 현재와 구분되어 있음 | 상단에 현재 구현·잔여 검증으로 바로 가는 링크 추가. 설계 제안을 새 완료 상태로 바꾸지 않음 |
| FIRST_RUN_REVIEW | 오래된 경로/행 번호와 Windows 미구현 문장이 남지만 build25 변경 절로 보완됨 | 역사 기록을 유지하되 현재 남은 것은 인증/버전 진단·재탐색임을 앞에서 연결 |
| CONVERSATIONS/LOCAL_STABILITY/RESPONSE_TIMING | 역사 수치와 현재 보완이 섞이지만 대체로 범위를 설명함 | 현재 저장 워커·표시/원문 상한 계약은 한 곳에서 관리하고 다른 문서는 링크 |
| CHARACTER_PACKS | CSS 실행 자산 불허·움직임 제어 설명에 비해 F06이 허용됨 | 문서를 느슨하게 바꾸기보다 로더를 계약에 맞추고 실제 검증 범위를 기록 |
| TASKS | O09 완료, M/G 계획표와 build26 상태가 모두 남음 | 작업의 현재 기준표는 최신 절로 바로 연결. 완료 기능의 새로운 경계 결함은 별도 작업 ID로 관리 |

README의 build26 실행·기록 보존 주장은 기존 작업의 기록이다. 이번 검토에서 기존 실행 앱 교체·사용자 프로필 해시 비교를 재수행했다는 의미로 옮겨 쓰지 않는다. 이전 테스트·CPU 표본을 가리키는 일부 artifacts 경로는 여러 실행이 덮어쓸 수 있으므로 날짜·빌드별 결과 파일 또는 source hash를 함께 남기는 것이 좋다. 새 리뷰 산출물은 별도 날짜 디렉터리에 저장했다.

문서 16개를 한 거대 문서로 합치는 것보다 README/BUILD_GUIDE/ARCHITECTURE/CHARACTER_PACKS를 현재 계약, 나머지를 날짜·빌드별 분석/검증 기록으로 유지하는 것이 적절하다. 최신 상태의 발견성을 높이고 반복 현재 설명을 줄이는 것이 문서 최적화의 핵심이다.

## 파일별 검토 기록

| 런타임 파일 | 확인한 책임과 주요 결과 |
|---|---|
| main.cjs | 시작/창/큐/IPC/종료·설정 확정·팩 수명·삭제. F02/F03/F08/F09와 늦은 응답/동기 전환 확인 대상 |
| codex.cjs | child 세대·JSONL 프레임·pending·이벤트·interrupt. 기존 연결 귀속·stdin 실패 처리 유지, F04 |
| models.cjs | 최대 20페이지/30초·커서 반복·200개 카탈로그·기본값/effort/tier. 실패 시 기존 목록 보존, 별도 치명 결함 재현 없음 |
| store.cjs | v1/v2 로드·소유 목록·메시지 정규화·저장/삭제 저널·save/saveAsync·전환. 기존 복구 검사 통과, F07과 전체 읽기/동기 전환 |
| store-worker.cjs | Store 재사용·메시지/결과·snapshot. 독립 저장 수명으로 유지, 구조화 복사 비용 |
| packs.cjs | canonical 파일·UTF-8·PNG/WebP chunk·SVG·v2·snapshot/revision. 헤더와 실제 decode 구분, F06 |
| asset-validator.cjs | hidden sandbox·decode·크기/픽셀·poster·thumbnail·timeout·destroy. 기본 3팩 decode 성공, F06 |
| pack-library.cjs | 준비/확정 journal·소유 해시·stage/archive/rollback/export. 실제 경계 분리 유지, F05·성공 경고 |
| personas.cjs | 제공/사용자 MD·등록부/생성 journal·read/save/manage/resolve. F01/F05·손상 항목 kind metadata 확인 대상 |
| skins.cjs | 고정 10색상 JSON·기본 paper·links/size. 책임 경계 유지, 현재 직접 불필요한 분리로 보지 않음 |
| preload.cjs | 좁은 action invoke·상태/탭/포인터/레이아웃 구독. 원시 파일 API 없음, 구독의 실제 반복 등록 없음 |
| ui/renderer.mjs | 입력·Markdown 정제·카드/목록 캐시·승인·개인화 편집·드래그·animation·ACK. F02, 큰 onState·숨긴 pet 상태 역할 |
| ui/index.html | 두 surface·폼/팝업/dialog·CSP·접근성. 정적 query ID 누락 없음, 이름 길이 기준·입력 재진입 검증 |
| ui/style.css | 포인터·스킨·compact·반응형·모션·포커스. CSS 검사 통과, cascade/정적 SVG 내부 모션과 구분 |
| ui/notice.js | 작은 안내·클릭 영역 signature·IPC catch. F03, 본체와 문구 중복 |
| ui/notice.html | 전용 안내·CSP·버튼·공통 CSS. 가벼운 역할 분리 유지 |
| ui/validate-images.html | script/network 없는 decode 페이지. 실제 검사 창용 별도 자원·CSP 경계 유지 |

스크립트 27개를 다음 목적별로 확인했다. 테스트용 도우미는 제품의 단순 helper 금지와 같은 기준으로 제거하지 않았다.

- 빌드/규칙: `build.cjs`, `check.cjs`, `lint-css.cjs`, `package.cjs`. renderer 번들·고지·OS별 icon·ASAR 밖 Store/worker 경계, 개발 파일 제외를 확인했다. 실제 재패키징은 수행하지 않았다.
- 자산 생성: `create-characters.cjs`, `create-icons.cjs`, `icns.cjs`. manifest personas 연결 보존, 별도 v2 생성, 사용자 원본 이미지와 18/36px·ICO·ICNS 생성 경계를 확인했다. 기본 팩 재생성은 외부의 수동 metadata를 덮어쓸 수 있으므로 제공 생성 명령의 소유 범위를 문서화한다.
- 기본 UI: `alpha-ui-smoke.cjs`, `buddy-name-smoke.cjs`, `ui-layout-smoke.cjs`, `pet-notice-smoke.cjs`. 체험/실제 분기·폼/정렬·실제 창 bounds와 프로그램 `.click()`의 범위를 구분했다.
- 대화/모델: `model-ui-smoke.cjs`, `history-ui-smoke.cjs`, `timing-ui-smoke.cjs`, `deletion-ui-smoke.cjs`, `performance-ui-smoke.cjs`. 대부분 send를 순서대로 await하므로 F02의 동시 준비 창을 검사하지 않는다. 기존 storage failure·scope fixture의 범위를 확인했다.
- 플로팅/시스템: `floating-ui-smoke.cjs`, `native-floating-smoke.cjs`, `pet-pointer-smoke.cjs`, `resource-smoke.cjs`, `stability-ui-smoke.cjs`. 실제 입력과 합성 이벤트·자기 프로세스 CPU·재시작 프로필을 구분했다. stability는 panel crash 위주이므로 F03의 pet-only 복구를 추가해야 한다.
- 개인화/이미지: `buddy-features-smoke.cjs`, `buddy-lifecycle-smoke.cjs`, `asset-validation-smoke.cjs`. snapshot·mode·pack 업데이트/복원·실제 decoder timeout을 확인했다. 자신의 사용자 모드를 포함한 export의 동일 프로필 왕복과 SVG 내부 CSS는 기존 범위에서 빠져 있다.
- 실제 연결: `codex-smoke.cjs`, `codex-delete-smoke.cjs`, `persona-real-smoke.cjs`. 모델 호출·검증 세션 소유 범위를 확인했다. codex-smoke의 cliVersion은 실제 실행 값을 읽지 않고 `0.160.0`으로 고정되어 있어 향후 실행 결과에 잘못된 버전이 기록될 수 있다. 실제 버전을 조회/기록하거나 미확인으로 남겨야 한다. 실모델 스크립트는 이번에 실행하지 않았다.

테스트 4개(`core.test.cjs`, `buddy.test.cjs`, `personalization.test.cjs`, `stability.test.cjs`)와 fixture 5개(`fake-codex.cjs`, `model-codex.cjs`, `delete-codex.cjs`, `persona-codex.cjs`, `protocol-codex.cjs`)를 읽고 58개 결과와 대조했다. 저장 해시/복구/용량·연결 실패·취소 watchdog·말투/팩 소유권은 의미 있는 검증이다. VM mainHarness는 실제 main 코드를 평가하지만 publish/창/시간을 모의하므로 네이티브 표시 보증으로 확대하지 않는다. Windows spawn 모의 성공과 실제 파일 잠금·Snap·DPI·IME는 다른 범위다.

캐릭터·스킨은 각 파일의 입력·참조 구조와 제한을 확인했다. v1 클립/새싹과 v2 blink의 다섯 MD 중복은 독립 편집·팩 자체 완결성의 비용이다. 이를 외부 공유 persona로 연결하면 포터블 팩의 내부 경로 계약이 바뀌므로 단순 중복 제거 대상이 아니다. 루트 package/lock·ESLint·gitignore·LICENSE 고지를 확인했고, 제삼자 라이선스 고지는 유지할 자산이다. 법률 검토를 수행한 것은 아니다.

## 다음 수정 순서

1. **팩 보호 경계 F06:** SVG 정적 정책과 실제 모션 검증을 먼저 맞춘다.
2. **질문/취소 F02/F09, 연결 F04:** 접수 예약·중복 제출·중단 우선 처리·턴 식별자를 함께 검증한다.
3. **저장/삭제 F07/F08:** 경로 무결성과 같은 연결 문맥의 삭제 범위를 유지한다. 사용자 실제 프로필로 실패를 주입하지 않는다.
4. **개인화 F01/F05:** 저장/로드 이름 규칙과 export→자기 프로필 reimport의 소유권을 맞춘다.
5. **UI 복구 F03:** pet-only/notice-only/동시 복구와 실제 클릭 영역을 확인한다.
6. 위 경계 회귀를 통과한 뒤 비동기 기록 합치기·승인 상세·오류 문자열·문서 최신 상태를 정리한다.
7. 큰 파일/많은 메시지/많은 팩의 지연을 측정한 뒤 필요한 최적화만 적용한다. Windows·실절전·스크린리더·최종 번들 장시간 검증은 별도 완료 조건으로 유지한다.

현재 모델·인증·말투·저장 구조를 전면 재작성하거나 Slack·중앙 FIFO·게임 엔진·DB를 추가하는 작업보다 위 실패 경계를 좁게 수정하는 것이 우선이다. 수정 시에도 단순 검증·상태 분기는 기존 함수 안에서 작성하고, 책임이 같은 코드를 이유 없이 여러 helper로 나누지 않는다.

## 근거와 미완료 검증

추가 재현은 `node artifacts/review-2026-10-08/reproduce.cjs`로 실행하며 임시 디렉터리·모의 Electron·로컬 fixture만 사용한다. 실행 결과는 해당 디렉터리의 `reproductions.json`이다. SVG의 실제 재생·기본 decode는 `svg-native.cjs`와 `svg-native.json`, 로컬 빌드 비교는 `build-local.json`, 검토 대상은 `inventory.json`에 기록했다. repro assertion의 성공은 **결함을 관찰했다는 의미**이며 수정된 기능의 통과 판정이 아니다.

최신 취약점 조회는 프로젝트 의존성 이름·버전의 공개 npm 레지스트리 전송을 자동 승인 검토가 거절하여 보류했다. 사용자의 명시적 외부 전송 승인 없이 재시도하지 않는다. 이전 문서의 audit 0 결과는 당시 조회이며 이번 현재 결과로 사용할 수 없다. 이 조회 여부는 코드 검토와 보고서 완성을 막는 조건으로 두지 않았다.

최종 상태: 전체 직접 작성 코드·데이터·문서의 검토와 상세 보고 완료. 재현한 결함의 제품 수정·배포는 아직 수행하지 않았다. 소스 검사/기존 테스트/로컬 번들/기본 decode 통과와 신규 경계 결함 9건이 동시에 존재한다.
