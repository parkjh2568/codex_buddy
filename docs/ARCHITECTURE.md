# 개발 구조

Electron main이 창·로컬 Codex CLI·작업 접수와 저장 순서를 소유한다. renderer는 sandbox와 context isolation 아래에서 좁은 preload IPC만 사용한다. 원격 웹 콘텐츠나 팩의 실행 코드를 로드하지 않는다. [사용법](USER_GUIDE.md)·[개발 명령](BUILD_GUIDE.md)·[현재 검증 상태](ALPHA_REPORT.md)는 각각의 기준 문서를 따른다.

## 모듈과 책임

```text
버디 / 안내 / 대화 renderer → preload → main.cjs → codex.cjs → 로컬 app-server stdio
                                       ├─ connection-setup.cjs / models.cjs
                                       ├─ store.cjs → store-worker.cjs
                                       ├─ history-search-worker.cjs
                                       ├─ attachments.cjs / response-images.cjs → cache-quota.cjs
                                       ├─ packs.cjs / asset-validator.cjs
                                       ├─ pack-library.cjs / personas.cjs / skins.cjs
                                       └─ storage-maintenance.cjs
```

| 경계 | 책임 |
|---|---|
| main / preload | 소유 창·주 프레임·대화·작업 revision, 접수/실행/종료 저장 순서 |
| codex | 프로세스·JSONL·RPC·소유 thread/turn·요청/알림 수명 |
| connection-setup / models | CLI 탐색·인증 시도, 카탈로그·추론·속도 해석 |
| Store / 저장 worker | 설정·목록·본문 저장과 복구. 상세는 [저장 계약](LOCAL_STABILITY.md) |
| 검색 worker | query별 읽기·parse·검색과 늦은 결과 폐기. 예산은 [대화 조회](CONVERSATIONS.md) |
| 첨부 / 응답 이미지 | 자료 사본·내용 hash·decode·원본/미리보기·실패 파일 보존 |
| cache-quota | canonical root별 쓰기 소유권과 한 호출의 용량 snapshot |
| 팩 / validator / 팩 관리 / personas | 데이터 규격·decode·팩 변경·MD 충돌/생성 복구. [팩 계약](CHARACTER_PACKS.md) |
| storage-maintenance | 전체 참조 확인, 선택한 미참조 캐시의 복구 보관/복원 |

프로세스·저장·검증의 실패 경계로 모듈을 나눈다. 단순 상태 처리는 기존 함수 안에 두고 접수 순서를 숨기는 범용 dispatcher나 helper 프레임워크를 추가하지 않는다. renderer 의존성은 번들에 묶고 라이선스 고지를 전달한다.

## 접수와 실행

첫 await 전에 대화·첨부 ID·instructions/hash·이름·말투·모델·목적·스킬을 고정하고 대기 자리를 예약한다. preparing과 queue의 합은 10 이하다. 접수 확정 → 질문 저장 → 실행 FIFO → 소유 턴 수신 → 이미지 처리 완료 → 종료 저장 → 다음 질문 순서다. 승인 응답과 명시적 중단은 FIFO에 넣지 않고 저장 대기를 우회하는 제어 경로를 사용한다.

renderer는 submit을 즉시 잠그고 새 대화 첫 접수의 텍스트/첨부 초안을 새 ID로 옮긴다. 실패는 초안을 보존하며 성공한 첨부만 제거한다. 카드 Map과 질문별 입력 노드를 유지해 부분 갱신·재정렬에서 입력/선택을 보존한다. 실제/체험 응답은 구분한다.

turn/start 응답 전 알림은 최대 128개·256KiB 안에서 보류하고 소유 턴과 일치할 때만 적용한다. 식별자는 비어 있지 않은 UTF-8 1024바이트 이하이며 자르지 않는다. 다른/옛 턴 완료는 현재 interrupt 대상을 바꾸지 않는다. job의 종료 Promise가 종료 저장을 한 번 소유한다.

