/**
 * Comparing two clusterings of the same comments.
 *
 * The v0.8.0 plan gates the swap from API embeddings to a local ONNX model on
 * "do both produce the same core conventions?" — judged by eye over a handful
 * of candidates. That is too coarse to act on: it cannot distinguish "slightly
 * different grouping, same conclusions" from "the similarity threshold no
 * longer fits this model's distribution". The second case is likely, because
 * `thresholds.similarityThreshold` (0.80) was tuned against OpenAI embeddings
 * and bge-family models sit on a different cosine scale entirely.
 *
 * So the gate needs numbers over the whole partition, not a look at the top of
 * the list. Both metrics here are chance-corrected or pair-based, so they stay
 * meaningful when the two runs produce different cluster counts.
 */

export type Partition = {
  /** itemId to cluster label. Labels are arbitrary; only the grouping matters. */
  assignments: Map<string, string>;
};

export function partitionFromClusters(
  clusters: ReadonlyArray<{ memberIds: readonly string[] }>,
): Partition {
  const assignments = new Map<string, string>();
  clusters.forEach((cluster, i) => {
    for (const id of cluster.memberIds) assignments.set(id, `c${i}`);
  });
  return { assignments };
}

export type PairwiseScores = {
  /** Pairs grouped together by both runs. */
  truePositives: number;
  /** Pairs the candidate groups but the reference does not (over-merging). */
  falsePositives: number;
  /** Pairs the reference groups but the candidate does not (over-splitting). */
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
};

export type ComparisonResult = {
  /** Items present in both partitions; everything else is ignored. */
  comparedItems: number;
  referenceClusters: number;
  candidateClusters: number;
  /**
   * Adjusted Rand Index: 1.0 identical, ~0 no better than chance, negative
   * worse than chance. The headline number - chance-corrected, so it is not
   * inflated by the many singleton clusters a review-comment corpus produces.
   */
  adjustedRandIndex: number;
  /**
   * Pairwise agreement, which says *how* the two runs disagree. Low precision
   * means the candidate over-merges (threshold too low for this model); low
   * recall means it over-splits (threshold too high). ARI alone cannot tell
   * these apart, and they call for opposite fixes.
   */
  pairwise: PairwiseScores;
};

const choose2 = (n: number): number => (n * (n - 1)) / 2;

/**
 * Compare a candidate clustering against a reference clustering.
 *
 * Only items appearing in both partitions are scored - a local embedder that
 * drops or adds comments is a separate bug, surfaced via `comparedItems`
 * rather than folded into the agreement score.
 */
export function comparePartitions(reference: Partition, candidate: Partition): ComparisonResult {
  const shared: string[] = [];
  for (const id of reference.assignments.keys()) {
    if (candidate.assignments.has(id)) shared.push(id);
  }
  shared.sort();

  const refLabels = new Set<string>();
  const candLabels = new Set<string>();
  const contingency = new Map<string, number>();
  const refSizes = new Map<string, number>();
  const candSizes = new Map<string, number>();

  for (const id of shared) {
    const r = reference.assignments.get(id)!;
    const c = candidate.assignments.get(id)!;
    refLabels.add(r);
    candLabels.add(c);
    // NUL separator: cluster labels are caller-supplied strings, and any
    // printable separator could appear inside one and collide two cells.
    // Written as an escape so no raw control byte lands in the source.
    const key = `${r}\u0000${c}`;
    contingency.set(key, (contingency.get(key) ?? 0) + 1);
    refSizes.set(r, (refSizes.get(r) ?? 0) + 1);
    candSizes.set(c, (candSizes.get(c) ?? 0) + 1);
  }

  const n = shared.length;

  let sumCellPairs = 0;
  for (const count of contingency.values()) sumCellPairs += choose2(count);
  let sumRefPairs = 0;
  for (const count of refSizes.values()) sumRefPairs += choose2(count);
  let sumCandPairs = 0;
  for (const count of candSizes.values()) sumCandPairs += choose2(count);

  const truePositives = sumCellPairs;
  const falsePositives = sumCandPairs - sumCellPairs;
  const falseNegatives = sumRefPairs - sumCellPairs;

  const precision =
    truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const totalPairs = choose2(n);
  let adjustedRandIndex: number;
  if (n < 2) {
    adjustedRandIndex = 1;
  } else {
    const expected = (sumRefPairs * sumCandPairs) / totalPairs;
    const max = (sumRefPairs + sumCandPairs) / 2;
    // Degenerate case: both partitions are all-singletons, or both are a
    // single cluster. They agree perfectly, but the correction term is 0/0.
    adjustedRandIndex =
      max === expected
        ? sumCellPairs === expected
          ? 1
          : 0
        : (sumCellPairs - expected) / (max - expected);
  }

  return {
    comparedItems: n,
    referenceClusters: refLabels.size,
    candidateClusters: candLabels.size,
    adjustedRandIndex,
    pairwise: { truePositives, falsePositives, falseNegatives, precision, recall, f1 },
  };
}
