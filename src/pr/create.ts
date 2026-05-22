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
  // 1) Local refs: refs/remotes/origin/HEAD points to the default branch when
  //    the remote was cloned. Cheap, no network.
  try {
    const ref = run("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
    const match = ref.match(/refs\/remotes\/origin\/(.+)$/);
    if (match) return match[1];
  } catch {
    // origin/HEAD not set (common when origin was added after the clone)
  }
  // 2) Ask GitHub via gh. One network round-trip but authoritative.
  try {
    const name = run(
      "gh",
      ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      cwd,
    );
    if (name) return name;
  } catch {
    // gh missing or no auth — fall through
  }
  // 3) Last resort. Never use current branch — we may already be on the
  //    promote/... branch we just created, which would make us PR to ourselves.
  return "main";
}

function currentBranch(cwd: string): string {
  return run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

function gitStage(branch: string, files: string[], cwd: string, baseBranch: string) {
  // Pull the latest baseBranch from origin so our cut point is current.
  try {
    run("git", ["fetch", "origin", baseBranch], cwd);
  } catch {
    // offline or no origin/<base> — fall through to the local ref
  }

  // Resolve baseBranch to a SHA. Prefer origin/<base> over the local mirror,
  // since the local one can be behind.
  let baseSha: string;
  try {
    baseSha = run("git", ["rev-parse", `origin/${baseBranch}`], cwd);
  } catch {
    try {
      baseSha = run("git", ["rev-parse", baseBranch], cwd);
    } catch {
      throw new Error(
        `Cannot resolve base branch '${baseBranch}' (tried origin/${baseBranch} and local). ` +
        `Pass --base-branch <name> if your default branch isn't named 'main'.`,
      );
    }
  }

  // Create-or-move `branch` to baseSha, then point HEAD at it WITHOUT touching
  // the working tree. The memory files applyPromotion wrote stay where they
  // are; they'll appear as a diff against baseSha after `reset --mixed`.
  // This is the key to "promote branch is cut from main, not from whatever
  // feature branch the user happens to be on."
  run("git", ["update-ref", `refs/heads/${branch}`, baseSha], cwd);
  run("git", ["symbolic-ref", "HEAD", `refs/heads/${branch}`], cwd);
  // Resync the index with the new HEAD; otherwise stale staging from the
  // previous branch sneaks into the commit.
  run("git", ["reset", "--mixed"], cwd);

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

  gitStage(input.branch, input.files, cwd, baseBranch);

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
    // Step 1: create PR without labels. `gh pr create --label foo` hard-fails
    // if the label doesn't exist on the repo (no auto-create). We want PR
    // creation to be the load-bearing step; labels are decorative.
    const args = [
      "pr", "create",
      "--title", input.title,
      "--body-file", bodyFile,
      "--base", baseBranch,
      "--head", input.branch,
    ];
    const url = run("gh", args, cwd);

    // Step 2: attach labels as best-effort. Auto-create missing labels (e.g.
    // first-ever memory-promotion PR on a repo). If the user lacks label
    // perms or label creation fails, log and continue — the PR itself is fine.
    for (const label of input.labels ?? []) {
      try {
        ensureLabelExists(label, cwd);
        run("gh", ["pr", "edit", input.branch, "--add-label", label], cwd);
      } catch {
        // best-effort
      }
    }

    return url;
  } finally {
    try { unlinkSync(bodyFile); } catch { /* ignore */ }
  }
}

function ensureLabelExists(label: string, cwd: string) {
  // `gh label create` exits 0 if created, exits non-zero if it exists. The
  // --force flag makes it idempotent (updates color/description if different).
  try {
    run("gh", [
      "label", "create", label,
      "--color", "B660CD",
      "--description", "Repository memory promotion (promote-cli)",
      "--force",
    ], cwd);
  } catch {
    // ignore — caller will catch the addLabels failure if relevant
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
