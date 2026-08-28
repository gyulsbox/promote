import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { detectLocalRepo } from "./local-repo.js";

/**
 * Working out from the repository what `promote init` used to ask.
 *
 * The principle behind dropping those questions is that a user should not be
 * asked something they cannot answer better than the tool can. Which AI
 * reviewer a team uses, where its memory file lives, and what language to
 * write in are all visible in the checkout or the environment. Asking is worse
 * than looking: the answer is already on disk, and a wrong guess is one flag
 * away from being fixed.
 *
 * Detection only fills in defaults. An existing .promote.yml always wins, and
 * nothing here writes a file.
 */

export type DetectedProvider = "openai" | "anthropic" | "google";

/** Memory files that AI coding tools read, in the order to prefer them when several exist. */
const AGENT_MEMORY_FILES = ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"] as const;

/**
 * Rule directories that identify the tool in use. They are reported but do not
 * become the path-scoped target: those use a `.instructions.md` naming
 * convention that Cursor and Windsurf do not share.
 */
const TOOL_RULE_DIRS: Array<{ dir: string; tool: string }> = [
  { dir: ".cursor/rules", tool: "Cursor" },
  { dir: ".windsurf/rules", tool: "Windsurf" },
  { dir: ".github/instructions", tool: "Copilot" },
];

const PROVIDER_ENV: Array<{ provider: DetectedProvider; envVar: string }> = [
  { provider: "openai", envVar: "OPENAI_API_KEY" },
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { provider: "google", envVar: "GOOGLE_API_KEY" },
];

export type Detection = {
  /** Null when no provider key is present in the environment. */
  provider: DetectedProvider | null;
  /** Every provider whose key is set, so an ambiguous environment can be reported. */
  providersAvailable: DetectedProvider[];
  /** preferredFiles, reordered so files that exist come first. */
  memoryFiles: string[];
  /** The subset of memoryFiles that actually exist in the checkout. */
  existingMemoryFiles: string[];
  /** Rule directories found, by the tool they belong to. */
  toolsDetected: string[];
  pathScopedDir: string | null;
  language: "en" | "ja" | "ko";
  repo: string | null;
};

export type DetectOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Injected in tests; defaults to reading the current git remote. */
  repo?: string | null;
};

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The first provider whose key is set, preferring OpenAI to keep the default
 * unchanged for anyone who has several configured.
 */
export function detectProvider(env: Record<string, string | undefined>): {
  provider: DetectedProvider | null;
  available: DetectedProvider[];
} {
  const available = PROVIDER_ENV.filter((p) => (env[p.envVar] ?? "").length > 0).map(
    (p) => p.provider,
  );
  return { provider: available[0] ?? null, available };
}

/**
 * Reorders the known memory files so ones present in the checkout come first.
 *
 * This is what makes detection worth doing: `resolveTargetFile` writes to
 * `preferredFiles[0]`, so with the static default order a repository that uses
 * only `.github/copilot-instructions.md` got a brand new `AGENTS.md` created
 * beside it instead of an edit to the file the team actually reads.
 */
export function detectMemoryFiles(cwd: string): { ordered: string[]; existing: string[] } {
  const existing = AGENT_MEMORY_FILES.filter((f) => existsSync(resolve(cwd, f)));
  const rest = AGENT_MEMORY_FILES.filter((f) => !existing.includes(f));
  return { ordered: [...existing, ...rest], existing: [...existing] };
}

/** Maps a POSIX locale or BCP-47 tag to an output language promote supports. */
export function detectLanguage(env: Record<string, string | undefined>): "en" | "ja" | "ko" {
  const raw =
    env.LC_ALL || env.LC_MESSAGES || env.LANG || safeIntlLocale() || "";
  const tag = raw.toLowerCase().replace("_", "-");
  if (tag.startsWith("ko")) return "ko";
  if (tag.startsWith("ja")) return "ja";
  return "en";
}

function safeIntlLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "";
  }
}

export function detectEnvironment(options: DetectOptions = {}): Detection {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  const { provider, available } = detectProvider(env);
  const { ordered, existing } = detectMemoryFiles(cwd);

  const rules = TOOL_RULE_DIRS.filter((r) => isDir(resolve(cwd, r.dir)));

  return {
    provider,
    providersAvailable: available,
    memoryFiles: ordered,
    existingMemoryFiles: existing,
    toolsDetected: rules.map((r) => r.tool),
    // Only a directory following the .instructions.md convention becomes the
    // path-scoped target; Cursor and Windsurf rule files use their own naming.
    pathScopedDir: rules.some((r) => r.dir === ".github/instructions")
      ? ".github/instructions"
      : null,
    language: detectLanguage(env),
    repo: options.repo !== undefined ? options.repo : detectLocalRepo(),
  };
}

/**
 * One line for the first run, so the user can see what was assumed on their
 * behalf and reach for a flag if any of it is wrong.
 */
export function describeDetection(detection: Detection): string {
  const parts: string[] = [];

  if (detection.existingMemoryFiles.length > 0) {
    parts.push(`memory ${detection.existingMemoryFiles.join(", ")}`);
  } else {
    parts.push(`memory ${detection.memoryFiles[0]} (would be created)`);
  }

  if (detection.toolsDetected.length > 0) {
    parts.push(detection.toolsDetected.join(" + "));
  }

  parts.push(detection.provider ? `provider ${detection.provider}` : "no provider key found");
  parts.push(`language ${detection.language}`);

  return `Detected: ${parts.join(" · ")}`;
}
