import { describe, it, expect } from "vitest";
import {
  containment,
  resolveClusterIdentities,
  type PriorCluster,
  type ClusterIdentityInput,
} from "./identity.js";

function prior(
  candidateId: string,
  memberIds: string[],
  overrides: Partial<PriorCluster> = {},
): PriorCluster {
  return {
    clusterId: `cluster_${candidateId}`,
    candidateId,
    status: "candidate",
    fingerprint: `fp_${candidateId}`,
    memberIds,
    ...overrides,
  };
}

describe("containment", () => {
  it("is 1.0 when the smaller set is fully contained in the larger", () => {
    expect(containment(["a", "b"], ["a", "b", "c", "d"])).toBe(1);
  });

  it("is symmetric", () => {
    expect(containment(["a", "b"], ["a", "b", "c", "d"])).toBe(
      containment(["a", "b", "c", "d"], ["a", "b"]),
    );
  });

  it("is 0 when either side is empty", () => {
    expect(containment([], ["a"])).toBe(0);
    expect(containment(["a"], [])).toBe(0);
  });

  it("ignores duplicate ids on either side", () => {
    expect(containment(["a", "a", "b"], ["a", "b", "b"])).toBe(1);
  });

  it("does not collapse on growth the way Jaccard would", () => {
    const week1 = ["c1", "c2", "c3"];
    const week6 = Array.from({ length: 30 }, (_, i) => `c${i + 1}`);
    // Jaccard here would be 3/30 = 0.1 — below any sane threshold.
    expect(containment(week1, week6)).toBe(1);
  });
});

