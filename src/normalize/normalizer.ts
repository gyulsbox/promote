import type { RawReviewComment, NormalizedComment } from "../core/types.js";
import { stripMarkdown } from "./markdown-stripper.js";
import { sanitizeUnicode } from "./sanitize.js";
import {
  extractIdentifiers,
  extractPaths,
  extractActionVerbs,
  detectLanguage,
} from "./identifier-extractor.js";

// Known bot signature blocks to remove before normalization
const BOT_SIGNATURES = [
  /---\n\n<details>[\s\S]*$/,
  /<!-- .* -->/g,
  /\n---\n\n\*\*.*generated.*/gi,
  /\[!TIP\][\s\S]*?(?=\n\n|\n#|$)/g,
  /⚡.*CodeRabbit[\s\S]*$/i,
  /\*This review was.*\*/gi,
];

export function normalizeComment(comment: RawReviewComment): NormalizedComment {
  let body = sanitizeUnicode(comment.body);

  // Strip bot signature blocks
  for (const sig of BOT_SIGNATURES) {
    body = body.replace(sig, "");
  }

  // Strip markdown formatting
  const normalizedBody = stripMarkdown(body).trim();

  // Extract structured features from original body (before stripping)
  // to catch backtick-wrapped identifiers
  const identifiers = extractIdentifiers(comment.body);
  const paths = extractPaths(comment.body, comment.path);
  const actionVerbs = extractActionVerbs(normalizedBody);
  const language = detectLanguage(normalizedBody);

  return {
    id: comment.id,
    originalBody: comment.body,
    normalizedBody,
    identifiers,
    paths,
    actionVerbs,
    language,
    prNumber: comment.prNumber,
    authorLogin: comment.authorLogin,
    htmlUrl: comment.htmlUrl,
    createdAt: comment.createdAt,
    filePath: comment.path,
  };
}

export function normalizeComments(comments: RawReviewComment[]): NormalizedComment[] {
  return comments.map(normalizeComment);
}
