import chalk from "chalk";
import ora, { type Ora } from "ora";

export function spinner(text: string): Ora {
  return ora({ text, color: "cyan" }).start();
}

export function success(msg: string) {
  console.log(chalk.green("✓"), msg);
}

export function info(msg: string) {
  console.log(chalk.blue("ℹ"), msg);
}

export function warn(msg: string) {
  console.log(chalk.yellow("⚠"), msg);
}

export function error(msg: string) {
  console.error(chalk.red("✗"), msg);
}

export function stat(label: string, value: string | number) {
  console.log(`  ${chalk.dim(label + ":")} ${chalk.bold(String(value))}`);
}

export function divider() {
  console.log(chalk.dim("─".repeat(50)));
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = (s - m * 60).toFixed(0);
  return `${m}m ${rem}s`;
}
