import { generateObject } from "ai";
import { seedIfSupported } from "../llm/provider.js";
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

const BATCH_SIZE = 30;

export async function llmCluster(input: {
  comments: NormalizedComment[];
  model: LanguageModel;
  costTracker: CostTracker;
  onProgress?: (msg: string) => void;
}): Promise<Cluster[]> {
  const { comments, model, costTracker, onProgress } = input;

  if (comments.length === 0) return [];

  if (comments.length <= BATCH_SIZE) {
    return singlePassCluster(comments, model, costTracker, onProgress);
  }

  // Tree-reduce: cluster batches, then cluster the per-batch representatives
  onProgress?.(`Batched clustering: ${comments.length} comments in batches of ${BATCH_SIZE}...`);

  const batches = chunk(comments, BATCH_SIZE);
  const batchResults: Array<{ representative: NormalizedComment; members: NormalizedComment[] }> = [];

  for (let b = 0; b < batches.length; b++) {
    onProgress?.(`Batch ${b + 1}/${batches.length}...`);
    const batchClusters = await singlePassCluster(batches[b], model, costTracker);
    for (const cluster of batchClusters) {
      batchResults.push({ representative: cluster.representative, members: cluster.members });
    }
  }

  // Cluster the per-batch representatives
  onProgress?.(`Merging ${batchResults.length} batch representatives...`);
  const representatives = batchResults.map((r) => r.representative);
  const topClusters = await singlePassCluster(representatives, model, costTracker);

  // Reassign all original members to the top-level clusters
  return topClusters.map((topCluster) => {
    const allMembers: NormalizedComment[] = [];
    for (const topMember of topCluster.members) {
      const batchResult = batchResults.find((br) => br.representative.id === topMember.id);
      if (batchResult) {
        allMembers.push(...batchResult.members);
      } else {
        allMembers.push(topMember);
      }
    }
    return {
      ...topCluster,
      members: allMembers,
      memberEmbeddings: [],
    };
  });
}

async function singlePassCluster(
  comments: NormalizedComment[],
  model: LanguageModel,
  costTracker: CostTracker,
  onProgress?: (msg: string) => void,
): Promise<Cluster[]> {
  if (comments.length === 0) return [];

  const commentList = comments
    .map((c, i) => {
      const pathInfo = c.filePath ? ` [${c.filePath}]` : "";
      const excerpt = sanitizeUnicode(c.normalizedBody.slice(0, 200));
      return `[${i}] PR #${c.prNumber}${pathInfo}: ${excerpt}`;
    })
    .join("\n");

  onProgress?.("Clustering with LLM...");

  const { object, usage } = await generateObject({
    model,
    schema: clusterResultSchema,
    providerOptions: { openai: { strictJsonSchema: false } },
    temperature: 0,
    ...seedIfSupported(model),
    system: `You group similar AI code review comments together.
Two comments are similar if they point out the same issue, convention, or pattern — even if worded differently or in different languages.
Do NOT group comments that are about different topics just because they mention the same file.
Be conservative: only group comments that are genuinely about the same underlying point.
Every comment must appear in exactly one group. Single-comment groups are fine.`,
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

  return clusters;
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
