# Clustering modes

Two paths for grouping repeated comments, with very different output character. Switch at runtime with `--mode quick|broad` on `promote scan`.

## `quick` mode (default — embedding + HAC)

- **How**: comments are embedded (OpenAI / Google), grouped by cosine similarity, borderline pairs LLM-refined
- **What surfaces**: narrow, code-level patterns tied to specific files or identifiers
- **Examples from trpc/trpc (120d, 380 comments)**:
  - non-null assertion `!` in `www/scripts/check-twoslash.ts`
  - `@ts-expect-error` needs ≥3-char description (ESLint rule)
  - `pnpm` version sync between `.tool-versions` and `package.json`
  - `beforeAll` import from `vitest`
  - Specific function bug fixes (`callerCallTypeMap`, `querySerializer`, etc.)
- **Cost / time**: ~$0.07 / ~2 min on 380 comments (OpenAI)
- **Not available on Anthropic** (no embedding API)

## `broad` mode (LLM-direct clustering)

- **How**: every comment goes through an LLM call grouped semantically by intent, not surface text similarity
- **What surfaces**: convention / principle / architectural-decision patterns, repo-wide rules
- **Examples from trpc/trpc (120d, Anthropic Haiku)**:
  - "Test files must import all utilities (assert, beforeAll, …) explicitly"
  - "Avoid destructuring directly in function parameter declarations"
  - "Internal implementation details must not be imported from `src/`; use public unstable API exports"
  - "Cache invalidation must include generator/tsconfig/artifact existence checks"
  - "SSE retry budget must not be consumed on initial connection; exclude AbortError"
- **Cost / time**: ~$0.45 / ~5 min on 380 comments (Anthropic, concurrency=1)
- **Provider recommendation: Anthropic Claude.** OpenAI broad on tier-1 keys hits rate limits on the larger models (gpt-4.1, gpt-4o) and the mini variants don't produce reliable semantic groupings; Anthropic Haiku 4.5 handles both depth and reliability in one tier.

## Picking a mode

| Cadence                  | Recommended                                            | Why                                                                          |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Weekly / biweekly**    | OpenAI `quick` (gpt-4.1-mini + nano + embeddings)      | Cheap, fast, catches narrow code patterns as they emerge                     |
| **Monthly**              | Anthropic `broad` (Claude Haiku)                       | Higher cost but extracts conventions worth memorializing                     |
| **Quarterly / sprint-end** | Anthropic `broad` + optional `--mode quick` follow-up | Combined coverage: principles from broad, missed code-level from quick       |

Switch modes at runtime without touching `.promote.yml`:

```bash
promote scan --repo owner/repo --since 30d --mode quick    # force embedding+HAC
promote scan --repo owner/repo --since 90d --mode broad    # force LLM-direct
```

## Trade-off summary

trpc/trpc, 120d window, 380 actionable AI comments:

| Mode + provider                        | Candidates | $        | Wall time | Output style                                            |
| -------------------------------------- | ---------- | -------- | --------- | ------------------------------------------------------- |
| OpenAI quick (gpt-4.1-mini + nano)     | **24**     | $0.07    | 2m 14s    | Narrow, file-specific                                   |
| OpenAI broad (gpt-4.1-mini cluster)    | 8          | $0.10    | 2m 39s    | Core conventions only — agents-level subset             |
| OpenAI broad (gpt-4.1 full cluster)    | —          | —        | —         | Needs OpenAI tier 2+; tier 1 hits rate limits           |
| **Anthropic broad (Haiku 4.5)**        | **17**     | $0.45    | 4m 55s    | **Convention / principle / ADR mix — recommended depth** |

OpenAI broad is positioned as a "no-Anthropic-key" budget alternative — it reliably catches the 6–8 core repo-wide conventions (non-null assertion bans, function-param destructure rules, test-utility imports, CLI version pinning, etc.) at ~5× lower cost than Anthropic broad. For the same depth of convention / principle / ADR-style candidates, use Anthropic broad.
