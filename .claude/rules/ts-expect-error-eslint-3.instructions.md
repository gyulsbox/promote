---
applyTo: "packages/openapi/test/routers/**/client/client.gen.ts"
---
# `@ts-expect-error` 지시자에 대한 ESLint 규칙 적용
- `@ts-expect-error` 주석에는 최소 3자 이상의 설명을 반드시 포함하세요.
- 설명은 해당 오류 또는 경고를 발생시키는 이유를 명확히 기술해야 합니다.
- auto-generated 코드 내에서 반복적으로 사용되므로, 일관된 규칙 준수를 위해 적용하세요.
- ESLint 규칙에 따라 설명이 없거나 짧은 경우 경고가 발생할 수 있음을 유념하세요.
- 설명은 자연스럽고 명확하게 작성하여 코드 유지보수에 도움을 주세요.


---
applyTo: "packages/openapi/test/routers/**/client/client.gen.ts"
---
# @ts-expect-error 지시문에 설명 추가 규칙
- `@ts-expect-error` 지시문에는 최소 3자 이상의 설명을 반드시 포함시킨다.
- ESLint 규칙에 따라, 각 지시문에 대한 이유를 명확히 기재한다.
- 설명은 간결하면서도 해당 오류 무시의 필요성을 설명해야 한다.
- 자동 생성된 클라이언트 코드 내에서 일관된 주석 작성 방식을 유지한다.
- 규칙 위반 시 ESLint 경고가 발생하므로, 정기적으로 검토한다.
