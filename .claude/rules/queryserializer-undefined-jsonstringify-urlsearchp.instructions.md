---
applyTo: "packages/openapi/src/heyapi/**"
---
# querySerializer 및 responseTransformer 관련 규칙
- `querySerializer`에서 `JSON.stringify`를 호출하기 전에 `value`가 `undefined`인지 확인하여, `undefined`인 경우 빈 문자열 또는 적절한 기본값으로 처리할 것
- `URLSearchParams.append()`에 전달하기 전에 `value`가 `undefined` 또는 `null`인지 체크하는 유틸리티 함수를 활용할 것 (예: `isNil(value)`)
- `responseTransformer`에서 특정 필드 검사 시, 필드 존재 여부와 타입을 명확히 검증하는 유틸리티 패턴 (예: `hasOwnProperty`, `typeof`)를 사용할 것
- `packages/openapi/src/heyapi/index.ts` 내에서만 적용되도록 경로별 ESLint 또는 커스텀 룰을 설정할 것
- 직렬화 및 응답 변환 로직에 대한 유닛 테스트를 추가하여, `undefined` 또는 예상치 못한 값이 쿼리 파라미터에 포함되지 않도록 검증할 것


---
applyTo: "packages/openapi/src/heyapi/**"
---
# 패키지 내 쿼리 직렬화 및 응답 변환 규칙
- `querySerializer`에서 `JSON.stringify` 호출 시 `undefined` 값이 문자열 `"undefined"`로 변환되지 않도록 처리한다.
- `URLSearchParams.append()` 호출 전에 `value`가 `undefined` 또는 `null`인 경우 빈 문자열 또는 생략하는 로직을 추가한다.
- `responseTransformer`에서 특정 필드 검사 시 `null` 또는 `undefined`를 명확히 구분하여 처리한다.
- 직렬화 및 응답 변환 로직에 대한 유닛 테스트를 작성하여 위 규칙이 적용되는지 검증한다.
- 관련 유틸리티 또는 패턴을 활용하여 일관된 직렬화 및 변환 방식을 유지한다.


---
applyTo: "packages/openapi/src/heyapi/**"
---
# 패턴별 규칙: querySerializer 및 responseTransformer 문제 해결
- `querySerializer`가 `undefined` 값을 `JSON.stringify`로 직렬화할 때, 반환값이 `undefined`인 경우를 처리하여 `URLSearchParams.append()`가 "undefined" 문자열로 변환하는 문제를 방지한다.
- `querySerializer`에서 `JSON.stringify` 호출 전에 값이 `undefined`인지 체크하고, 필요시 빈 문자열 또는 적절한 기본값으로 대체한다.
- `responseTransformer`에서 특정 필드가 존재하는지 여부를 검사할 때, `null`과 `undefined`를 명확히 구분하여 조건문을 작성한다.
- 해당 규칙은 `packages/openapi/src/heyapi/index.ts` 파일 내에서만 적용하며, 다른 경로에는 영향을 미치지 않는다.
- 변경 사항을 적용한 후, 관련 테스트 케이스를 실행하여 문제 해결 여부를 검증한다.
