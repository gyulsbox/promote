import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { PromotionCandidate } from "../core/types.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { seedIfSupported, temperatureIfSupported, llmProviderOptions } from "../llm/provider.js";

export type TemplateFillFacts = {
  candidates: Array<PromotionCandidate & { targetFile: string }>;
  sinceDays: number;
  prCount?: number;
  digestPath?: string;
};

const SYSTEM_PROMPT = `You are filling a GitHub Pull Request template for a "promote-cli" PR.
This PR promotes repeated AI review comment patterns into the repository's
durable memory files (CLAUDE.md, AGENTS.md, ADRs, path-scoped rules, etc.).

Your job is to fill sections of the template using the FACTS provided.

Strict rules:
1. Output ONLY the filled template body. No preamble, no fences, no commentary.
2. Preserve the template's exact heading order, count, casing, and HTML structure.
3. Preserve checkbox items (- [ ]) verbatim — do not check, uncheck, or remove them.
4. Replace placeholder content (HTML comments like <!-- ... -->, "TBD", or empty section bodies) with concrete content drawn from the FACTS when the section's intent matches.
5. If a section's intent cannot be answered from the FACTS (e.g. screenshots, breaking-change notes, linked issues), keep its original placeholder/comment untouched.
6. Do NOT invent facts. Only use what is in the FACTS section.
7. Do NOT add new top-level (#, ##) headings. Use only what the template already declares.
8. Match the language of the template — if it is written in Korean or Japanese, fill it in Korean or Japanese.`;

export async function fillTemplateWithLlm(input: {
  templateBody: string;
  facts: TemplateFillFacts;
  model: LanguageModel;
  costTracker: CostTracker;
  outputLanguage?: string;
}): Promise<string> {
  const factsText = renderFacts(input.facts);

  const userPrompt = `=== TEMPLATE ===
${input.templateBody}

=== FACTS ===
${factsText}

Output language hint: ${input.outputLanguage ?? "match the template"}
Fill the template now.`;

  const { text, usage } = await generateText({
    model: input.model,
    providerOptions: llmProviderOptions(input.model),
    ...temperatureIfSupported(input.model),
    ...seedIfSupported(input.model),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  input.costTracker.record("drafting", {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
  });

  return stripCodeFenceWrapper(text.trim());
}

function renderFacts(facts: TemplateFillFacts): string {
  const lines: string[] = [];
  const coverage = facts.prCount
    ? ` covering ${facts.prCount} PR(s)`
    : "";
  lines.push(
    `- ${facts.candidates.length} candidate(s) promoted from a ${facts.sinceDays}-day scan${coverage}.`,
  );
  if (facts.digestPath) {
    lines.push(`- Full scan digest committed at \`${facts.digestPath}\`.`);
  }
  lines.push(`- Candidates:`);
  for (let i = 0; i < facts.candidates.length; i++) {
    const c = facts.candidates[i];
    lines.push(`  ${i + 1}. "${c.summary}"`);
    lines.push(`     File: ${c.targetFile}`);
    lines.push(`     Target: ${c.target}, confidence ${c.confidence}`);
    if (c.reasoning) lines.push(`     Reasoning: ${c.reasoning}`);
    const evidence = (c.occurrences ?? []).slice(0, 5);
    if (evidence.length > 0) {
      const ev = evidence.map((o) => `#${o.prNumber}${o.path ? ` ${o.path}` : ""}`).join(", ");
      const more = (c.occurrences?.length ?? 0) > 5 ? `, …${(c.occurrences?.length ?? 0) - 5} more` : "";
      lines.push(`     Evidence: ${ev}${more}`);
    }
    if (c.alternatives && c.alternatives.length > 0) {
      const alts = c.alternatives.map((a) => `${a.target}`).join(", ");
      lines.push(`     Alternatives considered: ${alts}`);
    }
  }
  return lines.join("\n");
}

function stripCodeFenceWrapper(text: string): string {
  // Some LLMs wrap the whole output in ```markdown ... ``` despite the system
  // prompt. Strip a single outer fence if present.
  const match = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/);
  return match ? match[1] : text;
}
