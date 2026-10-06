# macOS·Windows 빌드 가이드

기준: 2026-10-06, 프로젝트 `0.1.0-alpha.9`, 패키징 build14.

이 가이드는 현재 `package.json`과 `scripts/package.cjs`가 제공하는 명령을 기준으로 한다. macOS Apple Silicon 앱 생성·실행은 검증했다. Windows와 Intel Mac/Windows ARM64는 아래 코드 기반 절차를 실제 대상 환경에서 검증해야 한다. 빌드 결과물은 앱 실행 묶음이며 설치 프로그램이나 서명된 배포본은 아니다.

## 1. 빌드 환경과 결과물

| 항목 | 현재 기준 |
|---|---|
| Node.js | 권장: 검증한 24.x. Electron/Packager 패키지 요구 최소: 22.12.0 |
| 실제 macOS 검증 환경 | Node.js 24.21.0, npm 11.19.0, Apple Silicon |
| Electron | 44.5.1 |
| 패키징 도구 | `@electron/packager` 20.3.0 |
| 렌더러 번들 | esbuild 0.28.2 |
| 의존성 설치 | `npm ci`로 package-lock.json의 고정 버전 사용 |
| GUI | 개발 실행·아이콘 생성·UI smoke는 데스크톱 세션 필요 |
| 네트워크 | npm 의존성과 공식 Electron 배포 파일 다운로드에 필요 |
| Codex CLI | 앱 빌드·체험에 불필요. 실제 대화에 별도 설치·로그인 필요 |

소스 전체와 `package-lock.json`, `characters/`, `assets/`를 가져온다. 다른 OS의 `node_modules`나 Electron 실행 파일을 복사해서 재사용하지 않고 대상 환경에서 `npm ci`를 실행한다. 현재 저장소에는 빌드에 필요한 생성 아이콘이 들어 있어 일반 빌드 전에 아이콘을 재생성할 필요는 없다.

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

- `icons:generate`: 기본 캐릭터 SVG로 앱 PNG·Windows ICO 생성, 사용자 원본 `assets/tray-source.png`로 메뉴 막대 18px/36px PNG 생성.
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
| `npm run check` | JS 구문·기본 팩 확인 | 없음 | 빌드 전 기본 확인 |
| `npm test` | 저장·팩·프로토콜 등 핵심 검증 | 없음 | macOS 28개 통과, Windows fixture/심볼릭 링크 호환 미검증 |
| `npm run build` | UI 번들·라이선스 고지 생성 | 없음 | 컴파일 단계, 앱 패키지 생성은 별도 |
| `npm run smoke` | 격리 프로필의 체험 UI·큐 검증 | 없음 | 실제 데스크톱 세션 필요 |
| `npm run smoke:floating` | 격리 프로필의 경계 이동·앵커 확인 | 없음 | macOS 검증, Windows 실행 미검증 |
| `npm run smoke:pointer` | 투명 영역 뒤 버튼의 실제 클릭 | 없음 | 수동 클릭 필요 |
| `npm run smoke:history` / `smoke:models` / `smoke:timing` / `smoke:delete` | 테스트 CLI 기반 UI 검증 | 없음 | Windows 테스트 CLI 실행 방식 미검증 |
| `npm run codex:smoke` / `smoke:real` / `codex:delete-smoke` | 실제 CLI·계정 검증 | 있음 | 이용량 사용, Codex 준비 필요 |

Windows PowerShell에서는 위 npm 명령을 `npm.cmd`로 실행한다.

현재 프로토콜 테스트·일부 UI smoke는 `test/fixtures/*.cjs`를 셔뱅 기반 실행 파일로 직접 시작한다. Windows용 테스트 실행 어댑터는 아직 없으며, 심볼릭 링크 생성 테스트도 Windows 권한 차이가 있다. Windows에서 `npm.cmd test`를 실행해 실패하면 이를 Windows 지원 완료로 처리하지 않는다. 테스트 런처/권한 문제와 앱 코드 결함을 구분해 해결해야 한다.

Windows 빌드 후에는 최소한 캐릭터 표시·실제 드래그·Snap/크기 변경 억제·투명 영역 클릭 통과·대화 입력·트레이 위치 초기화·한글 경로·DPI/다중 모니터를 확인한다. 실제 CLI 연결·취소·저장/재개·삭제도 별도로 확인한다. 자세한 남은 범위는 [플로팅 보완 보고서](FLOATING_PET_UPDATE.md)에 있다.

개발용 smoke 명령은 소스 실행에만 적용된다. 패키징 앱에서 `--smoke`를 붙여 동일 테스트가 실행된다고 가정하지 않는다.

## 5. 현재 패키징 스크립트의 범위

`npm run build`는 렌더러 ESM을 `src/ui/renderer.bundle.js`로 묶고 `THIRD_PARTY_NOTICES.txt`를 생성한다. `npm run package`는 이를 실행한 뒤 Electron 런타임과 앱 소스를 묶는다.

패키지의 주요 내용은 `src/`, `characters/`, `assets/`, 렌더러 번들, 라이선스 고지다. `node_modules`, `artifacts`, `dist`, `test`, `scripts`, `docs`, `.git`, package-lock.json은 제외한다. 사용자 대화 파일과 CLI 인증 정보는 별도 앱/CLI 데이터 위치에 저장하며 빌드에 넣는 파일이 아니다.

