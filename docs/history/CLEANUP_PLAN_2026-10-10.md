# 프로젝트 불필요 내용 정리 계획

기준은 2026-10-10의 alpha.14/build29이다. 우선 제거 효과가 큰 항목은 오래된 테스트 프로필·중복 앱과 완료된 계획의 반복이다. 제품 코드에서는 작게 남은 문구 갱신·미사용 선택자·구 설치 진입점을 정리한다. 연결·첨부·FIFO·저장 복구의 검증 경계와 기존 사용자 데이터 호환은 유지한다.

이 문서는 작업 직전의 제거 계획이다. 계획 당시에는 삭제/수정을 실행하지 않았다. 이후 사용자의 작업 지시에 따른 실제 제거·보존·검증과 설치 여부는 [정리 결과](CLEANUP_RESULT_2026-10-10.md)를 따른다.

## 확인 범위와 기준

소스 20개(HTML/CSS 포함), 개발 스크립트 32개, 테스트/fixture 12개, 기존 문서 23개(README/TASKS 포함), 기본 캐릭터 3팩의 39개 파일, 이미지 자산 7개와 스킨 3개를 확인했다. 생성 번들·라이선스 고지·패키지와 ignored `artifacts`, `dist`, `node_modules`도 구분했다.

JS 60개를 구문 분석해 정적 require/import 249개와 호출·주석을 확인하고, 동적 smoke 분기와 HTML/renderer/CSS 참조를 대조했다. 기본 팩의 미참조/누락 파일은 없고 현재 의존성도 각각 번들·빌드·검사에서 사용한다. CSS 클래스 이름만 검색해 삭제를 확정하지 않는다. 동적 motion 클래스와 notice 페이지, 실제 DOM 상태를 함께 본다.

린트와 단위 검사 90개를 이번 계획의 기준으로 다시 실행해 통과했다. 최신 릴리스의 UI 13종·실제 첨부 입력·패키지 검증은 [build29 적용 기록](ATTACHMENTS_AND_QUEUE_2026-10-10.md)의 기존 근거다. 이번에는 GUI/유료 모델을 재실행하지 않았다.

검토 원자료는 `artifacts/cleanup-review-2026-10-10/`의 `source-inventory.json`, `resource-inventory.json`, `document-inventory.json`, `app-inventory.json`, `review-baseline.json`, `lint.txt`, `tests.txt`에 있다.

## 먼저 보존할 내용

| 대상 | 보존 이유 |
|---|---|
| 현재 `dist/OnggiBot-darwin-arm64/OnggiBot.app` | build29 실행 앱 |
| `OnggiBot-build28-before29.app` | 직전 버전의 롤백 후보. 바이너리만으로 사용자 데이터 복구를 보장하지 않으므로 형식 호환도 확인 |
| `src/`의 기능 모듈과 preload/worker/validator 페이지 | 현재 앱·테스트의 실제 참조. 작은 함수 수만으로 모듈 통합하지 않음 |
| Store v1 이관·v2 읽기·저널/삭제 복구 | 기존 기록과 비정상 종료·쓰기 실패에 필요 |
| 캐릭터 v1/v2·상태 fallback·0팩 복구 표시 | 사용자 팩 호환과 설정 접근을 유지하는 경로 |
| CLI node 실행 어댑터·이전 알림 필터·인증 미지원 fallback | 테스트 CLI·연결 교체·구버전 호환 경로 |
| FIFO 접수 예약·종료 저장·취소/재연결 타이머 | 중복 실행·순서 역전·저장 누락을 막는 경로 |
| 이미지/파일 소유 ID·해시·링크·용량 검사 | 불완전 파일과 다른 대화의 참조를 차단 |
| `assets/tray-source.png`, 아이콘/캐릭터 생성기 | 원본과 재생성 경로. 배포 제외와 소스 삭제를 구분 |
| 기본 3팩·스킨·Windows 처리 | 현재 선택 기능·독립된 팩 규격·타깃 OS 코드. 내용이 비슷하다는 이유로 삭제하지 않음 |
| package-lock·현재 의존성·라이선스 고지 | 재현 가능한 설치와 배포 고지 |
| 현재 변경된 tracked 파일과 untracked 소스/테스트 | 아직 Git 커밋에 들어있지 않은 실제 작업 결과 |

