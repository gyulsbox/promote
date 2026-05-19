<div align="center">

<h1>promote</h1>

<p><strong>Pick up lost decisions from AI review comments.</strong></p>

<p>
  <a href="#why">Why</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#supported-tools">Supported Tools</a> ·
  <a href="#cli-reference">CLI Reference</a>
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

### Scan

<div align="center">

![promote scan](demo/scan.gif)

</div>

### Init

<div align="center">

![promote init](demo/init.gif)

</div>

<br />

## How It Works

```
AI review comments across PRs
  → detect repeated patterns
  → classify: AGENTS.md? ADR? test? path-scoped rule?
  → draft a small memory patch
  → human reviews and decides
  → future AI agents read the promoted rule
```

promote does not generate more review comments. It **reduces** repeated ones over time.

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
| **OpenAI** | `OPENAI_API_KEY` | Embedding + classification |
| **Anthropic** | `ANTHROPIC_API_KEY` | LLM clustering (no extra key needed) |
| **Google** | `GOOGLE_API_KEY` | Free tier at [aistudio.google.com](https://aistudio.google.com/apikey) |

<br />

## CLI Reference

```bash
promote init                                    # interactive setup
promote scan                                    # scan current repo
promote scan --repo owner/repo --since 90d      # scan specific repo
promote promote candidate_001 --target agents --write
promote promote candidate_001 --dry-run         # preview without writing
promote ignore candidate_001 --reason "..."
promote snooze candidate_001 --days 30
promote --help
```

<br />

## Configuration

`.promote.yml` is created by `promote init`:

```yaml
version: 1

language:
  preferredOutput: en

memoryTargets:
  agents:
    preferredFiles:
      - CLAUDE.md
  pathScoped:
    preferredDir: .claude/rules
  adr:
    dir: docs/adr

thresholds:
  minOccurrences: 3
  windowDays: 60
  similarityThreshold: 0.82
  minConfidence: 0.75

llm:
  provider: anthropic
  classificationModel: claude-sonnet-4-5
  draftingModel: claude-haiku-4-5
```

<br />

## Roadmap

- [x] CLI scan + classify + digest
- [x] Interactive review (promote / skip / change target)
- [x] Multi-tool support (Claude, Codex, Copilot, Cursor, Windsurf, Gemini)
- [x] Multi-provider BYOK (OpenAI, Anthropic, Google)
- [x] i18n output (English, Korean, Japanese)
- [ ] **MCP server** — use promote from Claude Code / AI clients as a tool
- [ ] **GitHub Action** — scheduled weekly digest as a cron job
- [ ] **GitHub Issue digest** — weekly issue with candidates as checkboxes, check to promote, creates PR automatically
- [ ] **PR creation** — `promote promote --create-pr` to open a memory PR with evidence
- [ ] **Scan history** — `promote history` to view past scans and track promoted rules
- [ ] **Memory health** — detect stale rules, conflicts, oversized instruction files
- [ ] **Eval command** — measure classification accuracy against golden dataset
- [ ] **Landing page + docs** — [better-auth.com](https://better-auth.com)-style site with Fumadocs

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
