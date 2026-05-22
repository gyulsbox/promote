import * as p from "@clack/prompts";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import chalk from "chalk";
import { createOctokit, parseRepoRef } from "../../ingest/github-client.js";
import { fetchReviewComments, fetchPrConversationComments, computeSinceDate } from "../../ingest/comment-fetcher.js";
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
import type { PromotionCandidate, AnalysisStats, SkipReason, SkippedItem } from "../../core/types.js";
import * as out from "../output.js";
import { mascotSays, mascotHappy } from "../mascot.js";
import { createTimedSpinner, getClassifyMessage, getDraftMessage, getClusterMessage } from "../thinking.js";
import { runInteractiveReview, runSkippedReview } from "./review.js";
import { applyPromotion, resolveTargetFile } from "./promote.js";
import { NAME, VERSION } from "../../version.js";
import { notifyIfOutdated } from "../update-check.js";
import { buildBranchName } from "../../pr/branch.js";
import { findPullRequestTemplate, buildBundledPrBody, buildBundledPrTitle } from "../../pr/template.js";
import { fillTemplateWithLlm } from "../../pr/llm-fill.js";
import { createPullRequest, finalizePr, hasGhCli, isGhAuthenticated, prepareBranchForPr, rollbackBranch, restoreOriginalBranch } from "../../pr/create.js";

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
  mode?: string;
  verbose?: boolean;
  // Commander maps `--no-interactive` to `options.interactive = false`.
  interactive?: boolean;
  minConfidence?: string;
  createPr?: boolean;
  baseBranch?: string;
  allowForeignScan?: boolean;
};

function detectHeadless(options: ScanOptions): boolean {
  if (options.interactive === false) return true;
  if (process.env.CI === "true") return true;
  if (!process.stdout.isTTY) return true;
  return false;
}

function parseMinConfidence(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`--min-confidence must be a number between 0 and 1 (got "${raw}").`);
  }
  return n;
}

