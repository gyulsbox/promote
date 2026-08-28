import { eq, and, lte } from "drizzle-orm";
import type { PromoteDB } from "./db.js";
import { reviewComments, clusters, clusterMembers, candidates, scanRuns } from "./schema.js";
import type { RawReviewComment, CandidateStatus } from "../core/types.js";
import { cosineSimilarity } from "../cluster/similarity.js";
import type { PriorCluster } from "../cluster/identity.js";

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
        // clusterId is deliberately NOT updated. Cross-scan identity keeps a
        // pattern on its original cluster row (see cluster/identity.ts), so it
        // never legitimately changes — and because candidate IDs are issued
        // per-repo ("candidate_001") against a globally unique primary key,
        // updating it lets a second repo scanned from the same directory
        // repoint the first repo's candidate at a foreign cluster.
        clusterFingerprint: record.clusterFingerprint,
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
        fingerprint,
        representativeCommentId,
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

/**
 * Replace the stored member list for a cluster.
 *
 * Written on every scan so that cross-scan identity matching
 * (`resolveClusterIdentities`) compares against the *latest* membership rather
 * than whatever the cluster looked like the first time it was seen — otherwise
 * overlap decays as the cluster grows and continuity is lost anyway.
 *
 * Callers must have inserted the cluster row and the member comments first;
 * `foreign_keys` is ON.
 */
export function saveClusterMembers(db: PromoteDB, clusterId: string, commentIds: string[]) {
  db.delete(clusterMembers).where(eq(clusterMembers.clusterId, clusterId)).run();
  if (commentIds.length === 0) return;
  const unique = [...new Set(commentIds)];
  db.insert(clusterMembers)
    .values(unique.map((commentId) => ({ clusterId, commentId })))
    .onConflictDoNothing()
    .run();
}

/**
 * Every cluster from previous scans that carries a candidate, with its member
 * comment IDs — the input to cross-scan identity matching.
 *
 * Clusters with no candidate row are skipped: there is no ID to preserve, so
 * matching them would only create spurious claims on this scan's clusters.
 */
export function listPriorClusters(db: PromoteDB, repo: string): PriorCluster[] {
  const rows = db
    .select({
      clusterId: clusters.id,
      fingerprint: clusters.fingerprint,
      candidateId: candidates.id,
      status: candidates.status,
    })
    .from(clusters)
    .innerJoin(candidates, eq(candidates.clusterId, clusters.id))
    .where(eq(clusters.repo, repo))
    .all();

  // Scoped through `clusters` because cluster_members carries no repo column
  // and one .promote/db.sqlite can hold several repositories.
  const memberRows = db
    .select({ clusterId: clusterMembers.clusterId, commentId: clusterMembers.commentId })
    .from(clusterMembers)
    .innerJoin(clusters, eq(clusters.id, clusterMembers.clusterId))
    .where(eq(clusters.repo, repo))
    .all();

  const byCluster = new Map<string, string[]>();
  for (const m of memberRows) {
    const bucket = byCluster.get(m.clusterId);
    if (bucket) bucket.push(m.commentId);
    else byCluster.set(m.clusterId, [m.commentId]);
  }

  return rows.map((r) => ({
    clusterId: r.clusterId,
    candidateId: r.candidateId,
    status: r.status,
    fingerprint: r.fingerprint,
    memberIds: byCluster.get(r.clusterId) ?? [],
  }));
}
