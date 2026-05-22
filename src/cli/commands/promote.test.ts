import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTargetFile } from "./promote.js";
import type { PromoteConfig } from "../../core/types.js";

// Build a minimal PromoteConfig with the fields resolveTargetFile actually reads.
// The type has many other fields but they're irrelevant here; cast keeps the test
// readable without recreating every default.
function makeConfig(overrides: {
  agents?: string[];
  pathScopedDir?: string;
  adrDir?: string;
} = {}): PromoteConfig {
  return {
    memoryTargets: {
      agents: { preferredFiles: overrides.agents ?? ["CLAUDE.md"] },
      pathScoped: { preferredDir: overrides.pathScopedDir ?? ".claude/rules" },
      adr: { dir: overrides.adrDir ?? "docs/adr", filenameFormat: "{number}-{slug}.md" },
    },
  } as PromoteConfig;
}

describe("resolveTargetFile — `agents`", () => {
  it("uses config.preferredFiles[0] when no suggestion", () => {
    const out = resolveTargetFile("agents", { summary: "x" }, makeConfig({ agents: ["CLAUDE.md"] }));
    expect(out).toBe("CLAUDE.md");
  });

  it("accepts a known agent file as suggestion", () => {
    const out = resolveTargetFile(
      "agents",
      { suggestedFile: "AGENTS.md", summary: "x" },
      makeConfig({ agents: ["CLAUDE.md"] }),
    );
    expect(out).toBe("AGENTS.md");
  });

  it("rejects a foreign-path suggestion and falls back to config", () => {
    // This is the cross-repo / hallucination case: LLM picked a source-tree
    // path from the scanned repo. Must not land in the PR target repo.
    const out = resolveTargetFile(
      "agents",
      { suggestedFile: "packages/server/src/foo.ts", summary: "x" },
      makeConfig({ agents: ["CLAUDE.md"] }),
    );
    expect(out).toBe("CLAUDE.md");
  });

  it("rejects suggestions containing glob characters", () => {
    const out = resolveTargetFile(
      "agents",
      { suggestedFile: "packages/**/AGENTS.md", summary: "x" },
      makeConfig({ agents: ["CLAUDE.md"] }),
    );
    expect(out).toBe("CLAUDE.md");
  });
});

describe("resolveTargetFile — `path_scoped_rule`", () => {
  it("uses {preferredDir}/{summary-slug}.instructions.md when no suggestion", () => {
    const out = resolveTargetFile(
      "path_scoped_rule",
      { summary: "Payment money rules", pathScope: "payment/**" },
      makeConfig({ pathScopedDir: ".claude/rules" }),
    );
    expect(out).toBe(".claude/rules/payment-money-rules.instructions.md");
  });

  it("accepts a suggestion under preferredDir", () => {
    const out = resolveTargetFile(
      "path_scoped_rule",
      { suggestedFile: ".claude/rules/payment.instructions.md", summary: "x" },
      makeConfig({ pathScopedDir: ".claude/rules" }),
    );
    expect(out).toBe(".claude/rules/payment.instructions.md");
  });

  it("rejects a suggestion outside preferredDir", () => {
    // Foreign-path: LLM picked a source path from the scanned repo. Must
    // fall back to the configured directory.
    const out = resolveTargetFile(
      "path_scoped_rule",
      {
        suggestedFile: "packages/openapi/test/README.md",
        summary: "openapi serializer rule",
        pathScope: "packages/openapi/**",
      },
      makeConfig({ pathScopedDir: ".claude/rules" }),
    );
    expect(out).toBe(".claude/rules/openapi-serializer-rule.instructions.md");
  });

  it("rejects glob characters in the suggested path", () => {
    const out = resolveTargetFile(
      "path_scoped_rule",
      {
        suggestedFile: ".claude/rules/**/foo.instructions.md",
        summary: "Foo rule",
      },
      makeConfig({ pathScopedDir: ".claude/rules" }),
    );
    expect(out).toBe(".claude/rules/foo-rule.instructions.md");
  });

  it("falls back to a pathScope slug when summary is empty", () => {
    const out = resolveTargetFile(
      "path_scoped_rule",
      { summary: "", pathScope: "payment/**" },
      makeConfig({ pathScopedDir: ".claude/rules" }),
    );
    expect(out).toBe(".claude/rules/payment.instructions.md");
  });
});

describe("resolveTargetFile — `adr`", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "promote-adr-test-"));
    process.chdir(tmp);
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("uses config.adr.dir + NNN-slug.md regardless of suggestion", () => {
    const out = resolveTargetFile(
      "adr",
      { suggestedFile: "should-be-ignored.md", summary: "Use URL state for filters" },
      makeConfig({ adrDir: "docs/adr" }),
    );
    expect(out).toMatch(/^docs\/adr\/\d{3}-use-url-state-for-filters\.md$/);
  });
});

describe("resolveTargetFile — `test`", () => {
  it("always uses docs/test-stubs/{slug}.md", () => {
    const out = resolveTargetFile(
      "test",
      { suggestedFile: "ignored.md", summary: "Admin button hidden for members" },
      makeConfig(),
    );
    expect(out).toBe("docs/test-stubs/admin-button-hidden-for-members.md");
  });
});

describe("resolveTargetFile — path traversal / absolute paths", () => {
  it("rejects ../ in suggestion", () => {
    const out = resolveTargetFile(
      "agents",
      { suggestedFile: "../../../etc/passwd", summary: "x" },
      makeConfig({ agents: ["CLAUDE.md"] }),
    );
    expect(out).toBe("CLAUDE.md");
  });

  it("rejects absolute paths", () => {
    const out = resolveTargetFile(
      "agents",
      { suggestedFile: "/etc/passwd", summary: "x" },
      makeConfig({ agents: ["CLAUDE.md"] }),
    );
    expect(out).toBe("CLAUDE.md");
  });
});
