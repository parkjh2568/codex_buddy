# 플로팅 버디 보완 — alpha.9

검증일: 2026-10-06. Electron 44.5.1을 유지한다. 현재 네이티브 검증 환경은 macOS Apple Silicon이며 Windows 실행·빌드는 아직 검증하지 않았다. Slack은 사용자 요청에 따라 대기한다.

## 적용한 변경

- 캐릭터 창은 키보드 포커스·OS 기본 이동·최대화·최소화·전체 화면·사용자 크기 변경을 허용하지 않는다. 본체의 포인터 드래그는 앱이 직접 처리한다. 대화창은 입력 가능한 일반 창으로 유지한다.
- macOS에만 `type:'panel'`, `acceptFirstMouse`, Mission Control 숨김, `enableLargerThanScreen`을 적용한다. Windows에는 이 옵션을 전달하지 않는다. 전체 Spaces 설정도 Windows에서 호출하지 않는다.
- 드래그의 `workArea` 강제 보정을 제거했다. Dock/작업 표시줄 영역과 화면 밖으로 이동할 수 있고 음수 좌표를 허용한다. 같은 포인터 좌표가 반복되어도 이동량이 누적되지 않는다.
- 캐릭터 앵커를 창 원점과 분리했다. 말풍선은 화면 범위 안에서 창만 배치하고 반환된 내부 좌표로 캐릭터를 원래 위치에 그린다. 확장/축소와 시스템 이동 이후 앵커를 유지·동기화한다.
- 재시작 및 모니터 분리/배치·배율 변경에서 어느 화면에도 캐릭터가 최소 16×16px만큼 보이지 않으면 기본 위치로 복구한다. 보이는 부분 화면 밖 위치는 유지한다. 드래그 중에는 자동 복구하지 않으며 트레이의 **버디 위치 초기화**로 직접 되돌릴 수 있다.
- 저장 위치는 캐릭터 기준의 기본 창 크기로 정규화한다. 이전 버전의 창 크기 값도 기존 앵커 계산으로 복원한다.
- Windows 트레이에는 컬러 아이콘을 사용하고 패키징 아이콘은 OS별 `.icns`/`.ico`/`.png`를 선택한다. Windows `.ico`에는 16/32/48/256px 이미지를 넣었다. Segoe UI·Malgun Gothic을 글꼴 후보에 추가했다.
- 새 외부 라이브러리나 네이티브 브리지를 추가하지 않았다. 단순 좌표 로직은 인라인으로 작성했다.

