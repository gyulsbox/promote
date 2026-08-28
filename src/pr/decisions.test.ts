import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Octokit } from "octokit";
import { parseDecisions, findPromotePrs, applyPrDecisions } from "./decisions.js";
import { buildBundledPrBody } from "./template.js";
import { initDatabase } from "../storage/db.js";
import {
  upsertComments,
  saveCluster,
  upsertCandidateRecord,
  getCandidateById,
} from "../storage/repositories.js";
import type { PromotionCandidate, RepoRef } from "../core/types.js";

const REPO: RepoRef = { owner: "acme", name: "widgets", fullName: "acme/widgets" };

const candidate = (id: string, summary: string): PromotionCandidate & { targetFile: string } => ({
  id,
  repo: REPO.fullName,
  clusterId: `cluster_${id}`,
  summary,
  target: "agents",
  confidence: 0.9,
  reasoning: "repeated across PRs",
  alternatives: [],
  occurrences: [
    { prNumber: 1, url: "https://example.test/1", excerpt: "", authorLogin: "bot", createdAt: "2026-05-01" },
  ],
  draft: { targetFile: "AGENTS.md", content: "", insertionHint: "" },
  status: "candidate",
  targetFile: "AGENTS.md",
});

const bodyFor = (ids: Array<[string, string]>) =>
  buildBundledPrBody({
    candidates: ids.map(([id, summary]) => candidate(id, summary)),
    sinceDays: 60,
    date: new Date("2026-05-22T09:00:00Z"),
  });

/** Flips a rendered decision line from checked to unchecked. */
const uncheck = (body: string, id: string) =>
  body.replace(new RegExp(`^- \\[x\\] \`${id}\``, "m"), `- [ ] \`${id}\``);

describe("parseDecisions", () => {
  it("round-trips a body it rendered itself", () => {
    const decisions = parseDecisions(bodyFor([["candidate_001", "A"], ["candidate_002", "B"]]));

    expect(decisions).toEqual([
      { candidateId: "candidate_001", accepted: true },
      { candidateId: "candidate_002", accepted: true },
    ]);
  });

  it("reads an unchecked box as a rejection", () => {
    const body = uncheck(bodyFor([["candidate_001", "A"], ["candidate_002", "B"]]), "candidate_002");

    expect(parseDecisions(body)).toEqual([
      { candidateId: "candidate_001", accepted: true },
      { candidateId: "candidate_002", accepted: false },
    ]);
  });

  it("accepts an uppercase X", () => {
    expect(parseDecisions("## Candidates\n\n- [X] `candidate_001` — A")).toEqual([
      { candidateId: "candidate_001", accepted: true },
    ]);
  });

  it("accepts an asterisk bullet", () => {
    expect(parseDecisions("## Candidates\n\n* [ ] `candidate_009` — A")).toEqual([
      { candidateId: "candidate_009", accepted: false },
    ]);
  });

  it("returns nothing when the section is absent", () => {
    expect(parseDecisions("## Summary\n\n- [ ] `candidate_001` — A")).toEqual([]);
  });

  it("returns nothing for an empty body", () => {
    expect(parseDecisions("")).toEqual([]);
  });

  it("stops at the next section heading", () => {
    const body = [
      "## Candidates",
      "",
      "- [ ] `candidate_001` — A",
      "",
      "## Evidence",
      "",
      "- [ ] `candidate_002` — should not be read",
    ].join("\n");

    expect(parseDecisions(body).map((d) => d.candidateId)).toEqual(["candidate_001"]);
  });

  it("ignores a template's own checklist above the section", () => {
    const body = buildBundledPrBody({
      candidates: [candidate("candidate_001", "A")],
      sinceDays: 60,
      date: new Date("2026-05-22T09:00:00Z"),
      prefilledHeader: "## Checklist\n\n- [ ] reviewed manually\n- [ ] CODEOWNERS approved",
    });

    expect(parseDecisions(body)).toEqual([{ candidateId: "candidate_001", accepted: true }]);
  });

  it("keeps the first entry when an ID is duplicated", () => {
    const body = "## Candidates\n\n- [ ] `candidate_001` — A\n- [x] `candidate_001` — A again";

    expect(parseDecisions(body)).toEqual([{ candidateId: "candidate_001", accepted: false }]);
  });

  it("ignores lines that are not decision lines", () => {
    const body = [
      "## Candidates",
      "",
      "- [x] `candidate_001` — A",
      "Uncheck anything that should not land.",
      "- [ ] not a candidate id",
      "- [ ] `cluster_abc` — wrong prefix",
    ].join("\n");

    expect(parseDecisions(body).map((d) => d.candidateId)).toEqual(["candidate_001"]);
  });

  it("tolerates CRLF line endings", () => {
    const body = "## Candidates\r\n\r\n- [ ] `candidate_001` — A\r\n";

    expect(parseDecisions(body)).toEqual([{ candidateId: "candidate_001", accepted: false }]);
  });
});

