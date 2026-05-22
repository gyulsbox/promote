import type { Octokit } from "octokit";
import type { RepoRef, RawReviewComment } from "../core/types.js";

/**
 * Fetches general PR conversation comments (not inline code line comments) for a
 * given set of PR numbers. GitHub's REST API treats PR conversation comments as
 * issue comments under the hood; we filter `issues.listCommentsForRepo` results
 * down to comments whose issue is one of the target PRs AND whose author is
 * neither a Bot nor in the AI reviewer allowlist — otherwise the issue-comment
 * endpoint floods the result with CodeRabbit-style auto-summary posts.
 *
 * IDs are prefixed with `issue-` to avoid collision with review-line comment IDs.
 */
export async function fetchPrConversationComments(
  octokit: Octokit,
  repo: RepoRef,
  prNumbers: Set<number>,
  since: Date,
  aiReviewerLogins: string[],
  onProgress?: (count: number) => void,
): Promise<RawReviewComment[]> {
  if (prNumbers.size === 0) return [];

  const excludeAuthors = new Set(aiReviewerLogins.map((a) => a.toLowerCase()));
  const comments: RawReviewComment[] = [];

  const iterator = octokit.paginate.iterator(
    octokit.rest.issues.listCommentsForRepo,
    {
      owner: repo.owner,
      repo: repo.name,
      since: since.toISOString(),
      sort: "updated",
      direction: "desc",
      per_page: 100,
    },
  );

  for await (const response of iterator) {
    for (const c of response.data) {
      const prMatch = c.issue_url.match(/\/issues\/(\d+)$/);
      if (!prMatch) continue;
      const prNumber = Number(prMatch[1]);
      if (!prNumbers.has(prNumber)) continue;

      // Drop bots and AI reviewer accounts — only genuine human conversation
      // is useful for sentiment matching.
      const login = (c.user?.login ?? "").toLowerCase();
      if (c.user?.type === "Bot") continue;
      if (excludeAuthors.has(login)) continue;

      comments.push({
        id: `issue-${c.id}`,
        repo: repo.fullName,
        prNumber,
        authorLogin: c.user?.login ?? "unknown",
        authorType: resolveAuthorType(c.user?.type),
        body: c.body ?? "",
        htmlUrl: c.html_url,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        reactions: c.reactions
          ? { plusOne: c.reactions["+1"] ?? 0, minusOne: c.reactions["-1"] ?? 0 }
          : undefined,
      });
    }
    onProgress?.(comments.length);
  }

  return comments;
}

export async function fetchReviewComments(
  octokit: Octokit,
  repo: RepoRef,
  since: Date,
  onProgress?: (count: number) => void,
): Promise<RawReviewComment[]> {
  const comments: RawReviewComment[] = [];

  const iterator = octokit.paginate.iterator(
    octokit.rest.pulls.listReviewCommentsForRepo,
    {
      owner: repo.owner,
      repo: repo.name,
      since: since.toISOString(),
      sort: "updated",
      direction: "desc",
      per_page: 100,
    },
  );

  for await (const response of iterator) {
    for (const c of response.data) {
      comments.push({
        id: String(c.id),
        repo: repo.fullName,
        prNumber: extractPrNumber(c.pull_request_url),
        authorLogin: c.user?.login ?? "unknown",
        authorType: resolveAuthorType(c.user?.type),
        body: c.body ?? "",
        path: c.path,
        line: c.line ?? undefined,
        diffHunk: c.diff_hunk,
        htmlUrl: c.html_url,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        inReplyToId: c.in_reply_to_id ? String(c.in_reply_to_id) : undefined,
        reactions: c.reactions
          ? { plusOne: c.reactions["+1"] ?? 0, minusOne: c.reactions["-1"] ?? 0 }
          : undefined,
      });
    }

    onProgress?.(comments.length);

    if (response.data.length < 100) break;
  }

  return comments;
}

function extractPrNumber(pullRequestUrl: string): number {
  const match = pullRequestUrl.match(/\/pulls\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function resolveAuthorType(type?: string): "Bot" | "User" | "Unknown" {
  if (type === "Bot") return "Bot";
  if (type === "User") return "User";
  return "Unknown";
}

export function computeSinceDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
