# Implementation Notes — `claude/review-prd-vwHVq`

Branch: `claude/review-prd-vwHVq`
Base: `origin/main`
Commits: 14 (see `git log origin/main..HEAD`)
Diff: +1,556 / −397 across 31 files

This document records what was implemented on this branch beyond the original PRD spec, why, and how it works. It is the source of truth for any reviewer who wants to understand *what is actually shipped* versus what the PRD originally described.

---

## 1. Summary by milestone

The branch delivers three coherent feature blocks layered on top of the v0.1 CLI MVP:

| Block | Theme | Status |
|---|---|---|
| **v0.2** | Clustering overhaul + P0/P1 bug fixes | Shipped |
| **v0.3** | Normalizer hardening for 2025–2026 bot output formats | Shipped |
| **v0.4** | Human reply/reaction signal in classification pipeline | Shipped |
| **UX / Cleanup** | `--write` removal, stable candidate IDs, `promote review`, init/digest polish | Shipped |

All three blocks compile clean (`pnpm exec tsc --noEmit`), build clean (`pnpm build` → 113 KB ESM), and pass a 12/12 smoke test for `classifyReplySentiment` covering English, Korean, and Japanese.

---

## 2. Block v0.2 — Clustering overhaul + core bug fixes

### A-1. Similarity re-normalization on missing metadata
**File**: `src/cluster/similarity.ts`

**Problem**: Pairs of comments with no `identifiers` and no `paths` capped at `cosine × 0.6 = 0.528 < 0.82 threshold`. Plain-text comments could never cluster.

**Fix**: Only include features that exist on both members, and divide the weighted sum by the total of present weights. Pure-text pairs now reduce to their cosine similarity.

```ts
// Was: weighted sum with 0 for missing features
// Now: weighted sum / sum of present weights
const features: Array<{ w: number; sim: number }> = [];
features.push({ w: 0.6, sim: cosineSimilarity(eA, eB) });
if (a.identifiers.length && b.identifiers.length) features.push({ w: 0.25, sim: jaccard(...) });
if (a.paths.length && b.paths.length) features.push({ w: 0.15, sim: pathSim(...) });
return weightedAverage(features);
```

### A-2. Secret redaction module + applied to LLM calls
**Files**: `src/normalize/redact.ts` (new), `src/classify/prompts.ts`, `src/draft/draft-generator.ts`

Detects and redacts before any LLM call:

- AWS access key — `AKIA[0-9A-Z]{16}` + trailing secret
- GitHub token — `gh[poirs]_[0-9A-Za-z]{36,}`
- Slack token — `xox[baprs]-[0-9]{12}-[0-9A-Za-z-]+`
- Stripe key — `(sk|pk)_(test|live)_[0-9a-zA-Z]{24,}`
- JWT — `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`
- URL credentials — `https?://user:pass@host`
- Generic high-entropy — standalone hex/base64 of 32+ chars

Substituted with `[REDACTED]`. Opt-out via `config.privacy.redactSecrets: false` (default `true`).

### A-3. Per-cluster error handling
**File**: `src/core/engine.ts`

Wraps each cluster's `classifyCluster` + `generateDraft` in a `try/catch`. On failure, increments `stats.failedClusters` and continues to the next cluster instead of aborting the whole scan. `AnalysisStats.failedClusters` added to `src/core/types.ts`.

### A-4. `test` target write path restored
**File**: `src/cli/commands/promote.ts`

Was returning the placeholder string `"(test — see digest for details)"` which `isValidFilePath()` rejected. Now writes to `docs/test-stubs/{slug}.md`, where `slug` is derived from the candidate summary. Parent directory auto-created.

### A-5. Snooze expiry auto-reset
**Files**: `src/storage/repositories.ts`, `src/cli/commands/scan.ts`

New `resetExpiredSnoozes(db, repo)` reactivates `status='snoozed'` candidates whose `snoozedUntil <= now()`. Called at the start of `runScan()`; counts shown to the user.