실사용 OnggiBot 데이터와 `.codex` 인증/세션/생성 이미지는 프로젝트 밖에 있다. 이번 정리 대상에 넣지 않는다. 앱의 첨부 캐시 정리는 별도 기능이며 테스트 폴더 정리와 섞지 않는다.

## 제품 코드와 주석

| 항목 | 위치와 확인 내용 | 제거 방식과 확인 조건 |
|---|---|---|
| 숨긴 펫 버튼의 문구 갱신 | `src/ui/renderer.mjs:35,149,255`, `style.css:11`. pet 버튼은 CSS로 보이지 않고 panel에서도 pet surface가 숨겨져 있다. 실제 안내 문구/접근성은 `notice.js`가 담당 | 숨긴 버튼의 text/aria 갱신과 그것만 사용하는 renderer `labels`를 제거. 실제 notice의 labels는 유지. hidden·타이머·`syncPetLayout` 상태는 유지하며 notice 표시/호버/잠금/renderer 복구 확인 |
| 도달하지 않는 CSS 선택자 | `src/ui/style.css:25`의 `.settings-button.active`. 설정 버튼은 `renderer.mjs:57`에서 `aria-pressed`만 바꾸며 active 클래스는 탭 버튼에 적용 | 해당 클래스 선택자만 제거. `.tabs .active`와 hover는 유지. 선택 강조를 변경하려면 aria 상태를 이용하는 별도 UI 변경으로 검증 |
| 중복 전송 버튼 갱신 | `renderer.mjs:328,647`의 disabled 갱신 직후 `renderDraftAttachments`가 같은 조건으로 다시 쓴다. 해당 함수는 signature 조기 반환 전에 버튼 상태를 갱신 | 호출 직전의 중복 쓰기만 제거. 제출 시작의 즉시 disabled=true는 유지. 접수 실패·파일 선택·대기/미니 전송·버튼 재활성 확인 |
| 새 대화 초안 이관의 반복 조건 | `renderer.mjs:232,233`이 같은 조건을 연속 검사해 텍스트와 첨부 초안을 각각 이전 | 같은 if 블록에서 두 Map을 갱신하도록 인라인 통합. 두 종류의 초안 보존·첫 접수 후 ID 이전을 유지하며 별도 헬퍼는 만들지 않음 |
| 검사 문자열 안 미사용 계산 | `scripts/ui-layout-smoke.cjs:37`의 `buttons` 배열. 이후 결과는 각 row의 `boxes`로 계산 | 사용하지 않는 `buttons` 선언/DOM 측정만 제거. JS 문자열 내부는 현재 ESLint가 검사하지 않으므로 구문과 해당 UI 검사 확인 |
| 장식성 주석 | `src/ui/style.css:1`의 디자인 분위기 설명 | 선택적으로 제거. 소유 턴·늦은 실패·삭제 확인·FIFO 순서를 설명하는 현재 주석은 유지 |
| 옛 `import-pack` IPC | `src/main.cjs:778`의 즉시 설치 분기. 현재 UI는 `pack-preview`→`pack-apply`; 직접 IPC는 `test/stability.test.cjs:199,201`에서 사용 | 구 호출 테스트를 실제 미리보기/확정 경로로 이전하고 실패 후 재시도·rollback을 유지한 뒤 분기 제거. HTML의 `#import-pack` 버튼은 현재 UI이므로 삭제하지 않음 |

현재 제품 코드의 TODO/FIXME, 주석 처리한 옛 구현, 완료 후 남은 작업 메모는 발견하지 못했다. 제품 JS 주석 5개는 대부분 현재의 수명/순서 조건을 설명한다. 주석을 일괄 삭제하거나 오류 경로를 정상 상황만으로 줄이지 않는다.

