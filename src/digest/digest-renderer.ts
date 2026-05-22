import type { PromotionCandidate, AnalysisStats } from "../core/types.js";

const TRANSLATIONS: Record<string, {
  title: string;
  generated: string;
  summary: string;
  evidence: string;
  humanSignal: string;
  suggestedPatch: string;
  whyTarget: string;
  alternatives: string;
  actions: string;
  noCandidates: string;
}> = {
  en: {
    title: "Memory Promotion Digest",
    generated: "Generated on",
    summary: "Summary",
    evidence: "Evidence",
    humanSignal: "Human signal",
    suggestedPatch: "Suggested patch",
    whyTarget: "Why this target",
    alternatives: "Alternatives considered",
    actions: "Actions",
    noCandidates: "No promotion candidates found.",
  },
  ko: {
    title: "메모리 승격 다이제스트",
    generated: "생성일:",
    summary: "요약",
    evidence: "근거",
    humanSignal: "사람 반응",
    suggestedPatch: "제안된 패치",
    whyTarget: "이 대상을 선택한 이유",
    alternatives: "고려된 대안",
    actions: "실행 명령어",
    noCandidates: "승격 후보가 없습니다.",
  },
  ja: {
    title: "メモリ昇格ダイジェスト",
    generated: "生成日:",
    summary: "概要",
    evidence: "根拠",
    humanSignal: "ヒューマンシグナル",
    suggestedPatch: "提案パッチ",
    whyTarget: "このターゲットを選んだ理由",
    alternatives: "検討された代替案",
    actions: "アクション",
    noCandidates: "昇格候補はありません。",
  },
};

export function renderDigest(
  candidates: PromotionCandidate[],
  stats: AnalysisStats,
  repo: string,
  language = "en",
): string {
  const date = new Date().toISOString().split("T")[0];
  const lines: string[] = [];
  const t = TRANSLATIONS[language] ?? TRANSLATIONS.en;

  lines.push(`# ${t.title} — ${repo}`);
  lines.push(`> ${t.generated} ${date}`);
  lines.push("");

  // Stats
  lines.push(`## ${t.summary}`);
  lines.push("");
  lines.push(`- Scanned: **${stats.totalComments}** review comments across **${stats.prCount}** PRs`);
  lines.push(`- AI reviewer comments: **${stats.aiComments}**`);
  lines.push(`- Clusters found: **${stats.clustersFound}**`);
  lines.push(`- Repeated clusters: **${stats.repeatedClusters}**`);
  lines.push(`- Promotion candidates: **${candidates.length}**`);
  lines.push(`- Estimated cost: $${stats.estimatedCostUSD}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  if (candidates.length === 0) {
    lines.push(t.noCandidates);
    return lines.join("\n");
  }

  // Candidates
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    lines.push(`## ${i + 1}. ${c.summary}`);
    lines.push("");
    lines.push(`- **ID**: \`${c.id}\``);
    lines.push(`- **Target**: \`${c.target}\` → \`${c.suggestedFile ?? "(auto)"}\``);
    lines.push(`- **Confidence**: ${c.confidence}`);
    lines.push(`- **Occurrences**: ${c.occurrences.length} comments`);
    if (c.pathScope) {
      lines.push(`- **Path scope**: \`${c.pathScope}\``);
    }
    lines.push("");

    // Evidence
    lines.push(`### ${t.evidence}`);
    lines.push("");
    for (const occ of c.occurrences.slice(0, 5)) {
      const pathInfo = occ.path ? ` \`${occ.path}\`` : "";
      lines.push(`- PR #${occ.prNumber}${pathInfo} — "${occ.excerpt.slice(0, 80)}..." [link](${occ.url})`);
    }
    if (c.occurrences.length > 5) {
      lines.push(`- ... and ${c.occurrences.length - 5} more`);
    }
    lines.push("");

    // Human signal
    if (c.humanSignal) {
      const s = c.humanSignal;
      const hasSignal = s.agreementCount + s.rejectionCount + s.plusOneCount + s.minusOneCount > 0;
      if (hasSignal) {
        lines.push(`### ${t.humanSignal}`);
        lines.push("");
        if (s.agreementCount > 0) lines.push(`- Agreed: **${s.agreementCount}** reviewer(s)`);
        if (s.rejectionCount > 0) lines.push(`- Dismissed: **${s.rejectionCount}** reviewer(s) (e.g. "by design", "special case")`);
        if (s.plusOneCount > 0) lines.push(`- 👍 ${s.plusOneCount}`);
        if (s.minusOneCount > 0) lines.push(`- 👎 ${s.minusOneCount}`);
        if (s.firstRejectExcerpt) lines.push(`- Dismissal context: *"${s.firstRejectExcerpt}"*`);
        lines.push("");
      }
    }

    // Draft
    lines.push(`### ${t.suggestedPatch}`);
    lines.push("");
    lines.push("```markdown");
    lines.push(c.draft.content);
    lines.push("```");
    lines.push("");

    // Reasoning
    lines.push(`### ${t.whyTarget}`);
    lines.push("");
    lines.push(c.reasoning);
    lines.push("");

    // Alternatives
    if (c.alternatives.length > 0) {
      lines.push(`### ${t.alternatives}`);
      lines.push("");
      for (const alt of c.alternatives) {
        lines.push(`- \`${alt.target}\`: ${alt.reason}`);
      }
      lines.push("");
    }

    // Actions
    lines.push(`### ${t.actions}`);
    lines.push("");
    lines.push("```bash");
    lines.push(`promote ${c.id} --target ${c.target}`);
    lines.push(`promote ignore ${c.id} --reason "..."`);
    lines.push(`promote snooze ${c.id} --days 30`);
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