### A-6. Cross-run dedup via cluster fingerprint
**Files**: `src/core/engine.ts`, `src/cli/commands/scan.ts`, `src/storage/repositories.ts`

- `clusterFingerprint` added to `PromotionCandidate` and the SQLite `candidates` table
- `getCandidateByClusterFingerprint()` + `upsertCandidateRecord()` (`ON CONFLICT DO UPDATE`)
- During scan: clusters matching an existing fingerprint with status `promoted` or `ignored` are silently skipped; `candidate` status records get the latest draft content
- Result: re-scanning the same repo never resurfaces dismissed patterns and never duplicates already-applied ones

### A-7. `memory-scanner` honours config
**File**: `src/memory/memory-scanner.ts`

Was using hardcoded `DEFAULT_MEMORY_FILES` / `DEFAULT_MEMORY_DIRS`. Now augments those with `config.memoryTargets.agents.preferredFiles`, `config.memoryTargets.pathScoped.preferredDir`, and `config.memoryTargets.adr.dir`.

### A-8. ADR filename auto-numbering
**Files**: `src/cli/commands/promote.ts`, `src/draft/draft-generator.ts`

`resolveTargetFile()` for `target=adr` now:

1. Reads existing files under `config.memoryTargets.adr.dir` (default `docs/adr/`)
2. Extracts the leading number from `NNN-*.md`, takes `max + 1`
3. Generates `slug` from summary (lowercase, hyphenated, max 50 chars)
4. Returns `docs/adr/NNN-{slug}.md`

### B-1. Rolling medoid representative
**File**: `src/cluster/greedy-cluster.ts`

Greedy single-linkage previously locked the cluster representative to the *first* member, which drifts as the cluster grows. Now recomputes the medoid (member with highest average similarity to all others) on each insertion. Cost: O(n²) per cluster, negligible at typical scale (tens of members).

### B-2. Deterministic input ordering
**File**: `src/cluster/pre-cluster.ts`

Comments are sorted before clustering:

- Embedding mode: by L2 norm descending — most information-rich comments seed clusters first
- LLM mode: by `normalizedBody.length` descending — addresses "The Order Effect" (arXiv:2502.04134)

### B-3. Threshold default 0.82 → 0.85 → 0.80
**File**: `src/core/config.ts`

History:
- v0.1: 0.82 — baseline for `text-embedding-3-small`.
- v0.2: 0.85 — bumped after observing false-positive merges in raw-text mode.
- post-v0.3: **0.80** — v0.3 bot-signature/markdown stripping strips a large share
  of shared boilerplate, which dropped pairwise cosine similarity between
  genuinely repeated comments below 0.85. Empirically, embedding-mode scans on
  trpc/trpc were under-clustering (119 clusters from 132 comments → 2 repeated),
  while LLM-direct mode found 11. Lowered to 0.80 and widened llmRefine margin
  to 0.15 (so the LLM yes/no covers pairs in [0.65, 0.80)) to recover recall
  without compounding false-merges.

### B-4. HAC clustering
**File**: `src/cluster/hac-cluster.ts` (new)

Hierarchical Agglomerative Clustering with average linkage and distance threshold. Pure TypeScript, O(N²) distance matrix — acceptable up to ~500 comments. Used by `pre-cluster.ts` when embeddings are available. Greedy single-linkage retained as fallback for very large inputs.

Reference: BERTopic generalizability study (arXiv:2212.08459) shows HDBSCAN produces up to 74% outliers on short text; HAC + average linkage + distance threshold is the most stable deterministic choice for N ≤ thousands.

### B-5. LLM batched tree-reduce
**File**: `src/cluster/llm-cluster.ts`

For Anthropic-only mode (no embedding API): cluster in batches of 30, extract a representative per batch, then cluster the representatives. Final pass redistributes original members. Addresses the order-effect degradation seen with single-prompt clustering at N > 50.

### B-6. Cluster ID persistence
**Files**: `src/storage/schema.ts`, `src/storage/db.ts`, `src/storage/repositories.ts`

