# 전체 코드 검토 이슈 수정 결과

2026-10-08 KST. 대상은 `0.1.0-alpha.12` 소스와 macOS arm64 build27 staging이다. [검토 보고서](FULL_CODE_REVIEW_2026-10-08.md)와 [수정 계획](ISSUE_REMEDIATION_PLAN_2026-10-08.md)의 F01–F09, 추가 오류 경계와 정리 작업을 적용했다. 기존 변경이 많은 작업 폴더를 reset하지 않았으며, 기존 실제 실행 경로의 build26과 사용자 대화·개인화 프로필을 교체하지 않았다.

계획 문서는 작성 시점의 미착수 기록으로 보존한다. 현재 상태는 이 문서와 [TASKS](TASKS_BEFORE_CLEANUP_2026-10-10.md)의 W00–W10 표를 따른다. 이전 재현 스크립트는 결함이 존재함을 확인하는 자료이며 수정 후 수용 테스트와 구분한다. 출발점의 58개 검사, 중간 수정의 68/72개 검사와 최종 73개 검사를 혼동하지 않는다.

## 수정된 핵심 이슈

| ID | 원인과 변경 | 확인한 범위 |
|---|---|---|
| F06 | SVG 내부 CSS가 이미지 자체를 움직였다. 로더는 style 요소/속성·SMIL·실행/참조를 거절하고 sandbox DOM도 namespace/localName 기준으로 검사한다. export도 원본을 다시 검증한다. | Node의 prefixed 요소·style·원본 보존 회귀, 실제 Electron decoder의 SVG 의미 검사·기본/v2·APNG/WebP·timeout·손상 검증 |
| F04 | 다른/옛 턴 알림이 전역 active를 덮거나 지웠다. turn/start 응답 ID로 소유 턴을 확정하고 그 전 알림을 제한 내에서 보류·대조한다. 메인은 job의 thread/turn을 명시해 interrupt한다. | RPC 전후의 옛 started·외부 completed·먼저 끝난 답변·후속 턴, 실제 CLI의 응답과 지정 턴 중단 |
| F02 | 모델/저장 대기 전에 자리 예약이 없어서 10개 제한을 넘었다. 첫 await 전에 preparing을 증가시키고 queue+preparing을 제한한다. 접수 Promise로 FIFO 확정하며 각 요청의 이름·말투·모델 문맥을 고정한다. | 12개 동시 요청 중 10개 수락·2개 거절, 20개 메시지 영속화, 이름 snapshot, 개별 실패 뒤 다음 접수 정상 처리 |
| F09 | 공통 저장 대기가 중단/승인 전송을 막았다. cancel/respond는 소유자 검사 후 제어 경로를 먼저 실행하고 terminal 저장은 직렬 경계를 유지한다. finishJob은 job의 종료 저장을 한 번 소유한다. | 보류한 저장을 풀기 전 owned interrupt 관찰, 중단 watchdog, 저장 실패 시 후속 실행 차단 |
| F07 | 고정 .tmp가 기존 링크를 따라 외부 파일을 덮을 수 있었다. canonical 폴더·파일 종류를 검사하고 staged 파일을 wx로 생성한다. 일반 잔여 파일은 orphan으로 보존하고 백업도 고유 이름·배타 생성한다. 대화 읽기는 no-follow descriptor·fstat·바이트 크기를 확인한다. | 동기/워커의 staged/final 링크와 dangling 링크에서 외부 원본 보존, 저널 실패/재시작, packaged 워커와 기존 파일 형식 |
| F08 | 최종 삭제가 전체 목록의 같은 threadId를 대상으로 확대됐다. 원격 삭제 전 pending scope를 기록하고 최종 정리는 그 ID 안에서만 수행한다. Store도 scope 밖 ID를 거절한다. | 같은 threadId/다른 연결 문맥, 같은 문맥이지만 미승인 ID, 파생 세션 확인 실패/재시도, 인덱스 제거 후 파일 정리 재시작 |
| F01 | 생성은 코드 포인트, 재로드는 UTF-16 길이를 사용했다. 생성·rename·registry·journal·팩 말투 이름에 NFC와 1~60 코드 포인트·제어 문자 제한을 맞췄다. 폼 maxlength도 비BMP 이름을 잘라내지 않게 했다. | 비BMP 이름 생성/rename/재로드, 저장·생성 저널 복구, 기존 MD·registry 손상 보존 |
| F05 | 내보낸 user-UUID를 같은 프로필에서 제공 모드로 다시 추가해 사용자 registry와 충돌했다. 기존 registry의 사용자 소유권이 우선하며 중복 집계를 제거한다. registry/journal을 먼저 확인해 누락된 사용자 MD를 템플릿으로 채우지 않는다. | 동일/새 프로필 왕복, 사용자 이름·MD·보관 상태·선택/총량, 사용자 reset 거절, 누락 MD의 오류 유지 |
| F03 | pet만 복구되면 메인의 클릭 영역은 비지만 살아 있는 notice는 같은 사각형을 다시 보내지 않았다. noticeHitRevision과 성공 ACK를 포함해 재등록한다. | 실제 Electron의 pet-only renderer crash 후 같은 안내 영역 재등록과 pointer ignore=false. OS 물리 클릭 inside/outside는 아래 제한 참조 |

