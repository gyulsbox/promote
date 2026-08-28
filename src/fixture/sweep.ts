import { hacCluster } from "../cluster/hac-cluster.js";
import { greedyCluster } from "../cluster/greedy-cluster.js";
import type { EmbeddingFixture, SweepPoint, ClusterSnapshot } from "./schema.js";
import { partitionFromClusters, comparePartitions, type ComparisonResult } from "./partition-metrics.js";

/**
 * Re-cluster a captured fixture at a given similarity threshold.
 *
 * No network, no LLM: `llmRefine` is deliberately excluded. That call is the
 * remaining non-deterministic step in the "deterministic" embedding path, and
 * separating it is the point - the sweep answers "what does the threshold
 * alone do?", which is the question that decides whether the refine step is
 * still needed once the threshold fits the model.
 */
export function clusterAtThreshold(
  fixture: EmbeddingFixture,
  threshold: number,
  minOccurrences = 2,
): SweepPoint {
  const { comments, vectors } = fixture;
  const clusters =
    comments.length <= 500
      ? hacCluster(comments, vectors, threshold)
      : greedyCluster(comments, vectors, threshold);

  const snapshot: ClusterSnapshot[] = clusters
    .map((c) => ({
      fingerprint: c.fingerprint,
      representativeId: c.representative.id,
      memberIds: c.members.map((m) => m.id).sort(),
    }))
    // Deterministic ordering so two sweeps of the same fixture diff cleanly.
    .sort((a, b) => b.memberIds.length - a.memberIds.length || a.fingerprint.localeCompare(b.fingerprint));

  const sizes = snapshot.map((c) => c.memberIds.length);

  return {
    threshold,
    clusters: snapshot.length,
    repeatedClusters: sizes.filter((n) => n >= minOccurrences).length,
    largestCluster: sizes.length > 0 ? Math.max(...sizes) : 0,
    singletons: sizes.filter((n) => n === 1).length,
    snapshot,
  };
}

export function sweep(
  fixture: EmbeddingFixture,
  thresholds: number[],
  minOccurrences = 2,
): SweepPoint[] {
  return [...thresholds]
    .sort((a, b) => a - b)
    .map((t) => clusterAtThreshold(fixture, t, minOccurrences));
}

export type SweepComparison = SweepPoint & { agreement: ComparisonResult };

/**
 * Sweep a candidate fixture (e.g. local ONNX vectors) against a fixed
 * reference clustering (e.g. the API-embedding baseline at its tuned
 * threshold), so the best-matching threshold for the new model is visible
 * rather than assumed to be the old one.
 */
export function sweepAgainstBaseline(
  candidate: EmbeddingFixture,
  baseline: SweepPoint,
  thresholds: number[],
  minOccurrences = 2,
): SweepComparison[] {
  const reference = partitionFromClusters(baseline.snapshot);
  return sweep(candidate, thresholds, minOccurrences).map((point) => ({
    ...point,
    agreement: comparePartitions(reference, partitionFromClusters(point.snapshot)),
  }));
}

/** The threshold whose clustering agrees most with the baseline. */
export function bestThreshold(comparisons: SweepComparison[]): SweepComparison | null {
  if (comparisons.length === 0) return null;
  return [...comparisons].sort(
    (a, b) =>
      b.agreement.adjustedRandIndex - a.agreement.adjustedRandIndex || a.threshold - b.threshold,
  )[0];
}

export const DEFAULT_SWEEP = Array.from({ length: 26 }, (_, i) =>
  Number((0.5 + i * 0.02).toFixed(2)),
);
