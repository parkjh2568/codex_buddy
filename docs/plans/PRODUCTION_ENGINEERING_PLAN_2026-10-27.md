# 프로덕션 엔지니어링 실행 계획 · 2026-10-27

후속 상세 확인과 구현 단위·소유권/취소·측정·회귀/rollback 계획은 [ENG04–10 상세 작업계획](ENGINEERING_FOLLOWUP_DETAIL_2026-10-27.md)에 있다. 아래의 완료/검증 결과는 선행 실행 이력이며 상세 계획 작성으로 새 구현이나 실행 성공을 추가하지 않는다.

## 1. 적용 범위와 현재 제품

사용자가 제시한 제품 설계·인수인계·RCA·100배 확장·성능 측정·4인 검토·배포 전 검증의 일곱 기준을 현재 OnggiBot에 적용한다. `[제품 아이디어]`, `[코드베이스]`, `[증상]`은 각각 이 저장소의 기존 데스크톱 버디, 현재 작업 트리, 조사 중 재현한 실패로 해석한다. 신규 기능이나 SaaS 전환을 임의로 가정하지 않는다.

이미 Electron으로 실행 가능한 MVP가 있다. 먼저 기존 외부 계약과 사용자 데이터를 보존하고, 확인된 정합성 결함 → 측정 → 성능 설계/구현 → 실제 배포 수용 순서로 진행한다. 대량의 기존 미커밋 변경을 초기화·이동·일괄 커밋하지 않는다. Slack 재개, 실제 유료 질문, 외부 배포는 이번 작업 범위에 추가하지 않는다.

기준 문서는 [개발 구조](../ARCHITECTURE.md), [저장 계약](../LOCAL_STABILITY.md), [조회](../CONVERSATIONS.md), [삭제](../DELETE_CONVERSATIONS.md), [빌드·검증](../BUILD_GUIDE.md), [남은 작업](../../TASKS.md)이다. 이 계획은 기존 완료 기능을 다시 미구현으로 분류하지 않는다.

## 2. 기능·비기능 요구사항과 도메인

| 구분 | 요구사항 | 수용 기준 |
|---|---|---|
| 대화 | 실제 Codex/체험 모드, 모델·추론·속도·말투 선택 | 실제/체험 표시, 접수한 설정 snapshot 유지, 자동 질문 재전송 금지 |
| 실행 | 첨부와 FIFO, 승인·추가 질문·중단 | preparing+queue ≤10, 소유 thread/turn만 처리, 중단·승인은 저장 대기를 우회 |
| 기록 | 소유 대화 저장·전환·검색·이전 페이지·내보내기·삭제 | 다른 앱 기록 제외, 저장 성공 후 cursor 확정, 실패 시 원본/저널 보존 |
| 개인화 | 데이터형 캐릭터 팩·스킨·말투 | 실행 코드 금지, 크기/경로/decode 검사, 사용자 편집 충돌 감지 |
| 안정성 | worker/CLI 종료·저장 실패·재시작 | 실패를 성공으로 표시하지 않음, 불확실한 저장은 차단, 다음 질문 실행 중지 |
| 반응성 | 큰 기록에서도 포인터·중단 제어 유지 | 로컬 CPU/I/O/복사/렌더 시간을 분리 측정, 측정 없는 개선 주장 금지 |
| 개인정보 | 로컬 기록과 CLI 인증 경계 유지 | 토큰·로그인 URL·대화 원문을 진단에 추가하지 않음, 자동 외부 전송 없음 |
| 사용자 작업 보호 | 창·포커스·OS 입력 비간섭 | 기본 verify/Node 검사만 실행, GUI는 별도 사용자 시간 허용과 `--interactive` 필요 |

핵심 흐름은 **입력·첨부·instructions·모델 snapshot → 대기 자리 예약 → 질문 저장 → FIFO 실행 → 소유 턴 수신 → 이미지 처리 → 완료 저장 → 다음 질문**이다. 저장 실패와 중단을 정상 완료와 분리한다. 기록 전환은 실행/대기 작업을 정리한 뒤 수행하며 늦은 비동기 결과는 conversation/revision/generation을 확인한다.