SVG 정책은 기존 정적 inline CSS까지 거절하는 호환 변경이다. 원본을 변환/삭제하지 않으며 presentation attribute 또는 PNG/WebP로 다시 내보낼 수 있다. v2 프레임은 앱이 재생/정지하며 SVG 자체 CSS에 예외를 두지 않는다.

초기 턴 알림 보류 한도는 128개·256KiB다. 한도를 넘으면 연결 실패로 끝내며 자동 재전송하지 않는다. RPC 전후의 이전 턴 started가 현재 job에 적용되지 않게 연결 계층과 메인 양쪽을 대조한다. 정상 이벤트가 RPC 응답 전에 완료까지 온 경우에도 답변과 완료 순서를 유지한다.

저장 경로 보강은 기존 소유 폴더와 사전에 존재하는 링크·잔여 파일을 대상으로 한다. 동일 권한 프로세스가 상위 폴더를 동시에 악의적으로 교체하는 모든 race, 디스크 전원 장애 내구성, Windows의 macOS와 동일한 no-follow 보장을 주장하지 않는다.

## 추가 오류 경계와 구조 정리

| 대상 | 적용 내용 |
|---|---|
| Q01 네트워크 승인 | 요청의 host/protocol 상세를 표시하고 잘못된 대상을 accept하지 않는다. 기존 허용/거절 정책을 확대하지 않는다. |
| Q02 파일 승인 | 변경 미리보기가 없거나 잘렸거나 구성에 문제가 있으면 accept를 거절한다. decline/cancel은 가능하다. |
| Q03 원격 기록 | thread/read의 소유 ID·turn/items/text 구성을 검사한다. thread/start/resume도 ID를 확인한다. |
| Q04 병합 저장 실패 | 원격 병합 후 저장 실패에서 메모리를 이전 로컬 메시지로 되돌린다. 확정된 저널이 있으면 쓰기 차단·복구 정보는 유지한다. |
| Q05 폴더 열기 | shell.openPath가 반환하는 오류 문자열을 성공으로 처리하지 않고 사용자에게 전달한다. |
| Q06 팩 후처리 | 팩 변경 성공 후 남은 cleanup warning을 Store 경고로 전달한다. |
| Q07 유효 팩 0개 | 내부 임시 표시로 설정 접근을 유지하되 질문/선택/내보내기를 막는다. 정상 팩 재설치에서 임시 표시를 제외하고, 마지막 정상 팩 제거는 명시적으로 거절한다. |
| Q08 await 이후 상태 | 접수 확정 전후에 종료·절전·쓰기 차단·연결/대화·소유 창을 다시 확인한다. 실패한 접수의 ID만 복구하고 다음 예약을 해제한다. |
| Q09 손상 말투 종류 | MD 읽기 실패에도 kind·이름·ID·보관 정보를 유지해 사용자 모드에 기본 reset 버튼이 생기지 않게 한다. |
| Q10 CLI 버전 | smoke 결과는 실제 실행한 CLI version을 기록한다. 하드코딩된 버전으로 현재 검증을 표현하지 않는다. |

단순 조건·예약·rollback은 기존 함수 안에 유지했다. CodexConnection, Store/worker, PackLibrary, PersonaLibrary, AssetValidator의 책임 경계는 그대로다. 범용 큐/dispatcher·SVG/CSS 파서 의존성을 추가하지 않았다.

기존 import-pack의 중복 설치 블록은 미리보기 후 같은 pack-apply 트랜잭션으로 이어지게 통합했다. rollback·사용자 MD 보존·팩 저널 처리를 두 군데에서 별도로 유지하지 않는다. 예전 API의 정상 설치와 개인화 실패 후 재시도는 회귀 테스트로 확인했다. 복구 placeholder는 registry에 제공 팩으로 추가하지 않는다.

작은 창의 UI·숨김 panel DOM 경계를 유지하고 의미 없는 잔존 계산을 정리했다. 기존 responsive/스킨 cascade·상태 저장에 사용되는 숨김 pet-bubble·실패 fixture는 단순히 보이지 않거나 코드가 길다는 이유로 제거하지 않았다. 테스트/문서의 당시 결과는 보존하고 현재 규격의 진입점만 갱신했다.

## 통합 검사에서 추가 발견한 문제