현재 메인 프로세스는 Node/Electron 내장 모듈을 사용하고 렌더러 의존성은 번들에 포함한다. 앞으로 메인 프로세스용 npm 라이브러리를 추가하면 `node_modules` 전체 제외 정책과 백엔드 번들/생산 의존성 포함 방식을 함께 수정해야 한다.

### 다른 OS/CPU를 지정하는 옵션은 현재 없음

현재 `scripts/package.cjs`는 명령행의 타깃 옵션을 읽지 않는다. 따라서 다음처럼 인수를 추가해도 Windows 타깃으로 바뀌지 않는다.

```sh
# 현재 프로젝트 스크립트에서는 타깃 변경 효과가 없음
npm run package -- --platform=win32 --arch=x64
```

macOS용은 Mac에서, Windows용은 Windows에서 대상 아키텍처 Node로 빌드하는 것을 기본 절차로 한다. 크로스 빌드·macOS universal·CI 행렬은 별도 스크립트 확장이 필요하다. Packager를 직접 호출하면 프로젝트의 제외 규칙·아이콘·ASAR 설정을 놓칠 수 있으므로 이 가이드의 표준 절차로 대체하지 않는다.

### 버전 관리

| 위치 | 현재 값/역할 |
|---|---|
| package.json / package-lock.json | 프로젝트 `0.1.0-alpha.9` |
| scripts/package.cjs의 appVersion | 배포 앱 버전 `0.1.0`; 패키지 안의 package.json 버전도 이 값으로 변경됨 |
| scripts/package.cjs의 buildVersion | 현재 `14` |
| 설정 화면·CLI clientInfo | alpha.8 하드코딩이 남아 있음, 정리 작업 O09 미착수 |

프로젝트 version만 변경해도 현재 패키징 버전이 자동으로 따라가는 구조는 아니다. 배포 시 프로젝트·빌드 버전을 함께 확인한다.

## 6. 빌드 후 실제 Codex 연결

Codex CLI는 이 앱에 동봉하지 않는다. Mac에서는 현재 설치된 ChatGPT 앱 안의 CLI도 후보로 탐색하지만, 해당 경로의 존재를 모든 PC에서 보장하지 않는다. 다른 PC에서 실제 대화하려면 해당 환경에서 CLI 설치·로그인을 준비하고 앱 설정의 CLI 실행 파일/작업 폴더를 확인한다.

Windows의 네이티브 CLI와 WSL CLI는 다른 실행 환경이다. 현재 CLI 탐색·런처 처리와 최초 로그인 안내에는 미구현 항목이 있다. [최초 연결 검토](FIRST_RUN_REVIEW.md)를 참고하며, 패키징 성공을 인증·모델 실행 성공으로 간주하지 않는다.

모델 기본값은 `gpt-5.6-luna/high`다. 모델 제공 여부는 실제 CLI와 계정에 따라 확인해야 한다. 체험 응답은 실제 모델 응답과 구분한다.

## 7. 자주 막히는 지점

| 현상 | 확인할 내용 |
|---|---|
| Node 엔진 버전 오류 | `node --version`이 22.12.0 이상인지 확인. 이 프로젝트는 24.x 환경 검증 |
| `npm`을 찾을 수 없음 | Node 설치 후 새 터미널에서 확인. PowerShell은 `npm.cmd` 사용 |
| `ENOTFOUND github.com` / Electron 다운로드 실패 | 네트워크·DNS·조직 프록시와 공식 다운로드 접근 확인. TLS 검증을 끄는 방식으로 해결하지 않음 |
| 예상과 다른 CPU 결과물 | `node -p "process.arch"` 확인. 하드웨어가 아니라 Node 아키텍처가 타깃 기준 |
| ICNS 명령 실패 | macOS에서 실행하고 `sips`·`iconutil` 및 assets/icon.png 확인 |
| 앱이 다른 PC에서 실행되지 않음 | OS/CPU 일치, Windows 전체 실행 폴더 전달, 패키징 앱 실기 테스트 확인 |
| 모델 조회·로그인 실패 | 빌드 문제와 별개로 실제 CLI 경로·로그인·네트워크·작업 폴더 확인 |
| Windows 테스트 CLI 실행 실패 | 셔뱅 fixture/실행 어댑터 호환 확인. `shell:true` 전환으로 일괄 우회하지 않음 |

## 8. 외부 배포에 아직 필요한 작업

현재 스크립트에는 Developer ID 서명·공증, Windows 코드 서명, DMG/PKG·Setup.exe/MSI/MSIX 생성, 자동 업데이트가 없다. 로컬 앱 묶음 생성과 외부 사용자용 설치·배포 준비는 구분한다. 서명·공증과 플랫폼별 설치 프로그램은 C10/E07/B07의 후속 범위다.

이 문서를 추가하면서 Windows 아이콘 재생성에 적용되던 macOS 전용 템플릿 검증을 플랫폼 조건으로 분리했다. macOS 생성·기본 검증은 수행했고, Windows 명령의 실행 결과는 아직 확인하지 않았다.
