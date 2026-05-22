---
applyTo: "packages/openapi/test/routers/**/core/serverSentEvents.gen.ts"
---
# 서버 전송 이벤트 재시도 로직 규칙
- 초기 연결 시도 시 재시도 예산을 사용하지 않도록 구현한다.
- AbortError 발생 시 재시도를 수행하지 않도록 한다.
- 재시도 횟수 계산은 최초 연결 시도를 제외하고 진행한다.
- `attempt` 값이 요청 전 증가하는 점을 고려하여 재시도 제한을 설정한다.
- 관련 유틸리티 또는 패턴을 활용하여 재시도 로직을 명확히 구현한다.
