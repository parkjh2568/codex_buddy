# 남은 우선 작업 구현·검증 결과

2026-10-14, my_budy / 옹기봇 alpha21·staging build37. [남은 작업 분석](REMAINING_WORK_REPORT_2026-10-14.md)의 P1 기록 읽기와 UX01–09 중 현재 환경에서 구현할 범위를 수행했다. 일반 앱·실사용 기록·인증을 교체하지 않았고 build36 전체 앱을 먼저 보존했다. 외부 환경 수용과 측정 후 결정할 P2는 아래에 남긴다. 단위 177개·격리 Electron 15종·패키지 85개 파일과 최종 소스 해시 대조를 통과했다.

## 구현과 우선순위

| 순서 | 문제·원인 | 수정·동작 | 검증 |
|---|---|---|---|
| 1 | readHistory의 fstat 뒤 파일 성장 시 무제한 readFileSync가 큰 Buffer를 먼저 반환 | 같은 함수에서 초기 FD 크기+1의 제한된 읽기, 후속 identity/크기/시각·폴더 경로 확인, finally FD 종료 | 정확한 32MiB·부분 읽기·성장/잘림/동일 크기 변경·UTF-8/JSON·읽기 실패 회귀와 독립 성장 주입 |
| 2 | 이미지/파일·목적·스킬이 입력 주변에 분산 | 말투 옆 `+` 하나에 모으고 선택 요약/첨부/오류는 입력 옆에 유지 | Escape 우선 닫기·포커스 복귀·picker 취소·파일 사본·FIFO·기존 클립보드/드롭 회귀 |
| 3 | 미니가 최근 두 카드와 고정 높이를 사용 | 최초 입력부터 열고 현재/마지막 assistant만 표시, 텍스트 없는 이미지는 빈 본문 없이 표시, 하단 입력 유지 | 실제 미리보기 2개 decode·늦은 이미지·긴 답변 스크롤·composer 넘침 검사 |
| 4 | 완료 후 전체 숨김의 수명 없음 | 시간 측정 설정과 독립된 표시 세대·main deadline, 전달/이미지 준비 후 30초 전체 숨김 | 실제 30초 대기·일반 sync 비연장·이전 세대 거절·X·버디 재열기 |
| 5 | 진행 중 입력·첨부·승인과 숨김 충돌 | 초안·IME·열린 메뉴·선택/저장·실행/대기·승인·중요 오류 동안 유예, 보호 해제 뒤 새 30초 | 사용자 확정 정책, 상태/타이머 회귀·초안 보존·팝오버 유예 |
| 6 | 상세 창 고정 크기·재열기 때 초기화 | 4모서리 token 소유 드래그와 키보드 조절, 화면 한도·최소 크기, 런타임 상세 bounds 유지 | main 경계·지연/취소·작은 화면 회귀, CUA 네이티브 4모서리 연속 검증 |
| 7 | 여백·설정 control/접기 헤더 높이 불일치 | 대화 본문·입력 간격과 폭, select/time 40px·공통 summary·캐릭터 비율 정렬 | 390×580·460×740·720×900, 3스킨·긴 이름·펼친 설정 자동 렌더 검사와 실제 화면 확인 |
| 8 | 검증 소스와 build36 후보 불일치 | alpha21/build37 staging 후보 생성, 이전 후보 전체 복사 | ASAR 85파일·unpacked Store/worker·아이콘·이미지/첨부·저장/복원·strict 로컬 서명 |

수정 코드는 [기록 읽기](../../src/store.cjs:98), [답변 선택·숨김 수명](../../src/main.cjs:169), [표시/리사이즈 IPC](../../src/main.cjs:687), [메뉴 재배치](../../src/ui/renderer.mjs:810), [렌더러 포인터 처리](../../src/ui/renderer.mjs), [레이아웃](../../src/ui/style.css), [HTML](../../src/ui/index.html)에 있다.

