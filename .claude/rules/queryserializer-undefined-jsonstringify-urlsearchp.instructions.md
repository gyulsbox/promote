---
applyTo: "packages/openapi/src/heyapi/**"
---
# 패키지 내 쿼리 직렬화 및 응답 변환 규칙
- `querySerializer`에서 `JSON.stringify` 호출 시 `undefined` 값이 전달될 경우, 문자열 `"undefined"`가 쿼리 파라미터에 포함되지 않도록 조건문을 추가하세요.
- `URLSearchParams.append()` 호출 전에 값이 `undefined` 또는 `null`인지 체크하여, 해당 경우에는 파라미터에 추가하지 않도록 하세요.
- `querySerializer`에서 직렬화하는 값이 `undefined`인 경우 빈 문자열 또는 생략하는 방식을 명확히 하여, 의도치 않은 `"undefined"` 문자열이 쿼리 파라미터에 포함되지 않도록 하세요.
- `responseTransformer`에서 특정 필드 검사 시, `typeof` 또는 `null` 체크를 통해 안전하게 검증하며, `undefined` 또는 `null`인 경우 별도 처리 또는 무시하도록 수정하세요.
- 관련 유틸리티 또는 패턴을 활용하여, 직렬화 및 응답 변환 로직의 일관성과 안정성을 확보하세요.
