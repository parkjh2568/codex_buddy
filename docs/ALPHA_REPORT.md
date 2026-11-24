# 현재 검증 상태

아래 실행 증거의 기준일은 **2026-10-22**이다. 기본 검사·패키지 정적 대조와 실제 화면 실행을 구분한다. 환경은 macOS Apple Silicon·Node.js 24.21.0이다.

| 대상 | 상태 | 근거 |
|---|---|---|
| 소스 | 0.1.0-alpha.23, 따뜻한 편집 UI·paper 팔레트·반응형 탐색 포함 | [최종 입력·검증 장부](../artifacts/warm-editorial-ui-implementation-2026-10-22/verification.json) |
| 기본 검사 | lint/CSS·구문·제공 팩·단위 289/289, 실패/skip 0 | [실행 로그](../artifacts/warm-editorial-ui-implementation-2026-10-22/verify.log) |
| staging 후보 | alpha23/build42, 일반 실행 앱 설치/교체 안 함 | [패키지 정적 결과](../artifacts/warm-editorial-ui-implementation-2026-10-22/package-static.json) |
| 패키지 정적 대조 | 소스/에셋 89개+package.json, unpacked 4개·버전·아이콘·strict 로컬 ad-hoc 서명 통과 | [정적 대조 범위](../artifacts/warm-editorial-ui-implementation-2026-10-22/package-static.log) |
| 소스 화면 | 최종 통합 15/15·3크기×4스킨 설정·16개 말풍선 배치·28개 실제 색상, 반응형/초안·실제 30초 숨김·복구 통과 | [통합](../artifacts/warm-editorial-ui-implementation-2026-10-22/acceptance/integration.json), [보충](../artifacts/warm-editorial-ui-implementation-2026-10-22/extra-acceptance/extra-ui.json) |
| 현재 후보 ASAR | 실제 Electron의 ASAR loader·이미지 decode·저장/검색 worker·격리/복원, 본체 시작/종료와 5상태 각 2초 관찰 통과 | [모듈 실행](../artifacts/warm-editorial-ui-implementation-2026-10-22/package-runtime/package-verification.json), [단기 자원 관찰](../artifacts/warm-editorial-ui-implementation-2026-10-22/asar-resources/resource-smoke.json) |

[따뜻한 편집 구현 결과](history/WARM_EDITORIAL_UI_RESULT_2026-10-22.md)에 실행 범위·발견한 문제와 수정·한계를 기록했다. ASAR은 Electron 검사 진입점에서 로드했으며 설치된 일반 앱 독립 실행과 다르다. 대표 검사 성공은 모든 상태/크기 조합 수용이나 장시간 성능 개선을 뜻하지 않는다. 과거 [클래식 build41](history/CLASSIC_ASSISTANT_THEME_RESULT_2026-10-22.md), [안전성/성능 후속 결과](history/PROJECT_REVIEW_ALPHA23_2026-10-20.md#후속-실행-결과-2026-10-20), [UI 실행 기록](history/UI_UX_REFINEMENT_2026-10-20.md#uiux-구현-결과-2026-10-20), [build39 구현 결과](history/IMPLEMENTATION_RESULT_2026-10-19.md)는 당시 범위다.

## 후보와 복구 위치

| 묶음 | 경로 |
|---|---|
| 최신 후보 | dist/staging/OnggiBot-darwin-arm64/OnggiBot.app |
| 직전 build41 | dist/rollback-alpha23-build41/OnggiBot-darwin-arm64/OnggiBot.app |
| build40 | dist/rollback-alpha23-build40/OnggiBot-darwin-arm64/OnggiBot.app |
| build39 | dist/rollback-alpha23-build39/OnggiBot-darwin-arm64/OnggiBot.app |
| build38 | dist/rollback-alpha22-build38/OnggiBot-darwin-arm64/OnggiBot.app |
| 일반 실행 build30 | dist/OnggiBot-darwin-arm64/OnggiBot.app |
| 이전 보존본 | build37: artifacts/mac-followup-2026-10-15/baseline-app37.app, build33: dist/rollback-alpha17-build33/ |

같은 staging 경로를 재사용하므로 실행 시각·metadata·ASAR hash를 함께 대조한다. [전체 앱 이동과 선택 파일 hash 보존](../artifacts/warm-editorial-ui-implementation-2026-10-22/package-preservation.json)을 확인한다. 그 이전 묶음과 복구 압축본은 [이력 색인](history/README.md)에서 찾는다. 사용자 프로필을 구버전으로 자동 이관하거나 미완료 v2 말투 생성 저널을 구버전에서 복구하지 않는다.

## 환경과 배포 한계

실제 한국어 IME·잠금/절전·배터리/충전기·다중 모니터/Spaces·다른 앱 클립보드/물리 드롭·OS 알림 클릭/소리, 새 PC/미로그인 계정/다른 제공자 수용은 별도다. OS write로 클립보드를 복원한 기록은 원본 payload 재읽기 검증까지 포함하지 않는다.

Windows/Intel·혼합 DPI·Snap·네이티브/WSL·파일 잠금과 설치는 미검증이다. 로컬 ad-hoc 서명은 Developer ID·공증·Windows 서명·외부 배포 설치 프로그램과 다르다. 미완료 항목과 착수 조건은 [TASKS](../TASKS.md), 검증 명령은 [빌드 가이드](BUILD_GUIDE.md)를 따른다.