- `clusters.medoid_embedding BLOB` column (Float32Array packed)
- `clusters.fingerprint TEXT` column
- `findClusterByEmbedding(db, repo, embedding, threshold=0.92)` — Sentry-Seer style cluster re-identification across scans
- Migrations applied via idempotent `ALTER TABLE ... ADD COLUMN` in `db.ts`

### B-7. Borderline LLM refinement
**File**: `src/cluster/llm-refine.ts` (new)

After HAC, find pairs whose similarity falls within `threshold ± 0.05` and ask the LLM yes/no whether they belong to the same pattern. Merges only on positive response. Implements the LLMEdgeRefine pattern (EMNLP 2024).

### B-8. Cross-PR vs within-PR scope labeling
**Files**: `src/cli/commands/scan.ts`, `src/core/engine.ts`, `src/digest/digest-renderer.ts`, `src/cli/commands/review.ts`

`minOccurrences` filters on `cluster.members.length` (total similar comments). On top of that we compute scope:

- **cross-PR**: members from 2+ distinct PRs — the high-value signal for repository memory ("pattern recurs across separate reviews"). Sorted first.
- **within-PR**: all members from a single PR — a chatty bot in one review. Still surfaced as a candidate, but flagged so the user can deprioritize visually.

Scan output: `Repeated clusters: N (>= M members) · X cross-PR, Y within-PR`. Digest and review UI render `Scope: cross-PR (3 PRs)` or `Scope: within-PR (1 PR)` per candidate. Sorting puts cross-PR ahead in the candidate list so users see the strongest signals first.

---

## 3. Block v0.3 — Normalizer hardening (2025–2026 bot formats)

### C-1. `SeverityLevel` + `SeverityMarker` types
**File**: `src/core/types.ts`

```ts
export type SeverityLevel = "blocker" | "important" | "suggestion" | "nit" | "unknown";
export type SeverityMarker = { raw: string | null; level: SeverityLevel };
```

Added to `NormalizedComment`:

```ts
severityMarker: SeverityMarker;
```

### C-2. `extractSeverityMarker()`
**File**: `src/normalize/identifier-extractor.ts`

Detects severity prefixes regardless of comment language:

| Pattern | Example | Level |
|---|---|---|
| `P0[:：\s]` / `**P0:**` | `P0: null deref` | blocker |
| `P1[:：\s]` / `**Important:**` | CodeRabbit bold | important |
| `P2[:：\s]` / `**Suggestion:**` | Greptile / CodeRabbit | suggestion |
| `P3[:：\s]` / `nit:` / `**Nitpick:**` | nit family | nit |
| `critical[:：\s]` / `blocker[:：\s]` | plain text | blocker |
| `must[:：\s]` / `[!WARNING]` / `[!CAUTION]` | must / warn | important |
| `should[:：\s]` / `[!IMPORTANT]` | should | suggestion |
| `nit` / `minor` / `could` / `[!TIP]` / `[!NOTE]` | nit family | nit |

The marker is extracted from the original body *before* bot signatures and markdown are stripped, so labels embedded in collapsible blocks still register.

### C-3. Ko/Ja action verb extraction
**File**: `src/normalize/identifier-extractor.ts`

Korean and Japanese action verbs added (`사용`, `반드시`, `避け`, `必ず`, `削除`, `推奨`, etc.). `extractActionVerbs(text, language?)` now takes an optional language hint and runs the language-specific set only when applicable. `normalizer.ts` was reordered so `detectLanguage` runs before `extractActionVerbs`.

### C-4. Per-bot signature stripping
**File**: `src/normalize/bot-stripper.ts` (new)

Centralised strip rules:

- GitHub Alert syntax headers (`[!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`) — header line only, body preserved
- CodeRabbit footer (`⚡ CodeRabbit...`) and collapsible details — only when `authorLogin` includes `coderabbitai`
- Generic `<details>...</details>`, HTML comments, "generated by…" footers, "This review was…" lines

Severity markers are extracted *before* stripping so the strip never removes routing-relevant text.

### C-5. Normalizer order
**File**: `src/normalize/normalizer.ts`

