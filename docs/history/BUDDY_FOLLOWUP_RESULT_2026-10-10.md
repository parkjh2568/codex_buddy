# my_budy 후속 작업 결과

2026-10-10. [후속 계획](../BUDDY_FOLLOWUP_PLAN_2026-10-10.md)의 우선순위에 따라 연결 수명, 첨부/이미지 수용, 계측과 병목 개선, 기록 페이지 처리, 문서와 배포 후보 검증을 진행했다. 현재 소스는 **0.1.0-alpha.18**, macOS arm64 staging 후보는 **build34**다. 단순 처리는 기존 함수 안에 유지했으며 새 제품 helper 모듈·런타임 의존성·저장 포맷을 추가하지 않았다.

최종 단위 **126개**, 전체 격리 Electron **14종**, 패키지 런타임 **84개 파일**과 strict ad-hoc 서명 검사가 통과했다. 실제 클립보드와 추가 계측을 포함한 확장/성능 2종도 마지막 스크립트 보강 후 재검증했다. 이번 작업의 실제 모델 질문은 **0회**다. 기존 일반 실행 build30과 이전 staging build33/build32/build31은 보존했다.

## 1. 우선순위별 완료와 남은 수용

| 계획 | 실제 진행 | 남은 범위 |
|---|---|---|
| 후속 1 최초 연결 | 늦은 인증 성공·오류·로그아웃·교체·dispose 경합 재현/수정. 로그인/계정 이벤트 교차의 1회 재조회. 실제 설치 CLI의 캐시 인증 읽기 | 새 계정 브라우저 콜백·새 PC 최초 사용·외부 제공자 실기 |
| 후속 2 첨부/OS | 실제 macOS 클립보드의 텍스트·이미지 복사, 픽셀 일치·trusted 버튼 첨부·빈 클립보드 오류·기존 클립보드 복원. 기존 FIFO·편집·제거/드롭·IME fixture 회귀 | 물리 드롭·실제 IME·다른 앱 수동 붙여넣기·절전/모니터·알림 배너/클릭 |
| 후속 3 계측 | 저장/읽기 1·8·24MiB 각 20표본, 이미지 32개 내보내기 전후 각 3표본, 5,000턴 병합 전후 각 20표본, 창 다시 열기 20표본, 짧은 자원/프리셋 측정 | 통제된 장시간·배터리·Windows·실제 cold start 평가 |
| 후속 4 병목 수정 | 이미지 순차 읽기/쓰기, 지역 인덱스로 이전 메시지 연결, 원격 병합 저장을 기존 워커로 처리 | 전체 JSON 읽기/parse·워커 데이터 복사는 유지. 추가 측정 없이 저장 포맷/워커 프로토콜 교체하지 않음 |
| 후속 5 기록 조회 | metadata ID 검증, 25턴 full 페이지 순차 처리, 중복·cursor·수명·quota/시간 검사, 명시적 미지원의 legacy fallback | 로컬 JSON 전체 보관은 유지. UI 요청 시 원격 과거 페이지만 가져오는 방식·다른 CLI/제공자 수용은 후속 |
| 후속 6 상태 의미 | 입력 전이·읽음·누적 토큰의 기존 계약과 해당 회귀 유지 | 모든 글/이미지의 읽음 추적으로 확장하지 않음. steer는 별도 요구 |
| 후속 7 정리 | 본문 검색 미지원으로 잘못 설명한 문서 수정, 현재 구조·작업·빌드·검증 문서 갱신 | 호환 읽기·실패 로그·원자료·복구 묶음은 유지 |
| 후속 8 패키지 | macOS arm64 build34 생성, 84개 소스/자산/워커 대조·이미지/첨부 복원, strict 서명, 실제 알림 show 이벤트 | Windows/Intel·혼합 DPI·설치/업데이트 프로그램·Developer ID/공증·새 환경 수용 |

초기 OS 화면 자동화는 Mac 잠금 때문에 실행되지 않았다. 사용자가 잠금을 해제한 뒤 build34를 별도 검증 프로필로 다시 실행했고 알림 API의 `show` 이벤트는 다시 확인했다. 이후 macOS 화면 제어 도구가 `timeoutReached`로 실패해 실제 배너·권한·클릭·메뉴 막대·타일링 화면은 확인하지 못했다. API 이벤트를 화면 수용 결과로 쓰지 않는다. 초기 잠금 결과와 잠금 해제 후 결과를 각각 보존했다.

현재 옹기봇 소유 목록에서 “할부 거인 / 분할 납부” 문구의 대화를 찾지 못했다. 해당 원래 대화의 복원 성공을 주장하지 않으며 미등록 CLI/다른 앱 기록을 자동 가져오거나 새 그림을 생성하지 않았다. 이미지 표시·보관·복원은 합성 결과와 기존 회귀로 확인했다.

