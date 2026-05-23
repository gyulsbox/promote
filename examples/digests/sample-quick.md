# promote digest — sample (quick mode)

> A snapshot of a real `promote scan` run. Three representative candidates are shown — the full run produced 24.

- **Repo:** [`trpc/trpc`](https://github.com/trpc/trpc)
- **Generated:** 2026-05-22
- **Mode:** `quick` — embedding + HAC + `llmRefine`
- **Provider:** OpenAI (`gpt-4.1-mini` classify, `gpt-4.1-nano` draft, `text-embedding-3-small` embed)
- **Window:** 120 days (overridden via `--since`)
- **Privacy:** `redactSecrets=true`, `sendDiffHunksToLLM=false`

## Summary

- Scanned: **454** review comments across **72** PRs
- AI reviewer comments: **384**
- Clusters: **295** (47 repeated → 24 promotion candidates)
- Cost: **$0.07**
- Wall time: **2m 14s**

## Reproduce

```bash
promote scan --repo trpc/trpc --since 120d --mode quick
```

---

## Candidate 1 — Standardize integration test setup on `testServerAndClientResource`

- **Target:** `agents` → `AGENTS.md`
- **Confidence:** 0.90
- **Scope:** cross-PR (3 PRs)
- **Occurrences:** 3 comments

### Why this was promoted

Three independent PRs flagged the same pattern: integration tests should
use the `testServerAndClientResource` helper with `await using` rather
than bespoke wrappers (`run(...)`, `konn(...)`). This is a repeated
repo-wide test convention, not a single-PR cleanup.

### Evidence

- PR [#7231](https://github.com/trpc/trpc/pull/7231#discussion_r2902034597) — `packages/openapi/test/generate.test.ts`
- PR [#7207](https://github.com/trpc/trpc/pull/7207#discussion_r2879708223) — `packages/tests/server/httpSubscriptionLink.test.ts`
- PR [#7304](https://github.com/trpc/trpc/pull/7304#discussion_r3012813221) — `packages/tests/server/httpSubscriptionLink.fetch.test.ts`

### Suggested instruction

```md
## Integration test setup

- Use the `testServerAndClientResource` helper with `await using` for any
  test that needs both a server and a client.
- Do not wrap the server lifecycle in `run(...)` or `konn(...)` — call
  the standard helper directly.
- `await using` guarantees the resource is released even if the test throws.
```

---

## Candidate 2 — Include `bin/` in `package.json#files` for binary entries

- **Target:** `agents` → `AGENTS.md`
- **Confidence:** 0.95
- **Scope:** within-PR (1 PR, multi-package)
- **Occurrences:** 10 comments across 5 packages

### Why this was promoted

A single PR (#7252) added a `bin.intent` entry across multiple packages,
but the `files` allowlist in each `package.json` was not updated — the
binary would be missing from the published tarball. The same comment
fired in every affected package, indicating a recurring oversight worth
codifying.

### Evidence (selected)

- PR [#7252](https://github.com/trpc/trpc/pull/7252#discussion_r2968125965) — `packages/server/package.json`
- PR [#7252](https://github.com/trpc/trpc/pull/7252#discussion_r2968125922) — `packages/tanstack-react-query/package.json`
- PR [#7252](https://github.com/trpc/trpc/pull/7252#discussion_r2968125972) — `packages/client/package.json`
- (7 more occurrences in the same PR)

### Suggested instruction

```md
## Publishing binaries

- When adding a `bin` entry to `package.json`, also add the `bin/`
  directory to the `files` allowlist — otherwise the binary is omitted
  from the published tarball.
- Verify locally with `npm pack` before publishing.
```

---

## Candidate 3 — Remove non-null assertions in `www/scripts/check-twoslash.ts`

- **Target:** `path_scoped_rule` → `.claude/rules/check-twoslash.instructions.md`
- **Confidence:** 0.95
- **Scope:** cross-PR (3 PRs)
- **Occurrences:** 3 comments
- **Path scope:** `www/scripts/**`

### Why this was promoted

Three separate PRs flagged non-null assertion (`!`) usage on indexed and
RegExp capture access within the same file. The matches are not
statically known to be non-null at runtime. This is a path-scoped style
issue, not a repo-wide policy.

### Evidence

- PR [#7196](https://github.com/trpc/trpc/pull/7196#discussion_r2869759038)
- PR [#7176](https://github.com/trpc/trpc/pull/7176#discussion_r2876202469)
- PR [#7195](https://github.com/trpc/trpc/pull/7195#discussion_r2869717508)

### Suggested rule

```md
---
applyTo: "www/scripts/**"
---
# www/scripts/check-twoslash.ts

- Replace non-null assertions (`!`) on indexed or RegExp-capture access
  with explicit null checks or optional chaining.
- Match results are not statically guaranteed to be present at runtime.
```

---

## Filtered out (excerpt)

The classifier also dropped 12 clusters from the candidate set with explicit reasons. Examples:

- *"Add tests for edge cases in error handling"* — dropped (`not_promotable`): too generic, no specific invariant to enforce.
- *"Consider extracting this into a helper"* — dropped (`low_confidence`): single occurrence, refactor suggestion rather than policy.

The full digest carries the complete `Filtered out` appendix and a `Skipped during review` section for anything deferred in interactive mode.