| 도메인 | 주요 필드/관계와 소유자 |
|---|---|
| Settings | workspace/codexPath/model/effort/serviceTier/demo, main 소유 |
| Conversation | UUID, source=onggi_bot, threadId, title, workspace/codexPath, mode, Message 목록 |
| Message | id, role, text, status, createdAt, 첨부/이미지 참조, 선택형 timing |
| Job | 접수 snapshot, user/reply ID, 소유 thread/turn, 종료 Promise, FIFO 위치; main 메모리 |
| Attachment/GeneratedImage | ID/hash/mime/크기/치수, 보관 파일·미리보기, ready/pending/failed |
| ApprovalRequest | 소유 turn/request ID, 실행/변경/네트워크 대상, 사용자 응답 |
| CharacterPack/Persona | 검증된 manifest/프레임/MD, contentHash 기반 편집 충돌 |
| SaveJournal/DeleteJournal | 저장 payload SHA·historyId / 삭제 소유 범위·확인 phase |

## 3. 아키텍처·스택·데이터·API·권한·배포

```text
pet / notice / panel renderer
  → sandbox+contextIsolation preload IPC
  → main: 소유권·접수·창·FIFO·저장 순서
      → codex: 로컬 app-server JSONL stdio
      → Store → 저장 worker → state/history/save-journal/delete-journal
      → 검색 worker → bounded-file
      → 첨부/응답 이미지 → bounded-file + cache-quota
      → 팩 검증/관리·말투·스킨
```

현재 스택은 package.json의 Electron/CommonJS main, vanilla ESM renderer, esbuild, MarkdownIt+DOMPurify, Node worker_threads, JSON 파일 저장, node:test/ESLint다. 기존 앱을 유지하면 런타임·이관 비용이 작다. 대신 main/renderer 결합도, 큰 JSON 처리, 파일 트랜잭션 한계가 남는다. 의존성을 새 버전으로 바꾸는 작업은 포함하지 않았다.

초기 분석 시 main 1,613줄, renderer 1,194줄이다. `src/*.cjs`의 리터럴 로컬 require 정적 그래프에서는 순환을 발견하지 않았고 main 직접 모듈 의존성은 12개였다. 동적 require 전체까지 순환 부재를 증명한 결과는 아니다. 상태 전달 순서를 숨기는 범용 dispatcher나 단순 인라인 로직의 helper 분리는 도입하지 않는다. 프로세스·저장·팩 검증처럼 책임/실패 경계가 다른 부분만 분리한다.

### 저장 스키마와 트랜잭션

현재 DB 스키마에 해당하는 저장 계약은 v2 JSON이다. SQL DB는 사용하지 않는다.

| 저장소 | 핵심 구조 | 제약 |
|---|---|---|
| state.json | version=2, settings, activeConversationId, conversations[] | 8MiB, 소유 UUID/중복·설정 검사 |
| conversations/UUID.json | id, source, threadId, messages[] | 32MiB, role/id/상태·자료 참조 검증 |
| save-journal.json | version, historyId, stateHash, historyHash | staging→저널 확정→본문→목록 교체→저널 제거 |
| delete-journal.json | id/ids, threadId, codexPath/workspace, phase | 승인한 소유 범위만 정리; 미확정 원격 삭제 자동 추측 금지 |
| 자료 캐시 | hash/ID별 파일과 미리보기 | canonical root 소유권, 512MiB quota, publish 직전 전체 identity 재검증 |

외래키에 해당하는 관계는 main/Store에서 검사한다. 인증 토큰은 이 스키마에 넣지 않는다. 저장 저널은 프로세스 중단 복구이며 전원 상실에 대한 DB 수준 내구성을 보장하지 않는다. 페이지별 파일/SQLite 이관이 필요하면 구버전 읽기·백업·중단 복구·rollback을 별도 설계하고 난 뒤 도입한다.

### 내부 API와 인증·권한

