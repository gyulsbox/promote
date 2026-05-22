import * as p from "@clack/prompts";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import chalk from "chalk";
import { createOctokit, parseRepoRef } from "../../ingest/github-client.js";
import { fetchReviewComments, computeSinceDate } from "../../ingest/comment-fetcher.js";
import { filterAIReviewComments } from "../../filter/ai-reviewer-filter.js";
import { filterNoise } from "../../filter/noise-filter.js";
import { normalizeComments } from "../../normalize/normalizer.js";
import { preCluster } from "../../cluster/pre-cluster.js";
import { scanExistingMemory } from "../../memory/memory-scanner.js";
import { classifyCluster } from "../../classify/route-classifier.js";
import { generateDraft } from "../../draft/draft-generator.js";
import { renderDigest } from "../../digest/digest-renderer.js";
import { resolveModels } from "../../llm/provider.js";
import { CostTracker } from "../../llm/cost-tracker.js";
import { loadConfig } from "../../core/config.js";
import { initDatabase } from "../../storage/db.js";
import {
  upsertComments,
  resetExpiredSnoozes,
  upsertCandidateRecord,
  listCandidates,
  saveCluster,
  updateCandidateStatus,
} from "../../storage/repositories.js";
import { buildReplyContextMap } from "../../ingest/reply-context.js";
import { aggregateHumanSignal } from "../../core/human-signal.js";
import type { PromotionCandidate, AnalysisStats } from "../../core/types.js";
import * as out from "../output.js";
import { mascotSays, mascotHappy } from "../mascot.js";
import { createTimedSpinner, getClassifyMessage, getDraftMessage, getClusterMessage } from "../thinking.js";
import { runInteractiveReview } from "./review.js";
import { applyPromotion } from "./promote.js";

const CLOSING_QUOTES: Record<string, string[]> = {
  en: [
    "\"The human reviewer's role is no longer to trace code details,",
    " but to measure the distance between decisions and implementation.\"",
  ],
  ko: [
    "\"AI 시대의 인간 리뷰어의 역할은 코드의 세부를 추적하는 것이 아니라,",
    " 의사결정과 구현의 거리를 측정하는 것으로 이동하고 있다.\"",
  ],
  ja: [
    "\"人間のレビューはコードの細部を追う行為から、",
    " 意思決定と実装の距離を測る行為へ移っていく。\"",
  ],
};

export type ScanOptions = {
  repo?: string;
  since?: string;
  config?: string;
  out?: string;
  verbose?: boolean;
};