describe("resolveClusterIdentities", () => {
  it("keeps the candidate ID when a cluster grows and the medoid moves", () => {
    // The v0.7 regression: same pattern, two more comments, different medoid,
    // therefore a different fingerprint.
    const priors = [prior("candidate_001", ["c1", "c2", "c3"], { fingerprint: "fp_old" })];
    const clusters: ClusterIdentityInput[] = [
      { key: "k0", fingerprint: "fp_new_medoid", memberIds: ["c1", "c2", "c3", "c4", "c5"] },
    ];

    const resolved = resolveClusterIdentities(clusters, priors);

    expect(resolved.get("k0")?.prior?.candidateId).toBe("candidate_001");
    expect(resolved.get("k0")?.matchedBy).toBe("overlap");
  });

  it("prefers an exact fingerprint match over overlap", () => {
    const exact = prior("candidate_001", ["c1"], { fingerprint: "fp_same" });
    const overlapping = prior("candidate_002", ["c1", "c2", "c3"]);
    const clusters: ClusterIdentityInput[] = [
      { key: "k0", fingerprint: "fp_same", memberIds: ["c1", "c2", "c3"] },
    ];

    const resolved = resolveClusterIdentities(clusters, [overlapping, exact]);

    expect(resolved.get("k0")?.prior?.candidateId).toBe("candidate_001");
    expect(resolved.get("k0")?.matchedBy).toBe("fingerprint");
  });

  it("returns no prior for a genuinely new cluster", () => {
    const priors = [prior("candidate_001", ["c1", "c2", "c3"])];
    const clusters: ClusterIdentityInput[] = [
      { key: "k0", fingerprint: "fp_brand_new", memberIds: ["z1", "z2"] },
    ];

    const resolved = resolveClusterIdentities(clusters, priors);

    expect(resolved.get("k0")?.prior).toBeNull();
    expect(resolved.get("k0")?.matchedBy).toBeNull();
  });

  it("does not match below the overlap floor", () => {
    const priors = [prior("candidate_001", ["c1", "c2", "c3", "c4"])];
    const clusters: ClusterIdentityInput[] = [
      // 1 of 3 shared → containment 0.33, under the 0.5 default.
      { key: "k0", fingerprint: "fp_x", memberIds: ["c1", "z1", "z2"] },
    ];

    expect(resolveClusterIdentities(clusters, priors).get("k0")?.prior).toBeNull();
  });

  it("gives a split cluster's ID to exactly one side", () => {
    const priors = [prior("candidate_001", ["c1", "c2", "c3", "c4"])];
    const clusters: ClusterIdentityInput[] = [
      { key: "kA", fingerprint: "fp_a", memberIds: ["c1", "c2"] },
      { key: "kB", fingerprint: "fp_b", memberIds: ["c3", "c4"] },
    ];

    const resolved = resolveClusterIdentities(clusters, priors);
    const inherited = [resolved.get("kA")!, resolved.get("kB")!].filter((r) => r.prior);

    expect(inherited).toHaveLength(1);
    expect(inherited[0].prior?.candidateId).toBe("candidate_001");
  });

  it("never hands one prior to two clusters", () => {
    const priors = [prior("candidate_001", ["c1", "c2"])];
    const clusters: ClusterIdentityInput[] = [
      { key: "kA", fingerprint: "fp_a", memberIds: ["c1", "c2", "c3"] },
      { key: "kB", fingerprint: "fp_b", memberIds: ["c1", "c2", "c9"] },
    ];

    const resolved = resolveClusterIdentities(clusters, priors);
    const claimed = [...resolved.values()].filter((r) => r.prior).length;

    expect(claimed).toBe(1);
  });

  it("is invariant to input ordering", () => {
    const priors = [
      prior("candidate_001", ["c1", "c2", "c3"]),
      prior("candidate_002", ["d1", "d2", "d3"]),
      prior("candidate_003", ["e1", "e2", "e3"]),
    ];
    const clusters: ClusterIdentityInput[] = [
      { key: "kA", fingerprint: "fp_a", memberIds: ["c1", "c2", "c3", "c4"] },
      { key: "kB", fingerprint: "fp_b", memberIds: ["d1", "d2", "d3", "d4"] },
      { key: "kC", fingerprint: "fp_c", memberIds: ["e1", "e2", "e3", "e4"] },
    ];

    const forward = resolveClusterIdentities(clusters, priors);
    const reversed = resolveClusterIdentities([...clusters].reverse(), [...priors].reverse());

    for (const key of ["kA", "kB", "kC"]) {
      expect(reversed.get(key)?.prior?.candidateId).toBe(forward.get(key)?.prior?.candidateId);
    }
    expect(forward.get("kA")?.prior?.candidateId).toBe("candidate_001");
    expect(forward.get("kB")?.prior?.candidateId).toBe("candidate_002");
    expect(forward.get("kC")?.prior?.candidateId).toBe("candidate_003");
  });

  it("resolves ties deterministically when overlap is equal", () => {
    const priors = [
      prior("candidate_002", ["c1", "c2"]),
      prior("candidate_001", ["c1", "c2"]),
    ];
    const clusters: ClusterIdentityInput[] = [
      { key: "k0", fingerprint: "fp_x", memberIds: ["c1", "c2"] },
    ];

    // Lowest candidate ID wins, regardless of prior ordering.
    expect(resolveClusterIdentities(clusters, priors).get("k0")?.prior?.candidateId).toBe(
      "candidate_001",
    );
    expect(
      resolveClusterIdentities(clusters, [...priors].reverse()).get("k0")?.prior?.candidateId,
    ).toBe("candidate_001");
  });

  it("carries prior status through so promoted/ignored clusters stay suppressed", () => {
    const priors = [
      prior("candidate_001", ["c1", "c2", "c3"], { status: "ignored", fingerprint: "fp_old" }),
    ];
    const clusters: ClusterIdentityInput[] = [
      { key: "k0", fingerprint: "fp_moved", memberIds: ["c1", "c2", "c3", "c4"] },
    ];

    expect(resolveClusterIdentities(clusters, priors).get("k0")?.prior?.status).toBe("ignored");
  });

  it("returns an entry for every input cluster", () => {
    const clusters: ClusterIdentityInput[] = [
      { key: "kA", fingerprint: "fp_a", memberIds: ["c1"] },
      { key: "kB", fingerprint: "fp_b", memberIds: ["c2"] },
    ];
    const resolved = resolveClusterIdentities(clusters, []);
    expect(resolved.size).toBe(2);
    expect([...resolved.values()].every((r) => r.prior === null)).toBe(true);
  });
});
