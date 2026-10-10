# Alpha 0.1 검증 범위

일반 실행 경로의 macOS arm64 앱은 alpha.14이며 이번 Info.plist 확인값은 CFBundleVersion 30이다. 기존 전달 기록의 build29 표기와 구분한다. 이미지/파일 첨부·불변 사본·일반/미니 FIFO까지 적용돼 있다. 이번 정리 작업은 [실행 결과](CLEANUP_RESULT_2026-10-10.md)에서 소스와 staging의 검증 및 설치 여부를 따로 기록한다.

최신 소스 alpha.16와 별도 staging build32는 [변경 이슈 수정 결과](CHANGE_REMEDIATION_RESULT_2026-10-10.md)를 따른다. 단위 110개·격리 Electron 14종과 현재 소스 해시를 대조했고 편집 reload·스크롤 읽음·검색 순서·도구 거절·알림·종료 예외를 확인했다. 현재 macOS 묶음의 로컬 ad-hoc 서명을 검증했다. 이번 수정은 실제 모델을 추가 호출하지 않았으며 기존 일반 실행 앱은 교체하지 않았다.

alpha.15/build31의 실제 CLI 기능 조회·모델 2회·알림 show 및 당시 검증은 [버디 확장 기록](BUDDY_EXPANSION_RESULT_2026-10-10.md)에 유지한다. OS 배너·클릭과 다른 모델/제공자·플랫폼은 이번 수정의 검증 범위에 포함하지 않는다.

## 기준 릴리스의 확인 결과

2026-10-10 build29은 단위 90개·격리 UI 13종·실제 Luna/high의 이미지 색상/파일 표식 읽기·패키지 소스/worker/아이콘 일치 검증을 수행했다. 사용 프로필/CLI/실제 호출 여부와 제한은 [첨부·대기열 적용 기록](ATTACHMENTS_AND_QUEUE_2026-10-10.md)을 따른다. 현재 정리 작업에서 이를 재실행했다고 표현하지 않는다.

연결 복구·브라우저 URL/시도 ID·이미지 결과 복원은 [alpha.13 적용 기록](CONNECTION_AND_IMAGES_2026-10-08.md), 이전 결함 수정/실제 소유 턴 중단/측정은 [2026-10-08 수정 결과](history/ISSUE_REMEDIATION_RESULT_2026-10-08.md), 더 이전 alpha/build별 숫자와 전달 결과는 [이전 알파 보고서](history/ALPHA_REPORT.md)에 있다.

## 유지하는 제한

- Windows/Intel·혼합 DPI·Snap·IME·실제 파일 잠금/설치와 macOS 물리 다중 모니터/절전/Spaces는 별도 실기 검증이 필요하다.
- 실제 미로그인 계정의 브라우저 인증 콜백은 미검증이다. 모의 로그인 결과를 실제 인증 성공으로 표시하지 않는다.
- 로컬 read-only는 선택 폴더만 읽는다는 보장이 아니다. 범위는 CLI 권한 설정을 따른다. 추가 권한 프로필은 부여하지 않는다.
- 라이브 부분 응답은 비정상 종료로 손실될 수 있다. JSON 저널 복구는 DB 트랜잭션/전원 장애 내구성 보장이 아니다.
- 긴 기록/CLI 전체 기록은 메모리에서 읽고 표시만 분할한다. CPU 표본은 통제된 배터리·전체 시스템 측정이나 성능 향상 보장이 아니다.
- staging은 로컬 ad-hoc 서명을 적용한다. Developer ID/공증·설치 프로그램·자동 업데이트는 제공하지 않는다. Slack·중앙 FIFO·음성/기억은 미착수다.

구현과 남은 범위는 [TASKS](../TASKS.md), 재현 명령/패키징은 [BUILD_GUIDE](BUILD_GUIDE.md)를 따른다.
