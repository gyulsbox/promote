<div align="center">

<h1>promote</h1>

<p><strong>Pick up lost decisions from AI review comments.</strong></p>

<p>
  <a href="#why">Why</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#usage-flows">Usage Flows</a> ·
  <a href="#supported-tools">Supported Tools</a> ·
  <a href="#cli-reference">CLI Reference</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

<p>
  <a href="https://www.npmjs.com/package/promote-cli"><img src="https://img.shields.io/npm/v/promote-cli?style=flat&colorA=18181b&colorB=06b6d4" alt="npm version"></a>
  <a href="https://github.com/gyulsbox/promote/stargazers"><img src="https://img.shields.io/github/stars/gyulsbox/promote?style=flat&colorA=18181b&colorB=06b6d4" alt="GitHub stars"></a>
  <a href="https://github.com/gyulsbox/promote/blob/main/LICENSE"><img src="https://img.shields.io/github/license/gyulsbox/promote?style=flat&colorA=18181b&colorB=06b6d4" alt="License"></a>
</p>

</div>

<br />

## Why

AI review tools leave comments on PRs. Developers resolve them and move on. The decision disappears into a closed PR thread.

But some of those comments aren't just about the current diff — they reveal **implicit knowledge** that the repository doesn't have written down. A convention no one documented. An architectural decision no one recorded. An invariant no one tested.

If the same comment appears next week, the team pays the same review cost again.

**promote** picks up these lost decisions, classifies where they should live, and helps you turn them into durable repository memory — so the next human or AI agent doesn't make the same mistake.

> *"The human reviewer's role is no longer to trace code details,
> but to measure the distance between decisions and implementation."*

<br />

## Demo

### Init

<div align="center">

![promote init](demo/init.gif)

</div>

### Scan

<div align="center">

![promote scan](demo/scan.gif)

</div>

<br />

## How It Works

```
AI review comments across PRs
  → detect repeated patterns
  → aggregate human reactions (replies + 👍/👎)
  → classify: AGENTS.md? ADR? test? path-scoped rule?
  → draft a small memory patch
  → human reviews and decides
  → future AI agents read the promoted rule
```

promote does not generate more review comments. It **reduces** repeated ones over time.

**Human signal aggregation** — before classification, promote checks whether human reviewers replied to or reacted on each bot comment. Replies like "good catch" or "LGTM" boost confidence; replies like "this is intentional" or "by design" flag the candidate for human review (`needsHumanDecision`). Reaction counts (👍/👎) are included automatically — no extra API calls since they are in the existing review comment payload. The signal is shown in the review UI and passed to the classification LLM for context.

<br />

## Quick Start

### 1. Initialize

```bash
npx promote-cli init
```

Interactive setup walks you through LLM provider, AI tool, output language, and memory file locations.

### 2. Scan

```bash
# Scan current repo (auto-detects from git remote)
npx promote-cli scan

# Or specify a repo
npx promote-cli scan --repo trpc/trpc --since 90d
```

### 3. Review & Promote

After scanning, review candidates one by one in the CLI:

```
  ─── Candidate 1/7 ───

  React hooks should use named imports instead of default imports

  Target      path_scoped_rule → .claude/rules/react-imports.instructions.md
  Confidence  0.85
  Occurrences 3

  Patch:
    ---
    applyTo: "packages/react-query/test/**"
    ---
    # React Hooks Import Convention
    - Use named imports: import { useState } from 'react'

  > Promote → path_scoped_rule
  > Promote (different target)
  > Show full patch
  > Skip
```

<br />

## Usage Flows

### Flow A — Personal CLI (current)

`scan` handles the full loop in one command: fetch → cluster → classify → interactive review. Each approval writes to the local file immediately, then moves to the next candidate.

```bash
# Run once. Approve or skip each candidate as you go.
npx promote-cli scan --repo owner/repo --since 60d

# Then commit and open a PR as usual
git add CLAUDE.md
git commit -m "promote: require shared API client for feature code"
gh pr create
```