| API | 현재 계약 | 실패/동시성 |
|---|---|---|
| preload action(action,payload) | 소유 창/mainFrame 검증 후 main action 처리 | 상태 변경은 저장 대기, 제어 경로는 예외; await 이후 필요한 소유권 재검사 |
| send | 입력·첨부·설정 고정, 자리 예약·질문 저장 | 초과 접수 거절, 실패 초안 보존, 모델 자동 재전송 금지 |
| open-conversation / load-older | 소유 대화, 로컬 읽기/원격 조회·검증·저장 | 저장 이후 cursor 갱신, 취소·세대/연결 교체 시 늦은 결과 폐기 |
| search-conversations | query 1~200자, 성공/실패·불완전 결과 구분 | 방문 100개·32MiB·50건 예산, 단일 worker 교체/취소 |
| respond / cancel | 소유 요청/턴에 응답·중단 | 승인 UI가 표현 못하는 요청/대상은 허용하지 않음 |
| Store.save / saveAsync | 한 번에 한 저장, worker 결과 후 등록부 반영 | 불확실한 실패는 쓰기 차단, 저장 중 sync save 금지 |
| app-server RPC | JSONL stdio, pending ID·timeout·frame 제한 | 프로세스 종료 시 pending 정리, 프롬프트를 셸 문자열에 삽입하지 않음 |

CLI의 기존 로그인 캐시를 재사용한다. 앱은 별도 회원 서버나 공용 로그아웃을 만들지 않는다. 로컬 권한 경계는 소유 창·프레임·대화·턴·revision, 허용 경로, 명시적 승인 대상이다. 같은 OS 권한을 가진 외부 프로세스 전체를 격리하는 보안 경계는 아니다.

renderer는 메시지 Map/patch와 단계 목록으로 갱신하고 Markdown은 정제한다. ASAR 패키지는 worker unpack과 preload·bundle·팩·라이선스 고지를 함께 포함해야 한다. 릴리스는 기본 검사 → 번들 → 허용받은 GUI/ASAR 수용 → 서명/공증·플랫폼 설치 수용 → 명시된 배포 대상 순서다. 이번에는 번들까지만 실행하며 설치·배포 완료로 표시하지 않는다.

## 4. 위험도·비용·의존성에 따른 실행 테스크

상태는 **완료 / 다음 / 설계 대기 / 환경 수용 대기**로 구분한다. 완료는 아래 실행 증거 범위만 뜻한다.

| ID / 우선순위 | 작업·담당 역할 | 의존성 / 완료 조건 | 상태 |
|---|---|---|---|
| ENG00 / P0 | 제품·모듈·데이터/권한·기존 변경 인수인계 / Architect | 기존 계약·보류 정책·7개 요청과 매핑 | 완료 |
| ENG01 / P0 | 기본 검증·저장 성능 기준선 / SRE | GUI/모델 없이 verify, 20표본×2 동일 소스·hash/원자료 | 완료 |
| ENG02 / P0 | 대화 읽기 identity 결손 RCA·수정 / Implementation | expected/FD/named 대조, read/open/startup·원본/FD 회귀 | 완료 |
| ENG03 / P0 | 초기 읽기 실패 뒤 worker 쓰기 지속 차단 / Implementation + Reviewer | 실제 worker 교체 주입·후속 저장 거절·삭제 저널 보존, 독립 재검토 | 완료 |
| ENG04 / P1 | 큰 기록의 초기 로드/전환·중복 JSON 비용 / Architect→Implementation | 아래 revision/저장 순서 설계 후 1/8/24/30MiB 전후 각 20표본, 취소/종료/late commit 회귀 | 다음 |
| ENG05 / P1 | 캐시 publish 최종 O(N) 비용 / SRE→Implementation | 0/1,000/10,000개 × 신규/중복 1/8개, root 소유권·동시 성장/교체 방어 유지 | 설계 대기 |
| ENG06 / P1 | 40페이지 저장 증폭 / Architect→Implementation | 20.52093배 기준선, batch/page 형식의 cursor·중단·이관·구형 읽기/rollback 먼저 설계 | 설계 대기 |
| ENG07 / P2 | 삭제 관계 조회 RPC 비용 / SRE→Architect | 소유 1/100/1,000개, 지연/timeout·전체 deadline, 실제 capability/파생 관계 계약 확인 | 설계 대기 |
| ENG08 / P2 | 개인정보 없는 장애 진단 보강 / Architect→Implementation | bounded reason/count/timing, 원문/경로/토큰 제외, 외부 전송 없음; export 계약·회귀 | 설계 대기 |
| ENG09 / P2 | 전체 펼침 DOM 성능·클래식 미완료 조합 / SRE+Reviewer | GUI 시간 허용 후 최초 100개/전체 20표본, 포커스/입력·검색·메뉴 회귀 | 환경 수용 대기 |
| ENG10 / 릴리스 필수 | 설치·ASAR·서명/공증·플랫폼/장시간 수용 / Reviewer+SRE | 최신 source에서 각 대상 근거. Windows/Intel·물리 IME·전원·배터리 별도 | 환경 수용 대기 |

