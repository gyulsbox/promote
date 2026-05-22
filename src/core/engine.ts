import type { Octokit } from "octokit";
import type {
  RepoRef,
  PromoteConfig,
  PromotionCandidate,
  AnalysisStats,
  AnalyzeReviewMemoryOutput,
} from "./types.js";
import type { ResolvedModels } from "../llm/provider.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { fetchReviewComments, computeSinceDate } from "../ingest/comment-fetcher.js";
import { filterAIReviewComments } from "../filter/ai-reviewer-filter.js";
import { filterNoise } from "../filter/noise-filter.js";
import { normalizeComments } from "../normalize/normalizer.js";
import { preCluster } from "../cluster/pre-cluster.js";
import { scanExistingMemory } from "../memory/memory-scanner.js";
import { classifyCluster } from "../classify/route-classifier.js";
import { generateDraft } from "../draft/draft-generator.js";
import { buildReplyContextMap } from "../ingest/reply-context.js";
import { aggregateHumanSignal } from "./human-signal.js";

export type EngineCallbacks = {
  onProgress?: (step: string, detail?: string) => void;
};

export async function analyzeReviewMemory(input: {
  octokit: Octokit;
  repo: RepoRef;
  sinceDays: number;
  config: PromoteConfig;
  models: ResolvedModels;
  costTracker: CostTracker;
  callbacks?: EngineCallbacks;
}): Promise<AnalyzeReviewMemoryOutput> {
  const { octokit, repo, sinceDays, config, models, costTracker, callbacks } = input;
  const onProgress = callbacks?.onProgress ?? (() => {});

  // 1. Fetch
  onProgress("fetch", "Fetching review comments...");
  const sinceDate = computeSinceDate(sinceDays);
  const allComments = await fetchReviewComments(octokit, repo, sinceDate);

  // 2. Filter
  onProgress("filter", "Filtering...");
  const { ai, human } = filterAIReviewComments(allComments, config.aiReviewers);
  const { kept } = filterNoise(ai);

  // 3. Normalize
  onProgress("normalize", "Normalizing...");
  const normalized = normalizeComments(kept);

  // 3b. Build reply context map from human replies to bot comments
  onProgress("filter", "Analyzing human reactions...");
  let replyContextMap: Awaited<ReturnType<typeof buildReplyContextMap>>;
  try {
    replyContextMap = await buildReplyContextMap(ai, human, models.classificationModel, costTracker);
  } catch {
    replyContextMap = new Map();
  }

  // 4. Pre-cluster
  onProgress("cluster", "Clustering...");
  const { clusters, mode } = await preCluster({
    comments: normalized,
    embeddingModel: models.embeddingModel,
    classificationModel: models.classificationModel,
    similarityThreshold: config.thresholds.similarityThreshold,
    costTracker,
    onProgress: (msg) => onProgress("cluster", msg),
  });

  // 5. Filter repeated
  const repeatedClusters = clusters.filter(
    (c) => c.members.length >= config.thresholds.minOccurrences,
  );

  // 6. Scan existing memory
  onProgress("memory", "Scanning existing memory files...");
  const memoryContext = await scanExistingMemory(octokit, repo, config.memoryTargets);

  // 7. Classify + Draft each repeated cluster
  const candidates: PromotionCandidate[] = [];
  let candidateIndex = 1;
  let failedClusters = 0;

  for (const cluster of repeatedClusters) {
    onProgress("classify", `Classifying cluster ${candidateIndex}/${repeatedClusters.length}...`);

    // Aggregate human reply/reaction signal for this cluster
    cluster.humanSignal = aggregateHumanSignal(cluster, replyContextMap);

    try {
      const decision = await classifyCluster({
        cluster,
        model: models.classificationModel,
        memoryContext,
        costTracker,
        redact: config.privacy.redactSecrets,
        humanSignal: cluster.humanSignal,
        includeDiffHunks: config.privacy.sendDiffHunksToLLM,
      });

      // Skip low confidence or non-promotable
      if (!decision.clusterValid) continue;
      if (decision.target === "none" || decision.target === "pr_only") continue;
      if (decision.confidence < config.thresholds.minConfidence) continue;

      onProgress("draft", `Drafting candidate ${candidateIndex}...`);

      const draft = await generateDraft({
        cluster,
        decision,
        model: models.draftingModel,
        costTracker,
        preferredLanguage: config.language.preferredOutput,
        redact: config.privacy.redactSecrets,
      });

      const candidateId = `candidate_${String(candidateIndex).padStart(3, "0")}`;

      candidates.push({
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
        status: decision.needsHumanDecision ? "needs_human_decision" : "candidate",
        humanSignal: cluster.humanSignal,
      });

      candidateIndex++;
    } catch (err) {
      failedClusters++;
      onProgress("error", `Cluster ${candidateIndex} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Build stats
  const uniquePrs = new Set(allComments.map((c) => c.prNumber));
  const cost = costTracker.getSummary();

  const stats: AnalysisStats = {
    totalComments: allComments.length,
    aiComments: ai.length,
    noisyComments: ai.length - kept.length,
    clustersFound: clusters.length,
    repeatedClusters: repeatedClusters.length,
    candidatesGenerated: candidates.length,
    failedClusters,
    prCount: uniquePrs.size,
    promptTokens: cost.totalPromptTokens,
    completionTokens: cost.totalCompletionTokens,
    estimatedCostUSD: cost.estimatedCostUSD,
  };

  return { candidates, stats };
}
