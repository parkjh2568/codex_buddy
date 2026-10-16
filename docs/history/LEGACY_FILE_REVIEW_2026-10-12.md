# my_budy 레거시와 파일 정리 검토

이 문서는 정리 전 검토다. 이후 실행한 수정·보관·제거와 검증 결과는 [파일 정리 결과](LEGACY_FILE_CLEANUP_RESULT_2026-10-12.md)를 따른다.

2026-10-12, 현재 소스 `0.1.0-alpha.18`과 macOS staging build34 기준이다. **제품 소스에서 파일 전체를 삭제해도 된다고 확정할 대상은 발견하지 못했다.** 큰 정리 후보는 과거 build31/build32 앱 약 **595.6MiB**와 검사 프로필의 재생성 가능한 캐시 약 **48.9MiB**다. 기존 데이터 호환 코드, 현재 기능 검사, 복구 압축본과 검증 결과는 유지해야 한다.

정리 전에 고칠 개발 경로 문제 3건과 문서 안내·링크 문제 3종을 확인했다. 이번 요청에서는 파일·코드·참조·용량을 분석하고 보고했으며 기존 파일을 삭제하거나 제품 코드를 수정하지 않았다. 새 보고서와 검토 자료만 추가했다.

## 확인 범위와 근거

보고서 생성 전 프로젝트 소유 파일 **182개**, 생성·외부 폴더의 일반 파일 **8,812개**와 링크 **101개**를 목록화했다. 프로젝트 JS **64개**를 구문 분석해 정적 require/import **288개**, 파일 이름 참조와 동적 진입점을 대조했다. 파일 이름이 문자열에 나온다는 사실은 실행 참조와 구분했다. 테스트의 glob 진입점, Worker, HTML/CSS 자산, 팩 manifest와 스킨 열거도 확인했다.

| 범위 | 파일 수 | 판단 |
|---|---:|---|
| `src` | 22 | 작성 원본 20개와 생성 번들/LEGAL 2개. 현재 실행·빌드·검사 참조 유지 |
| `scripts` | 35 | 빌드·생성·통합·직접 실행·하위 검사 진입점 유지 |
| `test` | 12 | 기본 단위 진입점 6개와 fixture 6개 유지 |
| `docs` | 42 | 현재 문서 28개와 기존 이력 14개. 완료 기록 7개는 이동 후보 |
| `characters` | 53 | v1 2팩·v2 2팩의 데이터. manifest 미참조/누락 파일 없음 |
| `assets` / `skins` | 7 / 3 | 플랫폼/Retina/로고/생성 원본과 선택 가능한 스킨 유지 |
| 루트 파일 | 8 | 사용법·작업 규칙·패키지/lock·lint/ignore·라이선스 고지 유지 |
| `artifacts` | 4,297 | 검토 시작 전 일반 파일. 결과·상태·복구본·캐시를 구분 |
| `dist` / `node_modules` | 1,338 / 3,177 | 앱 5벌과 개발 의존성. 제삼자 내부 파일은 소유 코드 삭제 후보로 판정하지 않음 |

182개 전부의 해시·참조·보유/이동 판단은 [프로젝트 파일 목록](../../artifacts/legacy-file-review-2026-10-12/source-inventory.json)에 있다. 외부 앱 데이터, CLI 인증/세션·사용자 생성 이미지는 이번 파일 검사 범위에 넣지 않았다. `node_modules`와 Electron 바이너리는 목록·용량·의존성 역할을 확인했으며 제삼자 코드 전체를 기능 감사했다는 뜻은 아니다. `.git`은 기존 변경과 추적 상태를 확인하는 데 사용했다.

## 정리 전에 수정할 경로 문제

### 선택형 기록 계측의 이전 결과 폴더 의존

[test/stability.test.cjs:369](../../test/stability.test.cjs:369)는 `ONGGI_HISTORY_COST_REVIEW=1`일 때 결과를 `artifacts/followup-alpha18/history-cost-*.json`에 쓴다. 폴더를 생성하지 않고 날짜별 이전 작업 경로를 고정한다. `artifacts`가 없는 임시 소스 복사본에서 해당 선택형 검사를 실행해 **ENOENT를 재현**했다. 일반 단위 검사는 이 분기를 실행하지 않아 같은 환경에서 126개 모두 통과했다.

