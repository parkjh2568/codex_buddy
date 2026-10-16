# 옹기봇 최종 후속 작업 결과

2026-10-13. [후속 작업계획](FINAL_IMPLEMENTATION_PLAN_2026-10-13.md)의 우선순위에 따라 기존 변경·복구본 보존, 후보 검증, 자원 계측, 실행/표시 수명 보완, 선택형 보관 정리를 진행했다. my_budy의 로컬 버디 구조와 기존 저장 형식·FIFO·읽기 전용 CLI 정책을 유지했다.

## 적용한 변경

| 범위 | 변경과 이유 | 유지한 조건 |
|---|---|---|
| 패키지 후보 | 기존 수정만 담은 alpha19/build35를 먼저 검증·보존하고, 추가 구현의 최종 후보를 alpha20/build36으로 구분 | 일반 alpha14/build30, 이전 alpha17/build33·alpha18/build34, 실사용 프로필 보존 |
| 긴 기술 문자열 | 공백 없이 ASCII가 4,096자 이상 이어지는 구간이 있는 메시지만 고정폭 글꼴로 표시 | 일반 메시지의 글꼴, 원문·복사·저장 바이트, Markdown 정제·페이지·스크롤 계약 |
| 화면 반영 ACK | 대화 ID·카드 객체·완료 시각·예약 토큰을 함께 확인하고 대화 reset 때 카드/observer 수명을 정리 | 이전 콜백이 새 대화의 같은 ID를 읽음/시간 반영으로 확정하거나 새 예약을 지우지 않음 |
| 본문 검색 | 검색 revision·창 generation·종료 상태를 확인하고 검색어 변경/초기화에서 이전 검색을 중단. 일치 문자열의 소문자 변환을 한 번만 수행 | 최대 100개 기록/32MiB/50개 결과, 명시적 검색, 저장 중에도 검색 중단 가능 |
| 보관 파일 | 설정에 보관량·참조 조회, 선택형 복구 보관, 복원·중단 추가 | 모든 대화·초안 첨부의 공유 해시, 사용자 추가/변경 파일, 복구 자료 보존 |
| 검사 결과 | integration이 성공 JSON·정상 exit·프로필 정리를 각각 확인. 말투 복원을 마친 뒤 buddy 성공 기록 | 캡처/복원/종료 실패를 통과로 처리하지 않고 실패 프로필·로그 보존 |

새 실행 의존성과 범용 dispatcher·큐·상태 프레임워크는 추가하지 않았다. UI 조건·긴 문자열 판정·검색 반복은 사용하는 함수 안에 두었다. 파일 참조 판정과 정리/복원은 저장 소유권·실패 경계가 있어 `storage-maintenance.cjs`로 분리했다. 긴 문자열의 비정상 배치 비용을 설명하는 주석 하나를 추가했다.

## 확인한 성능 병목과 적용 근거

합성 입력의 CPU 프로파일에서 큰 지연은 렌더러 `onState`에 집중됐다. Markdown 파싱과 일반 글꼴 배치를 따로 확인한 뒤 실제 메시지의 macOS 시스템 글꼴로 재현했다. 한국어 접두어와 긴 ASCII 단어를 14px·폭 300px에서 배치했을 때 100,000자 표본은 약 5,016ms, 고정폭 글꼴의 같은 표본은 약 16.8ms였다. 한 번의 배치 표본이며 모든 문장/플랫폼의 개선율을 의미하지 않는다.

동일한 0/1/16/30MiB 합성 기록을 사용하는 중단 계측의 렌더러 프로파일에서 `onState`에 귀속된 샘플 시간은 약 24.32초에서 66.51ms로 줄었다. 별도 상세 성능 검사에서 10ms renderer heartbeat의 최대 간격은 약 8,915.7ms에서 25.2ms였다. 원자료는 [글꼴 재현](../../artifacts/final-implementation-2026-10-13-AZ6e4z/font-layout-diagnostic.json), [고정폭 재현](../../artifacts/final-implementation-2026-10-13-AZ6e4z/monospace-layout-diagnostic.json), [변경 전 프로파일](../../artifacts/final-implementation-2026-10-13-AZ6e4z/timing-profile/interrupt-renderer-profile.json), [변경 후 프로파일](../../artifacts/final-implementation-2026-10-13-AZ6e4z/timing-profile-after/interrupt-renderer-profile.json)에 있다. 데스크톱의 다른 활동은 통제하지 않았고 배터리 결과로 확대하지 않는다.

