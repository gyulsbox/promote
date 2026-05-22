type StripRule = {
  pattern: RegExp;
  bot?: string; // substring match against authorLogin; undefined = apply to all
};

// Severity markers (P1:, nit:, **Nitpick:**, [!WARNING]) are extracted BEFORE
// stripping, so they must NOT appear in these patterns.
const STRIP_RULES: StripRule[] = [
  // GitHub Alert header lines — strip the [!FOO] line, preserve body text below
  { pattern: /\[!NOTE\][^\n]*/g },
  { pattern: /\[!TIP\][^\n]*/g },
  { pattern: /\[!IMPORTANT\][^\n]*/g },
  { pattern: /\[!WARNING\][^\n]*/g },
  { pattern: /\[!CAUTION\][^\n]*/g },

  // CodeRabbit: trailing footer + collapsible details blocks
  { pattern: /⚡[\s\S]*CodeRabbit[\s\S]*$/i, bot: "coderabbitai" },
  { pattern: /<details[\s\S]*?<\/details>/gi, bot: "coderabbitai" },

  // Common generated footers
  { pattern: /---\n\n<details>[\s\S]*$/ },
  { pattern: /<!-- [\s\S]*? -->/g },
  { pattern: /\n---\n\n\*\*[^\n]*generated[^\n]*/gi },
  { pattern: /\*This review was[^\n]*\*/gi },
];

export function stripBotSignatures(body: string, authorLogin?: string): string {
  let result = body;

  for (const rule of STRIP_RULES) {
    if (rule.bot && authorLogin && !authorLogin.toLowerCase().includes(rule.bot)) {
      continue;
    }
    result = result.replace(
      new RegExp(rule.pattern.source, rule.pattern.flags),
      "",
    );
  }

  return result.trim();
}
