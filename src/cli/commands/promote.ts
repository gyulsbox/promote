import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import * as p from "@clack/prompts";
import type { PromotionCandidate } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { initDatabase } from "../../storage/db.js";
import { getCandidateById, listCandidates, updateCandidateStatus } from "../../storage/repositories.js";
import * as out from "../output.js";
import { mascotHappy, mascotSays } from "../mascot.js";
import { printCandidateDetails, runInteractiveReview } from "./review.js";
import { notifyIfOutdated } from "../update-check.js";
import { createOctokit } from "../../ingest/github-client.js";
import { buildSingleBranchName } from "../../pr/branch.js";
import { findPullRequestTemplate, buildSinglePrBody, buildSinglePrTitle } from "../../pr/template.js";
import { fillTemplateWithLlm } from "../../pr/llm-fill.js";
import { createPullRequest, hasGhCli, isGhAuthenticated } from "../../pr/create.js";
import { resolveModels } from "../../llm/provider.js";
import { CostTracker } from "../../llm/cost-tracker.js";

export type PromoteOptions = {
  target?: string;
  file?: string;
  config?: string;
  createPr?: boolean;
  baseBranch?: string;
};

export type ApplyPromotionResult =
  | { applied: true; targetFile: string }
  | { applied: false; reason: "invalid-target" | "missing-file-declined" };

/**
 * Core write function used by both interactive review and standalone promote.
 * Handles file creation prompt if the target file doesn't exist.
 */
export async function applyPromotion(
  candidate: PromotionCandidate,
  target: string,
  opts: { suppressPrompts?: boolean } = {},
): Promise<ApplyPromotionResult> {
  const config = loadConfig();
  const targetFile = resolveTargetFile(target, candidate, config);

  if (!isValidFilePath(targetFile)) {
    out.warn(`${candidate.id}: target "${target}" doesn't produce a writable file. Skipping.`);
    return { applied: false, reason: "invalid-target" };
  }

  const cwd = process.cwd();
  const fullPath = resolve(cwd, targetFile);

  if (!existsSync(fullPath)) {
    let create: boolean;
    if (opts.suppressPrompts) {
      create = true;
    } else {
      const answer = await p.confirm({
        message: `${targetFile} doesn't exist. Create it?`,
      });
      if (p.isCancel(answer)) {
        out.info("Cancelled.");
        process.exit(130);
      }
      create = answer;
    }

    if (!create) {
      out.info(`Skipped ${candidate.id}. Create the file manually and run again.`);
      return { applied: false, reason: "missing-file-declined" };
    }

    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, "", "utf-8");
  }

  const existing = readFileSync(fullPath, "utf-8");
  const separator = existing.length > 0 && !existing.endsWith("\n\n") ? "\n\n" : "";
  writeFileSync(fullPath, existing + separator + candidate.draft.content + "\n", "utf-8");
  out.success(`Promoted to ${chalk.bold(targetFile)}: ${candidate.summary}`);
  return { applied: true, targetFile };
}

/**
 * `promote <candidateId>` — load from DB, show details, confirm, apply.
 */
export async function runPromote(candidateId: string, options: PromoteOptions) {
  await notifyIfOutdated();
  const config = loadConfig(options.config);
  const { db } = initDatabase();

  const row = getCandidateById(db, candidateId);
  if (!row) {
    out.error(`Candidate ${candidateId} not found. Run 'promote scan' first.`);
    return;
  }

  const candidate: PromotionCandidate = {
    id: row.id,
    repo: row.repo,
    clusterId: row.clusterId ?? "",
    clusterFingerprint: row.clusterFingerprint ?? undefined,
    summary: row.summary,
    target: (options.target ?? row.target) as PromotionCandidate["target"],
    confidence: row.confidence,
    suggestedFile: options.file ?? row.suggestedFile ?? undefined,
    pathScope: row.pathScope ?? undefined,
    draft: { targetFile: row.suggestedFile ?? "", content: row.draftContent ?? "", insertionHint: "" },
    reasoning: row.reason,
    alternatives: JSON.parse(row.alternativesJson ?? "[]"),
    occurrences: [],
    status: row.status as PromotionCandidate["status"],
    humanSignal: row.humanSignalJson ? JSON.parse(row.humanSignalJson) : undefined,
  };

  if (!candidate.draft.content) {
    out.error(`No draft content for ${candidateId}.`);
    return;
  }

  printCandidateDetails(candidate, "1/1");

  const target = options.target ?? row.target;
  const targetFile = options.file ?? resolveTargetFile(target, candidate, config);

  const confirmed = await p.confirm({
    message: `Apply to ${chalk.bold(targetFile)}?`,
  });

  if (p.isCancel(confirmed)) {
    out.info("Cancelled.");
    process.exit(130);
  }
  if (!confirmed) {
    out.info("Skipped.");
    return;
  }

  const result = await applyPromotion(candidate, target);
  if (!result.applied) {
    return;
  }
  updateCandidateStatus(db, candidateId, "promoted");

  if (options.createPr) {
    await openSinglePr(candidate, result.targetFile, options.baseBranch);
  }
}

