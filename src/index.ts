import { Command } from "commander";
import { runInit } from "./cli/commands/init.js";
import { runScan } from "./cli/commands/scan.js";
import { runPromote, runReview } from "./cli/commands/promote.js";
import { initDatabase } from "./storage/db.js";
import { updateCandidateStatus } from "./storage/repositories.js";
import * as out from "./cli/output.js";

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
  .version("0.1.2");

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