이전 검토의 `--tail` 잔존 계산과 카탈로그 갱신의 중복 `renderCharacter` 호출은 현재 코드에서 이미 정리됐다. 같은 작업을 다시 계획하지 않는다. `petLayout.controlsVisible`은 실제 클릭 통과 계산에서 읽히므로 삭제 대상이 아니다. 파일/이미지 저장 모듈의 비슷한 코드는 신뢰 경계가 달라 범용 헬퍼로 합치지 않는다.

## 개발 스크립트와 검증 자료 의존

| 파일 | 판정 | 정리 전제 |
|---|---|---|
| `scripts/remediation-performance.cjs` | 2026-10-08의 before 스냅샷에 의존하는 일회성 비교 코드. npm/현재 runtime 진입점에는 등록되지 않음 | 측정 결과·소스 해시·재현 조건을 이력에 보관한 뒤 일반 scripts에서 제거. 계속 비교할 필요가 있으면 날짜/경로를 인수로 받는 별도 벤치마크로 대체 |
| `scripts/remediation-real-smoke.cjs` | 날짜별 workspace/result에 묶인 실제 모델 응답·owned interrupt 검사 | 응답 검사는 기존 `codex:smoke`와 겹치지만 실제 중단 확인은 완전히 같지 않음. owned interrupt 검증을 정식 실제 CLI 검사에 남긴 뒤 일회성 스크립트 제거 |
| `scripts/packaged-resource-smoke.cjs` | 배포 ASAR 자원 측정 래퍼. 날짜와 macOS arm64 경로가 고정됨 | 삭제보다 입력 경로/결과 위치를 매개변수로 정리하고 공식 명령으로 등록. 실제 패키지 검사 기능은 보존 |
| `floating-ui-smoke.cjs`, `native-floating-smoke.cjs` | require가 조건식이라 정적 단순 검색에서 누락되지만 `main.cjs:492`에서 호출 | 유지. 합성 좌표 검사와 실제 마우스 검사는 서로 대체되지 않음 |
| `buddy-name`, `pet-notice`, `ui-layout` smoke | npm 직접 명령이 없어도 `alpha-ui-smoke`가 호출 | 유지. 등록되지 않았다는 이유로 삭제하지 않음 |
| model/delete/persona/connection-image/protocol fixture | 각기 다른 모델·삭제·지시문·인증/이미지·프레임 실패 목적 | 유지. 범용 mock 프레임워크를 새로 만들지 않음 |
| `artifacts/*/verify-package.cjs`, `real-input-check.cjs`, 별도 통합 실행기 | 최신 검증의 일부가 ignored 폴더나 `/private/tmp`에만 있음 | 재사용 가능한 검사는 scripts/정식 명령으로 이전한 뒤 원래 사본 제거. 새 체크아웃에서 실행되도록 입력/출력 경로를 정리 |
| `scripts/connection-image-smoke.cjs`의 `affected-items.json` 선택 분기 | 특정 사용자 그림의 과거 재현에 의존. 파일이 없으면 큰 실제 그림 검사가 생략됨 | 기본 이미지 검사는 재현 가능한 합성 raster fixture로 유지하고, 개인 기록 복원 검사는 선택형 수동 검사로 분리. 개인 base64/경로 사본은 원본 보존 확인 후 정리 |

작은 공통 문자열이나 단일 연산을 위해 새 헬퍼를 만들지 않는다. 입력/출력 경로를 인수로 받는 검증 스크립트 정리는 검사의 수명과 재현성을 위한 변경이다.

## 문서 정리

현재 README/TASKS를 포함한 기존 Markdown 23개는 3,485줄이다. 현재 설명 뒤에 과거 계획·결과를 계속 덧붙여 같은 동작과 완료 상태가 반복된다. 현재 규격은 운영 문서에, 완료된 조사/계획/수용 기록은 이력에 두고 기존 근거를 연결한다. 현재 상대 파일 링크는 깨진 것이 없으므로 이동 시 이 상태를 유지한다.

