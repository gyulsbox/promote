---
applyTo: "**/*.test.ts"
---
# Test Server and Client Setup

- Use the standard `testServerAndClientResource` pattern instead of manually managing server lifecycle
- Wrap the helper result in `konn()` to ensure proper resource cleanup and isolation between tests
- Avoid hand-rolling server startup/shutdown logic; delegate to the standardized pattern
- Do not mutate the generated client singleton directly; use the pattern's provided client instance
- Apply this pattern to all integration tests that require both server and client setup