전체 JSON 읽기와 워커 구조화 복사는 유지한다. 최종 상세 계측의 저장·읽기 각 20회 결과는 다음과 같다. 크기는 목표 표본이며 실제 저장 바이트도 함께 기록했다.

| 목표 기록 | 실제 JSON | 비동기 저장 median / p95 | 메인 워커 전달 median / p95 | 동기 읽기 median / p95 |
|---|---|---|---|---|
| 1MiB | 1,001,040바이트 | 3.76 / 6.56ms | 0.39 / 0.53ms | 0.70 / 0.87ms |
| 16MiB | 16,716,322바이트 | 39.71 / 52.39ms | 5.53 / 7.97ms | 7.72 / 10.98ms |
| 30MiB | 31,430,804바이트 | 65.00 / 84.47ms | 10.27 / 10.88ms | 15.19 / 17.64ms |

100/1,000/10,000개 짧은 메시지, 비활성 기록의 본문 검색, warm sync/open, 이미지 32개 내보내기도 [상세 계측](../../artifacts/final-implementation-2026-10-13-AZ6e4z/performance-after/performance-ui-smoke.json)에 남겼다. 검색의 `ipcMs`는 요청/결과 시간이며 기존 `elapsedMs`에는 heartbeat 확인을 위한 대기 시간이 포함된다. 서로 다른 지표를 직접 개선율로 비교하지 않는다. 샘플 메모리 최고값은 전체 OS peak나 고유 RAM 측정이 아니다.

[모의 CLI 중단 계측](../../artifacts/final-implementation-2026-10-13-AZ6e4z/timing-profile-after/timing-ui-smoke.json)은 클릭→메인에서 fixture interrupt 호출과 완료/저장 대기를 구분한다. 실제 모델 호출은 없다. 한 크기당 한 중단 표본이므로 평균/p95 또는 실제 모델의 중단 시간으로 표시하지 않는다.

읽기 워커·저장 delta·DB/저장 형식 변경은 채택하지 않았다. 초 단위로 입력을 막던 표시 병목을 먼저 수정했으며, 남은 수십 ms 저장/복사 비용은 데이터 일관성·IPC 왕복 비용과 함께 추가 평가해야 한다. 필요한 원격 과거 기록만 조회하는 UI와 배터리·CLI 자식 프로세스 계측도 후속 범위다.

## 오류와 경합 방어

ACK의 수정 전 동작은 실제 시작 사본으로 재현했다. 이전 대화의 callback을 지연하고 새 대화에 같은 메시지 ID를 넣으면 이전 callback이 새 대화에 ACK를 보냈다. 수정 후에는 이전 ACK가 0회이고 새 소유자의 ACK만 1회였다. [전후 재현](../../artifacts/final-implementation-2026-10-13-AZ6e4z/ack-owner-reproduction.json)과 실제 Electron timing 검사가 이를 확인한다.

보관 파일 확인 중에는 충돌하는 질문 접수·설정·첨부·대화 변경을 막는다. 조회·보관·복원은 창 generation과 작업 revision을 소유하고, 중단·종료·잠금/절전·창 교체 시 다음 파일 처리를 중단한다. 원본 경로·링크·descriptor·크기·해시와 참조 파일의 변경을 확인한다. 파일이 stat 이후 커져도 제한된 버퍼로만 읽고 정리하지 않는다.