우선순위 P2다. 5,000턴 계측 기능과 원문/ID 회귀는 유지하고, 출력 경로만 명시적인 환경 변수 또는 일반 검사 결과 경로로 바꾸며 쓰기 전에 폴더를 생성한다. 기존 `followup-alpha18` 자료를 보관/정리할 수 있어야 한다. 이 변경은 함수 안의 단순 경로 처리로 충분하다. [깨끗한 환경 결과](../../artifacts/legacy-file-review-2026-10-12/clean-environment.json), [예상 실패 로그](../../artifacts/legacy-file-review-2026-10-12/missing-artifact-benchmark.log).

### 이미지 decode 검사의 프로필 격리 누락

[asset-validation-smoke.cjs:5](../../scripts/asset-validation-smoke.cjs:5)는 `userData`를 항상 `artifacts/asset-validation-profile`로 설정한다. [통합 실행기](../../scripts/integration-smoke.cjs:17)는 새 `ONGGI_SMOKE_ROOT`를 전달하고 성공 후 자신이 만든 임시 폴더를 지우지만, 이 별도 Electron 진입점은 그 환경 변수를 사용하지 않는다. 실제 고정 프로필은 약 **7.39MiB** 남아 있다.

우선순위 P2다. `profileRemoved=true`는 실행기의 임시 폴더에 대한 결과이며 이 고정 프로필의 제거를 증명하지 않는다. 검사 프로필과 JSON 출력도 실행별 경로를 사용해야 한다. 성공 결과 보존 후 실제 사용한 프로필을 정리하고 실패 프로필은 남기는 기존 정책에 맞춘다. 이미지 decode·APNG/WebP poster·손상/timeout 검사는 필요하므로 파일 자체는 유지한다. 이번 판단은 코드와 잔여 폴더에 근거하며 GUI를 새로 실행하지 않았다.

### 일부 UI 결과의 공용 경로와 재시작 자료 의존

[ui-layout-smoke.cjs:51](../../scripts/ui-layout-smoke.cjs:51), [buddy-name-smoke.cjs:40](../../scripts/buddy-name-smoke.cjs:40), [pet-notice-smoke.cjs:32](../../scripts/pet-notice-smoke.cjs:32) 등은 결과를 공용 `artifacts/*.json` 또는 PNG에 쓴다. [floating-ui-smoke.cjs:6](../../scripts/floating-ui-smoke.cjs:6)의 재시작 확인 분기는 같은 공용 JSON을 다시 읽는다. 통합 실행기는 최근 수정 시각의 공용 JSON을 복사하지만 실행별 원본 경로를 제공하는 것과 같지는 않다.

우선순위 P2다. 반복 실행은 과거 결과를 덮으며 병렬 실행은 같은 파일에 충돌할 수 있다. 실행별 결과/화면 경로를 통일하고, 재시작 확인에는 같은 실행에서 생성한 결과를 명시적으로 연결해야 한다. 검사는 기본 경로 없이도 결과 폴더를 만들 수 있어야 한다. 실제 질문을 보내는 CLI 검사는 체험 검사와 구분해 유지한다. 쓰기 경로 정리 때문에 새 dispatcher나 별도 helper 모듈을 도입할 필요는 없다.

## 삭제와 보관 후보

아래 용량은 파일 할당량 또는 명시한 압축 파일 크기다. APFS 공유·열린 파일·복구본 저장을 포함한 실제 가용 공간 증가를 보장하지 않는다. 캐시와 상위 프로필을 둘 다 더해 절감량을 계산하지 않는다.

