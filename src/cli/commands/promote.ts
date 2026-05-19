import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import chalk from "chalk";
import * as p from "@clack/prompts";
import type { PromotionCandidate } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { initDatabase } from "../../storage/db.js";
import { getCandidateById } from "../../storage/repositories.js";
import * as out from "../output.js";
import { mascotHappy, mascotSays } from "../mascot.js";

export type PromoteOptions = {
  target?: string;
  file?: string;
  write?: boolean;
  dryRun?: boolean;
  config?: string;
};

/**
 * Apply a promotion from interactive review (called from scan)
 */
export async function applyPromotion(
  candidate: PromotionCandidate,
  target: string,
) {
  const config = loadConfig();
  const targetFile = resolveTargetFile(target, candidate, config);
  const cwd = process.cwd();
  const fullPath = resolve(cwd, targetFile);

  // Check if file exists
  if (!existsSync(fullPath)) {
    const create = await p.confirm({
      message: `${targetFile} doesn't exist. Create it?`,
    });

    if (p.isCancel(create) || !create) {
      out.info(`Skipped ${candidate.id}. You can create the file manually.`);
      return;
    }

    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, "", "utf-8");
  }

  // Append content
  const existing = readFileSync(fullPath, "utf-8");
  const separator = existing.length > 0 && !existing.endsWith("\n\n") ? "\n\n" : "";
  const newContent = existing + separator + candidate.draft.content + "\n";

  writeFileSync(fullPath, newContent, "utf-8");
  out.success(`Promoted to ${chalk.bold(targetFile)}: ${candidate.summary}`);
}

/**
 * Standalone promote command (from CLI: promote promote candidate_001 --target agents --write)
 */
export async function runPromote(candidateId: string, options: PromoteOptions) {
  const config = loadConfig(options.config);
  const { db } = initDatabase();

  // Load candidate from DB
  const row = getCandidateById(db, candidateId);
  if (!row) {
    out.error(`Candidate ${candidateId} not found. Run 'promote scan' first.`);
    return;
  }

  const target = options.target ?? row.target;
  const targetFile = options.file ?? resolveTargetFile(target, row as any, config);
  const content = row.draftContent ?? "";

  if (!content) {
    out.error(`No draft content for ${candidateId}.`);
    return;
  }

  if (options.dryRun || !options.write) {
    // Dry run — just print the diff
    mascotSays(`Dry run for ${candidateId}:`);
    console.log();
    console.log(chalk.dim(`  Target: ${targetFile}`));
    console.log(chalk.dim("  Content:"));
    console.log();
    for (const line of content.split("\n")) {
      console.log(chalk.green(`  + ${line}`));
    }
    console.log();
    out.info("Add --write to apply.");
    return;
  }

  // Write
  const cwd = process.cwd();
  const fullPath = resolve(cwd, targetFile);

  if (!existsSync(fullPath)) {
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content + "\n", "utf-8");
  } else {
    const existing = readFileSync(fullPath, "utf-8");
    const separator = existing.length > 0 && !existing.endsWith("\n\n") ? "\n\n" : "";
    writeFileSync(fullPath, existing + separator + content + "\n", "utf-8");
  }

  mascotHappy(`Promoted ${candidateId} → ${targetFile}`);
}

function resolveTargetFile(
  target: string,
  candidate: { suggestedFile?: string | null; pathScope?: string | null },
  config: ReturnType<typeof loadConfig>,
): string {
  // If candidate has a suggested file, use it
  if (candidate.suggestedFile && candidate.suggestedFile !== "(test file)" && candidate.suggestedFile !== "(auto)") {
    return candidate.suggestedFile;
  }

  switch (target) {
    case "agents": {
      const preferred = config.memoryTargets?.agents?.preferredFiles;
      return preferred?.[0] ?? "AGENTS.md";
    }
    case "path_scoped_rule": {
      const dir = config.memoryTargets?.pathScoped?.preferredDir ?? ".github/instructions";
      const scope = candidate.pathScope ?? "general";
      const slug = scope.replace(/[/*]/g, "-").replace(/^-+|-+$/g, "") || "rule";
      return `${dir}/${slug}.instructions.md`;
    }
    case "adr": {
      const dir = config.memoryTargets?.adr?.dir ?? "docs/adr";
      return `${dir}/NNN-title.md`;
    }
    case "test":
      return "(test recommendation — see digest)";
    default:
      return "AGENTS.md";
  }
}
