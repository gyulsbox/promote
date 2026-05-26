---
applyTo: "packages/**/package.json"
---
# ESLint to Oxlint Migration

- Migrate all active ESLint rules from `eslintConfig` to `.oxlintrc.json` before enabling Oxlint in lint scripts
- Replace `eslint-disable-next-line` and `eslint-disable` comments with Oxlint equivalents (`// oxlint-disable-next-line`) to prevent stale suppressions
- Verify rule parity between ESLint and Oxlint configurations; document any intentional differences in migration notes
- Remove `eslintConfig` from `package.json` only after confirming all rules are active in Oxlint and tests pass
- Use `.oxlintrc.json` as the single source of truth for linting rules once migration is complete