| 대상 | 관측 용량 | 판단과 선행 조건 |
|---|---:|---|
| `dist/.DS_Store` | 약 8KiB | Finder 생성 정보. 제품/빌드/검사에서 필요 없는 확정 정리 후보 |
| `dist/rollback-alpha15-build31` | 약 288.2MiB | 현재 실행/직전 후보가 아닌 과거 앱. 다른 위치의 복구본과 파일·링크·실행 정보 확인 후 보관 이동/제거 후보 |
| `dist/rollback-alpha16-build32` | 약 307.4MiB | 위와 같은 조건. build33 복구본과 현재 build34/일반 build30은 유지 |
| 검사 프로필의 `Cache`, `Code Cache`, `GPUCache`, Dawn 캐시 등 | 합계 약 48.9MiB, 201폴더/738파일 | 검사 프로세스 종료·검사 전용 경로 확인 뒤 캐시만 정리 후보. 상태/기록/첨부/이미지/저널과 구분 |
| `artifacts/integration-smoke` | 약 91.2MiB | 결과와 여러 실패/중간 프로필이 함께 있음. 폴더 전체 삭제 대상이 아님. 로그/JSON/핵심 화면과 재현에 필요한 상태 보존 뒤 프로필별 판단 |
| `artifacts/followup-alpha18` | 약 70.4MiB | 현재 보고서의 전후 계측·원래 실패·최종 결과·코드 기준 사본 보존. 포함 캐시는 별도 후보이며 선택형 계측 경로 문제를 먼저 해결 |
| 반복 package-verification 폴더 | 각 약 5.7MiB | 실제 이미지 사본/첨부 복원 자료가 포함됨. 내용·소스 해시가 같은 실행 자료만 대조 후 통합 가능 |
| ignored 일회성 검사 코드 15개 | 합계 56,862 bytes | 제품 런타임 진입점 없음. 대체 검사와 원래 실패 근거를 연결한 뒤 결과와 함께 보관 후보 |

캐시의 정확한 경로/할당량은 [캐시 목록](../../artifacts/legacy-file-review-2026-10-12/cache-inventory.json), `artifacts` 256개 항목과 앱/의존성 목록은 [생성 자료 목록](../../artifacts/legacy-file-review-2026-10-12/generated-inventory.json)에 있다. 이전 앱 2벌과 캐시의 후보 할당량 합은 약 **644.4MiB**지만 복구 압축본을 새로 남기면 순감소는 더 작아진다.

### 큰 복구 압축본은 유지

`artifacts/cleanup-2026-10-10/runtime-and-profiles-before.tar.gz`는 **540,799,545 bytes, 약 515.7MiB**다. 이전 정리에서 이미 제거한 앱/프로필의 복구본이다. 현재 SHA-256이 당시 제거 결과에 기록된 값과 일치한다. 크다는 이유로 오래된 캐시와 같이 삭제하면 기존 복구 경로를 잃는다.

같은 폴더의 `source-before.tar.gz`, `source-after.tar.gz`, 각 해시 목록·diff와 `one-off-scripts-before.tar.gz`도 보존한다. 특히 현재 미커밋 변경의 기준 사본은 Git 추적 여부만으로 대체할 수 없다. 다른 보관 위치를 사용할 경우 원본 해시/압축 경로·목록/선택 복구를 확인한 뒤 링크를 바꾼다. 이번에 압축본을 풀어 덮어쓰거나 제거하지 않았다. [복구본과 이전 검사 해시 대조](../../artifacts/legacy-file-review-2026-10-12/preservation-checks.json).

### ignored 일회성 코드의 분류

| 종류 | 경로 | 보관 또는 통합 조건 |
|---|---|---|
| 현재 공식 패키지 검사로 대체 가능한 조사 | `packaged-worker-smoke.cjs`, `verify-stability-package.cjs` | `scripts/verify-package.cjs`의 worker·소스/자산·이미지 복원 근거와 연결한 뒤 이전 결과와 보관 |
| 이전 결함 재현 | `alpha16-review-repro.cjs`, `change-review-repro.cjs`, `audit-probes.cjs`, `review-2026-10-08/reproduce.cjs` | 단위/GUI에 옮겨진 경우와 당시 실패를 대조. 이력 문서가 직접 참조하는 재현 코드는 링크를 함께 이전 |
| CSS/이미지/아이콘 조사 | `audit-css.cjs`, `review-2026-10-08/svg-native.cjs`, `tray-preview.cjs` | 현재 lint/validator/아이콘 검사가 같은 요구를 다루는지 확인 후 결과와 보관 |
| 실사용 상태·CLI 조사 | `archive-real-stability.cjs`, `stability-profile-snapshot.cjs`, `connection-images-2026-10-08/check-live-account.cjs`, `connection-images-2026-10-08/read-affected.cjs` | 당시 소유 기록·설정의 진단 근거 보존. 실제 CLI/앱 프로필을 읽거나 상태를 바꿀 수 있어 정리를 위한 재실행은 필요 없음 |
| 전달 대조와 최근 프로토콜 확인 | `remediation-2026-10-08/continuation/verify-delivery.cjs`, `followup-alpha18/protocol-readonly.cjs` | 전달/페이지 응답의 근거와 함께 보존. 재사용이 필요할 때만 현재 정식 검사로 이전 |

