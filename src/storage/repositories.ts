import { eq, and, lte } from "drizzle-orm";
import type { PromoteDB } from "./db.js";
import { reviewComments, clusters, clusterMembers, candidates, scanRuns } from "./schema.js";
import type { RawReviewComment, CandidateStatus } from "../core/types.js";
import { cosineSimilarity } from "../cluster/similarity.js";

export function upsertComments(db: PromoteDB, comments: RawReviewComment[], repo: string) {
  for (const c of comments) {
    db.insert(reviewComments)
      .values({
        id: c.id,
        repo,
        prNumber: c.prNumber,
        authorLogin: c.authorLogin,
        authorType: c.authorType,
        body: c.body,
        path: c.path,
        line: c.line,
        diffHunk: c.diffHunk,
        htmlUrl: c.htmlUrl,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })
      .onConflictDoUpdate({
        target: reviewComments.id,
        set: {
          body: c.body,
          updatedAt: c.updatedAt,
          fetchedAt: new Date().toISOString(),
        },
      })
      .run();
  }
}

export function getLastFetchedAt(db: PromoteDB, repo: string): string | null {
  const result = db
    .select({ updatedAt: reviewComments.updatedAt })
    .from(reviewComments)
    .where(eq(reviewComments.repo, repo))
    .orderBy(reviewComments.updatedAt)
    .limit(1)
    .all();

  return result[0]?.updatedAt ?? null;
}

export function updateCandidateStatus(
  db: PromoteDB,
  candidateId: string,
  status: CandidateStatus,
  extra?: { ignoreReason?: string; snoozedUntil?: string },
) {
  db.update(candidates)
    .set({
      status,
      ignoreReason: extra?.ignoreReason,
      snoozedUntil: extra?.snoozedUntil,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(candidates.id, candidateId))
    .run();
}

export function getCandidateById(db: PromoteDB, candidateId: string) {
  return db
    .select()
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .get();
}

export function getCandidateByClusterFingerprint(
  db: PromoteDB,
  repo: string,
  fingerprint: string,
) {
  return db
    .select()
    .from(candidates)
    .where(and(eq(candidates.repo, repo), eq(candidates.clusterFingerprint, fingerprint)))
    .get();
}

export function upsertCandidateRecord(
  db: PromoteDB,
  record: {
    id: string;
    repo: string;
    clusterId: string;
    clusterFingerprint?: string;
    target: string;
    confidence: number;
    summary: string;
    reason: string;
    suggestedFile?: string | null;
    pathScope?: string | null;
    draftContent?: string | null;
    alternativesJson?: string | null;
    humanSignalJson?: string | null;
    status: string;
  },
) {
  db.insert(candidates)
    .values({
      ...record,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: candidates.id,
      set: {
        confidence: record.confidence,
        summary: record.summary,
        reason: record.reason,
        suggestedFile: record.suggestedFile,
        draftContent: record.draftContent,
        alternativesJson: record.alternativesJson,
        humanSignalJson: record.humanSignalJson,
        updatedAt: new Date().toISOString(),
      },
    })
    .run();
}

export function resetExpiredSnoozes(db: PromoteDB, repo: string): number {
  const now = new Date().toISOString();
  const result = db
    .update(candidates)
    .set({ status: "candidate", snoozedUntil: null, updatedAt: now })
    .where(
      and(
        eq(candidates.repo, repo),
        eq(candidates.status, "snoozed"),
        lte(candidates.snoozedUntil, now),
      ),
    )
    .run();
  return result.changes;
}

export function saveCluster(
  db: PromoteDB,
  clusterId: string,
  repo: string,
  fingerprint: string,
  representativeCommentId: string,
  memberCount: number,
  medoidEmbedding?: number[],
) {
  const embBuf =
    medoidEmbedding && medoidEmbedding.length > 0
      ? Buffer.from(new Float32Array(medoidEmbedding).buffer)
      : null;
  db.insert(clusters)
    .values({
      id: clusterId,
      repo,
      fingerprint,
      representativeCommentId,
      memberCount,
      ...(embBuf ? { medoidEmbedding: embBuf } : {}),
    })
    .onConflictDoUpdate({
      target: clusters.id,
      set: {
        memberCount,
        ...(embBuf ? { medoidEmbedding: embBuf } : {}),
        updatedAt: new Date().toISOString(),
      },
    })
    .run();
}

export function findClusterByEmbedding(
  db: PromoteDB,
  repo: string,
  embedding: number[],
  threshold = 0.92,
): string | null {
  const rows = db
    .select({ id: clusters.id, medoidEmbedding: clusters.medoidEmbedding })
    .from(clusters)
    .where(eq(clusters.repo, repo))
    .all();

  for (const row of rows) {
    if (!row.medoidEmbedding) continue;
    const floats = new Float32Array(
      (row.medoidEmbedding as Buffer).buffer,
      (row.medoidEmbedding as Buffer).byteOffset,
      (row.medoidEmbedding as Buffer).byteLength / 4,
    );
    const sim = cosineSimilarity(embedding, Array.from(floats));
    if (sim >= threshold) return row.id;
  }
  return null;
}

export function listCandidates(db: PromoteDB, repo: string, status?: CandidateStatus) {
  if (status) {
    return db
      .select()
      .from(candidates)
      .where(and(eq(candidates.repo, repo), eq(candidates.status, status)))
      .all();
  }
  return db
    .select()
    .from(candidates)
    .where(eq(candidates.repo, repo))
    .all();
}
