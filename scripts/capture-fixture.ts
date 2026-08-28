/**
 * Phase 0 baseline capture.
 *
 * Fetches a repo's AI review comments, normalizes them exactly as `scan` does,
 * embeds them with the configured API model, and writes comments + raw vectors
 * to a JSON fixture.
 *
 * The vectors are the reason this exists. Every Phase 1 question - does a local
 * ONNX model group these the same way, which similarity threshold fits it, is
 * llmRefine still worth its cost - is a re-clustering of these same inputs.
 * With vectors on disk, all of it runs offline and free via `sweep-fixture.ts`.
 * Without them, each sweep point is another paid scan.
 *
 * Cost is the embedding call only (no classify, no draft): a few tenths of a
 * cent for a typical window. Classification and cost/timing numbers for the
 * full pipeline come from a normal `promote scan` run.
 *
 *   OPENAI_API_KEY=... GITHUB_TOKEN=... \
 *     pnpm tsx scripts/capture-fixture.ts --repo trpc/trpc --since 120
 */
import { resolve } from "node:path";
import { embedMany } from "ai";
import { createOctokit, parseRepoRef } from "../src/ingest/github-client.js";
import { fetchReviewComments, computeSinceDate } from "../src/ingest/comment-fetcher.js";
import { filterAIReviewComments } from "../src/filter/ai-reviewer-filter.js";
import { filterNoise } from "../src/filter/noise-filter.js";
import { normalizeComments } from "../src/normalize/normalizer.js";
import { resolveModels } from "../src/llm/provider.js";
import { loadConfig } from "../src/core/config.js";
import { VERSION } from "../src/version.js";
import { FIXTURE_VERSION, type EmbeddingFixture } from "../src/fixture/schema.js";
import { writeFixture } from "../src/fixture/io.js";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument --${name}`);
}

async function main() {
  const repoArg = arg("repo");
  const sinceDays = Number(arg("since", "120"));
  const config = loadConfig();
  const repo = parseRepoRef(repoArg);
  const out = resolve(
    arg("out", `fixtures/${repo.owner}-${repo.name}-${sinceDays}d.json.gz`),
  );

  const models = resolveModels(config.llm);
  if (!models.embeddingModel) {
    throw new Error(
      `Provider "${config.llm.provider}" has no embedding API. Capture the baseline with OpenAI or Google.`,
    );
  }

  console.log(`Fetching ${repo.fullName}, last ${sinceDays}d...`);
  const all = await fetchReviewComments(
    createOctokit(),
    repo,
    computeSinceDate(sinceDays),
    (n) => process.stdout.write(`\r  ${n} comments`),
  );
  process.stdout.write("\n");

  const { ai } = filterAIReviewComments(all, config.aiReviewers);
  const { kept } = filterNoise(ai);
  const comments = normalizeComments(kept);
  console.log(`  ${all.length} fetched -> ${ai.length} AI-authored -> ${comments.length} after noise filter`);

  const languageMix: Record<string, number> = {};
  for (const c of comments) languageMix[c.language] = (languageMix[c.language] ?? 0) + 1;
  console.log(`  language mix: ${JSON.stringify(languageMix)}`);

  // Same batching as cluster/pre-cluster.ts so the vectors match what a real
  // scan would produce.
  const vectors: number[][] = [];
  for (let i = 0; i < comments.length; i += 100) {
    const batch = comments.slice(i, i + 100);
    const { embeddings } = await embedMany({
      model: models.embeddingModel,
      values: batch.map((c) => c.normalizedBody),
    });
    vectors.push(...embeddings);
    process.stdout.write(`\r  embedded ${vectors.length}/${comments.length}`);
  }
  process.stdout.write("\n");

  const fixture: EmbeddingFixture = {
    fixtureVersion: FIXTURE_VERSION,
    capturedAt: new Date().toISOString(),
    repo: repo.fullName,
    sinceDays,
    embeddingModel: `${config.llm.provider}:${config.llm.embeddingModel}`,
    promoteVersion: VERSION,
    counts: {
      fetched: all.length,
      aiAuthored: ai.length,
      afterNoiseFilter: comments.length,
      embedded: vectors.length,
    },
    languageMix,
    comments,
    // 6 decimals is well below the precision any similarity decision depends
    // on and roughly halves the file.
    vectors: vectors.map((v) => v.map((x) => Number(x.toFixed(6)))),
  };

  const bytes = writeFixture(out, fixture);
  console.log(`\nWrote ${out} (${(bytes / 1024 / 1024).toFixed(1)} MB gzipped)`);
  console.log(`Next: pnpm tsx scripts/sweep-fixture.ts --fixture ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
