---
applyTo: "packages/tanstack-react-query/test/**"
---
# React 네임스페이스 임포트 규칙
- `packages/tanstack-react-query/test/` 내 테스트 파일에서는 React를 네임스페이스 방식(`import * as React from 'react'`)으로 임포트해야 한다.
- 모든 테스트 파일에서 React 관련 임포트는 일관되게 네임스페이스 방식으로 유지한다.
- 기존의 개별 임포트(`import { useState } from 'react'`)는 네임스페이스 임포트로 변경한다.
- 임포트 구문과 사용 예시는 공식 문서 또는 기존 규칙에 따라 일관성 있게 작성한다.
- 이 규칙은 해당 경로 내 테스트 파일에 한정하며, 다른 경로나 파일에는 적용하지 않는다.
