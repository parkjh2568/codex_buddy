# 개발과 빌드

이 문서는 환경 준비·개발 실행·검증·아이콘 생성·패키징 명령의 기준이다. 현재 후보/검증 숫자/복구 위치는 [검증 상태](ALPHA_REPORT.md), 사용자 연결 안내는 [사용법](USER_GUIDE.md#첫-연결)을 따른다. 도구 버전은 [package.json](../package.json)과 lock 파일에 고정한다.

## 1. 빌드 환경과 결과물

Node.js는 22.13 이상인 22.x 또는 24 이상을 사용한다. 검증 환경의 24.x를 권장한다. npm 의존성과 공식 Electron 바이너리 다운로드에는 네트워크가 필요하다. 실제 대화에는 별도의 CLI/인증이 필요하지만 빌드·체험에는 필요하지 않다.

소스·package-lock.json·characters/·skins/·assets/를 가져와 대상 OS/CPU에서 npm ci를 실행한다. 다른 OS의 node_modules/Electron을 재사용하지 않는다. 생성 아이콘은 포함돼 있어 일반 빌드 전에 다시 만들 필요 없다. GUI 실행은 데스크톱 세션이 필요하다.

```sh
node --version
npm --version
node -p "process.platform + '/' + process.arch"
```

| Node 실행 환경 | 출력 디렉터리 | 상태 |
|---|---|---|
| darwin/arm64 | dist/OnggiBot-darwin-arm64/OnggiBot.app | Mac Apple Silicon 실행 이력 있음. 현재 후보 수용은 ALPHA_REPORT 확인 |
| darwin/x64 | dist/OnggiBot-darwin-x64/OnggiBot.app | Intel Mac 실기 미검증 |
| win32/x64 | dist/OnggiBot-win32-x64/OnggiBot.exe | Windows 실기 미검증 |
| win32/arm64 | dist/OnggiBot-win32-arm64/OnggiBot.exe | Windows ARM64 실기 미검증 |

타깃은 하드웨어가 아닌 실행 중 Node의 process.platform/process.arch다. Rosetta x64 Node는 Apple Silicon에서도 x64를 만든다. 현재 Electron은 win32/ia32를 제공하지 않으므로 32비트 Node로 빌드하지 않는다. 크로스 빌드·universal·CI 행렬 옵션은 제공하지 않는다.

## 2. MacBook/macOS 빌드

프로젝트 폴더에서 실행한다. 기본 검증은 창을 열지 않는다.

```sh
npm ci
npm run verify
npm run package -- --staging
```

staging은 dist/staging/에 생성한다. 기본 package는 표의 dist/에 생성하며 같은 타깃을 overwrite한다. **staging도 기존 staging을 덮어쓴다.** 해당 묶음을 먼저 정상 종료하고 보존할 이전 앱을 별도 위치로 옮긴다. 같은 앱 ID의 기존 프로세스가 살아 있으면 새 앱 실행이 기존 앱으로 전달될 수 있다.

Apple Silicon 후보를 직접 실행할 때:

```sh
open "dist/staging/OnggiBot-darwin-arm64/OnggiBot.app"
```

Intel 결과는 경로의 arm64를 x64로 바꾼다. 개발 실행은 npm start, 모델 없는 체험은 npm run demo다. demo는 일반 개발 프로필을 공유하므로 격리 검사로 취급하지 않는다.

### Mac 아이콘을 수정한 경우에만

```sh
npm run icons:generate
npm run icons:icns
npm run package -- --staging
```

icons:generate는 assets/tray-source.png를 보존하고 투명 여백을 제외해 중앙 배치한 앱 PNG/Windows ICO·메뉴 막대 18px/36px PNG를 만든다. 앱/Windows 트레이는 밝은 바탕, macOS 트레이는 투명 템플릿이다. 상단 로고도 같은 그림을 스킨 색상으로 표시한다. icons:icns는 macOS의 sips/iconutil을 사용한다. ICNS 단계를 생략하면 이전 아이콘이 들어갈 수 있다. 선택형 Icon Composer .icon 미발견 경고와 실제 ICNS 누락·빌드 실패를 구분한다.

기본 팩 재생성은 npm run characters:generate다. SVG/기하 필드는 바뀌며 기존 MD·metadata·추가 파일은 보존한다. [생성기 소유 범위](CHARACTER_PACKS.md#기본-팩-재생성)를 먼저 확인한다.

## 3. Windows 빌드

아래는 코드 기준 절차이며 Windows 성공 기록이 아니다. Windows 네이티브 PowerShell에서 실제 소스 폴더로 이동하고 해당 CPU Node를 사용한다. npm.ps1 정책 오류를 피하려 npm.cmd를 사용하며 전체 실행 정책 변경이나 관리자 실행을 기본 요구로 삼지 않는다.

```powershell
Set-Location 'C:\path\to\my_budy'
node -p "process.platform + '/' + process.arch"
npm.cmd ci
npm.cmd run verify
npm.cmd run package -- --staging
Start-Process '.\dist\staging\OnggiBot-win32-x64\OnggiBot.exe'
```

ARM64 Node로 생성한 경우 경로를 win32-arm64로 바꾼다. 개발 실행은 npm.cmd start, 체험은 npm.cmd run demo다. 아이콘을 수정했다면 npm.cmd run icons:generate 후 재패키징한다. Windows에서 icons:icns는 실행하지 않는다. PNG/ICO 생성의 플랫폼 분기는 있지만 실제 Windows 실행은 별도 확인한다.

전달에는 exe만 복사하지 않고 타깃 폴더 전체가 필요하다. 예:

```powershell
Compress-Archive -Path '.\dist\staging\OnggiBot-win32-x64\*' -DestinationPath '.\dist\OnggiBot-win32-x64.zip'
```

기존 ZIP은 다른 이름으로 보존한다. 실행 폴더 압축은 Setup.exe·MSI·MSIX 설치 프로그램 생성이 아니다. Windows는 Node 어댑터/콘솔 인수의 모의 검사와 네이티브/WSL·혼합 DPI·Snap·IME·링크/파일 잠금·트레이·투명 여백의 실기를 구분한다.

## 4. 검증 명령과 현재 Windows 한계

```sh
npm run verify
npm run smoke:changed -- --quick
```

verify는 lint/CSS·구문·제공 팩·전체 단위 검사다. 문서만 바꾸면 로컬 링크/앵커·명령·본문 보존·제품 입력 hash와 git diff --check를 확인한다. 문서 편집만을 이유로 전체 단위·GUI·패키지를 반복하지 않는다.

smoke:changed는 같은 입력의 최근 성공 증거를 재사용한다. 없으면 창을 열지 않고 blocked/종료 코드 2로 남긴다. --quick 또는 사례 이름으로 범위를 좁힐 수 있다. 재사용을 새 실행으로 집계하지 않는다.

**사용자가 화면 검증 시간을 허용한 뒤에만** 다음을 실행한다. --interactive는 실행 표시이며 사용자 허용을 대신하지 않는다. 실제 창·키보드·선택기·클립보드·알림은 작업 포커스에 영향을 줄 수 있다. 직접 Electron/CUA 우회, showInactive·숨긴 창·마지막 포커스 복원만으로 방해가 없다고 주장하지 않는다. [AGENTS](../AGENTS.md)를 따른다.

```sh
npm run smoke:quick -- --interactive
npm run smoke:integration -- --interactive
npm run verify:package -- --interactive
```

| 검사 명령 | 범위 |
|---|---|
| npm run smoke:quick -- --interactive | expansion·attachments·history·stability·chat-ui 5종. 실제 30초 경과만 생략 |
| npm run smoke:integration -- --interactive | 전체 15종 실제 실행·재사용 없음. 실제 30초 숨김 포함 |
| npm run smoke:integration -- --interactive attachments connection-images | 선택한 경계만 실행 |
| npm run smoke -- --interactive | 체험·기본 정렬·입력/Markdown·큐·notice |
| npm run smoke:chat-ui -- --interactive | +·답변 선택·심플 수명/보호·미리보기·크기 조절 |
| npm run smoke:attachments -- --interactive | 파일/이미지 사본·심플 FIFO·취소·기록 복원 |
| npm run smoke:connection-images -- --interactive | fixture 로그인/재연결·이미지. 실제 인증 아님 |
| npm run smoke:models -- --interactive | fixture 카탈로그/기본값/Fast·질문별 설정 고정 |
| npm run smoke:history -- --interactive | 목록·검색·재개·격리·재시작 |
| npm run smoke:delete -- --interactive | fixture 삭제 확인/실패/보존/재시도 |
| npm run smoke:buddy -- --interactive | 스킨·심플·말투 MD·팩 |
| npm run smoke:lifecycle -- --interactive | 잠금/절전 합성 이벤트와 수명·blink. 물리 전원 수용과 구분 |
| npm run smoke:stability -- --interactive | 숨김/재표시·renderer 복구·긴 원문 |
| npm run smoke:floating -- --interactive | 합성 이동·앵커·클릭 영역 |
| npm run smoke:pointer -- --interactive | 투명 여백 뒤 버튼의 수동 마우스 확인 |
| npm run smoke:timing -- --interactive | fixture 구간·FIFO·ACK·토글 |
| npm run smoke:performance -- --interactive | 긴 기록·추가 로드·patch·스크롤·용량 |
| npm run smoke:assets -- --interactive | 격리 이미지 decode/보안 검사 |
| npm run smoke:resources -- --interactive | 움직임/줄이기/숨김 각 10분. 배터리 개선 비교 아님 |
| npm run verify:package -- --interactive | 실제 staging ASAR·worker·아이콘·큰 이미지·첨부/복구 |
| npm run smoke:packaged-resources -- --interactive | ASAR 5상태 자원 관찰 옵션·기본 시간은 아래 설명 |

위 UI/fixture 검사는 실제 모델을 호출하지 않는다. 다음 검사는 실제 계정 이용량을 쓰며 검증용 세션을 생성한다. 요청받은 범위에서만 실행한다.

| 명령 | 영향 |
|---|---|
| npm run codex:smoke | 실제 응답·재연결/재개·소유 턴 중단 후 검증 세션 보관 |
| npm run codex:personas | 두 캐릭터×네 말투 실제 응답/전환·검증 세션 보관 |
| npm run codex:delete-smoke | 검증용 실제 세션 생성/응답 후 해당 ID 삭제 |
| npm run smoke:real -- --interactive | 실제 모델+앱 UI 왕복 |
| npm run codex:attachments -- --interactive | 합성 이미지/파일의 실제 읽기+OS 입력. 원래 클립보드 접근은 별도 허용 |

Windows는 위 npm 명령을 npm.cmd로 바꾼다. check·lint·test는 verify에 포함되며 필요할 때 개별 실행한다. 생성/컴파일만 필요하면 npm run build를 사용한다.

### 증거 재사용과 반복 범위

증거는 artifacts/integration-smoke/last-success.json에 보관한다. 소스·검사 스크립트·fixture·팩/스킨/아이콘·package/lock·Node/Electron·OS/환경 입력 SHA가 같고, 24시간 안에 성공 종료/결과/프로필 정리를 확인한 사례만 재사용한다. 단위/문서는 UI 입력을 바꾸지 않는다. 만료·미래 시각·손상·실패·검사 중 입력 변경은 재사용하지 않고 full chat-ui를 quick 결과로 대체하지 않는다.

PID 잠금으로 재사용까지 직렬화한다. 살아 있는 프로세스의 잠금을 지우지 않는다. 기본 stale 잠금은 복구하지만 runner.lock.recovery가 남으면 소유 프로세스 종료를 확인한다. running/passed:false는 최종 성공이 아니다. 명시적 실제 실행은 성공 JSON·exit·프로필 정리를 각각 확인한다.

소스 변경 뒤 필요한 경계를 먼저 확인하고 릴리스 후보의 전체 통합을 수행한다. 패키지가 바뀌면 실제 ASAR 검사를 추가한다. 기본/quick 검사에 전체 자원 관찰·대형 벤치·history 반복을 묶지 않는다. 해당 경계 변경·실패·비결정적 경합이 있을 때만 넓힌다. 모델 fixture의 소유 턴 명시 완료는 검증 조건을 유지하며 고정 대기만 줄이는 방식이다.

### 출력과 선택형 계측

통합 실행의 ONGGI_SMOKE_ROOT 미지정 시 artifacts/integration-smoke/run-*에 새 결과를 남긴다. 지정하면 실행별 절대 경로를 사용한다. 성공 프로필은 결과 보존 후 정리하고 실패 프로필은 남긴다. JSON의 sourceHashes/scriptHashes/fixtureHashes·시각·정리 상태를 대조한다.

패키지 검사는 --archive 경로 또는 --installed, 선택한 기록 복원은 --image-items JSON을 받는다. 개인 자료를 기본 입력으로 요구하지 않으며 격리 사본만 만든다. packaged-resources는 ASAR 경로·ONGGI_RESOURCE_PHASE_MS·ONGGI_SMOKE_ROOT를 받고 기본 움직임/줄이기/숨김 각 10분을 관찰한다. ONGGI_RESOURCE_BUDDY_PROFILES=1로 정숙/일상을 추가한다. 전원 출처/유휴·실제 이벤트 기록과 정상 복귀/배터리 효과 검증을 구분한다.

선택형 계측은 다음 환경 변수를 기존 UI 명령 앞에 둔다. 모든 GUI 계측은 사용자 시간 허용과 --interactive가 필요하다.

- ONGGI_PERFORMANCE_DETAIL=1: performance의 저장/읽기·검색/내보내기 큰 입력 계측.
- ONGGI_TIMING_PERFORMANCE_DETAIL=1: timing의 크기별 모의 중단·CPU 계측.
- ONGGI_HISTORY_COST_REVIEW=1: history의 선택 계측. 기본 artifacts/history-cost, LABEL은 ONGGI_HISTORY_COST_LABEL의 영문/숫자/하이픈 1–64자.
- ONGGI_NATIVE_CLIPBOARD_REVIEW=1: 현재 OS 클립보드를 읽고 임시 변경/복원하므로 별도 구체적 허용 필요. 복원 write 완료는 원본 payload 재읽기 확인과 다르다.

플로팅 재시작은 같은 ONGGI_SMOKE_ROOT에 floating 검사 → --verify-floating-restore 추가 → --verify-floating-recovery 추가 순서다. 매 단계 npm run smoke:floating -- --interactive를 사용하고 첫 결과/복원 완료를 확인한다. native-floating-review는 실제 마우스가 필요하다. 공용 옛 JSON으로 대체하지 않는다.

## 5. 현재 패키징 스크립트의 범위

package는 build를 먼저 수행해 renderer.bundle.js와 THIRD_PARTY_NOTICES.txt를 만든다. store.cjs/store-worker.cjs/history-search-worker.cjs/bounded-file.cjs 네 파일은 app.asar.unpacked/src에 함께 전달한다. 실제 worker 로드·제한 읽기에 필요하다.

앱은 src/·characters/·skins/·assets/·번들·라이선스·package metadata를 포함한다. node_modules·artifacts·dist·test·scripts·docs·.git·package-lock·루트 README/TASKS/AGENTS·검사 설정·renderer.mjs·tray-source.png는 제외한다. main은 내장 모듈만 쓰고 renderer 의존성은 번들에 포함한다. main용 npm 의존성을 추가하면 제외/번들 정책도 바꿔야 한다. 사용자 기록과 CLI 인증은 앱 빌드 입력이 아니다.

지원 옵션은 --staging과 --electron-zip-dir 디렉터리다. 후자는 해당 Electron 버전/OS/CPU의 공식 ZIP 캐시로 오프라인 패키징한다. --platform/--arch는 지원하지 않으며 알 수 없는 옵션은 overwrite 전에 거절한다. 대상 OS/CPU에서 해당 Node로 빌드하고 Packager 직접 호출로 프로젝트 제외/서명 규칙을 우회하지 않는다.

### 버전 관리

| 위치 | 역할 |
|---|---|
| package.json / package-lock.json | 소스 프로젝트 version |
| package.json onggiBuildVersion | 새 후보를 구분할 숫자형 빌드 ID. 패키지 metadata/CFBundleVersion과 대조 |
| scripts/package.cjs appVersion | 배포 앱 버전. packager가 패키지 내부 version을 바꿀 수 있음 |
| 패키지 onggiProjectVersion / CLI clientInfo | 소스 version을 보존해 앱·연결 식별에 사용 |

프로젝트/빌드 버전을 함께 확인하고 기존 staging 전체 앱을 보존한 뒤 생성한다. 정적 바이트 대조만으로 실제 ASAR loader·decode·worker·startup 성공까지 표시하지 않는다. 패키지 앱에 --smoke를 붙여 소스 smoke가 실행된다고 가정하지 않는다.

## 6. 연결과 배포

CLI는 앱에 동봉하지 않는다. Mac은 설치된 ChatGPT 앱 내부 CLI도 탐색 후보로 사용하지만 모든 PC에 그 경로가 있는 것은 아니다. 새 PC는 CLI·로그인·작업 폴더를 따로 준비한다. Windows 네이티브와 WSL은 다른 환경이다. [사용자 연결 안내](USER_GUIDE.md#첫-연결)를 따르고 패키징 성공을 인증/모델 성공으로 간주하지 않는다.

macOS 로컬 ad-hoc 서명과 최소 JIT entitlement를 사용한다. Developer ID·공증·Windows 서명·DMG/PKG·Setup.exe/MSI/MSIX·자동 업데이트는 별도 작업이다. 플랫폼별 실제 드래그·투명 클릭·트레이·Snap/DPI·IME·절전/모니터 수용은 [남은 작업](../TASKS.md#실제-환경에서-남은-수용)을 따른다.

## 7. 자주 막히는 지점

| 현상 | 확인 |
|---|---|
| Node 엔진 오류 / npm 없음 | 지원 Node·새 터미널·PowerShell npm.cmd |
| Electron 다운로드/DNS 실패 | 공식 다운로드·조직 프록시/DNS. 공식 ZIP 캐시 옵션을 쓰며 TLS 검증을 끄지 않음 |
| 예상과 다른 CPU | process.arch와 Rosetta/Node 아키텍처 |
| ICNS 실패 | macOS·sips/iconutil·assets/icon.png |
| 다른 PC에서 앱 실행 실패 | OS/CPU·폴더 전체 전달·대상 실기 |
| Windows 테스트 CLI 실패 | Node 어댑터·링크 권한. shell:true로 일괄 우회하지 않음 |
| 모델/로그인 오류 | 빌드와 분리해 CLI 경로·계정·네트워크·폴더 확인 |

## 검사 결과와 복구 자료

### 로컬 저장·전환 비용 비교

`scripts/store-cost-benchmark.cjs`는 화면과 실제 모델을 사용하지 않는다. before/after 각각 같은 시점의 `package.json`, `src/store.cjs`, `src/store-worker.cjs`와 필요한 로컬 CJS 모듈을 포함한 프로젝트 디렉터리를 지정한다. 단일 과거 Store 파일에 현재 worker를 보충하는 구형 호출 형식은 거절한다. 원본을 수정하지 않고 각 묶음을 임시 폴더에 복제해 실행한다.

```sh
node --expose-gc scripts/store-cost-benchmark.cjs \
  --before artifacts/engineering-2026-10-28/before \
  --after . \
  --output artifacts/engineering-2026-10-28/comparison-new.json \
  --sizes 1,30 --samples 20 --warmup 3 --instrumentation off,on
```

예시 before는 해당 실행의 로컬 snapshot이며 다른 checkout에는 없을 수 있다. 비교할 소스 묶음을 먼저 보존하고 상위 폴더가 존재하는 새 출력 파일 경로를 지정한다. 출력 파일이 이미 있으면 거절한다. `--cases`로 `constructor,read,unchanged,settings,first-worker,warm-worker,open-other,open-same,new` 중 선택하고, `--shapes long,short`로 메시지 형태를 나눈다. 기본은 long이다. `--sizes`는 목표 MiB이며 실제 JSON bytes·개수·fixture hash를 결과에서 확인한다. `--timeout-ms`, `--grace-ms`는 측정 runner의 watchdog/종료 유예이며 제품 저장 timeout이 아니다.

계측 off/on은 별도 child, before/after는 표본마다 교차 순서다. 준비·정답 확인·정리는 측정 구간 밖이다. 첫 worker와 warm worker 비용을 구분하고 실제 결과가 맞아야 성공 표본으로 남긴다. 상세 stage는 중첩된 inclusive 시간이라 합산하지 않는다. RSS 양 끝값/heap delta는 peak/retained가 아니며, write payload bytes는 물리 쓰기량이 아니다. Node 합성 결과를 Electron 화면·실기 입력·배터리·cold I/O 개선으로 확대하지 않는다. 도구 기능 테스트의 작은 표본은 성능 채택 근거로 사용하지 않는다.

v3의 `controlCallbackMs`는 작업 직전에 예약한 첫 callback의 실제 도착 지연이다. 비동기 작업 전체의 최대 정지나 실제 UI 입력 지연과 다르다. `eventLoopMaxMs`는 샘플 누락으로 긴 동기 차단을 놓칠 수 있어 단독 main 차단 수용 지표로 쓰지 않는다. 결과 `status: passed`는 정합성/수집 성공이며 성능 관문의 통과가 아니다. [첫 실행의 반대 신호와 수용 보류](history/ENGINEERING_REASSESSMENT_2026-10-28.md)를 함께 확인한다.

v4는 원인 분리용 `--expectations before|after`와 `--reverse-slots`를 추가했다. 기본 before는 두 기대값 객체를 측정 전에 만들고, after는 작업·callback 계측 뒤에 만들어 같은 내용 검증을 수행한다. fixture 문자열은 두 조건 모두 살아 있다. `setup`에는 준비 단계별 시간과 메모리, 명시적 GC 전후 상태가 담긴다. `runnerSlot`은 fork 순서이며 CPU 고정을 의미하지 않는다. reverse-slots는 요청 AB/BA 순서를 바꾸지 않는다. 기대값 수명·프로세스 순서가 다른 결과를 제품 최적화로 해석하지 않으며, 자연 GC·OS 스케줄링 원인은 이 도구만으로 확정할 수 없다. 실험 전 횟수·대조·중단 기준을 정하고 기존 원자료를 보존한다.

### 캐시 publish 비용 탐색

`scripts/cache-cost-benchmark.cjs`는 임시 프로필에서 신규/중복 파일·이미지 1·8개와 파일→이미지→파일 순서를 검사한다. 기본 실행은 작은 기능 smoke다. 예를 들어 아래는 각 root의 기존 파일 수를 늘리는 **단일 표본 탐색**이며 성능 비교나 p95 수용 검사가 아니다.

```sh
node scripts/cache-cost-benchmark.cjs \
  --files 0,1000,10000 \
  --cases new-file-1,new-file-8,duplicate-file-8,mixed \
  --samples 1 --bytes 65536 --instrumentation on \
  --output artifacts/cache-exploration.json
```

출력의 상위 폴더를 먼저 준비하고 새 파일명을 쓴다. `--instrumentation off`는 상세 probe를 끈 별도 실행이다. 제품 파일 4개의 hash와 도구/fixture hash, 결과 bytes·기존 파일 보존을 검증하고, 임시 폴더 정리가 끝난 뒤에만 결과를 기록한다. 제품 파일을 동시에 수정하지 않는다.

prepare/verify/hash/read/link/cleanup/staging 시간은 중첩되므로 더하지 않는다. 첫 callback은 비동기 작업 뒤쪽의 최대 정지를 보장하지 않는다. 이미지 validator는 source를 preview로 쓰는 fixture여서 실제 decode·축소 비용을 포함하지 않고, 중복 이미지 검증은 같은 Store에서 준비한 warm cache다. 준비 단계에서 기존 파일을 읽으므로 cold I/O도 아니다. RSS 양 끝값과 성공 write payload bytes를 peak 메모리나 물리 디스크 쓰기량으로 표현하지 않는다. 안전성 race·quota 경계 검증은 기존 `test/cache-quota.test.cjs`와 첨부/이미지 회귀를 함께 유지한다.

재사용 검사기는 scripts/에 두고 임시 결과는 artifacts/에 보존한다. 이전 버전의 개인 경로·일회성 벤치·성공/실패·자원 표본은 [이력 색인](history/README.md)을 따른다. 날짜별 환경이 다른 표본을 직접 성능 개선율로 비교하지 않는다.

과거 일회성 코드/앱의 [복구 압축본](../artifacts/legacy-cleanup-2026-10-12/cleanup-targets.tar.gz)과 [경로/파일/링크/hash 목록](../artifacts/legacy-cleanup-2026-10-12/removal-manifest.json)을 함께 사용한다. 새 빈 폴더에 필요한 항목만 복원·대조하고 현재 작업 파일·사용자 원본·백업을 일괄 덮어쓰거나 지우지 않는다.
