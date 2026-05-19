import type { Octokit } from "octokit";
import type { RepoRef, RawReviewComment } from "../core/types.js";

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
