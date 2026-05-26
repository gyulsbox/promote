---
applyTo: "packages/*/package.json"
---
# Binary Entrypoint Configuration

- Declare `bin` entries only for scripts that exist in the `bin/` directory and verify the file path is correct
- Always include `"bin/"` in the `files` array when declaring `bin` entries to ensure CLI scripts are published
- Use relative paths consistently in `bin` entries (e.g., `"./bin/script-name.js"`) matching the actual file location
- Validate that referenced bin scripts have proper shebang headers (`#!/usr/bin/env node`) and executable permissions
- Test package installation locally with `npm pack` and `npm install <tarball>` to verify bin entrypoints work after publishing
