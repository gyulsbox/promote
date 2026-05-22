import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import * as schema from "./schema.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  author_login TEXT NOT NULL,
  author_type TEXT,
  body TEXT NOT NULL,
  path TEXT,
  line INTEGER,
  diff_hunk TEXT,
  html_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  is_ai_reviewer INTEGER DEFAULT 0,
  is_noise INTEGER DEFAULT 0,
  normalized_body TEXT,
  identifiers_json TEXT,
  paths_json TEXT,
  action_verbs_json TEXT,
  embedding BLOB,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  representative_comment_id TEXT NOT NULL REFERENCES review_comments(id),
  summary TEXT,
  member_count INTEGER NOT NULL,
  medoid_embedding BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cluster_members (
  cluster_id TEXT NOT NULL REFERENCES clusters(id),
  comment_id TEXT NOT NULL REFERENCES review_comments(id),
  similarity_score REAL,
  PRIMARY KEY (cluster_id, comment_id)
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  cluster_id TEXT NOT NULL REFERENCES clusters(id),
  cluster_fingerprint TEXT,
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

CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  since_date TEXT NOT NULL,
  total_comments INTEGER,
  ai_comments INTEGER,
  clusters_found INTEGER,
  candidates_generated INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_repo ON review_comments(repo);
CREATE INDEX IF NOT EXISTS idx_comments_ai ON review_comments(repo, is_ai_reviewer);
CREATE INDEX IF NOT EXISTS idx_clusters_repo ON clusters(repo);
CREATE INDEX IF NOT EXISTS idx_candidates_repo ON candidates(repo);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(repo, status);
`;

export function initDatabase(dbPath?: string): { db: ReturnType<typeof drizzle>; sqlite: InstanceType<typeof Database> } {
  const path = dbPath ?? resolve(process.cwd(), ".promote", "db.sqlite");
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(SCHEMA_SQL);

  // Migrations for existing databases (ADD COLUMN is idempotent via try/catch)
  const migrations = [
    "ALTER TABLE clusters ADD COLUMN medoid_embedding BLOB",
    "ALTER TABLE candidates ADD COLUMN cluster_fingerprint TEXT",
  ];
  for (const migration of migrations) {
    try { sqlite.exec(migration); } catch { /* column already exists */ }
  }

  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

export type PromoteDB = ReturnType<typeof initDatabase>["db"];
