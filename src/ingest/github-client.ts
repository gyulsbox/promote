import { Octokit } from "octokit";
import { execSync } from "node:child_process";

export function createOctokit(token?: string): Octokit {
  const resolved = token ?? resolveGitHubToken();

  if (!resolved) {
    throw new Error(
      "GitHub token not found. Set GITHUB_TOKEN environment variable or install GitHub CLI (gh).",
    );
  }

  return new Octokit({
    auth: resolved,
    request: {
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  });
}

function resolveGitHubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  try {
    const ghToken = execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (ghToken) return ghToken;
  } catch {
    // gh CLI not available or not authenticated
  }

  return undefined;
}

export function parseRepoRef(repoString: string) {
  const parts = repoString.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: "${repoString}". Expected "owner/repo".`);
  }
  return {
    owner: parts[0],
    name: parts[1],
    fullName: repoString,
  };
}