```
1. extractSeverityMarker(originalBody)
2. stripBotSignatures(body, authorLogin)
3. stripMarkdown(body)
4. detectLanguage(normalizedBody)
5. extractIdentifiers(originalBody)
6. extractPaths(originalBody, comment.path)
7. extractActionVerbs(normalizedBody, language)
```

### C-6. Noise filter — GitHub Alert blocks
**File**: `src/filter/noise-filter.ts`

Adds patterns for standalone GitHub Alert blocks and CodeRabbit emoji-only lines to `BOT_FOOTER_PATTERNS`.

### C-7. Severity in classification prompt
**Files**: `src/classify/prompts.ts`, `src/classify/route-classifier.ts`

Each example in the prompt now carries a `[severity]` prefix when known:

```
1. [important] PR #347 [src/api.ts]: use shared API client
2. [nit] PR #352 [src/util.ts]: rename to camelCase
```

---

## 4. Block v0.4 — Human reply/reaction signal *(new in this branch, not in original PRD)*

### Motivation

PRD treated bot comments in isolation. In practice, human replies on bot comments carry the strongest signal:

- "good catch, will fix" / "동의합니다" → high-confidence agreement
- "this is intentional" / "특수케이스입니다" → reviewer dismissed the bot
- 👍 / 👎 reactions on bot comments → silent vote

This block surfaces all three into the classification pipeline.

### Coverage limitation

Real-repo runs (trpc/trpc 120d, 389 bot comments) show only ~3% of bot comments receive a recorded reply or reaction. Three reasons:

1. **Inline reply rate is low** — most bot review-line comments get resolved silently without a textual reply.
2. **General PR conversation isn't fetched** — `pulls.listReviewCommentsForRepo` (our source) returns inline line-comments only. The general PR thread (`issues.listComments`) where humans more commonly write "lgtm" / "ignore this" is a separate endpoint and not currently merged into the signal pipeline.
3. **Reactions on bot comments are rare** — humans tend to reply rather than 👍/👎 automated comments.

Scan output prints a `Human signal coverage` line (`X replies + Y reactions / N bot comments`) so users can see the absolute numbers and not mistake sparse signal for a bug. Expanding to `issues.listComments` and joining by PR proximity is a reasonable v0.5 follow-up.

### D-1. New types
**File**: `src/core/types.ts`

```ts
export type HumanReactionSignal = {
  agreementCount: number;
  rejectionCount: number;
  plusOneCount: number;
  minusOneCount: number;
  firstRejectExcerpt?: string;
};

// RawReviewComment additions
inReplyToId?: string;
reactions?: { plusOne: number; minusOne: number };

// NormalizedComment additions
diffHunk?: string;
inReplyToId?: string;
reactionCounts?: { plusOne: number; minusOne: number };

// Cluster + PromotionCandidate
humanSignal?: HumanReactionSignal;
```

### D-2. Capture from GitHub API
**File**: `src/ingest/comment-fetcher.ts`

GitHub's `pulls.listReviewCommentsForRepo` already returns `in_reply_to_id` and `reactions["+1" | "-1"]`. No extra API calls — just additional fields surfaced into `RawReviewComment`.

### D-3. Sentiment classification
**File**: `src/normalize/reply-sentiment.ts` (new)

Two-stage:

1. **Heuristic regex** — `classifyReplySentiment(body)` returns `agree | reject | neutral`. Patterns cover English (`lgtm`, `good catch`, `intentional`, `by design`, `won't fix`), Korean (`동의`, `맞`, `수정`, `완료`, `예외`, `의도적`, `특수 케이스`, `설계상`), and Japanese (`了解`, `意図的`, `例外`).
2. **LLM batched fallback** — `classifyAmbiguousReplies(replies[], model, costTracker)` for replies >100 chars that the regex couldn't classify. Single `generateObject` call with structured schema; logs a stderr warning if the LLM returns fewer items than were sent.

**Subtlety**: JavaScript regex `\b` word boundaries are ASCII-only. Korean/Japanese characters are `\W` class, so `\b동의\b` never matches. All non-ASCII patterns omit `\b`.