손상/누락/미등록 기록, 잘못된 이미지 참조, 저장·삭제·팩 복구 파일 또는 이전 state 백업이 있으면 정리를 보류한다. 조회는 총 기록 256MiB·메시지 50,000개, 캐시 폴더당 10,000개 파일까지이며 한도에 도달하면 미확인 파일을 정리 가능으로 분류하지 않는다. 이미지·첨부의 참조 해시는 확장자가 달라도 보수적으로 공유 보호한다.

선택은 최대 128개이며 미참조·불변 해시가 확인된 캐시만 `userData/cache-quarantine/<UUID>/`로 옮긴다. 처리 전에 전체 manifest를 기록해 중간 종료에서도 이미 옮긴 파일을 찾을 수 있다. 부분 실패는 실제 이동 목록·보존 사유를 반환한다. 폴더 전체나 사용자 파일을 일괄 삭제하지 않는다.

복원은 허용한 상대 경로·크기·해시를 다시 확인하고 기존 파일이 있으면 보존한다. 캐시 폴더별 512MiB 한도를 지키고 파일 사이에 이벤트 루프를 양보해 중단할 수 있다. 복구 보관본은 복원 뒤에도 유지한다. 이 기능은 캐시 한도에서 파일을 빼는 것이며 전체 디스크 사용량을 줄이거나 영구 삭제하는 기능이 아니다. 팩 archive·말투/MD·과거 빌드·감사 근거의 자동 만료는 없다.

## 구조와 우선순위 판정

| 감사 항목 | 이번 결과 | 남은 조건 |
|---|---|---|
| D01 | 초기 alpha19/build35 보존. 최종 alpha20/build36의 소스/ASAR/worker/아이콘/이미지·첨부·보관 복원, strict 서명과 실제 네이티브 시작·보관량 AX 조회·정상 종료 확인 | 일반 실행 앱 교체·외부 배포는 별도 |
| D02 | 기존 접수 직렬화·단일 실행·완료 저장·취소/승인·절전 계약을 회귀. 새 저장 정리는 main의 소유 검사·보류 경계에 포함 | main의 역할별 독립 경계가 성립하면 분리. 현재 shared 상태와 Electron 권한 전달을 늘리는 일괄 이동은 하지 않음 |
| D03 | 대화 reset의 카드/observer 수명과 ACK 예약 소유권 보완, 긴 문자열 배치 수정 | 메시지 UI가 첨부 재사용·초안·입력 상태와 공유하는 계약을 유지하며 필요할 때 독립 모듈로 이동 |
| D04 | 1/16/30MiB·작은 메시지·검색·중단·heartbeat·메모리 표본 계측, 확인한 표시 병목 수정과 이전 검색 중단 | 전체 JSON/parse·복사·원격 전체 병합, 전체 OS peak·배터리 평가 |
| D05 | 결과 파일/상태·exit·cleanup의 독립 판정, 실패 주입과 실제 Electron ACK/정리 수명 검사 | 기존 유효한 VM 검사는 유지. 책임 이동 시 문자열 위치 의존 검사를 해당 경계의 계약 검사로 대체 |
| D06 | 보관량/참조/보존 사유 조회, 선택형 복구 보관·복원·중단 구현 | 영구 파기·보존 기간은 별도 정책. 크기/참조 확인이 불완전하면 보존 |
| D07 | 최종 후보의 실제 앱 시작·설정/보관량 AX 상태·캐릭터 렌더링·알림 show·정상 종료 확인 | OS 배너/클릭·메뉴 막대/대화창 외관, 물리 IME/drop/절전/Spaces, 새 인증, Windows/DPI·배터리·외부 서명/공증 |

메인과 렌더러를 줄 수만으로 나누지 않았다. 현재 접수/실행은 큐 편집·예약 첨부·창/프레임 권한·설정 snapshot·저장 보류·전원/종료와 연결된다. 메시지 표시도 다시 첨부·일반/큐 초안·미니/전체·ACK를 공유한다. 새 거대한 context 객체와 adapter를 만들어 책임을 복제하는 분리 대신 실제 수명 경계를 보강했다. 전체 책임 분리 자체를 완료했다고 표시하지 않는다.

