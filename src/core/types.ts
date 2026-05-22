export type RepoRef = {
  owner: string;
  name: string;
  fullName: string; // "owner/repo"
};

export type HumanReactionSignal = {
  agreementCount: number;
  rejectionCount: number;
  plusOneCount: number;
  minusOneCount: number;
  topRejectExcerpt?: string;
};

export type RawReviewComment = {
  id: string;
  repo: string;
  prNumber: number;
  authorLogin: string;
  authorType: "Bot" | "User" | "Unknown";
  body: string;
  path?: string;
  line?: number;
  diffHunk?: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt?: string;
  inReplyToId?: string;
  reactions?: { plusOne: number; minusOne: number };
};

export type SeverityLevel = "blocker" | "important" | "suggestion" | "nit" | "unknown";

export type SeverityMarker = {
  raw: string | null;
  level: SeverityLevel;
};

export type NormalizedComment = {
  id: string;
  originalBody: string;
  normalizedBody: string;
  identifiers: string[];
  paths: string[];
  actionVerbs: string[];
  severityMarker: SeverityMarker;
  language: "en" | "ja" | "ko" | "mixed" | "unknown";
  prNumber: number;
  authorLogin: string;
  htmlUrl: string;
  createdAt: string;
  filePath?: string;
  diffHunk?: string;
  inReplyToId?: string;
  reactionCounts?: { plusOne: number; minusOne: number };
};

export type Cluster = {
  id: string;
  representative: NormalizedComment;
  representativeEmbedding: number[];
  members: NormalizedComment[];
  memberEmbeddings: number[][];
  fingerprint: string;
  humanSignal?: HumanReactionSignal;
};

export type RoutingTarget =
  | "none"
  | "pr_only"
  | "agents"
  | "path_scoped_rule"
  | "adr"
  | "test"
  | "lint_or_type"
  | "docs";

export type RoutingDecision = {
  clusterValid: boolean;
  target: RoutingTarget;
  confidence: number;
  summary: string;
  reason: string;
  suggestedFile?: string;
  pathScope?: string;
  alternatives: Array<{
    target: string;
    reason: string;
  }>;
  needsHumanDecision: boolean;
};

export type DraftPromotion = {
  targetFile: string;
  content: string;
  insertionHint: string;
  fullPatch?: string;
};

export type PromotionCandidate = {
  id: string;
  repo: string;
  clusterId: string;
  clusterFingerprint?: string;
  summary: string;
  target: RoutingTarget;
  confidence: number;
  suggestedFile?: string;
  pathScope?: string;
  draft: DraftPromotion;
  reasoning: string;
  alternatives: Array<{
    target: string;
    reason: string;
  }>;
  occurrences: Array<{
    prNumber: number;
    path?: string;
    url: string;
    excerpt: string;
    authorLogin: string;
    createdAt: string;
  }>;
  status: "candidate" | "promoted" | "ignored" | "snoozed" | "needs_human_decision";
  humanSignal?: HumanReactionSignal;
};

export type CandidateStatus = PromotionCandidate["status"];

export type AnalysisStats = {
  totalComments: number;
  aiComments: number;
  noisyComments: number;
  clustersFound: number;
  repeatedClusters: number;
  candidatesGenerated: number;
  failedClusters: number;
  prCount: number;
  embeddingTokens: number;
  classificationTokens: number;
  estimatedCostUSD: number;
};

export type AnalyzeReviewMemoryInput = {
  repo: RepoRef;
  sinceDays: number;
  config: PromoteConfig;
  mode: "dry-run" | "digest" | "pr";
};

export type AnalyzeReviewMemoryOutput = {
  candidates: PromotionCandidate[];
  stats: AnalysisStats;
};

export type AIReviewerConfig = {
  allowlist: string[];
};

export type ThresholdsConfig = {
  minOccurrences: number;
  windowDays: number;
  similarityThreshold: number;
  minConfidence: number;
};

export type MemoryTargetsConfig = {
  agents?: {
    preferredFiles: string[];
  };
  pathScoped?: {
    preferredDir: string;
  };
  adr?: {
    dir: string;
    filenameFormat: string;
  };
  tests?: {
    mode: "recommendation" | "stub";
  };
};

export type LLMConfig = {
  provider: "openai" | "anthropic" | "google";
  classificationModel: string;
  draftingModel: string;
  embeddingModel: string;
};

export type LanguageConfig = {
  preferredOutput: "en" | "ja" | "ko";
};

export type PrivacyConfig = {
  sendDiffHunksToLLM: boolean;
  redactSecrets: boolean;
};

export type PromoteConfig = {
  version: 1;
  language: LanguageConfig;
  aiReviewers: string[];
  memoryTargets: MemoryTargetsConfig;
  thresholds: ThresholdsConfig;
  llm: LLMConfig;
  privacy: PrivacyConfig;
};
