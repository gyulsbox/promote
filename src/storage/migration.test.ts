import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "./db.js";
import { getCandidateById, listCandidates, upsertCandidateRecord } from "./repositories.js";

/**
 * The candidates table as promote <=0.7 created it: a single-column primary
 * key, and without the columns later added by ALTER TABLE migrations. Opening
 * such a database has to add those columns *and* widen the key, in that order,
 * without dropping a row.
 */
const LEGACY_SQL = `
CREATE TABLE clusters (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  representative_comment_id TEXT NOT NULL,
  summary TEXT,
  member_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  cluster_id TEXT NOT NULL REFERENCES clusters(id),
  target TEXT NOT NULL,
  confidence REAL NOT NULL,
  summary TEXT NOT NULL,
  reason TEXT NOT NULL,
  suggested_file TEXT,
  path_scope TEXT,
  draft_content TEXT,
  alternatives_json TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  snoozed_until TEXT,
  ignore_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function seedLegacyDb(path: string) {
  const sqlite = new Database(path);
  sqlite.exec(LEGACY_SQL);
  sqlite
    .prepare(
      "INSERT INTO clusters (id, repo, fingerprint, representative_comment_id, member_count) VALUES (?, ?, ?, ?, ?)",
    )
    .run("cluster_a", "acme/widgets", "fp_a", "c1", 3);
  sqlite
    .prepare(
      `INSERT INTO candidates (id, repo, cluster_id, target, confidence, summary, reason, status, snoozed_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "candidate_001",
      "acme/widgets",
      "cluster_a",
      "agents",
      0.91,
      "Prefer const over let",
      "seen in 3 PRs",
      "snoozed",
      "2026-12-31T00:00:00Z",
    );
  sqlite.close();
}

describe("candidates composite-key migration", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "promote-migrate-"));
    path = join(dir, "db.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves existing rows and their state", () => {
    seedLegacyDb(path);

    const { db, sqlite } = initDatabase(path);
    const row = getCandidateById(db, "acme/widgets", "candidate_001");

    expect(row?.summary).toBe("Prefer const over let");
    expect(row?.confidence).toBeCloseTo(0.91);
    // A snooze the user set before upgrading must survive.
    expect(row?.status).toBe("snoozed");
    expect(row?.snoozedUntil).toBe("2026-12-31T00:00:00Z");
    sqlite.close();
  });

  it("widens the primary key to (repo, id)", () => {
    seedLegacyDb(path);

    const { sqlite } = initDatabase(path);
    const pk = (sqlite.prepare("PRAGMA table_info(candidates)").all() as Array<{
      name: string;
      pk: number;
    }>)
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);

    expect(pk).toEqual(["repo", "id"]);
    sqlite.close();
  });

  it("adds the columns introduced after the legacy schema", () => {
    seedLegacyDb(path);

    const { sqlite } = initDatabase(path);
    const columns = (sqlite.prepare("PRAGMA table_info(candidates)").all() as Array<{
      name: string;
    }>).map((c) => c.name);

    expect(columns).toContain("cluster_fingerprint");
    expect(columns).toContain("human_signal_json");
    sqlite.close();
  });

  it("lets a second repo use the same candidate ID after upgrading", () => {
    seedLegacyDb(path);
    const { db, sqlite } = initDatabase(path);

    upsertCandidateRecord(db, {
      id: "candidate_001",
      repo: "other/repo",
      clusterId: "cluster_a",
      target: "agents",
      confidence: 0.5,
      summary: "different repo, same ID",
      reason: "n/a",
      status: "candidate",
    });

    expect(getCandidateById(db, "acme/widgets", "candidate_001")?.summary).toBe(
      "Prefer const over let",
    );
    expect(getCandidateById(db, "other/repo", "candidate_001")?.summary).toBe(
      "different repo, same ID",
    );
    sqlite.close();
  });

  it("recreates the indexes dropped with the old table", () => {
    seedLegacyDb(path);

    const { sqlite } = initDatabase(path);
    const indexes = (sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'candidates'")
      .all() as Array<{ name: string }>).map((i) => i.name);

    expect(indexes).toContain("idx_candidates_repo");
    expect(indexes).toContain("idx_candidates_status");
    sqlite.close();
  });

  it("is idempotent across repeated opens", () => {
    seedLegacyDb(path);

    for (let i = 0; i < 3; i++) {
      const { db, sqlite } = initDatabase(path);
      expect(listCandidates(db, "acme/widgets")).toHaveLength(1);
      sqlite.close();
    }
  });

  it("leaves a freshly created database alone", () => {
    const { db, sqlite } = initDatabase(path);
    const pk = (sqlite.prepare("PRAGMA table_info(candidates)").all() as Array<{
      name: string;
      pk: number;
    }>).filter((c) => c.pk > 0);

    expect(pk).toHaveLength(2);
    expect(listCandidates(db, "acme/widgets")).toHaveLength(0);
    sqlite.close();
  });
});
