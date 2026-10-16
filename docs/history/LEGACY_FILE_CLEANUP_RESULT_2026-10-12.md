# my_budy 파일 정리와 최적화 결과

2026-10-12. [레거시 파일 검토](LEGACY_FILE_REVIEW_2026-10-12.md)에 따라 검사 출력/프로필, 오래된 검사 조건, 완료 문서와 생성 자료를 정리했다. 제품 소스는 **alpha.18**, 최신 macOS 후보는 **build34**로 유지했다. 실행 코드·자산·의존성·저장 포맷을 바꾸지 않았으므로 앱을 다시 패키징하지 않았다. 단순 경로와 조건 처리는 기존 함수 안에 두었으며 새 helper 모듈을 만들지 않았다.

**219개 정리 경로의 2,454개 항목을 복구 보관·검증한 뒤 제거**했다. 과거 앱 2벌, 검사 캐시 201폴더, 일회성 코드 15개와 Finder 메타데이터가 대상이다. 일반 build30·최신 build34·직전 후보 build33, 실사용 데이터와 기존 복구 압축본은 유지한다. 새 복구 압축본은 약 **245.3MiB**이며 이를 포함한 `dist`+`artifacts`의 최종 순감소는 약 **366MiB**다. 정확한 값은 [용량 기록](../../artifacts/legacy-cleanup-2026-10-12/space-final.json)을 따른다. APFS 전체 가용 공간이나 CPU/응답 속도의 개선 수치를 뜻하지 않는다.

## 검사 경로와 조건 수정

| 대상 | 변경 | 실제 확인 |
|---|---|---|
| 기록 비용 검사 | 이전 `followup-alpha18` 폴더 의존 제거. `ONGGI_SMOKE_ROOT` 또는 `artifacts/history-cost`를 만들고 결과 저장. 이름 형식 확인 | `artifacts` 없는 임시 소스 복사본에서 새 중첩 출력 폴더 생성·5,000턴/20표본 성공 |
| decode 검사 | 프로필과 JSON이 같은 실행의 결과 폴더를 사용 | 실제 Electron decode 성공·runner 성공 프로필 제거. 이전 decode 프로필은 검사 중 사용하지 않았음 |
| UI/실제 CLI 개발 검사 | 18개 스크립트의 JSON/PNG·검사 작업 폴더를 명시적 출력 범위로 정돈 | 전체 격리 14종과 기본 체험의 하위 검사. 실제 CLI 질문을 보내는 검사는 구문만 확인했으며 새 모델 호출 없음 |
| 통합 실행기 | 공용 파일의 수정 시각 복사 제거. 사례 폴더의 실제 결과/PNG만 보존하고 성공 프로필 정리. 기본 실행은 새 `run-*`, 명시 경로는 지정 위치 사용 | 기본 두 실행의 폴더 분리·PNG/JSON 복사·실패 프로필 보존은 VM 검사. 실제 assets 사례도 추가 확인 |
| 입력 해시 | `sourceHashes`에 더해 scripts/fixtures 해시 기록 | 최신 결과의 소스 22·스크립트 35·fixture 6개가 현재 파일과 일치 |
| 플로팅 재시작 | 같은 결과 루트 명시, 프로필·첫 검사 성공·복원 순서 검사 | 첫 검사→위치 복원→화면 밖 위치 복구의 3단계 성공, 다른 프로필 자료 거절 |
| 오래된 정렬 검사 | 설정 열 비교를 설정 탭으로 한정하고 빈 선택 집합은 실패 처리 | 새 대화 탭 목적/스킬 select가 숨겨졌는데도 전체 열 비교에 들어가던 실패를 수정. 460×740·390×580 재검증 |

