import type { PromotionCandidate, AnalysisStats, PromoteConfig, SkippedItem, SkipReason } from "../core/types.js";
import { NAME, VERSION } from "../version.js";

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = (s - m * 60).toFixed(0);
  return `${m}m ${rem}s`;
}

type Translation = {
  title: string;
  generated: string;
  summary: string;
  configuration: string;
  evidence: string;
  humanSignal: string;
  suggestedPatch: string;
  whyTarget: string;
  alternatives: string;
  actions: string;
  noCandidates: string;
  filteredOut: string;
  filteredOutIntro: string;
  reasonAlreadyPromoted: string;
  reasonAlreadyIgnored: string;
  reasonNotPromotable: string;
  reasonLowConfidence: string;
  reasonClassifyFailed: string;
  skippedDuringReview: string;
  skippedDuringReviewIntro: string;
};

const TRANSLATIONS: Record<string, Translation> = {
  en: {
    title: "Memory Promotion Digest",
    generated: "Generated on",
    summary: "Summary",
    configuration: "Configuration",
    evidence: "Evidence",
    humanSignal: "Human signal",
    suggestedPatch: "Suggested patch",
    whyTarget: "Why this target",
    alternatives: "Alternatives considered",
    actions: "Actions",
    noCandidates: "No promotion candidates found.",
    filteredOut: "Filtered out",
    filteredOutIntro: "Items that were excluded from promotion candidates. Useful for tuning thresholds or for team review of edge cases.",
    reasonAlreadyPromoted: "Already promoted",
    reasonAlreadyIgnored: "Already ignored",
    reasonNotPromotable: "Not promotable (target=none / invalid)",
    reasonLowConfidence: "Below confidence threshold",
    reasonClassifyFailed: "Failed during classify",
    skippedDuringReview: "Skipped during review",
    skippedDuringReviewIntro: "Candidates the reviewer chose to defer during interactive review. Not persisted in the database — these are session-only.",
  },
  ko: {
    title: "메모리 승격 다이제스트",
    generated: "생성일:",
    summary: "요약",
    configuration: "설정",
    evidence: "근거",
    humanSignal: "사람 반응",
    suggestedPatch: "제안된 패치",
    whyTarget: "이 대상을 선택한 이유",
    alternatives: "고려된 대안",
    actions: "실행 명령어",
    noCandidates: "승격 후보가 없습니다.",
    filteredOut: "필터링된 항목",
    filteredOutIntro: "승격 후보에서 제외된 항목들. 임계치 튜닝이나 팀 리뷰의 엣지 케이스 확인에 유용합니다.",
    reasonAlreadyPromoted: "이미 승격됨",
    reasonAlreadyIgnored: "이미 무시됨",
    reasonNotPromotable: "승격 불가 (target=none / invalid)",
    reasonLowConfidence: "신뢰도 임계치 미만",
    reasonClassifyFailed: "분류 단계에서 실패",
    skippedDuringReview: "리뷰 중 보류된 항목",
    skippedDuringReviewIntro: "인터랙티브 리뷰에서 검토자가 보류로 미룬 후보들. DB에 저장되지 않은 세션 한정 기록입니다.",
  },
  ja: {
    title: "メモリ昇格ダイジェスト",
    generated: "生成日:",
    summary: "概要",
    configuration: "設定",
    evidence: "根拠",
    humanSignal: "ヒューマンシグナル",
    suggestedPatch: "提案パッチ",
    whyTarget: "このターゲットを選んだ理由",
    alternatives: "検討された代替案",
    actions: "アクション",
    noCandidates: "昇格候補はありません。",
    filteredOut: "除外された項目",
    filteredOutIntro: "昇格候補から除外された項目。閾値調整やチームレビューのエッジケース確認に有用です。",
    reasonAlreadyPromoted: "既に昇格済み",
    reasonAlreadyIgnored: "既に無視済み",
    reasonNotPromotable: "昇格不可 (target=none / invalid)",
    reasonLowConfidence: "信頼度閾値未満",
    reasonClassifyFailed: "分類で失敗",
    skippedDuringReview: "レビュー中に保留された項目",
    skippedDuringReviewIntro: "インタラクティブレビューでレビュー者が保留にした候補。DBに保存されないセッション限定の記録です。",
  },
};

