type UsageEntry = {
  step: string;
  promptTokens: number;
  completionTokens: number;
};

// Approximate costs per 1M tokens (USD)
const COST_TABLE: Record<string, { input: number; output: number }> = {
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
};

export class CostTracker {
  private entries: UsageEntry[] = [];
  private model: string;

  constructor(model = "gpt-4.1-mini") {
    this.model = model;
  }

  record(step: string, usage: { promptTokens?: number; completionTokens?: number }) {
    this.entries.push({
      step,
      promptTokens: usage.promptTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
    });
  }

  getSummary() {
    const totalPromptTokens = this.entries.reduce((sum, e) => sum + e.promptTokens, 0);
    const totalCompletionTokens = this.entries.reduce((sum, e) => sum + e.completionTokens, 0);

    const costs = COST_TABLE[this.model] ?? { input: 1.0, output: 3.0 };
    const estimatedCostUSD =
      (totalPromptTokens / 1_000_000) * costs.input +
      (totalCompletionTokens / 1_000_000) * costs.output;

    return {
      totalPromptTokens,
      totalCompletionTokens,
      estimatedCostUSD: Math.round(estimatedCostUSD * 10000) / 10000,
      entries: this.entries,
    };
  }
}