이 표의 경로는 모두 `artifacts/` 아래다. [개별 코드 목록](../../artifacts/legacy-file-review-2026-10-12/one-off-code-inventory.json)에 크기·모듈·CLI 호출 종류·프로젝트 문서 참조가 있다. 코드 15개 외에 기준/백업 폴더에 복제된 JS가 있으나 원래 소스 사본을 미사용 실행 코드로 판정하지 않는다.

## 유지할 제품 파일과 레거시 처리

| 파일 | 현재 역할과 유지 이유 |
|---|---|
| `src/main.cjs` | 창·접수/FIFO·상태·승인·연결/조회·알림 수명과 검사 진입점 |
| `src/codex.cjs` | RPC·프로세스·프레임/소유 턴·늦은 이벤트·Node fixture 실행 |
| `src/connection-setup.cjs` | 인증/계정 수명·CLI 검색/진단·인증/사용량 미지원 처리 |
| `src/models.cjs` | 페이지형 모델 목록과 설정 기본값 |
| `src/store.cjs` | v1 이관·v2 기록·저널/삭제 복구·동기/워커 저장 경계 |
| `src/store-worker.cjs` | 직렬 저장 Worker. 일반 require 검색만으로 미사용 판정하지 않음 |
| `src/packs.cjs` | 팩 v1/v2·이미지/페르소나·참조/내용 검사 |
| `src/pack-library.cjs` | 설치/교체/보관/복원과 사용자 편집 보존 |
| `src/personas.cjs` | Markdown 말투와 사용자 모드·복구 저널·질문 snapshot |
| `src/asset-validator.cjs` | sandbox 실제 decode·poster/크기 검사 |
| `src/response-images.cjs` | 생성/MCP 이미지 보관·소유 경로·원본 읽기 |
| `src/attachments.cjs` | 첨부 사본·해시/파일·용량과 복원 |
| `src/skins.cjs` | JSON 스킨 열거/검사 |
| `src/preload.cjs` | 권한 제한 IPC·실제 첨부/클립보드 입력 전달 |
| `src/ui/index.html`, `renderer.mjs`, `style.css` | 앱 화면·데이터 표시·빌드 원본·동적 CSS |
| `src/ui/notice.html`, `notice.js` | 별도 버디 안내창과 클릭 영역/표시 수명 |
| `src/ui/validate-images.html` | validator가 직접 여는 sandbox decode 페이지 |
| `renderer.bundle.js`, `renderer.bundle.js.LEGAL.txt`, 루트 `THIRD_PARTY_NOTICES.txt` | 재생성 가능하지만 현재 앱/패키지 실행과 라이선스 고지에 필요. 원본과 함께 빌드해 대조 |

다음 레거시 처리는 유지한다.

- [Store v1 이관](../../src/store.cjs:63): 원본 백업 후 현재 기록으로 옮긴다. 신규 저장이 v2라는 이유로 기존 파일 읽기를 없애지 않는다. 현재 단위에서 이관을 확인한다.
- [팩 v1/v2](../../src/packs.cjs:12): 실제 기본 팩이 v1 2개와 v2 2개다. v1 상태 fallback과 v2 blink는 서로 다른 사용 계약이다.
- [CLI Node 어댑터](../../src/codex.cjs:21): 6개 fixture와 개발 런처가 사용한다. JS 런처를 shell 실행으로 바꾸지 않는다.
- [인증 미지원 처리](../../src/connection-setup.cjs:111), 사용량 미지원과 선택 필드 기본값: 지원되지 않는 응답을 실제 인증/잔여량으로 표시하지 않는 경로다.
- [기록 조회의 legacy fallback](../../src/main.cjs:917): 첫 페이지 API의 명시적 미지원 `-32601`만 전체 조회로 돌아간다. 잘못된 데이터·시간/연결 실패와 구분하는 회귀가 있다.
- 저장/삭제/팩/페르소나의 저널, 링크/해시/소유 검사는 예외 복구와 다른 파일 보존을 위한 현재 코드다. 정상 실행에서 자주 보이지 않는다는 이유로 제거하지 않는다.