### D-4. Per-bot context map
**File**: `src/ingest/reply-context.ts` (new)

```ts
buildReplyContextMap(
  aiComments: RawReviewComment[],
  humanComments: RawReviewComment[],
  model: LanguageModel,
  costTracker: CostTracker,
): Promise<Map<string, BotCommentContext>>
```

Seeds the map with reactions from bot comments themselves, links each human reply whose `inReplyToId` targets a bot comment ID, runs short replies through the heuristic immediately, batches long/neutral replies to the LLM fallback. Returns `Map<botCommentId, { replies, reactions }>`.

### D-5. Pipeline integration
**Files**: `src/core/engine.ts`, `src/cli/commands/scan.ts`

`scan.ts` has an independent pipeline from `engine.ts` (CLI vs programmatic API). Both:

1. After filtering, call `buildReplyContextMap(ai, human, ...)` wrapped in try/catch; on failure use an empty `Map` (graceful degradation, no signal)
2. After clustering, call `aggregateHumanSignal(cluster, replyContextMap)` per cluster → assign to `cluster.humanSignal`
3. Pass `humanSignal` to `classifyCluster()` and into the final `PromotionCandidate`

`aggregateHumanSignal` is duplicated in both files intentionally; the helper is tiny and inlining keeps each pipeline self-contained.

### D-6. Prompt context
**File**: `src/classify/prompts.ts`

When `humanSignal` is present and non-empty, the classification prompt includes:

```
Human reviewer reactions: 2 reviewer(s) agreed (e.g. "good catch", "LGTM"), 👍 1.
Dismissal context: "이건 의도적으로 작성됨"
```

This is the LLM's first-class context for adjusting `confidence` and `needsHumanDecision`.

### D-7. Confidence adjustment
**File**: `src/classify/route-classifier.ts`

After the LLM call:

```ts
if (humanSignal.rejectionCount > 0) needsHumanDecision = true;
if (humanSignal.agreementCount >= 2) confidence = Math.min(0.97, confidence + 0.05);
```

Rejection is forced to need human review *even when* the LLM is confident — humans get the last word on dismissed patterns. Multiple agreements give a modest boost, capped to keep some uncertainty.

### D-8. Review UI surfacing
**File**: `src/cli/commands/review.ts`

`printCandidateDetails()` now shows after the Evidence block:

```
  Human signal  Agreed: 2 · Dismissed: 1 · 👍 3
  Dismissal     "이건 특수케이스입니다"
```

Only renders when at least one of the four counts is non-zero. `firstRejectExcerpt` capped at 120 chars.

### D-9. Persistence
**Files**: `src/storage/schema.ts`, `src/storage/db.ts`, `src/storage/repositories.ts`

- `candidates.human_signal_json TEXT` column
- Migration: idempotent `ALTER TABLE candidates ADD COLUMN human_signal_json TEXT`
- `upsertCandidateRecord` accepts and stores; `getCandidateById` / `listCandidates` rows are deserialised in `promote.ts` and `scan.ts`

---

## 5. CLI UX overhaul

### `--write` flag removed
**Files**: `src/cli/commands/promote.ts`, `src/cli/commands/scan.ts`, `src/cli/commands/init.ts`, `src/digest/digest-renderer.ts`

The original PRD had `promote candidate_001 --target agents --write` as a two-phase apply. Removed entirely. New behaviour:

- `scan` enters interactive review at the end — each approval writes immediately to the target file
- `promote <id>` shows full candidate details and asks for a confirm prompt before writing
- All stale `--write` references purged from help text and digest output

### `promote review` — multiselect re-review
**File**: `src/cli/commands/promote.ts`

Lists all pending candidates (`status=candidate` *or* `needs_human_decision`), prefixes `needs_human_decision` rows with `⚠`, lets the user multiselect, then runs `runInteractiveReview` on the selection. Survives partial scan sessions and re-scans.

### Stable candidate IDs across scans
**File**: `src/cli/commands/scan.ts`

