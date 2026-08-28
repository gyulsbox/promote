import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PromotionCandidate, AnalysisStats, SkippedItem } from "../core/types.js";
import { VERSION } from "../version.js";

const TEMPLATE_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
];

export function findPullRequestTemplate(cwd: string = process.cwd()): { path: string; body: string } | null {
  for (const rel of TEMPLATE_PATHS) {
    const full = resolve(cwd, rel);
    if (existsSync(full)) {
      try {
        const body = readFileSync(full, "utf-8");
        return { path: rel, body };
      } catch {
        continue;
      }
    }
  }
  return null;
}

export type BundledBodyInput = {
  candidates: Array<PromotionCandidate & { targetFile: string }>;
  stats?: Pick<AnalysisStats, "prCount">;
  sinceDays: number;
  date: Date;
  /**
   * The PR body header to use. Two ways to populate it:
   *   - LLM-filled template body (preferred when template exists): pass the
   *     output of fillTemplateWithLlm() here.
   *   - Raw template body: passed through verbatim.
   * The candidate list, evidence and footer are always appended below it.
   * If undefined, a one-line intro is emitted instead.
   */
  prefilledHeader?: string;
  digestPath?: string;
  /**
   * Patterns that were examined but not turned into candidates. Shown
   * collapsed so a reviewer can see what was weighed and rejected - without
   * it the PR only ever shows what promote wants, which reads as a tool with
   * no judgement.
   */
  skipped?: SkippedItem[];
};

/**
 * Marker for the per-candidate decision list.
 *
 * The next scan finds the most recent promote PR and reads this section back,
 * so a reviewer who unchecks a candidate is not offered it again. That makes
 * approval per-candidate rather than merge-everything-or-close, which is what
 * the checklist is for - a bundled PR of twenty drafts has no other way to say
 * "these three yes, the rest no", and a team that can only close the PR gets
 * the identical PR again next week.
 */
export const DECISION_SECTION_HEADING = "## Candidates";

/** Matches one rendered decision line, capturing its checked state and ID. */
export const DECISION_LINE_RE = /^[-*]\s+\[( |x|X)\]\s+`(candidate_\d+)`/;

export function buildBundledPrBody(input: BundledBodyInput): string {
  const isoDate = input.date.toISOString().split("T")[0];
  const sections: string[] = [];

  // A repo's own PR template, when it has one, still leads. Everything below
  // is ordered decisions-first: the boilerplate that reads the same every week
  // is one footer line, because a reviewer who has seen one week's "Why
  // promote" paragraph has seen all of them, and burying the candidate list
  // under it puts the only part worth reading below the fold.
  if (input.prefilledHeader && input.prefilledHeader.trim().length > 0) {
    sections.push(input.prefilledHeader.trimEnd());
  } else {
    sections.push(buildIntro(input));
  }

  sections.push(DECISION_SECTION_HEADING);
  sections.push(renderDecisionList(input.candidates));
  sections.push(
    "Uncheck anything that should not land. The next scan reads this list back and will not propose an unchecked candidate again.",
  );

  sections.push("## Evidence");
  for (const c of input.candidates) {
    sections.push(renderCandidateDetails(c));
  }

  const notProposed = renderNotProposed(input.skipped ?? []);
  if (notProposed) {
    sections.push("## Not proposed");
    sections.push(notProposed);
  }

  sections.push("---");
  sections.push(renderFooter(input, isoDate));

  return sections.join("\n\n") + "\n";
}

function buildIntro(input: BundledBodyInput): string {
  const count = input.candidates.length;
  const prCount = input.stats?.prCount;
  return (
    `\`promote-cli\` found ${count} repeated AI review pattern${count === 1 ? "" : "s"}` +
    (prCount ? ` across ${prCount} PR${prCount === 1 ? "" : "s"}` : "") +
    ` over the last ${input.sinceDays} days, and drafted the memory update${count === 1 ? "" : "s"} below.`
  );
}

/**
 * One GitHub task-list line per candidate. Deliberately flat: a collapsed
 * `<details>` block inside a list item stops GitHub rendering the checkbox,
 * so the detail lives in its own section below.
 */
function renderDecisionList(candidates: Array<PromotionCandidate & { targetFile: string }>): string {
  return candidates
    .map((c) => {
      const prs = new Set((c.occurrences ?? []).map((o) => o.prNumber)).size;
      const facts = [
        `\`${c.targetFile}\``,
        `confidence ${formatConfidence(c.confidence)}`,
        `${prs} PR${prs === 1 ? "" : "s"}`,
      ].join(" · ");
      return `- [x] \`${c.id}\` — ${c.summary} → ${facts}`;
    })
    .join("\n");
}

function renderCandidateDetails(c: PromotionCandidate & { targetFile: string }): string {
  const lines = [`<details>`, `<summary><b>${c.id}</b> — ${c.summary}</summary>`, ``];
  lines.push(...renderCandidateFacts(c));
  lines.push(``, `</details>`);
  return lines.join("\n");
}

