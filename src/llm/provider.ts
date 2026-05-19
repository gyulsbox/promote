import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel, EmbeddingModel } from "ai";
import type { LLMConfig } from "../core/types.js";

export type ResolvedModels = {
  classificationModel: LanguageModel;
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

function resolveOpenAI(config: LLMConfig): ResolvedModels {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required for OpenAI provider.");
  }

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  return {
    classificationModel: openai(config.classificationModel),
    draftingModel: openai(config.draftingModel),
    embeddingModel: openai.embeddingModel(config.embeddingModel),
  };
}

function resolveAnthropic(config: LLMConfig): ResolvedModels {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required for Anthropic provider.");
  }

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return {
    classificationModel: anthropic(config.classificationModel),
    draftingModel: anthropic(config.draftingModel),
    embeddingModel: null, // Anthropic has no embedding API — use LLM clustering
  };
}

function resolveGoogle(config: LLMConfig): ResolvedModels {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY environment variable is required for Google provider.");
  }

  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY });

  return {
    classificationModel: google(config.classificationModel),
    draftingModel: google(config.draftingModel),
    embeddingModel: google.textEmbeddingModel(config.embeddingModel),
  };
}
