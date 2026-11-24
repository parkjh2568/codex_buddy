# 따뜻한 편집 UI 구현 결과

2026-10-22에 선택한 따뜻한 편집 구성을 반영했다. 기본 paper는 `따뜻한 종이`로 표시하며 종이색 바탕·먹갈색 글자·엄버 강조를 사용한다. 현재 후보와 패키지 실행 상태는 [릴리스 현황](../ALPHA_REPORT.md), 설계·수용 기준은 [작업 계획](../plans/WARM_EDITORIAL_UI_PLAN.md), 사용법은 [사용자 가이드](../USER_GUIDE.md)를 따른다.

## 구현과 수정

- 이름/닫기 헤더와 한 세트의 대화·이전 대화·설정 탐색으로 정리했다. 현대 스킨은 720px 이상 상세에서 104px 좌측 탐색, 좁은 창/클래식은 가로 탐색을 쓴다. 기존 요소 ID 221개와 form·입력·메시지 노드를 유지했다.
- 짧은 화면 제목에 시스템 명조를 적용하고 본문·조작은 고딕으로 유지했다. 첫 화면의 겹치는 소개/장식과 설정의 큰 이름 카드를 줄이고, 기록을 목록 행으로 정돈했다. 기존 투명 assistant 본문은 문단·라벨·간격을 개선했다.
- 상세 입력은 하단선·포커스, 심플은 작은 외곽선으로 구분한다. 말투·+·모델·중단·전송, 첨부 제거와 목적/스킬 요약을 유지했다. 친구 크기는 친구 모습에, 표시 프로필은 움직임에, 시간 측정은 대화/화면에 배치했다.
- resize/스킨 재배치를 한 프레임에 모으고 최신 입력 높이 뒤 팝업을 배치한다. 숨긴 화면은 측정을 미루며 표시/대화 탭 복귀에서 높이를 계산한다. 초안·caret·스크롤·FIFO·승인·전달 세대와 30초 보호 계약을 유지했다.
- 별도 notice·꼬리에도 paper 팔레트가 전달된다. 초기 CSS 색상과 JSON을 일치시키고 고정 녹색 glow·그림자·상태 색을 역할 변수로 정리했다. night/mono/classic 팔레트·캐릭터·의존성·CLI/저장 코드는 변경하지 않았다. 새 프로덕션 헬퍼·설정 필드·타이머·외부 폰트/네트워크 의존성은 추가하지 않았다.

| 발견한 문제 | 반영한 수정·검증 |
|---|---|
| 기존 시간 표시 검사가 탭 2개만 기대 | 한 탐색 집합의 설정 탭까지 기대값 반영. 시간 단계·FIFO·저장 실패·지연 ACK 검증은 유지 |
| MD 편집창의 뒤쪽 CSS가 조작 경계를 장식선으로 덮음 | 해당 입력의 경계 역할을 수정. 실제 4스킨 입력/버튼 색상 28조합 확인 |
| 설정에서 창 폭을 줄인 뒤 대화 복귀 시 입력 높이 부족 가능 | 기존 탭 복귀·표시 경로에서 높이 재계산. 같은 초안/입력 노드와 자연 높이 확인 |
| 현대 텍스트 바로가기 여백이 클래식 입체 버튼을 좁힘 | 클래식에 최소 클릭 크기·내부 여백 복원. 최종 통합·설정 정렬 재검사 |
| 스킨 변경 직후 캡처가 앞선 프레임을 포함 | 기대 스킨 상태를 기다리고 프레임 제출 뒤 촬영. 캡처를 기하·조작 검사와 함께 판단 |

## 실행한 검증

사용자가 이번 작업의 화면 검증을 허용한 뒤 GUI에 `--interactive`를 명시했다. 실제 모델 호출과 일반 실행 앱 교체는 하지 않았다. 최초 실패 기록을 최종 성공으로 재사용하지 않는다.

