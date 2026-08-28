import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  detectEnvironment,
  detectProvider,
  detectMemoryFiles,
  detectLanguage,
  describeDetection,
} from "./detect.js";

describe("detectProvider", () => {
  it("finds nothing in an empty environment", () => {
    expect(detectProvider({})).toEqual({ provider: null, available: [] });
  });

  it("picks the provider whose key is set", () => {
    expect(detectProvider({ ANTHROPIC_API_KEY: "sk-x" }).provider).toBe("anthropic");
    expect(detectProvider({ GOOGLE_API_KEY: "x" }).provider).toBe("google");
  });

  it("prefers OpenAI when several keys are set, and reports the rest", () => {
    const result = detectProvider({ GOOGLE_API_KEY: "x", OPENAI_API_KEY: "y", ANTHROPIC_API_KEY: "z" });

    expect(result.provider).toBe("openai");
    expect(result.available).toEqual(["openai", "anthropic", "google"]);
  });

  it("ignores a key set to an empty string", () => {
    expect(detectProvider({ OPENAI_API_KEY: "" }).provider).toBeNull();
  });
});

describe("detectLanguage", () => {
  it("maps POSIX locales", () => {
    expect(detectLanguage({ LANG: "ko_KR.UTF-8" })).toBe("ko");
    expect(detectLanguage({ LANG: "ja_JP.UTF-8" })).toBe("ja");
    expect(detectLanguage({ LANG: "en_US.UTF-8" })).toBe("en");
  });

  it("maps BCP-47 tags", () => {
    expect(detectLanguage({ LC_ALL: "ko-KR" })).toBe("ko");
  });

  it("prefers LC_ALL over LANG", () => {
    expect(detectLanguage({ LC_ALL: "ja_JP.UTF-8", LANG: "ko_KR.UTF-8" })).toBe("ja");
  });

  it("falls back to English for unsupported or missing locales", () => {
    expect(detectLanguage({ LANG: "de_DE.UTF-8" })).toBe("en");
    expect(detectLanguage({ LANG: "C" })).toBe("en");
  });
});

describe("detectMemoryFiles / detectEnvironment", () => {
  let cwd: string;

  const touch = (rel: string) => {
    const full = join(cwd, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "");
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "promote-detect-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("keeps the static order when nothing exists", () => {
    const { ordered, existing } = detectMemoryFiles(cwd);

    expect(ordered).toEqual(["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"]);
    expect(existing).toEqual([]);
  });

  it("puts the file the repo actually has first", () => {
    // The regression this exists for: resolveTargetFile writes to
    // preferredFiles[0], so a Copilot-only repo used to get a new AGENTS.md
    // created next to the file the team actually reads.
    touch(".github/copilot-instructions.md");

    const { ordered, existing } = detectMemoryFiles(cwd);

    expect(ordered[0]).toBe(".github/copilot-instructions.md");
    expect(existing).toEqual([".github/copilot-instructions.md"]);
  });

  it("keeps canonical order among several existing files", () => {
    touch("CLAUDE.md");
    touch("AGENTS.md");

    expect(detectMemoryFiles(cwd).ordered).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      ".github/copilot-instructions.md",
    ]);
  });

  it("never drops a known file from the list", () => {
    touch("CLAUDE.md");

    const { ordered } = detectMemoryFiles(cwd);

    expect(ordered).toHaveLength(3);
    expect(new Set(ordered).size).toBe(3);
  });

  it("names the tools whose rule directories are present", () => {
    mkdirSync(join(cwd, ".cursor/rules"), { recursive: true });
    mkdirSync(join(cwd, ".windsurf/rules"), { recursive: true });

    const detection = detectEnvironment({ cwd, env: {}, repo: null });

    expect(detection.toolsDetected).toEqual(["Cursor", "Windsurf"]);
  });

  it("does not make a Cursor rules directory the path-scoped target", () => {
    // .cursor/rules holds .mdc files, not the .instructions.md convention
    // resolveTargetFile writes, so pointing path-scoped output at it would
    // produce files Cursor ignores.
    mkdirSync(join(cwd, ".cursor/rules"), { recursive: true });

    expect(detectEnvironment({ cwd, env: {}, repo: null }).pathScopedDir).toBeNull();
  });

  it("uses .github/instructions as the path-scoped target when present", () => {
    mkdirSync(join(cwd, ".github/instructions"), { recursive: true });

    const detection = detectEnvironment({ cwd, env: {}, repo: null });

    expect(detection.pathScopedDir).toBe(".github/instructions");
    expect(detection.toolsDetected).toContain("Copilot");
  });

  it("ignores a rule path that is a file rather than a directory", () => {
    touch(".cursor/rules");

    expect(detectEnvironment({ cwd, env: {}, repo: null }).toolsDetected).toEqual([]);
  });

  it("combines every signal into one detection", () => {
    touch("CLAUDE.md");
    mkdirSync(join(cwd, ".cursor/rules"), { recursive: true });

    const detection = detectEnvironment({
      cwd,
      env: { ANTHROPIC_API_KEY: "sk-x", LANG: "ko_KR.UTF-8" },
      repo: "acme/widgets",
    });

    expect(detection.provider).toBe("anthropic");
    expect(detection.memoryFiles[0]).toBe("CLAUDE.md");
    expect(detection.toolsDetected).toEqual(["Cursor"]);
    expect(detection.language).toBe("ko");
    expect(detection.repo).toBe("acme/widgets");
  });
});

describe("describeDetection", () => {
  const base = {
    provider: "openai" as const,
    providersAvailable: ["openai" as const],
    memoryFiles: ["AGENTS.md", "CLAUDE.md"],
    existingMemoryFiles: ["AGENTS.md"],
    toolsDetected: ["Cursor"],
    pathScopedDir: null,
    language: "en" as const,
    repo: "acme/widgets",
  };

  it("summarises what was found", () => {
    const line = describeDetection(base);

    expect(line).toContain("AGENTS.md");
    expect(line).toContain("Cursor");
    expect(line).toContain("openai");
    expect(line).toContain("en");
  });

  it("says a memory file would be created when none exists", () => {
    const line = describeDetection({ ...base, existingMemoryFiles: [] });

    expect(line).toContain("would be created");
  });

  it("says so when no provider key is present", () => {
    const line = describeDetection({ ...base, provider: null, providersAvailable: [] });

    expect(line).toContain("no provider key found");
  });

  it("never leaks a key value", () => {
    expect(describeDetection(base)).not.toContain("sk-");
  });
});