const REASON_TRANSLATION_KEYS: Record<SkipReason, keyof Translation> = {
  "already-promoted": "reasonAlreadyPromoted",
  "already-ignored": "reasonAlreadyIgnored",
  "not-promotable": "reasonNotPromotable",
  "low-confidence": "reasonLowConfidence",
  "classify-failed": "reasonClassifyFailed",
};

export function renderDigest(
  candidates: PromotionCandidate[],
  stats: AnalysisStats,
  repo: string,
  language = "en",
  config?: PromoteConfig,
  embeddingMode?: boolean,
  sinceDays?: number,
  options?: {
    filterSkipped?: SkippedItem[];
    userSkippedCandidates?: PromotionCandidate[];
  },
): string {
  const date = new Date().toISOString().split("T")[0];
  const lines: string[] = [];
  const t = TRANSLATIONS[language] ?? TRANSLATIONS.en;

  lines.push(`# ${t.title} — ${repo}`);
  lines.push(`> ${t.generated} ${date} · ${NAME} v${VERSION}`);
  lines.push("");

  // Configuration (so the digest is self-describing for later review)
  if (config) {
    lines.push(`## ${t.configuration}`);
    lines.push("");
    const llm = config.llm;
    const clusteringMode = embeddingMode === false
      ? "LLM-direct (no embedding API, llmRefine inactive)"
      : "embeddings + HAC + llmRefine";
    const effectiveCluster = llm.clusteringModel ?? llm.classificationModel;
    const clusterShown = effectiveCluster !== llm.classificationModel
      ? `, \`${effectiveCluster}\` (cluster)`
      : "";
    lines.push(`- Provider: \`${llm.provider}\` (${clusteringMode})`);
    lines.push(`- Models: \`${llm.classificationModel}\` (classify)${clusterShown}, \`${llm.draftingModel}\` (draft)${embeddingMode !== false ? `, \`${llm.embeddingModel}\` (embed)` : ""}`);
    lines.push(`- Output language: \`${config.language.preferredOutput}\``);
    lines.push(`- Thresholds: similarity \`${config.thresholds.similarityThreshold}\`, min confidence \`${config.thresholds.minConfidence}\`, min occurrences \`${config.thresholds.minOccurrences}\``);
    const effectiveWindow = sinceDays ?? config.thresholds.windowDays;
    const windowSuffix = sinceDays !== undefined && sinceDays !== config.thresholds.windowDays
      ? ` (overridden via --since; config default is ${config.thresholds.windowDays})`
      : "";
    lines.push(`- Window: \`${effectiveWindow}\` days${windowSuffix}`);
    lines.push(`- Privacy: redactSecrets=\`${config.privacy.redactSecrets}\`, sendDiffHunksToLLM=\`${config.privacy.sendDiffHunksToLLM}\``);
    lines.push("");
  }

  // Stats
  lines.push(`## ${t.summary}`);
  lines.push("");
  lines.push(`- Scanned: **${stats.totalComments}** review comments across **${stats.prCount}** PRs`);
  lines.push(`- AI reviewer comments: **${stats.aiComments}**`);
  lines.push(`- Clusters found: **${stats.clustersFound}**`);
  lines.push(`- Repeated clusters: **${stats.repeatedClusters}**`);
  lines.push(`- Promotion candidates: **${candidates.length}**`);
  lines.push(`- Estimated cost: $${stats.estimatedCostUSD}`);
  if (stats.timings) {
    const t2 = stats.timings;
    lines.push(
      `- Timings: fetch ${fmtMs(t2.fetchMs)} · normalize ${fmtMs(t2.normalizeMs)} · cluster ${fmtMs(t2.clusterMs)} · conv-fetch ${fmtMs(t2.conversationFetchMs)} · reply-ctx ${fmtMs(t2.replyContextMs)} · memory ${fmtMs(t2.memoryScanMs)} · classify+draft ${fmtMs(t2.classifyDraftMs)} · **total ${fmtMs(t2.totalMs)}**`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  const filterSkipped = options?.filterSkipped ?? [];
  const userSkipped = options?.userSkippedCandidates ?? [];
  const hasAppendix = filterSkipped.length > 0 || userSkipped.length > 0;

  if (candidates.length === 0 && !hasAppendix) {
    lines.push(t.noCandidates);
    return lines.join("\n");
  }

  if (candidates.length === 0) {
    lines.push(`*${t.noCandidates}*`);
    lines.push("");
  }

  // Candidates
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    lines.push(`## ${i + 1}. ${c.summary}`);
    lines.push("");
    const uniquePrs = new Set(c.occurrences.map((o) => o.prNumber)).size;
    const scope = uniquePrs >= 2 ? `🌐 cross-PR (${uniquePrs} PRs)` : `📍 within-PR (1 PR)`;
    lines.push(`- **ID**: \`${c.id}\``);
    lines.push(`- **Target**: \`${c.target}\` → \`${c.suggestedFile ?? "(auto)"}\``);
    lines.push(`- **Confidence**: ${c.confidence}`);
    lines.push(`- **Scope**: ${scope}`);
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
        if (s.agreementCount > 0) {
          const who = s.agreementAuthors?.length ? ` (${s.agreementAuthors.map((a) => `@${a}`).join(", ")})` : "";
          lines.push(`- Agreed: **${s.agreementCount}** reviewer(s)${who}`);
          if (s.firstAgreementExcerpt) lines.push(`  - First agreement: *"${s.firstAgreementExcerpt}"*`);
        }
        if (s.rejectionCount > 0) {
          const who = s.rejectionAuthors?.length ? ` (${s.rejectionAuthors.map((a) => `@${a}`).join(", ")})` : "";
          lines.push(`- Dismissed: **${s.rejectionCount}** reviewer(s)${who}`);
          if (s.firstRejectExcerpt) lines.push(`  - First dismissal: *"${s.firstRejectExcerpt}"*`);
        }
        if (s.plusOneCount > 0) lines.push(`- 👍 ${s.plusOneCount}`);
        if (s.minusOneCount > 0) lines.push(`- 👎 ${s.minusOneCount}`);
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

  if (filterSkipped.length > 0) {
    lines.push(`## ${t.filteredOut}`);
    lines.push("");
    lines.push(t.filteredOutIntro);
    lines.push("");

    const reasonOrder: SkipReason[] = [
      "already-promoted",
      "already-ignored",
      "not-promotable",
      "low-confidence",
      "classify-failed",
    ];
    const grouped: Record<SkipReason, SkippedItem[]> = {
      "already-promoted": [],
      "already-ignored": [],
      "not-promotable": [],
      "low-confidence": [],
      "classify-failed": [],
    };
    for (const item of filterSkipped) {
      grouped[item.reason].push(item);
    }

    for (const reason of reasonOrder) {
      const group = grouped[reason];
      if (group.length === 0) continue;
      lines.push(`### ${t[REASON_TRANSLATION_KEYS[reason]]} (${group.length})`);
      lines.push("");
      for (const item of group) {
        const meta: string[] = [];
        if (item.target) meta.push(`target=\`${item.target}\``);
        if (item.confidence !== undefined) meta.push(`confidence=${item.confidence.toFixed(2)}`);
        const metaSuffix = meta.length > 0 ? ` — ${meta.join(", ")}` : "";
        lines.push(`- ${item.summary || "(no summary)"}${metaSuffix}`);
        if (item.detail) {
          lines.push(`  - ${item.detail}`);
        }
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  if (userSkipped.length > 0) {
    lines.push(`## ${t.skippedDuringReview}`);
    lines.push("");
    lines.push(t.skippedDuringReviewIntro);
    lines.push("");
    for (const c of userSkipped) {
      lines.push(`### \`${c.id}\` — ${c.summary}`);
      lines.push("");
      lines.push(`- **Target**: \`${c.target}\`${c.suggestedFile ? ` → \`${c.suggestedFile}\`` : ""}`);
      lines.push(`- **Confidence**: ${c.confidence}`);
      if (c.pathScope) {
        lines.push(`- **Path scope**: \`${c.pathScope}\``);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