`movable:false`는 OS 기본 창 드래그를 차단하며 앱의 `setPosition` 이동은 사용한다. macOS에서 실제 포인터 드래그로 확인했다. [Electron 창 옵션](https://www.electronjs.org/docs/latest/api/base-window)

## macOS의 추가 좌표 보정

앱의 좌표 제한을 제거한 뒤에도 Electron의 기본 macOS 창 보정 때문에 완전히 화면 밖으로 이동하지 못했다. 설치 버전의 공식 소스에서 `enableLargerThanScreen`이 테두리 없는 창의 요청 프레임을 그대로 허용하는 경로를 확인했다. 캐릭터 창에만 적용한 후 화면 밖 및 상단 음수 좌표 검증을 수행했다. [Electron 44.5.1 구현](https://github.com/electron/electron/blob/v44.5.1/shell/browser/ui/cocoa/electron_ns_window.mm#L241-L260)

Dock/작업 표시줄 영역으로 이동하는 것과 그보다 위에 표시되는 것은 다르다. 기존 항상 위 옵션을 유지하며 Dock/작업 표시줄보다 높은 특수 레벨로 올리지 않는다. 항상 위 끄기 설정도 명시적으로 적용한다. [Electron 표시 레벨](https://www.electronjs.org/docs/latest/api/base-window#winsetalwaysontopflag-level-relativelevel)

## 수행한 검증

| 검증 | 결과 | 근거 |
|---|---|---|
| JS 구문·기본 팩 | 통과 | `npm run check` |
| 기존 핵심 테스트 | 28개 통과 | `npm test`; 저장/모델/삭제 코드는 이번 변경 대상이 아님 |
| 기존 체험 UI 회귀 | 통과 | `npm run smoke`: 안내 자동 숨김, 대화 열기, 드래그, Markdown, 큐·팩 교체 |
| 창 속성·좌표 이동 | 통과 | `artifacts/floating-ui-smoke.json`; 동일 좌표 반복, 왼쪽/상단 (-60,-60), 아래 경계, 완전히 화면 밖 이동 |
| 말풍선 확장·축소 | 통과 | 같은 앵커 보존, 창 좌표와 내부 캐릭터 좌표 대조 |
| 시스템 이동·초기화 | 통과 | move 이벤트 앵커 동기화, 초기화 후 캐릭터 가시 범위 확인 |
| 부분 화면 밖 재시작 | 통과 | 격리 프로필 재실행, 저장한 캐릭터 앵커 보존 |
| 보이지 않는 저장 위치 복구 | 통과 | 격리 프로필의 먼 좌표 저장 후 재실행 |
| 실제 마우스 가장자리 드래그 | 통과 | `artifacts/native-floating-smoke.json`: 왼쪽 x=-40, 오른쪽 x=1660, 기본 창 120×143 |
| 실제 창 포커스·크기 | 통과 | 위 흐름에서 캐릭터 focus 이벤트 0회, 최대 창 크기 196×195, 대화창 열기 |
| 실제 클릭 통과 | 통과 | `artifacts/pet-native-pointer-smoke.json`: 투명 좌표 (9,53)의 뒤쪽 버튼이 클릭 수신 |
| Windows ICO 구조 | 통과 | 4개 항목의 PNG 치수·바이트 범위 검사; Windows 표시 검증은 미수행 |
| macOS build13 전달 | 통과 | 패키징 앱 실행, 캐릭터 클릭으로 실제 대화창 열기/닫기, 기존 Luna/high/Fast 표시 |
| 실제 사용자 설정·기록 보존 | 통과 | `artifacts/floating-packaged-verification.json`; 실행 전후 모델·추론·속도·시간 측정 옵션·소유 목록/메시지 개수 대조 |

모델 호출 없는 체험·테스트 프로필로 검증했다. 실제 대화나 CLI 세션을 삭제하거나 테스트 데이터로 바꾸지 않았다. 이 표의 macOS 결과는 Windows 네이티브 검증 결과가 아니다.

## 재현 명령

```sh
npm run check
npm test
npm run smoke
npm run smoke:floating
npm run smoke:floating -- --verify-floating-restore
npm run smoke:floating -- --verify-floating-recovery
npm run smoke:floating -- --native-floating-review
npm run smoke:pointer
```

복원 검증 3개는 순서대로 같은 격리 프로필을 사용한다. 첫 실행이 저장한 부분 화면 밖 위치를 두 번째가 확인하고 두 번째가 설정한 보이지 않는 위치를 세 번째가 확인한다. 네이티브 검증은 실제 드래그·클릭이 필요하며 자동 시나리오만으로 통과하지 않는다.

## Windows에서 남은 검증

1. Windows 11의 Snap·Win+방향키·가장자리 미리보기와 캐릭터 창 포커스/크기 정책.
2. 100%/125%/150% 배율, 혼합 배율 모니터, 왼쪽/위쪽 음수 좌표, 모니터 제거·회전.
3. 투명 여백 클릭 통과·마우스 캡처·첫 클릭·채팅 입력·트레이 복구.
4. 작업 표시줄 위치·자동 숨김·전체 화면 앱·가상 데스크톱. 모든 Spaces 노출은 macOS 전용이며 Windows에서 동등 동작은 보장하지 않는다.
5. Windows 호스트의 `npm ci`, 아이콘 생성, 패키징 및 최종 `.exe` 아이콘.
6. Windows Codex 실행 파일 탐색·stdio 연결·취소·저장/재개·삭제. 이번 창 보완으로 CLI의 Windows 호환까지 검증된 것은 아니다.

물리 픽셀과 DIP를 구분하므로 혼합 배율의 실제 포인터 좌표와 창 이동 결과를 대조해야 한다. [Electron 화면 좌표](https://www.electronjs.org/docs/latest/api/screen)

macOS에서도 실제 다중 모니터 분리·배율 전환·전체 화면 Spaces 전환은 아직 검증하지 않았다. 복구 핸들러와 공통 좌표 로직은 구현했으며 현재 확인한 시나리오 범위를 위에 기록했다.
