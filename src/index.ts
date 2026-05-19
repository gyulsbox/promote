import { Command } from "commander";
import { runInit } from "./cli/commands/init.js";
import { runScan } from "./cli/commands/scan.js";
import { runPromote } from "./cli/commands/promote.js";
import { initDatabase } from "./storage/db.js";
import { updateCandidateStatus } from "./storage/repositories.js";
import * as out from "./cli/output.js";

// Graceful shutdown
process.on("SIGINT", () => {
  console.log();
  out.info("Interrupted. Bye!");
  process.exit(0);
});

const program = new Command();

program
  .name("promote")
  .description("Promote repeated AI review comments into durable repository memory")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize promote config and storage")
  .action(async () => {
    try {
      await runInit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("scan")
  .description("Scan repository for repeated AI review patterns")
  .option("--repo <owner/repo>", "GitHub repository (default: current git remote)")
  .option("--since <days>", "Time window (default: config windowDays or 60d)")
  .option("--out <path>", "Output digest file path")
  .option("--config <path>", "Path to config file")
  .option("--verbose", "Enable verbose output")
  .action(async (options) => {
    try {
      await runScan(options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("promote <candidateId>")
  .description("Promote a candidate into repository memory")
  .option("--target <target>", "Override routing target (agents, path_scoped_rule, adr, test)")
  .option("--file <path>", "Override target file path")
  .option("--write", "Actually write the file (default is dry-run)")
  .option("--dry-run", "Preview changes without writing")
  .option("--config <path>", "Path to config file")
  .action(async (candidateId, options) => {
    try {
      await runPromote(candidateId, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("ignore <candidateId>")
  .description("Ignore a candidate permanently")
  .option("--reason <reason>", "Why this is being ignored")
  .action((candidateId, options) => {
    try {
      const { db } = initDatabase();
      updateCandidateStatus(db, candidateId, "ignored", {
        ignoreReason: options.reason,
      });
      out.success(`Ignored ${candidateId}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program
  .command("snooze <candidateId>")
  .description("Snooze a candidate for a period")
  .option("--days <days>", "Number of days to snooze", "30")
  .action((candidateId, options) => {
    try {
      const days = Number(options.days);
      const until = new Date();
      until.setDate(until.getDate() + days);

      const { db } = initDatabase();
      updateCandidateStatus(db, candidateId, "snoozed", {
        snoozedUntil: until.toISOString(),
      });
      out.success(`Snoozed ${candidateId} until ${until.toISOString().split("T")[0]}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

program.parse();
