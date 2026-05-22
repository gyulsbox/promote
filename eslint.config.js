---
applyTo: "packages/openapi/test/routers/**/client/client.gen.ts"
---
# `@ts-expect-error` 지시자에 설명 추가 규칙
- `@ts-expect-error` 주석에는 최소 3자 이상의 설명을 반드시 포함해야 합니다.
- ESLint 규칙에 따라, 왜 타입 오류 무시가 필요한지 명확히 기술하세요.
- 반복되는 자동 생성 파일 내에서도 일관되게 적용하세요.
- 설명이 없는 경우 ESLint 경고 또는 오류가 발생할 수 있음을 유의하세요.
- 설명은 간결하면서도 무시 사유를 명확히 전달하는 내용을 포함해야 합니다.
