import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { RawReviewComment } from "../core/types.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import {
  classifyReplySentiment,
  classifyAmbiguousReplies,
  type ReplySentiment,
} from "../normalize/reply-sentiment.js";
import { seedIfSupported } from "../llm/provider.js";

export type HumanReply = {
  authorLogin: string;
  body: string;
  sentiment: ReplySentiment;
};

export type BotCommentContext = {
  replies: HumanReply[];
  reactions: { plusOne: number; minusOne: number };
};

const matchSchema = z.object({
  matches: z.array(
    z.object({
      humanCommentId: z.string(),
      botCommentId: z.string().nullable(),
      sentiment: z.enum(["agree", "reject", "neutral"]),
    }),
  ),
});

async function matchGeneralCommentsToBots(
  generalHuman: RawReviewComment[],
  botsInPr: RawReviewComment[],
  model: LanguageModel,
  costTracker: CostTracker,
): Promise<Map<string, { botId: string; sentiment: ReplySentiment }>> {
  if (generalHuman.length === 0 || botsInPr.length === 0) return new Map();

  const botList = botsInPr
    .map((b) => `[id:${b.id}, file:${b.path ?? "?"}] ${b.body.slice(0, 200)}`)
    .join("\n---\n");
  const humanList = generalHuman
    .map((h) => `[id:${h.id}, author:${h.authorLogin}] ${h.body.slice(0, 300)}`)
    .join("\n---\n");

  const { object, usage } = await generateObject({
    model,
    schema: matchSchema,
    providerOptions: { openai: { strictJsonSchema: false } },
    temperature: 0,
    ...seedIfSupported(model),
    system:
      "You match human PR conversation comments to the AI review comment they respond to (if any), and classify the sentiment toward that AI suggestion: agree (supportive/will fix), reject (dismissive/by design/won't fix), or neutral. Use null botCommentId when the human comment is unrelated to any AI suggestion.",
    prompt: `AI review comments in this PR:\n${botList}\n\nHuman conversation comments:\n${humanList}\n\nReturn a match per human comment.`,
  });

  costTracker.record("reply-context-match", {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
  });

  const result = new Map<string, { botId: string; sentiment: ReplySentiment }>();
  const botIdSet = new Set(botsInPr.map((b) => b.id));
  for (const m of object.matches) {
    if (m.botCommentId && botIdSet.has(m.botCommentId)) {
      result.set(m.humanCommentId, { botId: m.botCommentId, sentiment: m.sentiment });
    }
  }
  return result;
}

export async function buildReplyContextMap(
  aiComments: RawReviewComment[],
  inlineHumanComments: RawReviewComment[],
  model: LanguageModel,
  costTracker: CostTracker,
  generalHumanComments: RawReviewComment[] = [],
): Promise<Map<string, BotCommentContext>> {
  const map = new Map<string, BotCommentContext>();

  // Seed map with reactions from bot comments themselves
  for (const c of aiComments) {
    map.set(c.id, {
      replies: [],
      reactions: c.reactions ?? { plusOne: 0, minusOne: 0 },
    });
  }

  // 1) Inline replies — linked by in_reply_to_id
  const ambiguous: Array<{ id: string; body: string; botId: string }> = [];
  for (const h of inlineHumanComments) {
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

  if (ambiguous.length > 0) {
    const resolved = await classifyAmbiguousReplies(
      ambiguous.map((a) => ({ id: a.id, body: a.body })),
      model,
      costTracker,
    );
    const humanById = new Map(inlineHumanComments.map((h) => [h.id, h]));
    for (const a of ambiguous) {
      const ctx = map.get(a.botId);
      if (!ctx) continue;
      const sentiment = resolved.get(a.id) ?? "neutral";
      const h = humanById.get(a.id);
      if (h) ctx.replies.push({ authorLogin: h.authorLogin, body: h.body, sentiment });
    }
  }

  // 2) General PR conversation comments — match to bot comments per PR via LLM
  if (generalHumanComments.length > 0 && aiComments.length > 0) {
    const botsByPr = new Map<number, RawReviewComment[]>();
    for (const b of aiComments) {
      const arr = botsByPr.get(b.prNumber) ?? [];
      arr.push(b);
      botsByPr.set(b.prNumber, arr);
    }
    const generalByPr = new Map<number, RawReviewComment[]>();
    for (const h of generalHumanComments) {
      const arr = generalByPr.get(h.prNumber) ?? [];
      arr.push(h);
      generalByPr.set(h.prNumber, arr);
    }

    // Single-bot PRs: synchronous heuristic — no LLM call, no point parallelizing
    type MatchTask = { generalInPr: RawReviewComment[]; botsInPr: RawReviewComment[] };
    const llmMatchQueue: MatchTask[] = [];

    for (const [prNumber, generalInPr] of generalByPr) {
      const botsInPr = botsByPr.get(prNumber) ?? [];
      if (botsInPr.length === 0) continue;

      if (botsInPr.length === 1) {
        const ctx = map.get(botsInPr[0].id);
        if (!ctx) continue;
        for (const h of generalInPr) {
          const sentiment = classifyReplySentiment(h.body);
          ctx.replies.push({ authorLogin: h.authorLogin, body: h.body, sentiment });
        }
      } else {
        llmMatchQueue.push({ generalInPr, botsInPr });
      }
    }

    // Multi-bot PRs: parallel LLM matching with bounded concurrency.
    // Each task writes to disjoint bot-comment contexts in `map`, so no race.
    const MATCH_CONCURRENCY = 3;
    const runMatchWorker = async () => {
      while (true) {
        const task = llmMatchQueue.shift();
        if (!task) return;
        try {
          const matches = await matchGeneralCommentsToBots(
            task.generalInPr, task.botsInPr, model, costTracker,
          );
          for (const h of task.generalInPr) {
            const m = matches.get(h.id);
            if (!m) continue;
            const ctx = map.get(m.botId);
            if (!ctx) continue;
            ctx.replies.push({ authorLogin: h.authorLogin, body: h.body, sentiment: m.sentiment });
          }
        } catch {
          // matching failure on one PR is non-fatal; skip and continue
        }
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(MATCH_CONCURRENCY, llmMatchQueue.length); i++) {
      workers.push(runMatchWorker());
    }
    await Promise.all(workers);
  }

  return map;
}
