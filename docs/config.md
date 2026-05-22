# Configuration

`.promote.yml` is created by `promote init`. The example below is the output when **Claude Code** is the chosen AI tool and **Anthropic** is the detected provider — paths and model names vary per tool/provider.

## Full schema

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

## Per-provider defaults

What `promote init` writes depending on which env key it detects:

| Provider      | classify                  | cluster                   | draft                     | embedding              |
| ------------- | ------------------------- | ------------------------- | ------------------------- | ---------------------- |
| **OpenAI**    | gpt-4.1-mini              | gpt-4.1-mini              | gpt-4.1-nano              | text-embedding-3-small |
| **Anthropic** | claude-haiku-4-5          | claude-haiku-4-5          | claude-haiku-4-5          | (n/a)                  |
| **Google**    | gemini-flash-lite-latest  | gemini-flash-lite-latest  | gemini-flash-lite-latest  | gemini-embedding-001   |

All defaults are **non-reasoning** models — reasoning families (`gpt-5.x`, `o1`/`o3`/`o4`) destabilize the structured JSON outputs the pipeline relies on. Bump to `claude-sonnet-4-6` / `claude-opus-4-7` / `gpt-4.1` (full) manually in `.promote.yml` if you want sharper classification at higher cost (and have an OpenAI tier 2+ key for the full-size GPT path).

## Provider env vars

| Provider      | Env var             | Notes                                                                                       |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| **OpenAI**    | `OPENAI_API_KEY`    | Embedding + non-reasoning chat models (gpt-4.1 family)                                       |
| **Anthropic** | `ANTHROPIC_API_KEY` | LLM-direct clustering (no embedding API needed) — recommended for convention/principle work |
| **Google**    | `GOOGLE_API_KEY`    | Free tier at [aistudio.google.com](https://aistudio.google.com/apikey)                       |

## Fallback

Without a `.promote.yml`, the schema falls back to `provider: openai` with `gpt-4.1-mini` for classification + drafting. Run `promote init` to get a per-tool / per-provider config.

## Memory targets matrix

`promote init` auto-configures the correct paths for the AI tool you pick:

| Tool             | Root instruction                       | Path-scoped rules                              |
| ---------------- | -------------------------------------- | ---------------------------------------------- |
| **Claude Code**  | `CLAUDE.md`                            | `.claude/rules/*.instructions.md`              |
| **OpenAI Codex** | `AGENTS.md`                            | Nested `AGENTS.md` per directory               |
| **GitHub Copilot** | `.github/copilot-instructions.md`    | `.github/instructions/*.instructions.md`       |
| **Cursor**       | `.cursorrules`                         | `.cursor/rules/*.mdc`                          |
| **Windsurf**     | `.windsurfrules`                       | `.windsurf/rules/*.md`                         |
| **Gemini CLI**   | `GEMINI.md`                            | Nested `GEMINI.md` per directory               |

## Routing taxonomy

Every repeated pattern is classified into one of these destinations:

| Target               | When to use                       | Example output                          |
| -------------------- | --------------------------------- | --------------------------------------- |
| **agents**           | Repo-wide coding convention       | `AGENTS.md`, `CLAUDE.md`                |
| **path_scoped_rule** | Rule for a specific directory     | `.claude/rules/`, `.cursor/rules/`      |
| **adr**              | Decision rationale matters        | `docs/adr/007-title.md`                 |
| **test**             | Runtime invariant to enforce      | Test recommendation                     |
| **none**             | Not worth preserving              | No action                               |
