import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import * as schema from "./schema.js";

const candidatesTableSql = (table: string) => `
CREATE TABLE IF NOT EXISTS ${table} (
  id TEXT NOT NULL,
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
  human_signal_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Composite key: candidate IDs are issued per repo (candidate_001), so a
  -- bare id is only unique within one repository. With id alone as the key,
  -- scanning a second repo from the same working directory overwrote the
  -- first repo's rows.
  PRIMARY KEY (repo, id)
);
`;

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

${candidatesTableSql("candidates")}

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

`;

const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_comments_repo ON review_comments(repo);
CREATE INDEX IF NOT EXISTS idx_comments_ai ON review_comments(repo, is_ai_reviewer);
CREATE INDEX IF NOT EXISTS idx_clusters_repo ON clusters(repo);
CREATE INDEX IF NOT EXISTS idx_candidates_repo ON candidates(repo);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(repo, status);
CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members(cluster_id);
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
    "ALTER TABLE candidates ADD COLUMN human_signal_json TEXT",
  ];
  for (const migration of migrations) {
    try { sqlite.exec(migration); } catch { /* column already exists */ }
  }

  // Must run after the ADD COLUMNs above so the rebuild copies a complete row.
  migrateCandidatesToCompositeKey(sqlite);

  // After a rebuild the old table's indexes are gone with it.
  sqlite.exec(INDEXES_SQL);

  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

/**
 * Move `candidates` from `PRIMARY KEY (id)` to `PRIMARY KEY (repo, id)`.
 *
 * Candidate IDs are issued per repository and start at `candidate_001` in each
 * one, but the primary key was global. Scanning a second repository from the
 * same working directory therefore collided on every ID: the second scan's
 * upsert overwrote the first repository's rows, replacing their summary,
 * confidence and draft with another repo's content.
 *
 * SQLite cannot alter a primary key, so the table is rebuilt. Widening the key
 * can never fail on existing data - `(repo, id)` is strictly weaker than the
 * `id` uniqueness the rows already satisfy.
 */
function migrateCandidatesToCompositeKey(sqlite: InstanceType<typeof Database>) {
  const columns = sqlite.prepare("PRAGMA table_info(candidates)").all() as Array<{
    name: string;
    pk: number;
  }>;
  if (columns.length === 0) return; // table not created yet
  if (columns.filter((c) => c.pk > 0).length >= 2) return; // already composite

  const names = columns.map((c) => c.name).join(", ");

  // PRAGMA foreign_keys cannot be changed inside a transaction, so it is
  // toggled around one.
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.exec("BEGIN");
    sqlite.exec(candidatesTableSql("candidates_migrated"));
    sqlite.exec(`INSERT INTO candidates_migrated (${names}) SELECT ${names} FROM candidates`);
    sqlite.exec("DROP TABLE candidates");
    sqlite.exec("ALTER TABLE candidates_migrated RENAME TO candidates");
    sqlite.exec("COMMIT");
  } catch (err) {
    try { sqlite.exec("ROLLBACK"); } catch { /* no transaction open */ }
    throw err;
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

export type PromoteDB = ReturnType<typeof initDatabase>["db"];
