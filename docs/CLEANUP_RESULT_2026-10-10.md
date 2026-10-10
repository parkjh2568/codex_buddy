# 프로젝트 불필요 내용 정리 결과

2026-10-10. [제거 계획](CLEANUP_PLAN_2026-10-10.md)의 0→6 순서로 보존·검증 이전·문서·산출물·코드·패키징·최종 확인을 진행했다. 기존 미커밋/미추적 구현을 유지했고 단순 상태/초안 로직은 함수 안에 인라인으로 정리했다.

현재 설치 경로의 앱은 **alpha.14/build29**, 직전 롤백 후보는 **build28**로 유지했다. 정리한 코드와 제외 정책은 별도 **staging build30**에 생성·검증했으며 설치 앱을 교체하지 않았다. 현재 버전은 [빌드 가이드](BUILD_GUIDE.md)를 따른다.

## 제거·정리한 내용

| 범위 | 실제 작업 | 보존한 경계 |
|---|---|---|
| 제품 코드 | 숨긴 pet 버튼의 text/aria와 전용 labels 제거, 중복 send.disabled 갱신 제거, 새 대화의 텍스트/첨부 초안 이전 조건 인라인 통합 | pet-bubble의 hidden·timer·syncPetLayout, 실제 notice 문구/접근성·클릭 영역, 제출 직후 동기 잠금 |
| CSS·검사 | 도달하지 않는 settings-button.active, 장식성 CSS 주석, UI 검사 문자열의 미사용 buttons 계산 제거 | 탭 active·hover, 실제 행별 버튼 치수/정렬 검사, 수명/순서 조건을 설명하는 주석 |
| 팩 설치 | 구 import-pack IPC 제거. 실패/재시도 검사를 pack-preview→pack-apply로 이전 | 미리보기 무변경·후보 snapshot·토큰 확인·persona 설정 실패 후 디스크/선택/메모리 rollback과 같은 후보 재시도. HTML 가져오기 버튼 유지 |
| 스크립트 | 날짜별 일회성 main 스크립트 2개와 ignored 검증 사본 3개 압축 보관 후 제거 | 실제 소유 턴 중단은 codex:smoke에 유지. 배포/worker/이미지/첨부/실제 입력/통합 검사를 공식 명령으로 이전 |
| 문서 | 완료 조사/계획·반복 설명을 history로 분리. 현재 사용법/규격·TASKS를 갱신하고 링크/앵커 수정 | 날짜별 검사 수·성공/실패·환경·제한·미착수 backlog. Slack/중앙 FIFO·Windows·실제 로그인·서명은 완료로 바꾸지 않음 |
| 이전 산출물 | 명시한 47개 폴더/앱의 13,517개 항목을 압축 보관·대조 후 제거. build24/26·중복 build29 staging, 과거 테스트 프로필/호스트·스키마·iconset 포함 | 현재 앱/직전 롤백·개인 그림/기록·원본 코드 스냅샷·최종 JSON/로그/핵심 화면 |
| 배포 | README/TASKS/AGENTS/.gitignore·renderer.mjs·tray-source.png를 ASAR에서만 제외 | 소스 원본, 번들/LEGAL/THIRD_PARTY_NOTICES, Store/worker unpacked, validator/notice, 기본 3팩·3스킨·필요 자산, Electron LICENSE/Chromium 고지 |

활성 문서는 시작 스냅샷의 24개/3,634줄에서 21개/약 1,600줄로 줄였다. 완료 기록은 이력 14개 파일에 보존했다. 현재 계획/결과 문서도 활성 문서 수에 포함한다.

역할/실패 경계가 다른 AttachmentStore·ResponseImages·Store·CLI·팩 모듈은 합치지 않았다. 사용 중인 의존성과 package-lock, 캐릭터 39개 파일, 스킨·아이콘/생성 원본은 삭제하지 않았다. 시작 스냅샷과 대조한 보호 대상 57개 파일의 해시는 그대로다.

## 재사용 검사와 추가 예외 보강

