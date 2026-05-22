---
applyTo: "packages/openapi/test/**"
---
# 패턴별 import 규칙
- `beforeAll`을 사용할 경우, 반드시 `vitest`에서 import해야 합니다.
- `describe`, `it`, `expect`와 함께 `beforeAll`을 import하는 것을 권장합니다.
- import 구문은 파일 상단에 위치시켜야 하며, 누락 시 런타임 에러가 발생합니다.
- 예시: `import { describe, it, expect, beforeAll } from 'vitest';`
- 이 규칙은 해당 경로 내 테스트 파일에만 적용됩니다.


---
applyTo: "packages/openapi/test/**"
---
# 패키지 openapi 테스트 파일에 대한 import 규칙
- `beforeAll`을 사용할 경우, 반드시 `vitest`에서 `describe`, `it`, `expect`와 함께 `import`해야 합니다.
- `beforeAll`을 import하지 않으면 런타임 에러(ReferenceError)가 발생하므로, 누락된 경우 즉시 수정하세요.
- `import { beforeAll } from 'vitest'` 구문을 테스트 파일 상단에 추가하세요.
- 이미 `describe`, `it`, `expect`를 import하는 경우, `beforeAll`도 함께 추가하세요.
- 불필요한 `beforeAll` 사용 시, import 없이 제거하는 것도 고려하세요.
