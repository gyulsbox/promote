import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase } from "./db.js";
import {
  upsertComments,
  upsertCandidateRecord,
  saveCluster,
  saveClusterMembers,
  listPriorClusters,
  listCandidates,
  getCandidateById,
  updateCandidateStatus,
} from "./repositories.js";
import { resolveClusterIdentities } from "../cluster/identity.js";
import type { RawReviewComment } from "../core/types.js";

const REPO = "acme/widgets";

function comment(id: string, prNumber: number): RawReviewComment {
  return {
    id,
    repo: REPO,
    prNumber,
    authorLogin: "coderabbitai[bot]",
    authorType: "Bot",
    body: `Prefer \`const\` over \`let\` here (${id})`,
    htmlUrl: `https://github.com/${REPO}/pull/${prNumber}#discussion_r${id}`,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/**
 * One scan: persist the comments, the cluster, its members, and the candidate
 * — mirroring what runScan writes, minus the LLM calls.
 */
function recordScan(
  db: ReturnType<typeof initDatabase>["db"],
  opts: { clusterRowId: string; fingerprint: string; memberIds: string[]; candidateId: string },
) {
  upsertComments(db, opts.memberIds.map((id, i) => comment(id, 100 + i)), REPO);
  saveCluster(db, opts.clusterRowId, REPO, opts.fingerprint, opts.memberIds[0], opts.memberIds.length);
  saveClusterMembers(db, opts.clusterRowId, opts.memberIds);
  upsertCandidateRecord(db, {
    id: opts.candidateId,
    repo: REPO,
    clusterId: opts.clusterRowId,
    clusterFingerprint: opts.fingerprint,
    target: "agents",
    confidence: 0.9,
    summary: "Prefer const over let",
    reason: "repeated 3x",
    status: "candidate",
  });
}

/** The step 8 decision in runScan, isolated. */
function resolve(
  db: ReturnType<typeof initDatabase>["db"],
  cluster: { fingerprint: string; memberIds: string[] },
) {
  const priors = listPriorClusters(db, REPO);
  const res = resolveClusterIdentities([{ key: "0", ...cluster }], priors).get("0")!;
  return {
    candidateId: res.prior?.candidateId ?? null,
    clusterRowId: res.prior?.clusterId ?? null,
    matchedBy: res.matchedBy,
  };
}

describe("cross-scan candidate identity (SQLite round-trip)", () => {
  let dir: string;
  let db: ReturnType<typeof initDatabase>["db"];
  let sqlite: ReturnType<typeof initDatabase>["sqlite"];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "promote-identity-"));
    ({ db, sqlite } = initDatabase(join(dir, "db.sqlite")));
  });

  afterEach(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps candidate_001 when the cluster grows and the fingerprint changes", () => {
    recordScan(db, {
      clusterRowId: "cluster_week1",
      fingerprint: "fp_week1",
      memberIds: ["c1", "c2", "c3"],
      candidateId: "candidate_001",
    });

    // Week 2: two more comments joined, the medoid moved, so hac-cluster
    // produces a different fingerprint for the same pattern.
    const resolved = resolve(db, {
      fingerprint: "fp_week2_moved_medoid",
      memberIds: ["c1", "c2", "c3", "c4", "c5"],
    });

    expect(resolved.candidateId).toBe("candidate_001");
    expect(resolved.matchedBy).toBe("overlap");
    expect(resolved.clusterRowId).toBe("cluster_week1");
  });

  it("keeps an ignored pattern suppressed after the medoid moves", () => {
    recordScan(db, {
      clusterRowId: "cluster_week1",
      fingerprint: "fp_week1",
      memberIds: ["c1", "c2", "c3"],
      candidateId: "candidate_001",
    });
    updateCandidateStatus(db, REPO, "candidate_001", "ignored", { ignoreReason: "team disagrees" });

    const resolved = resolve(db, {
      fingerprint: "fp_week2_moved_medoid",
      memberIds: ["c1", "c2", "c3", "c4"],
    });
    const record = listCandidates(db, REPO).find((r) => r.id === resolved.candidateId);

    expect(resolved.candidateId).toBe("candidate_001");
    expect(record?.status).toBe("ignored");
  });

  it("does not resurrect the old ID for an unrelated new pattern", () => {
    recordScan(db, {
      clusterRowId: "cluster_week1",
      fingerprint: "fp_week1",
      memberIds: ["c1", "c2", "c3"],
      candidateId: "candidate_001",
    });

    expect(resolve(db, { fingerprint: "fp_other", memberIds: ["z1", "z2", "z3"] }).candidateId)
      .toBeNull();
  });

  it("stays stable across six consecutive scans as the cluster accumulates", () => {
    let members = ["c1", "c2", "c3"];
    recordScan(db, {
      clusterRowId: "cluster_row",
      fingerprint: "fp_0",
      memberIds: members,
      candidateId: "candidate_001",
    });

    for (let week = 1; week <= 5; week++) {
      members = [...members, `c${members.length + 1}`, `c${members.length + 2}`];
      // Fingerprint changes every week — the medoid keeps moving.
      const resolved = resolve(db, { fingerprint: `fp_${week}`, memberIds: members });

      expect(resolved.candidateId).toBe("candidate_001");

      recordScan(db, {
        clusterRowId: resolved.clusterRowId ?? "cluster_row",
        fingerprint: `fp_${week}`,
        memberIds: members,
        candidateId: resolved.candidateId ?? "candidate_001",
      });
    }

    // One pattern, one cluster row, one candidate — no forking.
    expect(listPriorClusters(db, REPO)).toHaveLength(1);
    expect(listCandidates(db, REPO)).toHaveLength(1);
    expect(listPriorClusters(db, REPO)[0].memberIds).toHaveLength(13);
  });

  it("survives members ageing out of the scan window", () => {
    recordScan(db, {
      clusterRowId: "cluster_row",
      fingerprint: "fp_0",
      memberIds: ["c1", "c2", "c3", "c4"],
      candidateId: "candidate_001",
    });

    // c1/c2 fell outside --since; c5/c6 are new. 2 of 4 shared → containment 0.5.
    const resolved = resolve(db, { fingerprint: "fp_1", memberIds: ["c3", "c4", "c5", "c6"] });

    expect(resolved.candidateId).toBe("candidate_001");
  });

  /**
   * Both repos issue candidate_001, because IDs are numbered per repository.
   * Before the composite primary key, the second repo's upsert overwrote the
   * first repo's row outright — same ID, one global key.
   */
  function recordSecondRepo() {
    upsertComments(db, ["x1", "x2", "x3"].map((id, i) => comment(id, 200 + i)), "other/repo");
    saveCluster(db, "cluster_theirs", "other/repo", "fp_theirs", "x1", 3);
    saveClusterMembers(db, "cluster_theirs", ["x1", "x2", "x3"]);
    upsertCandidateRecord(db, {
      id: "candidate_001",
      repo: "other/repo",
      clusterId: "cluster_theirs",
      clusterFingerprint: "fp_theirs",
      target: "agents",
      confidence: 0.4,
      summary: "a completely unrelated pattern",
      reason: "n/a",
      status: "candidate",
    });
  }

  it("keeps two repos' candidate_001 rows separate", () => {
    recordScan(db, {
      clusterRowId: "cluster_ours",
      fingerprint: "fp_ours",
      memberIds: ["c1", "c2", "c3"],
      candidateId: "candidate_001",
    });
    recordSecondRepo();

    const ours = getCandidateById(db, REPO, "candidate_001");
    const theirs = getCandidateById(db, "other/repo", "candidate_001");

    expect(ours?.summary).toBe("Prefer const over let");
    expect(ours?.clusterId).toBe("cluster_ours");
    expect(theirs?.summary).toBe("a completely unrelated pattern");
    expect(theirs?.clusterId).toBe("cluster_theirs");
    expect(listCandidates(db, REPO)).toHaveLength(1);
  });

  it("ignores a candidate in one repo without touching the other's", () => {
    recordScan(db, {
      clusterRowId: "cluster_ours",
      fingerprint: "fp_ours",
      memberIds: ["c1", "c2", "c3"],
      candidateId: "candidate_001",
    });
    recordSecondRepo();

    updateCandidateStatus(db, REPO, "candidate_001", "ignored");

    expect(getCandidateById(db, REPO, "candidate_001")?.status).toBe("ignored");
    expect(getCandidateById(db, "other/repo", "candidate_001")?.status).toBe("candidate");
  });

  it("does not leak clusters or members across repos in one database", () => {
    recordScan(db, {
      clusterRowId: "cluster_ours",
      fingerprint: "fp_ours",
      memberIds: ["c1", "c2", "c3"],
      candidateId: "candidate_001",
    });
    recordSecondRepo();

    const ours = listPriorClusters(db, REPO);

    expect(ours).toHaveLength(1);
    expect(ours[0].clusterId).toBe("cluster_ours");
    expect([...ours[0].memberIds].sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("refreshes the stored member list so overlap does not decay", () => {
    recordScan(db, {
      clusterRowId: "cluster_row",
      fingerprint: "fp_0",
      memberIds: ["c1", "c2"],
      candidateId: "candidate_001",
    });
    recordScan(db, {
      clusterRowId: "cluster_row",
      fingerprint: "fp_1",
      memberIds: ["c1", "c2", "c3", "c4"],
      candidateId: "candidate_001",
    });

    const stored = listPriorClusters(db, REPO)[0];
    expect([...stored.memberIds].sort()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(stored.fingerprint).toBe("fp_1");
  });
});
