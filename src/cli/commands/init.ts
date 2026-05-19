import * as p from "@clack/prompts";
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import chalk from "chalk";
import { printWelcome, mascotSays } from "../mascot.js";

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
      { value: "0.82", label: "Balanced (recommended)", hint: "default threshold" },
      { value: "0.75", label: "Relaxed", hint: "more matches, some may be noisy" },
    ],
  });

  if (p.isCancel(threshold)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // 6. Write config
  const cwd = process.cwd();
  const configPath = resolve(cwd, ".promote.yml");
  const storageDir = resolve(cwd, ".promote");

  const s = p.spinner();

  s.start("Writing config...");

  const configContent = generateConfig({
    provider: provider as string,
    language: language as string,
    threshold: threshold as string,
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

  s.stop("Config written.");

  // 7. Done
  console.log();
  mascotSays("You're all set!");
  console.log();

  p.note(
    [
      `${chalk.bold("Scan a repo:")}`,
      `  promote scan --repo owner/repo`,
      ``,
      `${chalk.bold("Other commands:")}`,
      `  promote scan --repo owner/repo --since 90d   # custom window`,
      `  promote promote candidate_001 --target agents --write`,
      `  promote config                               # edit settings`,
      `  promote --help                               # all commands`,
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
        ? "✓ key detected"
        : "requires OPENAI_API_KEY",
    },
    {
      value: "google",
      label: "Google Gemini",
      hint: detectedProviders.has("google")
        ? "✓ key detected"
        : "free tier available",
    },
    {
      value: "anthropic",
      label: "Anthropic (Claude)",
      hint: detectedProviders.has("anthropic")
        ? "✓ key detected — uses LLM for clustering (no embedding needed)"
        : "requires ANTHROPIC_API_KEY",
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
}): string {
  const models = getDefaultModels(opts.provider);

  return `version: 1

language:
  preferredOutput: ${opts.language}
  fallback: en

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
  minOccurrences: 3
  windowDays: 60
  similarityThreshold: ${opts.threshold}
  minConfidence: 0.75

llm:
  provider: ${opts.provider}
  classificationModel: ${models.classification}
  draftingModel: ${models.drafting}
  embeddingModel: ${models.embedding}
`;
}

function getDefaultModels(provider: string) {
  switch (provider) {
    case "openai":
      return {
        classification: "gpt-4.1-mini",
        drafting: "gpt-4.1-mini",
        embedding: "text-embedding-3-small",
      };
    case "anthropic":
      return {
        classification: "claude-sonnet-4-5",
        drafting: "claude-haiku-4-5",
        embedding: "text-embedding-3-small",
      };
    case "google":
      return {
        classification: "gemini-2.5-flash",
        drafting: "gemini-2.5-flash",
        embedding: "gemini-embedding-001",
      };
    default:
      return {
        classification: "gpt-4.1-mini",
        drafting: "gpt-4.1-mini",
        embedding: "text-embedding-3-small",
      };
  }
}
