import { generateObject } from "ai";
import { seedIfSupported, temperatureIfSupported, llmProviderOptions } from "../llm/provider.js";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { NormalizedComment, Cluster } from "../core/types.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { createHash } from "node:crypto";
import { sanitizeUnicode } from "../normalize/sanitize.js";

const clusterResultSchema = z.object({
  clusters: z.array(
    z.object({
      groupName: z.string().describe("Short name for this group of similar comments"),
      memberIndices: z
        .array(z.number())
        .describe("Indices of comments that belong to this group (0-based)"),
    }),
  ),
});

// Smaller batches keep single-request token count well under common TPM limits
// (e.g., OpenAI tier 1 = 30k TPM on full-tier chat models) and prevent
// Anthropic response truncation that surfaces as "No object generated: could
// not parse the response".
const BATCH_SIZE = 15;
// 16k output cap — large enough to clear the meta-reduce pass for ~500 input
// comments (~100 representatives, each emitting ~30 tokens of cluster metadata)
// even when an OpenAI reasoning model burns a chunk of the budget on internal
// reasoning before producing the final JSON.
const MAX_OUTPUT_TOKENS = 16000;

export async function llmCluster(input: {
  comments: NormalizedComment[];
  model: LanguageModel;
  costTracker: CostTracker;
  onProgress?: (msg: string) => void;
}): Promise<Cluster[]> {
  const { comments, model, costTracker, onProgress } = input;
  if (comments.length === 0) return [];
  return clusterRecursive(comments, model, costTracker, onProgress, 0);
}

/**
 * Hierarchical reduce: split into batches of BATCH_SIZE, cluster each, then
 * recursively cluster the per-batch representatives until the working set
 * fits in a single batch. Each LLM call therefore processes at most BATCH_SIZE
 * items, regardless of original input size — avoids the "single huge meta
 * call" failure mode where ~150 representatives in one prompt overflowed the
 * model's reliable structured-output budget.
 */
// Concurrent LLM calls per depth. Provider+model-aware because tier-1 rate
// limits collapse under parallel batching on the *large* model variants of
// every provider:
//   Anthropic: 50 req / 50k input-tokens per minute (every Claude model)
//   OpenAI gpt-4.1, gpt-4o, gpt-5 (full): 30k TPM
//   OpenAI gpt-4.1-mini/nano, gpt-4o-mini: ~200k+ TPM (tier 1)
//   Google Gemini Flash / Flash-Lite: generous free-tier limits
// 3-way parallel on a tier-1 large model trips TPM within ~10s and cascades
// into retry floods; concurrency=1 keeps the per-minute token budget honest.
const CLUSTER_CONCURRENCY_DEFAULT = 3;
const CLUSTER_CONCURRENCY_RATE_LIMITED = 1;

function isLargeOpenAIModel(modelId: string): boolean {
  if (!/^gpt-(4|5)/.test(modelId)) return false;
  // mini / nano / chat-latest variants ship with much higher tier-1 limits
  if (/(mini|nano|chat-latest)/.test(modelId)) return false;
  return true;
}

function clusterConcurrency(model: LanguageModel): number {
  const provider = (model as { provider?: string }).provider ?? "";
  const modelId = (model as { modelId?: string }).modelId ?? "";
  if (provider.startsWith("anthropic")) return CLUSTER_CONCURRENCY_RATE_LIMITED;
  if (provider.startsWith("openai") && isLargeOpenAIModel(modelId)) {
    return CLUSTER_CONCURRENCY_RATE_LIMITED;
  }
  return CLUSTER_CONCURRENCY_DEFAULT;
}

// Hard cap on recursion depth. Beyond this we bail out — protects against
// runaway cost in scenarios where the model can't produce schema-valid output
// (so every batch falls back to singletons, the representative count never
// reduces, and a naive recursion would loop forever burning tokens).
const MAX_CLUSTER_DEPTH = 5;

