import { createHash } from "node:crypto";
import type { NormalizedComment, Cluster } from "../core/types.js";
import { computeSimilarity } from "./similarity.js";

export function greedyCluster(
  comments: NormalizedComment[],
  embeddings: number[][],
  threshold: number,
): Cluster[] {
  const clusters: Cluster[] = [];

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    const embedding = embeddings[i];

    let bestCluster: Cluster | null = null;
    let bestSimilarity = 0;

    for (const cluster of clusters) {
      const sim = computeSimilarity(
        comment,
        cluster.representative,
        embedding,
        cluster.representativeEmbedding,
      );

      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestSimilarity >= threshold) {
      bestCluster.members.push(comment);
      bestCluster.memberEmbeddings.push(embedding);
    } else {
      clusters.push({
        id: generateClusterId(comment),
        representative: comment,
        representativeEmbedding: embedding,
        members: [comment],
        memberEmbeddings: [embedding],
        fingerprint: generateFingerprint(comment),
      });
    }
  }

  return clusters;
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
