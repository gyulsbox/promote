import type { Octokit } from "octokit";
import type { RepoRef } from "../core/types.js";
import type { PromoteDB } from "../storage/db.js";
import { getCandidateById, updateCandidateStatus } from "../storage/repositories.js";
import { DECISION_SECTION_HEADING, DECISION_LINE_RE } from "./template.js";

/**
 * Reading a reviewer's per-candidate decisions back out of a promote PR.
 *
 * A bundled PR of twenty drafts otherwise offers only two answers: merge all
 * of it or close all of it. A team that closes it gets the identical PR again
 * the next week, and the week after, until they mute the workflow - so the
 * checklist in the PR body is where "these three yes, the rest no" gets said,
 * and this is where it gets heard.
 *
 * This only became possible once candidate IDs were stable across scans: a
 * decision recorded against `candidate_007` is worthless if next week's scan
 * calls the same pattern something else.
 */

export type Decision = { candidateId: string; accepted: boolean };

/**
 * Parses the decision checklist out of a PR body.
 *
 * Scoped to the `## Candidates` section so a checklist belonging to the team's
 * own PR template cannot be misread as a decision. Anything unparseable yields
 * no decisions, which is the safe direction: nothing gets ignored by accident.
 */
export function parseDecisions(body: string): Decision[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === DECISION_SECTION_HEADING);
  if (start === -1) return [];

  const decisions: Decision[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(start + 1)) {
    // Stop at the next section so later headings cannot contribute lines.
    if (/^##\s/.test(line)) break;

    const match = DECISION_LINE_RE.exec(line);
    if (!match) continue;

    const [, mark, candidateId] = match;
    if (seen.has(candidateId)) continue;
    seen.add(candidateId);
    decisions.push({ candidateId, accepted: mark.toLowerCase() === "x" });
  }

  return decisions;
}

export type PromotePr = { number: number; body: string; createdAt: string };

/**
 * promote's PR branches always start with `promote/` (see pr/branch.ts). The
 * `memory-promotion` label would be the obvious handle, but labels are applied
 * best-effort and silently skipped when the token cannot create them, so the
 * branch prefix is the reliable one.
 */
export const PROMOTE_BRANCH_PREFIX = "promote/";

export async function findPromotePrs(
  octokit: Octokit,
  repo: RepoRef,
  limit = 10,
): Promise<PromotePr[]> {
  const { data } = await octokit.rest.pulls.list({
    owner: repo.owner,
    repo: repo.name,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: 50,
  });

  return data
    .filter((pr) => pr.head?.ref?.startsWith(PROMOTE_BRANCH_PREFIX))
    .slice(0, limit)
    .map((pr) => ({ number: pr.number, body: pr.body ?? "", createdAt: pr.created_at }))
    // Oldest first, so a decision in a newer PR is applied after an older one.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export type AppliedDecisions = {
  ignored: Array<{ candidateId: string; prNumber: number }>;
  prsRead: number;
};

/**
 * Records rejections from earlier promote PRs so they are not proposed again.
 *
 * Only rejections are applied. A checked box means "land this", which merging
 * the PR already expresses; re-checking a previously rejected candidate is
 * rare and would have to reason about candidates that are already `promoted`,
 * so that direction is left to running `promote <id>` by hand.
 */
export async function applyPrDecisions(input: {
  octokit: Octokit;
  repo: RepoRef;
  db: PromoteDB;
  limit?: number;
}): Promise<AppliedDecisions> {
  const prs = await findPromotePrs(input.octokit, input.repo, input.limit);
  const ignored: AppliedDecisions["ignored"] = [];

  for (const pr of prs) {
    for (const decision of parseDecisions(pr.body)) {
      if (decision.accepted) continue;

      const existing = getCandidateById(input.db, input.repo.fullName, decision.candidateId);
      // Unknown to this database, or already settled - nothing to record.
      if (!existing) continue;
      if (existing.status === "ignored" || existing.status === "promoted") continue;

      updateCandidateStatus(input.db, input.repo.fullName, decision.candidateId, "ignored", {
        ignoreReason: `Unchecked in PR #${pr.number}`,
      });
      ignored.push({ candidateId: decision.candidateId, prNumber: pr.number });
    }
  }

  return { ignored, prsRead: prs.length };
}
