import * as p from "@clack/prompts";
import chalk from "chalk";
import type { PromotionCandidate } from "../../core/types.js";
import { mascotSays } from "../mascot.js";

const TARGET_LABELS: Record<string, string> = {
  agents: "AGENTS.md / CLAUDE.md (repo-wide instruction)",
  path_scoped_rule: "Path-scoped rule (.github/instructions/)",
  adr: "ADR (Architecture Decision Record)",
  test: "Test (runtime invariant)",
};

export type ReviewStats = {
  promoted: number;
  skipped: number;
  ignored: number;
};

/**
 * Review candidates one by one. Calls onPromote immediately when the user
 * approves a candidate — no batch collection, no deferred apply.
 */
export async function runInteractiveReview(
  candidates: PromotionCandidate[],
  onPromote: (candidate: PromotionCandidate, target: string) => Promise<void>,
): Promise<ReviewStats> {
  const stats: ReviewStats = { promoted: 0, skipped: 0, ignored: 0 };

  console.log();
  mascotSays(`${candidates.length} candidate(s) to review.`);
  console.log();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const num = `${i + 1}/${candidates.length}`;

    printCandidateDetails(c, num);

    const patchTruncated = c.draft.content.split("\n").length > 8;
    let action: string | symbol;

    while (true) {
      action = await p.select({
        message: "What do you want to do with this candidate?",
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
            hint: "decide later with: promote <id>",
          },
        ],
      });

      if (p.isCancel(action)) {
        mascotSays("Review cancelled. Remaining candidates saved in digest.");
        return stats;
      }

      if (action === "show-full") {
        console.log();
        console.log(chalk.dim("  ─── Full patch ───"));
        console.log();
        for (const line of c.draft.content.split("\n")) {
          console.log(chalk.green(`    ${line}`));
        }
        console.log();
        continue;
      }

      break;
    }

    if (action === "change-target") {
      const newTarget = await p.select({
        message: "Which target?",
        options: Object.entries(TARGET_LABELS).map(([value, hint]) => ({ value, label: value, hint })),
      });

      if (p.isCancel(newTarget)) {
        stats.skipped++;
        continue;
      }

      await onPromote(c, newTarget as string);
      stats.promoted++;
    } else if (action === "promote") {
      await onPromote(c, c.target);
      stats.promoted++;
    } else {
      stats.skipped++;
    }
  }

  return stats;
}

function printCandidateDetails(c: PromotionCandidate, num: string) {
  console.log();
  console.log(chalk.bold.cyan(`  ─── Candidate ${num} ───`));
  console.log();
  console.log(`  ${chalk.bold(c.summary)}`);
  console.log();
  console.log(`  ${chalk.dim("ID")}          ${chalk.dim(c.id)}`);
  console.log(`  ${chalk.dim("Target")}      ${chalk.cyan(c.target)}${c.suggestedFile ? chalk.dim(` → ${c.suggestedFile}`) : ""}`);
  console.log(`  ${chalk.dim("Confidence")}  ${c.confidence}`);
  console.log(`  ${chalk.dim("Occurrences")} ${c.occurrences.length}`);
  if (c.pathScope) {
    console.log(`  ${chalk.dim("Path scope")}  ${c.pathScope}`);
  }
  console.log();

  console.log(`  ${chalk.dim("Evidence:")}`);
  for (const o of c.occurrences.slice(0, 3)) {
    console.log(`    ${chalk.dim("PR #" + o.prNumber)} ${o.path ?? ""}`);
  }
  if (c.occurrences.length > 3) {
    console.log(chalk.dim(`    +${c.occurrences.length - 3} more`));
  }

  if (c.humanSignal) {
    const s = c.humanSignal;
    const hasSignal = s.agreementCount + s.rejectionCount + s.plusOneCount + s.minusOneCount > 0;
    if (hasSignal) {
      const parts: string[] = [];
      if (s.agreementCount > 0) parts.push(chalk.green(`Agreed: ${s.agreementCount}`));
      if (s.rejectionCount > 0) parts.push(chalk.red(`Dismissed: ${s.rejectionCount}`));
      if (s.plusOneCount > 0) parts.push(`👍 ${s.plusOneCount}`);
      if (s.minusOneCount > 0) parts.push(`👎 ${s.minusOneCount}`);
      console.log(`  ${chalk.dim("Human signal")} ${parts.join(" · ")}`);
      if (s.firstRejectExcerpt) {
        console.log(`  ${chalk.dim("Dismissal")}   ${chalk.yellow(`"${s.firstRejectExcerpt}"`)}`);
      }
    }
  }
  console.log();

  console.log(`  ${chalk.dim("Patch:")}`);
  const patchLines = c.draft.content.split("\n").slice(0, 8);
  for (const line of patchLines) {
    console.log(chalk.green(`    ${line}`));
  }
  if (c.draft.content.split("\n").length > 8) {
    console.log(chalk.dim("    ..."));
  }
  console.log();
}

export { printCandidateDetails };
