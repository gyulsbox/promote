import { execSync, execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Octokit } from "octokit";
import { parseRepoRef } from "../ingest/github-client.js";

export type CreatePullRequestInput = {
  branch: string;
  title: string;
  body: string;
  files: string[];
  repo: string;
  baseBranch?: string;
  labels?: string[];
  octokit?: Octokit;
  cwd?: string;
};

export type CreatePullRequestResult = {
  url: string;
  branch: string;
  via: "gh" | "octokit";
};

export function hasGhCli(): boolean {
  try {
    execSync("gh --version", { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

export function isGhAuthenticated(): boolean {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return true;
  try {
    execSync("gh auth status", { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function detectDefaultBranch(cwd: string): string {
  try {
    const ref = run("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
    const match = ref.match(/refs\/remotes\/origin\/(.+)$/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  try {
    return run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  } catch {
    return "main";
  }
}

function currentBranch(cwd: string): string {
  return run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

function gitStage(branch: string, files: string[], cwd: string) {
  try {
    run("git", ["rev-parse", "--verify", branch], cwd);
    run("git", ["checkout", "-B", branch], cwd);
  } catch {
    run("git", ["checkout", "-b", branch], cwd);
  }

  if (files.length === 0) {
    throw new Error("No files to commit — applyPromotion returned an empty file list.");
  }
  run("git", ["add", "--", ...files], cwd);
}

function gitHasStagedChanges(cwd: string): boolean {
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd, stdio: ["ignore", "ignore", "ignore"] });
    return false;
  } catch {
    return true;
  }
}

function gitCommitAndPush(message: string, branch: string, cwd: string) {
  run("git", ["commit", "-m", message], cwd);
  run("git", ["push", "-u", "origin", branch], cwd);
}

export async function createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
  const cwd = input.cwd ?? process.cwd();
  const baseBranch = input.baseBranch ?? detectDefaultBranch(cwd);
  const originalBranch = currentBranch(cwd);

  gitStage(input.branch, input.files, cwd);

  if (!gitHasStagedChanges(cwd)) {
    if (originalBranch !== input.branch) {
      try { run("git", ["checkout", originalBranch], cwd); } catch { /* ignore */ }
    }
    throw new Error("No staged changes — files were not modified by applyPromotion.");
  }

  gitCommitAndPush(input.title, input.branch, cwd);

  const useGh = hasGhCli() && isGhAuthenticated();
  let url: string;
  let via: "gh" | "octokit";

  if (useGh) {
    url = await createWithGh(input, baseBranch, cwd);
    via = "gh";
  } else {
    if (!input.octokit) {
      throw new Error("gh CLI not available and no Octokit instance was provided for PR creation.");
    }
    url = await createWithOctokit(input, baseBranch);
    via = "octokit";
  }

  return { url, branch: input.branch, via };
}

async function createWithGh(input: CreatePullRequestInput, baseBranch: string, cwd: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "promote-pr-"));
  const bodyFile = join(dir, "body.md");
  writeFileSync(bodyFile, input.body, "utf-8");

  try {
    const args = [
      "pr", "create",
      "--title", input.title,
      "--body-file", bodyFile,
      "--base", baseBranch,
      "--head", input.branch,
    ];
    for (const label of input.labels ?? []) {
      args.push("--label", label);
    }

    const url = run("gh", args, cwd);
    return url;
  } finally {
    try { unlinkSync(bodyFile); } catch { /* ignore */ }
  }
}

async function createWithOctokit(input: CreatePullRequestInput, baseBranch: string): Promise<string> {
  if (!input.octokit) {
    throw new Error("Octokit instance required for fallback PR creation.");
  }
  const repo = parseRepoRef(input.repo);

  const pr = await input.octokit.rest.pulls.create({
    owner: repo.owner,
    repo: repo.name,
    head: input.branch,
    base: baseBranch,
    title: input.title,
    body: input.body,
  });

  if (input.labels && input.labels.length > 0) {
    try {
      await input.octokit.rest.issues.addLabels({
        owner: repo.owner,
        repo: repo.name,
        issue_number: pr.data.number,
        labels: input.labels,
      });
    } catch {
      // labels are best-effort — missing label permissions or unknown labels shouldn't fail the PR
    }
  }

  return pr.data.html_url;
}
