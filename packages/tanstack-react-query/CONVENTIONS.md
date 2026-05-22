---
applyTo: "packages/tanstack-react-query/test/**/*.tsx"
---
# React 네임스페이스 임포트 규칙
- 모든 테스트 파일에서 React를 네임스페이스 방식(`import * as React from 'react'`)으로 임포트해야 합니다.
- `import React from 'react'` 또는 개별 훅 임포트 방식을 사용하지 않도록 합니다.
- 기존 임포트 구문이 있다면, 규칙에 맞게 수정하세요.
- React 관련 사용 시 항상 `React` 네임스페이스를 통해 접근하도록 일관성을 유지하세요.
- 이 규칙은 향후 테스트 파일 작성 시 일관성을 확보하기 위해서만 적용됩니다.
