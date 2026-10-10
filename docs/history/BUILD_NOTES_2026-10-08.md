# build26 전달 검증 기록

이 내용은 당시 배포·미검증 범위를 보존한다. 현재 명령/릴리스는 [빌드 가이드](../BUILD_GUIDE.md)를 따른다.

## build26 검증 경계

새 소스는 PNG/WebP/SVG를 sandbox 검증 창에서 실제 decode하고 data-only v2 프레임 팩을 지원한다. `npm run smoke:assets`, `npm run smoke:lifecycle`은 개발용 격리 프로필에서 실행하며 유료 모델을 호출하지 않는다. lifecycle 검사를 새로 시작하려면 해당 테스트 앱을 종료하고 `artifacts/buddy-lifecycle-profile` 테스트 폴더만 제거한다. 사용자의 실제 OnggiBot 데이터 폴더를 지우지 않는다.

이번 패키징 대상은 macOS arm64 staging, build26이다. Windows 빌드/실행, 혼합 DPI·Snap·IME·잠금/절전, 바이러스 검사에 의한 실제 파일 잠금은 아직 실기 검증하지 않았다. Node 단위 테스트에서 EPERM rename 실패와 Windows 프로세스 실행 옵션을 주입한 검증을 실기 성공으로 표현하지 않는다. Mac 잠금 해제 후 build24를 정상 종료하고 build26으로 교체·네이티브 초기 화면을 확인했다. 이전 앱은 `OnggiBot-build24-before26.app`에 보존했다.
