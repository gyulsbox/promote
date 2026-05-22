import { Command } from "commander";
import { runInit } from "./cli/commands/init.js";
import { runScan } from "./cli/commands/scan.js";
import { runPromote, runReview } from "./cli/commands/promote.js";
import { initDatabase } from "./storage/db.js";
import { updateCandidateStatus } from "./storage/repositories.js";
import * as out from "./cli/output.js";
import { VERSION } from "./version.js";

// SIGINT: write to stderr (bypasses stdout buffering held by ora/clack spinners),
// restore cursor (ora hides it by default), exit with conventional 130.
// Second Ctrl+C inside the same process forces an immediate kill in case the first
// exit gets stuck waiting on in-flight HTTP sockets to flush.
let sigintCount = 0;
process.on("SIGINT", () => {
  sigintCount++;
  if (sigintCount === 1) {
    process.stderr.write("\n\x1b[?25h\x1b[31m✗\x1b[0m Interrupted.\n");
    process.exit(130);
  } else {
    process.kill(process.pid, "SIGKILL");
  }
});

const program = new Command();

program
  .name("promote")
  .description("Turn repeated AI review comments into durable repository memory")
  .version(VERSION)
  .addHelpText(
    "after",
    `
Examples:
  $ promote init                              Interactive setup
  $ promote scan                              Scan current repo (uses git remote, last 60d)
  $ promote scan --repo owner/repo --since 90d
                                              Scan another repo with custom window
  $ promote scan --mode broad                 LLM-direct clustering for convention-level patterns
  $ promote scan --out path/to/digest.md      Custom digest output path
  $ promote scan --no-interactive --min-confidence 0.85 --create-pr
                                              Headless mode (CI/GitHub Actions): auto-apply + open one PR
  $ promote review                            Interactively pick from pending candidates
  $ promote candidate_001 --target agents     Apply a specific candidate
  $ promote candidate_001 --create-pr         Apply and open a PR for a single candidate
  $ promote snooze candidate_001 --days 14    Defer for 14 days

Common scan options (see 'promote scan --help' for all):
  --repo <owner/repo>     GitHub repository (default: current git remote)
  --since <days>          Time window, e.g. 60d (default: per config)
  --mode <quick|broad>    Clustering mode (default: per config)
  --out <path>            Digest output file path
  --no-interactive        Disable all prompts (auto for CI / non-TTY)
  --min-confidence <n>    Confidence floor for auto-apply (0–1)
  --create-pr             Open one bundled PR after applying

Run 'promote <command> --help' for command-specific options.
`,
  );

program
  .command("init")
  .description("Interactive setup — LLM provider, AI tool, memory file locations")
  .action(async () => {
    try {
      await runInit();
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("scan")
  .description("Scan for repeated AI review patterns and review candidates")
  .option("--repo <owner/repo>", "GitHub repository (default: current git remote)")
  .option("--since <days>", "Time window, e.g. 60d (default: config windowDays)")
  .option("--out <path>", "Digest output file path")
  .option("--config <path>", "Path to .promote.yml")
  .option(
    "--mode <mode>",
    "Clustering mode: 'quick' (embedding+HAC, cheap, narrow patterns — requires a provider with embedding API: OpenAI or Google) or 'broad' (LLM-direct, convention-level patterns, more costly — works on any provider). Overrides llm.clusteringStrategy in config.",
  )
  .option("--no-interactive", "Disable all prompts. Auto-enabled when CI=true or stdout is not a TTY.")
  .option(
    "--min-confidence <number>",
    "Auto-apply only candidates with confidence ≥ this value (0–1). Defaults to config thresholds.minConfidence.",
  )
  .option(
    "--create-pr",
    "After applying, open a single bundled PR for all applied candidates. Requires gh auth or GITHUB_TOKEN.",
  )
  .option("--base-branch <name>", "PR base branch (default: repo's default branch)")
  .option(
    "--allow-foreign-scan",
    "Allow --repo to point at a different repository than the local working tree. Files are written locally and the PR is opened against the local repo. Useful for testing or upstream-tracking workflows.",
  )
  .option("--verbose", "Verbose output")
  .action(async (options) => {
    try {
      await runScan(options);
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("review")
  .description("Review pending candidates one by one (after deferring from scan)")
  .option("--config <path>", "Path to .promote.yml")
  .action(async (options) => {
    try {
      await runReview(options);
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("promote <candidateId>")
  .description("Apply a specific candidate — shows details, asks for confirmation")
  .option("--target <target>", "Override routing target (agents, path_scoped_rule, adr, test)")
  .option("--file <path>", "Override target file path")
  .option("--config <path>", "Path to .promote.yml")
  .option(
    "--create-pr",
    "After applying, open a PR for this single candidate. Requires gh auth or GITHUB_TOKEN.",
  )
  .option("--base-branch <name>", "PR base branch (default: repo's default branch)")
  .action(async (candidateId, options) => {
    try {
      await runPromote(candidateId, options);
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("ignore <candidateId>")
  .description("Permanently ignore a candidate")
  .option("--reason <reason>", "Why this is being ignored")
  .action((candidateId, options) => {
    try {
      const { db } = initDatabase();
      updateCandidateStatus(db, candidateId, "ignored", { ignoreReason: options.reason });
      out.success(`Ignored ${candidateId}.`);
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("snooze <candidateId>")
  .description("Snooze a candidate — resurfaces automatically after the period")
  .option("--days <days>", "Days to snooze", "30")
  .action((candidateId, options) => {
    try {
      const days = Number(options.days);
      const until = new Date();
      until.setDate(until.getDate() + days);
      const { db } = initDatabase();
      updateCandidateStatus(db, candidateId, "snoozed", { snoozedUntil: until.toISOString() });
      out.success(`Snoozed ${candidateId} until ${until.toISOString().split("T")[0]}.`);
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
