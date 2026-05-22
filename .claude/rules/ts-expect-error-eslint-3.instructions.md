---
applyTo: "packages/openapi/test/routers/**/client/client.gen.ts"
---
# `@ts-expect-error` 지시자 설명 규칙
- `@ts-expect-error` 주석에는 최소 3자 이상의 설명을 포함시켜야 합니다.
- ESLint 규칙에 따라, 자동 생성된 클라이언트 코드 내에서 이 규칙이 일관되게 적용되도록 합니다.
- 설명은 해당 오류 또는 경고가 발생하는 이유를 명확히 기술해야 합니다.
- `eslint-disable-next-line` 또는 유사한 패턴과 함께 사용하여 가독성을 유지합니다.
- 코드 생성기 또는 자동화 도구에 이 규칙이 반영되도록 설정을 검토합니다.