type FakePr = { number: number; head: { ref: string }; body: string | null; created_at: string };

function fakeOctokit(prs: FakePr[]): Octokit {
  return {
    rest: { pulls: { list: async () => ({ data: prs }) } },
  } as unknown as Octokit;
}

describe("findPromotePrs", () => {
  it("keeps only promote branches, oldest first", async () => {
    const prs = await findPromotePrs(
      fakeOctokit([
        { number: 3, head: { ref: "promote/2026-05-22-abc" }, body: "c", created_at: "2026-05-22T00:00:00Z" },
        { number: 2, head: { ref: "feature/unrelated" }, body: "x", created_at: "2026-05-15T00:00:00Z" },
        { number: 1, head: { ref: "promote/2026-05-08-def" }, body: "a", created_at: "2026-05-08T00:00:00Z" },
      ]),
      REPO,
    );

    expect(prs.map((p) => p.number)).toEqual([1, 3]);
  });

  it("caps how many it reads", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      number: i + 1,
      head: { ref: `promote/2026-05-${String(i + 1).padStart(2, "0")}-aaa` },
      body: "",
      created_at: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));

    expect(await findPromotePrs(fakeOctokit(many), REPO, 3)).toHaveLength(3);
  });

  it("treats a null body as empty", async () => {
    const prs = await findPromotePrs(
      fakeOctokit([
        { number: 1, head: { ref: "promote/x" }, body: null, created_at: "2026-05-01T00:00:00Z" },
      ]),
      REPO,
    );

    expect(prs[0].body).toBe("");
  });
});

