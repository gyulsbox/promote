import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import chalk from "chalk";
import { NAME, VERSION } from "../version.js";

const PACKAGE_NAME = "promote-cli";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_FILE = join(homedir(), ".promote-cli", "version-check.json");
const FETCH_TIMEOUT_MS = 3000;
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

type CacheEntry = { checkedAt: number; latestVersion: string };

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: string };
    return json.version ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function loadCache(): CacheEntry | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as CacheEntry;
  } catch {
    return null;
  }
}

function saveCache(entry: CacheEntry): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(entry, null, 2), "utf-8");
  } catch {
    // best-effort; missing cache just means a fresh fetch next time
  }
}

function parseSemver(v: string): [number, number, number] {
  const parts = v.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isOutdated(installed: string, latest: string): boolean {
  const [a, b, c] = parseSemver(installed);
  const [x, y, z] = parseSemver(latest);
  if (x !== a) return x > a;
  if (y !== b) return y > b;
  return z > c;
}

/**
 * Fire-once check against npm registry for newer versions. Cached for 24h in
 * ~/.promote-cli/version-check.json. Failures (offline, registry down) are
 * silent. Awaited so the warning prints before the rest of the CLI output;
 * 3s timeout keeps the worst-case latency bounded.
 */
export async function notifyIfOutdated(): Promise<void> {
  let latest: string | null = null;
  const cached = loadCache();
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    latest = cached.latestVersion;
  } else {
    latest = await fetchLatestVersion();
    if (latest) saveCache({ checkedAt: Date.now(), latestVersion: latest });
  }

  if (!latest) return;
  if (!isOutdated(VERSION, latest)) return;

  process.stderr.write(
    chalk.yellow(
      `\n⚠ ${NAME} v${VERSION} → v${latest} available. Update: npm i -g ${PACKAGE_NAME}\n\n`,
    ),
  );
}