- `npm run smoke:integration`: 13종 격리 검사를 선택/전체 실행한다. 매번 새 프로필을 만들고 결과/화면을 보존한 뒤 성공한 프로필만 정리한다. 실패/timeout은 실패 종료와 해당 프로필 보존으로 처리한다.
- `npm run verify:package`: 플랫폼/CPU별 기본 staging 또는 `--archive`/`--installed` ASAR를 대조한다. 예상 파일 목록을 엄격히 확인하고 worker·원본/미리보기·첨부 사본·저장 복원을 검사한다. 개인 기록은 `--image-items`의 base64 이미지 결과 JSON으로 명시적으로 선택한다.
- `npm run smoke:packaged-resources`: 날짜/Mac 경로 종속을 제거하고 ASAR/출력 경로를 받는다. 이번에는 각 1초의 3단계 진입점만 확인했다.
- `npm run codex:attachments`: 합성 파란 이미지/파일 표식으로 실제 입력을 검사하는 정식 명령이다. `codex:smoke`에는 실제 소유 턴 중단/검증 thread 보관을 추가했다. 두 실제 CLI 검사는 이번 정리에서 재호출하지 않았다.
- 첨부·이미지 UI 결과도 날짜별 과거 폴더를 덮어쓰지 않고 ONGGI_SMOKE_ROOT 또는 일반 artifacts 경로에 기록한다. 전체 회귀 중 발견한 기존 첨부 결과의 날짜 경로를 수정하고 지정 경로에 다시 확인했다. 기존 UI 결과 3개는 이 실행에서 갱신됐으며 이전 build29의 원본 화면이라고 주장하지 않는다.
- 패키징은 `--staging`만 허용한다. 오타/미지원 인수는 런타임 조회나 앱 덮어쓰기 전에 거절한다. `--stagin` 실패 주입에서 설치/staging ASAR 해시가 그대로였다.

프로필 복제/대조·성공 후 정리를 각각 확인했다. 원래 실행 경로의 재사용은 로그인/fixture 상태를 남겨 다음 검사를 실패시킬 수 있어 생성 경계를 바꿨다. 실제 운영 프로필을 검사 결과 폴더로 사용하지 않았다.

## 이번에 실행한 검증

| 검사 | 결과와 범위 |
|---|---|
| JS/CSS 린트·구문·기본 팩 | 통과. 신규/수정 scripts 포함 |
| 단위 회귀 | **90/90 통과**. 저장/프로토콜/첨부·턴·팩 실패와 재시도 포함 |
| 격리 UI 통합 | **13/13 통과**. 첨부·연결/이미지·decode·모델·기록·시간·삭제·긴 기록·버디·플로팅·화면 복구·팩 수명·0팩. 실행 src 해시가 최종 src와 일치 |
| 별도 체험 UI | 통과. Markdown·notice·이름·460×740/390×580 정렬/입력 확장·큐·캐릭터 전환 |
| 같은 출력 경로 반복 | 첨부/연결 검사 및 연결 재실행 통과. 새 프로필·성공 후 삭제·JSON/화면 보존 확인 |
| 검사 실패 주입 | Electron Node mode로 decode 창 실행을 막음. exit=1·passed=false·실패 로그/프로필 보존을 확인한 예상 실패 |
| 알 수 없는 검사 이름/패키징 오타 | 오류 종료. 검사/패키징이 잘못된 경로에서 진행되지 않음을 확인 |
| staging ASAR | 필수 원본 **70개 일치** + package.json, 개발 파일 6개 부재, unpacked Store/worker·ICNS 원본 일치. 추가/누락 파일 없음 |
| 합성 큰 이미지 | 1024×1536, 4,734,779 bytes 원본과 341×512 미리보기·표시·재연결/저장 복원 통과 |
| 누락됐던 기존 그림 | 1024×1536, **3,371,159 bytes**. 원본 SHA-256/미리보기·첨부 사본·worker 저장 복원 일치. 격리 검사이며 사용자 대화에 직접 기록하지 않음 |
| ASAR 자원 래퍼 | 1초씩 visible/reduced/hidden 3단계, 결과 저장/정상 종료 통과. 30분/배터리/성능 향상 검증으로 해석하지 않음 |
| 문서 | 활성/이력 문서의 상대 파일 링크·앵커 확인. 숫자와 최종 건수는 document-check.json |

