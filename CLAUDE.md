# CLAUDE

## Knowledge structure

This repository organizes knowledge in multiple locations. When working on this codebase, check the relevant sources before making changes.

### Repo-wide rules

General conventions and coding standards are documented in this file.

### Path-scoped rules (`.claude/rules/`)

Domain-specific rules that apply only to certain directories. Before working in a specific area, check if a scoped rule file exists:

```
.claude/rules/*.instructions.md
```

Each file has a `applyTo` frontmatter field specifying which paths it covers.

### Architecture Decision Records (`docs/adr/`)

Decisions about architecture, trade-offs, and design rationale are recorded as ADRs. Before making architectural changes, check existing ADRs:

```
docs/adr/*.md
```

If you are about to make a decision that changes architecture or has trade-offs, propose a new ADR.

### Test invariants

Some rules are enforced as tests rather than instructions. If a behavior is critical enough that it must not break, look for existing tests before modifying that behavior.

---

<!-- Rules below this line are managed by promote (https://github.com/gyulsbox/promote) -->
