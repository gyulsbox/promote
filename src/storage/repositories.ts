import { eq, and } from "drizzle-orm";
import type { PromoteDB } from "./db.js";
import { reviewComments, clusters, clusterMembers, candidates, scanRuns } from "./schema.js";
import type { RawReviewComment, CandidateStatus } from "../core/types.js";

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