async function openSinglePr(candidate: PromotionCandidate, targetFile: string, baseBranch?: string) {
  const ghAvailable = hasGhCli() && isGhAuthenticated();
  if (!ghAvailable && !process.env.GITHUB_TOKEN) {
    out.error("`gh` CLI not authenticated and GITHUB_TOKEN not set — cannot open a PR.");
    out.info("Run `gh auth login` or export GITHUB_TOKEN, then re-run with --create-pr.");
    process.exit(1);
  }

  const localRepo = detectLocalRepoSilent();
  const prRepo = localRepo ?? candidate.repo;
  if (localRepo && localRepo !== candidate.repo) {
    out.info(`PR target: ${chalk.bold(localRepo)} (candidate's source repo was ${candidate.repo}).`);
  }

  const octokit = ghAvailable ? undefined : createOctokit();
  const config = loadConfig();
  const date = new Date();
  const branch = buildSingleBranchName(candidate.id, date);
  const title = buildSinglePrTitle({ summary: candidate.summary });
  const template = findPullRequestTemplate();
  const candidateWithFile = { ...candidate, targetFile };

  let prefilledHeader: string | undefined;
  if (template) {
    const fillSpin = out.spinner(`Filling ${template.path} with LLM...`);
    try {
      const models = resolveModels(config.llm);
      const costTracker = new CostTracker(config.llm.draftingModel);
      prefilledHeader = await fillTemplateWithLlm({
        templateBody: template.body,
        facts: {
          candidates: [candidateWithFile],
          sinceDays: config.thresholds.windowDays,
        },
        model: models.draftingModel,
        costTracker,
        outputLanguage: config.language.preferredOutput,
      });
      fillSpin.succeed(`Filled ${template.path} (LLM)`);
    } catch (err) {
      fillSpin.warn(
        `LLM template fill failed; passing the template through unfilled. (${err instanceof Error ? err.message : String(err)})`,
      );
      prefilledHeader = template.body;
    }
  }

  const body = buildSinglePrBody({
    candidate: candidateWithFile,
    date,
    prefilledHeader,
  });

  out.divider();
  const spin = out.spinner(`Opening PR via ${ghAvailable ? "gh" : "octokit"}...`);
  try {
    const result = await createPullRequest({
      branch,
      title,
      body,
      files: [targetFile],
      repo: prRepo,
      baseBranch,
      labels: ["memory-promotion"],
      octokit,
    });
    spin.succeed(`PR opened: ${result.url}`);
  } catch (err) {
    spin.fail("PR creation failed.");
    throw err;
  }
}

function detectLocalRepoSilent(): string | null {
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const sshMatch = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (sshMatch) return sshMatch[1];
    const httpsMatch = url.match(/github\.com\/([^/]+\/[^/.]+)/);
    if (httpsMatch) return httpsMatch[1];
    return null;
  } catch {
    return null;
  }
}

/**
 * `promote review` — list all pending candidates, let user select, then review selected.
 */
