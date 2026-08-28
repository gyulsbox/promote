import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { loadConfigWithDetection, applyDetection } from "./config.js";
import type { Detection } from "./detect.js";

const detection = (over: Partial<Detection> = {}): Detection => ({
  provider: "openai",
  providersAvailable: ["openai"],
  memoryFiles: ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"],
  existingMemoryFiles: [],
  toolsDetected: [],
  pathScopedDir: null,
  language: "en",
  repo: null,
  ...over,
});

describe("applyDetection", () => {
  it("carries the detected memory file order into preferredFiles", () => {
    const applied = applyDetection(
      detection({ memoryFiles: [".github/copilot-instructions.md", "AGENTS.md", "CLAUDE.md"] }),
    );

    expect(applied.memoryTargets).toEqual({
      agents: { preferredFiles: [".github/copilot-instructions.md", "AGENTS.md", "CLAUDE.md"] },
    });
  });

  it("sets the path-scoped dir only when one was detected", () => {
    expect(applyDetection(detection()).memoryTargets).not.toHaveProperty("pathScoped");
    expect(
      applyDetection(detection({ pathScopedDir: ".github/instructions" })).memoryTargets,
    ).toHaveProperty("pathScoped", { preferredDir: ".github/instructions" });
  });

  it("omits llm entirely when no provider key was found", () => {
    // The schema default then applies, so the existing "OPENAI_API_KEY is
    // required" error still tells the user what to do.
    expect(applyDetection(detection({ provider: null }))).not.toHaveProperty("llm");
  });

  it("sets the detected provider", () => {
    expect(applyDetection(detection({ provider: "anthropic" })).llm).toEqual({
      provider: "anthropic",
    });
  });
});

describe("loadConfigWithDetection", () => {
  let dir: string;
  let originalCwd: string;

  const write = (rel: string, content = "") => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "promote-config-"));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects settings when there is no .promote.yml", () => {
    write(".github/copilot-instructions.md");

    const { config, detection: d } = loadConfigWithDetection();

    expect(d).not.toBeNull();
    expect(config.memoryTargets.agents?.preferredFiles?.[0]).toBe(
      ".github/copilot-instructions.md",
    );
  });

  it("does not create a config file", () => {
    // Running with no .promote.yml is a supported steady state, not a setup
    // step that has not happened yet.
    loadConfigWithDetection();

    expect(existsSync(join(dir, ".promote.yml"))).toBe(false);
  });

  it("lets an existing .promote.yml win over detection", () => {
    // CLAUDE.md is on disk, but the config names a different file.
    write("CLAUDE.md");
    write(
      ".promote.yml",
      ["version: 2", "memoryTargets:", "  agents:", "    preferredFiles:", "      - docs/RULES.md"].join(
        "\n",
      ),
    );

    const { config, detection: d } = loadConfigWithDetection();

    expect(d).toBeNull();
    expect(config.memoryTargets.agents?.preferredFiles).toEqual(["docs/RULES.md"]);
  });

  it("reports no detection when an explicit config path is given", () => {
    write("custom.yml", "version: 2");

    expect(loadConfigWithDetection(join(dir, "custom.yml")).detection).toBeNull();
  });

  it("still returns a usable config in an empty directory", () => {
    const { config } = loadConfigWithDetection();

    expect(config.thresholds.minOccurrences).toBe(2);
    expect(config.memoryTargets.agents?.preferredFiles).toHaveLength(3);
    expect(config.aiReviewers.length).toBeGreaterThan(0);
  });
});
