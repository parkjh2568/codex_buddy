# macOS·Windows 빌드 가이드

기준: 2026-10-10, 프로젝트 `0.1.0-alpha.16`. 기존 일반 실행 경로의 확인값은 alpha.14/CFBundleVersion 30, 최신 검증용 staging은 build32다. [변경 이슈 수정 결과](CHANGE_REMEDIATION_RESULT_2026-10-10.md)와 [첨부·대기열 전달 기록](ATTACHMENTS_AND_QUEUE_2026-10-10.md)에서 적용/검증 시점을 구분한다. 이전 staging build31은 `dist/rollback-alpha15-build31/`에 보존한다.

이 가이드는 현재 `package.json`과 `scripts/package.cjs`가 제공하는 명령을 기준으로 한다. macOS Apple Silicon 앱 생성·실행은 검증했다. Windows와 Intel Mac/Windows ARM64는 아래 코드 기반 절차를 실제 대상 환경에서 검증해야 한다. 빌드 결과물은 앱 실행 묶음이다. macOS에는 로컬 ad-hoc 서명을 적용하며 Developer ID/공증을 갖춘 외부 배포본이나 설치 프로그램은 아니다.

## 1. 빌드 환경과 결과물

| 항목 | 현재 기준 |
|---|---|
| Node.js | 권장: 검증한 24.x. 개발 도구 포함: 22.13 이상(22.x) 또는 24 이상 |
| 실제 macOS 검증 환경 | Node.js 24.21.0, npm 11.19.0, Apple Silicon |
| Electron | 44.5.1 |
| 패키징 도구 | `@electron/packager` 20.3.0 |
| 렌더러 번들 | esbuild 0.28.2 |
| 의존성 설치 | `npm ci`로 package-lock.json의 고정 버전 사용 |
| GUI | 개발 실행·아이콘 생성·UI smoke는 데스크톱 세션 필요 |
| 네트워크 | npm 의존성과 공식 Electron 배포 파일 다운로드에 필요 |
| Codex CLI | 앱 빌드·체험에 불필요. 실제 대화에 별도 설치·로그인 필요 |

소스 전체와 `package-lock.json`, `characters/`, `skins/`, `assets/`를 가져온다. 다른 OS의 `node_modules`나 Electron 실행 파일을 복사해서 재사용하지 않고 대상 환경에서 `npm ci`를 실행한다. 현재 저장소에는 빌드에 필요한 생성 아이콘이 들어 있어 일반 빌드 전에 아이콘을 재생성할 필요는 없다.

현재 스크립트는 `platform:process.platform`, `arch:process.arch`를 사용한다. 하드웨어 CPU와 실행 중인 Node.js의 아키텍처는 다를 수 있다. 먼저 프로젝트 루트에서 확인한다.

```sh
node --version
npm --version
node -p "process.platform + '/' + process.arch"
```

| 표시 결과 | 생성 폴더 | 실행 파일 | 확인 상태 |
|---|---|---|---|
| `darwin/arm64` | `dist/OnggiBot-darwin-arm64/` | `OnggiBot.app` | macOS 생성·실행 검증 |
| `darwin/x64` | `dist/OnggiBot-darwin-x64/` | `OnggiBot.app` | Intel Mac 실기 미검증 |
| `win32/x64` | `dist/OnggiBot-win32-x64/` | `OnggiBot.exe` | Windows 실기 미검증 |
| `win32/arm64` | `dist/OnggiBot-win32-arm64/` | `OnggiBot.exe` | Windows ARM64 실기 미검증 |

`win32`는 OS 구분 이름이고, `x64`/`arm64` 결과물은 64비트다. Electron 44는 공식 Windows `ia32` 바이너리를 제공하지 않으므로 32비트 Node.js로 빌드하지 않는다. 이 내용과 최소 Node 버전은 설치된 Packager README/engines에서 확인했다.

Rosetta로 실행한 x64 Node는 Apple Silicon Mac에서도 x64 앱을 만든다. Windows ARM 기기에서 x64 Node를 사용해도 x64 결과물이 생성된다. 네이티브 ARM64 빌드가 필요하면 ARM64 Node와 해당 환경의 의존성을 사용한다.

## 2. MacBook/macOS 빌드

터미널에서 소스 폴더로 이동한다. 아래 경로는 현재 프로젝트 위치이며 다른 PC에서는 실제 경로로 바꾼다.

```sh
cd /Users/jhpark/code/my_budy
node -p "process.platform + '/' + process.arch"
npm ci
npm run check
npm run lint
npm test
npm run package
```

Apple Silicon 결과를 실행한다.

