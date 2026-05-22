import * as p from "@clack/prompts";
import chalk from "chalk";
import type { PromotionCandidate, SkippedItem, SkipReason } from "../../core/types.js";
import { mascotSays } from "../mascot.js";

const TARGET_LABELS: Record<string, string> = {
  agents: "AGENTS.md / CLAUDE.md (repo-wide instruction)",
  path_scoped_rule: "Path-scoped rule (.github/instructions/)",
  adr: "ADR (Architecture Decision Record)",
  test: "Test (runtime invariant)",
};

const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  "already-promoted": "already promoted",
  "already-ignored": "already ignored",
  "not-promotable": "not promotable",
  "low-confidence": "below confidence threshold",
  "classify-failed": "classify failed",
};

export type ReviewStats = {
  promoted: number;
  skipped: number;
  ignored: number;
  userSkippedCandidates: PromotionCandidate[];
};

/**
 * Review candidates one by one. Calls onPromote immediately when the user
 * approves a candidate — no batch collection, no deferred apply.
 */
export async function runInteractiveReview(
  candidates: PromotionCandidate[],
  onPromote: (candidate: PromotionCandidate, target: string) => Promise<void>,
  options?: { includeSkipped?: SkippedItem[] },
): Promise<ReviewStats> {
  const stats: ReviewStats = { promoted: 0, skipped: 0, ignored: 0, userSkippedCandidates: [] };

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
        process.exit(130);
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
        stats.userSkippedCandidates.push(c);
        continue;
      }

      await onPromote(c, newTarget as string);
      stats.promoted++;
    } else if (action === "promote") {
      await onPromote(c, c.target);
      stats.promoted++;
    } else {
      stats.skipped++;
      stats.userSkippedCandidates.push(c);
    }
  }

  if (options?.includeSkipped && options.includeSkipped.length > 0) {
    const decision = await p.select({
      message: `Also walk through ${options.includeSkipped.length} skipped item(s)?`,
      options: [
        { value: "walk", label: "Walk through them one by one", hint: "see each skipped item with its reason" },
        { value: "skip-all", label: "Skip all", hint: "go straight to digest decision" },
      ],
    });
    if (!p.isCancel(decision) && decision === "walk") {
      await walkSkipped(options.includeSkipped);
    }
  }

  return stats;
}

/**
 * Stand-alone read-only walker for filter-skipped items.
 * Used when there are zero promotion candidates but skipped items exist.
 */
export async function runSkippedReview(items: SkippedItem[]): Promise<void> {
  console.log();
  mascotSays(`${items.length} skipped item(s) to walk through.`);
  console.log();
  await walkSkipped(items);
}

async function walkSkipped(items: SkippedItem[]): Promise<void> {
  console.log();
  console.log(chalk.bold.dim("  ─── Skipped items ───"));
  console.log();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const num = `${i + 1}/${items.length}`;
    printSkippedDetails(item, num);

    const action = await p.select({
      message: "Continue?",
      options: [
        { value: "next", label: "Next", hint: "show the next skipped item" },
        { value: "skip-remaining", label: "Skip remaining", hint: "stop walking, keep the rest unseen" },
      ],
    });

    if (p.isCancel(action) || action === "skip-remaining") return;
  }
}

function printSkippedDetails(item: SkippedItem, num: string) {
  console.log();
  console.log(chalk.bold.dim(`  ─── Skipped ${num} ───`));
  console.log();
  console.log(`  ${chalk.bold(item.summary)}`);
  console.log();
  console.log(`  ${chalk.dim("Reason")}      ${chalk.yellow(SKIP_REASON_LABELS[item.reason])}`);
  if (item.target) {
    console.log(`  ${chalk.dim("Target")}      ${chalk.cyan(item.target)}`);
  }
  if (item.confidence !== undefined) {
    console.log(`  ${chalk.dim("Confidence")}  ${item.confidence}`);
  }
  if (item.detail) {
    console.log(`  ${chalk.dim("Detail")}      ${chalk.dim(item.detail.slice(0, 200))}`);
  }
  console.log();
}

function printCandidateDetails(c: PromotionCandidate, num: string) {
  console.log();
  console.log(chalk.bold.cyan(`  ─── Candidate ${num} ───`));
  console.log();
  console.log(`  ${chalk.bold(c.summary)}`);
  console.log();
  const uniquePrs = new Set(c.occurrences.map((o) => o.prNumber)).size;
  const scope = uniquePrs >= 2 ? chalk.green(`cross-PR (${uniquePrs} PRs)`) : chalk.yellow(`within-PR (1 PR)`);
  console.log(`  ${chalk.dim("ID")}          ${chalk.dim(c.id)}`);
  console.log(`  ${chalk.dim("Target")}      ${chalk.cyan(c.target)}${c.suggestedFile ? chalk.dim(` → ${c.suggestedFile}`) : ""}`);
  console.log(`  ${chalk.dim("Confidence")}  ${c.confidence}`);
  console.log(`  ${chalk.dim("Scope")}       ${scope}`);
  console.log(`  ${chalk.dim("Occurrences")} ${c.occurrences.length} comment${c.occurrences.length === 1 ? "" : "s"}`);
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
      if (s.agreementAuthors?.length) {
        console.log(`  ${chalk.dim("Agreed by")}   ${chalk.green(s.agreementAuthors.map((a) => `@${a}`).join(", "))}`);
      }
      if (s.firstAgreementExcerpt) {
        console.log(`  ${chalk.dim("Agreement")}  ${chalk.green(`"${s.firstAgreementExcerpt}"`)}`);
      }
      if (s.rejectionAuthors?.length) {
        console.log(`  ${chalk.dim("Dismissed by")}${chalk.red(s.rejectionAuthors.map((a) => `@${a}`).join(", "))}`);
      }
      if (s.firstRejectExcerpt) {
        console.log(`  ${chalk.dim("Dismissal")}  ${chalk.yellow(`"${s.firstRejectExcerpt}"`)}`);
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
