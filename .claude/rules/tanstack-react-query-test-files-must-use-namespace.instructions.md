---
applyTo: "packages/tanstack-react-query/**/*.test.tsx"
---
# React Import Convention

- Use namespace imports for React: `import * as React` instead of named imports
- Do not use destructured imports like `import { useState }` directly from React
- Reference React hooks as `React.useState`, `React.useEffect`, etc.
- This convention applies consistently across all test files in this package
- Update existing named imports to namespace imports when modifying test files
