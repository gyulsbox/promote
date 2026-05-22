import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { resolve } from "node:path";
import type { PromoteConfig } from "./types.js";

const promoteConfigSchema = z.object({
  version: z.literal(1),

  language: z
    .object({
      preferredOutput: z.enum(["en", "ja", "ko"]).default("en"),
    })
    .default({ preferredOutput: "en" }),

  // Defaults include multiple aliases per bot vendor (e.g. github-copilot[bot] vs copilot[bot],
  // coderabbitai[bot] vs coderabbit-openai[bot], qodo-merge-pro[bot] vs qodo-merge-pro-for-open-source[bot]).
  // GitHub has historically renamed bot accounts; keeping both forms here is defensive.
  aiReviewers: z
    .array(z.string())
    .default([
      "github-copilot[bot]",
      "copilot[bot]",
      "coderabbitai[bot]",
      "greptile-apps[bot]",
      "claude[bot]",
      "codex[bot]",
      "devin-ai-integration[bot]",
      "ellipsis-dev[bot]",
      "qodo-merge-pro[bot]",
      "qodo-merge-pro-for-open-source[bot]",
      "cursor[bot]",
      "sourcery-ai[bot]",
      "coderabbit-openai[bot]",
      "sweep-ai[bot]",
    ]),

  memoryTargets: z
    .object({
      agents: z
        .object({
          preferredFiles: z
            .array(z.string())
            .default(["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"]),
        })
        .optional(),
      pathScoped: z
        .object({
          preferredDir: z.string().default(".github/instructions"),
        })
        .optional(),
      adr: z
        .object({
          dir: z.string().default("docs/adr"),
          filenameFormat: z.string().default("{number}-{slug}.md"),
        })
        .optional(),
      tests: z
        .object({
          mode: z.enum(["recommendation", "stub"]).default("recommendation"),
        })
        .optional(),
    })
    .default({}),

  thresholds: z
    .object({
      // 2 (was 3): on real repos at 60d windows, ≥3 was too strict — most
      // clusters were singletons or pairs, leaving emerging patterns invisible.
      // Counting pairs as "repeated" surfaces the second occurrence as a
      // candidate so the user can decide whether it's worth promoting early.
      minOccurrences: z.number().int().min(2).default(2),
      windowDays: z.number().int().min(1).default(60),
      // 0.80 (was 0.85): v0.3 bot-signature/markdown stripping removes a lot of
      // shared boilerplate, lowering pairwise cosine similarity between semantically
      // equivalent comments. llmRefine (margin 0.15) catches borderline pairs in
      // [0.65, 0.80), keeping false-merges under control.
      similarityThreshold: z.number().min(0).max(1).default(0.80),
      minConfidence: z.number().min(0).max(1).default(0.75),
    })
    .default({ minOccurrences: 2, windowDays: 60, similarityThreshold: 0.80, minConfidence: 0.75 }),

  llm: z
    .object({
      provider: z.enum(["openai", "anthropic", "google"]).default("openai"),
      classificationModel: z.string().default("gpt-4.1-mini"),
      draftingModel: z.string().default("gpt-4.1-mini"),
      embeddingModel: z.string().default("text-embedding-3-small"),
    })
    .default({ provider: "openai", classificationModel: "gpt-4.1-mini", draftingModel: "gpt-4.1-mini", embeddingModel: "text-embedding-3-small" }),

  privacy: z
    .object({
      sendDiffHunksToLLM: z.boolean().default(false),
      redactSecrets: z.boolean().default(true),
    })
    .default({ sendDiffHunksToLLM: false, redactSecrets: true }),
});

export function loadConfig(configPath?: string): PromoteConfig {
  const filePath = configPath ?? resolve(process.cwd(), ".promote.yml");

  if (!existsSync(filePath)) {
    return promoteConfigSchema.parse({ version: 1 });
  }

  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  return promoteConfigSchema.parse(parsed);
}

export const DEFAULT_CONFIG_CONTENT = `version: 1

# language:
#   preferredOutput: en

# aiReviewers:
#   - github-copilot[bot]
#   - coderabbitai[bot]
#   - greptile-apps[bot]
#   - claude[bot]
#   - devin-ai-integration[bot]
#   - ellipsis-dev[bot]
#   - qodo-merge-pro[bot]
#   - sourcery-ai[bot]

# memoryTargets:
#   agents:
#     preferredFiles:
#       - AGENTS.md
#       - CLAUDE.md
#       - .github/copilot-instructions.md
#   pathScoped:
#     preferredDir: .github/instructions
#   adr:
#     dir: docs/adr
#     filenameFormat: "{number}-{slug}.md"
#   tests:
#     mode: recommendation

# thresholds:
#   minOccurrences: 2
#   windowDays: 60
#   similarityThreshold: 0.80
#   minConfidence: 0.75

# llm:
#   provider: openai
#   classificationModel: gpt-4.1-mini
#   draftingModel: gpt-4.1-mini
#   embeddingModel: text-embedding-3-small

# privacy:
#   sendDiffHunksToLLM: false
#   redactSecrets: true
`;
