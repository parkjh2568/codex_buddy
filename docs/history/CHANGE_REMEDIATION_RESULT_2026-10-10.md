# my_budy 변경 이슈 수정 결과

이 문서는 alpha16/build32 당시 결과다. alpha17/build33의 후속 수정·검증과 build32 보존 경로는 [품질 개선 결과](QUALITY_CYCLE_RESULT_2026-10-10.md)를 따른다. 최신 소스·후보와 검증 범위는 [현재 알파 보고서](../ALPHA_REPORT.md)를 따른다.

2026년 10월 10일, [변경 검토](CHANGE_REVIEW_2026-10-10.md)의 7개 이슈를 수정하고 검사 중 확인한 창 종료 예외 1개도 보완했다. 소스는 `0.1.0-alpha.16`, macOS arm64 staging 대상은 build32다. 기존 함수와 연결·저장·첨부·팩 검증 경계를 유지했으며 새로운 헬퍼 모듈이나 런타임 의존성을 추가하지 않았다.

린트·정적 검사·단위 110개와 격리 Electron 통합 14종이 통과했다. 통합 결과의 `src/` 전체 해시는 현재 소스와 일치한다. 이번 수정 검사는 실제 모델을 호출하지 않았다. 실제 OS 클립보드 왕복·물리 드롭·알림 클릭과 Windows 검증은 포함하지 않는다.

## 이슈별 변경과 확인

| 이슈 | 변경 | 확인한 예외 |
|---|---|---|
| R01 편집 중 화면 복구 | 정상 reload에서 저장 중이 아닌 편집 예약을 해제하고 원래 질문을 수동 보류. 저장 중 예약은 완료·실패 처리와 화면 세대 검사에서 정리 | 실제 Electron에서 편집 중 reload와 편집 저장 중 reload. 질문·모델·FIFO 유지, 숨은 예약 제거 |
| R02 읽지 않은 답변 | 완료된 소유 답변의 카드가 실제 메시지 영역과 교차하고 첫 이미지 미리보기가 준비된 뒤 읽음 처리. 스크롤에서도 재확인 | 화면 밖 답변의 미읽음 유지와 해당 답변으로 스크롤한 뒤 해제. 이미지 대기·숨김·다른 탭·잠금·절전 거절 |
| R03 사용량 응답 순서 | 계정 변경·사용량 이벤트·연결 종료·dispose의 revision으로 오래된 조회 응답과 오류를 건너뜀 | 로그아웃 뒤 이전 값 복원 금지, 최신 31% 이벤트를 이전 23% 응답이 덮어쓰지 않음, 오래된 미지원 오류 거절 |
| R04 도구 상태 | 거절·실패·완료·결과 미확인을 구분. MCP `isError`도 실패로 반영 | 명령/파일 변경의 거절, MCP 오류, 미래의 알 수 없는 상태와 재시작 복원 |
| R06 본문 검색 | 검색어 입력과 검색 해제 시 revision 변경. 이전 요청은 현재 결과를 바꾸지 않음 | 실제 Electron 검색을 지연시키고 검색어 변경. 오래된 결과와 검색 상태를 표시하지 않음 |
| R07 승인 알림 | 표시 직전 작업·요청 ID 재확인. 해결된 승인 알림을 닫고 오래된 클릭 거절 | 해결 이벤트가 publish보다 빠른 경우, 정상 대기 알림, 턴 종료 후 알림 닫기, native 지원 확인 예외 |
| R05 단축키 복구 | 등록 여부와 키 변경을 구분하고 동일 키 재등록 지원. 등록 실패나 fallback 상태에 다시 등록 버튼 제공 | 동일 키 재시도 성공, 자기 등록을 제거하지 않음, 충돌과 저장 실패 때 등록 및 설정 복원 |
| R08 종료 후 창 참조 | 예약된 publish가 종료 중에는 동작하지 않으며 파괴된 패널을 조회하지 않음. 알림 클릭도 창 수명 확인 | 실제 Electron 종료 오류 스택 확인 후 정상 검사 종료. 파괴된 창과 종료 시작의 단위 회귀 |

