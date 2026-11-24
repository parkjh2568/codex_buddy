# 클래식 도우미 테마 구현 결과

2026-10-22의 소스 구현·기본 검사·패키지 정적 대조와 사용자 허용 후 실행한 대표 화면/ASAR 검사 기록이다. 현재 후보는 [릴리스 현황](../ALPHA_REPORT.md), 남은 수용은 [TASKS](../../TASKS.md#클래식-도우미-테마)를 따른다. 아래 최초 구현 단계의 미실행 설명과 후속 실행 결과를 구분한다.

## 변경과 리뷰

- 기존 `skinId`에 `classic` 팔레트와 본체 CSS를 추가했다. 노란 안내/심플 말풍선, 회색 상세/설정, 흰 입력, 입체 버튼·선택/눌림/점선 포커스를 구현했다. 기존 3스킨 CSS 본문은 그대로 두고 추가 규칙을 클래식 범위에 한정했다.
- 안내 창에 스킨 ID를 반영하고 같은 팔레트의 반복 적용을 줄였다. 기존 클릭 영역 revision/ACK를 유지했다.
- 실제 스킨 ID 변경 때 입력 높이를 재계산하고 기존 resize 처리와 같은 팝업 재배치를 수행한다. 창을 다시 열거나 메시지 DOM/Markdown을 전체 재생성하지 않는다.
- 리뷰에서 파란/빨간 기본 버튼의 검은 포커스가 잘 안 보이는 문제를 수정했다. 카탈로그/말투 갱신만으로 형태 재측정을 하지 않도록 ID 변경과 팔레트 갱신을 구분했다.
- 캐릭터/MD·프로세스/모델·저장/복구 구현과 의존성은 변경하지 않았다. 기존 스킨 선택 메뉴·저장 실패 rollback을 재사용하며 새 상태 필드나 이관을 추가하지 않았다.
- 기존 화면 검사에 클래식을 추가하고 말풍선/꼬리 색상·스킨 왕복·별도 안내 형태를 확인할 준비를 했다. 준비한 GUI 검사를 실행 성공으로 기록하지 않는다.

## 실행한 검증

| 검사 | 결과·범위 |
|---|---|
| lint/CSS·구문·제공 팩·단위 | 288/288 통과, 실패/skip 0. [로그](../../artifacts/classic-theme-implementation-2026-10-22/verify.log) |
| 변경 경계 | 진행 작업·큐/기록·말투 보존, 재시작 선택 복원, 미지원 값/저장 실패, 안내의 캐시 팔레트/늦은 ACK, 팝업 포커스/재배치, 기존 30초 타이머·세대 유지 |
| 팔레트 대비 | 리터럴 18쌍. 텍스트 최소 약 4.95:1, 경계 최소 약 4.88:1. 실제 합성/hover/disabled/OS 렌더링 전체를 검증한 값은 아님 |
| 소스 범위 검토 | 기존 CSS prefix 동일, 추가 44규칙 클래식 범위. [검토 장부](../../artifacts/classic-theme-implementation-2026-10-22/review.json) |
| 후보 정적 대조 | alpha23/build41, 소스/에셋 89개+package.json·unpacked 4개·아이콘·metadata·strict 로컬 ad-hoc 서명 통과. [결과](../../artifacts/classic-theme-implementation-2026-10-22/package-static.json) |
| 이전 후보 보존 | build40 전체 디렉터리를 `dist/rollback-alpha23-build40/`로 이동. 선택 파일 hash·일반 앱/build38/build39 보존 대조. [보존 장부](../../artifacts/classic-theme-implementation-2026-10-22/package-preservation.json) |

최종 renderer 수정 뒤 후보를 다시 생성해 바이트를 대조했다. 기존 build40이나 앞선 중간 묶음을 최종 소스의 증거로 사용하지 않는다. 캐시된 공식 Electron ZIP을 사용했고 일반 실행 앱 설치/교체·사용자 프로필 접근·실제 모델 호출·GUI 실행은 수행하지 않았다. 전체 입력 hash와 최종 검증은 [실행 장부](../../artifacts/classic-theme-implementation-2026-10-22/verification.json)에 있다.

## 허용 후 화면·ASAR 실행

사용자가 별도 화면 검증 시간을 허용한 뒤 `--interactive`로 실행했다. 최초 샌드박스 실행은 Electron 시작 직후 SIGABRT로 끝났고, 실행 권한을 확장한 재시도부터 정상 검증했다. 격리 프로필·합성 데이터만 사용했고 실제 모델 호출·일반 앱 교체는 하지 않았다.

| 검사 | 실행 결과·범위 |
|---|---|
| 심플 대화 | 대표 수명 검사를 클래식으로 변경. 실제 30초 후 전체 숨김, X·버디 재열기, 초안/합성 IME/팝업 보호, FIFO·첨부 사본·이미지 2개 decode 통과. [결과](../../artifacts/classic-theme-implementation-2026-10-22/gui-retry/chat-ui/chat-ui-smoke.json) |
| 정렬·예외 | 기록 3너비×4스킨, 작은 창 복합 상태 4스킨, 클래식 100/110/120% 글자 배율과 caret 보존, 이름 변경 오류·MD 충돌 통과. 실제 OS 드래그/IME 검증과 다름 |
| 설정 | 390×580·460×740·720×900에서 4스킨 선택기/시간 입력/캐릭터 카드 기준선·비율·가로 넘침 통과. [기하 결과](../../artifacts/classic-theme-implementation-2026-10-22/layout/ui-layout-smoke.json) |
| 테마·복구 | 4스킨 심플 360px 왕복·꼬리 색/형태·모델 팝업, 별도 클래식 안내 창, 숨김 캐시·renderer crash 복구 통과. [통합 장부](../../artifacts/classic-theme-implementation-2026-10-22/skin-recovery/integration.json) |
| ASAR 모듈 | build41의 89파일 바이트 대조·카탈로그·큰 이미지 원본/미리보기·첨부/저장 재읽기·검색 worker·격리/복원 통과. [결과](../../artifacts/classic-theme-implementation-2026-10-22/package-runtime/package-verification.json) |
| ASAR 본체 | 본체를 로드해 5상태(움직임·축소·정숙·일상·숨김)를 각 2초/10표본으로 관찰하고 종료. [결과](../../artifacts/classic-theme-implementation-2026-10-22/asar-resources/resource-smoke.json). 장시간 성능·배터리 개선률이 아님 |
| 재검사 | 검사 스크립트 수정 후 `npm run verify` 288/288 통과. [로그](../../artifacts/classic-theme-implementation-2026-10-22/verify-after-gui.log) |

ASAR 실행은 Electron 검사 진입점이 실제 `app.asar`를 로드하는 방식이다. 설치된 일반 앱 실행·교체와 구분한다. 실제 30초 대기와 대표 정렬 성공을 계획의 모든 상태 조합 수용으로 확대하지 않는다.

## 남은 수용

후속 [따뜻한 편집 UI 수용](WARM_EDITORIAL_UI_RESULT_2026-10-22.md)에서 클래식도 360/400px·위/아래 배치와 입력 경계를 확인했다. [계획의 상태/크기 행렬](../plans/CLASSIC_ASSISTANT_THEME_PLAN.md#예외와-회귀-검증) 중 클래식 삭제 확인·승인 모달의 별도 포커스/대비와 남은 복합 상태 조합은 별도다. 실제 앱 설치/독립 실행과 장시간 자원·배터리 관찰도 별도다.

GUI는 사용자 검증 시간 허용과 `--interactive`를 모두 필요로 한다. 새 캐릭터·물리 IME/절전·다중 모니터·Windows/Intel·외부 배포는 이번 자동 검사로 완료 처리하지 않는다. [작업 규칙](../../AGENTS.md)과 [검증 명령](../BUILD_GUIDE.md#4-검증-명령과-현재-windows-한계)을 따른다.
