import type { RawReviewComment } from "../core/types.js";

const BOT_SUFFIX_PATTERN = /\[bot\]$/i;
const BOT_NAME_PATTERNS = [/-bot$/, /-app$/, /^bot-/];

export function isAIReviewComment(
  comment: RawReviewComment,
  allowlist: string[],
): boolean {
  // 1. Allowlist match
  if (allowlist.includes(comment.authorLogin)) {
    return true;
  }

  // 2. GitHub Bot account type
  if (comment.authorType === "Bot") {
    return true;
  }

  // 3. Name pattern heuristics
  const login = comment.authorLogin.toLowerCase();
  if (BOT_SUFFIX_PATTERN.test(login)) {
    return true;
  }

  for (const pattern of BOT_NAME_PATTERNS) {
    if (pattern.test(login)) {
      return true;
    }
  }

  return false;
}

export function filterAIReviewComments(
  comments: RawReviewComment[],
  allowlist: string[],
): { ai: RawReviewComment[]; human: RawReviewComment[] } {
  const ai: RawReviewComment[] = [];
  const human: RawReviewComment[] = [];

  for (const comment of comments) {
    if (isAIReviewComment(comment, allowlist)) {
      ai.push(comment);
    } else {
      human.push(comment);
    }
  }

  return { ai, human };
}
