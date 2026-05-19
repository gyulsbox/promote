import { Command } from "commander";
import { runInit } from "./cli/commands/init.js";
import { runScan } from "./cli/commands/scan.js";

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
  .requiredOption("--repo <owner/repo>", "GitHub repository (e.g., owner/repo)")
  .option("--since <days>", "Time window (e.g., 60d)", "60d")
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

program.parse();
