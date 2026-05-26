---
applyTo: "packages/*/package.json"
---
# Binary Entry Points Validation

- Remove or correct all `bin` field entries that reference non-existent files; verify each referenced script exists at the exact path before committing
- Do not add `bin.intent` entries unless `./bin/intent.js` is present in the package directory and properly implements the intended CLI functionality
- Run `npm pack` locally to simulate installation and verify all bin shims are created correctly without errors
- Document any legitimate bin entry points in the package's README with usage examples and ensure they are tested in CI
- Use `npm ls` and `npm exec` to validate bin references work as expected before opening a pull request