export async function runScan(options: ScanOptions) {
  const runStartedAt = Date.now();
  const timings = {
    fetchMs: 0,
    normalizeMs: 0,
    clusterMs: 0,
    conversationFetchMs: 0,
    replyContextMs: 0,
    memoryScanMs: 0,
    classifyDraftMs: 0,
    totalMs: 0,
  };

  await notifyIfOutdated();
  const config = loadConfig(options.config);
  const headless = detectHeadless(options);
  const minConfidence = parseMinConfidence(options.minConfidence, config.thresholds.minConfidence);
  const wantCreatePr = options.createPr === true;

  if (wantCreatePr) {
    const ghOk = hasGhCli() && isGhAuthenticated();
    if (!ghOk && !process.env.GITHUB_TOKEN) {
      out.error("--create-pr requires `gh auth login` or GITHUB_TOKEN set in the environment.");
      process.exit(1);
    }
  }

  // --mode overrides clusteringStrategy at runtime
  if (options.mode) {
    const mode = options.mode.toLowerCase();
    if (mode === "quick") {
      config.llm.clusteringStrategy = "embedding";
    } else if (mode === "broad") {
      config.llm.clusteringStrategy = "llm-direct";
    } else {
      out.error(`Invalid --mode: "${options.mode}". Use 'quick' or 'broad'.`);
      process.exit(1);
    }
  }

  const repoStr = options.repo ?? detectCurrentRepo();
  const repo = parseRepoRef(repoStr);
  const sinceDays = options.since
    ? parseSinceDays(options.since)
    : config.thresholds.windowDays;
  const sinceDate = computeSinceDate(sinceDays);

  mascotSays(`Scanning ${repo.fullName} (last ${sinceDays} days)`);
  out.stat("Tool", `${NAME} v${VERSION}`);

  // Validate the chosen clustering strategy is achievable on this provider.
  // "quick" (embedding+HAC) needs an embedding model; Anthropic has none.
  // If the user explicitly asked for quick on Anthropic, offer to switch
  // provider to OpenAI for this run (if their key is set) before resolving
  // models — running the scan first and erroring later would waste time.
  if (
    config.llm.clusteringStrategy === "embedding" &&
    config.llm.provider === "anthropic"
  ) {
    out.warn(
      `Provider 'anthropic' has no embedding API — 'quick' mode (embedding+HAC) is not supported there.`,
    );

    if (headless) {
      out.error("Set llm.clusteringStrategy: llm-direct (or --mode broad), or switch to OpenAI/Google.");
      process.exit(1);
    }

    const hasOpenAiKey = !!process.env.OPENAI_API_KEY;
    const choice = await p.select({
      message: hasOpenAiKey
        ? "OPENAI_API_KEY detected. Switch this scan to OpenAI to use 'quick' mode?"
        : "OpenAI key not detected. How do you want to proceed?",
      options: hasOpenAiKey
        ? [
            { value: "switch", label: "Switch to OpenAI for this scan (recommended)", hint: "uses OpenAI defaults: gpt-4.1-mini + gpt-4.1-nano" },
            { value: "broad", label: "Stay on Anthropic and use 'broad' mode instead", hint: "LLM-direct clustering — Claude's natural strength" },
            { value: "cancel", label: "Cancel" },
          ]
        : [
            { value: "broad", label: "Use 'broad' mode on Anthropic (recommended)", hint: "LLM-direct clustering — Claude's natural strength" },
            { value: "instructions", label: "Show how to set OPENAI_API_KEY" },
            { value: "cancel", label: "Cancel" },
          ],
    });

    if (p.isCancel(choice) || choice === "cancel") {
      out.info("Cancelled.");
      process.exit(130);
    }
    if (choice === "instructions") {
      out.info("Set OPENAI_API_KEY in your environment, then re-run:");
      out.info("  export OPENAI_API_KEY=sk-...");
      out.info(`  promote scan --repo ${repo.fullName} --mode quick`);
      process.exit(0);
    }
    if (choice === "broad") {
      config.llm.clusteringStrategy = "llm-direct";
      out.info("Continuing with 'broad' mode on Anthropic.");
    }
    if (choice === "switch") {
      config.llm.provider = "openai";
      config.llm.classificationModel = "gpt-4.1-mini";
      config.llm.clusteringModel = "gpt-4.1-mini";
      config.llm.draftingModel = "gpt-4.1-nano";
      config.llm.embeddingModel = "text-embedding-3-small";
      out.info("Switched to OpenAI for this scan.");
    }
  }

  const octokit = createOctokit();
  const models = resolveModels(config.llm);
  const costTracker = new CostTracker(config.llm.classificationModel);

  const llmOnly = !models.embeddingModel;
  const forcedLlmDirect = config.llm.clusteringStrategy === "llm-direct" && !!models.embeddingModel;
  const effectiveCluster = config.llm.clusteringModel ?? config.llm.classificationModel;
  const clusterDifferent = effectiveCluster !== config.llm.classificationModel;
  const providerSuffix = llmOnly
    ? " (LLM-direct clustering — no embedding API, llmRefine inactive)"
    : forcedLlmDirect
      ? " (LLM-direct clustering — forced via clusteringStrategy, llmRefine inactive)"
      : " (embeddings + HAC + llmRefine)";
  out.stat("Provider", `${config.llm.provider}${providerSuffix}`);
  const embeddingActive = !llmOnly && !forcedLlmDirect;
  const modelParts: string[] = [`${config.llm.classificationModel} (classify)`];
  if (clusterDifferent || forcedLlmDirect) modelParts.push(`${effectiveCluster} (cluster)`);
  modelParts.push(`${config.llm.draftingModel} (draft)`);
  if (embeddingActive) modelParts.push(`${config.llm.embeddingModel} (embed)`);
  out.stat("Models", modelParts.join(" + "));
  out.stat("Output language", config.language.preferredOutput);
  out.divider();

  // 1. Fetch
  const fetchT0 = Date.now();
  const fetchSpinner = out.spinner("Fetching review comments...");
  const allComments = await fetchReviewComments(octokit, repo, sinceDate, (count) => {
    fetchSpinner.text = `Fetching review comments... ${chalk.dim(`(${count})`)}`;
  });
  timings.fetchMs = Date.now() - fetchT0;
  fetchSpinner.succeed(`Fetched ${allComments.length} review comments ${chalk.dim(`(${out.fmtDuration(timings.fetchMs)})`)}`);

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
  const normalizeT0 = Date.now();
  const normalizeSpinner = out.spinner("Normalizing...");
  const normalized = normalizeComments(kept);
  timings.normalizeMs = Date.now() - normalizeT0;
  normalizeSpinner.succeed(`Normalized ${normalized.length} comments ${chalk.dim(`(${out.fmtDuration(timings.normalizeMs)})`)}`);

  const uniquePrs = new Set(normalized.map((c) => c.prNumber));
  out.stat("PRs scanned", uniquePrs.size);

  // 5. Pre-cluster
  const clusterT0 = Date.now();
  const clusterSpinner = out.spinner("");
  // When the cluster step reports real progress (LLM-direct path emits
  // "[depth N] Batch X/Y..." lines), prefer that over the rotating mascot
  // message — keeps the user informed during multi-minute scans.
  let liveClusterMessage: string | null = null;
  const clusterTimer = createTimedSpinner(
    clusterSpinner,
    () => liveClusterMessage ?? getClusterMessage(),
    chalk.dim(`[clustering]`),
  );
  const { clusters, mode } = await preCluster({
    comments: normalized,
    embeddingModel: models.embeddingModel,
    classificationModel: models.classificationModel,
    clusteringModel: models.clusteringModel,
    clusteringStrategy: config.llm.clusteringStrategy,
    similarityThreshold: config.thresholds.similarityThreshold,
    costTracker,
    onProgress: (msg) => {
      liveClusterMessage = msg;
    },
  });
  clusterTimer.stop();
  timings.clusterMs = Date.now() - clusterT0;
  const modeLabel = mode === "llm" ? "LLM direct" : "embedding";
  clusterSpinner.succeed(`Found ${clusters.length} clusters (${modeLabel}) ${chalk.dim(`(${out.fmtDuration(timings.clusterMs)})`)}`);

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
  // Fetches both inline review-line replies and general PR conversation comments.
  // General comments lack in_reply_to_id, so they're matched to specific bot
  // comments via a per-PR LLM call (skipped when the PR has only one bot comment).
  const prNumbers = new Set(ai.map((c) => c.prNumber));
  const convT0 = Date.now();
  const convSpinner = out.spinner("Fetching PR conversation comments...");
  let generalHuman: typeof ai = [];
  try {
    generalHuman = await fetchPrConversationComments(octokit, repo, prNumbers, sinceDate, config.aiReviewers);
    timings.conversationFetchMs = Date.now() - convT0;
    convSpinner.succeed(`Fetched ${generalHuman.length} human PR conversation comment(s) ${chalk.dim(`(${out.fmtDuration(timings.conversationFetchMs)})`)}`);
  } catch (err) {
    timings.conversationFetchMs = Date.now() - convT0;
    convSpinner.fail(`Failed to fetch PR conversation comments: ${err instanceof Error ? err.message : String(err)}`);
  }

  const matchT0 = Date.now();
  const matchSpinner = out.spinner("Analyzing human reactions...");
  let replyContextMap: Awaited<ReturnType<typeof buildReplyContextMap>>;
  try {
    replyContextMap = await buildReplyContextMap(
      ai,
      human,
      models.classificationModel,
      costTracker,
      generalHuman,
    );
    timings.replyContextMs = Date.now() - matchT0;
    matchSpinner.succeed(`Analyzed human reactions ${chalk.dim(`(${out.fmtDuration(timings.replyContextMs)})`)}`);
  } catch (err) {
    timings.replyContextMs = Date.now() - matchT0;
    replyContextMap = new Map();
    matchSpinner.fail(`Failed to analyze human reactions: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Coverage diagnostic: how many bot comments actually received a human reply
  // or reaction? Low coverage explains sparse Human signal blocks in the digest.
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
        ? chalk.dim(" (no human engagement on the fetched comments)")
        : ""),
  );

  // 7. Scan existing memory
  const memT0 = Date.now();
  const memSpinner = out.spinner("Scanning existing memory files...");
  const memoryContext = await scanExistingMemory(octokit, repo, config.memoryTargets);
  timings.memoryScanMs = Date.now() - memT0;
  const memBase = memoryContext.files.length > 0
    ? `Found ${memoryContext.files.length} existing memory file(s)`
    : "No existing memory files found";
  memSpinner.succeed(`${memBase} ${chalk.dim(`(${out.fmtDuration(timings.memoryScanMs)})`)}`);

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
  const classifyT0 = Date.now();
  const CONCURRENCY = 3;
  const total = repeatedClusters.length;
  const candidates: PromotionCandidate[] = [];
  const filterSkipped: SkippedItem[] = [];
  let failedClusters = 0;

  type ClusterResult = {
    index: number;
    candidate: PromotionCandidate | null;
    summary: string;
    skipped: boolean;
    target?: string;
    confidence?: number;
    reason?: SkipReason;
    detail?: string;
    clusterFingerprint?: string;
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
        if (r.reason) {
          filterSkipped.push({
            summary: r.summary,
            reason: r.reason,
            target: r.target,
            confidence: r.confidence,
            clusterFingerprint: r.clusterFingerprint,
            detail: r.detail,
          });
        }
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
      resultBuffer[index] = {
        index,
        candidate: null,
        summary: existing.summary,
        skipped: true,
        reason: existing.status === "promoted" ? "already-promoted" : "already-ignored",
        clusterFingerprint: cluster.fingerprint,
      };
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
        resultBuffer[index] = {
          index,
          candidate: null,
          summary: decision.summary ?? "not promotable",
          skipped: true,
          reason: "not-promotable",
          target: decision.target,
          confidence: decision.confidence,
          clusterFingerprint: cluster.fingerprint,
          detail: decision.reason,
        };
        flushBuffer();
        return;
      }

      if (decision.confidence < config.thresholds.minConfidence) {
        resultBuffer[index] = {
          index,
          candidate: null,
          summary: decision.summary ?? "",
          skipped: true,
          reason: "low-confidence",
          target: decision.target,
          confidence: decision.confidence,
          clusterFingerprint: cluster.fingerprint,
          detail: decision.reason,
        };
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
        reason: "classify-failed",
        detail: msg,
        clusterFingerprint: cluster.fingerprint,
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
  timings.classifyDraftMs = Date.now() - classifyT0;

  activeTimer.stop();
  activeSpinner.stop();

  out.success(
    `Classified + drafted ${total} cluster(s): ${candidates.length} promoted${
      failedClusters > 0 ? `, ${failedClusters} failed` : ""
    } ${chalk.dim(`(${out.fmtDuration(timings.classifyDraftMs)})`)}`,
  );

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

  // Total wall time (per-step durations already printed in each succeed line)
  timings.totalMs = Date.now() - runStartedAt;
  out.stat("Total time", out.fmtDuration(timings.totalMs));

  out.divider();

  // Build stats and digest path (needed by both 0-candidate and normal paths)
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
    timings,
  };

  const digestDir = resolve(process.cwd(), "docs", "promote", "digests");
  if (!existsSync(digestDir)) {
    mkdirSync(digestDir, { recursive: true });
  }
  const date = new Date().toISOString().split("T")[0];
  const digestPath = options.out ?? resolve(digestDir, `${date}.md`);

  // Branch A: nothing to show
  if (candidates.length === 0 && filterSkipped.length === 0) {
    mascotSays("All clusters were filtered out. Nothing to promote.");
    return;
  }

  // Branch B: zero candidates but filter-skip exists
  if (candidates.length === 0) {
    mascotSays(
      `No promotion candidates, but ${filterSkipped.length} item(s) were filtered out.`,
    );
    console.log();

    if (!headless) {
      const viewSkipped = await p.confirm({
        message: `View ${filterSkipped.length} filtered item(s) now?`,
        initialValue: true,
      });
      if (p.isCancel(viewSkipped)) {
        out.info("Cancelled.");
        process.exit(130);
      }
      if (viewSkipped) {
        await runSkippedReview(filterSkipped);
      }
    }

    let saveDigest = true;
    if (!headless) {
      const answer = await p.confirm({
        message: "Save skip digest?",
        initialValue: true,
      });
      if (p.isCancel(answer)) {
        out.info("Cancelled.");
        process.exit(130);
      }
      saveDigest = answer;
    }
    if (saveDigest) {
      const digest = renderDigest(
        candidates,
        stats,
        repo.fullName,
        config.language.preferredOutput,
        config,
        !llmOnly,
        sinceDays,
        { filterSkipped },
      );
      writeFileSync(digestPath, digest, "utf-8");
      out.success(`Skip digest written to ${digestPath}`);
    } else {
      out.info("Skip digest not saved.");
    }
    return;
  }

  // Branch C: candidates > 0 — write digest with filter-skip appendix (always)
  const digest = renderDigest(
    candidates,
    stats,
    repo.fullName,
    config.language.preferredOutput,
    config,
    !llmOnly,
    sinceDays,
    filterSkipped.length > 0 ? { filterSkipped } : undefined,
  );
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
    if (options.allowForeignScan) {
      out.warn(
        `Foreign scan: ${chalk.bold(repo.fullName)} ≠ local origin. Files will be written here and any PR will target the local repo.`,
      );
    } else if (headless) {
      out.error(
        `Scanned ${repo.fullName} but current directory is a different repo. Headless mode cannot apply changes or open a PR.`,
      );
      out.info(`Digest saved: ${digestPath}`);
      out.info(`Pass --allow-foreign-scan to apply files locally and PR against the local repo anyway.`);
      return;
    } else {
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
  }

  if (headless) {
    await runHeadlessApplyAndMaybePr({
      candidates,
      minConfidence,
      wantCreatePr,
      repo: repo.fullName,
      sinceDays,
      digestPath,
      baseBranch: options.baseBranch,
      stats,
      config,
      db,
      draftingModel: models.draftingModel,
      costTracker,
    });
    return;
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

  // Interactive review — each approval writes immediately.
  // If filter-skipped exists, runInteractiveReview will ask after candidates
  // whether to walk through them too.
  const appliedFiles = new Set<string>();
  const appliedCandidates: Array<PromotionCandidate & { targetFile: string }> = [];
  const { promoted, skipped, userSkippedCandidates } = await runInteractiveReview(
    candidates,
    async (candidate, target) => {
      const result = await applyPromotion(candidate, target);
      if (result.applied) {
        appliedFiles.add(result.targetFile);
        appliedCandidates.push({ ...candidate, targetFile: result.targetFile });
        updateCandidateStatus(db, candidate.id, "promoted");
      }
    },
    filterSkipped.length > 0 ? { includeSkipped: filterSkipped } : undefined,
  );

  out.divider();

  if (skipped > 0) out.info(`${skipped} candidate(s) skipped. Review later: ${chalk.dim("promote review")}`);
  out.info(`Full digest: ${chalk.bold(digestPath)}`);

  // C3: append user-skipped to digest for team review?
  if (userSkippedCandidates.length > 0) {
    const appendUserSkip = await p.confirm({
      message: `Add ${userSkippedCandidates.length} skipped candidate(s) to digest for team review?`,
      initialValue: true,
    });
    if (!p.isCancel(appendUserSkip) && appendUserSkip) {
      const updatedDigest = renderDigest(
        candidates,
        stats,
        repo.fullName,
        config.language.preferredOutput,
        config,
        !llmOnly,
        sinceDays,
        {
          filterSkipped: filterSkipped.length > 0 ? filterSkipped : undefined,
          userSkippedCandidates,
        },
      );
      writeFileSync(digestPath, updatedDigest, "utf-8");
      out.success(`Digest updated with ${userSkippedCandidates.length} skipped candidate(s)`);
    }
  }

  if (wantCreatePr && appliedCandidates.length > 0) {
    await openBundledPr({
      candidates: appliedCandidates,
      files: Array.from(appliedFiles),
      sinceDays,
      stats,
      digestPath,
      repo: repo.fullName,
      baseBranch: options.baseBranch,
      draftingModel: models.draftingModel,
      costTracker,
      outputLanguage: config.language.preferredOutput,
    });
  } else if (wantCreatePr && appliedCandidates.length === 0) {
    out.info("--create-pr: no candidates were applied — no PR opened.");
  }

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

type HeadlessApplyInput = {
  candidates: PromotionCandidate[];
  minConfidence: number;
  wantCreatePr: boolean;
  repo: string;
  sinceDays: number;
  digestPath: string;
  baseBranch?: string;
  stats: AnalysisStats;
  config: ReturnType<typeof loadConfig>;
  db: ReturnType<typeof initDatabase>["db"];
  draftingModel: ReturnType<typeof resolveModels>["draftingModel"];
  costTracker: CostTracker;
};

async function runHeadlessApplyAndMaybePr(input: HeadlessApplyInput) {
  const eligible = input.candidates.filter(
    (c) =>
      c.status === "candidate" &&
      c.confidence >= input.minConfidence &&
      c.target !== "none" &&
      c.target !== "pr_only",
  );

  // Surface candidates the headless filter dropped so the user knows where
  // they went. needs_human_decision is the most common "silent skip" cause.
  const humanGated = input.candidates.filter((c) => c.status === "needs_human_decision");
  if (humanGated.length > 0) {
    out.info(
      `${humanGated.length} candidate(s) flagged needs_human_decision — review locally with 'promote review'.`,
    );
  }

  out.divider();
  out.stat("Headless eligible", `${eligible.length} / ${input.candidates.length} candidate(s) ≥ ${input.minConfidence}`);

  if (eligible.length === 0) {
    out.info("No candidates met the auto-apply criteria. Digest saved; nothing applied.");
    return;
  }

  // Path A: headless apply only (no PR). Status updates happen per-candidate
  // because the files are written in the user's current branch — there's
  // no all-or-nothing PR to gate them on.
  if (!input.wantCreatePr) {
    let appliedCount = 0;
    for (const candidate of eligible) {
      const result = await applyPromotion(candidate, candidate.target, { suppressPrompts: true });
      if (result.applied) {
        appliedCount++;
        updateCandidateStatus(input.db, candidate.id, "promoted");
      }
    }
    out.stat("Applied", `${appliedCount} candidate(s)`);
    out.info(`Digest: ${input.digestPath}`);
    out.info("Headless apply complete. Pass --create-pr to also open a PR.");
    return;
  }

  // Path B: atomic --create-pr flow.
  //   prepareBranchForPr → applyPromotion (writes on the new branch's working
  //   tree) → finalizePr (commit + push + PR). DB statuses are only flipped
  //   to 'promoted' AFTER the PR succeeds. Any failure between prepare and
  //   PR success rolls everything back: working tree restored, promote
  //   branch deleted, DB untouched.
  const ghAvailable = hasGhCli() && isGhAuthenticated();
  if (!ghAvailable && !process.env.GITHUB_TOKEN) {
    out.error("`gh` CLI not authenticated and GITHUB_TOKEN not set — cannot open a PR.");
    process.exit(1);
  }

  const date = new Date();
  const branchName = buildBranchName({ candidateIds: eligible.map((c) => c.id), date });
  const ctx = prepareBranchForPr({ branch: branchName, baseBranch: input.baseBranch });

  const appliedFiles = new Set<string>();
  const appliedCandidates: Array<PromotionCandidate & { targetFile: string }> = [];

  try {
    for (const candidate of eligible) {
      const result = await applyPromotion(candidate, candidate.target, { suppressPrompts: true });
      if (result.applied) {
        appliedFiles.add(result.targetFile);
        appliedCandidates.push({ ...candidate, targetFile: result.targetFile });
      }
    }
  } catch (err) {
    rollbackBranch(ctx, Array.from(appliedFiles));
    throw err;
  }

  out.stat("Applied", `${appliedCandidates.length} candidate(s)`);

  if (appliedCandidates.length === 0) {
    rollbackBranch(ctx, []);
    out.info("--create-pr: no candidates were applied — no PR opened.");
    return;
  }

  const template = findPullRequestTemplate();
  const relativeDigestPath = toRelative(input.digestPath);

  let prefilledHeader: string | undefined;
  if (template) {
    const fillSpin = out.spinner(`Filling ${template.path} with LLM...`);
    try {
      prefilledHeader = await fillTemplateWithLlm({
        templateBody: template.body,
        facts: {
          candidates: appliedCandidates,
          sinceDays: input.sinceDays,
          prCount: input.stats.prCount,
          digestPath: relativeDigestPath,
        },
        model: input.draftingModel,
        costTracker: input.costTracker,
        outputLanguage: input.config.language.preferredOutput,
      });
      fillSpin.succeed(`Filled ${template.path} (LLM)`);
    } catch (err) {
      fillSpin.warn(
        `LLM template fill failed; passing the template through unfilled. (${err instanceof Error ? err.message : String(err)})`,
      );
      prefilledHeader = template.body;
    }
  }

  const body = buildBundledPrBody({
    candidates: appliedCandidates,
    stats: { prCount: input.stats.prCount },
    sinceDays: input.sinceDays,
    date,
    prefilledHeader,
    digestPath: relativeDigestPath,
  });
  const title = buildBundledPrTitle(date, appliedCandidates.length);

  const filesToCommit = [...appliedFiles];
  if (existsSync(input.digestPath) && !filesToCommit.includes(relativeDigestPath)) {
    filesToCommit.push(relativeDigestPath);
  }

  const localRepo = detectLocalRepoSilent();
  const prRepo = localRepo ?? input.repo;
  if (localRepo && localRepo !== input.repo) {
    out.info(`PR target: ${chalk.bold(localRepo)} (scanned repo was ${input.repo}).`);
  }

  out.divider();
  const spin = out.spinner(`Opening PR via ${ghAvailable ? "gh" : "octokit"}...`);
  try {
    const octokit = ghAvailable ? undefined : createOctokit();
    const result = await finalizePr({
      context: ctx,
      title,
      body,
      files: filesToCommit,
      repo: prRepo,
      labels: ["memory-promotion"],
      octokit,
    });
    spin.succeed(`PR opened: ${result.url}`);

    // Atomic DB update — only after PR creation succeeded.
    for (const c of appliedCandidates) {
      updateCandidateStatus(input.db, c.id, "promoted");
    }
    // Best-effort: return the user to their original branch so the working
    // tree state mirrors what they had before --create-pr ran.
    restoreOriginalBranch(ctx);
  } catch (err) {
    spin.fail("PR creation failed.");
    rollbackBranch(ctx, filesToCommit);
    throw err;
  }
}

type BundledPrInput = {
  candidates: Array<PromotionCandidate & { targetFile: string }>;
  files: string[];
  sinceDays: number;
  stats: AnalysisStats;
  digestPath: string;
  repo: string;
  baseBranch?: string;
  draftingModel: ReturnType<typeof resolveModels>["draftingModel"];
  costTracker: CostTracker;
  outputLanguage: string;
};

async function openBundledPr(input: BundledPrInput) {
  const ghAvailable = hasGhCli() && isGhAuthenticated();
  if (!ghAvailable && !process.env.GITHUB_TOKEN) {
    out.error("`gh` CLI not authenticated and GITHUB_TOKEN not set — cannot open a PR.");
    process.exit(1);
  }

  const localRepo = detectLocalRepoSilent();
  const prRepo = localRepo ?? input.repo;
  if (localRepo && localRepo !== input.repo) {
    out.info(`PR target: ${chalk.bold(localRepo)} (scanned repo was ${input.repo}).`);
  }

  const octokit = ghAvailable ? undefined : createOctokit();
  const date = new Date();
  const branch = buildBranchName({ candidateIds: input.candidates.map((c) => c.id), date });
  const title = buildBundledPrTitle(date, input.candidates.length);
  const template = findPullRequestTemplate();
  const relativeDigestPath = toRelative(input.digestPath);

  let prefilledHeader: string | undefined;
  if (template) {
    const fillSpin = out.spinner(`Filling ${template.path} with LLM...`);
    try {
      prefilledHeader = await fillTemplateWithLlm({
        templateBody: template.body,
        facts: {
          candidates: input.candidates,
          sinceDays: input.sinceDays,
          prCount: input.stats.prCount,
          digestPath: relativeDigestPath,
        },
        model: input.draftingModel,
        costTracker: input.costTracker,
        outputLanguage: input.outputLanguage,
      });
      fillSpin.succeed(`Filled ${template.path} (LLM)`);
    } catch (err) {
      fillSpin.warn(
        `LLM template fill failed; passing the template through unfilled. (${err instanceof Error ? err.message : String(err)})`,
      );
      prefilledHeader = template.body;
    }
  }

  const body = buildBundledPrBody({
    candidates: input.candidates,
    stats: { prCount: input.stats.prCount },
    sinceDays: input.sinceDays,
    date,
    prefilledHeader,
    digestPath: relativeDigestPath,
  });

  const filesToCommit = [...input.files];
  if (existsSync(input.digestPath) && !filesToCommit.includes(relativeDigestPath)) {
    filesToCommit.push(relativeDigestPath);
  }

  out.divider();
  const spin = out.spinner(`Opening PR via ${ghAvailable ? "gh" : "octokit"}...`);
  try {
    const result = await createPullRequest({
      branch,
      title,
      body,
      files: filesToCommit,
      repo: prRepo,
      baseBranch: input.baseBranch,
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
    return detectCurrentRepo();
  } catch {
    return null;
  }
}

function toRelative(absPath: string): string {
  const cwd = process.cwd();
  if (absPath.startsWith(cwd)) {
    return absPath.slice(cwd.length).replace(/^[/\\]/, "");
  }
  return absPath;
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
