---
applyTo: ".github/workflows/**/*.yml"
---
# Lerna Publish Permission Requirements

- Grant `permissions.contents: write` if `lerna publish` performs git operations (tagging, pushing), or explicitly use `--no-push` and `--no-git-tag-version` flags
- Verify that `lerna publish` commands do not attempt git writes when `permissions.contents: read` is set
- Use `--no-push` flag to prevent automatic git pushes during publish operations
- Use `--no-git-tag-version` flag to prevent automatic git tag creation during publish operations
- Document which permission level is required for each publish job to prevent silent failures
