import { execSync } from "node:child_process";

/**
 * "owner/repo" for the current working directory's origin remote, or null when
 * there isn't one (not a git checkout, no origin, or a non-GitHub remote).
 *
 * Never throws: every caller treats "no local repo" as a normal state rather
 * than an error.
 */
export function detectLocalRepo(): string | null {
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