CLI stdout은 조각 배열과 프레임별 UTF-8 64MiB 한도를 사용한다. 여러 정상 프레임의 합계를 한 프레임 초과로 취급하지 않는다. 한도 초과·연결 오류는 pending을 정리하고 질문을 자동 재전송하지 않는다. 승인 내용·실행 대상을 확인할 수 없는 요청, writeStdin·알 수 없는 kind와 별도 추가 권한 프로필은 이 승인 UI에서 허용하지 않는다. 네트워크 전용 승인도 유효한 대상이 있어야 한다.

## 연결과 인증

연결·인증·작업 폴더·모델 준비를 나눈다. 단절 후 유휴 상태에서 한 번 자동 복구하며 중단 질문/대기줄을 자동 재개하지 않는다. 다른 실행 파일/폴더는 접근성과 initialize 확인 후 확정하고 기존 기록을 보존한다. 질문은 셸 문자열 대신 JSON 입력으로 전달한다.

로그인은 시도 ID·5분 타이머·공식 HTTPS URL 검증을 소유한다. CLI 인증 캐시를 재사용하고 토큰·이메일·로그인 URL을 앱 기록으로 복제하거나 공용 계정을 로그아웃하지 않는다. 인증/사용량 조회는 연결·계정 revision을 확인한다. dispose·연결 교체 뒤 응답과 옛 조회의 finally가 새 상태/소유권을 덮지 않는다. 로그인 완료 직후 계정 변경은 한 번 재확인하며 반복 변경은 재연결 안내를 유지한다.

## 모델 설정

model/list에서 ID·이름·설명·추론 단계·serviceTiers를, config/read에서 CLI 유효 기본값을 읽는다. 앱 자체 최초 기본값은 `gpt-5.6-luna / high`이며 이후 사용자 선택은 앱 설정에 보존한다. CLI 전역 설정은 수정하지 않는다.

| 선택 | turn/start에 명시하는 값 |
|---|---|
| CLI 기본값 + 기본 추론 | CLI 유효 모델·추론 |
| 지정 모델 + 기본 추론 | 지정 모델·그 모델의 defaultReasoningEffort |
| 지정 모델 + 지정 추론 | 검증한 두 값 |
| CLI 기본값 + 지정 추론 | CLI 모델·검증한 지정 추론 |

CLI 설정에 값이 없으면 카탈로그 기본값을 사용한다. 기본값 복귀도 값을 명시해 이전 override를 남기지 않는다. Standard는 serviceTierForTurn의 default, Fast 등은 CLI가 제공한 ID를 질문마다 전달한다. 미지원 옵션을 임의 생성하지 않는다. 모델 변경 뒤 속도가 미지원이면 Standard로 돌아가고, 목록 갱신에서 저장 속도가 사라지면 오류를 안내한다. 카탈로그가 실행 권한·최종 서버 등급·응답 속도를 보장하지 않는다.

패널 열기·포커스·모델 영역 접근·질문 전송에서 5분 캐시를 확인하고 수동 새로고침은 즉시 조회한다. 주기적 모델 호출은 없고 메뉴 포커스 중에는 받은 옵션 교체를 미룬다. CLI 실행 파일의 경로/identity/크기/시각 변경은 유휴 상태에서 재연결하며 실행·대기 질문을 보호한다. CLI를 자동 설치/업데이트하지 않는다.

## 창과 화면 수명

버디·안내·대화는 별도 창이다. 안내는 좁은 IPC만 허용하고 클릭 영역을 등록한다. noticeHitRevision과 성공 ACK로 영역을 갱신해 renderer 복구 뒤 옛 사각형을 사용하지 않는다. 이동 시 즉시, 정지 시 80ms 주기로 실제 클릭 영역을 확인한다. 창 배치·심플 숨김·포커스는 [UI 계약](UI_UX_REFINEMENT.md)이 기준이다.