## 2. 연결 수명 보강

[ConnectionSetup](../../src/connection-setup.cjs:95)의 기존 인증 조회는 프로세스만 확인하거나 조회 하나를 모든 수명이 공유했다. 조회 중 로그아웃하면 이전 성공이 `login-required`를 `ready`로 덮었고, 새 연결의 조회가 옛 Promise를 기다렸다. 연결 중단 후 늦은 확인 결과로 브라우저 로그인을 새로 시작하는 경로도 재현했다. [수정 전 검사](../../artifacts/followup-alpha18/auth-before.log)는 이 세 경우의 예상 실패다.

계정/연결/dispose revision을 인증과 사용량이 함께 사용하도록 `accountRevision`으로 명명했다. 인증 조회는 process·revision·work를 한 객체로 소유하며, 같은 수명의 조회만 공유한다. 늦은 성공/오류는 현재 상태와 진단을 덮지 않고, finally는 자신이 소유한 조회만 해제한다. 로그인 시작 전에 수명을 다시 확인한다.

로그인 완료와 `account/updated`가 교차하는 정상 순서는 Electron 검사에서 추가 확인했다. 완료 확인과 [모델 준비](../../src/main.cjs:99)는 계정 상태가 바뀐 경우 현재 계정을 한 번 다시 조회한다. 재조회 중 또 바뀌면 인증 성공을 emit하지 않고 안내를 유지한다. 무한 재시도·공용 로그아웃·자동 모델 변경은 추가하지 않았다.

단위와 실제 테스트 CLI 창에서 확인했으며, 실제 CLI `0.162.0-alpha.2`는 기존 캐시 인증·소유 기록 읽기를 확인했다. 새 계정의 실제 브라우저 인증과 구분한다.

## 3. 계측과 선택한 최적화

### 이미지 내보내기

[export-conversation](../../src/main.cjs:855)은 이전에 이미지 버퍼를 전부 `copies`에 모은 뒤 썼다. 동일한 합성 1024×1024 PNG의 사본 32개, 총 **101,009,600 bytes(약 96.3MiB)**를 사용했다.

| 항목 | 수정 전 | 수정 후 | 의미 |
|---|---|---|---|
| 첫 이미지 파일 쓰기까지 읽은 원본 | 32개 | 1개 | 다음 원본을 읽기 전에 현재 사본을 쓰는 계약 |
| 내보내기 시간 3표본 | 110.2 / 127.0 / 114.5ms | 100.9 / 112.0 / 104.7ms | 로컬 합성 자료의 표본. 보편적 속도 향상률 아님 |
| 관측 RSS 최고 증가량 3표본 | 약 85.5 / 96.9 / 97.1MiB | 약 30.8 / 32.3 / 51.5MiB | GC·할당기·기준 RSS의 영향이 있으므로 보유량/전체 RAM 보증 아님 |

원자료는 [수정 전](../../artifacts/followup-alpha18/cost-before/performance-ui-smoke.json)과 [수정 후](../../artifacts/followup-alpha18/cost-after/performance-ui-smoke.json)다. 버퍼 보관을 줄였다는 직접 근거는 읽기/쓰기 순서와 성공한 사본 수이며, 시간/RSS 표본은 보조 근거다.

요청 시점의 대화·제목 사본은 유지했다. 각 이미지를 검증한 뒤 배타 생성으로 쓰며 실제 읽은 바이트에도 128MiB/256개 한도를 적용한다. 누락 사본 안내, 외부 파일 identity 검사·부분 폴더 보존, 창/대화 상태 재검증을 유지한다. [수정 전 회귀](../../artifacts/followup-alpha18/export-before.log)와 수정 후 검사에서 원문 snapshot·순차 버퍼·파일 내용·중간 쓰기 실패·외부 추가 파일 보존을 확인했다.

### 저장·기록 연결

저장/읽기 계측은 크기별 20표본이다. 수정 전 24MiB의 저장 전체 중앙값은 약 64.2ms, main의 postMessage 호출은 6.5ms, 동기 기록 읽기/parse는 10.5ms였다. 비용은 남아 있지만 별도 저장 프로토콜·DB 교체를 바로 적용할 근거로 확대하지 않았다.

원격 병합은 턴마다 이전 메시지를 반복 검색했다. 기존 함수 안에 turnId/itemId/원문별 지역 인덱스를 만들고 같은 질문의 순서와 ID 충돌을 확인한다. 마지막 병합 저장은 직렬 워커로 처리한다. Node 검증 하네스의 동일한 **5,000턴·20표본** 전체 열기/병합 중앙값은 **305.8→56.0ms**, p95는 **316.6→63.3ms**였다. [전](../../artifacts/followup-alpha18/history-cost-before.json)·[후](../../artifacts/followup-alpha18/history-cost-after.json). 테스트 CLI 미지원 fallback과 로컬 파일 처리도 포함하며 실제 Electron/모델 전체 응답 시간으로 일반화하지 않는다.