```sh
open "dist/OnggiBot-darwin-arm64/OnggiBot.app"
```

Intel Mac에서 `darwin/x64`로 빌드했다면 다음 경로를 사용한다.

```sh
open "dist/OnggiBot-darwin-x64/OnggiBot.app"
```

`npm run package`가 렌더러 빌드를 먼저 수행하므로 `npm run build`를 별도로 반복할 필요는 없다. 동일 타깃의 `dist` 결과는 `overwrite:true`에 따라 교체된다. 빌드 결과를 갱신하기 전 기존 앱을 정상 종료하고, 보존할 이전 결과가 있으면 별도 위치에 보관한다.

### 실행 중인 앱을 유지하며 검토 빌드를 만들 때

```sh
npm run package -- --staging
```

이 옵션은 출력 폴더만 `dist/staging/`으로 바꾼다. Apple Silicon 결과는 `dist/staging/OnggiBot-darwin-arm64/OnggiBot.app`, Windows x64 결과는 `dist/staging/OnggiBot-win32-x64/OnggiBot.exe`다. 현재 실행 앱을 교체하지 않으므로 파일 검토에 사용한다. 기존 앱이 실행 중이면 같은 앱 식별자의 단일 실행 정책 때문에 새 빌드 실행이 기존 앱으로 전달될 수 있다. 최종 실행 검증은 기존 앱을 정상 종료한 뒤 수행한다.

### 개발 실행

```sh
npm start
```

실제 Codex 호출 없이 확인하려면 체험 모드를 사용한다.

```sh
npm run demo
```

`demo`는 연결 모드만 체험으로 고정한다. 일반 개발 앱 프로필을 사용하므로 실제 사용 기록과 완전히 분리된 테스트가 필요하면 아래 smoke 명령을 사용한다.

### Mac 아이콘을 수정한 경우에만

```sh
npm run icons:generate
npm run icons:icns
npm run package
```

- `icons:generate`: 사용자 원본 `assets/tray-source.png`로 앱 PNG·Windows ICO와 메뉴 막대 18px/36px PNG 생성. 원본 그림은 보존하고 투명 여백을 제외해 중앙 배치한다.
- `icons:icns`: macOS의 `sips`와 `iconutil`로 앱 PNG를 ICNS로 변환. 이 명령은 Windows에서 실행할 수 없다.
- 앱 아이콘을 바꾸고 `icons:icns`를 생략하면 macOS 패키지는 이전 ICNS를 사용할 수 있다.

패키징 중 `.icon` 형식이 없다는 경고가 나올 수 있다. 현재 프로젝트는 ICNS를 제공하며 Icon Composer의 `.icon` 자산은 제공하지 않는다. 설치된 Packager의 옵션 설명과 실제 앱 아이콘을 확인하고, 빌드 종료 코드와 `.app` 생성 결과를 별도로 판단한다.

## 3. Windows 빌드

Windows 네이티브 환경에서 빌드한다. 첫 검증 대상은 Windows 11 x64를 권장하며, 현재 Windows 실행 성공을 확인한 상태는 아니다. 아래는 PowerShell 명령이다.

`C:\path\to\my_budy`를 실제 소스 폴더로 바꾼다.

```powershell
Set-Location 'C:\path\to\my_budy'
node --version
npm.cmd --version
node -p "process.platform + '/' + process.arch"
npm.cmd ci
npm.cmd run check
npm.cmd run lint
npm.cmd run package
```

x64 결과를 실행한다.

```powershell
Start-Process '.\dist\OnggiBot-win32-x64\OnggiBot.exe'
```

Node가 `win32/arm64`라고 표시되고 해당 빌드가 생성된 경우에는 다음 경로를 사용한다.

```powershell
Start-Process '.\dist\OnggiBot-win32-arm64\OnggiBot.exe'
```

PowerShell에서 `npm.ps1` 실행 정책 오류를 피하기 위해 `npm.cmd`를 사용했다. 일반 빌드를 위해 관리자 실행이나 전체 스크립트 실행 정책 변경을 기본 절차로 요구하지 않는다.

### Windows 개발 실행·아이콘 재생성

```powershell
npm.cmd start
```

체험 모드:

```powershell
npm.cmd run demo
```

앱 아이콘 PNG/ICO 또는 메뉴 막대 PNG를 다시 만들 때:

```powershell
npm.cmd run icons:generate
npm.cmd run package
```