function renderNotProposed(skipped: SkippedItem[]): string | null {
  // classify-failed is an error, not a decision, and is already reported in
  // the scan output; listing it here reads as a rejected candidate.
  const shown = skipped.filter((s) => s.reason !== "classify-failed");
  if (shown.length === 0) return null;

  const byReason = new Map<string, SkippedItem[]>();
  for (const item of shown) {
    const bucket = byReason.get(item.reason);
    if (bucket) bucket.push(item);
    else byReason.set(item.reason, [item]);
  }

  const body: string[] = [
    `<details>`,
    `<summary>${shown.length} pattern${shown.length === 1 ? " was" : "s were"} considered and left out</summary>`,
    ``,
  ];
  for (const [reason, items] of [...byReason.entries()].sort()) {
    body.push(`**${SKIP_REASON_LABELS[reason] ?? reason}**`, ``);
    for (const item of items) {
      const conf = item.confidence !== undefined ? ` (${formatConfidence(item.confidence)})` : "";
      body.push(`- ${item.summary}${conf}`);
    }
    body.push(``);
  }
  body.push(`</details>`);
  return body.join("\n");
}

const SKIP_REASON_LABELS: Record<string, string> = {
  "already-promoted": "Already in a memory file",
  "already-ignored": "Ignored in an earlier scan",
  "not-promotable": "Not a durable convention",
  "low-confidence": "Below the confidence floor",
};

function renderFooter(input: BundledBodyInput, isoDate: string): string {
  const lines = [
    `Generated by \`promote-cli\` v${VERSION} from the ${isoDate} scan. Each draft is LLM-written and needs human review before merge.`,
  ];
  if (input.digestPath) {
    lines.push(
      `Full digest, including everything not proposed here: \`${input.digestPath}\`.`,
    );
  }
  return lines.join(" ");
}

export type SingleBodyInput = {
  candidate: PromotionCandidate & { targetFile: string };
  date: Date;
  prefilledHeader?: string;
};

export function buildSinglePrBody(input: SingleBodyInput): string {
  const isoDate = input.date.toISOString().split("T")[0];
  const sections: string[] = [];

  if (input.prefilledHeader && input.prefilledHeader.trim().length > 0) {
    sections.push(input.prefilledHeader.trimEnd());
  } else {
    const buckets = buildSingleBuckets(input);
    sections.push("## Summary", buckets.description);
    sections.push("## Why", buckets.why);
    sections.push("## Changes", buckets.changes);
    sections.push("## Testing", buckets.testing);
  }

  sections.push("## Evidence");
  sections.push(renderCandidateFacts(input.candidate).join("\n"));
  sections.push("---");
  sections.push(
    `Generated by \`promote-cli\` v${VERSION} from the ${isoDate} scan. The draft is LLM-written and needs human review before merge.`,
  );

  return sections.join("\n\n") + "\n";
}

function buildSingleBuckets(input: SingleBodyInput): Record<"description" | "why" | "changes" | "testing", string> {
  const c = input.candidate;
  const description =
    `Promote a repeated AI review pattern into \`${c.targetFile}\`: ${c.summary}. ` +
    `See **Memory promotion details** below for evidence.`;
  const why = c.reasoning;
  const changes = `- \`${c.targetFile}\` — ${c.summary} (${c.id}, confidence ${formatConfidence(c.confidence)})`;
  const testing =
    `- This draft was generated by LLM and requires human review before merge.\n` +
    `- Read the appended content in \`${c.targetFile}\` and compare with the reasoning in **Memory promotion details**.`;
  return { description, why, changes, testing };
}

/**
 * The facts a reviewer needs to judge one candidate, without a heading -
 * the bundled body wraps these in a collapsed block, the single-candidate
 * body prints them flat.
 */
function renderCandidateFacts(c: PromotionCandidate & { targetFile: string }): string[] {
  const lines: string[] = [`- **Target file:** \`${c.targetFile}\``];
  lines.push(`- **Confidence:** ${formatConfidence(c.confidence)} (${c.target})`);

  const occurrences = c.occurrences ?? [];
  const evidence = occurrences.slice(0, 5);
  if (evidence.length > 0) {
    const items = evidence.map((o) => {
      const path = o.path ? ` \`${o.path}\`` : "";
      return `[#${o.prNumber}](${o.url})${path}`;
    });
    const more = occurrences.length > 5 ? `, and ${occurrences.length - 5} more` : "";
    lines.push(`- **Evidence:** ${items.join(", ")}${more}`);
  }

  if (c.reasoning) {
    lines.push(`- **Reasoning:** ${c.reasoning}`);
  }

  if (c.alternatives && c.alternatives.length > 0) {
    const alts = c.alternatives.map((a) => `${a.target}: ${a.reason}`).join("; ");
    lines.push(`- **Alternatives considered:** ${alts}`);
  }

  if (c.humanSignal) {
    const hs = c.humanSignal;
    const bits = [
      hs.agreementCount ? `${hs.agreementCount} agreed` : null,
      hs.rejectionCount ? `${hs.rejectionCount} dismissed` : null,
      hs.plusOneCount ? `👍 ${hs.plusOneCount}` : null,
      hs.minusOneCount ? `👎 ${hs.minusOneCount}` : null,
    ].filter(Boolean);
    if (bits.length > 0) {
      lines.push(`- **Human signal:** ${bits.join(" · ")}`);
    }
  }

  return lines;
}


export function formatConfidence(n: number): string {
  return n.toFixed(2);
}

export function buildBundledPrTitle(date: Date, count: number): string {
  const isoDate = date.toISOString().split("T")[0];
  return `promote: ${count} memory update${count === 1 ? "" : "s"} from ${isoDate} scan`;
}

export function buildSinglePrTitle(candidate: { summary: string }): string {
  const trimmed = candidate.summary.length > 60 ? candidate.summary.slice(0, 57) + "..." : candidate.summary;
  return `promote: ${trimmed}`;
}