## 검증 결과와 복구 위치

- 린트/CSS와 JS 구문·기본 캐릭터 팩 4개 검사 통과.
- 단위 검사 **147개 통과, 실패/취소/skip 0**. 새 저장 정리 10개, integration 판정 1개, 검색 취소 1개를 포함한다.
- [최종 Electron 14종](../../artifacts/final-implementation-2026-10-13-AZ6e4z/integration-final-verified/integration.json) 모두 성공 JSON·exit 0·격리 프로필 정리 확인. src/scripts/fixture의 해시 63개가 실행 후 소스와 일치했다.
- 전체 검사 이후 상세 성능 검사를 실행했다. 실제 모델 호출·실제 로그인·실사용 대화 삭제는 없다.
- [최종 패키지](../../artifacts/final-implementation-2026-10-13-AZ6e4z/package-final/package-verification.json)의 포함 파일 85개가 소스와 일치한다. unpacked worker·아이콘·큰 이미지 원본/preview·첨부·새 캐시 보관/복원 검사와 build36 strict ad-hoc 서명을 확인했다.
- [실제 네이티브 실행](../../artifacts/final-implementation-2026-10-13-AZ6e4z/native-final/native-notification.json)은 alpha20, packaged=true, 실제 모델 없음, show=true, click=false, failure=false이고 정상 종료했다. CUA에서 보관 메뉴를 펼치고 조회한 AX 결과는 캐시 0.00MiB·말투 0.01MiB였다.
- [최종 ASAR 자원 표본](../../artifacts/final-implementation-2026-10-13-AZ6e4z/packaged-resources/resource-smoke.json)은 개발 Electron 호스트에서 ASAR 메인을 실행해 각 30초·10표본을 수집하고 정상 종료했다. 움직임/줄이기/숨김의 Electron CPU 합계 median은 1.150/0.067/0.049%, p95는 1.345/0.157/0.162%다. CLI·배터리·전체 시스템 또는 고유 RAM 결과가 아니다.

시작 사본 187개와 git status는 [실행 근거 폴더](../../artifacts/final-implementation-2026-10-13-AZ6e4z)의 `baseline/`, `baseline.json`, `git-status-before.txt`에 있다. alpha18/build34·alpha17/build33의 전체 파일·링크와 strict 서명 복구 검증은 [apps-before](../../artifacts/final-implementation-2026-10-13-AZ6e4z/apps-before/backup-verification.json), 초기 alpha19/build35 보존은 [apps-initial](../../artifacts/final-implementation-2026-10-13-AZ6e4z/apps-initial/backup-verification.json)에 있다. 일반 실행 앱과 사용자 프로필은 교체하지 않았다.

중간 실패 기록도 보존했다. Electron의 샌드박스 SIGABRT는 격리 프로필을 유지한 실제 런타임 재검증으로 통과했다. 테스트의 함수 반환 IPC 복제 오류, pet에 대화창 전용 상태를 읽은 오류, 파일 증가 주입에서 `/var`와 `/private/var` 경로를 다르게 비교한 오류는 수정 후 다시 검증했다. 마지막 주입 검사는 실제 변경이 발생했는지도 assert한다. 이런 실패를 성공 기록으로 덮어쓰지 않았다.

초기 화면 캡처 도구는 시간 초과를 반환했다. 마지막 실행에서는 캐릭터 창 이미지를 확인했지만 대화/설정 패널·OS 배너·메뉴 막대 외관과 실제 알림 클릭은 확인하지 못했다. AX 조회와 show 이벤트를 전체 화면/클릭 수용으로 확대하지 않는다. 실제 미로그인 계정·Windows·물리 전원/입력·배터리·외부 배포 환경은 별도 수용으로 남긴다. Slack·자동 기억·음성·유료 테스트 질문과 무료 외부 에셋 도입은 기존 착수 조건을 유지한다.
