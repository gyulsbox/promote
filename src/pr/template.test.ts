import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findPullRequestTemplate,
  buildBundledPrBody,
  buildSinglePrBody,
  buildBundledPrTitle,
  buildSinglePrTitle,
} from "./template.js";
import type { PromotionCandidate } from "../core/types.js";

const baseCandidate = (overrides: Partial<PromotionCandidate> = {}): PromotionCandidate & { targetFile: string } => ({
  id: "candidate_001",
  repo: "owner/repo",
  clusterId: "cluster_x",
  summary: "Use shared API client instead of direct fetch",
  target: "agents",
  confidence: 0.91,
  reasoning: "Cross-feature convention — feature code repeatedly bypassed the shared client.",
  alternatives: [{ target: "path_scoped_rule", reason: "examples across multiple features" }],
  occurrences: [
    { prNumber: 347, path: "src/features/quest/api.ts", url: "https://github.com/owner/repo/pull/347", excerpt: "", authorLogin: "coderabbit[bot]", createdAt: "2026-05-01" },
    { prNumber: 352, path: "src/features/gacha/api.ts", url: "https://github.com/owner/repo/pull/352", excerpt: "", authorLogin: "coderabbit[bot]", createdAt: "2026-05-02" },
  ],
  draft: { targetFile: "AGENTS.md", content: "## API access\n- Use shared client.\n", insertionHint: "" },
  status: "candidate",
  ...overrides,
  targetFile: "AGENTS.md",
});

describe("findPullRequestTemplate", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "promote-pr-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when no template exists", () => {
    expect(findPullRequestTemplate(tmp)).toBeNull();
  });

  it("finds .github/PULL_REQUEST_TEMPLATE.md", () => {
    mkdirSync(join(tmp, ".github"), { recursive: true });
    writeFileSync(join(tmp, ".github/PULL_REQUEST_TEMPLATE.md"), "## Checklist\n- [ ] tests", "utf-8");
    const found = findPullRequestTemplate(tmp);
    expect(found?.path).toBe(".github/PULL_REQUEST_TEMPLATE.md");
    expect(found?.body).toContain("Checklist");
  });

  it("finds lowercase variant", () => {
    mkdirSync(join(tmp, ".github"), { recursive: true });
    writeFileSync(join(tmp, ".github/pull_request_template.md"), "lower", "utf-8");
    const found = findPullRequestTemplate(tmp);
    expect([
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/pull_request_template.md",
    ]).toContain(found?.path);
    expect(found?.body).toBe("lower");
  });

  it("prefers .github/PULL_REQUEST_TEMPLATE.md over docs/ variant", () => {
    mkdirSync(join(tmp, ".github"), { recursive: true });
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, ".github/PULL_REQUEST_TEMPLATE.md"), "github-one", "utf-8");
    writeFileSync(join(tmp, "docs/PULL_REQUEST_TEMPLATE.md"), "docs-one", "utf-8");
    const found = findPullRequestTemplate(tmp);
    expect(found?.body).toBe("github-one");
  });
});

describe("buildBundledPrBody — without prefilled header", () => {
  const date = new Date("2026-05-23T09:00:00Z");

  it("emits standalone headings and the appendix", () => {
    const body = buildBundledPrBody({
      candidates: [baseCandidate()],
      stats: { prCount: 5 },
      sinceDays: 60,
      date,
    });
    expect(body).toContain("## Summary");
    expect(body).toContain("## Why");
    expect(body).toContain("## Changes");
    expect(body).toContain("## Testing");
    expect(body).toContain("## Memory promotion details");
    expect(body).toContain("Use shared API client");
    expect(body).toContain("File: `AGENTS.md`");
    expect(body).toContain("#347");
  });

  it("references digest path in safety appendix", () => {
    const body = buildBundledPrBody({
      candidates: [baseCandidate()],
      sinceDays: 60,
      date,
      digestPath: "docs/promote/digests/2026-05-23.md",
    });
    expect(body).toContain("docs/promote/digests/2026-05-23.md");
    expect(body).toContain("committed");
  });

  it("caps evidence at 5 with overflow note", () => {
    const many = baseCandidate({
      occurrences: Array.from({ length: 8 }, (_, i) => ({
        prNumber: i + 1,
        url: `https://github.com/owner/repo/pull/${i + 1}`,
        excerpt: "",
        authorLogin: "bot",
        createdAt: "2026-05-01",
      })),
    });
    const body = buildBundledPrBody({
      candidates: [many],
      sinceDays: 60,
      date,
    });
    expect(body).toContain("…and 3 more");
  });
});

describe("buildBundledPrBody — with prefilled header (LLM output)", () => {
  const date = new Date("2026-05-23T09:00:00Z");

  it("uses the prefilled header as-is and still appends the detailed block", () => {
    const prefilled =
      "## Summary\n\nLLM-written summary that fills the team's template.\n\n## Checklist\n\n- [ ] reviewed manually\n- [ ] CODEOWNERS approved";
    const body = buildBundledPrBody({
      candidates: [baseCandidate()],
      sinceDays: 60,
      date,
      prefilledHeader: prefilled,
    });
    // Prefilled header is preserved verbatim
    expect(body).toContain("LLM-written summary that fills the team's template.");
    expect(body).toContain("- [ ] reviewed manually");
    // Appendix is still appended
    expect(body).toContain("## Memory promotion details");
    expect(body).toContain("### Bundled candidates");
    expect(body).toContain("#### 1. Use shared API client");
  });

  it("skips standalone Summary/Why/Changes/Testing when prefilled provided", () => {
    const body = buildBundledPrBody({
      candidates: [baseCandidate()],
      sinceDays: 60,
      date,
      prefilledHeader: "## Custom team section\n\nFilled by LLM.",
    });
    expect(body).toContain("## Custom team section");
    // The default standalone headings should NOT be present
    expect(body).not.toMatch(/##\s*Summary\s+`promote-cli` detected/);
    expect(body).not.toMatch(/##\s*Why\s+Repeated review comments/);
  });
});

describe("buildSinglePrBody", () => {
  it("renders standalone when no prefilled header", () => {
    const body = buildSinglePrBody({
      candidate: baseCandidate(),
      date: new Date("2026-05-23T09:00:00Z"),
    });
    expect(body).toContain("## Summary");
    expect(body).toContain("Use shared API client");
    expect(body).toContain("## Memory promotion details");
  });

  it("uses prefilled header when provided", () => {
    const body = buildSinglePrBody({
      candidate: baseCandidate(),
      date: new Date("2026-05-23T09:00:00Z"),
      prefilledHeader: "## Custom\n\nLLM-filled.",
    });
    expect(body).toContain("## Custom");
    expect(body).toContain("LLM-filled.");
    expect(body).toContain("## Memory promotion details");
  });
});

describe("title builders", () => {
  it("bundled title pluralizes", () => {
    const d = new Date("2026-05-23T09:00:00Z");
    expect(buildBundledPrTitle(d, 1)).toBe("promote: 1 memory update from 2026-05-23 scan");
    expect(buildBundledPrTitle(d, 3)).toBe("promote: 3 memory updates from 2026-05-23 scan");
  });

  it("single title truncates long summaries", () => {
    const long = "a".repeat(80);
    const title = buildSinglePrTitle({ summary: long });
    expect(title.length).toBeLessThanOrEqual("promote: ".length + 60);
    expect(title.endsWith("...")).toBe(true);
  });
});
