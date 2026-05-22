---
applyTo: "packages/openapi/src/heyapi/**"
---
# 패키지 내 특정 경로에 대한 규칙
- `querySerializer`에서는 `JSON.stringify`를 호출하기 전에 `value`가 `undefined`인지 확인하여 처리한다.
- `querySerializer`에서 `undefined` 값은 빈 문자열 또는 특정 값으로 대체하도록 수정한다.
- `responseTransformer`는 특정 키 검사 시, 키 존재 여부를 먼저 확인하는 조건문을 추가한다.
- `URLSearchParams.append()` 호출 전에 값이 `undefined`인 경우 문자열 "undefined"로 강제 변환하지 않도록 한다.
- 이 규칙은 `packages/openapi/src/heyapi/index.ts` 파일 내에서만 적용하며, 관련 유틸리티 함수에 대한 테스트를 수행한다.
