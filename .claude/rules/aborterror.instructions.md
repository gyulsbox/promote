---
applyTo: "packages/openapi/test/routers/**/core/serverSentEvents.gen.ts"
---
# 서버 전송 이벤트 재시도 로직 규칙
- 초기 연결 시도 시 재시도 예산을 소모하지 않도록 구현한다.
- `AbortError` 발생 시 재시도를 수행하지 않도록 한다.
- 재시도 횟수(`sseMaxRetryAttempts`)는 최초 연결 시도 전에 고려한다.
- `attempt` 값이 증가하기 전에 재시도 조건을 체크한다.
- 관련 유틸리티 또는 패턴을 활용하여 재시도 로직을 명확히 구현한다.


---
applyTo: "packages/openapi/test/routers/**/core/serverSentEvents.gen.ts"
---
# 서버 전송 이벤트 재시도 로직 규칙
- 초기 연결 시도 시 재시도 예산을 소모하지 않도록 처리한다.
- AbortError 발생 시 재시도를 수행하지 않도록 한다.
- 재시도 시도 횟수(`attempt`)는 최초 요청 전에 증가하지 않도록 검증한다.
- `sseMaxRetryAttempts` 값이 1인 경우, 재시도 조건을 적절히 제한한다.
- 해당 규칙은 특정 경로 내에서만 적용하며, 전체 에이전트 지침에는 포함하지 않는다.


---
applyTo: "packages/openapi/test/routers/**/core/serverSentEvents.gen.ts"
---
# 서버 전송 이벤트 재시도 로직 규칙
- 초기 연결 시도 시 재시도 예산을 사용하지 않도록 구현한다.
- AbortError 발생 시 재시도를 수행하지 않도록 한다.
- 재시도 횟수(`sseMaxRetryAttempts`)는 최초 연결 시도 후에만 적용한다.
- `attempt` 값이 최초 요청 전에 증가하는 점을 고려하여 재시도 조건을 설정한다.
- 관련 유틸리티 또는 패턴을 활용하여 일관된 재시도 로직을 유지한다.
