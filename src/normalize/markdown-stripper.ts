/**
 * Strip markdown formatting while preserving meaningful content.
 * - Removes large code blocks (>10 lines) as they're usually quoted source
 * - Keeps short inline code and backtick references
 * - Removes HTML tags, images, link formatting
 * - Preserves the text content of links
 */
export function stripMarkdown(text: string): string {
  let result = text;

  // Remove large code blocks (>10 lines) — usually quoted source code
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split("\n").length;
    return lines > 10 ? "" : match;
  });

  // Remove remaining code fences but keep content for short blocks
  result = result.replace(/```\w*\n([\s\S]*?)```/g, "$1");

  // Remove HTML comments
  result = result.replace(/<!--[\s\S]*?-->/g, "");

  // Remove HTML tags
  result = result.replace(/<[^>]+>/g, "");

  // Remove images
  result = result.replace(/!\[.*?\]\(.*?\)/g, "");

  // Preserve link text, remove URL
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove heading markers but keep text
  result = result.replace(/^#{1,6}\s+/gm, "");

  // Remove bold/italic markers
  result = result.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  result = result.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");

  // Remove strikethrough
  result = result.replace(/~~([^~]+)~~/g, "$1");

  // Remove blockquote markers
  result = result.replace(/^>\s?/gm, "");

  // Remove horizontal rules
  result = result.replace(/^[-*_]{3,}\s*$/gm, "");

  // Collapse multiple newlines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
