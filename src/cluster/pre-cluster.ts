import { embedMany } from "ai";
import type { LanguageModel, EmbeddingModel } from "ai";
import type { NormalizedComment, Cluster } from "../core/types.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { greedyCluster } from "./greedy-cluster.js";
import { hacCluster } from "./hac-cluster.js";
import { llmCluster } from "./llm-cluster.js";

function l2norm(v: number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

export type PreClusterInput = {
  comments: NormalizedComment[];
  embeddingModel: EmbeddingModel | null;
  classificationModel: LanguageModel;
  similarityThreshold: number;
  costTracker: CostTracker;
  onProgress?: (msg: string) => void;
};

export type PreClusterOutput = {
  clusters: Cluster[];
  allClusters: number;
  mode: "embedding" | "llm";
};

export async function preCluster(input: PreClusterInput): Promise<PreClusterOutput> {
  const { comments, embeddingModel, classificationModel, costTracker, onProgress } = input;

  if (comments.length === 0) {
    return { clusters: [], allClusters: 0, mode: "embedding" };
  }

  // If no embedding model (e.g. Anthropic), use LLM direct clustering
  if (!embeddingModel) {
    onProgress?.("Using LLM clustering (no embedding API)...");
    // Sort by body length descending for deterministic, information-rich ordering
    const sortedComments = [...comments].sort(
      (a, b) => b.normalizedBody.length - a.normalizedBody.length,
    );
    const clusters = await llmCluster({
      comments: sortedComments,
      model: classificationModel,
      costTracker,
      onProgress,
    });
    return { clusters, allClusters: clusters.length, mode: "llm" };
  }

  // Embedding-based clustering (Step A)
  onProgress?.("Generating embeddings...");

  const batchSize = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < comments.length; i += batchSize) {
    const batch = comments.slice(i, i + batchSize);
    const texts = batch.map((c) => c.normalizedBody);

    const result = await embedMany({
      model: embeddingModel,
      values: texts,
    });

    allEmbeddings.push(...result.embeddings);

    costTracker.record("embedding", {
      promptTokens: result.usage?.tokens ?? texts.join("").length / 4,
    });

    onProgress?.(`Embedded ${Math.min(i + batchSize, comments.length)}/${comments.length}`);
  }

  // Sort by L2 norm descending (most information-rich embedding first, deterministic)
  const paired = comments.map((c, i) => ({ c, e: allEmbeddings[i] }));
  paired.sort((a, b) => l2norm(b.e) - l2norm(a.e));
  const sortedComments = paired.map((p) => p.c);
  const sortedEmbeddings = paired.map((p) => p.e);

  onProgress?.("Clustering...");
  // HAC for N ≤ 500 (O(N²) is acceptable); greedy fallback for larger inputs
  const clusters =
    sortedComments.length <= 500
      ? hacCluster(sortedComments, sortedEmbeddings, input.similarityThreshold)
      : greedyCluster(sortedComments, sortedEmbeddings, input.similarityThreshold);

  return { clusters, allClusters: clusters.length, mode: "embedding" };
}
