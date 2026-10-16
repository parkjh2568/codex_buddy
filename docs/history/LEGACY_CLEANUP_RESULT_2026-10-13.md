# 전체 파일 재확인과 레거시 정리 결과

2026-10-13. `my_budy`의 기존 변경사항을 시작 사본으로 보존하고 소스·검사·자산·문서의 참조를 다시 확인한 뒤 정리를 적용했다. **실행 모듈 전체를 삭제할 근거는 확인하지 못했다.** 미사용 상태 기록 1개, 중복 CSS, 완료 문서의 위치와 낡은 현재 버전 안내를 정리했다. 새 helper·모듈·의존성·저장 형식은 추가하지 않았다.

이번 정리는 새 `+` 메뉴·30초 숨김·모서리 드래그 구현과 구분한다. 해당 요구와 전체 말풍선 숨김의 사용자 선택은 [UI 계획](CHAT_UI_REDESIGN_PLAN_2026-10-13.md)에 유지한다.

## 확인 범위

시작 파일은 생성 번들/LEGAL 2개를 포함해 **191개**였다. `.git`, 제삼자 `node_modules`, 배포 앱과 과거 검사 자료는 제품 코드 수에 합산하지 않는다.

| 범위 | 시작 파일 수 | 확인 내용 |
|---|---:|---|
| src | 23 | 실행 코드·preload·Worker·HTML·CSS·생성 번들의 진입점과 표시 상태 |
| scripts | 35 | package 명령·main 하위 검사·integration 사례·직접 실행 안내 |
| test | 13 | 단위 파일 8개와 fixture 5개의 참조·실패 경계 |
| docs | 49 | 현재/완료 문서 구분, 링크·버전·검증 시점 |
| characters | 53 | 4개 manifest와 상태 이미지·프레임·MD 참조 |
| assets / skins | 7 / 3 | 원본·플랫폼 아이콘·Retina·스킨과 생성/실행 경로 |
| 루트 | 8 | 규칙·사용법·작업 목록·package/lock·lint/ignore·고지 |

생성 번들을 제외한 JS/설정 **66개·7,742줄**을 AST로 파싱했다. literal require/import 312개 중 로컬 의존 95개에 누락이 없다. 동적 분기·단위 glob·직접 실행·HTML/CSS·manifest 참조를 함께 확인했다. 문자열의 존재를 실행 검증과 같다고 판정하지 않았다. 모든 줄의 기능적 무결성이나 제삼자 코드 전체 감사를 보장하는 수치가 아니다.

[코드 목록](../../artifacts/legacy-cleanup-2026-10-13/code-inventory.json), [의존·캐릭터 참조](../../artifacts/legacy-cleanup-2026-10-13/reference-validation.json), [시작 해시](../../artifacts/legacy-cleanup-2026-10-13/baseline.json)에 근거가 있다.

## 코드·스타일 정리

| 대상 | 처리와 근거 |
|---|---|
| 애니메이션 `dataset.frameIndex` | 제품·검사·문서·팩에서 읽는 곳이 없어 기록 제거. 실제 프레임 순서는 기존 함수 안의 `index`로 관리 |
| `frameChanges`, `animating` | 프레임 변경·정숙/숨김 검사가 사용하므로 유지 |
| CSS 4개 선택자 | `.connection-bar`, `.compact-mode .message-body`, `.queue-bar`, `.queue-entry span`의 나뉜 선언 통합 |
| hover CSS | 기본값을 반복한 `#send:hover`, `.character-card:hover` 제거. `.suggestion:hover`는 중복 background만 제거하고 테두리 피드백 유지 |

작성 원본 renderer/CSS의 감소는 **216바이트**다. 효과는 미사용 기록과 중복 유지보수 제거이며 CPU·메모리·배터리·응답 속도 개선률로 표현하지 않는다. [CSS 변경 목록](../../artifacts/legacy-cleanup-2026-10-13/css-cleanup.json).

literal 검색에서 미참조 후보였던 `motion-float`/`motion-bounce`는 유지했다. renderer가 manifest의 motion으로 클래스 이름을 만들고, 기본 팩은 float를 사용하며 팩 검증은 bounce도 허용한다. 브라우저 속성·dataset·문자열로 실행되는 검사 주입도 실제 소비를 확인해 판단했다.

설명 주석 8개와 실행 shebang 3개를 확인했다. 연결 소유권·초안 복구·접수 확정 순서·실제 글꼴 병목·OS 검증 한계를 설명하는 주석은 필요하다. 완료 TODO나 잘못된 완료 주장으로 확정해 제거할 주석은 없었다.

## 문서 정리

완료 문서 4개를 `docs/history`로 옮겼다. 날짜·검사 수·성공/실패·미확인 사항은 보존하고 링크 대상만 바꿨다.

- [2026-10-12 파일 검토](LEGACY_FILE_REVIEW_2026-10-12.md)
- [2026-10-12 파일 정리 결과](LEGACY_FILE_CLEANUP_RESULT_2026-10-12.md)
- [이전 최적화 결과](OPTIMIZATION_RESULT_2026-10-13.md)
- [alpha18 후속 실행 결과](BUDDY_FOLLOWUP_RESULT_2026-10-10.md)

이동 과정에서 **문서 15개의 링크 105개**를 갱신했다. 이후 이력 목록·새 보고서 링크 추가와 별개인 숫자다. [이동 목록](../../artifacts/legacy-cleanup-2026-10-13/document-moves.json), [본문 보존 대조](../../artifacts/legacy-cleanup-2026-10-13/document-preservation.json)에 링크 대상 외의 본문이 같음을 기록했다. 원래 문서와 기존 전체 감사 사본은 이번 `baseline/`에 보존했다.