프로세스·저장·팩·첨부·decode는 책임과 실패 경계가 달라 모듈 통합 후보로 잡지 않았다. 단순 출력 경로 수정과 분기는 현재 함수 안에서 처리하면 된다.

## 검사와 생성 스크립트 35개의 판단

| 분류 | 개수 | 파일 |
|---|---:|---|
| 빌드/구문/lint/생성 | 7 | `build`, `check`, `lint-css`, `package`, `create-characters`, `create-icons`, `icns` |
| 실행기/패키지 | 3 | `integration-smoke`, `verify-package`, `packaged-resource-smoke` |
| main의 조건부 검사 | 16 | `alpha-ui-smoke`, `attachments-ui-smoke`, `buddy-expansion-smoke`, `buddy-features-smoke`, `buddy-lifecycle-smoke`, `connection-image-smoke`, `deletion-ui-smoke`, `floating-ui-smoke`, `history-ui-smoke`, `model-ui-smoke`, `native-floating-smoke`, `performance-ui-smoke`, `pet-pointer-smoke`, `resource-smoke`, `stability-ui-smoke`, `timing-ui-smoke` |
| 별도 Electron decode 진입점 | 1 | `asset-validation-smoke` |
| alpha UI의 하위 검사 | 3 | `buddy-name-smoke`, `pet-notice-smoke`, `ui-layout-smoke` |
| 실제 CLI 입력/응답/삭제 검사 | 5 | `codex-smoke`, `codex-delete-smoke`, `persona-real-smoke`, `real-input-smoke`, `real-buddy-modes-smoke` |

모두 `scripts/*.cjs`다. 기본 통합 14종에 직접 들어있지 않은 스크립트도 npm 명령, main의 flag, 상위 검사 또는 README의 직접 실행 경로가 있다. 특히 `real-buddy-modes-smoke.cjs`는 단위에서 내용을 평가하고 직접 실행 시 실제 계획/리뷰 응답을 검사한다. 이 감사에서는 실제 모델을 호출하지 않았다. `native-floating-smoke`는 아직 필요한 OS 드래그 수용 경로다.

`test/*.test.cjs` 6개는 `npm test` glob으로 실행되므로 일반 import가 없다고 삭제하지 않는다. fixture 6개도 프로토콜·연결·기록·삭제·말투·실패 시나리오가 달라 이름만 합치지 않는다. 현재 의존성 3개와 개발 의존성 5개는 renderer·Electron·빌드·CSS/JS lint·패키징에서 모두 사용한다. `package-lock.json`과 사용 중인 `node_modules`를 미사용 라이브러리로 분류하지 않았다.

## 자산 중복과 생성 원본

| 팩 | 스키마 | 파일 수 | 미참조/누락 |
|---|---:|---:|---|
| onggi-clip | 1 | 13 | 없음 |
| onggi-sprout | 1 | 13 | 없음 |
| onggi-clip-blink | 2 | 13 | 없음 |
| onggi-pixel-bean | 2 | 14 | 없음 |

SHA-256이 같은 파일은 **11묶음**, 사본 분량은 **10,430 bytes**다. 일부 정적 상태 SVG와 말투 MD가 같지만 현재 manifest가 각각 참조하며 각 팩은 독립 내보내기를 지원한다. 팩 밖 공통 MD나 symlink로 바꾸면 소유 범위 검사를 깨거나 외부 파일이 필요한 팩이 된다. 용량 이득이 약 10KiB이므로 기본 권고는 유지다.

한 팩 안의 동일한 SVG를 같은 상태 파일로 참조하는 최적화는 가능하지만 manifest·생성기·팩 해시·내보내기 회귀를 함께 바꿔야 한다. 생성기를 그대로 두고 사본만 지우면 다시 생성되거나 팩 로드가 실패한다. 이 작업의 우선순위는 낮다.

자산 7개도 모두 역할이 있다. `brand.png`는 CSS 상단 로고, `tray.png`/`tray@2x.png`는 macOS 메뉴 막대와 Retina, `icon.png`/`icon.ico`/`icon.icns`는 앱·Windows/macOS 패키징, `tray-source.png`는 원본 생성 입력이다. `.icns`와 `.ico`를 현재 OS에서 직접 열지 않는다는 이유로 삭제하지 않는다. 3개 스킨은 폴더 열거로 불러오는 선택 항목이다.

## 문서의 레거시 분리와 오래된 안내

