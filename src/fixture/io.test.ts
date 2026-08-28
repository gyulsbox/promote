import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixture, readFixture } from "./io.js";
import { FIXTURE_VERSION, type EmbeddingFixture } from "./schema.js";
import type { NormalizedComment } from "../core/types.js";

function comment(id: string): NormalizedComment {
  return {
    id,
    originalBody: `body ${id}`,
    normalizedBody: `body ${id}`,
    identifiers: [],
    paths: [],
    actionVerbs: [],
    severityMarker: { raw: null, level: "unknown" },
    language: "en",
    prNumber: 1,
    authorLogin: "coderabbitai[bot]",
    htmlUrl: `https://example.test/${id}`,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function fixture(n: number, dim: number): EmbeddingFixture {
  const comments = Array.from({ length: n }, (_, i) => comment(`c${i}`));
  const vectors = comments.map((_, i) =>
    Array.from({ length: dim }, (_, d) => Number((Math.sin(i * dim + d) / 2).toFixed(6))),
  );
  return {
    fixtureVersion: FIXTURE_VERSION,
    capturedAt: "2026-01-01T00:00:00Z",
    repo: "acme/widgets",
    sinceDays: 120,
    embeddingModel: "openai:text-embedding-3-small",
    promoteVersion: "0.8.0",
    counts: { fetched: n, aiAuthored: n, afterNoiseFilter: n, embedded: n },
    languageMix: { en: n },
    comments,
    vectors,
  };
}

describe("fixture io", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "promote-fixture-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a fixture exactly", () => {
    const original = fixture(20, 32);
    const path = join(dir, "f.json.gz");

    writeFixture(path, original);

    expect(readFixture(path)).toEqual(original);
  });

  it("keeps a realistic capture small enough to commit", () => {
    // 400 comments at 1536 dimensions — a busy repo over a 120-day window.
    const path = join(dir, "big.json.gz");
    const bytes = writeFixture(path, fixture(400, 1536));

    expect(bytes).toBeLessThan(8 * 1024 * 1024);
    // And the naive form it replaces would be far larger.
    const naive = Buffer.byteLength(JSON.stringify(fixture(400, 1536), null, 2));
    expect(naive).toBeGreaterThan(bytes * 4);
  });

  it("reads a plain-JSON fixture too", () => {
    const original = fixture(5, 8);
    const path = join(dir, "plain.json");
    writeFileSync(path, JSON.stringify(original));

    expect(readFixture(path)).toEqual(original);
  });

  it("rejects a fixture from an incompatible version", () => {
    const path = join(dir, "old.json");
    writeFileSync(path, JSON.stringify({ ...fixture(2, 4), fixtureVersion: FIXTURE_VERSION + 1 }));

    expect(() => readFixture(path)).toThrow(/version/i);
  });

  it("rejects a fixture whose vectors do not line up with its comments", () => {
    const broken = fixture(5, 8);
    broken.vectors.pop();
    const path = join(dir, "corrupt.json");
    writeFileSync(path, JSON.stringify(broken));

    expect(() => readFixture(path)).toThrow(/corrupt/i);
  });

  it("writes gzip, not plain text", () => {
    const path = join(dir, "f.json.gz");
    writeFixture(path, fixture(3, 4));
    const raw = readFileSync(path);

    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);
  });
});