1. **첫 대화 생성 시 다음 초안 유실:** store가 첫 대화 ID를 발급하면 renderer가 새 ID의 빈 초안으로 입력창을 교체했다. send 결과에 소유 conversationId를 포함하고, submit 중 또는 첫 ACK 후 발생하는 null→ID 전환에서 현재 초안을 그 대화로 옮긴다. 제출한 문자열과 현재 입력이 같을 때만 비운다. 실제 폼의 연속 submit에서 질문은 한 번 생성되고 제출 중 작성한 다음 초안은 남는 것을 확인했다.
2. **미승인 삭제 ID 확대:** 같은 문맥·소유 ID라도 beginDeletion에서 기록하지 않은 ID는 completeDeletion에 추가할 수 없도록 보강했다. 저널과 다른 대화를 그대로 보존하는 회귀를 추가했다.
3. **0팩 복구 표시의 재설치 방해:** 임시 표시의 builtin 플래그를 실제 설치 팩의 소유권 판단에 사용하면 정상 같은 ID의 팩을 가져올 수 없었다. 설치/업데이트의 기존 팩 검색에서 temporary를 제외하고 확정 후 제거했다. 새 격리 Electron 프로필에서 같은 ID 재설치를 확인했다.
4. **대기 취소의 영속화 실패:** 큐에서 취소한 뒤 저장이 실패한 경우 후속 실행을 계속하지 않도록 writeBlocked/queuePaused를 확정한다. 재시작의 queued 메시지는 기존 규칙대로 interrupted로 처리하며 자동 실행하지 않는다.
5. **검증 스크립트의 완료 경쟁:** 답변 status=completed는 직렬 저장/큐 종료보다 먼저 보일 수 있다. history/delete smoke가 이 시점에 new-chat을 호출해 정당한 busy 보호에 걸렸다. 저장 완료와 실제 버튼 활성화를 기다리도록 스크립트를 수정했다. 제품의 busy 보호를 느슨하게 하지 않았다.

## 성능 측정과 적용 범위

스트림 callback은 매 delta마다 전체 기록에서 reply를 찾고 하나의 항목도 배열 join을 반복했다. 실행 job에 reply 참조를 보관하고 단일 item은 유지한 텍스트를 직접 사용한다. 다중 item의 결합 순서·총 100,000자/128개 상한과 잘림 표시는 유지한다.

동일 VM·기록 100/1000개·400개 delta·총 100,000자 조건에서 warm-up 뒤 6개 표본을 비교했다. 원자료는 `artifacts/remediation-2026-10-08/stream-cost.json`이며 소스 hash를 포함한다.

| 기록 | 수정 전 중앙값 | 수정 후 중앙값 |
|---|---:|---:|
| 100개 | 0.957ms | 0.415ms |
| 1000개 | 4.133ms | 0.405ms |

이는 메인 notification callback의 로컬 측정이다. 디스크·IPC·Markdown·모델 시간을 포함한 전체 응답 속도나 다른 PC의 보장치로 일반화하지 않는다. 작은 표본에서 통계적 우월성이나 배터리 개선을 주장하지 않는다.

저장 1/16/30MiB와 작은 메시지 1,000개, 기본 팩 3/20회·상한에 가까운 정적 SVG, 소스/패키징 워커 대조 결과는 `continuation/delivery-verification.json`에 기록한다. 20회는 기본 팩의 반복 fresh load/decode이며 20개의 서로 다른 사용자 라이브러리 초기화와 같지 않다. 이 측정으로 DB·새 캐시·SVG 엔진·별도 pet 페이지를 추가할 필요가 확인되지 않았으므로 해당 구조 변경은 하지 않았다.


소스와 ASAR에서 동일한 warm-up 1회 뒤 3회 저장 표본을 확인했다. 중앙값과 관찰한 최대 postMessage 호출 시간은 다음과 같다.

| 조건 | 소스 저장 중앙값 | packaged 저장 중앙값 | 소스 / packaged 최대 postMessage |
|---|---:|---:|---:|
| 약 1MiB | 4.72ms | 3.83ms | 0.45 / 0.25ms |
| 약 16MiB | 58.54ms | 51.71ms | 8.47 / 6.51ms |
| 약 30MiB | 103.40ms | 86.85ms | 57.52 / 10.18ms |
| 작은 메시지 1000개 | 4.27ms | 3.22ms | 0.39 / 0.40ms |

전체 메시지의 구조화 복사 비용은 남아 있다. 30MiB source 표본에는 약 57.6ms의 heartbeat 간격이 한 번 관찰됐다. 소스/packaged 순차 실행의 캐시·GC·활동 조건이 달라 저장 속도 차이를 ASAR 효과나 개선율로 해석하지 않는다. 3개 표본을 p95·최악의 보장치로 표시하지 않는다.