현재 `docs` 최상위는 28개, `docs/history`는 14개다. 파일이 오래됐다는 사실보다 현재 계약·남은 요구·실행 당시 결과가 섞였는지를 기준으로 정리한다.

| 처리 | 문서 |
|---|---|
| 현재 문서 유지 17개 | `ALPHA_REPORT`, `ARCHITECTURE`, `BUILD_GUIDE`, `PROJECT_REVIEW`, `CHARACTER_PACKS`, `CONVERSATIONS`, `DELETE_CONVERSATIONS`, `FIRST_RUN_REVIEW`, `FLOATING_PET_UPDATE`, `LOCAL_STABILITY`, `MARKDOWN_MODELS`, `BUDDY_MODES_REVIEW`, `RESPONSE_TIMING`, `UI_UX_REFINEMENT`, `BUDDY_PRODUCT_REVIEW_2026-10-10`, `BUDDY_FOLLOWUP_RESULT_2026-10-10`, `SLACK_INTEGRATION_PLAN` |
| 완료 기록의 history 이동 후보 7개 | `CLEANUP_PLAN_2026-10-10`, `CLEANUP_RESULT_2026-10-10`, `CHANGE_REVIEW_2026-10-10`, `CHANGE_REVIEW_ALPHA16_2026-10-10`, `CHANGE_REMEDIATION_RESULT_2026-10-10`, `QUALITY_CYCLE_RESULT_2026-10-10`, `BUDDY_EXPANSION_RESULT_2026-10-10` |
| 현재 계약/미완료 요구와 완료 기록 분리 후보 4개 | `CONNECTION_AND_IMAGES_2026-10-08`, `ATTACHMENTS_AND_QUEUE_2026-10-10`, `BUDDY_FOLLOWUP_PLAN_2026-10-10`, `BUDDY_ROADMAP_2026-10-10` |
| 기존 history 14개 | 날짜·검사/측정 수·미검증 조건 보존. 현재 안내로 되돌리거나 숫자를 최신 결과로 덮지 않음 |

모두 `.md`다. `SLACK_INTEGRATION_PLAN`은 대기 중인 요구이므로 완료한 레거시로 삭제하지 않는다. 현재 문서에 조건/요약을 남기고 상세 제안을 별도 backlog로 옮기는 선택은 가능하다. 연결/첨부 문서는 현재 사용법을 먼저 `FIRST_RUN_REVIEW`, `CONVERSATIONS` 등에 옮긴 뒤 당시 구현·검증 부분을 이력으로 분리해야 한다. 최신 실행 결과도 다음 버전에서는 이력이 될 수 있다.

우선순위 P3인 안내 갱신 후보는 다음과 같다.

- [README:42](../../README.md:42)는 기본 캐릭터를 2개로 설명한다. 현재 폴더에는 위 4팩이 있으며 모두 기본 성격과 4개 말투를 갖는다. [CHARACTER_PACKS:60](../CHARACTER_PACKS.md:60)의 예시 안내도 현재 기본 팩 목록과 맞추는 것이 좋다. 단, 실제 말투 검사가 2개 캐릭터를 대상으로 했다는 과거 결과는 4개로 바꾸지 않는다.
- `BUDDY_EXPANSION_RESULT`와 `CHANGE_REMEDIATION_RESULT` 머리말은 최신 후속을 아직 `현재 alpha17/build33`으로 안내한다. 당시 결과의 날짜/검사 수는 보존하고 최신 문서 안내를 alpha18 결과 또는 고정된 `ALPHA_REPORT`로 연결한다.
- 6개 문서의 로컬 Markdown 링크 **121개**가 `/Users/jhpark/code/my_budy/...`에 고정돼 있다. 이 Mac에서는 존재하지만 다른 clone/PC에서는 같은 문서의 위치를 찾지 못할 수 있다. 이동 전 상대 링크로 정돈하고 코드 위치는 해당 이력 시점임을 유지한다. [절대경로 링크 목록](../../artifacts/legacy-file-review-2026-10-12/absolute-document-links.json).

45개 프로젝트/루트 Markdown 문서의 **403개 로컬 파일 링크**는 현재 Mac에서 모두 존재했다. 이 결과는 다른 환경의 경로·외부 웹 링크·모든 과거 코드 위치의 의미까지 보장하지 않는다. [문서 목록과 링크](../../artifacts/legacy-file-review-2026-10-12/document-inventory.json).