Windows에서는 `icons:icns`를 실행하지 않는다. Windows 패키징은 `assets/icon.ico`, 트레이는 컬러 `assets/icon.png`를 사용한다. 생성 스크립트의 macOS 템플릿 표시는 macOS에서만 검증하도록 분리했다. Windows에서 해당 명령을 실제 실행해 확인한 것은 아니다. [Electron 템플릿 이미지](https://www.electronjs.org/docs/latest/api/native-image#template-image-macos)

### Windows 실행 묶음을 전달할 때

`OnggiBot.exe`만 복사하지 않는다. `dist/OnggiBot-win32-x64` 또는 `dist/OnggiBot-win32-arm64` 폴더 전체가 필요하다. 런타임 DLL·resources·app.asar 등이 함께 있어야 한다.

예를 들어 x64 결과 전체를 ZIP으로 묶을 수 있다.

```powershell
Compress-Archive -Path '.\dist\OnggiBot-win32-x64\*' -DestinationPath '.\dist\OnggiBot-win32-x64.zip'
```

동일 이름의 ZIP이 이미 있으면 새 파일 이름으로 저장하거나 이전 파일을 별도 보관한다. 이는 실행 폴더 압축이며 `Setup.exe`·MSI·MSIX 설치 프로그램을 만드는 명령이 아니다.

## 4. 검증 명령과 현재 Windows 한계

| 명령 | 역할 | 실제 모델 호출 | 참고 |
|---|---|---|---|
| `npm run smoke:integration` | 13종 UI 검사, 이름을 인수로 주면 선택 실행 | 없음 | 격리 프로필·실패 시 비정상 종료 |
| `npm run verify:package` | staging ASAR·worker·아이콘·큰 이미지·첨부 사본 | 없음 | `--archive <app.asar>` / `--installed`, 개인 자료는 선택형 `--image-items` |
| `npm run smoke:packaged-resources` | 배포 ASAR 움직임/줄이기/숨김 CPU | 없음 | 경로 인수·ONGGI_SMOKE_ROOT·ONGGI_RESOURCE_PHASE_MS, 기본 30분 |
| `npm run codex:attachments` | 실제 이미지 색상/파일 표식 읽기 | 있음 | synthetic 입력·ephemeral Luna/high, ONGGI_CODEX_PATH 지원 |
| `npm run check` | JS 구문·기본 팩 확인 | 없음 | 빌드 전 기본 확인 |
| `npm run lint` | JS 미정의/미사용·CSS 문법/값/중복 속성 | 없음 | 빌드 전 정적 검사 |
| `npm run smoke:attachments` | 이미지/파일 첨부·미니 FIFO·사본 보존·기록 복원 | 없음 | 테스트 CLI/선택창 대역, 실제 모델 검증은 별도 수행 |
| `npm run smoke:connection-images` | 테스트 CLI 로그인·재연결·이미지 표시/저장 | 없음 | 격리 프로필, 실제 브라우저 인증은 미검증 |
| `npm run smoke:stability` | 숨김/미니/긴 원문/renderer 종료 복구·스킨 포커스 | 없음 | 격리 체험 프로필, macOS 검증 |
| `npm run smoke:resources` | 움직임·움직임 줄이기·숨김 각 10분 프로세스 CPU | 없음 | 총 30분, 배터리/전후 비교 검증 아님 |
| `npm test` | 저장·팩·프로토콜 등 핵심 검증 | 없음 | macOS 90개 통과, Windows 실기/심볼릭 링크 호환 미검증 |
| `npm run build` | UI 번들·라이선스 고지 생성 | 없음 | 컴파일 단계, 앱 패키지 생성은 별도 |
| `npm run smoke` | 격리 프로필의 체험 UI·큐 검증 | 없음 | 실제 데스크톱 세션 필요 |
| `npm run smoke:buddy` | 테스트 CLI의 스킨·미니·페르소나·MD 편집 검증 | 없음 | macOS 검증, Windows 미검증 |
| `npm run codex:personas` | 두 캐릭터 × 네 모드의 실제 응답·세션 전환 | 있음 | Luna/high, 검증 세션만 생성·보관 처리 |
| `npm run smoke:floating` | 격리 프로필의 경계 이동·앵커 확인 | 없음 | macOS 검증, Windows 실행 미검증 |
| `npm run smoke:pointer` | 투명 영역 뒤 버튼의 실제 클릭 | 없음 | 수동 클릭 필요 |
| `npm run smoke:history` / `smoke:models` / `smoke:timing` / `smoke:delete` | 테스트 CLI 기반 UI 검증 | 없음 | Windows Node 실행 어댑터 모의 검사, 실기 미검증 |
| `npm run codex:smoke` / `smoke:real` / `codex:delete-smoke` | 실제 CLI·계정 검증 | 있음 | 이용량 사용, Codex 준비 필요 |

Windows PowerShell에서는 위 npm 명령을 `npm.cmd`로 실행한다.

현재 프로토콜 테스트·일부 UI smoke의 `test/fixtures/*.cjs`는 Node 실행 파일과 인수 배열로 시작한다. Electron 실행 시 테스트 스크립트에는 Node 모드를 사용한다. Windows 생성 인수·콘솔 숨김·런처 거절은 모의 검사했고, 심볼릭 링크 생성 테스트와 Windows 실기는 여전히 검증이 필요하다. Windows에서 `npm.cmd test`를 실행해 실패하면 이를 Windows 지원 완료로 처리하지 않는다. 테스트 런처/권한 문제와 앱 코드 결함을 구분해 해결해야 한다.

Windows 빌드 후에는 최소한 캐릭터 표시·실제 드래그·Snap/크기 변경 억제·투명 영역 클릭 통과·대화 입력·트레이 위치 초기화·한글 경로·DPI/다중 모니터를 확인한다. 실제 CLI 연결·취소·저장/재개·삭제도 별도로 확인한다. 자세한 남은 범위는 [플로팅 보완 보고서](FLOATING_PET_UPDATE.md)에 있다.

통합/개발용 smoke 명령은 소스 실행에만 적용된다. 배포 검증은 별도의 `verify:package`, ASAR 자원 측정은 `smoke:packaged-resources`를 사용한다. 패키징 앱에서 `--smoke`를 붙여 동일 테스트가 실행된다고 가정하지 않는다.

## 5. 현재 패키징 스크립트의 범위

`npm run build`는 렌더러 ESM을 `src/ui/renderer.bundle.js`로 묶고 `THIRD_PARTY_NOTICES.txt`를 생성한다. `npm run package`는 이를 실행한 뒤 Electron 런타임과 앱 소스를 묶는다.

대화 저장 워커와 Store는 `app.asar.unpacked/src/store*.cjs`로 함께 전달한다. Worker의 실제 파일 경로 로딩을 위한 구성이며 두 파일을 함께 보존해야 한다. ESLint/css-tree는 개발 검사 전용이며 배포 앱에 포함하지 않는다.

패키지의 주요 내용은 `src/`, `characters/`, `skins/`, `assets/`, 렌더러 번들, 라이선스 고지다. `eslint.config.cjs`, `node_modules`, `artifacts`, `dist`, `test`, `scripts`, `docs`, `.git`, package-lock.json과 루트 README/TASKS/AGENTS/.gitignore, renderer.mjs 원본, tray-source.png 생성 원본은 제외한다. 소스 원본은 저장소에 유지한다. 사용자 대화 파일과 CLI 인증 정보는 별도 앱/CLI 데이터 위치에 저장하며 빌드에 넣는 파일이 아니다.

현재 메인 프로세스는 Node/Electron 내장 모듈을 사용하고 렌더러 의존성은 번들에 포함한다. 앞으로 메인 프로세스용 npm 라이브러리를 추가하면 `node_modules` 전체 제외 정책과 백엔드 번들/생산 의존성 포함 방식을 함께 수정해야 한다.

### 다른 OS/CPU를 지정하는 옵션은 현재 없음

현재 `scripts/package.cjs`는 `--staging`과 `--electron-zip-dir <폴더>`를 허용한다. 후자는 해당 버전/OS/CPU의 공식 Electron ZIP 캐시를 사용하는 오프라인 패키징 옵션이다. 잘못된 인수는 앱을 덮어쓰기 전에 거절하며 타깃 OS/CPU 옵션은 지원하지 않는다.

```sh
# 지원하지 않는 옵션이므로 오류로 종료하며 앱을 생성/교체하지 않음
npm run package -- --platform=win32 --arch=x64
```

macOS용은 Mac에서, Windows용은 Windows에서 대상 아키텍처 Node로 빌드하는 것을 기본 절차로 한다. 크로스 빌드·macOS universal·CI 행렬은 별도 스크립트 확장이 필요하다. Packager를 직접 호출하면 프로젝트의 제외 규칙·아이콘·ASAR 설정을 놓칠 수 있으므로 이 가이드의 표준 절차로 대체하지 않는다.

### 버전 관리

| 위치 | 현재 값/역할 |
|---|---|
| package.json / package-lock.json | 프로젝트 `0.1.0-alpha.16` |
| scripts/package.cjs의 appVersion | 배포 앱 버전 `0.1.0`; 패키지 안의 package.json 버전도 이 값으로 변경됨 |
| scripts/package.cjs의 buildVersion | 예외 수정 검증용 staging `32`; 기존 일반 실행 경로의 확인값은 `30` |
| CLI clientInfo | 소스 version과 패키징 시 보존한 onggiProjectVersion 사용: 양쪽 alpha.16 |

프로젝트 version만 변경해도 현재 패키징 버전이 자동으로 따라가는 구조는 아니다. 배포 시 프로젝트·빌드 버전을 함께 확인한다.

## 6. 빌드 후 실제 Codex 연결

Codex CLI는 이 앱에 동봉하지 않는다. Mac에서는 현재 설치된 ChatGPT 앱 안의 CLI도 후보로 탐색하지만, 해당 경로의 존재를 모든 PC에서 보장하지 않는다. 다른 PC에서 실제 대화하려면 해당 환경에서 CLI 설치·로그인을 준비하고 앱 설정의 CLI 실행 파일/작업 폴더를 확인한다.

Windows의 네이티브 CLI와 WSL CLI는 다른 실행 환경이다. CLI 재탐색·로그인 진단·브라우저 로그인 UI를 제공한다. Windows 설치·브라우저 콜백은 실기 미검증이며 [최초 연결 검토](history/FIRST_RUN_REVIEW.md#alpha13build28-연결-복구-적용)를 참고한다.  패키징 성공을 인증·모델 실행 성공으로 간주하지 않는다.

모델 기본값은 `gpt-5.6-luna/high`다. 모델 제공 여부는 실제 CLI와 계정에 따라 확인해야 한다. 체험 응답은 실제 모델 응답과 구분한다.

## 7. 자주 막히는 지점

| 현상 | 확인할 내용 |
|---|---|
| Node 엔진 버전 오류 | `node --version`이 22.13 이상(22.x) 또는 24 이상인지 확인. 이 프로젝트는 24.x 환경 검증 |
| `npm`을 찾을 수 없음 | Node 설치 후 새 터미널에서 확인. PowerShell은 `npm.cmd` 사용 |
| `ENOTFOUND github.com` / Electron 다운로드 실패 | 네트워크·DNS·조직 프록시와 공식 다운로드 접근 확인. 이미 공식 ZIP이 캐시에 있으면 --electron-zip-dir 사용. TLS 검증을 끄지 않음 |
| 예상과 다른 CPU 결과물 | `node -p "process.arch"` 확인. 하드웨어가 아니라 Node 아키텍처가 타깃 기준 |
| ICNS 명령 실패 | macOS에서 실행하고 `sips`·`iconutil` 및 assets/icon.png 확인 |
| 앱이 다른 PC에서 실행되지 않음 | OS/CPU 일치, Windows 전체 실행 폴더 전달, 패키징 앱 실기 테스트 확인 |
| 모델 조회·로그인 실패 | 빌드 문제와 별개로 실제 CLI 경로·로그인·네트워크·작업 폴더 확인 |
| Windows 테스트 CLI 실행 실패 | Node 실행 어댑터·심볼릭 링크 권한 확인. `shell:true` 전환으로 일괄 우회하지 않음 |

## 8. 외부 배포에 아직 필요한 작업

현재 macOS 빌드는 로컬 ad-hoc 서명과 최소 JIT entitlement를 적용한다. 스크립트에는 Developer ID 서명·공증, Windows 코드 서명, DMG/PKG·Setup.exe/MSI/MSIX 생성, 자동 업데이트가 없다. 로컬 앱 묶음 생성과 외부 사용자용 설치·배포 준비는 구분한다. 서명·공증과 플랫폼별 설치 프로그램은 C10/E07/B07의 후속 범위다.

이 문서를 추가하면서 Windows 아이콘 재생성에 적용되던 macOS 전용 템플릿 검증을 플랫폼 조건으로 분리했다. macOS 생성·기본 검증은 수행했고, Windows 명령의 실행 결과는 아직 확인하지 않았다.

## 검증 산출물과 이력

재사용 검사는 `scripts/`에 둔다. 임시 프로필/로그는 `artifacts/`에 기록하며 사용자 원본/복구 백업은 확인 없이 지우지 않는다. build26 전달과 당시 실기 범위는 [과거 빌드 기록](history/BUILD_NOTES_2026-10-08.md)에 보존했다. 현재 소스/staging 검증과 기존 설치본 보존은 [확장 결과](BUDDY_EXPANSION_RESULT_2026-10-10.md)를 따른다. build30 정리 당시의 기록은 [정리 결과](CLEANUP_RESULT_2026-10-10.md)에 유지한다.