핵심 수명 처리는 [main.cjs](../../src/main.cjs), 사용량 순서는 [connection-setup.cjs](../../src/connection-setup.cjs), UI의 읽음·검색·복구 입력은 [renderer.mjs](../../src/ui/renderer.mjs)에 있다. 도구 거절 상태는 [Store 복원](../../src/store.cjs)에서도 보존한다.

## 최적화와 정리

이미지 캐시 조회는 검증한 바이트와 파일 경로만 반환한다. base64는 두 미리보기 IPC에서만 만든다. 원본 열기·복사·저장·재첨부·모델 입력·내보내기에는 불필요한 변환을 하지 않는다. 저장 대화상자 이후 캐시와 소유권을 재확인하는 절차, 교체된 사용자 파일의 보존은 유지했다. [이미지 조회](../../src/response-images.cjs).

동일한 16MiB 합성 캐시 표본의 8회 조회에서 불필요한 base64 생성은 178,957,168자에서 0자로 줄었다. 이번 로컬 조회 합계는 약 94ms이며 수정 전 표본은 약 135ms였다. 이 시간은 통제된 성능 비교나 실제 이미지 decode·내보내기·UI 지연의 결과가 아니다. 제거한 변환량과 바이트 보존을 근거로 삼는다. [이전 표본](../../artifacts/change-review-image-read.json), [수정 표본](../../artifacts/remediation-image-read.json).

진행 정보와 큐는 값이 바뀔 때만 DOM을 갱신한다. 진행 내용의 이중 제거를 없애고, 스트리밍 중에는 같은 큐 버튼을 유지한다. 제출·편집·첨부 잠금은 DOM 교체 없이 현재 상태로 갱신한다. 실제 Electron에서 답변 텍스트 변경 후 큐 버튼 객체가 유지되는 것을 확인했다.

스킬 목록 읽기는 기존 함수 안에서 비동기 파일 I/O로 변경했다. 크기와 링크 제한, 읽기 전후 size·mtime·ctime, 해시, 파일 닫기를 유지한다. 여러 await 사이에서 폴더·프로세스·스킬 목록·잠금·절전 상태가 바뀌면 목록을 확정하지 않는다. 실행 직전 한 개 스킬의 원문 확인은 기존 경계에 둔다.

사용하지 않던 새 `reviewState`와 `tokenUsage.updatedAt` 기록을 줄였다. 과거 리뷰 상태를 읽는 호환 검증은 유지하며 사용자 기록을 일괄 변환하거나 삭제하지 않는다. 리뷰 종료 원문, 원래 사용자 질문, 모델 안내와 토큰 수치는 유지한다.

단순 로직을 헬퍼로 옮기지 않고 편집 정리·파일 실패 정리·스킬 읽기의 줄과 들여쓰기를 정돈했다. 인접한 `.message-body` CSS를 합치고 전송키 툴팁을 실제 선택값에 맞췄다. 필요한 이유를 설명하는 기존 주석과 OS 미검증 주석을 유지했다. 새 주석은 reload 이후 편집 예약을 보류하는 이유에만 추가했다.

실제 모델 검사 스크립트는 응답 성공과 생성 세션·임시 폴더 정리 성공을 별도로 기록한다. 정리 실패를 전체 성공으로 반환하지 않는다. 성공·응답 실패·정리 실패의 세 경로를 모의 연결로 검사했으며 이번에 유료 모델 검사를 재실행하지 않았다. [검사 스크립트](../../scripts/real-buddy-modes-smoke.cjs).

## 검증 결과와 실패 기록

