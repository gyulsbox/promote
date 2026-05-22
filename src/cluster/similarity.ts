import type { NormalizedComment } from "../core/types.js";

const WEIGHT_SEMANTIC = 0.6;
const WEIGHT_IDENTIFIER = 0.25;
const WEIGHT_PATH = 0.15;

export function computeSimilarity(
  a: NormalizedComment,
  b: NormalizedComment,
  embeddingA: number[],
  embeddingB: number[],
): number {
  const features: Array<{ w: number; sim: number }> = [];
  features.push({ w: WEIGHT_SEMANTIC, sim: cosineSimilarity(embeddingA, embeddingB) });

  if (a.identifiers.length > 0 && b.identifiers.length > 0) {
    features.push({ w: WEIGHT_IDENTIFIER, sim: jaccardSimilarity(a.identifiers, b.identifiers) });
  }

  if (a.paths.length > 0 && b.paths.length > 0) {
    features.push({ w: WEIGHT_PATH, sim: pathSimilarity(a.paths, b.paths) });
  }

  const totalW = features.reduce((s, f) => s + f.w, 0);
  return features.reduce((s, f) => s + f.w * f.sim, 0) / totalW;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;

  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function pathSimilarity(pathsA: string[], pathsB: string[]): number {
  if (pathsA.length === 0 && pathsB.length === 0) return 0;
  if (pathsA.length === 0 || pathsB.length === 0) return 0;

  // Compute max pairwise segment-level Jaccard
  let maxSim = 0;

  for (const pa of pathsA) {
    const segA = toSegments(pa);
    for (const pb of pathsB) {
      const segB = toSegments(pb);
      const sim = jaccardSimilarity(segA, segB);
      if (sim > maxSim) maxSim = sim;
    }
  }

  return maxSim;
}

function toSegments(path: string): string[] {
  return path
    .replace(/^\//, "")
    .split("/")
    .filter((s) => s.length > 0);
}
