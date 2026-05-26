---
applyTo: "packages/**"
---
# Logging and Console Usage

- Do not use `eslint-disable` comments to suppress `no-console` rule; this rule is enforced across all package modules
- Replace any `console.*` calls with an explicit logging utility (e.g., `logger.log()`, `debug()`) or remove them entirely
- Avoid creating aliases like `const log = console.log` to circumvent the no-console rule
- If logging is necessary for debugging, use a dedicated logging library configured for the package (e.g., `debug` module)
- For line-specific suppressions that cannot be avoided, use `// eslint-disable-next-line no-console` on the exact line rather than file-level disables