| 범위 | 결과·근거 |
|---|---|
| 기본 검사 | lint/CSS·구문·제공 팩·단위 289/289, 실패/skip 0. [로그](../../artifacts/warm-editorial-ui-implementation-2026-10-22/verify.log) |
| 최종 통합 | 15/15 실제 실행·입력 전후 동일·격리 프로필 제거. 첨부·이미지·모델·기록·시간·삭제·성능·스킨·복구·수명 포함. [장부](../../artifacts/warm-editorial-ui-implementation-2026-10-22/acceptance/integration.json) |
| 정렬 | 상세 390×580·460×740·720×900, 설정 3크기×4스킨의 행/버튼/이미지·가로 넘침 통과. [기하 결과](../../artifacts/warm-editorial-ui-implementation-2026-10-22/alignment/ui-layout-smoke.json) |
| 반응형과 수명 | 719/720/721px의 탐색·초안/caret/노드·팝업, 좁은 대화 복귀 높이, paper 100/110/120%, 실제 30초 전체 숨김·보호·X·버디 재열기 통과. [대화 검사](../../artifacts/warm-editorial-ui-implementation-2026-10-22/acceptance/chat-ui/chat-ui-smoke.json) |
| 보충 상태 | 4스킨×360/400px×위/아래 16조합, 8개 합성 첨부·6줄 초안·승인 명령/거절 접근 통과. [결과](../../artifacts/warm-editorial-ui-implementation-2026-10-22/extra-acceptance/extra-ui.json) |
| 대비 | paper 리터럴 텍스트 18조합 최소 약 4.57:1, 실제 입력/버튼 28조합의 텍스트 최소 약 6.44:1·경계 약 3.24:1. 전체 합성/OS/비활성 상태를 망라한 값은 아님 |
| 변경 범위 | ID/한 탐색 집합·root/paper 일치·다른 팩/팔레트·의존성 보존. [검토](../../artifacts/warm-editorial-ui-implementation-2026-10-22/review.json) |
| 후보 정적 | build42 소스/에셋 89개+package.json·unpacked 4개·아이콘·metadata·strict 로컬 ad-hoc 서명 통과. [결과](../../artifacts/warm-editorial-ui-implementation-2026-10-22/package-static.json) |
| ASAR 실행 | 실제 ASAR의 이미지/첨부·저장/검색 worker·격리/복원 통과. [결과](../../artifacts/warm-editorial-ui-implementation-2026-10-22/package-runtime/package-verification.json) |
| 단기 자원 | ASAR 본체 시작/종료와 움직임·축소·정숙·일상·숨김 5상태 각 2초/10표본 관찰. [결과](../../artifacts/warm-editorial-ui-implementation-2026-10-22/asar-resources/resource-smoke.json). 장시간 배터리 평가와 별도 |

기존 GUI 스크립트를 확장했고 화면 없는 검사는 색상 대비 정책과 기존 resize 경계 검사를 보강했다. 검사 수 증가를 위해 구현을 복제하는 테스트나 새 GUI 제품 진입점을 추가하지 않았다. 보충 검사는 artifacts의 격리 bootstrap을 사용한다. resize 프레임 통합을 검증했으며 속도/배터리 개선률을 주장하지 않는다.

## 후보와 남은 수용

build41 전체 앱 디렉터리를 `dist/rollback-alpha23-build41/`에 보존했다. [보존 장부](../../artifacts/warm-editorial-ui-implementation-2026-10-22/package-preservation.json)는 직전 후보와 일반 앱·이전 보존본의 선택 파일 hash를 대조한다. 새 후보의 최종 바이트·ASAR 실행 결과는 [릴리스 현황](../ALPHA_REPORT.md)을 따른다.

설치된 일반 앱 독립 실행·교체, 물리 한글 IME·스크린리더·잠금/절전·다중 모니터/Spaces·Windows/Intel과 장시간 배터리 수용은 별도다. 합성 composition·Chromium pointer/geometry를 해당 실기로 확대하지 않는다. 소스 검사와 Electron 검사 진입점의 ASAR 로딩은 별도 실행 증거이며, 이전 build41 검증은 새 후보 실행을 대신하지 않는다.