| 검사 | 결과 | 근거 |
|---|---|---|
| 린트 | 통과 | [remediation-lint.log](../../artifacts/remediation-lint.log) |
| 정적 검사 | 통과 | JS 구문과 4개 기본 팩. [remediation-check.log](../../artifacts/remediation-check.log) |
| 단위 검사 | 110개 통과 | 실패·취소·건너뛰기 0개. [remediation-unit.log](../../artifacts/remediation-unit.log) |
| Electron 통합 | 14종 통과 | expansion·첨부·연결 이미지·자산·모델·기록·측정·삭제·성능·버디·floating·안정성·수명·팩 없음. [전체 결과](../../artifacts/remediation-integration-verified/integration.json) |
| 확장 회귀 | 통과 및 종료 코드 0 | 두 reload, 실제 스크롤 읽음, 지연 검색, FIFO와 원본 이미지·MD·목적/스킬 회귀. [로그](../../artifacts/remediation-integration-verified/expansion.log) |
| 소스 일치 | 차이 없음 | 통합 결과의 전체 src 해시와 현재 파일 대조 |
| 패키지 | 84개 런타임 파일 통과 | 현재 소스·ASAR·unpack 워커·아이콘·큰 이미지와 첨부 복원. [검증 로그](../../artifacts/remediation-package-verification-final.log) |
| macOS 서명 | 통과 | build32 `codesign --verify --deep --strict`. [로그](../../artifacts/remediation-codesign-final.log) |

확장 검사의 첫 reload 저장 요청은 이전 화면의 JavaScript 평가 Promise를 기다려 검사 진행이 멈췄다. 새 화면의 메인 저장 상태를 기준으로 확인하고 평가 자체는 즉시 반환하도록 바꿨다. 스크롤 검사는 DOM 반영을 기다린 뒤 완료 답변 자체로 이동한다. 대기 메시지 아래로 스크롤한 것을 답변을 읽은 것으로 간주하지 않는다.

종료 검사는 기능 확인 로그 이후에도 실패했다. 프로세스 샘플에 macOS 오류 대화상자가 나타났고 `uncaughtExceptionMonitor`로 `Object has been destroyed`와 main의 publish 위치를 기록했다. 창 수명과 종료 guard를 수정한 뒤 최종 통합 14종의 실제 종료 코드가 모두 0이었다. 검사 스크립트의 monitor는 오류를 숨기거나 성공으로 바꾸지 않는다. [오류 로그](../../artifacts/remediation-expansion-exit-diagnostic/expansion.log), [샘플](../../artifacts/remediation-expansion-exit-sample.txt).

이전 실패 로그와 임시 프로필은 진단용으로 보존했다. 최종 통합에서 성공한 임시 프로필 14개는 정리했다. 기존 검사 fixture의 이미지 조회 반환값과 WebContents 수명 mock도 새 계약에 맞췄으며 검사 판정 조건을 완화하지 않았다.

## 실행 묶음과 남은 범위

최신 후보는 [staging build32](../../dist/staging/OnggiBot-darwin-arm64/OnggiBot.app)다. 이전 [alpha15 build31](../../artifacts/legacy-cleanup-2026-10-12/cleanup-targets.tar.gz)은 별도 복구 경로에 복사했고 Info.plist·ASAR 해시가 일치한다. [보존 증거](../../artifacts/remediation-alpha15-backup.json). 기존 일반 실행 경로의 alpha14/CFBundleVersion 30은 교체하지 않았다.

실제 OS 클립보드 왕복·물리 파일 드롭·IME, OS 알림 배너·클릭·권한, 새 계정의 로그인 콜백, Windows 및 다른 DPI·Intel, 다른 모델/제공자와 공증·설치 프로그램은 기존 실기 수용 범위로 남는다. alpha15의 실제 모델 2회와 알림 show 기록을 이번 수정의 재실행 근거로 쓰지 않는다. 이번 ad-hoc 서명은 공개 배포용 Developer ID나 공증을 의미하지 않는다.

대형 기록과 128MiB 내보내기의 동시 메모리 보관, 전체 CLI 기록 읽기, 긴 스킬 목록의 실제 지연과 배터리 평가는 C07–C09의 측정 과제로 유지한다. 미래 확장을 위한 관리자나 범용 상태 프레임워크를 추가하지 않았다. 읽기 전용·소유 대화·저장 실패·첨부 캐시·캐릭터 데이터 팩의 기존 경계 안에서 수정했다.

2026-10-12에 이 버전의 앱 원본은 [정리 복구 압축본](../../artifacts/legacy-cleanup-2026-10-12/cleanup-targets.tar.gz)에 보관하고 dist/rollback-alpha16-build32 실행 폴더를 정리했다. 당시 소스/검사 수와 실제 실행 여부는 위 기록을 유지한다.
