import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const detectLocalRepo = vi.hoisted(() => vi.fn<() => string | null>());
vi.mock("../core/local-repo.js", () => ({ detectLocalRepo }));

const { initDatabase } = await import("../storage/db.js");
const { saveCluster, upsertCandidateRecord, upsertComments } = await import(
  "../storage/repositories.js"
);
const { resolveCandidateScope } = await import("./resolve-candidate.js");

describe("resolveCandidateScope", () => {
  let dir: string;
  let db: ReturnType<typeof initDatabase>["db"];
  let sqlite: ReturnType<typeof initDatabase>["sqlite"];

  function seed(repo: string, candidateId: string) {
    const clusterId = `cluster_${repo.replace("/", "_")}`;
    const commentId = `comment_${repo.replace("/", "_")}`;
    // clusters.representative_comment_id is a foreign key into review_comments.
    upsertComments(
      db,
      [
        {
          id: commentId,
          repo,
          prNumber: 1,
          authorLogin: "coderabbitai[bot]",
          authorType: "Bot",
          body: "Prefer const over let",
          htmlUrl: `https://github.com/${repo}/pull/1`,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      repo,
    );
    saveCluster(db, clusterId, repo, `fp_${repo}`, commentId, 2);
    upsertCandidateRecord(db, {
      id: candidateId,
      repo,
      clusterId,
      target: "agents",
      confidence: 0.9,
      summary: `pattern in ${repo}`,
      reason: "repeated",
      status: "candidate",
    });
  }

  beforeEach(() => {
    detectLocalRepo.mockReset();
    detectLocalRepo.mockReturnValue(null);
    dir = mkdtempSync(join(tmpdir(), "promote-scope-"));
    ({ db, sqlite } = initDatabase(join(dir, "db.sqlite")));
  });

  afterEach(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves without consulting git when only one repo has the ID", () => {
    seed("acme/widgets", "candidate_001");

    const scope = resolveCandidateScope(db, "candidate_001");

    expect(scope).toEqual({ ok: true, repo: "acme/widgets" });
    expect(detectLocalRepo).not.toHaveBeenCalled();
  });

  it("reports an unknown ID as not found", () => {
    const scope = resolveCandidateScope(db, "candidate_404");

    expect(scope.ok).toBe(false);
    if (!scope.ok) expect(scope.error).toMatch(/not found/i);
  });

  it("picks the current checkout when the ID is ambiguous", () => {
    seed("acme/widgets", "candidate_001");
    seed("other/repo", "candidate_001");
    detectLocalRepo.mockReturnValue("other/repo");

    expect(resolveCandidateScope(db, "candidate_001")).toEqual({ ok: true, repo: "other/repo" });
  });

  it("refuses to guess when the ID is ambiguous and there is no checkout", () => {
    seed("acme/widgets", "candidate_001");
    seed("other/repo", "candidate_001");

    const scope = resolveCandidateScope(db, "candidate_001");

    expect(scope.ok).toBe(false);
    if (!scope.ok) {
      expect(scope.error).toContain("acme/widgets");
      expect(scope.error).toContain("other/repo");
    }
  });

  it("refuses when the checkout is unrelated to any of the candidates", () => {
    seed("acme/widgets", "candidate_001");
    seed("other/repo", "candidate_001");
    detectLocalRepo.mockReturnValue("third/place");

    const scope = resolveCandidateScope(db, "candidate_001");

    expect(scope.ok).toBe(false);
    if (!scope.ok) expect(scope.hint).toContain("third/place");
  });
});
