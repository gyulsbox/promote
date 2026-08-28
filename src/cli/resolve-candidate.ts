import type { PromoteDB } from "../storage/db.js";
import { findCandidateRepos } from "../storage/repositories.js";
import { detectLocalRepo } from "../core/local-repo.js";

export type CandidateScope =
  | { ok: true; repo: string }
  | { ok: false; error: string; hint?: string };

/**
 * Work out which repository a bare candidate ID on the command line refers to.
 *
 * `promote candidate_001`, `snooze candidate_001` and friends take an ID with
 * no repository, but IDs restart at candidate_001 in every repo, so one
 * .promote/db.sqlite that has seen several repositories can hold the same ID
 * more than once. Rather than picking one arbitrarily - which is how the wrong
 * repo's candidate would get promoted or ignored - ambiguity is reported.
 *
 * The overwhelmingly common case is a single repository, which resolves with
 * no git call at all.
 */
export function resolveCandidateScope(db: PromoteDB, candidateId: string): CandidateScope {
  const repos = findCandidateRepos(db, candidateId);

  if (repos.length === 0) {
    return { ok: false, error: `Candidate ${candidateId} not found.`, hint: "Run 'promote scan' first." };
  }
  if (repos.length === 1) {
    return { ok: true, repo: repos[0] };
  }

  const local = detectLocalRepo();
  if (local && repos.includes(local)) {
    return { ok: true, repo: local };
  }

  return {
    ok: false,
    error: `Candidate ${candidateId} exists in ${repos.length} repositories: ${repos.join(", ")}.`,
    hint: local
      ? `The current directory is ${local}, which is not one of them. Run the command from a checkout of the intended repository.`
      : "Run the command from a checkout of the intended repository so it can be identified.",
  };
}