async function clusterRecursive(
  comments: NormalizedComment[],
  model: LanguageModel,
  costTracker: CostTracker,
  onProgress: ((msg: string) => void) | undefined,
  depth: number,
): Promise<Cluster[]> {
  if (comments.length <= BATCH_SIZE) {
    return singlePassCluster(comments, model, costTracker, onProgress);
  }
  if (depth >= MAX_CLUSTER_DEPTH) {
    onProgress?.(
      `[depth ${depth}] Max depth reached — returning ${comments.length} singletons.`,
    );
    return commentsAsSingletons(comments);
  }

  const batches = chunk(comments, BATCH_SIZE);
  onProgress?.(
    `[depth ${depth}] Clustering ${comments.length} items in ${batches.length} batches of ${BATCH_SIZE}...`,
  );

  // Run batches with bounded concurrency. Each batch is independent (different
  // input slice) so race-free, and the result order doesn't matter — we
  // collect all sub-clusters and let the next depth meta-cluster them.
  const batchClusters: Cluster[] = [];
  let completed = 0;
  const queue = batches.map((b, i) => ({ batch: b, index: i }));

  const runWorker = async (): Promise<void> => {
    while (true) {
      const item = queue.shift();
      if (!item) return;
      const subClusters = await singlePassCluster(item.batch, model, costTracker);
      batchClusters.push(...subClusters);
      completed++;
      onProgress?.(`[depth ${depth}] Batch ${completed}/${batches.length}...`);
    }
  };

  const concurrency = clusterConcurrency(model);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);

  // representative-id → expanded members so we can unfold after the recursive
  // meta-clustering returns
  const repToMembers = new Map<string, NormalizedComment[]>();
  for (const c of batchClusters) {
    repToMembers.set(c.representative.id, c.members);
  }

  const representatives = batchClusters.map((c) => c.representative);

  // Progress check: if this depth made no merges (representative count equals
  // input count), recursing again will hit the exact same situation. Bail out
  // with the current cluster set instead of spinning forever.
  if (representatives.length >= comments.length) {
    onProgress?.(
      `[depth ${depth}] No merging happened (${comments.length} → ${representatives.length}) — stopping recursion.`,
    );
    return batchClusters;
  }

  onProgress?.(
    `[depth ${depth}] Merging ${representatives.length} representatives...`,
  );
  const topClusters = await clusterRecursive(
    representatives,
    model,
    costTracker,
    onProgress,
    depth + 1,
  );

  // Unfold: replace each rep in topCluster.members with its expanded members
  return topClusters.map((topCluster) => {
    const allMembers: NormalizedComment[] = [];
    for (const topMember of topCluster.members) {
      const subMembers = repToMembers.get(topMember.id);
      if (subMembers) allMembers.push(...subMembers);
      else allMembers.push(topMember);
    }
    return {
      ...topCluster,
      members: allMembers,
      memberEmbeddings: [],
    };
  });
}

function commentsAsSingletons(comments: NormalizedComment[]): Cluster[] {
  return comments.map((c) => ({
    id: generateClusterId(c),
    representative: c,
    representativeEmbedding: [],
    members: [c],
    memberEmbeddings: [],
    fingerprint: generateFingerprint(c),
  }));
}