팩 3회 fresh load/decode는 약 673ms, 20회는 약 2077ms였고 약 19.6MB 정적 SVG 팩은 load 약 39ms·decode 약 1329ms로 검증됐다. 이 비용은 검증 창 생성·코드 전달·decode를 포함한다. 20개의 독립 사용자 registry/UI 카탈로그 또는 장시간 메모리 성장 측정은 아니며 대규모 라이브러리의 별도 최적화 완료를 주장하지 않는다.

숨김 panel은 최신 상태·메시지 캐시를 유지하며 DOM 갱신을 생략하고 재표시 때 반영한다. 기존 30분 패키징 idle 원자료는 `continuation/resource-prior-30min.json`과 이전 로그에 남지만 최종 코드와 다른 hash 시점이다. 최종 ASAR는 상태별 30초·각 10개 CPU 표본을 확인했다. 합산 CPU 중앙값은 visible motion 약 0.905%, reduced motion 약 0.055%, hidden 약 0.047%였다. 짧은 sanity 측정이며 이전 30분 결과와 구분한다. 프로세스 CPU 표본은 전력/배터리 측정이 아니다.

## 검사 결과와 전달

- `npm run check`, `npm run lint`, `npm test`: 최종 73개 Node 테스트 통과. JS 구문·기본 3팩·CSS 구문/값/중복 검사 포함.
- 새 프로필의 Electron 통합: assets, models, history, timing, delete, performance, buddy, floating, stability, lifecycle, zero-pack. 실패를 수정한 재실행과 최종 결과를 각각 저장한다.
- 실제 CLI: `codex-cli 0.162.0-alpha.2`, gpt-5.6-luna/high의 짧은 응답과 명시적 owned turn interrupt 확인. 검증용 새 세션만 만들고 보관했다. 사용자 기존 세션 삭제나 자동 승인은 하지 않았다.
- staging: 프로젝트 alpha.12/build27을 생성하고 runtime/bundle/캐릭터/스킨/고지의 총 68개 런타임/자산/고지의 소스 해시와 ASAR, unpacked Store/worker 및 실제 bundle icon 바이트를 대조했다. 실제 packaged worker의 저장·재로드·v1 이관과 큰 기록을 별도 프로필에서 확인했다.

원자료는 `artifacts/remediation-2026-10-08/`에 있다. `before/`·baseline·이전 결과와 `continuation/`의 이번 확인/추가 수정 결과를 구분한다. `integrated-final.json`은 검사별 실행 명령·시각·종료 코드·소스 hash를 기록한다. history의 마지막 카드 반영 대기 수정 후 재실행은 `history-last.log`이며, 실패 기록을 덮어쓰지 않고 `verification-summary.json`에서 최종 선택 결과를 연결한다. 최종 11개 경로가 모두 통과했다. 종료 저장 보류 중 중복 완료·늦은 delta를 보내도 저장이 한 번 실행되고 interrupted/부분 원문이 디스크에 남는 73번째 회귀도 통과했다. 테스트 fixture의 실제 CLI/Windows spawn 모의 검사는 실제 모델/Windows 실기 검사로 표시하지 않는다.

## 남은 환경 검증과 운영 조건

- **F03 OS 실제 클릭:** pet-only crash 뒤 실제 Electron의 영역 재등록과 pointer ignore 상태는 통과했다. inside 안내 클릭과 outside click-through를 사람/네이티브 입력으로 끝까지 확인하는 검사는 입력 도구가 `frontmostApplicationChanged`로 거절했고 timeout이 발생했다. 합성 클릭이나 좌표 등록 성공을 물리 클릭 통과로 기록하지 않는다.
- **Windows·Intel/ARM 대상 실기:** Windows native spawn·EPERM·경로 fixture는 있으나 Windows DPI/Snap/IME·네이티브 파일 잠금·실제 절전은 실행하지 않았다. macOS powerMonitor emit은 OS 실절전과 구분한다.
- **최신 npm audit:** 기존 자동 승인 검토가 npm 레지스트리로 의존성 메타데이터를 전송하는 조회를 거절한 상태다. 별도 명시적 승인 없이 재시도하지 않았다. 최신 취약점 0건 또는 보안 점검 완료를 주장하지 않는다.
- **기존 앱 적용:** 최종 결과물은 staging이다. 기존 build26 앱과 사용자 프로필 교체/배포·서명·공증은 이번 검증 결과에 포함하지 않는다.
- **보존 파일:** 사용자 MD/팩 archive/저널/백업을 자동 삭제하지 않는다. .tmp orphan은 저장 성공을 방해하지 않게 보존하지만 자동 보존 기간이나 청소 기능은 없다.

공통 코드의 수정과 실행 가능한 회귀는 완료 상태로 관리하고, 위 실기·입력·외부 조회 조건은 별도 미검증 상태로 남긴다.
