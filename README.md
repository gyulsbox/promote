# promote

**Pick up lost decisions from AI review comments.**

AI review tools leave comments on PRs. Developers resolve them and move on. The decision disappears into a closed PR thread. If the same issue appears next week, the team pays the same review cost again.

**promote** detects repeated AI review comment patterns across PRs, classifies where the knowledge should live, and helps you promote it into durable repository memory.

```bash
npx promote-cli scan --repo owner/repo
```

---

## How it works

```
AI review comments across PRs
  → detect repeated patterns
  → classify: AGENTS.md? ADR? test? path-scoped rule?
  → draft a small memory patch
  → human reviews and decides
  → future AI agents read the promoted rule
```

promote does not generate more review comments. It reduces repeated ones over time.

---

## Quick start

### 1. Initialize

```bash
npx promote-cli init
```

Interactive setup walks you through:
- LLM provider (OpenAI / Anthropic / Google)
- AI tool (Claude Code / Codex / Copilot / Cursor / Windsurf / Gemini)
- Output language (English / Japanese / Korean)
- Memory file locations

### 2. Scan

```bash
npx promote-cli scan
```

Scans the current repo's AI review comments (default: last 60 days), clusters repeated patterns, classifies routing targets, and generates a digest.

```bash
npx promote-cli scan --repo trpc/trpc --since 90d
```

### 3. Review

After scanning, review candidates one by one:

```
  --- Candidate 1/7 ---

  React hooks should use named imports instead of default imports

  Target      path_scoped_rule -> .claude/rules/react-imports.instructions.md
  Confidence  0.85
  Occurrences 3

  Evidence:
    PR #7362 packages/tanstack-react-query/test/polymorphism.test.tsx
    PR #7362 packages/tanstack-react-query/test/client.test.tsx

  Patch:
    ---
    applyTo: "packages/tanstack-react-query/test/**"
    ---
    # React Hooks Import Convention
    - Use named imports for React hooks

  > Promote | Change target | Show full | Skip
```

### 4. Promote

Accepted candidates are written to the configured memory files.

```bash
# Or promote manually later:
promote promote candidate_001 --target agents --write
```

---

## Routing taxonomy

promote classifies each repeated pattern into one of these targets:

| Target | When to use | Output |
|---|---|---|
| `agents` | Repo-wide coding convention | AGENTS.md, CLAUDE.md, .cursorrules |
| `path_scoped_rule` | Rule for a specific directory | .claude/rules/, .github/instructions/, .cursor/rules/ |
| `adr` | Decision rationale matters | docs/adr/NNN-title.md |
| `test` | Runtime invariant to enforce | Test recommendation |
| `none` | Not worth preserving | No action |

---

## Supported AI tools

promote works with any AI reviewer and writes to any instruction format:

| Tool | Root instruction | Path-scoped rules |
|---|---|---|
| Claude Code | `CLAUDE.md` | `.claude/rules/*.instructions.md` |
| OpenAI Codex | `AGENTS.md` | Nested `AGENTS.md` per directory |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/instructions/*.instructions.md` |
| Cursor | `.cursorrules` | `.cursor/rules/*.mdc` |
| Windsurf | `.windsurfrules` | `.windsurf/rules/*.md` |
| Gemini CLI | `GEMINI.md` | Nested `GEMINI.md` per directory |

`promote init` auto-configures the correct paths for your tool.

---

## Supported LLM providers

BYOK (Bring Your Own Key). No hosted service required.

| Provider | Env var | Embedding | Classification |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | text-embedding-3-small | gpt-4.1-mini |
| Anthropic | `ANTHROPIC_API_KEY` | (LLM clustering) | claude-sonnet-4-5 |
| Google | `GOOGLE_API_KEY` | gemini-embedding-001 | gemini-2.5-flash |

Google offers free API keys at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

---

## CLI reference

```bash
promote init                              # interactive setup
promote scan                              # scan current repo (60d default)
promote scan --repo owner/repo            # scan specific repo
promote scan --repo owner/repo --since 90d
promote promote candidate_001 --target agents --write
promote promote candidate_001 --dry-run   # preview without writing
promote ignore candidate_001 --reason "too specific"
promote snooze candidate_001 --days 30
promote --help
```

---

## Configuration

`.promote.yml` is created by `promote init`. Example:

```yaml
version: 1

language:
  preferredOutput: en
  fallback: en

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

---

## Why

AI review comments often contain implicit decisions: why one approach is preferred, which utility to use, what invariant must hold. Developers resolve the comment and move on. The decision is never captured.

As AI handles more implementation, the volume of these lost decisions grows while human attention to capture them does not.

promote picks up what others leave behind.

> "The human reviewer's role is no longer to trace code details,
> but to measure the distance between decisions and implementation."

---

## Principles

- **Quiet by default** — silent unless there is repeated evidence
- **Human decides** — the tool drafts, humans route and merge
- **Evidence first** — every candidate shows the PR comments that caused it
- **Conservative** — if unsure, skip. Memory files are not a trash can
- **Tool-agnostic** — works across AI review tools and instruction formats

---

## Thesis

This project comes from the article:

> AI review comments are not always just defects in the current PR. Sometimes they reveal implicit knowledge that has not yet been written into the repository. If the same comment appears again in future PRs, it should be promoted into durable memory.

- [Original article (Japanese)](https://zenn.dev/hayden/articles/94e03e33ad288e)
- [Companion article: Developer attention in the AI era (Japanese)](https://zenn.dev/hayden/articles/bc3b43fa0b3c1a)

---

## License

MIT
