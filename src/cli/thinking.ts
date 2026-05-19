import chalk from "chalk";

const CLUSTER_MESSAGES = [
  "Grouping similar comments...",
  "Finding patterns in the noise...",
  "Comparing review comments...",
  "Matching repeated signals...",
  "Sorting through 60 days of reviews...",
  "Measuring similarity...",
  "Building comment clusters...",
  "Connecting scattered feedback...",
  "Detecting repeated themes...",
];

const CLASSIFY_MESSAGES = [
  "AGENTS.md or ADR? Hmm...",
  "Is this a rule or a decision?",
  "Checking if this is test-worthy...",
  "Routing to the right destination...",
  "Convention or one-off?",
  "Should future agents know this?",
  "Evaluating enforcement options...",
  "Reading between the lines...",
  "Picking up lost decisions...",
  "Weighing the evidence...",
  "Consulting the memory files...",
  "Separating signal from noise...",
  "Cross-referencing with existing rules...",
];

const DRAFT_MESSAGES = [
  "Writing a concise rule...",
  "Keeping it short and useful...",
  "Drafting the memory patch...",
  "Making it agent-readable...",
  "Choosing the right words...",
  "Organizing scattered knowledge...",
];

export function getClassifyMessage(): string {
  return CLASSIFY_MESSAGES[Math.floor(Math.random() * CLASSIFY_MESSAGES.length)];
}

export function getDraftMessage(): string {
  return DRAFT_MESSAGES[Math.floor(Math.random() * DRAFT_MESSAGES.length)];
}

// Sparkle characters that cycle for the leading icon
const SPARKLES = ["✦", "✶", "✧", "✷", "✸", "✹", "⊹", "✺"];

// Shimmer effect: text with a "light sweep" moving through it
function shimmerText(text: string, tick: number): string {
  const chars = [...text];
  const shimmerPos = tick % (chars.length + 4);

  return chars
    .map((ch, i) => {
      const dist = Math.abs(i - shimmerPos);
      if (dist === 0) return chalk.white.bold(ch);
      if (dist === 1) return chalk.cyan(ch);
      if (dist === 2) return chalk.dim.cyan(ch);
      return chalk.dim(ch);
    })
    .join("");
}

/**
 * Creates a smart spinner with:
 * - Elapsed time counter
 * - Rotating sparkle icon
 * - Shimmer effect on the thinking message
 * - Message rotation every few seconds
 */
export function createTimedSpinner(
  ora: { text: string },
  getMessageFn: () => string,
  prefix: string,
) {
  const startTime = Date.now();
  let tick = 0;
  let currentMessage = getMessageFn();
  let messageAge = 0;

  const updateText = () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const timeStr = chalk.dim(`${elapsed}s`);
    const sparkle = chalk.cyan(SPARKLES[tick % SPARKLES.length]);
    const message = shimmerText(currentMessage, tick);

    ora.text = `${prefix} ${sparkle} ${message} ${chalk.dim(`(${timeStr})`)}`;

    tick++;
    messageAge++;

    // Rotate message every ~10 ticks (3s)
    if (messageAge >= 10) {
      currentMessage = getMessageFn();
      messageAge = 0;
    }
  };

  const interval = setInterval(updateText, 300);
  updateText();

  return {
    stop: () => { clearInterval(interval); },
    getElapsed: () => Math.floor((Date.now() - startTime) / 1000),
  };
}

export function getClusterMessage(): string {
  return CLUSTER_MESSAGES[Math.floor(Math.random() * CLUSTER_MESSAGES.length)];
}

export function getThinkingMessage(): string {
  return getClassifyMessage();
}