async function singlePassCluster(
  comments: NormalizedComment[],
  model: LanguageModel,
  costTracker: CostTracker,
  onProgress?: (msg: string) => void,
): Promise<Cluster[]> {
  if (comments.length === 0) return [];
  // A single comment is trivially its own cluster — no LLM needed, can't fail.
  if (comments.length === 1) return commentsAsSingletons(comments);

  const commentList = comments
    .map((c, i) => {
      const pathInfo = c.filePath ? ` [${c.filePath}]` : "";
      const excerpt = sanitizeUnicode(c.normalizedBody.slice(0, 200));
      return `[${i}] PR #${c.prNumber}${pathInfo}: ${excerpt}`;
    })
    .join("\n");

  onProgress?.("Clustering with LLM...");

  try {
    const { object, usage } = await generateObject({
      model,
      schema: clusterResultSchema,
      providerOptions: llmProviderOptions(model),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...temperatureIfSupported(model),
      ...seedIfSupported(model),
      system: `You group AI code review comments that would ALL be addressed by the SAME rule, convention, or fix.

TWO criteria must BOTH apply to merge comments:
1. SAME ACTION — they all recommend the same operation ("use X instead of Y", "validate X", "rename to X", "extract to helper Y").
2. SAME INTENT — solving them together would mean writing one rule, not two. If two comments would require separate rules in AGENTS.md / ADR / path-scoped doc, they DO NOT belong together.

DO NOT merge when:
- Same file but different fixes (one about null-checks, one about types — different groups).
- Same feature area but different problems (one about error handling, one about test setup).
- Shared keywords but different root causes ("missing X" can mean very different things).
- "Various issues in X" — heterogeneous bags are NOT a group; split them.

PREFER singleton groups when in doubt. A singleton is fine. Merging unrelated comments wastes downstream effort because the classifier will throw the group away.

Examples of CORRECT grouping:
- "Use shared API client in src/auth.ts" + "Replace direct fetch with the API client in src/billing.ts" → one group (same action, same intent).
- "Add null check before accessing config.timeout" + "Add null check before accessing options.maxRetries" → one group (same action: defensive null guard before optional property access).

Examples of INCORRECT grouping (DO NOT do this):
- "Add null check in src/auth.ts" + "Add error logging in src/auth.ts" → DIFFERENT groups (different actions).
- "@ts-expect-error needs description" + "Use namespace React import" → DIFFERENT groups (different conventions).
- Three comments each describing a different bug in the same function → DIFFERENT groups, even if they touch the same file.

Every comment must appear in exactly one group. Single-comment groups are expected and encouraged.`,
      prompt: `Group these ${comments.length} AI review comments by similarity:\n\n${commentList}`,
    });

    costTracker.record("llm-clustering", {
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
    });

    const clusters: Cluster[] = [];

    for (const group of object.clusters) {
      const members = group.memberIndices
        .filter((i) => i >= 0 && i < comments.length)
        .map((i) => comments[i]);

      if (members.length === 0) continue;

      const representative = members[0];
      clusters.push({
        id: generateClusterId(representative),
        representative,
        representativeEmbedding: [],
        members,
        memberEmbeddings: [],
        fingerprint: generateFingerprint(representative),
      });
    }

    // Belt-and-suspenders: schema requires clusters[] but an empty array is
    // technically valid. Fall back to singletons so the recursive merge has
    // something to work with.
    if (clusters.length === 0) {
      return commentsAsSingletons(comments);
    }

    return clusters;
  } catch (err) {
    // Split-and-retry on failure: halve the batch and recurse. Each call has
    // its own try/catch, so we keep splitting until the model handles the
    // size or we hit a single-comment base case (which never calls the LLM).
    // No clustering data is lost — at worst, things that would have grouped
    // into one cluster end up split across two adjacent calls' results, and
    // the recursive merge at the next depth still gets a chance to unify them.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `\n[promote] cluster batch of ${comments.length} failed (${msg.slice(0, 120)}) — splitting in half and retrying.\n`,
    );
    const mid = Math.ceil(comments.length / 2);
    const [first, second] = await Promise.all([
      singlePassCluster(comments.slice(0, mid), model, costTracker, onProgress),
      singlePassCluster(comments.slice(mid), model, costTracker, onProgress),
    ]);
    return [...first, ...second];
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function generateClusterId(representative: NormalizedComment): string {
  const hash = createHash("sha256")
    .update(representative.normalizedBody)
    .digest("hex")
    .slice(0, 12);
  return `cluster_${hash}`;
}

function generateFingerprint(comment: NormalizedComment): string {
  const parts = [
    comment.normalizedBody.slice(0, 200),
    ...comment.identifiers.slice(0, 5).sort(),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}