### 창·상주 자원

이미 실행된 창을 숨겼다가 표시하고 2 animation frame과 composer 준비를 확인하는 20표본을 수집했다. cold start·실제 사용자 입력 지연은 아니다. 마지막 계측은 [확장/성능 재검증](../../artifacts/followup-alpha18/script-final/performance-ui-smoke.json)에 있다.

자원은 alpha17 기준 3조건, alpha18의 움직임·줄이기·정숙·일상·숨김 5조건을 각각 30초/10표본으로 수집했다. alpha18 자기 Electron CPU 합 중앙값은 약 1.777% / 0.087% / 0.083% / 1.669% / 0.068%였다. [기준 원자료](../../artifacts/followup-alpha18/baseline/artifacts/resource-smoke.json), [현재 원자료](../../artifacts/followup-alpha18/resource-after/resource-smoke.json). 내부 창/renderer 상태를 기록했으며 OS 화면 표시 수용을 뜻하지 않는다. 다른 활동·잠금이 통제되지 않았고 CLI·배터리를 측정하지 않아 개선률을 주장하지 않는다.

ASAR 자원 래퍼는 실제 로드한 패키지 버전을 기록하며 dummy Store의 settings 부재도 처리한다. [각 1초의 진입점 검사](../../artifacts/followup-alpha18/packaged-resources/resource-smoke.json)는 장시간 성능 검사와 구분한다.

## 4. 기록 페이지의 안전한 병합

[open-conversation](../../src/main.cjs:890)은 metadata의 ID를 먼저 확인하고, ASC 방향의 `itemsView:full` 25턴 페이지를 순차 처리한다. 모든 페이지 확인 전에는 현재 로컬 메시지를 교체하지 않는다. 응답 중복 턴은 제거하고 이전 메시지의 ID·원문·목적·첨부·이미지 metadata를 유지한다. turnId와 사용자 itemId가 다른 로컬 기록을 가리키면 병합을 거절한다.

cursor 형식/반복, 최대 2,048페이지, 조회 시간 60초의 확인 지점, 병합 JSON 바이트·저장 32MiB, 대화/프로세스/창/종료 수명을 검사한다. 진행 중인 단일 decode/I/O를 순간 취소하는 시간 보장은 아니다. 첫 페이지 API가 명시적으로 미지원(`-32601`)일 때만 legacy 전체 조회로 돌아간다. summary/notLoaded·잘못된 페이지·연결 교체·시간 초과는 전체 조회로 우회하지 않는다.

Electron history 검사는 합성 **62턴/124개 메시지를 3페이지**로 복원하고, 화면 100개에서 이전 내용 124개까지 늘리며 원문을 유지했다. [전체 결과](../../artifacts/followup-alpha18/final-integration/history-ui-smoke.json). 구형 CLI fallback은 connection-image fixture와 단위에서 확인했다. [수정 전 페이지 검사](../../artifacts/followup-alpha18/pages-before.log)는 기존 전체 조회가 페이지 전용 응답을 복원하지 못한 기대 실패다.

실제 설치 CLI의 [읽기 전용 지원 확인](../../artifacts/followup-alpha18/protocol-readonly.json)은 소유 대화에서 full 턴 페이지와 항목 페이지 응답을 받았다. 앱은 현재 full 턴 페이지를 사용한다. 로컬 JSON을 페이지 포맷으로 바꾸거나 필요한 과거 원격 페이지만 요청하는 UI까지 구현한 것은 아니다. 한 개 항목 자체의 과대 프레임은 기존 프로토콜 한도와 로컬 fallback 안내를 따른다.

## 5. 입력 전이·예외 회귀 대응

| 경계 | 유지한 처리 | 확인 근거 |
|---|---|---|
| 인증 조회·새 연결 | 늦은 성공/오류 폐기, 새 조회 소유권 유지 | connection-images 단위·GUI·캐시 인증 |
| 편집 진입/첨부 제거 | 첫 await 전 잠금, 전환 시점 초안 snapshot, 자신 예약만 해제 | expansion의 `ATTACHMENT_REMOVAL_EDIT_RACE_CHECKED`·기존 reload/FIFO |
| trusted 첨부 입력 | 일반 텍스트 보존·중복/잠금 검사 | CDP 드롭·버튼, 실제 클립보드·빈 클립보드 |
| 전송/다음 초안 | 질문/첨부/모델 snapshot·새 대화 ID 이전·동기 접수 잠금 | 기존 stability/attachments/expansion |
| 페이지 부분 실패 | 로컬 전체 기록 유지·무분별한 full retry 없음 | summary·cursor·timeout·연결/metadata 교체·quota·ID 충돌 |
| 병합 저장 실패 | 실제 commit 호출 뒤 원래 로컬 메시지 복구 | 올바른 page 응답 + commit 1회·`disk full` 관측 |
| 내보내기 실패 | 버퍼 순차 처리·원문/외부 파일/사용자 추가 파일 보존 | bounded export·부분 파일·identity 회귀 |
| 읽음/누적 토큰 | 실제 viewport/첫 preview·숨김/잠금 억제, 누적 토큰≠문맥 점유율 | 기존 unread·usage 회귀 |

