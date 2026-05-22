import type { LanguageModel } from "ai";
import type { RawReviewComment } from "../core/types.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import {
  classifyReplySentiment,
  classifyAmbiguousReplies,
  type ReplySentiment,
} from "../normalize/reply-sentiment.js";

export type HumanReply = {
  authorLogin: string;
  body: string;
  sentiment: ReplySentiment;
};

export type BotCommentContext = {
  replies: HumanReply[];
  reactions: { plusOne: number; minusOne: number };
};

export async function buildReplyContextMap(
  aiComments: RawReviewComment[],
  humanComments: RawReviewComment[],
  model: LanguageModel,
  costTracker: CostTracker,
): Promise<Map<string, BotCommentContext>> {
  const map = new Map<string, BotCommentContext>();

  // Seed map with reactions from bot comments themselves
  for (const c of aiComments) {
    map.set(c.id, {
      replies: [],
      reactions: c.reactions ?? { plusOne: 0, minusOne: 0 },
    });
  }

  // Collect human replies that target a bot comment
  const ambiguous: Array<{ id: string; body: string; botId: string }> = [];

  for (const h of humanComments) {
    if (!h.inReplyToId) continue;
    const ctx = map.get(h.inReplyToId);
    if (!ctx) continue;

    const sentiment = classifyReplySentiment(h.body);
    if (sentiment === "neutral" && h.body.length > 100) {
      ambiguous.push({ id: h.id, body: h.body, botId: h.inReplyToId });
    } else {
      ctx.replies.push({ authorLogin: h.authorLogin, body: h.body, sentiment });
    }
  }

  // Batch LLM fallback for ambiguous long replies
  if (ambiguous.length > 0) {
    const resolved = await classifyAmbiguousReplies(
      ambiguous.map((a) => ({ id: a.id, body: a.body })),
      model,
      costTracker,
    );

    const humanById = new Map(humanComments.map((h) => [h.id, h]));
    for (const a of ambiguous) {
      const ctx = map.get(a.botId);
      if (!ctx) continue;
      const sentiment = resolved.get(a.id) ?? "neutral";
      const h = humanById.get(a.id);
      if (h) ctx.replies.push({ authorLogin: h.authorLogin, body: h.body, sentiment });
    }
  }

  return map;
}