Before the classify loop:

1. Load all existing candidate records for the repo
2. Map fingerprint → existing record
3. Find `maxNum` from existing IDs (`candidate_NNN`)
4. For each repeated cluster: reuse the existing ID if a fingerprint matches (and is not `promoted` / `ignored`), otherwise allocate `candidate_{maxNum+1}`

The user can refer to `candidate_003` across days/weeks and get the same thing. New patterns get fresh numbers, never collide.

### `digest-renderer` updates
**File**: `src/digest/digest-renderer.ts`

- Renders `Human signal` block after Evidence (en/ko/ja translated)
- Fixed stale `promote candidate_001 --target agents --write` → `promote {id} --target {target}`

### `init` improvements
**File**: `src/cli/commands/init.ts`

- Tool presets: Claude Code / OpenAI Codex / GitHub Copilot / Cursor / Windsurf / Gemini CLI — each maps to the right `rootFile` + `pathScopedDir` + `pathScopedExt`
- Generated config includes the `privacy:` block with `redactSecrets: true` and `sendDiffHunksToLLM: false`
- `language.fallback` removed (was declared but never read anywhere in the codebase)

### `sendDiffHunksToLLM` wired through
**Files**: `src/classify/prompts.ts`, `src/classify/route-classifier.ts`, `src/normalize/normalizer.ts`, `src/core/types.ts`

`NormalizedComment.diffHunk` carried through normalization. When `config.privacy.sendDiffHunksToLLM` is `true`, the first 150 chars of `diffHunk` (newlines → `↵`) are appended to each example in the classification prompt:

```
2. [important] PR #347 [src/api.ts]: use shared API client
   diff: @@ -10,3 +10,5 @@ export function getUser() {↵-  return fetch(...)↵+  return client.get(...)
```

Default off — the config flag exists to make this opt-in for users who care about classification accuracy more than code privacy.

---

## 6. Default config (`init` output, Claude Code + Anthropic preset)

`promote init` writes a per-tool/per-provider config. The example below is the output when Claude Code is selected as the AI tool and the Anthropic API key is the detected provider. The schema *fallback* (when no `.promote.yml` exists at all) is `provider: openai` with `gpt-4.1-mini` — see `src/core/config.ts:74-79`.

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
  minOccurrences: 2           # total members in cluster; scope (cross-PR/within-PR) — see B-8
  windowDays: 60
  similarityThreshold: 0.80   # 0.82 → 0.85 (v0.2) → 0.80 (post-v0.3 stripping)
  minConfidence: 0.75

llm:
  provider: anthropic         # auto-picked from detected env keys
  classificationModel: claude-sonnet-4-5
  draftingModel: claude-haiku-4-5
  embeddingModel: text-embedding-3-small   # ignored when provider=anthropic

privacy:
  redactSecrets: true         # new
  sendDiffHunksToLLM: false   # new
