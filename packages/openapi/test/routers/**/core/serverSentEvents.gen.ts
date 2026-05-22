---
applyTo: "packages/openapi/test/routers/**/core/serverSentEvents.gen.ts"
---
# 서버 센트 이벤트 처리 규칙
- 메타데이터 전용 프레임에 대해 `onSseEvent` 호출을 건너뛰도록 합니다.
- `retry:` 전용 청크가 `data: undefined`로 호출되는 것을 방지합니다.
- `StreamEvent.data`가 반드시 정의된 상태로 호출되도록 검증합니다.
- 이 규칙은 서버 센트 이벤트 처리 관련 파일에만 적용됩니다.
- 호출 시점에서 조건에 맞지 않는 이벤트는 무시하거나 건너뛰도록 구현합니다.


---
applyTo: "packages/openapi/test/routers/**/core/serverSentEvents.gen.ts"
---
# 서버 전송 이벤트 재시도 로직 규칙
- 초기 연결 시도 시 재시도 예산을 사용하지 않도록 구현한다.
- `AbortError` 발생 시 재시도를 수행하지 않는다.
- 재시도 시도(`attempt`)는 최초 요청 전에 증가하지 않도록 한다.
- `sseMaxRetryAttempts` 값이 1인 경우, 재시도는 최초 연결 실패에만 적용한다.
- 관련 로직에 주석 또는 문서화하여 유지보수 시 참고할 수 있도록 한다.
