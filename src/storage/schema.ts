import { sqliteTable, text, integer, real, blob } from "drizzle-orm/sqlite-core";

export const reviewComments = sqliteTable("review_comments", {
  id: text("id").primaryKey(),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  authorLogin: text("author_login").notNull(),
  authorType: text("author_type"),
  body: text("body").notNull(),
  path: text("path"),
  line: integer("line"),
  diffHunk: text("diff_hunk"),
  htmlUrl: text("html_url").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  isAiReviewer: integer("is_ai_reviewer", { mode: "boolean" }).default(false),
  isNoise: integer("is_noise", { mode: "boolean" }).default(false),
  normalizedBody: text("normalized_body"),
  identifiersJson: text("identifiers_json"),
  pathsJson: text("paths_json"),
  actionVerbsJson: text("action_verbs_json"),
  embedding: blob("embedding", { mode: "buffer" }),
  fetchedAt: text("fetched_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const clusters = sqliteTable("clusters", {
  id: text("id").primaryKey(),
  repo: text("repo").notNull(),
  fingerprint: text("fingerprint").notNull(),
  representativeCommentId: text("representative_comment_id")
    .notNull()
    .references(() => reviewComments.id),
  summary: text("summary"),
  memberCount: integer("member_count").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const clusterMembers = sqliteTable("cluster_members", {
  clusterId: text("cluster_id")
    .notNull()
    .references(() => clusters.id),
  commentId: text("comment_id")
    .notNull()
    .references(() => reviewComments.id),
  similarityScore: real("similarity_score"),
});

export const candidates = sqliteTable("candidates", {
  id: text("id").primaryKey(),
  repo: text("repo").notNull(),
  clusterId: text("cluster_id")
    .notNull()
    .references(() => clusters.id),
  target: text("target").notNull(),
  confidence: real("confidence").notNull(),
  summary: text("summary").notNull(),
  reason: text("reason").notNull(),
  suggestedFile: text("suggested_file"),
  pathScope: text("path_scope"),
  draftContent: text("draft_content"),
  alternativesJson: text("alternatives_json"),
  status: text("status").notNull().default("candidate"),
  snoozedUntil: text("snoozed_until"),
  ignoreReason: text("ignore_reason"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const scanRuns = sqliteTable("scan_runs", {
  id: text("id").primaryKey(),
  repo: text("repo").notNull(),
  sinceDate: text("since_date").notNull(),
  totalComments: integer("total_comments"),
  aiComments: integer("ai_comments"),
  clustersFound: integer("clusters_found"),
  candidatesGenerated: integer("candidates_generated"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
