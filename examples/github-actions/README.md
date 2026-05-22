# Running `promote-cli` from GitHub Actions

This directory contains a ready-to-copy workflow that runs `promote scan` on a
schedule and opens a single bundled PR with any high-confidence memory
promotions found in your repository's AI review comments.

## Quick install

Copy [`weekly-digest.yml`](./weekly-digest.yml) into your repo at
`.github/workflows/weekly-digest.yml`, then:

1. **Add provider secrets.** Go to *Settings → Secrets and variables → Actions*
   and add the one your repo is configured for in `.promote.yml`:
   - `ANTHROPIC_API_KEY`, or
   - `OPENAI_API_KEY`, or
   - `GOOGLE_API_KEY`.

   `GITHUB_TOKEN` is provided automatically by Actions — you do **not** need to
   create a personal access token.

2. **Grant write permissions.** The workflow already declares
   `contents: write` and `pull-requests: write`. Make sure your repo's default
   workflow permissions don't override that: *Settings → Actions → General →
   Workflow permissions → Read and write permissions*.

3. **Commit `.promote.yml`** at the repo root (or run `promote init` locally
   and commit the result). The workflow needs it to know your provider,
   memory targets, and confidence thresholds.

4. **Trigger a first run.** From the *Actions* tab, pick *Weekly memory
   promotion digest* → *Run workflow*. The schedule will then take over.

## What the workflow does

1. Checks out the repo with full history.
2. Restores any cached `.promote/` state (SQLite DB + digest cache) from a
   previous run — this keeps candidate IDs stable and prevents the same
   pattern from being re-promoted week over week.
3. Runs `promote scan --no-interactive --min-confidence 0.85 --create-pr`:
   - Scans recent PR review comments.
   - Auto-applies every candidate at or above confidence `0.85` whose status
     is `candidate` (it does **not** auto-apply `needs_human_decision`).
   - Opens one PR titled `promote: N memory updates from {date} scan`,
     labels it `memory-promotion`, and includes the full digest at
     `docs/promote/digests/{date}.md` as part of the same commit.
4. If your repo has a `PULL_REQUEST_TEMPLATE.md`, the workflow keeps that
   template intact and adds a `## Memory promotion details` appendix below it.

## Tuning

| Flag                       | Default                              | When to change                                                    |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `--min-confidence`         | `config.thresholds.minConfidence` (0.75) | Raise to `0.9+` if you want fewer, higher-conviction PRs.        |
| `--since` (not in example) | `config.thresholds.windowDays` (60)  | Drop to `--since 7d` if running weekly and you want less overlap. |
| `--mode broad`             | `config.llm.clusteringStrategy`      | Force LLM-direct clustering when on Anthropic.                    |
| `--base-branch`            | repo default branch                  | If you want PRs to target `develop` or another long-lived branch. |

## Self-hosted runners

The workflow uses `gh` (preinstalled on GitHub-hosted runners) when
available. On self-hosted runners without `gh`, `promote-cli` falls back to
the Octokit REST API using `GITHUB_TOKEN`, so no extra setup is needed.

## Cost control

`promote-cli` only calls the LLM for repeated clusters (≥ `minOccurrences`
members). For a mid-size repo with ~200 PR review comments over 60 days,
expect a handful of dollars per scan on default Claude models. See
[`docs/clustering.md`](../../docs/clustering.md) for the cost breakdown.
