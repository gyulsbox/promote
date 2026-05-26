---
applyTo: "packages/*/package.json"
---
# Binary Entry Point Naming and Implementation

- Use namespaced binary names in the `bin` field to avoid collisions (e.g., `@trpc/server:intent` or `trpc-server-intent` instead of generic `intent`)
- Ensure all referenced bin files exist in the package before publishing; verify `bin/*.js` files are present in the PR
- Do not expose generic binary names that could shadow other packages' CLIs or cause `node_modules/.bin` collisions across multiple `@trpc/*` installations
- If a bin entry is added, include the actual executable file in the same PR; broken bin references will cause installation failures
- Reference the actual file path correctly in `bin` field and confirm the file exists in the package directory structure
