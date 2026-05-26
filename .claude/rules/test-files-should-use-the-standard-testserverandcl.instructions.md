---
applyTo: "**/*.test.ts"
---
# Test Resource Lifecycle Management

- Use `testServerAndClientResource` pattern with `await using` for all server and client setup instead of manual lifecycle management
- Replace `konn()` wrapper patterns and hand-rolled server initialization with the standard `testServerAndClientResource` utility
- Avoid mutating client singletons directly; let the resource pattern handle client instantiation and cleanup
- Apply `await using` syntax to ensure proper async resource disposal in test blocks
- Migrate from `run(...)` initialization patterns to `testServerAndClientResource` for consistency across integration tests