함수 안의 단순 처리는 인라인으로 유지했다. 표시 세대와 resize token은 다른 수명이라 구분했으며 새 큐·상태 프레임워크·DB·범용 helper 모듈을 도입하지 않았다. 상세 bounds는 실행 중 메모리에 유지하며 드래그마다 설정 파일을 저장하지 않는다. 캐릭터 팩은 데이터 전용이고 기존 실제 응답/체험 표시는 유지한다.

## 독립 리뷰에서 되돌려 수정한 내용

Architect는 저장·전달·표시 계약과 비용을 확인했고 Implementation Engineer는 production을 구현했다. Reviewer는 별도 VM과 실제 저장 경로의 독립 회귀 18개를 실행·검토했고 SRE는 전체 검사·파일 성장·CUA 네이티브·패키지를 확인했다. 이전 단계의 성공을 그대로 최종 성공으로 취급하지 않았다.

- 완료된 같은 답변의 텍스트/오류 변경도 표시 세대를 바꾼다. 오래된 타이머 핸들과 세대가 새 화면을 숨기지 않는다.
- 화면 작업 영역 변경, 아주 작은 화면, 현재 frame·token 불일치를 거절한다. 상세 리사이즈는 심플 답변 세대와 독립적이다.
- 긴 답변의 자연 높이를 심플 최대 크기로 제한한 뒤 상태 IPC를 보내 초안 보호 신고가 거절되지 않게 했다.
- 실제 창에서 모서리 드래그 후 pointerup 대상이 문서/root로 바뀌어 종료가 빠졌다. 문서 capture에서 현재 pointer ID로 종료를 받는다.
- 아주 빠른 드래그는 시작 IPC 결과보다 pointerup이 먼저 왔다. 정상 release의 마지막 좌표를 해당 token으로 적용한 뒤 종료한다. cancel/lost는 추가 이동 없이 종료한다. 다음 gesture의 token은 지키며 과거 응답으로 덮지 않는다.
- 빈 대기 취소 assistant는 마지막 전달 답변 fallback에서 제외한다. 취소 기록은 보존하고 실제 부분 텍스트·이미지·오류는 계속 표시한다. 실제 cancel-all-queued 저장/재로딩으로 확인했다.
- 기존 expansion 검사는 새 팝오버를 열지 않고 숨겨진 paste 버튼 좌표를 눌러 실패했다. 사용자 흐름대로 메뉴를 연 뒤 기존 trusted 입력 검사를 유지하도록 수정했다. 고정 480px 높이 가정도 내용별 높이·상한·composer 완전 노출 검사로 갱신했다. 최초 실패 자료는 보존한다.
- 확대 720×900 검사에서 composer만 중앙으로 제한돼 탭·상태 기준선이 어긋났다. header/tab-content는 최대 688px, 내부 탭은 640px로 공통 중앙 열에 맞춰 기존 assertions를 유지하고 3크기×3스킨을 다시 통과했다.
- 스킨 전환 도중 캡처한 PNG의 카드 색이 섞였다. 최종 computed 배경이 해당 스킨 wash RGB에 도달한 뒤 캡처하도록 test를 보완했다. night의 실제 RGB(53,68,45)와 최종 가독성을 확인했으며 product 색상 데이터는 변경하지 않았다.

- 최종 반복 검사에서 최초 심플 높이 조절과 `+` 클릭이 겹치면 기존 resize listener가 메뉴를 닫았다. 창 크기가 바뀔 때 열린 팝오버를 현재 trigger와 viewport 안에 재배치하는 인라인 처리를 적용했다. 실제 Electron의 첫 열기와 +2px 창 변경 뒤 메뉴·배치를 확인하고, Node VM의 제어된 210→212 viewport에서 메뉴·포커스·보호 상태를 별도로 확인했다. 이전 listener를 넣으면 같은 회귀가 실패하는 negative control도 수행했다.

