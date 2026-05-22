import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { Cluster, RoutingDecision, HumanReactionSignal } from "../core/types.js";
import type { MemoryContext } from "../memory/memory-scanner.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { CLASSIFICATION_SYSTEM_PROMPT, buildClassificationPrompt } from "./prompts.js";
import { redactSecrets } from "../normalize/redact.js";
import { seedIfSupported, temperatureIfSupported, llmProviderOptions } from "../llm/provider.js";

const routingDecisionSchema = z.object({
  clusterValid: z
    .boolean()
    .describe("Whether all examples truly belong to the same pattern"),
  target: z.enum(["none", "pr_only", "agents", "path_scoped_rule", "adr", "test"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().describe("One-sentence summary of the repeated pattern"),
  reason: z.string().describe("Why this target was chosen over alternatives"),
  suggestedFile: z
    .string()
    .optional()
    .describe("Specific file to write to, e.g. AGENTS.md"),
  pathScope: z
    .string()
    .optional()
    .describe("For path_scoped_rule: the glob pattern this rule applies to"),
  alternatives: z
    .array(
      z.object({
        target: z.string(),
        reason: z.string(),
      }),
    )
    .max(3),
  needsHumanDecision: z.boolean(),
});

export async function classifyCluster(input: {
  cluster: Cluster;
  model: LanguageModel;
  memoryContext: MemoryContext;
  costTracker: CostTracker;
  outputLanguage?: string;
  redact?: boolean;
  humanSignal?: HumanReactionSignal;
  includeDiffHunks?: boolean;
}): Promise<RoutingDecision> {
  const { cluster, model, memoryContext, costTracker, outputLanguage, redact = true, humanSignal, includeDiffHunks = false } = input;

  // Build examples (cap at 5)
  const examples = cluster.members.slice(0, 5).map((m) => ({
    prNumber: m.prNumber,
    path: m.filePath,
    excerpt: redact
      ? redactSecrets(m.normalizedBody.slice(0, 300))
      : m.normalizedBody.slice(0, 300),
    severity:
      m.severityMarker.level !== "unknown" ? m.severityMarker.level : undefined,
    diffHunk: includeDiffHunks ? m.diffHunk : undefined,
  }));

  // Collect all identifiers and paths across members
  const allIdentifiers = [
    ...new Set(cluster.members.flatMap((m) => m.identifiers)),
  ].slice(0, 15);
  const allPaths = [...new Set(cluster.members.flatMap((m) => m.paths))].slice(
    0,
    10,
  );

  const prompt = buildClassificationPrompt({
    summary: cluster.representative.normalizedBody.slice(0, 200),
    examples,
    identifiers: allIdentifiers,
    paths: allPaths,
    existingMemory: memoryContext.snippets,
    outputLanguage,
    humanSignal,
  });

  const { object, usage } = await generateObject({
    model,
    schema: routingDecisionSchema,
    // OpenAI's structured-outputs strict mode rejects .optional/.min/.max constraints
    // that our schema legitimately uses. Disable strict mode for OpenAI; Anthropic/Google
    // ignore this option and continue to use their native tool-use paths.
    providerOptions: llmProviderOptions(model),
    ...temperatureIfSupported(model),
    ...seedIfSupported(model),
    system: CLASSIFICATION_SYSTEM_PROMPT,
    prompt,
  });

  costTracker.record("classification", {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
  });

  let { confidence, needsHumanDecision } = object as RoutingDecision;

  if (humanSignal) {
    if (humanSignal.rejectionCount > 0) needsHumanDecision = true;
    if (humanSignal.agreementCount >= 2) confidence = Math.min(0.97, confidence + 0.05);
  }

  return { ...(object as RoutingDecision), confidence, needsHumanDecision };
}
