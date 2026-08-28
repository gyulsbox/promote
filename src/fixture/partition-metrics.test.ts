import { describe, it, expect } from "vitest";
import { comparePartitions, partitionFromClusters } from "./partition-metrics.js";

const P = (...groups: string[][]) => partitionFromClusters(groups.map((memberIds) => ({ memberIds })));

describe("comparePartitions", () => {
  it("scores identical partitions as perfect agreement", () => {
    const a = P(["c1", "c2"], ["c3", "c4"], ["c5"]);
    const r = comparePartitions(a, P(["c1", "c2"], ["c3", "c4"], ["c5"]));

    expect(r.adjustedRandIndex).toBe(1);
    expect(r.pairwise.f1).toBe(1);
    expect(r.referenceClusters).toBe(3);
    expect(r.candidateClusters).toBe(3);
  });

  it("is invariant to cluster label naming and ordering", () => {
    const reference = P(["c1", "c2"], ["c3", "c4"]);
    const relabelled = P(["c3", "c4"], ["c2", "c1"]);

    expect(comparePartitions(reference, relabelled).adjustedRandIndex).toBe(1);
  });

  it("flags over-merging as low precision", () => {
    // Reference keeps two conventions apart; the candidate merges them, which
    // is what happens when the similarity threshold is too low for the model.
    const reference = P(["c1", "c2"], ["c3", "c4"]);
    const merged = P(["c1", "c2", "c3", "c4"]);

    const r = comparePartitions(reference, merged);

    expect(r.pairwise.recall).toBe(1);
    expect(r.pairwise.precision).toBeLessThan(1);
    expect(r.pairwise.falsePositives).toBeGreaterThan(0);
    expect(r.pairwise.falseNegatives).toBe(0);
    expect(r.adjustedRandIndex).toBeLessThan(1);
  });

  it("flags over-splitting as low recall", () => {
    const reference = P(["c1", "c2", "c3", "c4"]);
    const split = P(["c1", "c2"], ["c3", "c4"]);

    const r = comparePartitions(reference, split);

    expect(r.pairwise.precision).toBe(1);
    expect(r.pairwise.recall).toBeLessThan(1);
    expect(r.pairwise.falseNegatives).toBeGreaterThan(0);
    expect(r.pairwise.falsePositives).toBe(0);
  });

  it("distinguishes over-merging from over-splitting when ARI is similar", () => {
    // The reason pairwise scores are reported alongside ARI: these two
    // failures need opposite threshold moves.
    const reference = P(["c1", "c2"], ["c3", "c4"]);
    const merged = comparePartitions(reference, P(["c1", "c2", "c3", "c4"]));
    const split = comparePartitions(P(["c1", "c2", "c3", "c4"]), P(["c1", "c2"], ["c3", "c4"]));

    expect(merged.pairwise.precision).toBeLessThan(merged.pairwise.recall);
    expect(split.pairwise.recall).toBeLessThan(split.pairwise.precision);
  });

  it("gives a chance-level partition an ARI near zero", () => {
    const reference = P(["a1", "a2", "a3"], ["b1", "b2", "b3"], ["d1", "d2", "d3"]);
    // Every candidate cluster draws one member from each reference cluster.
    const scrambled = P(["a1", "b1", "d1"], ["a2", "b2", "d2"], ["a3", "b3", "d3"]);

    const r = comparePartitions(reference, scrambled);

    expect(r.adjustedRandIndex).toBeLessThan(0.1);
    expect(r.adjustedRandIndex).toBeGreaterThan(-0.5);
  });

  it("returns ARI 1 when both partitions are all singletons", () => {
    const singletons = P(["c1"], ["c2"], ["c3"]);

    const r = comparePartitions(singletons, P(["c1"], ["c2"], ["c3"]));

    expect(r.adjustedRandIndex).toBe(1);
    expect(r.pairwise.f1).toBe(1);
  });

  it("scores all-singletons against one-big-cluster as no agreement", () => {
    const r = comparePartitions(P(["c1"], ["c2"], ["c3"]), P(["c1", "c2", "c3"]));

    expect(r.adjustedRandIndex).toBe(0);
    expect(r.pairwise.truePositives).toBe(0);
  });

  it("compares only items present in both partitions", () => {
    const reference = P(["c1", "c2"], ["c3", "c4"]);
    // The candidate embedder dropped c4 and invented z9.
    const candidate = P(["c1", "c2"], ["c3"], ["z9"]);

    const r = comparePartitions(reference, candidate);

    expect(r.comparedItems).toBe(3);
  });

  it("handles empty partitions without dividing by zero", () => {
    const r = comparePartitions(P(), P());

    expect(r.comparedItems).toBe(0);
    expect(Number.isFinite(r.adjustedRandIndex)).toBe(true);
    expect(Number.isFinite(r.pairwise.f1)).toBe(true);
  });

  it("matches a known ARI value", () => {
    // reference {1,2,3},{4,5},{6} vs candidate {1,2},{3,4,5},{6}.
    // Contingency overlaps are 2 ({1,2}) and 2 ({4,5}), so
    //   sum C(n_ij,2) = 1 + 1               = 2
    //   sum C(a_i,2)  = C(3,2) + C(2,2)     = 4
    //   sum C(b_j,2)  = C(2,2) + C(3,2)     = 4
    //   expected      = 4 * 4 / C(6,2)      = 16/15
    //   max           = (4 + 4) / 2         = 4
    //   ARI = (2 - 16/15) / (4 - 16/15) = 7/22 = 0.3181...
    const reference = P(["1", "2", "3"], ["4", "5"], ["6"]);
    const candidate = P(["1", "2"], ["3", "4", "5"], ["6"]);

    expect(comparePartitions(reference, candidate).adjustedRandIndex).toBeCloseTo(7 / 22, 10);
  });
});