- 첨부 제거/드롭 회귀에서 간헐적으로 칩 2개가 남았다. trace에서는 추가 import가 저장 대기 해제 전이어서 “해제 뒤 늦은 preload 검사” 가설을 기각했다. 최초 실패의 제거 click 실제 진입은 확정하지 못했다. 테스트가 활성·연결된 제거 버튼을 같은 DOM 작업에서 누르고, 기존 버튼 분리와 자기 입력 잠금을 확인하도록 계약을 강화했다. timeout과 잠긴 drop→빈 초안 검사는 유지했고 진단 OFF 단독 3회가 모두 통과했다. production 첨부 코드는 변경하지 않았으며 최초 실패/trace를 보존했다.

## 비용 가설과 전후 확인

기록 성장 경합의 측정 기준은 초기 stat 이후 요청 Buffer 상한·실제 누적 읽기량·변경 거절·FD 종료다. 동일한 80바이트 기록을 fstat 직후 33MiB로 키운 주입에서 이전에는 34,603,008바이트 Buffer를 반환한 뒤 거절했다. 수정 후 **최대 Buffer 81바이트·누적 읽기 81바이트**에서 변경을 거절하고 FD를 닫았다. [전](../../artifacts/remaining-work-2026-10-14/history-growth-probe.json), [후](../../artifacts/remaining-implementation-2026-10-14/history-growth-after.json). 이는 I/O/allocation 상한 증거이며 실제 peak RSS나 모든 저장 읽기 개선으로 확대하지 않는다.

리사이즈의 연속 이동은 RAF와 한 번의 진행 요청으로 묶고, 종료 때 자기 token의 마지막 점→end를 순차 적용한다. 최종 move가 기존 이동 응답 대기와 겹칠 수 있으며 JSON 저장/모델 요청은 하지 않는다. 이번 동작 검사는 CPU·배터리 개선 benchmark가 아니다. 전체 통합 실행 중 패키지 검사 등 일부 작업이 겹쳤으므로 smoke의 지연 수치를 전후 성능 비교로 사용하지 않는다.

ACK 배치 저장·변경 없는 카드 fast path·첨부 census 양보의 기존 계측은 [성능 결과](PERFORMANCE_OPTIMIZATION_RESULT_2026-10-13.md)를 따른다. 전체 JSON 복사/직렬화·동기 parse/search, 첨부 O(KF), 이미지 hash/decode/base64, 원격 전체 페이지 로드 비용은 여전히 있다. 변경은 큰 기록·cache hit/miss·main 제어 응답과 실제 플랫폼 비용을 먼저 측정하고 저장/journal/원본/취소 소유권을 유지하는 최소 범위로 진행해야 한다. SQL DB를 사용하지 않아 SQL N+1 검사는 해당하지 않는다.

## 검증 장부

현재 단위 **177/177**, lint(CSS 포함), check(구문·기본 팩), build를 통과했다. 패키지 **85개 파일**과 Store/worker unpacked·아이콘·실제 큰 이미지/첨부 사본·재로딩·보관/복원을 검사했고 strict ad-hoc 서명을 통과했다. 전체 Electron 15종 모두 exit 0·성공 결과·격리 프로필 제거를 확인했다. 390×580·460×740·720×900 각각 3스킨의 정렬/넘침/최종 팔레트 검사와 실제 패키지 실행·정상 종료를 통과했다. native 알림 showEvent=true, failure=false이며 배너 육안·clickEvent는 확인하지 않았다.

CUA 자동화는 격리된 체험 프로필의 실제 macOS 창에서 다음을 확인했다. 하드웨어 수동 조작·실제 IME·다른 OS를 확인한 것으로 쓰지 않는다.

