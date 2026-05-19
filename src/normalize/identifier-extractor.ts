/**
 * Extract structured features from review comment text:
 * - Identifiers (function names, variable names, class names)
 * - File paths
 * - Action verbs (use, avoid, prefer, etc.)
 * - Language detection
 */

// Common action verbs found in code review comments
const ACTION_VERBS = new Set([
  "use", "avoid", "prefer", "replace", "move", "extract", "rename",
  "remove", "add", "ensure", "consider", "should", "must", "never",
  "always", "instead", "import", "export", "wrap", "call", "return",
  "throw", "handle", "check", "validate", "convert", "refactor",
]);

// Regex for backtick-wrapped identifiers
const BACKTICK_RE = /`([^`]+)`/g;

// Regex for path-like strings
const PATH_RE = /(?:^|\s|["'(])([a-zA-Z0-9_./-]+(?:\/[a-zA-Z0-9_./-]+)+(?:\.[a-zA-Z0-9]+)?)/g;

// Regex for camelCase/PascalCase tokens
const CAMEL_RE = /\b([a-z][a-zA-Z0-9]{2,}[A-Z][a-zA-Z0-9]*)\b/g;
const PASCAL_RE = /\b([A-Z][a-zA-Z0-9]{2,})\b/g;

// Regex for snake_case tokens
const SNAKE_RE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

// CJK character ranges
const CJK_RE = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uac00-\ud7af]/g;
const HIRAGANA_KATAKANA_RE = /[\u3040-\u309f\u30a0-\u30ff]/g;
const HANGUL_RE = /[\uac00-\ud7af\u1100-\u11ff]/g;

export function extractIdentifiers(text: string): string[] {
  const identifiers = new Set<string>();

  // Backtick-wrapped identifiers (highest signal)
  for (const match of text.matchAll(BACKTICK_RE)) {
    const token = match[1].trim();
    // Skip if it looks like a full sentence or command
    if (token.length <= 80 && !token.includes("\n")) {
      identifiers.add(token);
    }
  }

  // camelCase tokens
  for (const match of text.matchAll(CAMEL_RE)) {
    identifiers.add(match[1]);
  }

  // PascalCase tokens (filter out common English words)
  for (const match of text.matchAll(PASCAL_RE)) {
    const token = match[1];
    if (token.length > 3 && !COMMON_WORDS.has(token.toLowerCase())) {
      identifiers.add(token);
    }
  }

  // snake_case tokens
  for (const match of text.matchAll(SNAKE_RE)) {
    identifiers.add(match[1]);
  }

  return [...identifiers];
}

export function extractPaths(text: string, commentPath?: string): string[] {
  const paths = new Set<string>();

  // Path from the comment's file attachment
  if (commentPath) {
    paths.add(commentPath);
  }

  // Backtick-wrapped paths
  for (const match of text.matchAll(BACKTICK_RE)) {
    const token = match[1].trim();
    if (looksLikePath(token)) {
      paths.add(token);
    }
  }

  // Bare paths in text
  for (const match of text.matchAll(PATH_RE)) {
    const token = match[1];
    if (looksLikePath(token)) {
      paths.add(token);
    }
  }

  return [...paths];
}

export function extractActionVerbs(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const found = new Set<string>();

  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, "");
    if (ACTION_VERBS.has(cleaned)) {
      found.add(cleaned);
    }
  }

  return [...found];
}

export function detectLanguage(text: string): "en" | "ja" | "ko" | "mixed" | "unknown" {
  const cjkMatches = text.match(CJK_RE);
  const totalChars = text.replace(/\s/g, "").length;

  if (!cjkMatches || totalChars === 0) return "en";

  const cjkRatio = cjkMatches.length / totalChars;

  if (cjkRatio < 0.05) return "en";
  if (cjkRatio < 0.3) return "mixed";

  // Distinguish Japanese from Korean
  const jpMatches = text.match(HIRAGANA_KATAKANA_RE);
  const krMatches = text.match(HANGUL_RE);
  const jpCount = jpMatches?.length ?? 0;
  const krCount = krMatches?.length ?? 0;

  if (jpCount > krCount) return "ja";
  if (krCount > jpCount) return "ko";
  return "mixed";
}

function looksLikePath(token: string): boolean {
  return (
    token.includes("/") &&
    !token.startsWith("http") &&
    !token.startsWith("//") &&
    token.length < 200 &&
    /\.[a-zA-Z0-9]+$/.test(token) || token.includes("/**")
  );
}

const COMMON_WORDS = new Set([
  "the", "this", "that", "with", "from", "have", "been",
  "will", "would", "could", "should", "these", "those",
  "when", "where", "which", "while", "about", "after",
  "before", "between", "does", "each", "every", "into",
  "just", "like", "make", "many", "more", "most", "much",
  "need", "only", "other", "over", "some", "such", "than",
  "them", "then", "there", "they", "very", "want", "what",
  "your", "also", "back", "being", "both", "case", "come",
  "down", "even", "first", "give", "good", "here", "high",
  "last", "long", "look", "make", "most", "name", "next",
  "note", "number", "part", "place", "point", "right",
  "same", "since", "small", "state", "still", "take",
  "tell", "text", "time", "turn", "under", "well", "work",
]);