## 주석과 제거 판단의 예외

생성 코드 제외 JS의 실제 주석은 7개이며 fixture shebang 4개는 별도다. 제품 주석 6개는 RPC 소유 턴, 늦은 프로세스 실패, OS 구석 동작의 미검증, 편집 초안 복구, 삭제 알림 순서, 질문 접수 순서를 설명한다. CSS lint의 1개는 검사 전에 기본 색 값을 치환하는 이유를 설명한다. 작업 완료로 무의미해진 주석, TODO/FIXME, lint 억제는 발견하지 못했다. 생성 번들의 라이선스 주석/고지는 유지한다.

정리의 예외도 파일별로 적용한다. 실행 중인 프로필의 캐시는 다음 실행에서 다시 생기거나 열린 파일이 남을 수 있다. 실패 프로필에는 재현에 필요한 DB·state·저널이 있으므로 성공 프로필과 같이 지우지 않는다. `real-smoke-profile`에는 실제 모델 검사 기록이 있어 합성 캐시와 구분한다. 이미지 사본과 첨부의 동일한 이름만으로 중복 여부를 판단하지 않는다. 문서 이동은 인바운드·아웃바운드 링크와 과거 결과 경로를 같이 확인해야 한다.

`git clean`, `artifacts`/`dist` 전체 삭제, 확장자별 일괄 삭제는 현재 보유/복구 판단에 맞지 않는다. 현재 일반 build30·후보 build34·직전 후보 build33, 소스 기준 사본·원래 실패와 전후 측정은 유지한다.

## 권장 작업 순서와 검증

1. 선택형 계측 출력, decode 프로필, 공용 UI 결과 경로를 기존 함수 안에서 정리한다. 새 빈 출력 경로, 반복 실행, 같은 실행의 재시작 연결, 실패 프로필 보존을 확인한다.
2. 생성된 폴더·파일의 명시적 목록을 정한다. 검사 프로세스가 종료됐고 전용 검사 자료인지 확인한 뒤 캐시와 `.DS_Store`부터 정리한다. state·기록·원본 이미지·첨부·저널은 따로 보존한다.
3. build31/build32를 다른 복구 위치에 보관할 경우 파일/링크·해시·실행 정보와 선택 복원을 확인한 뒤 기존 위치를 정리한다. 최신/일반/직전 후보는 유지한다.
4. 결과의 원본/동일성·실패 의미를 확인한 자료만 통합한다. 일회성 코드 15개와 완료 문서 7개는 결과·참조와 함께 이동한다. 모든 코드를 재사용 라이브러리로 만드는 작업은 필요 없다.
5. 기본 캐릭터 수·최신 문서 안내·개인 Mac 절대경로 링크를 갱신한다. 현재 요구와 과거 검사 수를 구분하고 날짜별 측정 값을 유지한다.
6. 소스 변경 범위에 맞춰 lint·단위·해당 GUI/패키지 검사를 실행하고 삭제/보존 목록·문서 링크·해시를 대조한다. 팩/자산을 바꾸면 생성기·내보내기·패키지 84개 목록도 함께 확인한다.

이번 검토에서 workspace 단위 **126/126**과 lint/CSS가 통과했다. `artifacts`/`dist` 없이 소스를 복사한 임시 환경에서도 **126/126**이 통과했다. 선택형 계측만 위 ENOENT를 예상 실패로 재현했고 임시 복사본을 정리했다. [단위](../../artifacts/legacy-file-review-2026-10-12/workspace-unit.log), [깨끗한 환경 단위](../../artifacts/legacy-file-review-2026-10-12/clean-unit.log), [lint](../../artifacts/legacy-file-review-2026-10-12/lint.log).

2026-10-10에 실행한 Electron 14종의 소스 22개와 패키지 84개 파일 해시는 이번에도 현재 파일과 일치했다. 이는 이전 실행 근거의 일치 대조이며 GUI/패키지 동작을 2026-10-12에 다시 실행한 결과가 아니다. 실제 모델 질문은 **0회**, 로그인/권한/실사용 데이터 변경과 기존 프로젝트 파일 제거는 **0건**이다. 최종 파일/링크 대조는 [검토 상태](../../artifacts/legacy-file-review-2026-10-12/review-validation.json)에 기록한다.
