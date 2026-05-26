---
applyTo: "packages/*/package.json"
---
# CLI Entrypoint Publishing

- If `bin` field is declared, ensure `bin/` or `bin` is included in the `files` allowlist to prevent broken binaries on npm publish
- Verify `files` array explicitly lists `bin` directory when package exports CLI commands
- Test published tarball locally with `npm pack` to confirm binary files are included before merging
- Add both `bin` entry and corresponding `files` allowlist in the same commit to prevent drift
- Review all packages with `"bin"` keys to audit existing `files` configurations for this pattern
