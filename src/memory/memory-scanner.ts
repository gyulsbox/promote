import type { Octokit } from "octokit";
import type { RepoRef, MemoryTargetsConfig } from "../core/types.js";

// Suppress deprecation warnings from Octokit for contents API
const originalWarn = console.warn;
function suppressOctokitWarnings() {
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0] ?? "");
    if (msg.includes("@octokit/request") && msg.includes("deprecated")) return;
    originalWarn.apply(console, args);
  };
}
function restoreWarnings() {
  console.warn = originalWarn;
}

export type MemoryContext = {
  files: MemoryFile[];
  snippets: string[];
};

type MemoryFile = {
  path: string;
  headings: string[];
  content: string;
};

const DEFAULT_MEMORY_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
];

const DEFAULT_MEMORY_DIRS = [
  { path: ".github/instructions", pattern: /\.instructions\.md$/ },
  { path: "docs/adr", pattern: /\.md$/ },
];

export async function scanExistingMemory(
  octokit: Octokit,
  repo: RepoRef,
  config?: MemoryTargetsConfig,
): Promise<MemoryContext> {
  const files: MemoryFile[] = [];

  // Merge config values with defaults
  const memoryFiles = config?.agents?.preferredFiles ?? DEFAULT_MEMORY_FILES;
  const adrDir = config?.adr?.dir ?? "docs/adr";
  const pathScopedDir = config?.pathScoped?.preferredDir ?? ".github/instructions";
  const memoryDirs = [
    { path: pathScopedDir, pattern: /\.instructions\.md$/ },
    { path: adrDir, pattern: /\.md$/ },
  ];

  suppressOctokitWarnings();

  // Scan known memory files
  for (const filePath of memoryFiles) {
    const content = await fetchFileContent(octokit, repo, filePath);
    if (content) {
      files.push({
        path: filePath,
        headings: extractHeadings(content),
        content: content.slice(0, 3000), // cap to avoid huge context
      });
    }
  }

  // Scan memory directories
  for (const dir of memoryDirs) {
    const dirFiles = await listDirectory(octokit, repo, dir.path);
    for (const f of dirFiles.filter((n) => dir.pattern.test(n)).slice(0, 5)) {
      const fullPath = `${dir.path}/${f}`;
      const content = await fetchFileContent(octokit, repo, fullPath);
      if (content) {
        files.push({
          path: fullPath,
          headings: extractHeadings(content),
          content: content.slice(0, 1000),
        });
      }
    }
  }

  restoreWarnings();

  // Build snippets for LLM context (keep under 2000 tokens ~8000 chars)
  const snippets: string[] = [];
  let totalLen = 0;
  const maxLen = 8000;

  for (const file of files) {
    const snippet = `## ${file.path}\n${file.headings.map((h) => `- ${h}`).join("\n")}`;
    if (totalLen + snippet.length > maxLen) break;
    snippets.push(snippet);
    totalLen += snippet.length;
  }

  return { files, snippets };
}

async function fetchFileContent(
  octokit: Octokit,
  repo: RepoRef,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: repo.owner,
      repo: repo.name,
      path,
    });

    if ("content" in data && data.content) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
  } catch {
    // File doesn't exist
  }
  return null;
}

async function listDirectory(
  octokit: Octokit,
  repo: RepoRef,
  path: string,
): Promise<string[]> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: repo.owner,
      repo: repo.name,
      path,
    });

    if (Array.isArray(data)) {
      return data.map((f) => f.name);
    }
  } catch {
    // Directory doesn't exist
  }
  return [];
}

function extractHeadings(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => /^#{1,3}\s/.test(line))
    .map((line) => line.replace(/^#+\s*/, "").trim());
}
