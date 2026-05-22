import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel, EmbeddingModel } from "ai";
import type { LLMConfig } from "../core/types.js";

export type ResolvedModels = {
  classificationModel: LanguageModel;
  clusteringModel: LanguageModel;
  draftingModel: LanguageModel;
  embeddingModel: EmbeddingModel | null; // null = use LLM clustering
};

export function resolveModels(config: LLMConfig): ResolvedModels {
  switch (config.provider) {
    case "openai":
      return resolveOpenAI(config);
    case "anthropic":
      return resolveAnthropic(config);
    case "google":
      return resolveGoogle(config);
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

export function hasEmbedding(models: ResolvedModels): boolean {
  return models.embeddingModel !== null;
}

/**
 * Returns `{ seed: 1 }` if the model honors the seed parameter (OpenAI Chat
 * Completions), `{}` otherwise. Anthropic and Google ignore seed and emit a
 * noisy "feature 'seed' is not supported" warning on every call.
 */
export function seedIfSupported(model: LanguageModel): { seed?: number } {
  const provider = (model as { provider?: string }).provider ?? "";
  if (provider.startsWith("openai.chat")) {
    return { seed: 1 };
  }
  return {};
}

function resolveOpenAI(config: LLMConfig): ResolvedModels {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required for OpenAI provider.");
  }

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const clustering = config.clusteringModel ?? config.classificationModel;

  // Use .chat() (Chat Completions API) rather than the default Responses API:
  // Responses doesn't expose `seed`, which we rely on for run-to-run reproducibility
  // of classify/cluster/refine decisions.
  return {
    classificationModel: openai.chat(config.classificationModel),
    clusteringModel: openai.chat(clustering),
    draftingModel: openai.chat(config.draftingModel),
    embeddingModel: openai.embeddingModel(config.embeddingModel),
  };
}

function resolveAnthropic(config: LLMConfig): ResolvedModels {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required for Anthropic provider.");
  }

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const clustering = config.clusteringModel ?? config.classificationModel;

  return {
    classificationModel: anthropic(config.classificationModel),
    clusteringModel: anthropic(clustering),
    draftingModel: anthropic(config.draftingModel),
    embeddingModel: null, // Anthropic has no embedding API — use LLM clustering
  };
}

function resolveGoogle(config: LLMConfig): ResolvedModels {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable is required for Google provider.");
  }

  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY });
  const clustering = config.clusteringModel ?? config.classificationModel;

  return {
    classificationModel: google(config.classificationModel),
    clusteringModel: google(clustering),
    draftingModel: google(config.draftingModel),
    embeddingModel: google.textEmbeddingModel(config.embeddingModel),
  };
}
