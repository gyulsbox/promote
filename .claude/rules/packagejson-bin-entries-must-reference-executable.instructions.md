---
applyTo: "packages/*/package.json"
---
# Bin Entry Validation

- Verify all `bin` field entries reference executable files that exist in the package directory
- Ensure the directory structure matches bin paths (e.g., `./bin/intent.js` requires `packages/[name]/bin/` directory)
- Test package installation locally to confirm executables are created correctly
- Remove or update bin entries if corresponding executable files are not included in the PR
- Check that executable files have proper permissions and shebang headers for CLI functionality
