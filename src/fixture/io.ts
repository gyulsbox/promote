import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { dirname } from "node:path";
import { FIXTURE_VERSION, type EmbeddingFixture } from "./schema.js";

/**
 * Fixtures are gzipped JSON.
 *
 * A 120-day window on a busy repo is roughly 400 comments at 1536 dimensions.
 * Pretty-printed that is tens of megabytes, because JSON.stringify puts every
 * vector element on its own line; even minified it is ~6 MB. Gzip takes it to
 * a size that can sit in the repo as a shared baseline, which is the whole
 * point of capturing one.
 */
export function writeFixture(path: string, fixture: EmbeddingFixture): number {
  mkdirSync(dirname(path), { recursive: true });
  // No indent: the metadata is small and the vectors dominate entirely.
  const bytes = gzipSync(Buffer.from(JSON.stringify(fixture)), { level: 9 });
  writeFileSync(path, bytes);
  return bytes.byteLength;
}

export function readFixture(path: string): EmbeddingFixture {
  const raw = readFileSync(path);
  // Accept plain JSON too, so a hand-edited or externally produced fixture
  // still loads. 0x1f 0x8b is the gzip magic number.
  const json = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString("utf-8") : raw.toString("utf-8");
  const fixture = JSON.parse(json) as EmbeddingFixture;

  if (fixture.fixtureVersion !== FIXTURE_VERSION) {
    throw new Error(
      `Fixture ${path} is version ${fixture.fixtureVersion}, this build reads ${FIXTURE_VERSION}. Recapture it.`,
    );
  }
  if (fixture.comments.length !== fixture.vectors.length) {
    throw new Error(
      `Fixture ${path} is corrupt: ${fixture.comments.length} comments but ${fixture.vectors.length} vectors.`,
    );
  }

  return fixture;
}
