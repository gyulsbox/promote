import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { Cluster } from "../core/types.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { computeSimilarity } from "./similarity.js";

const mergeDecisionSchema = z.object({
  shouldMerge: z.boolean().describe("true if both patterns describe the same recurring code quality concern"),
});

export async function llmRefine(input: {
  clusters: Cluster[];
  threshold: number;
  model: LanguageModel;
  costTracker: CostTracker;
  margin?: number;
}): Promise<Cluster[]> {
  const { clusters, threshold, model, costTracker, margin = 0.05 } = input;

  if (clusters.length < 2) return clusters;

  // Find borderline pairs: similarity is within [threshold - margin, threshold)
  const borderlinePairs: Array<[number, number]> = [];

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const repI = clusters[i];
      const repJ = clusters[j];
      // Skip clusters with no embeddings (LLM mode)
      if (repI.representativeEmbedding.length === 0 || repJ.representativeEmbedding.length === 0) continue;

      const sim = computeSimilarity(
        repI.representative,
        repJ.representative,
        repI.representativeEmbedding,
        repJ.representativeEmbedding,
      );

      if (sim >= threshold - margin && sim < threshold) {
        borderlinePairs.push([i, j]);
      }
    }
  }

  if (borderlinePairs.length === 0) return clusters;

  const result = clusters.map((c) => ({ ...c, members: [...c.members], memberEmbeddings: [...c.memberEmbeddings] }));
  const merged = new Set<number>();

  for (const [i, j] of borderlinePairs) {
    if (merged.has(i) || merged.has(j)) continue;

    const iBody = result[i].representative.normalizedBody.slice(0, 200);
    const jBody = result[j].representative.normalizedBody.slice(0, 200);

    try {
      const { object, usage } = await generateObject({
        model,
        schema: mergeDecisionSchema,
        temperature: 0,
        prompt: `Should these two AI code review comment patterns be considered the same recurring issue?\n\nPattern A: ${iBody}\n\nPattern B: ${jBody}\n\nAnswer true only if they describe the exact same code quality concern.`,
      });

      costTracker.record("llm-refine", {
        promptTokens: usage?.inputTokens ?? 0,
        completionTokens: usage?.outputTokens ?? 0,
      });

      if (object.shouldMerge) {
        result[i].members.push(...result[j].members);
        result[i].memberEmbeddings.push(...result[j].memberEmbeddings);
        merged.add(j);
      }
    } catch {
      // Refinement failure is non-fatal; keep clusters separate
    }
  }

  return result.filter((_, idx) => !merged.has(idx));
}
