import type { RawReviewComment, NormalizedComment } from "../core/types.js";
import { stripMarkdown } from "./markdown-stripper.js";
import { sanitizeUnicode } from "./sanitize.js";
import { stripBotSignatures } from "./bot-stripper.js";
import {
  extractIdentifiers,
  extractPaths,
  extractActionVerbs,
  extractSeverityMarker,
  detectLanguage,
} from "./identifier-extractor.js";

export function normalizeComment(comment: RawReviewComment): NormalizedComment {
  // Extract severity from original body before any stripping
  const severityMarker = extractSeverityMarker(comment.body);

  // Strip bot signature blocks, then markdown formatting
  let body = sanitizeUnicode(comment.body);
  body = stripBotSignatures(body, comment.authorLogin);
  const normalizedBody = stripMarkdown(body).trim();

  // Detect language first so Ko/Ja verbs can be extracted
  const language = detectLanguage(normalizedBody);

  // Extract structured features from original body to catch backtick-wrapped identifiers
  const identifiers = extractIdentifiers(comment.body);
  const paths = extractPaths(comment.body, comment.path);
  const actionVerbs = extractActionVerbs(normalizedBody, language);

  return {
    id: comment.id,
    originalBody: comment.body,
    normalizedBody,
    identifiers,
    paths,
    actionVerbs,
    severityMarker,
    language,
    prNumber: comment.prNumber,
    authorLogin: comment.authorLogin,
    htmlUrl: comment.htmlUrl,
    createdAt: comment.createdAt,
    filePath: comment.path,
    diffHunk: comment.diffHunk,
  };
}

export function normalizeComments(comments: RawReviewComment[]): NormalizedComment[] {
  return comments.map(normalizeComment);
}