| 대상 | 정리 내용 |
|---|---|
| `README.md` | 최신 사용법·제한·실행·검증 명령 유지. build26/27/28의 자세한 소개는 릴리스 이력 링크로 축약 |
| `TASKS.md` | 완료된 A/C/D/E/P/G/W 작업 상세를 이력으로 이동. 현재 구현 요약과 미완료 O/E/M/S 항목만 실행 대기 목록에 남김. 완료한 로컬 FIFO와 미착수 중앙 FIFO를 명확히 구분 |
| `ARCHITECTURE.md` | 현재 책임/저장/연결/첨부/큐 계약 유지. 버전별 구현 경위와 반복 설명을 이력으로 이동 |
| `BUILD_GUIDE.md` | 현재 alpha.14/build29 기준을 유지. 마지막 build26 검증/교체 경위는 과거 배포 기록으로 이동. Windows/서명/설치 제한은 유지 |
| `ALPHA_REPORT.md` | 과거 alpha.9 제목 아래 누적된 현재/과거 결과를 분리. 최신 검증 범위를 앞에 두고 버전별 상세는 이력으로 연결 |
| `PROJECT_REVIEW.md` | 구조 결정과 아직 유효한 문제만 현재 문서에 유지. build24/25에서 완료된 오류·측정·전달 서술은 이력으로 이동 |
| `BUDDY_MODES_REVIEW.md` | 구현된 기능의 현재 규격/남은 조건을 유지하고 조사→미착수 계획→완료 상태의 반복 표를 정리. 비교 근거·설계 선택은 보관 |
| `FIRST_RUN_REVIEW.md` | 현재 로그인/재탐색은 구현돼 있지만 앞부분은 없다고 설명. 현재 O01–O10 상태를 앞으로 옮기고 build14 당시 문제/완료 계획은 이력으로 분리 |
| `FLOATING_PET_REVIEW.md` | 수정 전 PokeTokenBar 비교·미착수 제안은 이력으로 이동. 현재 동작은 UPDATE/ARCHITECTURE에 연결하고 링크를 바꾼 뒤 중복 본문 제거 |
| `FLOATING_PET_UPDATE.md`, `UI_UX_REFINEMENT.md` | 현재 동작·플랫폼 제한만 남기고 build15–25의 전달 경위는 이력으로 이동 |
| `FULL_CODE_REVIEW_2026-10-08.md`, `ISSUE_REMEDIATION_PLAN_2026-10-08.md`, `ISSUE_REMEDIATION_RESULT_2026-10-08.md` | 수정 전 재현·계획·수정 결과를 완료된 한 묶음의 이력으로 보관. 원본 근거는 지우지 않고 활성 작업 목록에서 제외 |
| `CONNECTION_AND_IMAGES_2026-10-08.md`, `ATTACHMENTS_AND_QUEUE_2026-10-10.md` | 최신 검증·전달 근거 유지. 기능 사용법/한도를 운영 문서에 모은 뒤 반복 설명만 축약 |
| `CHARACTER_PACKS.md` | 현재 v1/v2·보안·배율·수명 규격 유지. 변경 경위만 이력으로 이동 |
| `CONVERSATIONS.md`, `DELETE_CONVERSATIONS.md`, `LOCAL_STABILITY.md` | 사용자 실행/삭제 범위와 기술 복구 규격은 유지. 한도·저장 포맷·재시작 정책의 중복 설명은 주 문서 한 곳에 두고 연결 |
| `MARKDOWN_MODELS.md`, `RESPONSE_TIMING.md` | 현재 표시/모델/측정 의미 유지. 날짜별 UI/실제 모델 샘플은 검증 이력으로 이동 |
| `SLACK_INTEGRATION_PLAN.md` | 미착수 후속 범위이므로 폐기하지 않음. 현재 앱 작업 목록의 활성 구현과 구분해 backlog에서 연결 |

문서 이동은 링크/앵커를 함께 갱신하며 원본의 검증 날짜·환경·성공/미검증 조건을 유지한다. 과거 검사 수를 현재 90개로 덮어쓰거나 Windows/실제 로그인 검증을 완료로 바꾸지 않는다. 필요하지 않은 회고 문장은 줄이되 실패 원인·되돌림·검증 한계는 남긴다.

## 저장 공간 정리

아래 크기는 `du -sk` 기준의 할당량이다. 디스크 공유 블록/이력 보존/격리 보관에 따라 실제 해제 용량은 달라진다.

