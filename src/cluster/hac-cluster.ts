import { createHash } from "node:crypto";
import type { NormalizedComment, Cluster } from "../core/types.js";
import { computeSimilarity } from "./similarity.js";

export function hacCluster(
  comments: NormalizedComment[],
  embeddings: number[][],
  threshold: number,
): Cluster[] {
  const n = comments.length;
  if (n === 0) return [];
  if (n === 1) {
    return [makeSingletonCluster(comments[0], embeddings[0])];
  }

  // Precompute pairwise similarity matrix (upper triangle)
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = computeSimilarity(comments[i], comments[j], embeddings[i], embeddings[j]);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }

  // Active clusters: each starts as its own singleton (indices into comments array)
  const active: number[][] = comments.map((_, i) => [i]);

  // Average-linkage HAC: merge closest pair until no pair exceeds threshold
  while (active.length > 1) {
    let bestSim = -1;
    let bestI = -1;
    let bestJ = -1;

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const avgSim = averageLinkage(active[i], active[j], sim);
        if (avgSim > bestSim) {
          bestSim = avgSim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim < threshold) break;

    // Merge bestJ into bestI
    active[bestI] = [...active[bestI], ...active[bestJ]];
    active.splice(bestJ, 1);
  }

  return active.map((indices) => buildCluster(indices, comments, embeddings, sim));
}

function averageLinkage(groupA: number[], groupB: number[], sim: number[][]): number {
  let total = 0;
  for (const i of groupA) {
    for (const j of groupB) {
      total += sim[i][j];
    }
  }
  return total / (groupA.length * groupB.length);
}

function buildCluster(
  indices: number[],
  comments: NormalizedComment[],
  embeddings: number[][],
  sim: number[][],
): Cluster {
  const members = indices.map((i) => comments[i]);
  const memberEmbeddings = indices.map((i) => embeddings[i]);

  // Find medoid: member with highest average similarity to all others
  let medoidPos = 0;
  let bestAvg = -1;
  for (let a = 0; a < indices.length; a++) {
    let total = 0;
    for (let b = 0; b < indices.length; b++) {
      if (a !== b) total += sim[indices[a]][indices[b]];
    }
    const avg = indices.length > 1 ? total / (indices.length - 1) : 1;
    if (avg > bestAvg) {
      bestAvg = avg;
      medoidPos = a;
    }
  }

  const representative = members[medoidPos];
  return {
    id: generateClusterId(representative),
    representative,
    representativeEmbedding: memberEmbeddings[medoidPos],
    members,
    memberEmbeddings,
    fingerprint: generateFingerprint(representative),
  };
}

function makeSingletonCluster(comment: NormalizedComment, embedding: number[]): Cluster {
  return {
    id: generateClusterId(comment),
    representative: comment,
    representativeEmbedding: embedding,
    members: [comment],
    memberEmbeddings: [embedding],
    fingerprint: generateFingerprint(comment),
  };
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