패키징 첫 실행은 제한된 네트워크에서 GitHub 조회 실패로 종료됐고, 허용된 실행 환경의 재시도로 성공했다. 선택형 `.icon` 형식이 없다는 Packager 경고가 있었으나 기존 ICNS와 실제 번들 아이콘 바이트 일치를 확인했다. Windows/Intel·실제 브라우저 로그인·물리 클릭/절전·서명/공증·실제 모델/30분 비교 측정은 추가로 검증하지 않았다.

## 용량과 배포 확인

원래 제거 후보의 할당량은 약 **1,860.8MiB**였다. 복구용 런타임/프로필 압축본 약 **516MiB**, 소스/스크립트 보관본과 새 staging build30을 남겼다. 성공한 이번 검사 프로필 6개도 결과/화면을 먼저 보존하고 정리했다. 실패 주입 프로필은 진단용으로 남겼다.

`artifacts`+`dist`의 합산 폴더 할당량은 약 **2.46GiB→1.45GiB**, 순감소 약 **1.02GiB**다. 최종 정확한 `du -sk` 값은 [space-result.json](../artifacts/cleanup-2026-10-10/space-result.json)에 기록한다. node_modules를 제거하거나 APFS 전체 가용 공간 증가를 보장한 수치는 아니다.

ASAR는 **1,609,015→1,177,440 bytes**로 약 421.5KiB 줄었다. Electron 런타임 전체의 성능 개선 수치가 아니다. 설치 build29/롤백 build28의 ASAR 해시는 시작 시점과 같고, staging build30의 SHA-256은 `872faa099499c941a7e541c0cc64930479d610209e83357537cedf2811bc2dfc`다.

## 근거·복구

검사/변경/보존 목록은 [작업 자료 폴더](../artifacts/cleanup-2026-10-10/)에 있다. 이 폴더는 ignored이며 결과와 복구 압축본을 보존한다. `git clean`·전체 artifacts/dist 삭제·확장자별 일괄 삭제는 사용하지 않았다. Git 커밋/푸시는 수행하지 않았다.

| 보관 파일/목록 | 내용 |
|---|---|
| source-before.tar.gz / source-before.json / git-diff-before.patch | 시작 tracked+untracked+번들 145개 파일과 해시, 기존 변경 |
| source-after.tar.gz / source-after.json / git-diff-after.patch | 정리 후 코드/문서/자산과 해시, 미커밋 전체 변경 |
| runtime-and-profiles-before.tar.gz / removal-manifest.json / removal-result.json | 47개 원래 경로·파일/링크·해시·삭제 결과. 압축본의 payload 모두 대조 |
| one-off-scripts-before.tar.gz / one-off-scripts-result.json | 삭제한 일회성 scripts/ignored 검증 코드 5개 |
| document-archive.json / docs/history | 조사/계획 11개 원본의 링크만 이동 수정한 이력, 측정/빌드 기록·현재 backlog 연결 |
| integration / runner-repeat / runner-failure / package-verification / actual-image-verification | 전체/반복/실패 주입·합성/기존 이미지 패키지 근거 |
| change-verification.json / final-verification.json | 보호 대상/앱 해시, 최종 검증 요약 |

복구할 때는 새 빈 폴더에 압축본을 풀어 필요한 원본과 해시를 비교한 뒤 선택 적용한다. 전체 압축본을 현재 작업 폴더에 바로 풀어 새 소스/staging을 덮어쓰지 않는다. 기존 개인 그림/기록 JSON·실사용 OnggiBot 프로필·CLI 인증/세션/생성 이미지·원본 코드 스냅샷은 정리 대상에서 제외했다.