숨겨진 패널은 상태/메시지 캐시만 갱신하고 보일 때 DOM을 반영한다. patch는 변경 upsert와 ID 순서만 보내며 변경된 메시지만 Markdown을 다시 해석한다. 상태 전송은 50ms로 묶고 완료는 즉시 예약한다. 로딩/종료 프레임에는 보내지 않는다. renderer는 한 번 자동 복구하며 재실패는 트레이에서 복구한다. UI 복구는 모델 질문을 재전송하지 않는다.

잠금은 표시·애니메이션·렌더 ACK를 억제하고 절전은 실행을 중단해 큐를 보존한다. 표시 ACK는 [시간 측정](RESPONSE_TIMING.md)의 대화·카드·완료 시각·예약 토큰을 확인하고 저장과 묶는다.

## 이미지와 첨부

파일 선택은 main이 소유하고 renderer에는 대화별 임시 ID만 준다. 사본을 보관하고 조회마다 링크·크기·hash를 확인한다. 이미지는 localImage, 일반 파일은 이름/보관 경로의 텍스트 자료로 CLI에 전달한다. 대화에는 이름·치수·hash 참조만 기록한다. 원격 기록 병합이 자료 안내로 사용자 원문을 덮어쓰지 않는다.

native imageGeneration과 성공 MCP 이미지 결과는 헤더·경로·실제 decode를 확인해 원본과 512px PNG 미리보기를 보관한다. 파일 입력은 소유 작업 폴더 또는 해당 thread 생성 이미지 폴더로 제한한다. 실패는 이미지 안내와 텍스트를 유지하며 재시작 pending은 실패로 확정한다. 다시 확인은 기존 CLI 기록을 읽는다.

job마다 8 ID·완료 갱신 16회·대기 UTF-8 payload 32MiB를 제한하고 같은 fingerprint를 중복 처리하지 않는다. capture에 필요한 필드만 유지하며 종료 저장은 capture 완료를 기다린다. 성공 검증 metadata는 최대 128개 LRU로 보유한다. 입력 SHA·정책·validator와 현재 원본/미리보기 hash가 모두 맞아야 decode를 재사용하며 바이트/base64는 LRU에 남기지 않는다.

캐시 적중은 내용 hash 확인 뒤 전체 quota 조사를 생략한다. 신규 쓰기는 root 소유권 아래 128개마다 yield하며 사용량을 조사한다. 같은 호출은 scalar snapshot을 재사용하고 매 비동기 staging 뒤 현재 목록·기존 모든 파일의 dev/ino/size/mtime/ctime·root·독립 임시 파일·예산을 동기 재검증한 뒤 publish한다. 파일→이미지→파일은 파일 lock을 해제하고 이미지 경계를 호출한 뒤 재획득한다. idle 소유권은 제거하며 다른 root는 병렬이다. 최종 O(N) 검사·외부 프로세스 변경의 한계는 남고 진행 중 I/O 취소 API는 없다.

## 파일과 복구 경계

bounded-file은 FD 크기+1 이내의 읽기·identity/경로/변경·finally close만 담당한다. decode·hash·보존 정책은 호출자가 소유한다. 자기 물리 ASAR 내부만 조회별 가상 inode 차이를 처리하며 실제 archive 전후 identity도 확인한다. 사용자 파일·다른 ASAR·unpacked 경로는 일반 FD 검사를 유지한다.

캐시 복원은 격리 staging을 완성·fsync·검증한 뒤 같은 파일시스템 hard link로 확정한다. 기존/변조 파일과 백업을 보존하며 미지원 때 덮어쓰기 rename으로 우회하지 않는다. Store 저널과 전원 상실 내구성은 [저장 계약](LOCAL_STABILITY.md), 파괴적 삭제 소유권은 [삭제 계약](DELETE_CONVERSATIONS.md)으로 구분한다.

날짜별 비용·실패/수정 판단은 [검토 이력](history/README.md), 조건부 확장과 미완료 범위는 [TASKS](../TASKS.md)를 따른다.
