import { writeFileSync, mkdirSync, existsSync } from "node:fs";
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
import { upsertComments } from "../../storage/repositories.js";
import type { PromotionCandidate, AnalysisStats } from "../../core/types.js";
import * as out from "../output.js";
import { mascotSays, mascotHappy } from "../mascot.js";
import { createTimedSpinner, getClassifyMessage, getDraftMessage, getClusterMessage } from "../thinking.js";

export type ScanOptions = {
  repo: string;
  since: string;
  config?: string;
  out?: string;
  verbose?: boolean;
};

export async function runScan(options: ScanOptions) {
  const config = loadConfig(options.config);
  const repo = parseRepoRef(options.repo);
  const sinceDays = parseSinceDays(options.since);
  const sinceDate = computeSinceDate(sinceDays);

  mascotSays(`Scanning ${repo.fullName} (last ${sinceDays} days)`);
  out.divider();

  const octokit = createOctokit();
  const models = resolveModels(config.llm);
  const costTracker = new CostTracker(config.llm.classificationModel);

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

  const repeatedClusters = clusters.filter(
    (c) => c.members.length >= config.thresholds.minOccurrences,
  );
  out.stat("Repeated clusters", `${repeatedClusters.length} (>= ${config.thresholds.minOccurrences} occurrences)`);

  if (repeatedClusters.length === 0) {
    out.divider();
    mascotSays("No repeated patterns found. Try --since 90d or lower thresholds.");
    return;
  }

  out.divider();

  // 6. Scan existing memory
  const memSpinner = out.spinner("Scanning existing memory files...");
  const memoryContext = await scanExistingMemory(octokit, repo, config.memoryTargets);
  memSpinner.succeed(
    memoryContext.files.length > 0
      ? `Found ${memoryContext.files.length} existing memory file(s)`
      : "No existing memory files found",
  );

  // 7. Classify + Draft (parallel, concurrency 3)
  const CONCURRENCY = 3;
  const total = repeatedClusters.length;
  const candidates: PromotionCandidate[] = [];
  let completed = 0;

  const mainSpinner = out.spinner("");
  const mainTimer = createTimedSpinner(
    mainSpinner,
    getClassifyMessage,
    chalk.dim(`[0/${total}]`),
  );

  // Process all clusters with concurrency limit
  type ClusterResult = {
    index: number;
    candidate: PromotionCandidate | null;
    summary: string;
    skipped: boolean;
    target?: string;
    confidence?: number;
  };

  const processCluster = async (cluster: typeof repeatedClusters[0], index: number): Promise<ClusterResult> => {
    const decision = await classifyCluster({
      cluster,
      model: models.classificationModel,
      memoryContext,
      costTracker,
      outputLanguage: config.language.preferredOutput,
    });

    if (!decision.clusterValid || decision.target === "none" || decision.target === "pr_only") {
      return { index, candidate: null, summary: decision.summary ?? "not promotable", skipped: true };
    }

    if (decision.confidence < config.thresholds.minConfidence) {
      return { index, candidate: null, summary: decision.summary ?? "", skipped: true };
    }

    const draft = await generateDraft({
      cluster,
      decision,
      model: models.draftingModel,
      costTracker,
      preferredLanguage: config.language.preferredOutput,
    });

    return {
      index,
      candidate: {
        id: "", // assigned after sort
        repo: repo.fullName,
        clusterId: cluster.id,
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
      },
      summary: decision.summary,
      skipped: false,
      target: decision.target,
      confidence: decision.confidence,
    };
  };

  // Run with concurrency limit
  const results: ClusterResult[] = [];
  const queue = repeatedClusters.map((c, i) => ({ cluster: c, index: i }));
  const running: Promise<void>[] = [];

  const runNext = async (): Promise<void> => {
    const item = queue.shift();
    if (!item) return;

    const result = await processCluster(item.cluster, item.index);
    results.push(result);
    completed++;

    // Update spinner with progress
    mainTimer.stop();
    const progressLabel = chalk.dim(`[${completed}/${total}]`);
    if (result.skipped) {
      // Don't log individual skips during parallel — will summarize after
    }
    Object.assign(mainTimer, createTimedSpinner(
      mainSpinner,
      getClassifyMessage,
      progressLabel,
    ));

    await runNext();
  };

  // Start CONCURRENCY workers
  for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
    running.push(runNext());
  }
  await Promise.all(running);

  mainTimer.stop();
  mainSpinner.succeed(`Classified ${total} clusters (${CONCURRENCY} parallel)`);

  // Sort results by original index and print summary
  results.sort((a, b) => a.index - b.index);

  let candidateNum = 1;
  for (const r of results) {
    const progress = chalk.dim(`[${r.index + 1}/${total}]`);
    if (r.skipped) {
      console.log(`  ${progress} ${chalk.dim("skip")} — ${r.summary.slice(0, 55)}`);
    } else if (r.candidate) {
      r.candidate.id = `candidate_${String(candidateNum).padStart(3, "0")}`;
      candidates.push(r.candidate);
      const targetBadge = chalk.cyan(`[${r.target}]`);
      console.log(`  ${progress} ${targetBadge} ${r.summary.slice(0, 55)} ${chalk.dim(`(${r.confidence?.toFixed(2)})`)}`);
      candidateNum++;
    }
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
    prCount: uniquePrs.size,
    embeddingTokens: cost.totalPromptTokens,
    classificationTokens: cost.totalCompletionTokens,
    estimatedCostUSD: cost.estimatedCostUSD,
  };

  const digest = renderDigest(candidates, stats, repo.fullName, config.language.preferredOutput);
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

  out.divider();
  out.info(`Review: ${chalk.bold(digestPath)}`);
  out.info(`Promote: ${chalk.dim("promote promote candidate_001 --target agents --write")}`);
}

function parseSinceDays(since: string): number {
  const match = since.match(/^(\d+)d$/);
  if (match) return Number(match[1]);

  const num = Number(since);
  if (!Number.isNaN(num) && num > 0) return num;

  throw new Error(`Invalid --since value: "${since}". Use format like "60d" or "60".`);
}
