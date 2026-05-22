---
applyTo: "packages/openapi/test/**"
---
# 패턴별 import 규칙
- `beforeAll`을 사용할 경우, 반드시 `vitest`에서 import해야 하며, `describe`, `expect`, `it`과 함께 import할 것.
- import 구문은 테스트 파일 상단에 위치시킬 것.
- `vitest`에서 제공하는 모든 테스트 관련 유틸리티를 일관되게 import하여 런타임 오류를 방지할 것.
- `beforeAll` 미사용 또는 미 import 시, 관련 테스트가 실패할 수 있음을 유의할 것.
- 규칙 위반 시, 코드 수정 또는 import 추가를 권장함.
