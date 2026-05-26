---
applyTo: "**/*.test.ts"
---
# Test Server and Client Initialization

- Use `await using` pattern with `testServerAndClientResource` directly instead of wrapping with `run(...)`
- Initialize server and client fixtures as: `const { client, server } = await using(new testServerAndClientResource(), ...)`
- Configure client behavior through callback pattern rather than direct property assignment
- Pass client configuration via callback: `testServerAndClientResource((client) => ({ clientLink: 'httpBatchStreamLink' }))`
- Ensure all test fixtures follow the `await using` resource disposal pattern for proper cleanup
