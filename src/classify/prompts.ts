export const CLASSIFICATION_SYSTEM_PROMPT = `You are a repository memory router. You analyze clusters of repeated AI code review comments and decide where the underlying knowledge should be durably stored.

You are conservative. Most comments should NOT be promoted. Only promote when:
- The pattern is genuinely repeated (not just similar phrasing about different issues)
- The knowledge would help future humans or AI agents
- The knowledge is not already documented in existing memory files

Available routing targets:
- none: Not worth preserving. One-off, vague, or already documented.
- pr_only: Relevant only to the specific PRs where it appeared.
- agents: Repo-wide AI instruction (AGENTS.md, CLAUDE.md, copilot-instructions.md). Use when the pattern is a cross-cutting coding convention or practice.
- path_scoped_rule: Rule applies to a specific directory or domain. Use when the pattern is limited to a path prefix like payment/**, api/**, etc.
- adr: The "why" behind a decision matters, not just the "what". Use when comments explain architectural rationale or trade-off reasoning.
- test: A runtime invariant that should be mechanically enforced. Use when comments describe behavior that users/systems depend on.

Decision rules:
- If the comments are about different underlying issues despite surface similarity, output none.
- If the knowledge is specific to one-off code, output pr_only.
- If it is a repeated cross-feature convention, output agents.
- If it only applies to specific paths, output path_scoped_rule.
- If the reasoning for a decision matters more than the rule itself, output adr.
- If it describes a testable invariant, output test.
- When confidence is below 0.7, set needsHumanDecision to true.`;

import { sanitizeUnicode } from "../normalize/sanitize.js";
import type { HumanReactionSignal } from "../core/types.js";

const LANG_NAMES: Record<string, string> = {
  ko: "Korean",
  ja: "Japanese",
  en: "English",
};

export function buildClassificationPrompt(input: {
  summary: string;
  examples: Array<{ prNumber: number; path?: string; excerpt: string; severity?: string; diffHunk?: string }>;
  identifiers: string[];
  paths: string[];
  existingMemory: string[];
  outputLanguage?: string;
  humanSignal?: HumanReactionSignal;
}): string {
  const exampleList = input.examples
    .map((e, i) => {
      const sev = e.severity ? `[${e.severity}] ` : "";
      let line = `${i + 1}. ${sev}PR #${e.prNumber}${e.path ? ` [${e.path}]` : ""}: ${sanitizeUnicode(e.excerpt)}`;
      if (e.diffHunk) {
        const hunk = e.diffHunk.slice(0, 150).replace(/\n/g, "↵");
        line += `\n   diff: ${hunk}`;
      }
      return line;
    })
    .join("\n");

  const identifierList =
    input.identifiers.length > 0
      ? `\nIdentifiers mentioned: ${input.identifiers.join(", ")}`
      : "";

  const pathList =
    input.paths.length > 0
      ? `\nPaths involved: ${input.paths.join(", ")}`
      : "";

  const memoryContext =
    input.existingMemory.length > 0
      ? `\n\nExisting repository memory:\n${input.existingMemory.join("\n\n")}`
      : "\n\nNo existing repository memory files found.";

  const humanSignalSection = (() => {
    const s = input.humanSignal;
    if (!s) return "";
    const parts: string[] = [];
    if (s.agreementCount > 0) parts.push(`${s.agreementCount} reviewer(s) agreed (e.g. "good catch", "LGTM")`);
    if (s.rejectionCount > 0) parts.push(`${s.rejectionCount} reviewer(s) indicated this is a special case or intentional`);
    if (s.plusOneCount > 0) parts.push(`👍 ${s.plusOneCount}`);
    if (s.minusOneCount > 0) parts.push(`👎 ${s.minusOneCount}`);
    if (parts.length === 0) return "";
    let section = `\nHuman reviewer reactions: ${parts.join(", ")}.`;
    if (s.topRejectExcerpt) section += `\nDismissal context: "${s.topRejectExcerpt}"`;
    return section;
  })();

  const langInstruction = input.outputLanguage && input.outputLanguage !== "en"
    ? `\n\nIMPORTANT: Write the summary and reason fields in ${LANG_NAMES[input.outputLanguage] ?? input.outputLanguage}.`
    : "";

  return `Analyze this cluster of ${input.examples.length} repeated AI review comments.

Cluster summary: ${input.summary}
${identifierList}${pathList}
${humanSignalSection}
Examples:
${exampleList}
${memoryContext}

Classify this cluster. Return JSON only.${langInstruction}`;
}