ENG04 구현 전 고정할 계약:

1. 합성 규모 기준과 목표를 먼저 확정한다. 후보는 목록 50→5,000개, 캐시 100→10,000개, 본문 0.3→30MiB다. 기존 바이트 한도를 유지하며 fixture 실제 크기를 기록한다. 실제 사용자 SLO와 다르게 잠정 채택 기준은 주지표 중앙값 20% 개선 또는 명시한 동기 main 비용 제거, 보조 p95/메모리 악화가 반복되면 원인 재검토다. 아직 달성한 목표가 아니다.
2. 읽기 요청에 conversationId·요청 token·registryRevision을 묶는다. 새 전환/삭제/종료 후 도착한 결과를 적용하지 않는다.
3. 현재 대화 저장 완료 → 새 본문 검증 → 새 활성 state 저장 → 화면 확정 순서를 유지한다. 저장 대기 중 제어 IPC를 막지 않는다.
4. worker에 의한 복구/저장과 읽기가 같은 파일을 소유하는 시점을 명시한다. reader가 저널 복구를 임의 실행하지 않는다.
5. 변경 revision을 건너뛰어 오래된 fingerprint를 재사용하지 않는다. 설정만 저장하는 경로와 본문 변경 경로를 구분한다.
6. worker timeout/exit, 연결 교체, 취소, 크기 초과, ENOSPC, 종료·재시작에서 이전 화면/원본/저널이 보존되어야 한다.

