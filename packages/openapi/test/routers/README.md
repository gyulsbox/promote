---
applyTo: "packages/openapi/test/routers/**"
---
# SSE 타입 안전성 규칙
- `ServerSentEventsOptions` 타입 파라미터를 반드시 명시하여 타입 누락 문제를 방지한다.
- `createSseClient` 호출 시 적절한 제네릭 타입을 전달하도록 한다.
- 타입 단언(`as`) 사용을 피하고, 타입 안전성을 유지하는 패턴을 적용한다.
- SSE 페이로드 타입 전파를 명확하게 하여 타입 불일치를 방지한다.
- 관련 유틸리티 또는 패턴을 활용하여 일관된 타입 적용을 유지한다.
