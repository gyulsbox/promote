import chalk from "chalk";
import { NAME, VERSION } from "../version.js";

// Safe ASCII-only mascot that works in all terminals
const FACE = "(*o*)";
const FACE_HAPPY = "(^o^)";
const FACE_WORK = "(*o*)~";

export function mascotSays(message: string) {
  console.log(`  ${chalk.cyan(FACE)} ${chalk.dim(">")} ${message}`);
}

export function mascotHappy(message: string) {
  console.log(`  ${chalk.cyan(FACE_HAPPY)} ${chalk.dim(">")} ${message}`);
}

export function printBanner() {
  console.log();
  console.log(chalk.bold.cyan(`  ${NAME}`) + chalk.dim(` v${VERSION}`));
  console.log(chalk.dim("  Pick up lost decisions from AI review comments."));
  console.log();
}

export function printWelcome() {
  printBanner();
  mascotSays("Let's set up your project.");
  console.log();
}
