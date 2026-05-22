---
applyTo: "packages/openapi/test/**"
---
# 패턴별 테스트 임포트 규칙
- `beforeAll`을 사용할 경우, 반드시 `vitest`에서 임포트해야 합니다.
- `describe`, `it`, `expect`와 함께 `beforeAll`을 임포트하는 것을 권장합니다.
- 임포트 누락 시 런타임 에러(ReferenceError)가 발생하므로 주의하세요.
- `vitest`에서 필요한 모든 테스트 훅을 명시적으로 임포트하는 습관을 가지세요.
