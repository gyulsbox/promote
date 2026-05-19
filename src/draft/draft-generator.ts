import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { Cluster, RoutingDecision, DraftPromotion } from "../core/types.js";
import type { CostTracker } from "../llm/cost-tracker.js";
import { sanitizeUnicode } from "../normalize/sanitize.js";

const DRAFT_PROMPTS: Record<string, string> = {
  agents: `Generate a concise section for an AI instruction file (AGENTS.md or similar).
Rules:
- Use bullet points
- Start with a clear heading (## level)
- Be specific about what to do and what not to do
- Reference concrete file paths or patterns where possible
- Maximum 5 bullet points
- Do not include meta-commentary, just the rule text`,

  path_scoped_rule: `Generate a path-scoped instruction file.
Include YAML frontmatter with an applyTo glob pattern.
Rules:
- Be specific to the domain/path
- Maximum 5 bullet points
- Reference concrete utilities or patterns
Format:
---
applyTo: "glob/pattern/**"
---
# Section title
- Rule 1
- Rule 2`,

  adr: `Generate an Architecture Decision Record (ADR).
Format:
# ADR-NNN: Title
## Status
Proposed
## Context
Why this decision matters (2-3 sentences)
## Decision
What was decided (2-3 sentences)
## Consequences
What follows from this decision (bullet points)`,

  test: `Describe a test that should be written to enforce this invariant.
Format:
- Test file location suggestion
- What the test should assert (in natural language)
- A brief code sketch showing the test structure
Keep it concise — this is a recommendation, not a full implementation.`,
};

export async function generateDraft(input: {
  cluster: Cluster;
  decision: RoutingDecision;
  model: LanguageModel;
  costTracker: CostTracker;
  preferredLanguage: string;
}): Promise<DraftPromotion> {
  const { cluster, decision, model, costTracker, preferredLanguage } = input;

  const templatePrompt = DRAFT_PROMPTS[decision.target] ?? DRAFT_PROMPTS.agents;

  const examples = cluster.members
    .slice(0, 3)
    .map((m) => sanitizeUnicode(m.normalizedBody.slice(0, 200)))
    .join("\n---\n");

  const { text, usage } = await generateText({
    model,
    system: templatePrompt,
    prompt: `Based on these repeated review comments, generate the appropriate content.

Pattern summary: ${decision.summary}
Reason: ${decision.reason}
${decision.pathScope ? `Path scope: ${decision.pathScope}` : ""}

Example comments:
${examples}

Output language: ${preferredLanguage}
Generate the content only. No explanations.`,
  });

  costTracker.record("drafting", {
    promptTokens: usage?.inputTokens ?? 0,
    completionTokens: usage?.outputTokens ?? 0,
  });

  const targetFile = decision.suggestedFile ?? getDefaultFile(decision.target);

  return {
    targetFile,
    content: text.trim(),
    insertionHint: decision.target === "adr" ? "new file" : "append to end",
  };
}

function getDefaultFile(target: string): string {
  switch (target) {
    case "agents":
      return "AGENTS.md";
    case "path_scoped_rule":
      return ".github/instructions/rule.instructions.md";
    case "adr":
      return "docs/adr/NNN-title.md";
    case "test":
      return "(test file)";
    default:
      return "AGENTS.md";
  }
}