export async function runScan(options: ScanOptions) {
  const config = loadConfig(options.config);
  const repoStr = options.repo ?? detectCurrentRepo();
  const repo = parseRepoRef(repoStr);
  const sinceDays = options.since
    ? parseSinceDays(options.since)
    : config.thresholds.windowDays;
  const sinceDate = computeSinceDate(sinceDays);

  mascotSays(`Scanning ${repo.fullName} (last ${sinceDays} days)`);

  const octokit = createOctokit();
  const models = resolveModels(config.llm);
  const costTracker = new CostTracker(config.llm.classificationModel);

  const llmOnly = !models.embeddingModel;
  out.stat(
    "Provider",
    `${config.llm.provider}${llmOnly ? " (LLM-direct clustering — no embedding API, llmRefine inactive)" : " (embeddings + HAC + llmRefine)"}`,
  );
  out.stat(
    "Models",
    llmOnly
      ? `${config.llm.classificationModel} (classify) + ${config.llm.draftingModel} (draft)`
      : `${config.llm.classificationModel} (classify) + ${config.llm.draftingModel} (draft) + ${config.llm.embeddingModel} (embed)`,
  );
  out.stat("Output language", config.language.preferredOutput);
  out.divider();

  // 1. Fetch
  const fetchSpinner = out.spinner("Fetching review comments...");
  const allComments = await fetchReviewComments(octokit, repo, sinceDate, (count) => {
    fetchSpinner.text = `Fetching review comments... ${chalk.dim(`(${count})`)}`;
  });
  fetchSpinner.succeed(`Fetched ${allComments.length} review comments`);

  if (allComments.length === 0) {
    mascotSays("No review comments found.");
    return;
  }

  // 2. Filter
  const { ai, human } = filterAIReviewComments(allComments, config.aiReviewers);
  out.stat("AI reviewer comments", ai.length);
  out.stat("Human comments", human.length);

  if (ai.length === 0) {
    mascotSays("No AI reviewer comments found. Check aiReviewers config.");
    return;
  }

  const { kept, discarded } = filterNoise(ai);
  out.stat("Actionable AI comments", kept.length);
  out.stat("Noise filtered", discarded.length);

  // 3. Store
  const { db } = initDatabase();
  upsertComments(db, allComments, repo.fullName);

  // Re-activate snoozed candidates whose snooze period has expired
  const reactivated = resetExpiredSnoozes(db, repo.fullName);
  if (reactivated > 0) {
    out.info(`${reactivated} snoozed candidate(s) reactivated (snooze period expired)`);
  }

  // 4. Normalize
  const normalizeSpinner = out.spinner("Normalizing...");
  const normalized = normalizeComments(kept);
  normalizeSpinner.succeed(`Normalized ${normalized.length} comments`);

  const uniquePrs = new Set(normalized.map((c) => c.prNumber));
  out.stat("PRs scanned", uniquePrs.size);

  // 5. Pre-cluster
  const clusterSpinner = out.spinner("");
  const clusterTimer = createTimedSpinner(
    clusterSpinner,
    getClusterMessage,
    chalk.dim(`[clustering]`),
  );
  const { clusters, mode } = await preCluster({
    comments: normalized,
    embeddingModel: models.embeddingModel,
    classificationModel: models.classificationModel,
    similarityThreshold: config.thresholds.similarityThreshold,
    costTracker,
    onProgress: () => {},
  });
  clusterTimer.stop();
  const modeLabel = mode === "llm" ? "LLM direct" : "embedding";
  clusterSpinner.succeed(`Found ${clusters.length} clusters (${modeLabel}) ${chalk.dim(`(${clusterTimer.getElapsed()}s)`)}`);

  // "Repeated" = total members >= minOccurrences. Cross-PR (members from 2+
  // distinct PRs) is the higher-value signal for repository memory; within-PR
  // (chatty bot in one review) is lower priority but still valid as duplicate
  // evidence. Both are surfaced; the scope is shown per candidate so users can
  // visually prioritize.
  const repeatedClusters = clusters.filter(
    (c) => c.members.length >= config.thresholds.minOccurrences,
  );
  const crossPrCount = repeatedClusters.filter(
    (c) => new Set(c.members.map((m) => m.prNumber)).size >= 2,
  ).length;
  const withinPrCount = repeatedClusters.length - crossPrCount;
  out.stat(
    "Repeated clusters",
    `${repeatedClusters.length} (>= ${config.thresholds.minOccurrences} members)${
      repeatedClusters.length > 0
        ? chalk.dim(` · ${crossPrCount} cross-PR, ${withinPrCount} within-PR`)
        : ""
    }`,
  );

  // Sort: cross-PR clusters (higher-value signal) come first
  repeatedClusters.sort((a, b) => {
    const aPrs = new Set(a.members.map((m) => m.prNumber)).size;
    const bPrs = new Set(b.members.map((m) => m.prNumber)).size;
    return bPrs - aPrs;
  });

  if (repeatedClusters.length === 0) {
    out.divider();
    mascotSays("No repeated patterns found. Try --since 90d or lower thresholds.");
    return;
  }

  out.divider();

  // 6. Build reply context map (human replies + reactions on bot comments)
  let replyContextMap: Awaited<ReturnType<typeof buildReplyContextMap>>;
  try {
    replyContextMap = await buildReplyContextMap(ai, human, models.classificationModel, costTracker);
  } catch {
    replyContextMap = new Map();
  }

  // Coverage diagnostic: how many bot comments actually received a human reply
  // or reaction? Low coverage explains sparse Human signal blocks in the digest.
  // Note: this endpoint (pulls.listReviewCommentsForRepo) returns line-comments
  // only; general PR conversation lives in issues.listComments and is not fetched.
  let botsWithReply = 0;
  let botsWithReaction = 0;
  for (const ctx of replyContextMap.values()) {
    if (ctx.replies.length > 0) botsWithReply++;
    if (ctx.reactions.plusOne + ctx.reactions.minusOne > 0) botsWithReaction++;
  }
  out.stat(
    "Human signal coverage",
    `${botsWithReply} replies + ${botsWithReaction} reactions / ${ai.length} bot comments` +
      (botsWithReply + botsWithReaction === 0
        ? chalk.dim(" (most resolved silently; general PR conversation not fetched)")
        : ""),
  );

  // 7. Scan existing memory
  const memSpinner = out.spinner("Scanning existing memory files...");
  const memoryContext = await scanExistingMemory(octokit, repo, config.memoryTargets);
  memSpinner.succeed(
    memoryContext.files.length > 0
      ? `Found ${memoryContext.files.length} existing memory file(s)`
      : "No existing memory files found",
  );

  // 8. Pre-assign stable candidate IDs from SQLite
  // Same cluster fingerprint → same ID across scans. New clusters get max+1.
  const allExisting = listCandidates(db, repo.fullName);
  const fingerprintToRecord = new Map(
    allExisting
      .filter((r) => r.clusterFingerprint)
      .map((r) => [r.clusterFingerprint!, r]),
  );
  let maxNum = 0;
  for (const r of allExisting) {
    const m = r.id.match(/candidate_(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }
  let nextNewNum = maxNum + 1;

  const preAssignedIds = new Map<string, string>(); // fingerprint → candidate ID
  for (const cluster of repeatedClusters) {
    const existing = fingerprintToRecord.get(cluster.fingerprint);
    if (existing?.status === "promoted" || existing?.status === "ignored") continue;
    preAssignedIds.set(
      cluster.fingerprint,
      existing?.id ?? `candidate_${String(nextNewNum++).padStart(3, "0")}`,
    );
  }

  // 9. Classify + Draft (parallel with ordered output)
  const CONCURRENCY = 3;
  const total = repeatedClusters.length;
  const candidates: PromotionCandidate[] = [];
  let failedClusters = 0;

  type ClusterResult = {
    index: number;
    candidate: PromotionCandidate | null;
    summary: string;
    skipped: boolean;
    target?: string;
    confidence?: number;
  };

  const resultBuffer: (ClusterResult | undefined)[] = new Array(total);
  let nextToPrint = 0;

  const activeSpinner = out.spinner("");
  const activeTimer = createTimedSpinner(
    activeSpinner,
    getClassifyMessage,
    chalk.dim(`[1/${total}]`),
  );

  const flushBuffer = () => {
    while (nextToPrint < total && resultBuffer[nextToPrint] !== undefined) {
      const r = resultBuffer[nextToPrint]!;
      const progress = chalk.dim(`[${r.index + 1}/${total}]`);
      activeSpinner.clear();

      const cols = process.stdout.columns || 80;
      const prefix = `  ${progress} `;

      if (r.skipped) {
        const maxSummary = cols - prefix.length - 8;
        console.log(`${prefix}${chalk.dim("skip")} — ${chalk.dim(truncate(r.summary, maxSummary))}`);
      } else if (r.candidate) {
        candidates.push(r.candidate);
        const badge = `[${r.target}] `;
        const suffix = ` (${r.confidence?.toFixed(2)})`;
        const maxSummary = cols - prefix.length - badge.length - suffix.length - 1;
        console.log(`${prefix}${chalk.cyan(`[${r.target}]`)} ${truncate(r.summary, maxSummary)} ${chalk.dim(`(${r.confidence?.toFixed(2)})`)}`);
      }

      nextToPrint++;
    }
    if (nextToPrint < total) activeSpinner.start();
  };

  const processCluster = async (cluster: typeof repeatedClusters[0], index: number): Promise<void> => {
    const existing = fingerprintToRecord.get(cluster.fingerprint);
    if (existing?.status === "promoted" || existing?.status === "ignored") {
      resultBuffer[index] = { index, candidate: null, summary: existing.summary, skipped: true };
      flushBuffer();
      return;
    }

    try {
      const humanSignal = aggregateHumanSignal(cluster, replyContextMap);

      const decision = await classifyCluster({
        cluster,
        model: models.classificationModel,
        memoryContext,
        costTracker,
        outputLanguage: config.language.preferredOutput,
        redact: config.privacy.redactSecrets,
        humanSignal,
        includeDiffHunks: config.privacy.sendDiffHunksToLLM,
      });

      if (!decision.clusterValid || decision.target === "none" || decision.target === "pr_only") {
        resultBuffer[index] = { index, candidate: null, summary: decision.summary ?? "not promotable", skipped: true };
        flushBuffer();
        return;
      }

      if (decision.confidence < config.thresholds.minConfidence) {
        resultBuffer[index] = { index, candidate: null, summary: decision.summary ?? "", skipped: true };
        flushBuffer();
        return;
      }

      const draft = await generateDraft({
        cluster,
        decision,
        model: models.draftingModel,
        costTracker,
        preferredLanguage: config.language.preferredOutput,
        redact: config.privacy.redactSecrets,
      });

      const candidateId = preAssignedIds.get(cluster.fingerprint) ?? `candidate_${String(nextNewNum++).padStart(3, "0")}`;

      resultBuffer[index] = {
        index,
        candidate: {
          id: candidateId,
          repo: repo.fullName,
          clusterId: cluster.id,
          clusterFingerprint: cluster.fingerprint,
          summary: decision.summary,
          target: decision.target,
          confidence: decision.confidence,
          suggestedFile: decision.suggestedFile ?? draft.targetFile,
          pathScope: decision.pathScope,
          draft,
          reasoning: decision.reason,
          alternatives: decision.alternatives,
          occurrences: cluster.members.map((m) => ({
            prNumber: m.prNumber,
            path: m.filePath,
            url: m.htmlUrl,
            excerpt: m.normalizedBody.slice(0, 150),
            authorLogin: m.authorLogin,
            createdAt: m.createdAt,
          })),
          status: decision.needsHumanDecision ? "needs_human_decision" as const : "candidate" as const,
          humanSignal,
        },
        summary: decision.summary,
        skipped: false,
        target: decision.target,
        confidence: decision.confidence,
      };
      flushBuffer();
    } catch (err) {
      failedClusters++;
      const msg = err instanceof Error ? err.message : String(err);
      resultBuffer[index] = {
        index,
        candidate: null,
        summary: `failed: ${msg.slice(0, 80)}`,
        skipped: true,
      };
      flushBuffer();
    }
  };

  // Run with concurrency limit
  const queue = repeatedClusters.map((c, i) => ({ cluster: c, index: i }));
  let completed = 0;

  const runNext = async (): Promise<void> => {
    const item = queue.shift();
    if (!item) return;

    await processCluster(item.cluster, item.index);
    completed++;

    // Update spinner progress — show next item being processed
    activeTimer.stop();
    if (completed < total) {
      Object.assign(activeTimer, createTimedSpinner(
        activeSpinner,
        getClassifyMessage,
        chalk.dim(`[${completed + 1}/${total}]`),
      ));
    }

    await runNext();
  };

  const running: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
    running.push(runNext());
  }
  await Promise.all(running);

  activeTimer.stop();
  activeSpinner.stop();

  if (failedClusters > 0) {
    out.warn(`${failedClusters} cluster(s) failed during classify/draft and were skipped — see summary line above.`);
  }

  // Persist clusters + candidates to DB for cross-run dedup
  // Clusters must be inserted first (candidates FK → clusters)
  const clusterMap = new Map(repeatedClusters.map((c) => [c.id, c]));
  for (const c of candidates) {
    const cluster = clusterMap.get(c.clusterId);
    if (cluster) {
      saveCluster(
        db,
        cluster.id,
        repo.fullName,
        cluster.fingerprint,
        cluster.representative.id,
        cluster.members.length,
        cluster.representativeEmbedding,
      );
    }
  }
  for (const c of candidates) {
    upsertCandidateRecord(db, {
      id: c.id,
      repo: c.repo,
      clusterId: c.clusterId,
      clusterFingerprint: c.clusterFingerprint,
      target: c.target,
      confidence: c.confidence,
      summary: c.summary,
      reason: c.reasoning,
      suggestedFile: c.suggestedFile,
      pathScope: c.pathScope,
      draftContent: c.draft.content,
      alternativesJson: JSON.stringify(c.alternatives),
      humanSignalJson: c.humanSignal ? JSON.stringify(c.humanSignal) : null,
      status: c.status,
    });
  }

  out.divider();

  // Cost
  const cost = costTracker.getSummary();
  out.stat("Total tokens", cost.totalPromptTokens + cost.totalCompletionTokens);
  out.stat("Estimated cost", `$${cost.estimatedCostUSD}`);

  out.divider();

  if (candidates.length === 0) {
    mascotSays("All clusters were filtered out. Nothing to promote.");
    return;
  }

  // Write digest
  const stats: AnalysisStats = {
    totalComments: allComments.length,
    aiComments: ai.length,
    noisyComments: discarded.length,
    clustersFound: clusters.length,
    repeatedClusters: repeatedClusters.length,
    candidatesGenerated: candidates.length,
    failedClusters,
    prCount: uniquePrs.size,
    promptTokens: cost.totalPromptTokens,
    completionTokens: cost.totalCompletionTokens,
    estimatedCostUSD: cost.estimatedCostUSD,
  };

  const digest = renderDigest(
    candidates,
    stats,
    repo.fullName,
    config.language.preferredOutput,
    config,
    !llmOnly,
    sinceDays,
  );
  const digestDir = resolve(process.cwd(), ".promote", "digests");
  if (!existsSync(digestDir)) {
    mkdirSync(digestDir, { recursive: true });
  }

  const date = new Date().toISOString().split("T")[0];
  const digestPath = options.out ?? resolve(digestDir, `${date}.md`);
  writeFileSync(digestPath, digest, "utf-8");

  mascotHappy(`${candidates.length} candidate(s) found!`);
  out.success(`Digest written to ${digestPath}`);

  // CLI summary of candidates
  console.log();
  const targetCounts: Record<string, number> = {};
  for (const c of candidates) {
    targetCounts[c.target] = (targetCounts[c.target] ?? 0) + 1;
  }
  for (const [target, count] of Object.entries(targetCounts)) {
    out.info(`  ${chalk.cyan(target)}: ${count} candidate(s)`);
  }
  console.log();

  // Top candidates preview
  for (const c of candidates.slice(0, 3)) {
    console.log(`  ${chalk.cyan(`[${c.target}]`)} ${c.summary}`);
    console.log(chalk.dim(`    → ${c.suggestedFile} (confidence: ${c.confidence})`));
  }
  if (candidates.length > 3) {
    console.log(chalk.dim(`  ... and ${candidates.length - 3} more in digest`));
  }

  // Check if scanned repo matches current directory's repo
  out.divider();

  const isLocalRepo = checkIsLocalRepo(repo.fullName);

  if (!isLocalRepo) {
    const remoteAction = await p.select({
      message: `You scanned ${chalk.bold(repo.fullName)} but this isn't your local repo. Promoting here would write files to your current directory.`,
      options: [
        { value: "digest-only", label: "Keep digest only (recommended)", hint: "review and promote in the target repo" },
        { value: "review", label: "Review anyway", hint: "files will be written to current directory" },
      ],
    });

    if (p.isCancel(remoteAction)) {
      out.info("Cancelled.");
      process.exit(130);
    }
    if (remoteAction === "digest-only") {
      out.info(`Digest saved: ${chalk.bold(digestPath)}`);
      out.info("Clone the target repo and run promote there to apply changes.");
      return;
    }
  }

  const reviewNow = await p.select({
    message: "Review candidates now?",
    options: [
      { value: "interactive", label: "Yes, review one by one", hint: "decide per candidate" },
      { value: "later", label: "No, I'll review the digest later", hint: digestPath },
    ],
  });

  if (p.isCancel(reviewNow)) {
    out.info("Cancelled.");
    process.exit(130);
  }
  if (reviewNow === "later") {
    out.info(`Digest: ${chalk.bold(digestPath)}`);
    out.info(`Promote later: ${chalk.dim("promote candidate_001")}  ${chalk.dim("# or: promote review")}`);
    return;
  }

  // Interactive review — each approval writes immediately
  const { promoted, skipped } = await runInteractiveReview(
    candidates,
    async (candidate, target) => {
      await applyPromotion(candidate, target);
      updateCandidateStatus(db, candidate.id, "promoted");
    },
  );

  out.divider();

  if (skipped > 0) out.info(`${skipped} candidate(s) skipped. Review later: ${chalk.dim("promote review")}`);
  out.info(`Full digest: ${chalk.bold(digestPath)}`);

  if (promoted > 0) {
    out.divider();
    const quote = CLOSING_QUOTES[config.language.preferredOutput] ?? CLOSING_QUOTES.en;
    console.log();
    for (const line of quote) {
      console.log(chalk.dim.italic(`  ${line}`));
    }
    console.log();
    mascotHappy(`Done! ${promoted} candidate(s) promoted.`);
    out.info("Review the modified files, then commit when ready.");
  }
}

function checkIsLocalRepo(scannedRepo: string): boolean {
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const normalized = scannedRepo.toLowerCase();
    return url.toLowerCase().includes(normalized);
  } catch {
    return false;
  }
}

function detectCurrentRepo(): string {
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // git@github.com:owner/repo.git
    const sshMatch = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (sshMatch) return sshMatch[1];

    // https://github.com/owner/repo.git
    const httpsMatch = url.match(/github\.com\/([^/]+\/[^/.]+)/);
    if (httpsMatch) return httpsMatch[1];
  } catch {
    // not a git repo or no remote
  }

  throw new Error(
    "Could not detect repo. Use --repo owner/repo or run from a git repo with a GitHub remote.",
  );
}

function parseSinceDays(since: string): number {
  const match = since.match(/^(\d+)d$/);
  if (match) return Number(match[1]);

  const num = Number(since);
  if (!Number.isNaN(num) && num > 0) return num;

  throw new Error(`Invalid --since value: "${since}". Use format like "60d" or "60".`);
}

function truncate(text: string, max: number): string {
  if (max < 4) return "...";
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
