# promote digest — sample (broad mode)

> A snapshot of a real `promote scan` run. Three representative candidates are shown — the full run produced 17.

- **Repo:** [`trpc/trpc`](https://github.com/trpc/trpc)
- **Generated:** 2026-05-22
- **Mode:** `broad` — LLM-direct semantic clustering (no embedding API)
- **Provider:** Anthropic (`claude-haiku-4-5` classify, cluster, draft)
- **Window:** 120 days (overridden via `--since`)
- **Privacy:** `redactSecrets=true`, `sendDiffHunksToLLM=false`

## Summary

- Scanned: **454** review comments across **72** PRs
- AI reviewer comments: **384**
- Clusters: **117** (83 repeated → 17 promotion candidates)
- Cost: **$0.45**
- Wall time: **4m 55s**

## Reproduce

```bash
promote scan --repo trpc/trpc --since 120d --mode broad
```

---

## Candidate 1 — Standardize test setup with `testServerAndClientResource` + `await using`

- **Target:** `path_scoped_rule` → `.claude/rules/test-setup.instructions.md`
- **Confidence:** 0.85
- **Scope:** cross-PR (4 PRs)
- **Occurrences:** 4 comments
- **Path scope:** `**/*.test.ts`
- **Human signal:** 1 reviewer agreed (`@rbxict`)

### Why this was promoted

The same convention shows up across four PRs: tests should call
`testServerAndClientResource` directly (with `await using`) and use the
`client` callback config pattern, rather than wrapping with `run(...)`
or `konn(...)`. A maintainer also followed up agreeing this is the
preferred direction — broad mode picked up on that human signal.

### Evidence

- PR [#7262](https://github.com/trpc/trpc/pull/7262#discussion_r2948708218) — `packages/tests/server/regression/batchStreamErrorCallIndex.test.ts`
- PR [#7207](https://github.com/trpc/trpc/pull/7207#discussion_r2879708223) — `packages/tests/server/httpSubscriptionLink.test.ts`
- PR [#7304](https://github.com/trpc/trpc/pull/7304#discussion_r3012813221) — `packages/tests/server/httpSubscriptionLink.fetch.test.ts`
- PR [#7231](https://github.com/trpc/trpc/pull/7231#discussion_r2902034597) — `packages/openapi/test/generate.test.ts`

### Suggested rule

```md
---
applyTo: "**/*.test.ts"
---
# Test setup

- Call `testServerAndClientResource` directly with `await using` — both
  server and client lifecycles are managed in one place.
- Use the `client` callback config pattern instead of passing `clientLink`
  directly. Keeps setup consistent across the suite.
- Do not wrap the helper in `run(...)` or `konn(...)`.
- `await using` ensures resources are released on test exit even on throw.
```

---

## Candidate 2 — `bin.intent` points to a non-existent directory across packages

- **Target:** `path_scoped_rule` → `.claude/rules/package-bin.instructions.md`
- **Confidence:** 0.90
- **Scope:** cross-PR (3 PRs)
- **Occurrences:** 6 comments
- **Path scope:** `packages/**/package.json`
- **Human signal:** 3 reviewers agreed (`@orbisai0security`)

### Why this was promoted

Several `@trpc/*` packages declare `bin.intent`, but the referenced files
either don't exist or were never added to `files`. Installations create
broken executables. The cluster crosses three PRs (#7252, #7371, …) and
has explicit reviewer agreement.

### Evidence (selected)

- PR [#7371](https://github.com/trpc/trpc/pull/7371#discussion_r3195158582) — `packages/tests/package.json`
- PR [#7252](https://github.com/trpc/trpc/pull/7252#discussion_r2937362632) — `packages/openapi/package.json`
- PR [#7252](https://github.com/trpc/trpc/pull/7252#discussion_r2937362635) — `packages/tanstack-react-query/package.json`
- PR [#7252](https://github.com/trpc/trpc/pull/7252#discussion_r2937362630) — `packages/next/package.json`
- (2 more occurrences across the same set of PRs)

### Suggested rule

```md
---
applyTo: "packages/**/package.json"
---
# `bin` entry hygiene

- Every `bin` entry must point to a file that actually ships in the
  published tarball — verify with `npm pack` locally.
- Include the `bin/` directory in `files` whenever you add a `bin` entry.
- When multiple `@trpc/*` packages share the same binary name, scope it
  (e.g. `@trpc-intent`) to avoid `node_modules/.bin` collisions.
- If a binary depends on an external package, declare it in `dependencies`
  or `peerDependencies` rather than relying on transitive resolution.
```

---

## Candidate 3 — Import from public entrypoints, not `src/internals/`

- **Target:** `path_scoped_rule` → `.claude/rules/internal-api-boundaries.instructions.md`
- **Confidence:** 0.85
- **Scope:** cross-PR (2 PRs)
- **Occurrences:** 2 comments
- **Path scope:** `packages/*/src/**`
- **Human signal:** 1 reviewer agreed (`@rbxict`)

### Why this was promoted

Two PRs across different packages reached for internal implementation
paths (`src/internals/…`) instead of the published `unstable-*` or `public`
entrypoints. The pattern is repo-wide architectural intent and a
maintainer agreed in the follow-up review.

### Evidence

- PR [#7304](https://github.com/trpc/trpc/pull/7304#discussion_r3006306706) — `packages/tests/server/httpSubscriptionLink.fetch.test.ts`
- PR [#7228](https://github.com/trpc/trpc/pull/7228#discussion_r2901567590) — `packages/tanstack-react-query/src/createOptionsProxy.ts`

### Suggested rule

```md
---
applyTo: "packages/*/src/**"
---
# Internal API boundaries

- Do not import from `src/internals/**` directly.
- Use the public entrypoints (`unstable-internals`, `public`, or
  `src/index.ts`) so the surface stays controlled.
- For cross-package imports, route through each package's public exports
  rather than relative paths into another package's internals.
- New internal capability needed externally? Expose it through a public
  entrypoint first.
```

---

## Filtered out (excerpt)

The classifier dropped 19 clusters with explicit reasons. Examples:

- *"Address minor typo in JSDoc"* — dropped (`not_promotable`): one-off, no policy implication.
- *"Consider TanStack Query v5 migration"* — dropped (`already_handled`): tracked in a separate roadmap issue.

The full digest carries the complete `Filtered out` appendix.