재검토에서 저장 실패 검사의 stub가 페이지 형식 검사에서 먼저 실패할 수 있음을 발견했다. 정상 page 응답을 제공하고 실제 저장 시도 횟수와 디스크 오류를 확인하도록 수정했다. 잘못된 형식 실패를 저장 실패 검증으로 세지 않는다.

## 6. 검증과 증거

| 확인 | 결과/경로 |
|---|---|
| lint·CSS | [최종 lint](../../artifacts/followup-alpha18/lint-final.log), 억제 추가 없음 |
| 문법·팩 | [최종 check](../../artifacts/followup-alpha18/check-final.log) |
| 단위 126 | [최종 unit](../../artifacts/followup-alpha18/unit-final.log), 실패/skip 0 |
| Electron 14 | [최종 integration](../../artifacts/followup-alpha18/final-integration/integration.json), 각 exit 0 |
| 추가 확장/계측 2 | [마지막 재검증](../../artifacts/followup-alpha18/script-final/integration.json) |
| 실제 클립보드 | [마지막 결과](../../artifacts/followup-alpha18/script-final/expansion/buddy-expansion.json)의 nativeClipboard/clipboardRestored=true |
| 패키지 84 | [runtime/소스/워커/아이콘/이미지](../../artifacts/followup-alpha18/package-verification/package-verification.json), 프로젝트 alpha18 |
| strict ad-hoc | [codesign 로그](../../artifacts/followup-alpha18/codesign.log), exit 0 |
| 실제 알림 API | [초기 결과](../../artifacts/followup-alpha18/native-notification/native-notification.json)·[잠금 해제 후 결과](../../artifacts/followup-alpha18/native-notification-unlocked/native-notification.json), packaged=true·show=true·click=false. 실제 화면은 도구 시간 초과 |
| 최종 대조 | [상태 요약](../../artifacts/followup-alpha18/final-validation.json) |

격리 검사는 성공 프로필을 결과 보존 후 정리한다. 실패/중간 결과·원자료는 별도 경로에 보존했다. 최초 제한 환경의 GUI/CLI 실행 실패, 기준 자원 결과 폴더 준비 누락, 로그인 콜백 재검토와 native 검사 좌표 갱신의 실패를 성공 결과로 덮지 않았다.

Packager의 선택형 `.icon` 경고는 남았으며, 실제 `.icns` 바이트는 패키지 검사에서 일치한다. 종료 때 macOS task_policy_set 로그가 있었지만 검사 JSON passed와 exit 0을 따로 확인했다. 무관한 경고를 숨기거나 테스트 성공 근거로 삼지 않는다.

## 7. 정리·보존·전달

새 제품 helper·프레임워크·TODO/FIXME·lint 억제를 추가하지 않았다. 단순 Map 구성·분기·소유 확인은 기존 함수 안에 있고, await 전후의 검사는 서로 다른 시간 경계라 유지한다. 프로세스·저장·이미지 검증·데이터 팩의 모듈 경계와 과거 metadata 호환 읽기도 유지한다.

문서의 현재 검색/페이지/내보내기·인증 수명·버전/검증 범위를 정돈했다. 과거 117개 검사와 alpha17 결과는 이력으로 유지한다. 추가 자산·기억·음성·steer·Slack/상시 서버는 착수 조건을 만족하지 않아 기본 작업에 편입하지 않았다.

최신 후보는 [staging build34](../../dist/staging/OnggiBot-darwin-arm64/OnggiBot.app)다. 이전 [alpha17 build33](../../dist/rollback-alpha17-build33/OnggiBot-darwin-arm64/OnggiBot.app)의 Info/ASAR 해시를 [보존 기록](../../artifacts/followup-alpha18/rollback-alpha17.json)과 대조했다. 일반 실행 build30은 교체하지 않았고 기존 build32/build31도 유지한다. 기존 앱이 실행 중이면 사용 중인 작업 상태를 확인한 뒤 후보를 실행한다.

후속 우선순위는 실제 새 계정/새 PC 수용, 화면 도구 복구 후 OS 배너·클릭/IME/물리 드롭, 통제된 자원/배터리·다른 OS다. 해당 환경이 없는 검사나 도구 실패를 완료로 표시하거나 현재 사용 중인 인증/권한을 바꿔서 우회하지 않는다.