| 분류 | 확인한 사용량 | 처리 |
|---|---|---|
| artifacts 전체 | 약 1.0GiB | 전체 삭제하지 않고 생성물·증거·개인 스냅샷으로 분류 |
| dist 전체 | 약 1.4GiB | 현재 앱과 직전 롤백 후보 유지, 아래 오래된 사본 정리 |
| node_modules | 약 369MiB | 현재 개발 환경이므로 기본 유지. 필요할 때 lock 기반 재설치 가능한 캐시로 관리 |
| 오래된 build24/26과 동일 build29 staging | 약 865.5MiB | 현재 build29 검증 및 직전 build28 보존 후 제거 후보 |
| 날짜별 검증 폴더의 프로필/호스트/스냅샷 | 약 650.7MiB | 핵심 결과와 필요한 원본을 남긴 뒤 재생성 가능한 런타임 폴더 정리 |
| 기타 최상위 테스트 프로필 | 약 143.0MiB | 실행 중인 검사가 없는 것을 확인한 뒤 정리 |
| 날짜별 생성 스키마 두 세트 | 약 10.9MiB | 사용한 CLI 버전과 관련 필드 근거 보존 후 중복 생성 스키마 정리 |

앱 3사본과 프로필/스냅샷의 합산 제거 후보는 약 **1.62GiB**다. 모두 필요 없다고 확정한 수치가 아니라 분류 대상의 합이며, 필요한 스냅샷과 증거를 보관하면 실제 절감량은 줄어든다. schema·로그 등 작은 항목은 이 합계에서 제외했다.

### dist 대상

- `dist/OnggiBot-darwin-arm64/OnggiBot-build24-before26.app`와 `OnggiBot-build26-before28.app`: 이전 전달 근거와 필요 복구 범위를 보존한 뒤 제거 후보.
- `dist/staging/OnggiBot-darwin-arm64/OnggiBot.app`: 현재 일반 build29와 app.asar SHA-256이 동일하다. 정식 패키지 검사/측정 경로를 정리한 뒤 중복 staging 제거 후보.
- `OnggiBot.app` build29와 `OnggiBot-build28-before29.app`: 유지. 삭제 전 실제 실행 경로와 열려 있는 프로세스를 확인한다.

staging 재생성은 `npm run build` 후 `node scripts/package.cjs --staging`으로 한다. 일반 `npm run package`는 기본 실행 경로를 덮어쓸 수 있으므로 정리 검증에서는 사용하지 않는다.

### artifacts 대상

- `remediation-2026-10-08`의 `profiles`, `native-profiles`, `zero-profiles`, `packaged-resource-profile`, `native-host`: 검사 프로필/임시 실행 호스트 제거 후보. `before`, `continuation`은 원본·근거·프로필을 다시 나눠 필요한 부분만 남긴다.
- `connection-images-2026-10-08`의 `final-profiles`, `release-profiles`, `ui-profiles-*`, `package-verification-profile`: 재생성 가능한 검증 프로필 제거 후보.
- `attachments-2026-10-10`의 `final-profiles`, `ui-profile-1`, `release-ui-2`, `release-images-2`, `package-verification-profile`, `real-input-profile`: 재실행 경로를 먼저 보존한 뒤 제거 후보.
- 최상위 `*-smoke-profile`, `*-profile`, 오래된 smoke 복사본: 테스트 용도/원본 포함 여부를 확인하고 명시적 목록으로 정리.
- `OnggiBot.iconset`, 중간 스크린샷·중복 결과 사본·단계별 반복 로그: 생성기로 재현하거나 최종 결과에서 확인할 수 있는 것부터 정리.
- `affected-items.json`, `affected-conversation.json`, 실제 프로필 before/after 사본: 개인 자료/기록이므로 먼저 분리한다. 실제 원본·복구 사본 존재와 검증에 필요한 익명화 근거를 확인하기 전 삭제하지 않는다.

최신 `lint/check/unit-test`, `integration`, `real-input-verification`, `package/installed-package-verification`, `delivery-installed` 결과와 핵심 화면·원본 해시는 유지한다. 과거 결과 중 보고서가 인용한 숫자·실패 이유·검증 한계는 작은 보존 묶음으로 남긴다. 폴더 전체나 모든 JSON/PNG에 대한 삭제 glob은 사용하지 않는다.

