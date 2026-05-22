import { embedMany } from "ai";
import type { LanguageModel, EmbeddingModel } from "ai";
import type { NormalizedComment, Cluster } from "../core/types.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { greedyCluster } from "./greedy-cluster.js";
import { hacCluster } from "./hac-cluster.js";
import { llmCluster } from "./llm-cluster.js";
import { llmRefine } from "./llm-refine.js";

function l2norm(v: number[]): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

export type PreClusterInput = {
  comments: NormalizedComment[];
  embeddingModel: EmbeddingModel | null;
  classificationModel: LanguageModel;
  clusteringModel: LanguageModel;
  /** "embedding" or "llm-direct"; forces LLM-direct even when embedding model is present */
  clusteringStrategy?: "embedding" | "llm-direct";
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
  const { comments, embeddingModel, clusteringModel, clusteringStrategy, costTracker, onProgress } = input;

  if (comments.length === 0) {
    return { clusters: [], allClusters: 0, mode: "embedding" };
  }

  // LLM-direct path: either no embedding API available (Anthropic), or the
  // user explicitly opted into semantic clustering via clusteringStrategy.
  const useLlmDirect = clusteringStrategy === "llm-direct" || !embeddingModel;
  if (useLlmDirect) {
    onProgress?.(
      embeddingModel
        ? "Using LLM clustering (forced via clusteringStrategy=llm-direct)..."
        : "Using LLM clustering (no embedding API)...",
    );
    // Sort by body length descending for deterministic, information-rich ordering
    const sortedComments = [...comments].sort(
      (a, b) => b.normalizedBody.length - a.normalizedBody.length,
    );
    const clusters = await llmCluster({
      comments: sortedComments,
      model: clusteringModel,
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
  let clusters =
    sortedComments.length <= 500
      ? hacCluster(sortedComments, sortedEmbeddings, input.similarityThreshold)
      : greedyCluster(sortedComments, sortedEmbeddings, input.similarityThreshold);

  // LLMEdgeRefine (EMNLP 2024): merge borderline pairs whose similarity sits in
  // [threshold - margin, threshold) via LLM yes/no. margin 0.15 is wide because
  // bot-stripped review comments often score well below 0.80 even when semantically
  // identical; the LLM judges the actually-borderline merges.
  if (clusters.length >= 2 && sortedComments.length <= 500) {
    onProgress?.("Refining borderline clusters...");
    clusters = await llmRefine({
      clusters,
      threshold: input.similarityThreshold,
      margin: 0.15,
      model: clusteringModel,
      costTracker,
    });
  }

  return { clusters, allClusters: clusters.length, mode: "embedding" };
}