- 네 모서리 연속 드래그: **460×740 → 450×730 → 440×720 → 430×710 → 420×700**, X 뒤 버디로 재열어 420×700 유지.
- `+` 메뉴의 항목·정렬, Escape 닫기와 trigger 포커스, 최초 심플 입력, 실제 체험 답변과 하단 입력.
- 초안이 있어도 X는 즉시 숨기고 버디 재열기에 초안 유지. 비운 뒤 전체 말풍선 자동 숨김 확인. 보이는 chat composer overflow 표본 0건.

[네이티브 관측](../../artifacts/remaining-implementation-2026-10-14/native-ui-verification.json)의 최종 ASAR를 개발 Electron 관측 wrapper에 로드해 네 모서리·메뉴·재열기를 다시 확인했고 시작 시점 main/번들/HTML/CSS 해시가 최종 소스와 같다. 실제 패키지 실행 파일의 격리 시작·종료 검사는 별도로 수행했다. 기존 Chromium sendInputEvent는 실제 실행에서 screenX/Y=0을 보내 geometry 변경을 검증하지 못했다. 해당 경로는 pointer capture/종료 검사로 명시하고 실제 bounds 변경은 CUA의 전역 좌표로 별도 확인했다. OS 헤더 드래그는 경고와 함께 이동하지 않았으므로 수동 헤더 이동 수용은 완료로 쓰지 않는다.

## 보존과 후속 범위

이 작업 시작 때 기존 dirty 상태와 194개 기준 파일을 복사했다. 일반 alpha14/build30, rollback alpha17/build33, 팩·자산·의존성은 보존한다. staging build36 전체는 [복구 앱](../../artifacts/remaining-implementation-2026-10-14/apps-before/staging/OnggiBot.app)에 있다. 이번 후보는 로컬 ad-hoc 서명이며 Developer ID·공증·외부 설치 프로그램을 대신하지 않는다. 실사용 계정을 로그아웃하거나 유료 모델 질문을 추가하지 않았다.

| 남은 범위 | 다음 완료 조건 |
|---|---|
| 최초 연결 O03/O05/O10 | 새 PC/격리 미로그인 계정에서 설치·공식 브라우저 callback·취소/만료·경로/폴더/모델 실패 복구 |
| 실제 OS 입력/알림 | 실제 한국어 IME·파일 물리 drop·타 앱 clipboard 왕복, 알림 권한·배너·소리·클릭 목적 대화/승인 |
| 창/전원/플랫폼 | 실제 header 이동·Spaces·잠금/절전 복귀·다중 모니터·DPI·타일링·배터리; Windows/Intel/ARM 실기 |
| P2 C07–09 | 전체 JSON/동기 읽기·검색·이미지/첨부·원격 이전 페이지를 독립 부하에서 계측 후 수정 범위 결정 |
| 조건부 기능 | 메모리·음성·외부 팩 오디오·Live2D/VRM·중앙 FIFO는 기존 착수 조건 유지, Slack 대기 유지 |

현재 코드에서 미사용이 확정된 기존 UI 가정은 새 테스트 경로로 갱신했다. 저널·이관·백업·아이콘 원본·팩 Markdown/자산·라이선스·과거 검증은 보존한다. 크기가 큰 main/renderer를 줄 수만으로 분리하거나 기능이 남아 있는 문서를 일괄 삭제하지 않는다.

최종 [확인 장부](../../artifacts/remaining-implementation-2026-10-14/final-verification.json), [전체 15종](../../artifacts/remaining-implementation-2026-10-14/integration-complete/integration.json), [패키지 85개](../../artifacts/remaining-implementation-2026-10-14/package-final-verification/package-verification.json), [화면 정렬](../../artifacts/remaining-implementation-2026-10-14/layout-latest/ui-layout-smoke.json), [독립 리뷰](../../artifacts/remaining-implementation-2026-10-14/review.json), [첨부 회귀 3회](../../artifacts/remaining-implementation-2026-10-14/expansion-admission-verification.json)에 실제 실행 범위와 원본/해시를 보존했다.