describe("applyPrDecisions", () => {
  let dir: string;
  let db: ReturnType<typeof initDatabase>["db"];
  let sqlite: ReturnType<typeof initDatabase>["sqlite"];

  function seed(id: string, status = "candidate") {
    const clusterId = `cluster_${id}`;
    upsertComments(
      db,
      [
        {
          id: `c_${id}`,
          repo: REPO.fullName,
          prNumber: 1,
          authorLogin: "coderabbitai[bot]",
          authorType: "Bot",
          body: "x",
          htmlUrl: "https://example.test/1",
          createdAt: "2026-05-01T00:00:00Z",
        },
      ],
      REPO.fullName,
    );
    saveCluster(db, clusterId, REPO.fullName, `fp_${id}`, `c_${id}`, 2);
    upsertCandidateRecord(db, {
      id,
      repo: REPO.fullName,
      clusterId,
      target: "agents",
      confidence: 0.9,
      summary: `pattern ${id}`,
      reason: "repeated",
      status,
    });
  }

  const prWith = (number: number, body: string, createdAt: string): FakePr => ({
    number,
    head: { ref: `promote/${createdAt.slice(0, 10)}-aaa` },
    body,
    created_at: createdAt,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "promote-decisions-"));
    ({ db, sqlite } = initDatabase(join(dir, "db.sqlite")));
  });

  afterEach(() => {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores the candidates a reviewer unchecked", async () => {
    seed("candidate_001");
    seed("candidate_002");
    const body = uncheck(bodyFor([["candidate_001", "A"], ["candidate_002", "B"]]), "candidate_002");

    const result = await applyPrDecisions({
      octokit: fakeOctokit([prWith(5, body, "2026-05-22T00:00:00Z")]),
      repo: REPO,
      db,
    });

    expect(result.ignored).toEqual([{ candidateId: "candidate_002", prNumber: 5 }]);
    expect(getCandidateById(db, REPO.fullName, "candidate_002")?.status).toBe("ignored");
    expect(getCandidateById(db, REPO.fullName, "candidate_001")?.status).toBe("candidate");
  });

  it("records why, and which PR said so", async () => {
    seed("candidate_001");
    const body = uncheck(bodyFor([["candidate_001", "A"]]), "candidate_001");

    await applyPrDecisions({
      octokit: fakeOctokit([prWith(42, body, "2026-05-22T00:00:00Z")]),
      repo: REPO,
      db,
    });

    expect(getCandidateById(db, REPO.fullName, "candidate_001")?.ignoreReason).toBe(
      "Unchecked in PR #42",
    );
  });

  it("leaves a promoted candidate alone", async () => {
    seed("candidate_001", "promoted");
    const body = uncheck(bodyFor([["candidate_001", "A"]]), "candidate_001");

    const result = await applyPrDecisions({
      octokit: fakeOctokit([prWith(5, body, "2026-05-22T00:00:00Z")]),
      repo: REPO,
      db,
    });

    expect(result.ignored).toEqual([]);
    expect(getCandidateById(db, REPO.fullName, "candidate_001")?.status).toBe("promoted");
  });

  it("does nothing for a candidate this database has never seen", async () => {
    const body = uncheck(bodyFor([["candidate_999", "A"]]), "candidate_999");

    const result = await applyPrDecisions({
      octokit: fakeOctokit([prWith(5, body, "2026-05-22T00:00:00Z")]),
      repo: REPO,
      db,
    });

    expect(result.ignored).toEqual([]);
  });

  it("never un-ignores a checked candidate", async () => {
    // Only rejections are applied; merging the PR is what "yes" means.
    seed("candidate_001", "ignored");

    const result = await applyPrDecisions({
      octokit: fakeOctokit([prWith(5, bodyFor([["candidate_001", "A"]]), "2026-05-22T00:00:00Z")]),
      repo: REPO,
      db,
    });

    expect(result.ignored).toEqual([]);
    expect(getCandidateById(db, REPO.fullName, "candidate_001")?.status).toBe("ignored");
  });

  it("is idempotent across repeated scans", async () => {
    seed("candidate_001");
    const body = uncheck(bodyFor([["candidate_001", "A"]]), "candidate_001");
    const octokit = fakeOctokit([prWith(5, body, "2026-05-22T00:00:00Z")]);

    const first = await applyPrDecisions({ octokit, repo: REPO, db });
    const second = await applyPrDecisions({ octokit, repo: REPO, db });

    expect(first.ignored).toHaveLength(1);
    expect(second.ignored).toHaveLength(0);
  });

  it("reads several PRs and reports how many", async () => {
    seed("candidate_001");
    seed("candidate_002");

    const result = await applyPrDecisions({
      octokit: fakeOctokit([
        prWith(1, uncheck(bodyFor([["candidate_001", "A"]]), "candidate_001"), "2026-05-08T00:00:00Z"),
        prWith(2, uncheck(bodyFor([["candidate_002", "B"]]), "candidate_002"), "2026-05-15T00:00:00Z"),
      ]),
      repo: REPO,
      db,
    });

    expect(result.prsRead).toBe(2);
    expect(result.ignored.map((i) => i.candidateId).sort()).toEqual([
      "candidate_001",
      "candidate_002",
    ]);
  });
});
