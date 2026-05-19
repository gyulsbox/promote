import * as p from "@clack/prompts";
import chalk from "chalk";
import type { PromotionCandidate } from "../../core/types.js";
import { mascotSays } from "../mascot.js";

export type ReviewAction = {
  candidateId: string;
  action: "promote" | "skip" | "ignore" | "change-target";
  newTarget?: string;
};

const TARGET_LABELS: Record<string, string> = {
  agents: "AGENTS.md / CLAUDE.md (repo-wide instruction)",
  path_scoped_rule: "Path-scoped rule (.github/instructions/)",
  adr: "ADR (Architecture Decision Record)",
  test: "Test (runtime invariant)",
};

export async function runInteractiveReview(
  candidates: PromotionCandidate[],
): Promise<ReviewAction[]> {
  const actions: ReviewAction[] = [];

  console.log();
  mascotSays(`${candidates.length} candidate(s) to review. Let's go through them.`);
  console.log();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const num = `${i + 1}/${candidates.length}`;

    // Show candidate details
    p.note(
      [
        `${chalk.bold(c.summary)}`,
        ``,
        `Target: ${chalk.cyan(c.target)}${c.suggestedFile ? ` → ${c.suggestedFile}` : ""}`,
        `Confidence: ${c.confidence}`,
        `Occurrences: ${c.occurrences.length}`,
        c.pathScope ? `Path scope: ${c.pathScope}` : null,
        ``,
        chalk.dim("Evidence:"),
        ...c.occurrences.slice(0, 3).map(
          (o) => chalk.dim(`  PR #${o.prNumber}${o.path ? ` ${o.path}` : ""}`),
        ),
        c.occurrences.length > 3 ? chalk.dim(`  ... +${c.occurrences.length - 3} more`) : null,
        ``,
        chalk.dim("Suggested patch:"),
        chalk.dim(c.draft.content.split("\n").slice(0, 6).map((l) => `  ${l}`).join("\n")),
        c.draft.content.split("\n").length > 6 ? chalk.dim("  ...") : null,
      ]
        .filter(Boolean)
        .join("\n"),
      `Candidate ${num}: ${c.id}`,
    );

    const action = await p.select({
      message: `What do you want to do with this candidate?`,
      options: [
        {
          value: "promote",
          label: `Promote → ${c.target}`,
          hint: c.suggestedFile ?? "",
        },
        {
          value: "change-target",
          label: "Promote (different target)",
          hint: "choose where to put it",
        },
        {
          value: "skip",
          label: "Skip for now",
          hint: "will appear in next scan",
        },
        {
          value: "ignore",
          label: "Ignore permanently",
          hint: "won't appear again",
        },
      ],
    });

    if (p.isCancel(action)) {
      mascotSays("Review cancelled. Remaining candidates saved in digest.");
      break;
    }

    if (action === "change-target") {
      const newTarget = await p.select({
        message: "Which target?",
        options: [
          { value: "agents", label: "agents", hint: TARGET_LABELS.agents },
          { value: "path_scoped_rule", label: "path_scoped_rule", hint: TARGET_LABELS.path_scoped_rule },
          { value: "adr", label: "adr", hint: TARGET_LABELS.adr },
          { value: "test", label: "test", hint: TARGET_LABELS.test },
        ],
      });

      if (p.isCancel(newTarget)) {
        actions.push({ candidateId: c.id, action: "skip" });
      } else {
        actions.push({
          candidateId: c.id,
          action: "change-target",
          newTarget: newTarget as string,
        });
      }
    } else {
      actions.push({ candidateId: c.id, action: action as ReviewAction["action"] });
    }
  }

  return actions;
}
