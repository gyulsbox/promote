# Examples

Real output and ready-to-use templates for `promote-cli`.

## What's here

| Folder | What it shows |
| --- | --- |
| [`digests/`](./digests/) | Sample markdown digests from real `promote scan` runs against [`trpc/trpc`](https://github.com/trpc/trpc) |
| [`patches/`](./patches/) | Illustrative diffs of what `promote` writes to your memory files |
| [`github-actions/`](./github-actions/) | A weekly scheduled workflow that opens a bundled memory PR |

## Suggested reading order

1. **[`digests/sample-quick.md`](./digests/sample-quick.md)** — what a fast scan ($0.07, 2m) looks like. Three representative candidates from a 24-candidate run.
2. **[`digests/sample-broad.md`](./digests/sample-broad.md)** — what a deeper scan ($0.45, 5m) looks like. Same repo, different mode; surfaces convention-level patterns.
3. **[`patches/claude-rule.patch`](./patches/claude-rule.patch)** and **[`patches/cursor-rule.patch`](./patches/cursor-rule.patch)** — what gets written when you `Promote` a candidate.
4. **[`github-actions/weekly-digest.yml`](./github-actions/weekly-digest.yml)** — drop-in workflow for running the whole flow on a schedule.

## Generating your own

To produce a digest like these against your own repository:

```bash
npm i -g promote-cli
promote init
promote scan --since 60d --mode quick --out my-digest.md   # or --mode broad
```

The digest will land at `my-digest.md` (or `docs/promote/digests/{date}.md` if you skip `--out`). It carries the same structure as the samples above — candidates, evidence trails to source PR comments, suggested patches, and a `Filtered out` appendix for clusters the classifier dropped.
