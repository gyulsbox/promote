---
applyTo: "**/package.json"
---
# @types/node Version Alignment

- Ensure `@types/node` major version matches the Node.js major version specified in `engines.node`
- If `engines.node` is `^24.0.0`, use `@types/node: ^24.x.x`
- If `engines.node` is `^25.0.0`, use `@types/node: ^25.x.x`
- Update both fields together when changing Node.js runtime requirements
- Verify alignment across all package.json files in the monorepo to maintain consistency