export async function runReview(options: { config?: string }) {
  await notifyIfOutdated();
  const config = loadConfig(options.config);
  const { db } = initDatabase();

  let repo: string;
  try {
    const { execSync } = await import("node:child_process");
    const url = execSync("git remote get-url origin", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    repo = match ? match[1] : "";
  } catch {
    repo = "";
  }

  if (!repo) {
    out.error("No GitHub remote detected on the current directory.");
    out.info("Run 'promote review' inside a cloned GitHub repo, or 'promote <candidateId>' to target a known ID directly.");
    return;
  }

  const allRows = listCandidates(db, repo);
  const rows = allRows.filter(
    (r) => r.status === "candidate" || r.status === "needs_human_decision",
  );

  if (rows.length === 0) {
    mascotSays(`No pending candidates in ${repo}. Run 'promote scan' first.`);
    return;
  }

  const allCandidates: PromotionCandidate[] = rows.map((row) => ({
    id: row.id,
    repo: row.repo,
    clusterId: row.clusterId ?? "",
    clusterFingerprint: row.clusterFingerprint ?? undefined,
    summary: row.summary,
    target: row.target as PromotionCandidate["target"],
    confidence: row.confidence,
    suggestedFile: row.suggestedFile ?? undefined,
    pathScope: row.pathScope ?? undefined,
    draft: { targetFile: row.suggestedFile ?? "", content: row.draftContent ?? "", insertionHint: "" },
    reasoning: row.reason,
    alternatives: JSON.parse(row.alternativesJson ?? "[]"),
    occurrences: [],
    status: row.status as PromotionCandidate["status"],
    humanSignal: row.humanSignalJson ? JSON.parse(row.humanSignalJson) : undefined,
  }));

  console.log();
  mascotSays(`${allCandidates.length} pending candidate(s) in ${repo}`);
  console.log();

  // Show list and let user pick which ones to review
  const selected = await p.multiselect({
    message: "Select candidates to review (space to toggle, enter to confirm):",
    options: allCandidates.map((c) => ({
      value: c.id,
      label: `${c.status === "needs_human_decision" ? chalk.yellow("⚠ ") : ""}${chalk.cyan(`[${c.target}]`)} ${c.summary}`,
      hint: `${c.id} · confidence ${c.confidence}${c.status === "needs_human_decision" ? " · needs review" : ""}`,
    })),
    required: false,
  });

  if (p.isCancel(selected)) {
    out.info("Cancelled.");
    process.exit(130);
  }
  if ((selected as string[]).length === 0) {
    out.info("Nothing selected.");
    return;
  }

  const toReview = allCandidates.filter((c) => (selected as string[]).includes(c.id));

  const { promoted, skipped } = await runInteractiveReview(
    toReview,
    async (candidate, target) => {
      await applyPromotion(candidate, target);
      updateCandidateStatus(db, candidate.id, "promoted");
    },
  );

  out.divider();
  if (promoted > 0) {
    mascotHappy(`Done! ${promoted} candidate(s) promoted.`);
    out.info("Review the modified files, then commit when ready.");
  } else {
    mascotSays(`${skipped} candidate(s) skipped. Come back anytime: promote review`);
  }
}

function isValidFilePath(filePath: string): boolean {
  if (filePath.startsWith("(")) return false;
  if (filePath.includes("—")) return false;
  if (!filePath.includes(".") && !filePath.includes("/")) return false;
  const knownFiles = ["AGENTS.md", "CLAUDE.md", "README.md"];
  if (knownFiles.includes(filePath)) return true;
  if (/\.\w{1,10}$/.test(filePath)) return true;
  return false;
}

export function resolveTargetFile(
  target: string,
  candidate: { suggestedFile?: string | null; pathScope?: string | null; summary?: string | null },
  config: ReturnType<typeof loadConfig>,
): string {
  if (target === "adr") {
    const dir = config.memoryTargets?.adr?.dir ?? "docs/adr";
    const slug = toSlug(candidate.summary ?? "decision") || "decision";
    const nextNum = getNextAdrNumber(dir);
    return `${dir}/${String(nextNum).padStart(3, "0")}-${slug}.md`;
  }

  if (target === "test") {
    const slug = toSlug(candidate.summary ?? "test") || "test";
    return `docs/test-stubs/${slug}.md`;
  }

  if (candidate.suggestedFile && isValidFilePath(candidate.suggestedFile)) {
    return candidate.suggestedFile;
  }

  switch (target) {
    case "agents": {
      const preferred = config.memoryTargets?.agents?.preferredFiles;
      return preferred?.[0] ?? "AGENTS.md";
    }
    case "path_scoped_rule": {
      const dir = config.memoryTargets?.pathScoped?.preferredDir ?? ".github/instructions";
      const scope = candidate.pathScope ?? "general";
      const slug = scope.replace(/[/*]/g, "-").replace(/^-+|-+$/g, "") || "rule";
      return `${dir}/${slug}.instructions.md`;
    }
    default:
      return "AGENTS.md";
  }
}

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, 50)
    .replace(/-+$/, "");
}

function getNextAdrNumber(adrDir: string): number {
  const fullDir = resolve(process.cwd(), adrDir);
  if (!existsSync(fullDir)) return 1;
  const files = readdirSync(fullDir);
  let maxNum = 0;
  for (const f of files) {
    const match = f.match(/^(\d+)-/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return maxNum + 1;
}
