import { execSync, execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

export type PrContext = {
  branch: string;
  baseBranch: string;
  originalBranch: string;
  cwd: string;
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
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    const stdout = err.stdout ? err.stdout.toString().trim() : "";
    const detail = stderr || stdout || err.message || "unknown error";
    throw new Error(`\`${cmd} ${args[0] ?? ""}\` failed: ${detail}`);
  }
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

function gitStageFiles(files: string[], cwd: string) {
  if (files.length === 0) {
    throw new Error("No files to commit — applyPromotion returned an empty file list.");
  }
  run("git", ["add", "--", ...files], cwd);
}

/**
 * Switch HEAD to a new branch cut from baseBranch WITHOUT touching the working
 * tree. The trio update-ref + symbolic-ref + reset --mixed is the key: the
 * branch ref moves to baseBranch's SHA, HEAD points at the new branch, and the
 * index resyncs with baseBranch's tree — but any working tree modifications
 * (applyPromotion's draft writes, the user's other dirt) stay in place.
 *
 * Call this BEFORE applyPromotion when --create-pr is on, so the draft writes
 * land cleanly on top of baseBranch and PR creation can be made atomic
 * (rolled back if anything downstream fails).
 */
export function prepareBranchForPr(input: {
  branch: string;
  baseBranch?: string;
  cwd?: string;
}): PrContext {
  const cwd = input.cwd ?? process.cwd();
  const baseBranch = input.baseBranch ?? detectDefaultBranch(cwd);
  const originalBranch = currentBranch(cwd);

  try {
    run("git", ["fetch", "origin", baseBranch], cwd);
  } catch {
    // offline or no origin/<base> — fall through to the local ref
  }

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

  run("git", ["update-ref", `refs/heads/${input.branch}`, baseSha], cwd);
  run("git", ["symbolic-ref", "HEAD", `refs/heads/${input.branch}`], cwd);
  run("git", ["reset", "--mixed"], cwd);

  return { branch: input.branch, baseBranch, originalBranch, cwd };
}

/**
 * After applyPromotion has written its files on the prepared branch's working
 * tree, stage them, commit, push, and open the PR. Does NOT switch branches —
 * the caller is expected to be on `context.branch` already (from prepareBranchForPr).
 */
export async function finalizePr(input: {
  context: PrContext;
  title: string;
  body: string;
  files: string[];
  repo: string;
  labels?: string[];
  octokit?: Octokit;
}): Promise<CreatePullRequestResult> {
  const { context } = input;
  gitStageFiles(input.files, context.cwd);

  if (!gitHasStagedChanges(context.cwd)) {
    throw new Error("No staged changes — files were not modified by applyPromotion.");
  }

  gitCommitAndPush(input.title, context.branch, context.cwd);

  const useGh = hasGhCli() && isGhAuthenticated();
  if (useGh) {
    const url = await createWithGh(
      { ...input, branch: context.branch },
      context.baseBranch,
      context.cwd,
    );
    return { url, branch: context.branch, via: "gh" };
  }
  if (!input.octokit) {
    throw new Error("gh CLI not available and no Octokit instance was provided for PR creation.");
  }
  const url = await createWithOctokit(
    { ...input, branch: context.branch },
    context.baseBranch,
  );
  return { url, branch: context.branch, via: "octokit" };
}

/**
 * Roll back a prepared branch: discard working tree modifications to the files
 * we wrote (deleting newly-created ones), reset the index, switch back to the
 * original branch, and delete the promote branch. Best-effort throughout —
 * never throws.
 */
export function rollbackBranch(context: PrContext, files: string[]) {
  for (const file of files) {
    const fullPath = resolve(context.cwd, file);
    try {
      // Restore from HEAD (= baseBranch) if the file existed there.
      run("git", ["checkout", "HEAD", "--", file], context.cwd);
    } catch {
      // File is new (not in baseBranch). Remove it from working tree.
      try { rmSync(fullPath, { force: true }); } catch { /* ignore */ }
    }
  }
  try { run("git", ["reset", "--mixed"], context.cwd); } catch { /* ignore */ }
  try {
    run("git", ["symbolic-ref", "HEAD", `refs/heads/${context.originalBranch}`], context.cwd);
  } catch { /* ignore */ }
  try { run("git", ["branch", "-D", context.branch], context.cwd); } catch { /* ignore */ }
}

/**
 * Switch back to the user's original branch after a successful PR creation.
 * Uses checkout (not symbolic-ref) so the working tree matches the original
 * branch — the memory file changes are now safely committed on the promote
 * branch, so it's safe to "lose" them from the working tree.
 */
export function restoreOriginalBranch(context: PrContext) {
  try {
    run("git", ["checkout", context.originalBranch], context.cwd);
  } catch {
    // Best-effort — leave the user on the promote branch if checkout fails
    // (e.g. uncommitted unrelated dirt that would conflict).
  }
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

/**
 * Convenience wrapper for the legacy "apply-then-PR" flow: callers that
 * already wrote files in the working tree before the branch was switched.
 * Intentionally does NOT rollback on failure — those file modifications
 * represent work the user explicitly approved (interactive review), so
 * destroying them on a PR-creation hiccup would lose user work. The user
 * is left on the promote branch and can retry / inspect.
 *
 * For new code that does its own apply, prefer prepareBranchForPr +
 * finalizePr — they make atomic rollback opt-in and explicit.
 */
export async function createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
  const context = prepareBranchForPr({
    branch: input.branch,
    baseBranch: input.baseBranch,
    cwd: input.cwd,
  });

  return finalizePr({
    context,
    title: input.title,
    body: input.body,
    files: input.files,
    repo: input.repo,
    labels: input.labels,
    octokit: input.octokit,
  });
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

    // Resolve a stable PR reference from the URL. `gh pr edit <branch>` can
    // be ambiguous when multiple PRs exist for a branch; the PR number is not.
    const prNumberMatch = url.match(/\/pull\/(\d+)\b/);
    const prRef = prNumberMatch ? prNumberMatch[1] : input.branch;

    // Step 2: attach labels as best-effort. Auto-create missing labels via
    // `gh label create --force`. Surface any failures to stderr so the user
    // notices when the labels they expected didn't land (previous version
    // swallowed both steps silently).
    for (const label of input.labels ?? []) {
      try {
        ensureLabelExists(label, cwd);
      } catch (e) {
        process.stderr.write(
          `[promote] could not create label '${label}': ${e instanceof Error ? e.message : String(e)}\n`,
        );
        continue;
      }
      try {
        run("gh", ["pr", "edit", prRef, "--add-label", label], cwd);
      } catch (e) {
        process.stderr.write(
          `[promote] could not attach label '${label}' to PR #${prRef}: ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }

    return url;
  } finally {
    try { unlinkSync(bodyFile); } catch { /* ignore */ }
  }
}

function ensureLabelExists(label: string, cwd: string) {
  // `gh label create --force` is idempotent: creates if missing, updates
  // color/description if present. Throws (via our wrapped run) on real
  // failures like missing permissions.
  run("gh", [
    "label", "create", label,
    "--color", "B660CD",
    "--description", "Repository memory promotion (promote-cli)",
    "--force",
  ], cwd);
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