```

---

## 7. File-by-file change index

| File | Block | Summary |
|---|---|---|
| `src/cluster/similarity.ts` | A-1 | weight re-normalisation on missing features |
| `src/normalize/redact.ts` (new) | A-2 | secret patterns + redactSecrets() |
| `src/classify/prompts.ts` | A-2, C-7, D-6 | redact, severity prefix, humanSignal section, diffHunk |
| `src/draft/draft-generator.ts` | A-2, A-8 | redact + ADR auto-numbering |
| `src/core/engine.ts` | A-3, A-6, D-5 | try/catch, fingerprint dedup, reply context map, aggregateHumanSignal |
| `src/cli/commands/promote.ts` | A-4, A-8, UX | test target path, ADR numbering, `promote review` multiselect, status filter, humanSignal deserialise |
| `src/cli/commands/scan.ts` | A-5, A-6, D-5, UX | snooze reset, fingerprint dedup, replyContextMap, stable IDs, humanSignalJson persist |
| `src/storage/repositories.ts` | A-5, A-6, B-6, D-9 | resetExpiredSnoozes, upsertCandidateRecord, saveCluster + medoid, humanSignalJson |
| `src/memory/memory-scanner.ts` | A-7 | reads config.memoryTargets paths |
| `src/core/config.ts` | B-3, UX | threshold 0.85, removed language.fallback |
| `src/cluster/greedy-cluster.ts` | B-1 | rolling medoid representative |
| `src/cluster/pre-cluster.ts` | B-2 | deterministic input ordering, dispatches to HAC/LLM/greedy |
| `src/cluster/hac-cluster.ts` (new) | B-4 | hierarchical agglomerative clustering |
| `src/cluster/llm-cluster.ts` | B-5 | batched tree-reduce |
| `src/cluster/llm-refine.ts` (new) | B-7 | borderline LLM refinement (LLMEdgeRefine) |
| `src/storage/schema.ts` | B-6, D-9 | medoid_embedding, cluster_fingerprint, human_signal_json |
| `src/storage/db.ts` | B-6, D-9 | idempotent ALTER TABLE migrations |
| `src/core/types.ts` | many | SeverityMarker, HumanReactionSignal, RawReviewComment/NormalizedComment/Cluster/PromotionCandidate additions, failedClusters |
| `src/normalize/identifier-extractor.ts` | C-2, C-3 | extractSeverityMarker, Ko/Ja action verbs |
| `src/normalize/bot-stripper.ts` (new) | C-4 | per-bot signature strip rules |
| `src/normalize/normalizer.ts` | C-5 | severity → bot strip → markdown → language → verbs |
| `src/filter/noise-filter.ts` | C-6 | GitHub Alert + CodeRabbit emoji patterns |
| `src/classify/route-classifier.ts` | C-7, D-7, sendDiffHunks | severity examples, confidence adjust, includeDiffHunks |
| `src/ingest/comment-fetcher.ts` | D-2 | inReplyToId + reactions capture |
| `src/normalize/reply-sentiment.ts` (new) | D-3 | regex sentiment + LLM batch fallback |
| `src/ingest/reply-context.ts` (new) | D-4 | buildReplyContextMap |
| `src/cli/commands/review.ts` | D-8 | Human signal Evidence block |
| `src/digest/digest-renderer.ts` | UX | humanSignal rendering, removed `--write` |
| `src/cli/commands/init.ts` | UX | tool presets, privacy block, removed language.fallback |
| `README.md` | UX | flow descriptions, stable IDs note, roadmap, config defaults |
| `src/index.ts` | UX | version 0.1.2 |

---

## 8. Verification

```bash
pnpm exec tsc --noEmit    # 0 errors
pnpm build                # 113 KB ESM, clean
pnpm test                 # vitest — see src/normalize/reply-sentiment.test.ts
```

`classifyReplySentiment` is covered by a vitest spec at `src/normalize/reply-sentiment.test.ts` — 12 baseline cases (en/ko/ja) plus 4 Korean narrowing-regression cases (`수정 필요`, `수정했어요`, `예외처리가 필요`, `예외 케이스입니다`):

```
✓ agree: "lgtm"
✓ agree: "good catch, will fix"
✓ agree: "fixed!"
✓ agree: "동의합니다"
✓ agree: "완료했습니다"
✓ agree: "+1"
✓ reject: "this is intentional"
✓ reject: "by design, won't fix"
✓ reject: "특수케이스입니다"
✓ reject: "의도적으로 작성됨"
✓ neutral: "can you explain more?"
✓ neutral: "what about the edge case?"
✓ neutral: "이 부분 수정 필요해요"
✓ agree:   "수정했어요"
✓ neutral: "이 경우 예외처리가 필요해 보입니다"
✓ reject:  "이건 예외 케이스입니다"

16/16 passed
```

---

## 9. Open follow-ups (not in this branch)

- `--create-pr` flag for CI/Actions headless mode
- `--no-interactive` + `--min-confidence` headless promotion
- MCP server (Claude Code / Codex tool invocation)
- `promote eval` against golden dataset
- `promote history` for tracking promoted rules over time
- Memory health checks (stale rules, oversized files, conflicts)
