import type { Cluster, HumanReactionSignal } from "./types.js";
import type { BotCommentContext } from "../ingest/reply-context.js";

export function aggregateHumanSignal(
  cluster: Cluster,
  replyContextMap: Map<string, BotCommentContext>,
): HumanReactionSignal {
  let agree = 0;
  let reject = 0;
  let plusOne = 0;
  let minusOne = 0;
  let firstRejectExcerpt: string | undefined;

  for (const m of cluster.members) {
    const ctx = replyContextMap.get(m.id);
    if (!ctx) continue;
    for (const r of ctx.replies) {
      if (r.sentiment === "agree") agree++;
      if (r.sentiment === "reject") {
        reject++;
        if (!firstRejectExcerpt) firstRejectExcerpt = r.body.slice(0, 120);
      }
    }
    plusOne += ctx.reactions.plusOne;
    minusOne += ctx.reactions.minusOne;
  }

  return {
    agreementCount: agree,
    rejectionCount: reject,
    plusOneCount: plusOne,
    minusOneCount: minusOne,
    firstRejectExcerpt,
  };
}
