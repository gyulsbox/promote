---
applyTo: "packages/*/package.json"
---
# Binary Entry Point Validation

- Verify all `bin` entries reference files that exist in the package directory
- Ensure referenced bin scripts are included in the `files` array for npm publishing
- Remove `bin` entries for non-existent scripts (e.g., `./bin/intent.js`) to prevent broken CLI executables
- Confirm bin script files have proper shebang (`#!/usr/bin/env node`) and executable permissions
- Test published package locally with `npm pack` to validate all declared bin entries are accessible
