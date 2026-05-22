---
applyTo: "packages/tanstack-react-query/test/**"
---
# React 네임스페이스 임포트 규칙
- 테스트 파일 내에서는 `import * as React from 'react'` 방식으로 React를 네임스페이스 임포트해야 한다.
- 모든 테스트 파일에서 일관된 네임스페이스 임포트 방식을 유지한다.
- 기존의 개별 임포트(`import { useState } from 'react'`) 대신 네임스페이스 임포트를 사용한다.
- 임포트 구문은 파일 전체에서 일관되게 적용하며, 예외 없이 준수한다.
- 관련 규칙 위반 시, 해당 파일의 임포트 방식을 수정하여 규칙에 맞게 조정한다.


---
applyTo: "packages/tanstack-react-query/test/**"
---
# React 네임스페이스 임포트 규칙
- `packages/tanstack-react-query/test/` 내 테스트 파일에서는 React를 네임스페이스 임포트(`import * as React from 'react'`) 방식으로 사용해야 한다.
- 모든 테스트 파일에서 React 관련 임포트는 일관되게 네임스페이스 방식으로 유지한다.
- 기존의 개별 임포트(`import { useState } from 'react'`)는 네임스페이스 임포트로 변경한다.
- 임포트 구문과 사용 예시는 프로젝트 내 테스트 컨벤션에 따라 일관성 있게 작성한다.
- 이 규칙은 해당 경로 내 모든 테스트 파일에 적용하며, 문서화된 규칙이 없으므로 신규 규칙으로 관리한다.
