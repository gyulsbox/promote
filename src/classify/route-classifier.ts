import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { Cluster, RoutingDecision } from "../core/types.js";
import type { MemoryContext } from "../memory/memory-scanner.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { CLASSIFICATION_SYSTEM_PROMPT, buildClassificationPrompt } from "./prompts.js";

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
}): Promise<RoutingDecision> {
  const { cluster, model, memoryContext, costTracker, outputLanguage } = input;

  // Build examples (cap at 5)
  const examples = cluster.members.slice(0, 5).map((m) => ({
    prNumber: m.prNumber,
    path: m.filePath,
    excerpt: m.normalizedBody.slice(0, 300),
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
  });

  const { object, usage } = await generateObject({
    model,
    schema: routingDecisionSchema,
    temperature: 0,
    system: CLASSIFICATION_SYSTEM_PROMPT,
    prompt,
  });

  costTracker.record("classification", {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
  });

  return object as RoutingDecision;
}
