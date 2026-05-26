---
applyTo: "www/scripts/check-twoslash.ts"
---
# Directory Read Error Handling

- Only suppress `ENOENT` errors when reading directories; let all other filesystem errors propagate
- Use `error.code === 'ENOENT'` checks instead of catching all errors to avoid masking permission or I/O failures
- Distinguish between "file not found" (acceptable skip) and "permission denied" or "I/O error" (should fail loudly)
- Test error handling paths to ensure real failures are not silently ignored during directory scans
- Document why specific errors are suppressed to prevent future overly-broad error handling