플로팅 검사는 프로그램으로 창 좌표·드래그 IPC·재시작을 확인한 결과다. 물리 드래그/IME·OS 타일링·알림 배너/클릭의 새로운 실기 검증으로 표시하지 않는다. [현재 개발 명령과 결과 경로](../BUILD_GUIDE.md#검사-결과와-복구-자료)를 따른다.

## 문서 정리

완료 기록 7개를 `docs/history`로 옮겼다. 날짜·검사 수·실행 환경과 미검증 조건은 보존했다.

- CLEANUP_PLAN / CLEANUP_RESULT
- CHANGE_REVIEW / CHANGE_REVIEW_ALPHA16 / CHANGE_REMEDIATION_RESULT
- QUALITY_CYCLE_RESULT / BUDDY_EXPANSION_RESULT

위 이름은 모두 기존 날짜가 붙은 `.md`다. [이력 목록](README.md)과 [원래/현재 경로](../../artifacts/legacy-cleanup-2026-10-12/document-moves.json)를 함께 유지한다. 개인 Mac 절대경로와 이동에 따른 파일 링크 **152개**를 상대 경로로 바꿨다. 추가된 복구 링크·코드 보관 안내도 최종 파일/앵커 대조에 포함했다.

기본 캐릭터 수는 현재 4팩으로, 현재 통합 검사 안내는 14종으로 갱신했다. alpha17을 최신으로 안내하던 과거 결과는 현재 `ALPHA_REPORT`를 연결한다. 실행 폴더에서 제거한 build31/build32와 재현 코드 링크는 복구 압축본을 안내한다. Slack/음성/기억 등의 미착수 요구와 v1/v2·구형 CLI 호환·실패 저널 처리는 유지했다.

## 생성 자료의 보관과 제거

| 대상 | 처리 |
|---|---|
| build31 / build32 | 원래 파일/링크·모드·해시를 보관하고 빈 복구 폴더에서 실제 복원. 원본과 복원본의 strict ad-hoc 서명 모두 통과 후 기존 실행 폴더 제거 |
| 캐시 201폴더 | 검사 전용 경로와 링크 여부를 확인. 열린 파일 확인·보관·변경 여부 재대조 후 해당 캐시만 제거 |
| 일회성 코드 15개 | 실행 코드와 원래 경로/해시를 복구본에 보관. 현재 제품/정식 검사에서 가져오지 않는 원래 위치를 정리하고 문서 참조를 갱신 |
| `dist/.DS_Store` | Finder 메타데이터 보관 후 제거 |
| 성공한 새 검사 프로필 | 통합 검사는 결과 보존 후 정리. 기본 체험의 성공 프로필도 JSON/PNG 보존 후 정리 |
| 실패/중간 프로필 | 기존 상태·로그·JSON·원자료 유지. 이번 기본 UI의 첫 실패와 명시적인 다른 프로필 거절도 남김 |
| 기존 큰 복구본 | `cleanup-2026-10-10`의 약 515.7MiB 압축본과 source 전후/diff 유지 |

[복구 압축본](../../artifacts/legacy-cleanup-2026-10-12/cleanup-targets.tar.gz), [대상별 파일/링크/해시 목록](../../artifacts/legacy-cleanup-2026-10-12/removal-manifest.json), [보관 검증과 제거 결과](../../artifacts/legacy-cleanup-2026-10-12/removal-result.json)에 1,291개 일반 파일과 디렉터리/링크를 기록했다. 제거 직전에 열린 파일과 원본 변경 여부를 다시 확인했다. 복구 확인 폴더는 검사 후 정리했으며 원본 실행·사용자 계정으로 구버전 앱을 실행하지 않았다.

압축본을 새 빈 폴더에서 필요한 항목만 복원하고 기록된 해시를 비교한다. 현재 소스나 앱 데이터에 전체를 바로 덮어쓰지 않는다. 바이너리 복원·서명 검사는 사용자 데이터 형식의 역호환을 보장하지 않는다.

## 보존 대조와 검사 한계

제품 소스·자산·캐릭터·스킨·패키지/lock·작업 규칙·라이선스 등 **89개 보호 파일의 해시는 그대로**다. 일반 build30·최신 build34·직전 후보 build33의 Info/ASAR도 보존 대조했다. 209개 공용 결과 파일은 해시가 유지됐고 9개 최상위 일회성 코드는 의도한 보관/제거 목록에 속한다. [최종 보존 기록](../../artifacts/legacy-cleanup-2026-10-12/preservation-final.json).

첫 통합 실행에서 동적으로 조합한 PNG 경로 한 곳을 놓쳐 `buddy-lifecycle-pack-settings.png`, `buddy-lifecycle-persona-settings.png` **합성 검사 화면 2개가 갱신됐다**. 남은 경로를 수정하고 해당 검사/0팩을 다시 통과했다. 원래 해시와 기존 PNG/압축본을 대조했지만 동일한 원본을 찾지 못했다. 새 캡처는 이번 결과에 따로 보관하며 기존 시점의 원본 화면이라고 주장하지 않는다. 실제 사용자 그림·대화·첨부의 변경은 아니다. [확인과 복구 시도 기록](../../artifacts/legacy-cleanup-2026-10-12/shared-picture-recovery.json).

기본 체험의 최초 정렬 실패는 낡은 검사 선택자 때문이었다. 새 목적/스킬 select까지 화면 전체에서 비교하는 조건을 설정 탭으로 한정했다. 이름 입력 상한·잘못된 화면 요청의 예상 오류 로그는 테스트가 의도한 결과이며 숨기지 않았다. 이전 실패 자료를 최종 성공 자료로 덮지 않았다.

## 검증 결과

| 검사 | 결과와 근거 |
|---|---|
| 단위 | 126/126, 실패·skip 0. [로그](../../artifacts/legacy-cleanup-2026-10-12/unit-initial.log) |
| 최종 lint / 문법·4팩 | 통과. [lint](../../artifacts/legacy-cleanup-2026-10-12/lint-final.log), [check](../../artifacts/legacy-cleanup-2026-10-12/check-final.log) |
| 격리 Electron | 14종 전부 exit 0·성공 프로필 정리. [결과](../../artifacts/legacy-cleanup-2026-10-12/integration/integration.json) |
| 동적 경로 수정 후 수명/0팩 | 2종 재검증. [결과](../../artifacts/legacy-cleanup-2026-10-12/lifecycle-repeat/integration.json) |
| 실행기 보강 후 실제 assets | 성공·프로필 제거. [결과](../../artifacts/legacy-cleanup-2026-10-12/runner-assets/integration.json) |
| 기본 체험 UI | 이름/notice/460·390px 정렬·입력 확장·FIFO/교체 성공. [결과](../../artifacts/legacy-cleanup-2026-10-12/alpha-ui-fixed/ui-smoke.json), [로그](../../artifacts/legacy-cleanup-2026-10-12/alpha-ui-fixed.log) |
| 플로팅 3단계와 잘못된 자료 | 같은 프로필의 위치 복원/복구와 다른 프로필 거절. [결과](../../artifacts/legacy-cleanup-2026-10-12/floating-restart-validation.json) |
| 실행기 기본/실패 범위 | 기본 두 실행 분리·결과 복사·실패 프로필 보존. GUI 없는 VM 확인. [결과](../../artifacts/legacy-cleanup-2026-10-12/runner-isolation.json) |
| 새 환경 계측 | 이전 artifacts 폴더 없이 5,000턴/20표본 출력 성공. [결과](../../artifacts/legacy-cleanup-2026-10-12/benchmark-fresh.json) |
| 앱 복원과 실행 입력 | 복원 앱 2개 strict 서명·현재 실행 입력 해시 대조. [복원](../../artifacts/legacy-cleanup-2026-10-12/removal-result.json), [입력](../../artifacts/legacy-cleanup-2026-10-12/input-hashes-final.json) |
| 최종 파일·문서·용량 | [상태 요약](../../artifacts/legacy-cleanup-2026-10-12/final-validation.json) |

실제 모델 질문 **0회**, CLI 로그인/권한·실사용 데이터 변경 **0건**이다. 외부 계정·새 PC·Windows/Intel·배터리·공증/외부 배포의 수용은 기존 후속 범위를 유지한다.