## 배포 패키지에서만 제외할 내용

현재 `scripts/package.cjs`는 docs/scripts/test/node_modules/artifacts/dist를 이미 제외한다. 그러나 루트 README/TASKS/AGENTS/.gitignore, unbundled renderer ESM과 이미지 생성 원본은 ASAR에 포함될 수 있다.

`README.md`, `TASKS.md`, `AGENTS.md`, `.gitignore`, `src/ui/renderer.mjs`, `assets/tray-source.png`는 실제 build29 ASAR에 들어있으며 배포 제외 후보다. 소스에서는 모두 보존한다. 실제 UI는 renderer.bundle.js를 로드하며 tray-source는 생성기 입력이다. 이 6개 파일은 ASAR 내부 원본 바이트 합계 약 419KiB로, 앱 전체 용량의 주된 부분은 Electron 런타임이다. 타깃 OS에서 쓰지 않는 아이콘은 플랫폼별 빌드/실행을 확인한 뒤 별도로 제외한다.

`renderer.bundle.js`, `.LEGAL.txt`, `THIRD_PARTY_NOTICES.txt`, preload, Store/worker unpacked, notice/validator HTML, 현재 자산/스킨/캐릭터는 배포에 유지한다. 최신 패키지의 71개 일치 목록은 제외 정책에 맞춰 새 예상 목록으로 갱신한다. 소스의 모든 assets를 무조건 요구하거나 필요한 파일을 빠뜨리지 않는다.

## 우선순위와 완료 조건

| 순서 | 작업 | 다음 단계로 넘어갈 조건 |
|---|---|---|
| 0 | 현재 변경/untracked 포함 전체 소스 스냅샷·해시·제거 목록 고정 | 현재 릴리스/검증/롤백/개인 자료를 제외한 정확한 목록 확인 |
| 1 | 재사용 검사를 scripts로 이전하고 사용자 그림 의존을 선택형 검사로 분리 | 새 체크아웃에서 정식 검증이 재현됨; owned interrupt·큰 이미지 검사가 누락되지 않음 |
| 2 | 완료 계획/반복 문서를 이력으로 정리 | 상대 링크·앵커 정상, 현재 상태와 미완료 backlog가 명확함 |
| 3 | 프로필/중간 산출물·오래된 앱·중복 staging 정리 | 실행 중인 검사/앱 없음, 최종 증거·직전 롤백 후보 보존, 명시적 목록만 처리 |
| 4 | 작은 미사용 코드와 옛 import IPC 정리 | 린트·90개 기존 회귀, notice/팩 실패 재시도/UI 경로 통과 |
| 5 | 패키지 전용 제외 적용 | staging 빌드·갱신된 예상 파일 목록·worker/아이콘·실행 검증 통과 |
| 6 | 최종 문서/용량/검증 결과 확정 | 무엇을 제거/보존했는지와 실제 절감량을 기록 |

복구 가능한 별도 보관과 항목별 manifest를 먼저 만들고 삭제 범위를 좁힌다. 새로 생긴 파일·예상과 다른 해시·링크·프로세스가 있으면 해당 항목만 보류한다. `git clean -fd/-xfd`, 전체 dist/artifacts 삭제, 확장자별 일괄 삭제는 사용하지 않는다. 현재 untracked에 실제 구현이 다수 있으므로 Git 미추적 상태는 폐기 기준이 아니다.

코드 변경 후에는 단위·린트/구문과 변경에 맞는 UI 검사를 실행한다. import 분기를 제거하면서 그 경로의 실패 테스트도 지우는 방식은 피한다. 패키징 정책 변경은 실제 소스/ASAR/unpacked/아이콘 검증으로 확인한다. 단순 문서/일회성 프로필 정리를 위해 유료 모델·30분 측정을 반복하지 않는다. 실제 로그인·Windows·물리 클릭/절전이 필요한 수용 조건은 해당 환경에서 확인하기 전 완료로 기록하지 않는다.
