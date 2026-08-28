/**
 * Offline threshold sweep over a captured fixture. No network, no API key.
 *
 * Two modes:
 *
 *   --fixture F
 *     Sweep F alone. Shows how cluster count and shape respond to the
 *     similarity threshold, which is the thing that has never been measured:
 *     0.80 was picked against OpenAI embeddings, and llmRefine's wide 0.15
 *     margin exists to paper over pairs that fall below it.
 *
 *   --fixture F --baseline B
 *     Sweep candidate F against baseline B's clustering at --baseline-threshold
 *     (default: the configured 0.80). This is the Phase 1 gate: it reports the
 *     threshold at which a new embedding model best reproduces the current
 *     grouping, and how well it does there.
 *
 * Reading the gate: ARI is the headline. Precision below recall means the
 * candidate over-merges at that threshold; recall below precision means it
 * over-splits. They call for opposite moves, which is why both are printed.
 */
import { loadConfig } from "../src/core/config.js";
import type { EmbeddingFixture } from "../src/fixture/schema.js";
import { readFixture } from "../src/fixture/io.js";
import {
  sweep,
  sweepAgainstBaseline,
  bestThreshold,
  clusterAtThreshold,
  DEFAULT_SWEEP,
} from "../src/fixture/sweep.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function load(path: string): EmbeddingFixture {
  const fixture = readFixture(path);
  console.log(
    `${path}\n  ${fixture.repo}, ${fixture.sinceDays}d, ${fixture.counts.embedded} comments, ` +
      `${fixture.embeddingModel}, promote ${fixture.promoteVersion}`,
  );
  const nonEnglish = Object.entries(fixture.languageMix).filter(([lang]) => lang !== "en");
  if (nonEnglish.length > 0) {
    console.log(
      `  non-English comments: ${JSON.stringify(Object.fromEntries(nonEnglish))} ` +
        `— an English-only local model will not embed these usefully`,
    );
  }
  return fixture;
}

const pct = (n: number) => n.toFixed(3);

function main() {
  const fixturePath = arg("fixture");
  if (!fixturePath) throw new Error("Missing required argument --fixture");

  const config = loadConfig();
  const minOccurrences = config.thresholds.minOccurrences;
  const baselineThreshold = Number(arg("baseline-threshold") ?? config.thresholds.similarityThreshold);

  const fixture = load(fixturePath);
  const baselinePath = arg("baseline");

  if (!baselinePath) {
    console.log(`\nthreshold  clusters  repeated(>=${minOccurrences})  largest  singletons`);
    for (const p of sweep(fixture, DEFAULT_SWEEP, minOccurrences)) {
      console.log(
        `  ${p.threshold.toFixed(2)}       ${String(p.clusters).padStart(5)}   ` +
          `${String(p.repeatedClusters).padStart(10)}   ${String(p.largestCluster).padStart(6)}   ` +
          `${String(p.singletons).padStart(9)}`,
      );
    }
    console.log(
      `\nConfigured threshold is ${config.thresholds.similarityThreshold}. ` +
        `A row where "largest" swallows most comments means the threshold is too low for this model.`,
    );
    return;
  }

  const baselineFixture = load(baselinePath);
  const baseline = clusterAtThreshold(baselineFixture, baselineThreshold, minOccurrences);
  console.log(
    `\nBaseline: ${baseline.clusters} clusters ` +
      `(${baseline.repeatedClusters} repeated) at threshold ${baselineThreshold}`,
  );

  const comparisons = sweepAgainstBaseline(fixture, baseline, DEFAULT_SWEEP, minOccurrences);

  console.log(`\nthreshold  clusters  repeated  ARI      precision  recall`);
  for (const c of comparisons) {
    console.log(
      `  ${c.threshold.toFixed(2)}       ${String(c.clusters).padStart(5)}   ` +
        `${String(c.repeatedClusters).padStart(6)}   ${pct(c.agreement.adjustedRandIndex)}    ` +
        `${pct(c.agreement.pairwise.precision)}      ${pct(c.agreement.pairwise.recall)}`,
    );
  }

  const best = bestThreshold(comparisons);
  if (!best) return;

  console.log(
    `\nBest agreement at threshold ${best.threshold}: ARI ${pct(best.agreement.adjustedRandIndex)}, ` +
      `${best.clusters} clusters (${best.repeatedClusters} repeated) vs baseline's ` +
      `${baseline.clusters} (${baseline.repeatedClusters}).`,
  );
  if (best.threshold !== baselineThreshold) {
    console.log(
      `The candidate model wants a different threshold than ${baselineThreshold}. ` +
        `Judge the gate on this row, not on the baseline's threshold.`,
    );
  }
  if (best.agreement.pairwise.precision < best.agreement.pairwise.recall) {
    console.log(`Residual disagreement is over-merging (precision < recall).`);
  } else if (best.agreement.pairwise.recall < best.agreement.pairwise.precision) {
    console.log(`Residual disagreement is over-splitting (recall < precision).`);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
