/** Remove lone surrogates and other problematic Unicode that breaks JSON serialization */
export function sanitizeUnicode(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/\uFFFD/g, "");
}