우선순위는 데이터 손실 가능성 > 사용자 제어 응답성 > 저장 증폭 > 화면 비용이다. main/renderer 대규모 분리는 ENG04/06에서 실제 소유권·테스트 경계를 개선할 때만 한다. 기존 [성능 잔여 목록](../../TASKS.md#다음-검증과-성능-작업)의 P01/P07·P04·P05·P06·P03과 각각 ENG04·05·06·07·09가 대응한다.

## 5. RCA와 실제 수정

### Major A — 읽기 경로 교체를 수용

- 가설: FD만 검증하면 파일 이름이 가리키는 대상을 놓칠 수 있다.
- 재현 조건: canonical 임시 프로필의 소유 history JSON을 첫 lstat 뒤/open 직전 또는 마지막 fstat snapshot 직후 다른 일반 JSON으로 교체한다. 같은 OS 권한의 writer가 필요하다.
- 호출 경로: readHistory 직접 호출 / openConversation / Store 생성자의 활성 대화 읽기.
- 상태 변화·실패: 기존 FD가 안정적이어도 처음 검사한 파일과 열린 파일 또는 읽은 파일과 최종 경로가 다를 수 있는데 결과를 수용했다.
- 근본 원인: 최초 lstat 결과를 보관하지 않았고 읽기 후 named identity 대조가 없었다.
- 영구 수정: 최초 lstat의 dev/ino/size/mtime/ctime을 열린 FD와 대조하고, 읽기 후 FD와 named 파일을 다시 대조한다. 크기+1 bounded 읽기·nonblocking/no-follow·UTF-8·finally close는 유지한다.
- 회귀: 새 6개가 수정 전 모두 실패 → 수정 후 통과. 전환 실패는 이전 활성 메모리/state를 유지하며 두 실제 파일도 보존한다.

### Major B — 감지 후에도 worker가 쓰기를 지속

- Reviewer가 A 수정 이후 독립적으로 재현했다. 경로 교체를 감지해도 Store 생성자가 state 백업만 확보한 상태에서 writeBlocked=false로 남았다.
- 호출 경로: worker 시작 → new Store → 활성 readHistory 실패 → 생성자 catch → main 데이터 수신 → store.save → 교체된 파일 덮어쓰기.
- 근본 원인: state 백업 성공을 활성 본문 읽기 실패에도 충분한 복구 조건으로 취급했다. state 백업에는 본문이 없다.
- 영구 수정: 시작할 때 활성 본문을 안전하게 확보하지 못하면 writeBlocked=true를 유지한다. 이후 save/saveAsync와 자동 삭제 복구를 실행하지 않는다.
- 회귀: 실제 Node worker 두 시점 교체 주입, startup 두 시점, 누락 본문·손상 JSON·잘못된 UTF-8와 삭제 저널 보존을 확인했다. 보강한 테스트에서 수정 전 5개 실패 → 수정 후 전체 11개 통과.
- 임시 완화: 차단 상태에서 원본/교체 파일·state 백업·저널을 보존하고 저장 위치를 점검한 후 재시작한다. 자동 재시도나 파일 삭제로 차단을 해제하지 않는다.

변경은 [Store](../../src/store.cjs)와 [11개 회귀](../../test/history-identity.test.cjs)에 한정한다. 저장 형식·IPC 계약·CLI 질문 흐름은 바꾸지 않았다. 신규 JSON 손상 복구 정책 전체나 모든 TOCTOU를 해결한 것으로 확대하지 않는다. 최종 검사 이후 외부 프로세스의 재교체·상위 디렉터리 동시 변조는 한계로 남는다.

## 6. 100배 확장과 성능·관측성 설계

실제 사용자 수·QPS·읽기/쓰기 비율·서비스 SLO는 제공되지 않았다. 현재 단일 사용자 앱의 확장은 **기록 수·본문 크기·캐시 파일 수**로 측정한다. 32MiB 단일 대화, 8MiB 목록, 512MiB 캐시, 큐 10개 제한을 확장 목표 때문에 조용히 늘리지 않는다.

| 자원 / 가설 | 실측/검증 방법 | 선택과 trade-off |
|---|---|---|
| CPU / JSON·SHA | 1/8/24/30MiB load/save의 CPU·main loop·전체 시간 | worker는 main 지연을 줄이나 구조화 복사·전체 직렬화 비용은 남음 |
| 메모리 / 문자열·복사 | heap delta/retained·peak RSS를 구분, worker input/output byte | 원시 snapshot 제거는 이미 구현됨. 추가 캐시는 상한·무효화 필요 |
| 파일 I/O / 재저장 | 40페이지 실제 성공 payload byte/횟수, 전환·재시작 | page/batch는 증폭을 줄일 수 있으나 이관/부분 확정 복잡도 증가 |
| 캐시 / 최종 stat | 파일 수별 prepare/verify·loop 지연·hit/miss | mtime 캐시만으로 quota 우회하지 않음. 소유권/검사 비용을 함께 설계 |
| 네트워크 / CLI RPC | 실제 모델과 fixture를 분리, 삭제 read 수·전체 deadline | 기존 최대 4개 관계 read 동시성을 유지. bulk API나 추가 확대는 capability 확인 후 채택 |
| 렌더링 / 전체 목록 | GUI 허용 후 DOM 수·long task·최초 조작·전체 확장 | 먼저 단계 표시 재사용. 가상화는 입력/스크롤 복잡도를 측정과 비교 |

서비스 경계는 현재 프로세스·저장·검증 경계를 유지한다. 단일 main은 조정의 SPOF이고 로컬 디스크/CLI는 의존 실패 지점이다. worker 격리, RPC timeout, 쓰기 차단, 저널 복구로 실패를 제한하되 main 전체 장애가 사라진다고 주장하지 않는다. FIFO admission은 자원 상한이며 원격 서비스 rate limit을 대체하지 않는다. 원격 제한 실패는 사용자에게 알리고 중단/대기 상태를 보존하며 자동 유료 재전송을 하지 않는다.

같은 조건의 **현재 소스 반복 측정** 결과:

| 측정 입력 | 1회 중앙값 / p95 (ms) | 2회 중앙값 / p95 (ms) |
|---|---:|---:|
| 29,998,539B 기록 초기 로드 | 50.05 / 66.37 | 46.82 / 109.68 |
| 변경 없는 동기 저장 | 37.72 / 59.68 | 34.88 / 63.47 |
| 변경된 기록 worker 저장 | 76.78 / 103.02 | 71.26 / 130.30 |
| 40페이지 누적 저장 | 132.28 / 162.85 | 144.58 / 208.03 |

각 20표본, Node v24.22.1 합성 로컬 프로필이다. source SHA-256은 `a4d119c76ae38c5618da6a88189b4ff565d0c37e93f72a112e32549e429049aa`로 같다. 스크립트의 before/after 이름은 **성능 개선 비교가 아니다**. 최종 1,250,589B에 성공 payload 쓰기 25,663,250B/120회로 20.52093배다. OS 물리 쓰기·실제 Electron 입력 지연·배터리 성능은 측정하지 않았다. 이 기준 소스는 이번 안정성 수정 전 작업 트리이며 HEAD와도 다르다.

[측정 원자료](../../artifacts/engineering-2026-10-27/store-baseline.json)와 [제약/검증 metadata](../../artifacts/engineering-2026-10-27/store-baseline-metadata.json)를 보존한다. 성능 수정 채택은 같은 fixture/hash·준비 실행·교차 20표본, 중앙값/p95·메모리·부수 비용과 안전성 회귀를 함께 비교한 뒤 결정한다. 이번 수정은 정확성 수정이며 성능 향상을 주장하지 않는다.

현재 장애 신호는 store.warning/writeBlocked, 연결 상태, 선택형 응답 timing과 종료 저장 오류다. 새로운 지속 통계는 ENG08에서 bounded reason code/횟수/시간을 설계한다. 사용자에게 필요한 저장 차단은 기존 상태로 전달하고 자동 OS 알림/외부 수집은 추가하지 않는다. 현 단계에서 저장 실패율/worker 종료 통계가 구현됐다고 표시하지 않는다.

## 7. 독립 역할 검토와 배포 전 통과 기준

| 역할 | 실제 수행·판정 |
|---|---|
| Architect | 제품/요구·로컬 그래프·도메인·trade-off 분석, A 독립 재현, 우선순위 권고 |
| Implementation Engineer | 주 에이전트가 A/B 수정, red→green 회귀·기존 변경 보존·문서/테스크 연결 |
| Reviewer | Store/worker/Codex/preload 전체와 main 핵심 경로 독립 검토, A 수정 재검토에서 B 발견·구현으로 반려. B 수정 후 관련 55개 직접 실행·범위 내 최종 승인 |
| SRE/Optimizer | 기본 verify 289개 통과, 동일 소스 기준선 20표본×2 측정·원자료/제약 보존 |

Blocker는 조사 범위에서 재현하지 못했다. Major A/B는 수정·독립 재검증을 마쳤고 추가 결함은 발견하지 못했다. 높은 main 결합도·동기 JSON·쓰기 증폭은 기술 부채로 ENG04–06에 연결한다. 줄 수·스타일만을 배포 Blocker로 만들지 않는다.

최종 게이트는 코드/테스트 독립 재리뷰 → `npm run verify` → `npm run build` → 결과/hash 기록이다. UI가 필요한 수용은 기본 게이트와 분리해 미검증으로 남긴다. 범위를 넘는 프로덕션 전체 승인·외부 배포·미실행 GUI 통과를 선언하지 않는다.

| 최종 실행 | 실제 결과·근거 |
|---|---|
| 독립 코드 리뷰 | 이번 저장 수정 범위 승인, 관련 55개 통과, 추가 Blocker/Major/Minor 발견 없음 |
| `npm run verify` | lint·구문/기본 팩·테스트 300/300 통과, 실패/skip 0. [전체 로그](../../artifacts/engineering-2026-10-27/final-verify.log) |
| `npm run build` | RENDERER_BUNDLE_OK. [로그](../../artifacts/engineering-2026-10-27/final-build.log) |
| `git diff --check` | 통과. 기존 변경까지 검사했으나 기존 변경 전체의 독립 코드 승인을 뜻하지 않음 |
| GUI/ASAR/설치·실제 모델 | 실행하지 않음. 이전 후보의 GUI 근거를 이번 저장 변경의 성공으로 표시하지 않음 |

11개 회귀 추가로 기본 테스트 수는 289→300이다. 원자료/검사 로그는 로컬 ignored artifacts에 있으며 저장소에 자동 커밋되지 않는다. 이 문서와 테스트 소스가 지속적인 계약을 기록한다.

릴리스 전 반드시 남는 항목은 최신 코드의 실제 ASAR/설치 수용, 플랫폼별 설치·서명/공증, 물리 IME·전원/다중 모니터 및 장시간 자원 관찰이다. ENG04–09 성능/진단 작업은 각각 완료 기준을 충족해야만 완료로 전환한다.
