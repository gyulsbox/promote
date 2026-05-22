import * as p from "@clack/prompts";
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import chalk from "chalk";
import { printWelcome, mascotSays } from "../mascot.js";
import * as out from "../output.js";
import { notifyIfOutdated } from "../update-check.js";

type DetectedKey = {
  provider: string;
  envVar: string;
  display: string;
};

const KEY_CHECKS: Array<{ provider: string; envVars: string[]; label: string }> = [
  {
    provider: "openai",
    envVars: ["OPENAI_API_KEY", "OPENAI_KEY"],
    label: "OpenAI",
  },
  {
    provider: "anthropic",
    envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_KEY", "CLAUDE_API_KEY"],
    label: "Anthropic (Claude)",
  },
  {
    provider: "google",
    envVars: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    label: "Google (Gemini)",
  },
];

export async function runInit() {
  await notifyIfOutdated();
  printWelcome();

  p.intro(chalk.bgCyan(chalk.black(" promote init ")));

  // 0. Check GitHub access
  const ghStatus = detectGitHub();

  if (ghStatus.ok) {
    mascotSays(`GitHub: ${chalk.green("connected")} as ${chalk.bold(ghStatus.user!)}`);
  } else {
    mascotSays(`GitHub: ${chalk.yellow("not connected")}`);
    console.log();
    p.note(
      `promote needs GitHub access to read PR review comments.\n\n` +
      `Option 1: Install GitHub CLI and login\n` +
      `  brew install gh && gh auth login\n\n` +
      `Option 2: Set a personal access token\n` +
      `  export GITHUB_TOKEN=ghp_xxxxx\n` +
      `  (needs "repo" scope for private repos, or just public access)`,
      "GitHub token required",
    );
  }
  console.log();

  // 1. Detect available API keys
  const detected = detectAPIKeys();

  if (detected.length > 0) {
    mascotSays(`Found ${detected.length} API key(s) in your environment.`);
    console.log();
    for (const key of detected) {
      console.log(chalk.green("  ✓"), `${key.display} (${chalk.dim(key.envVar)})`);
    }
    console.log();
  } else {
    mascotSays("No API keys detected in your environment.");
    console.log();
    console.log(chalk.dim("  Env vars: OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY"));
    console.log(chalk.dim("  Free keys: https://aistudio.google.com/apikey"));
    console.log();
  }

  // 2. Choose provider
  const providerOptions = buildProviderOptions(detected);

  const provider = await p.select({
    message: "Which LLM provider do you want to use?",
    options: providerOptions,
  });

  if (p.isCancel(provider)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // 3. If chosen provider has no key detected, ask for guidance
  const providerKey = detected.find((d) => d.provider === provider);
  if (!providerKey) {
    const helpUrl = getProviderHelpUrl(provider as string);
    p.note(
      `Set ${getProviderEnvVar(provider as string)} in your environment.\n` +
      `Get a key: ${helpUrl}`,
      "API key needed",
    );
  }

  // 4. Choose language
  const language = await p.select({
    message: "Preferred output language?",
    options: [
      { value: "en", label: "English" },
      { value: "ja", label: "日本語" },
      { value: "ko", label: "한국어" },
    ],
  });

  if (p.isCancel(language)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // 5. Default similarity threshold
  const threshold = await p.select({
    message: "How strict should pattern matching be?",
    options: [
      { value: "0.85", label: "Strict", hint: "fewer but higher confidence matches" },
      { value: "0.80", label: "Balanced (recommended)", hint: "default — catches most repeated patterns with llmRefine safety net" },
      { value: "0.72", label: "Relaxed", hint: "more matches, more LLM refine calls" },
    ],
  });

  if (p.isCancel(threshold)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // 5b. Clustering mode — affects what KIND of patterns surface.
  // Anthropic has no embedding API, so 'quick' isn't an option there; the
  // provider is forced into llm-direct mode regardless of this choice.
  // Skip the prompt to avoid a misleading question.
  let clusteringStrategy: string;
  if (provider === "anthropic") {
    clusteringStrategy = "llm-direct";
    p.note(
      "Anthropic has no embedding API — clustering will use LLM-direct (broader/principle-level patterns) automatically.",
      "Clustering mode",
    );
  } else {
    const choice = await p.select({
      message: "What kind of patterns do you want surfaced?",
      options: [
        {
          value: "embedding",
          label: "Quick — code-level patterns (recommended for this provider)",
          hint: "embedding + HAC, narrow patterns tied to specific files/lines, cheapest",
        },
        {
          value: "llm-direct",
          label: "Broad — convention / principle patterns",
          hint:
            provider === "openai"
              ? "LLM-direct, deeper rules — but Anthropic Claude is better at this; OpenAI broad on tier-1 produces fewer candidates and tier-1 limits cap full-tier models"
              : "LLM-direct semantic clustering, repo-wide rules, ~3x cost",
        },
      ],
    });
    if (p.isCancel(choice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    clusteringStrategy = choice as string;
  }

  // 6. Memory target — which AI tool's instruction format
  const memoryTarget = await p.select({
    message: "Which AI coding tool do you primarily use?",
    options: [
      { value: "claude", label: "Claude Code", hint: "CLAUDE.md + .claude/rules/" },
      { value: "codex", label: "OpenAI Codex", hint: "AGENTS.md + nested AGENTS.md" },
      { value: "copilot", label: "GitHub Copilot", hint: ".github/copilot-instructions.md + .github/instructions/" },
      { value: "cursor", label: "Cursor", hint: ".cursorrules + .cursor/rules/*.mdc" },
      { value: "windsurf", label: "Windsurf", hint: ".windsurfrules + .windsurf/rules/" },
      { value: "gemini", label: "Gemini CLI", hint: "GEMINI.md + nested GEMINI.md" },
      { value: "custom", label: "Custom", hint: "specify your own file" },
    ],
  });

  if (p.isCancel(memoryTarget)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const toolConfig = TOOL_CONFIGS[memoryTarget as string];
  let memoryFile: string;

  if (!toolConfig) {
    const customPath = await p.text({
      message: "Custom root instruction file path:",
      placeholder: "docs/rules.md",
    });
    if (p.isCancel(customPath) || !customPath) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    memoryFile = customPath;
  } else {
    memoryFile = toolConfig.rootFile;
  }

  // 6b. Path-scoped rules directory
  const defaultPathScoped = toolConfig?.pathScopedDir ?? ".github/instructions";
  const pathScopedDir = await p.text({
    message: "Path-scoped rules directory:",
    placeholder: defaultPathScoped,
    defaultValue: defaultPathScoped,
  });

  if (p.isCancel(pathScopedDir)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // 6c. ADR directory
  const adrDir = await p.text({
    message: "ADR (Architecture Decision Records) directory:",
    placeholder: "docs/adr",
    defaultValue: "docs/adr",
  });

  if (p.isCancel(adrDir)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // 7. Write config
  const cwd = process.cwd();
  const configPath = resolve(cwd, ".promote.yml");
  const storageDir = resolve(cwd, ".promote");

  const s = p.spinner();

  s.start("Writing config...");

  const configContent = generateConfig({
    provider: provider as string,
    language: language as string,
    threshold: threshold as string,
    clusteringStrategy: clusteringStrategy as string,
    memoryFile,
    pathScopedDir: pathScopedDir as string,
    adrDir: adrDir as string,
  });

  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }

  writeFileSync(configPath, configContent, "utf-8");

  // Add .promote/ to .gitignore
  const gitignorePath = resolve(cwd, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".promote/")) {
      appendFileSync(gitignorePath, "\n.promote/\n");
    }
  }

  s.stop("Config written to .promote.yml");

  // 7b. Create/update main memory file with reference instructions
  const memoryFilePath = resolve(cwd, memoryFile);

  if (!existsSync(memoryFilePath)) {
    const createIt = await p.confirm({
      message: `${memoryFile} doesn't exist. Create it with knowledge reference instructions?`,
    });

    if (!p.isCancel(createIt) && createIt) {
      const memDir = dirname(memoryFilePath);
      if (!existsSync(memDir)) {
        mkdirSync(memDir, { recursive: true });
      }
      writeFileSync(
        memoryFilePath,
        generateMemoryFileContent({
          memoryFile,
          pathScopedDir: pathScopedDir as string,
          pathScopedExt: toolConfig?.pathScopedExt ?? "*.md",
          pathScopedFormat: toolConfig?.pathScopedFormat ?? "Markdown files",
          adrDir: adrDir as string,
        }),
        "utf-8",
      );
      out.success(`Created ${memoryFile}`);
    }
  } else {
    const existing = readFileSync(memoryFilePath, "utf-8");
    const hasRefs = existing.includes("<!-- managed by promote");

    if (!hasRefs) {
      const appendRefs = await p.confirm({
        message: `${memoryFile} already exists. Append knowledge reference instructions to it?`,
      });

      if (!p.isCancel(appendRefs) && appendRefs) {
        const refSection = generateReferenceSection({
          pathScopedDir: pathScopedDir as string,
          pathScopedFormat: toolConfig?.pathScopedFormat ?? "Markdown files",
          adrDir: adrDir as string,
        });
        appendFileSync(memoryFilePath, "\n" + refSection);
        out.success(`Updated ${memoryFile} with reference instructions`);
      } else {
        out.info(`${memoryFile} left unchanged.`);
      }
    } else {
      out.info(`${memoryFile} already has reference instructions.`);
    }
  }

  // 8. Done
  console.log();
  mascotSays("You're all set!");
  console.log();

  p.note(
    [
      `${chalk.bold("Scan this repo:")}`,
      `  promote scan                                            # uses git remote + default 60d`,
      ``,
      `${chalk.bold("Scan another repo:")}`,
      `  promote scan --repo owner/repo --since 90d`,
      ``,
      `${chalk.bold("After scan:")}`,
      `  promote candidate_001                                   # apply with confirm prompt`,
      `  promote candidate_001 --create-pr                       # apply + open a PR for it`,
      `  promote review                                          # interactively pick from pending candidates`,
      ``,
      `${chalk.bold("CI / GitHub Actions (headless):")}`,
      `  promote scan --no-interactive --min-confidence 0.85 --create-pr`,
      `                                                          # auto-apply ≥0.85 + open one bundled PR`,
      `  # workflow template: examples/github-actions/weekly-digest.yml`,
      ``,
      `  promote --help                                          # all commands`,
    ].join("\n"),
    "Next steps",
  );

  p.outro(chalk.dim("Happy promoting!"));
}

function detectGitHub(): { ok: boolean; user?: string; method?: string } {
  // 1. GITHUB_TOKEN env
  if (process.env.GITHUB_TOKEN) {
    return { ok: true, user: "(token)", method: "GITHUB_TOKEN" };
  }

  // 2. gh CLI
  try {
    const user = execSync("gh api user --jq .login", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (user) return { ok: true, user, method: "gh cli" };
  } catch {
    // gh not available or not logged in
  }

  return { ok: false };
}

function detectAPIKeys(): DetectedKey[] {
  const detected: DetectedKey[] = [];

  for (const check of KEY_CHECKS) {
    for (const envVar of check.envVars) {
      if (process.env[envVar]) {
        detected.push({
          provider: check.provider,
          envVar,
          display: check.label,
        });
        break; // Only count first match per provider
      }
    }
  }

  return detected;
}

function buildProviderOptions(detected: DetectedKey[]) {
  const detectedProviders = new Set(detected.map((d) => d.provider));

  const options = [
    {
      value: "openai",
      label: "OpenAI",
      hint: detectedProviders.has("openai")
        ? "✓ key detected — embedding+HAC clustering (cheap, narrow code-level patterns)"
        : "embedding+HAC clustering, narrow code-level patterns",
    },
    {
      value: "google",
      label: "Google Gemini",
      hint: detectedProviders.has("google")
        ? "✓ key detected — free tier available"
        : "free tier available, embedding+HAC clustering",
    },
    {
      value: "anthropic",
      label: "Anthropic (Claude)",
      hint: detectedProviders.has("anthropic")
        ? "✓ key detected — LLM-direct clustering, RECOMMENDED for convention/principle extraction"
        : "LLM-direct clustering, RECOMMENDED for convention/principle extraction",
    },
  ];

  // Put detected providers first
  return options.sort((a, b) => {
    const aDetected = detectedProviders.has(a.value) ? 0 : 1;
    const bDetected = detectedProviders.has(b.value) ? 0 : 1;
    return aDetected - bDetected;
  });
}

function getProviderHelpUrl(provider: string): string {
  switch (provider) {
    case "openai": return "https://platform.openai.com/api-keys";
    case "anthropic": return "https://console.anthropic.com/settings/keys";
    case "google": return "https://aistudio.google.com/apikey";
    default: return "";
  }
}

function getProviderEnvVar(provider: string): string {
  switch (provider) {
    case "openai": return "OPENAI_API_KEY";
    case "anthropic": return "ANTHROPIC_API_KEY";
    case "google": return "GOOGLE_API_KEY";
    default: return "";
  }
}

function generateConfig(opts: {
  provider: string;
  language: string;
  threshold: string;
  clusteringStrategy: string;
  memoryFile: string;
  pathScopedDir: string;
  adrDir: string;
}): string {
  const models = getDefaultModels(opts.provider);

  return `version: 2

language:
  preferredOutput: ${opts.language}

memoryTargets:
  agents:
    preferredFiles:
      - ${opts.memoryFile}
  pathScoped:
    preferredDir: ${opts.pathScopedDir}
  adr:
    dir: ${opts.adrDir}
    filenameFormat: "{number}-{slug}.md"

# aiReviewers:
#   - github-copilot[bot]
#   - coderabbitai[bot]
#   - greptile-apps[bot]
#   - claude[bot]
#   - devin-ai-integration[bot]
#   - ellipsis-dev[bot]
#   - qodo-merge-pro[bot]
#   - sourcery-ai[bot]

thresholds:
  minOccurrences: 2
  windowDays: 60
  similarityThreshold: ${opts.threshold}
  minConfidence: 0.75

llm:
  provider: ${opts.provider}
  classificationModel: ${models.classification}
  clusteringModel: ${models.clustering}
  clusteringStrategy: ${opts.clusteringStrategy}
  draftingModel: ${models.drafting}
  embeddingModel: ${models.embedding}

privacy:
  redactSecrets: true
  sendDiffHunksToLLM: false
`;
}

function getDefaultModels(provider: string) {
  switch (provider) {
    case "openai":
      // gpt-4.1-mini / gpt-4.1-nano are non-reasoning models — they produce
      // structured output (zod-validated JSON) reliably and cheaply. The
      // gpt-5.x family always reasons internally before answering, which
      // destabilizes strict structured-output enforcement on our cluster
      // schema. draft uses nano (~$0.10/M in) since text generation is
      // mechanical; classify and cluster use mini (~$0.40/M in) for the
      // slightly stronger judgment they need on routing decisions.
      return {
        classification: "gpt-4.1-mini",
        clustering: "gpt-4.1-mini",
        drafting: "gpt-4.1-nano",
        embedding: "text-embedding-3-small",
      };
    case "anthropic":
      // All-haiku default — haiku 4.5 handles our routing/clustering/drafting
      // workload competently and is 3x cheaper input / 3x cheaper output than
      // sonnet. Promoting cluster routing patterns isn't a deep-reasoning task;
      // users who need sharper judgment can opt into sonnet/opus per .promote.yml.
      return {
        classification: "claude-haiku-4-5",
        clustering: "claude-haiku-4-5",
        drafting: "claude-haiku-4-5",
        embedding: "text-embedding-3-small",
      };
    case "google":
      // 'latest' aliases auto-track Google's current generation. All-flash-lite
      // (~\$0.25/\$1.50 per M) is enough for the routing-style decisions this
      // tool makes; Gemini 3 Flash adds capability that isn't needed here.
      // Users wanting sharper output can swap to gemini-flash-latest per
      // .promote.yml.
      return {
        classification: "gemini-flash-lite-latest",
        clustering: "gemini-flash-lite-latest",
        drafting: "gemini-flash-lite-latest",
        embedding: "gemini-embedding-001",
      };
    default:
      return {
        classification: "gpt-4.1-mini",
        clustering: "gpt-4.1-mini",
        drafting: "gpt-4.1-nano",
        embedding: "text-embedding-3-small",
      };
  }
}

type ToolConfig = {
  rootFile: string;
  pathScopedDir: string;
  pathScopedExt: string;
  pathScopedFormat: string; // description for the memory file
};

const TOOL_CONFIGS: Record<string, ToolConfig> = {
  claude: {
    rootFile: "CLAUDE.md",
    pathScopedDir: ".claude/rules",
    pathScopedExt: "*.instructions.md",
    pathScopedFormat: "YAML frontmatter with `applyTo` globs",
  },
  codex: {
    rootFile: "AGENTS.md",
    pathScopedDir: "(nested AGENTS.md per directory)",
    pathScopedExt: "AGENTS.md",
    pathScopedFormat: "Place AGENTS.md in each subdirectory for scoped rules",
  },
  copilot: {
    rootFile: ".github/copilot-instructions.md",
    pathScopedDir: ".github/instructions",
    pathScopedExt: "*.instructions.md",
    pathScopedFormat: "YAML frontmatter with `applyTo` globs",
  },
  cursor: {
    rootFile: ".cursorrules",
    pathScopedDir: ".cursor/rules",
    pathScopedExt: "*.mdc",
    pathScopedFormat: "MDC with `description`, `alwaysApply`, and `globs` frontmatter",
  },
  windsurf: {
    rootFile: ".windsurfrules",
    pathScopedDir: ".windsurf/rules",
    pathScopedExt: "*.md",
    pathScopedFormat: "Plain text rules (6KB limit per file)",
  },
  gemini: {
    rootFile: "GEMINI.md",
    pathScopedDir: "(nested GEMINI.md per directory)",
    pathScopedExt: "GEMINI.md",
    pathScopedFormat: "Place GEMINI.md in each subdirectory for scoped rules",
  },
};

function generateMemoryFileContent(opts: {
  memoryFile: string;
  pathScopedDir: string;
  pathScopedExt: string;
  pathScopedFormat: string;
  adrDir: string;
}): string {
  const title = opts.memoryFile.replace(/^\./, "").replace(/\.md$/, "").replace(/rules$/, "").trim().toUpperCase() || "INSTRUCTIONS";

  return `# ${title}

## Knowledge structure

This repository organizes knowledge in multiple locations.
Check the relevant sources before making changes.

### Repo-wide rules
General conventions and coding standards are documented in this file.

### Path-scoped rules (\`${opts.pathScopedDir}/\`)
Domain-specific rules that apply only to certain directories.
Format: ${opts.pathScopedFormat}

### Architecture Decision Records (\`${opts.adrDir}/\`)
Decisions about architecture, trade-offs, and design rationale.
Check existing ADRs before making architectural changes.

### Test invariants
Some rules are enforced as tests rather than instructions.
Check existing tests before modifying critical behavior.

---

<!-- Rules below this line are managed by promote (https://github.com/gyulsbox/promote) -->
`;
}

function generateReferenceSection(opts: {
  pathScopedDir: string;
  pathScopedFormat: string;
  adrDir: string;
}): string {
  return `
## Knowledge structure

- **Path-scoped rules**: Check \`${opts.pathScopedDir}/\` for domain-specific rules. Format: ${opts.pathScopedFormat}
- **ADRs**: Check \`${opts.adrDir}/*.md\` for architecture decisions before making structural changes.
- **Test invariants**: Critical behaviors are enforced as tests.

<!-- Rules below this line are managed by promote (https://github.com/gyulsbox/promote) -->
`;
}
