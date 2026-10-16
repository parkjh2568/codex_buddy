# Alpha 0.1 검증 범위

최신 개발 소스와 staging 후보는 alpha22/build38이다. [Mac 후속 결과](MAC_FOLLOWUP_RESULT_2026-10-15.md)에 수정 내용·전후 원자료·환경·실패/미검증을 기록한다. 다음 수치는 해당 구현 검증의 결과이며 문서 정리에서 다시 실행한 검사 수가 아니다.

| 범위 | 확인한 결과 |
|---|---|
| 소스 검사 | 단위 190개·lint/check·격리 Electron 15종 |
| 패키지 | 85개 파일·strict ad-hoc 서명·패키지 자체 격리 실행 |
| 저장·요청 | state/복구 저널 제한 읽기·첨부 비동기 수명·원격 최신 25턴부터 명시적 단계 조회 |
| UI | 말투 옆 `+`·답변 중심 심플·보호 해제 후 30초 전체 숨김·네 모서리 조절·3크기×3스킨 정렬 |
| macOS 자동 조작 | 실제 파일 선택기 다중 첨부/취소·네 모서리 조절·승인된 OS 클립보드 API/픽셀 일치/원본 write 복원 |
| 자원 | 전후 CPU/I/O·대용량 저장·이미지 비용 및 ASAR 5상태×60초 관찰. 측정 한계와 원자료는 결과 문서 |

실제 모델 질문은 해당 후속 작업에서 추가하지 않았다. 실제 응답과 체험 응답, fixture와 OS 실기는 구분한다. 현재 기능의 사용법은 [README](../README.md), 설계 계약은 [ARCHITECTURE](ARCHITECTURE.md)를 따른다.

## 전달 후보와 복구

검증 후보는 `dist/staging/OnggiBot-darwin-arm64/OnggiBot.app`이다. 일반 실행 경로의 alpha14/build30은 교체하지 않았다. 직전 alpha21/build37 전체 앱은 `artifacts/mac-followup-2026-10-15/baseline-app37.app`, alpha17/build33은 `dist/rollback-alpha17-build33/`에 유지한다. 더 이전 후보·원자료·복구 사본의 위치는 [검토 이력](history/README.md)과 각 결과 문서에 보존한다. 같은 staging 경로를 재사용하므로 검증 시각·source hash·ASAR를 함께 확인한다.

## 유지하는 제한

- Windows/Intel·혼합 DPI·Snap·IME·실제 파일 잠금/설치와 macOS 물리 다중 모니터/절전/Spaces는 별도 실기 검증이 필요하다.
- 실제 미로그인 브라우저 인증 콜백·다른 제공자 실행·다른 앱과 클립보드 왕복·OS 배너 클릭/소리는 미검증이다. API 성공이나 fixture 결과로 대체하지 않는다.
- 클립보드 복원 확인은 OS write 완료이며 원본 payload 재읽기 대조는 포함하지 않는다.
- 로컬 read-only는 선택 폴더만 읽는다는 보장이 아니다. 범위는 CLI 권한 설정을 따른다. 추가 권한 프로필은 부여하지 않는다.
- 라이브 부분 응답은 비정상 종료로 손실될 수 있다. JSON 저널 복구는 DB 트랜잭션/전원 장애 내구성 보장이 아니다.
- 전체 JSON 읽기/parse·복사·저장·검색과 이미지 중복 검증·첨부 전체 캐시 조사 비용이 남는다. 원격 기록의 전체 확장 시 페이지별 전체 저장으로 누적 I/O가 증가한다.
- CPU 표본은 통제된 배터리·전체 시스템 측정이나 성능 향상 보장이 아니다.
- 로컬 ad-hoc 서명은 Developer ID/공증·설치 프로그램·자동 업데이트를 대신하지 않는다. Slack·중앙 FIFO·음성/기억은 미착수다.

실행할 후속 작업과 완료 조건은 [TASKS](../TASKS.md), 재현 명령과 패키징은 [BUILD_GUIDE](BUILD_GUIDE.md)를 따른다. 과거 버전별 검사 수·전달·실패 근거는 [정리 전 검증 보고서](history/ALPHA_REPORT_BEFORE_CLEANUP_2026-10-16.md)와 [검토 이력](history/README.md)에 보존한다.
