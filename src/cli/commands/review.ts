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
    console.log();
    console.log(chalk.bold.cyan(`  ─── Candidate ${num} ───`));
    console.log();
    console.log(`  ${chalk.bold(c.summary)}`);
    console.log();
    console.log(`  ${chalk.dim("Target")}      ${chalk.cyan(c.target)}${c.suggestedFile ? chalk.dim(` → ${c.suggestedFile}`) : ""}`);
    console.log(`  ${chalk.dim("Confidence")}  ${c.confidence}`);
    console.log(`  ${chalk.dim("Occurrences")} ${c.occurrences.length}`);
    if (c.pathScope) {
      console.log(`  ${chalk.dim("Path scope")}  ${c.pathScope}`);
    }
    console.log();

    // Evidence
    console.log(`  ${chalk.dim("Evidence:")}`);
    for (const o of c.occurrences.slice(0, 3)) {
      console.log(`    ${chalk.dim("PR #" + o.prNumber)} ${o.path ?? ""}`);
    }
    if (c.occurrences.length > 3) {
      console.log(chalk.dim(`    +${c.occurrences.length - 3} more`));
    }
    console.log();

    // Patch preview
    console.log(`  ${chalk.dim("Patch:")}`);
    const patchLines = c.draft.content.split("\n").slice(0, 8);
    for (const line of patchLines) {
      console.log(chalk.green(`    ${line}`));
    }
    if (c.draft.content.split("\n").length > 8) {
      console.log(chalk.dim("    ..."));
    }
    console.log();

    // Show full patch if truncated
    const patchTruncated = c.draft.content.split("\n").length > 8;

    let action: string | symbol;

    // Loop to allow "show full" then come back to decision
    while (true) {
      action = await p.select({
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
          ...(patchTruncated
            ? [{ value: "show-full", label: "Show full patch", hint: "see complete content" }]
            : []),
          {
            value: "skip",
            label: "Skip",
            hint: "move to next candidate",
          },
        ],
      });

      if (p.isCancel(action)) {
        mascotSays("Review cancelled. Remaining candidates saved in digest.");
        return actions;
      }

      if (action === "show-full") {
        console.log();
        console.log(chalk.dim("  ─── Full patch ───"));
        console.log();
        for (const line of c.draft.content.split("\n")) {
          console.log(chalk.green(`    ${line}`));
        }
        console.log();
        continue; // back to action selection
      }

      break; // got a real action
    }

    if (p.isCancel(action)) {
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
