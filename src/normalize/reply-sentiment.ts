import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { CostTracker } from "../llm/cost-tracker.js";
import { seedIfSupported } from "../llm/provider.js";

export type ReplySentiment = "agree" | "reject" | "neutral";

const AGREE_PATTERNS = [
  /\blgtm\b/i,
  /\bgood\s+catch\b/i,
  /\bnice\s+catch\b/i,
  /\bfixed\b/i,
  /\bdone\b/i,
  /\bthanks\b/i,
  /^\s*\+1\s*$/,
  /\bagree\b/i,
  /\bcorrect\b/i,
  // Korean: avoid bare /맞/ and /수정/ since they match too broadly (맞춤형, 수정 필요 등).
  /맞(아|다|네|음|어요|어|네요)/,
  /동의/,
  /수정(했|완료|함|됨|되었)/,
  /감사/,
  /완료/,
  // Japanese
  /了解/,
];

const REJECT_PATTERNS = [
  /\bintentional\b/i,
  /\bby\s+design\b/i,
  /\bwon['']?t\s+fix\b/i,
  /\bwontfix\b/i,
  /\bnot\s+applicable\b/i,
  /\bspecial[\s-]case\b/i,
  /\bthis\s+is\s+(expected|intentional)\b/i,
  /특수\s*케이스/,
  // Korean: /예외(?!처리)/ avoids false positives like "예외처리가 필요" (= needs exception handling).
  /예외(?!처리)/,
  /의도적/,
  /설계상/,
  /意図的/,
  /例外/,
];

export function classifyReplySentiment(body: string): ReplySentiment {
  if (REJECT_PATTERNS.some((p) => p.test(body))) return "reject";
  if (AGREE_PATTERNS.some((p) => p.test(body))) return "agree";
  return "neutral";
}

const batchSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      sentiment: z.enum(["agree", "reject", "neutral"]),
    }),
  ),
});

export async function classifyAmbiguousReplies(
  replies: Array<{ id: string; body: string }>,
  model: LanguageModel,
  costTracker: CostTracker,
): Promise<Map<string, ReplySentiment>> {
  if (replies.length === 0) return new Map();

  const list = replies
    .map((r, i) => `${i + 1}. [id:${r.id}] ${r.body.slice(0, 200)}`)
    .join("\n");

  const { object, usage } = await generateObject({
    model,
    schema: batchSchema,
    providerOptions: { openai: { strictJsonSchema: false } },
    temperature: 0,
    ...seedIfSupported(model),
    system:
      "Classify each reviewer reply as agree (supportive/fixed), reject (dismissive/special-case), or neutral. Return id and sentiment for each.",
    prompt: `Classify these human replies to an AI code review comment:\n\n${list}`,
  });

  costTracker.record("reply-sentiment", {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
  });

  if (object.results.length < replies.length) {
    process.stderr.write(
      `[promote] reply-sentiment: LLM returned ${object.results.length}/${replies.length} results; missing entries treated as neutral\n`,
    );
  }

  return new Map(object.results.map((r) => [r.id, r.sentiment]));
}