If you chose "review later" during scan, pending candidates are saved. Come back any time:

```bash
promote review                          # re-review all pending candidates
promote candidate_003                   # apply one specific candidate (with confirm prompt)
promote ignore candidate_003            # dismiss permanently
promote snooze candidate_003 --days 30  # resurface later
```

> **Note on candidate IDs**: IDs (`candidate_001`, `candidate_002`, …) are stable across scans. Re-scanning a repo reuses existing IDs for patterns already in the database and assigns new numbers only for genuinely new clusters.

### Flow B — GitHub Actions (coming soon)

For teams that want a scheduled weekly digest and automated PR creation without running the CLI manually.

```yaml
# .github/workflows/promote-digest.yml
name: Promote weekly digest

on:
  schedule:
    - cron: "0 9 * * 1"   # every Monday 9am

jobs:
  promote:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx promote-cli scan --repo ${{ github.repository }} --since 7d --no-interactive
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      - run: npx promote-cli promote-all --min-confidence 0.85 --create-pr
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`--create-pr` (coming soon) commits the drafted file, pushes a branch, and opens a PR with evidence — suitable for CI where there's no human in the loop to do it manually.

<br />

## Routing Taxonomy

Every repeated pattern is classified into the right destination:

| Target | When to use | Example output |
|---|---|---|
| **agents** | Repo-wide coding convention | `AGENTS.md`, `CLAUDE.md` |
| **path_scoped_rule** | Rule for a specific directory | `.claude/rules/`, `.cursor/rules/` |
| **adr** | Decision rationale matters | `docs/adr/007-title.md` |
| **test** | Runtime invariant to enforce | Test recommendation |
| **none** | Not worth preserving | No action |

<br />

## Supported Tools

promote writes to any AI instruction format. `promote init` auto-configures the correct paths.

| Tool | Root instruction | Path-scoped rules |
|---|---|---|
| **Claude Code** | `CLAUDE.md` | `.claude/rules/*.instructions.md` |
| **OpenAI Codex** | `AGENTS.md` | Nested `AGENTS.md` per directory |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `.github/instructions/*.instructions.md` |
| **Cursor** | `.cursorrules` | `.cursor/rules/*.mdc` |
| **Windsurf** | `.windsurfrules` | `.windsurf/rules/*.md` |
| **Gemini CLI** | `GEMINI.md` | Nested `GEMINI.md` per directory |

<br />

## LLM Providers

BYOK — Bring Your Own Key. No hosted service required.

| Provider | Env var | Notes |
|---|---|---|
| **OpenAI** | `OPENAI_API_KEY` | Embedding + non-reasoning chat models (gpt-4.1 family) |
| **Anthropic** | `ANTHROPIC_API_KEY` | LLM-direct clustering (no embedding API needed) — **recommended for convention/principle extraction** |
| **Google** | `GOOGLE_API_KEY` | Free tier at [aistudio.google.com](https://aistudio.google.com/apikey) |

<br />

## Clustering modes

Two paths for grouping repeated comments, with very different output character:

### `quick` mode (default — embedding + HAC)

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

### `broad` mode (LLM-direct clustering)

- **How**: every comment goes through an LLM call grouped semantically by intent, not surface text similarity
- **What surfaces**: convention / principle / architectural-decision patterns, repo-wide rules
- **Examples from trpc/trpc (120d, Anthropic Haiku)**:
  - "Test files must import all utilities (assert, beforeAll, …) explicitly"
  - "Avoid destructuring directly in function parameter declarations"
  - "Internal implementation details must not be imported from `src/`; use public unstable API exports"
  - "Cache invalidation must include generator/tsconfig/artifact existence checks"
  - "SSE retry budget must not be consumed on initial connection; exclude AbortError"
- **Cost / time**: ~$0.47 / ~8 min on 380 comments (Anthropic, concurrency=1)
- **Provider recommendation: Anthropic Claude.** OpenAI broad on tier-1 keys hits rate limits on the larger models (gpt-4.1, gpt-4o) and the mini variants don't produce reliable semantic groupings; Anthropic Haiku 4.5 handles both depth and reliability in one tier.

### Picking a mode

| Cadence | Recommended | Why |
|---|---|---|
| **Weekly / biweekly** | OpenAI `quick` (gpt-4.1-mini + nano + embeddings) | Cheap, fast, catches narrow code patterns as they emerge |
| **Monthly** | Anthropic `broad` (Claude Haiku) | Higher cost but extracts conventions worth memorializing — fewer-but-deeper memory entries |
| **Quarterly / sprint-end** | Anthropic `broad` + optional `--mode quick` follow-up | Combined coverage: principles from broad, missed code-level from quick |

Switch modes at runtime without touching `.promote.yml`:

```bash
promote scan --repo owner/repo --since 30d --mode quick    # force embedding+HAC
promote scan --repo owner/repo --since 90d --mode broad    # force LLM-direct
```

### Trade-off summary (trpc/trpc 120d, 380 actionable AI comments)

| Mode + provider | Candidates | $ | Wall time | Output style |
|---|---|---|---|---|
| OpenAI quick (gpt-4.1-mini + nano) | **24** | $0.07 | 2m 14s | Narrow, file-specific |
| OpenAI broad (gpt-4.1-mini cluster) | 8 | $0.10 | 2m 39s | Core conventions only — agents-level subset of Anthropic's catch |
| OpenAI broad (gpt-4.1 full cluster) | — | — | — | Needs OpenAI tier 2+; tier 1 hits rate limits |
| **Anthropic broad (Haiku 4.5)** | **21** | $0.47 | 8m 17s | **Convention / principle / ADR mix — recommended depth** |

OpenAI broad is positioned as a "no-Anthropic-key" budget alternative — it reliably catches the 6–8 core repo-wide conventions (non-null assertion bans, function-param destructure rules, test-utility imports, CLI version pinning, etc.) at 5× lower cost than Anthropic broad. For full depth (20+ conventions including ADR-worthy decisions) use Anthropic broad.

<br />

## CLI Reference

```bash
promote init                                    # interactive setup
promote scan                                    # scan current repo, review interactively
promote scan --repo owner/repo --since 90d      # scan specific repo
promote review                                  # pick from pending candidates, review selected
promote candidate_001                           # apply a specific candidate (confirm prompt)
promote candidate_001 --target adr              # override routing target
promote ignore candidate_001 --reason "..."     # dismiss permanently
promote snooze candidate_001 --days 30          # snooze for 30 days
promote --help
```

<br />

## Configuration

`.promote.yml` is created by `promote init`. The example below is the output when **Claude Code** is the chosen AI tool and **Anthropic** is the detected provider — paths and model names vary per tool/provider:

```yaml
version: 2

language:
  preferredOutput: en

memoryTargets:
  agents:
    preferredFiles:
      - CLAUDE.md        # AGENTS.md for Codex, GEMINI.md for Gemini, etc.
  pathScoped:
    preferredDir: .claude/rules
  adr:
    dir: docs/adr

# aiReviewers:           # bot logins to include — defaults to a curated list
#   - github-copilot[bot] #   (Copilot, CodeRabbit, Greptile, Cursor, Sourcery, Devin, Qodo, ...)
#   - coderabbitai[bot]

thresholds:
  minOccurrences: 2          # total comments per cluster; each candidate is tagged
                             #   "cross-PR" (2+ distinct PRs) or "within-PR" (1 PR)
  windowDays: 60
  similarityThreshold: 0.80  # llmRefine merges borderline pairs in [0.65, 0.80) via LLM
  minConfidence: 0.75

llm:
  provider: anthropic         # openai | anthropic | google — auto-picked from detected env keys
  classificationModel: claude-haiku-4-5
  clusteringModel: claude-haiku-4-5         # used by LLM-direct clustering (anthropic) + llmRefine (openai/google)
  clusteringStrategy: llm-direct            # "embedding" (HAC + llmRefine) or "llm-direct" (semantic, principle-level)
  draftingModel: claude-haiku-4-5
  embeddingModel: text-embedding-3-small    # ignored when clusteringStrategy=llm-direct

privacy:
  redactSecrets: true                       # redact AWS keys, tokens, JWTs before sending to LLM
  sendDiffHunksToLLM: false                 # send code diff context with each comment (improves accuracy, sends code)
```

Per-provider defaults that `promote init` will write:

| Provider | classify | cluster | draft | embedding |
|---|---|---|---|---|
| **OpenAI** | gpt-4.1-mini | gpt-4.1-mini | gpt-4.1-nano | text-embedding-3-small |
| **Anthropic** | claude-haiku-4-5 | claude-haiku-4-5 | claude-haiku-4-5 | (n/a) |
| **Google** | gemini-flash-lite-latest | gemini-flash-lite-latest | gemini-flash-lite-latest | gemini-embedding-001 |

All defaults are **non-reasoning** models — reasoning families (`gpt-5.x`, `o1`/`o3`/`o4`) destabilize the structured JSON outputs the pipeline relies on. Bump to `claude-sonnet-4-6` / `claude-opus-4-7` / `gpt-4.1` (full) manually in `.promote.yml` if you want sharper classification at higher cost (and have an OpenAI tier 2+ key for the full-size GPT path).

> Without a `.promote.yml`, the schema falls back to `provider: openai` with `gpt-4.1-mini` for classification + drafting. Run `promote init` to get a per-tool/per-provider config.

<br />

## Roadmap

**Personal CLI (stable)**
- [x] Scan + classify + interactive review (per-candidate immediate apply)
- [x] `promote review` — pick from pending candidates, review selected
- [x] `promote <id>` — apply a specific candidate with confirm prompt
- [x] Multi-tool support (Claude, Codex, Copilot, Cursor, Windsurf, Gemini)
- [x] Multi-provider BYOK (OpenAI, Anthropic, Google)
- [x] i18n output (English, Korean, Japanese) — digest + scan summary; interactive review prompts remain English-only
- [x] Cross-run dedup + stable candidate IDs (same pattern reuses ID across scans)
- [x] Human reply/reaction signal — agree/dismiss replies and 👍/👎 inform classification
- [x] Secret redaction — AWS keys, tokens, JWTs stripped before LLM calls
- [x] Severity extraction — P0-P3, nit/must/should, `[!WARNING]` GitHub Alert syntax
- [x] `sendDiffHunksToLLM` — optional diff context per comment for better classification accuracy

**GitHub Actions**
- [ ] `--create-pr` — commit patch + open memory PR automatically (for CI/scheduled runs)
- [ ] `--no-interactive` + `--min-confidence` — headless mode for Actions
- [ ] Example workflow template

**MCP / agent**
- [ ] **MCP server** — use promote from Claude Code, Codex, Copilot as an MCP tool (no extra API key needed via MCP sampling)
- [ ] **Scan history** — `promote history` to track promoted rules over time

**Quality**
- [ ] **Eval command** — measure classification accuracy against golden dataset
- [ ] **Memory health** — detect stale rules, conflicts, oversized instruction files

**Later**
- [ ] **GitHub App** — hosted weekly digest issue + slash command promote → auto PR
- [ ] **Landing page + docs**

<br />

## Principles

- **Quiet by default** — silent unless there is repeated evidence
- **Human decides** — the tool drafts, humans route and merge
- **Evidence first** — every candidate shows the PR comments that caused it
- **Conservative** — if unsure, skip. Memory files are not a trash can
- **Tool-agnostic** — works across AI review tools and instruction formats

<br />

## License

MIT

