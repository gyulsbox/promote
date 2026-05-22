---
applyTo: "packages/openapi/test/routers/**"
---
# SSE 타입 안전성 규칙
- `ServerSentEventsOptions` 타입 파라미터를 반드시 명시하여, `ServerSentEventsOptions<PayloadType>` 형태로 사용한다.
- 모든 SSE 관련 함수 호출 시, 적절한 페이로드 타입이 전달되도록 타입 인자를 명확히 지정한다.
- `createSseClient`와 같은 유틸리티 함수는 `ServerSentEventsOptions`의 제네릭 타입을 올바르게 전달받도록 수정한다.
- 타입 미스매치 또는 누락된 제네릭 파라미터가 있는 경우, 타입 assertions 대신 명시적 타입 지정으로 교체한다.
- 코드 전반에 걸쳐 SSE 페이로드 타입 전파를 일관되게 유지하여 타입 안전성을 확보한다.


---
applyTo: "packages/openapi/test/routers/**"
---
# SSE 타입 안전성 규칙
- `ServerSentEventsOptions` 타입 파라미터를 반드시 명시하여, `ServerSentEventsOptions<PayloadType>` 형태로 사용한다.
- 모든 SSE 관련 함수 호출 시, 적절한 페이로드 타입이 전달되도록 타입 검사를 수행한다.
- 타입 누락 또는 부정확한 타입 적용이 발견되면 즉시 수정하며, 타입 assertions(`as`) 사용을 지양한다.
- `createSseClient`와 같은 유틸리티 함수는 `ServerSentEventsOptions<PayloadType>`을 명확히 받도록 타입 선언을 수정한다.
- 코드 리뷰 시, 타입 파라미터 누락 여부와 페이로드 타입 일치 여부를 반드시 확인한다.


---
applyTo: "packages/openapi/test/routers/**"
---
# SSE 타입 안전성 규칙
- `ServerSentEventsOptions` 타입 파라미터를 반드시 명시하여 타입 안전성을 확보할 것.
- `createSseClient` 호출 시 적절한 제네릭 타입을 전달하여 타입 추론이 올바르게 이루어지도록 할 것.
- 타입 단언(`as`) 사용을 지양하고, 타입 미스매치를 컴파일 타임에 잡을 수 있도록 타입 정의를 명확히 할 것.
- 반복적으로 발생하는 타입 누락 문제를 방지하기 위해, 관련 함수와 변수 선언에 타입 명시를 강화할 것.
- 관련 유틸리티 또는 패턴을 활용하여 SSE 페이로드 타입 전파를 일관되게 적용할 것.
