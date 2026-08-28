import { describe, it, expect } from "vitest";
import { clusterAtThreshold, sweep, sweepAgainstBaseline, bestThreshold, DEFAULT_SWEEP } from "./sweep.js";
import { partitionFromClusters, comparePartitions } from "./partition-metrics.js";
import type { EmbeddingFixture } from "./schema.js";
import type { NormalizedComment } from "../core/types.js";

function comment(id: string): NormalizedComment {
  return {
    id,
    originalBody: `body ${id}`,
    normalizedBody: `body ${id}`,
    // Left empty so computeSimilarity uses the semantic feature alone and the
    // test controls the similarity matrix exactly.
    identifiers: [],
    paths: [],
    actionVerbs: [],
    severityMarker: { raw: null, level: "unknown" },
    language: "en",
    prNumber: 1,
    authorLogin: "coderabbitai[bot]",
    htmlUrl: `https://example.test/${id}`,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/**
 * Three well-separated groups of four. `offset` adds a shared component to
 * every vector, which lifts the whole cosine distribution without changing the
 * underlying grouping - the anisotropy that makes a threshold tuned for one
 * embedding model wrong for another.
 */
function makeFixture(offset: number): EmbeddingFixture {
  const groups = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const comments: NormalizedComment[] = [];
  const vectors: number[][] = [];

  groups.forEach((axis, g) => {
    for (let i = 0; i < 4; i++) {
      comments.push(comment(`g${g}_${i}`));
      // Tiny per-item jitter off the group axis, in two dimensions with
      // different step sizes so no two members end up parallel (parallel
      // vectors score cosine 1.0 and would merge at any threshold).
      const jitter = [...axis];
      jitter[(g + 1) % 3] += 0.02 * (i + 1);
      jitter[(g + 2) % 3] += 0.01 * ((i + 1) % 3);
      vectors.push([...jitter, offset]);
    }
  });

  return {
    fixtureVersion: 1,
    capturedAt: "2026-01-01T00:00:00Z",
    repo: "acme/widgets",
    sinceDays: 120,
    embeddingModel: `synthetic:offset-${offset}`,
    promoteVersion: "test",
    counts: { fetched: 12, aiAuthored: 12, afterNoiseFilter: 12, embedded: 12 },
    languageMix: { en: 12 },
    comments,
    vectors,
  };
}

const trueGrouping = partitionFromClusters([
  { memberIds: ["g0_0", "g0_1", "g0_2", "g0_3"] },
  { memberIds: ["g1_0", "g1_1", "g1_2", "g1_3"] },
  { memberIds: ["g2_0", "g2_1", "g2_2", "g2_3"] },
]);

describe("clusterAtThreshold", () => {
  it("merges everything at a low threshold", () => {
    const point = clusterAtThreshold(makeFixture(0), 0.0);
    expect(point.clusters).toBe(1);
    expect(point.largestCluster).toBe(12);
  });

  it("splits into singletons at a threshold above every pair", () => {
    const point = clusterAtThreshold(makeFixture(0), 0.999999);
    expect(point.clusters).toBe(12);
    expect(point.singletons).toBe(12);
  });

  it("recovers the true grouping at a fitting threshold", () => {
    const point = clusterAtThreshold(makeFixture(0), 0.5);
    const agreement = comparePartitions(trueGrouping, partitionFromClusters(point.snapshot));
    expect(point.clusters).toBe(3);
    expect(agreement.adjustedRandIndex).toBe(1);
  });

  it("counts repeated clusters against minOccurrences", () => {
    const point = clusterAtThreshold(makeFixture(0), 0.5, 5);
    expect(point.clusters).toBe(3);
    expect(point.repeatedClusters).toBe(0);
    expect(clusterAtThreshold(makeFixture(0), 0.5, 4).repeatedClusters).toBe(3);
  });

  it("is deterministic across repeated runs", () => {
    const a = clusterAtThreshold(makeFixture(0), 0.5);
    const b = clusterAtThreshold(makeFixture(0), 0.5);
    expect(JSON.stringify(a.snapshot)).toBe(JSON.stringify(b.snapshot));
  });
});

describe("sweep", () => {
  it("returns one point per threshold, in ascending order", () => {
    const points = sweep(makeFixture(0), [0.9, 0.3, 0.6]);
    expect(points.map((p) => p.threshold)).toEqual([0.3, 0.6, 0.9]);
  });

  it("never increases cluster count as the threshold falls", () => {
    const counts = sweep(makeFixture(0), DEFAULT_SWEEP).map((p) => p.clusters);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });
});

describe("sweepAgainstBaseline (the Phase 1 gate)", () => {
  it("finds a threshold where a differently-scaled model reproduces the baseline", () => {
    // Baseline: the current API-style embedding at its tuned threshold.
    const baseline = clusterAtThreshold(makeFixture(0), 0.5);
    expect(baseline.clusters).toBe(3);

    // Candidate: a model whose cosines all sit much higher - every cross-group
    // pair now scores ~0.8, so the baseline's 0.5 would merge everything.
    const candidate = makeFixture(2);
    expect(clusterAtThreshold(candidate, 0.5).clusters).toBe(1);

    const best = bestThreshold(sweepAgainstBaseline(candidate, baseline, DEFAULT_SWEEP));

    expect(best).not.toBeNull();
    expect(best!.agreement.adjustedRandIndex).toBe(1);
    expect(best!.clusters).toBe(3);
    // The fitting threshold moved well above the baseline's.
    expect(best!.threshold).toBeGreaterThan(0.5);
  });

  it("reports over-merging as low precision at the wrong threshold", () => {
    const baseline = clusterAtThreshold(makeFixture(0), 0.5);
    const comparisons = sweepAgainstBaseline(makeFixture(2), baseline, [0.5]);

    expect(comparisons[0].agreement.pairwise.precision).toBeLessThan(1);
    expect(comparisons[0].agreement.pairwise.recall).toBe(1);
  });

  it("scores a same-scale model as a perfect match at the same threshold", () => {
    const baseline = clusterAtThreshold(makeFixture(0), 0.5);
    const comparisons = sweepAgainstBaseline(makeFixture(0), baseline, [0.5]);

    expect(comparisons[0].agreement.adjustedRandIndex).toBe(1);
  });

  it("breaks ties toward the lower threshold", () => {
    const baseline = clusterAtThreshold(makeFixture(0), 0.5);
    const comparisons = sweepAgainstBaseline(makeFixture(0), baseline, [0.5, 0.55, 0.6]);
    const perfect = comparisons.filter((c) => c.agreement.adjustedRandIndex === 1);

    expect(perfect.length).toBeGreaterThan(1);
    expect(bestThreshold(comparisons)!.threshold).toBe(perfect[0].threshold);
  });

  it("returns null for an empty sweep", () => {
    expect(bestThreshold([])).toBeNull();
  });
});