README의 반복된 alpha16/17/18 소개를 줄이고 현재 기능·이력 연결을 유지했다. README/BUILD_GUIDE의 최신 build34 안내와 미패키징 설명을 alpha20/build36의 실제 검증 시점에 맞췄다. TASKS에서 이미 수행한 D01–D07을 다시 시작할 일처럼 설명하던 문장과 후속 우선순위도 갱신했다. 진행 중인 UI·플랫폼 수용·조건부 기능·Slack 대기는 보존했다.

## 유지한 호환·복구·자산

| 항목 | 유지 이유 |
|---|---|
| v1 저장 이관·저널·백업 | 기존 대화와 중간 저장/삭제/팩 작업 복구에 필요 |
| v1/v2 캐릭터 팩 | 기본 4팩이 두 schema를 사용하며 외부 팩 검증 계약도 유지 |
| CLI 미지원 fallback | 명시적 미지원과 잘못된 응답을 구분하고 로컬 기록을 보존하는 현행 기능 |
| fixture·smoke | 단위·격리 회귀·직접 실행 경로가 있음. 실제 CLI 검사는 별도 인증/모델 수용 범위 |
| 번들·LEGAL·고지 | HTML 실행·패키징·라이선스 전달에 필요. 번들은 현재 renderer로 다시 생성 |
| 이미지·MD·스킨·아이콘 원본 | manifest·플랫폼·생성 경로가 사용. 캐릭터 파일의 참조 누락·미참조 파일 없음 |
| main/renderer 내부 로직 | 표시·FIFO·저장·승인 수명이 연결됨. 줄 수를 줄이기 위한 일괄 helper 분리는 하지 않음 |
| 이전 앱·복구 압축본·실패 자료 | 전달/복구 근거. 기존 사용자 데이터와 함께 이번 삭제 대상으로 넣지 않음 |

## 이번 검증

| 검사 | 실제 결과 |
|---|---|
| lint / CSS | 통과. [로그](../../artifacts/legacy-cleanup-2026-10-13/lint.log) |
| 단위 | **147 통과, 실패/취소/skip 0**. [로그](../../artifacts/legacy-cleanup-2026-10-13/unit.log) |
| 구문·기본 4팩 | 통과. [로그](../../artifacts/legacy-cleanup-2026-10-13/check.log) |
| 실제 Electron 회귀 | **14종 모두 성공 결과·exit 0·성공 프로필 정리**. [결과](../../artifacts/legacy-cleanup-2026-10-13/integration-desktop/integration.json) |
| CSS 전후 대조 | **36조건 × 416개 요소의 계산된 스타일 차이 0**. [결과](../../artifacts/legacy-cleanup-2026-10-13/style-equivalence.json) |
| 문서·참조·보존 | 링크 파일/앵커·실행 입력 해시·보호 파일을 [최종 확인](../../artifacts/legacy-cleanup-2026-10-13/final-validation.json)에 기록 |

CSS 대조는 실제 Electron에서 상세 460×740/작은 390×580, 일반/compact, 글자 100/110/120%, 3개 스킨을 조합했다. 정적 제품 DOM에 답변/큐 요소를 추가하고 hover를 검사 클래스에 대응시켰다. 양쪽 animation/transition을 껐으며 검사 후 전용 프로필을 제거했다. 실제 마우스 hover·전체 외관·Windows/DPI 수용을 완료했다는 뜻은 아니다. 기존 buddy/수명 검사는 실제 프레임 변경도 확인했다.

기본 샌드박스의 최초 Electron 실행은 14종 모두 시작 단계에서 SIGABRT로 종료돼 결과 파일을 만들지 못했다. 통과로 처리하지 않고 [첫 실행](../../artifacts/legacy-cleanup-2026-10-13/integration/integration.json)에 남겼다. 이후 데스크톱에서 격리 프로필로 14종을 다시 검증했다. 실제 모델 질문·CLI 로그인·실사용 대화 삭제는 하지 않았다.

## 전달과 복구

일반 앱은 build30, staging은 build36, rollback은 build33이며 [Info.plist 조회](../../artifacts/legacy-cleanup-2026-10-13/app-metadata.json)로 확인했다. **이번 정리 소스는 build36 생성 이후 변경이다.** 개발 번들은 재생성했지만 새 앱 패키지를 만들거나 기존 앱을 교체하지 않았다. build36의 소스/ASAR 일치는 생성 당시 결과다.

시작 사본·해시·변경 diff는 [근거 폴더](../../artifacts/legacy-cleanup-2026-10-13)의 `baseline/`, `baseline.json`, `changes-from-task-baseline.diff`에 있다. 필요한 파일/문서 위치를 선택해 복구하며 현재 전체 작업 폴더를 무조건 덮어쓰지 않는다. 이전 사용자의 변경사항은 정리 시작 상태에 포함해 보존했다.

다음 UI 작업은 말투 옆 `+`, 대화 여백·설정 정렬, 답변 중심 심플 모드, 30초 뒤 입력창 포함 전체 숨김·버디 클릭 재열기, 상세 모서리 드래그다. 현재 첨부 toolbar·최근 두 카드·고정 창은 후속 구현 전까지 사용 중이므로 레거시로 삭제하지 않았다.
