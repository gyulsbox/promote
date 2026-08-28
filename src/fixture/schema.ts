import type { NormalizedComment } from "../core/types.js";

export const FIXTURE_VERSION = 1;

/**
 * A Phase 0 baseline capture.
 *
 * The point of storing raw `vectors` rather than only the resulting clusters:
 * every question Phase 1 has to answer - does a local model group these the
 * same way, what similarity threshold does it want, is `llmRefine` still
 * earning its cost - is a re-clustering of the same inputs. Kept as vectors,
 * all of that runs offline for free and reruns in under a second. Kept as
 * cluster output only, each sweep point would be another paid scan, which is
 * why the threshold was never swept in the first place.
 *
 * `comments` is stored alongside because clustering also reads identifiers and
 * paths (see cluster/similarity.ts), not just the vector.
 */
export type EmbeddingFixture = {
  fixtureVersion: number;
  capturedAt: string;
  repo: string;
  sinceDays: number;
  /** Provider/model the vectors came from, e.g. "openai:text-embedding-3-small". */
  embeddingModel: string;
  promoteVersion: string;
  counts: {
    fetched: number;
    aiAuthored: number;
    afterNoiseFilter: number;
    embedded: number;
  };
  /** Per-comment language mix, from normalize/identifier-extractor. */
  languageMix: Record<string, number>;
  comments: NormalizedComment[];
  /** Parallel to `comments`. Float arrays, rounded to keep the file readable. */
  vectors: number[][];
};

export type ClusterSnapshot = {
  fingerprint: string;
  representativeId: string;
  memberIds: string[];
};

/** Result of clustering a fixture at one threshold. */
export type SweepPoint = {
  threshold: number;
  clusters: number;
  /** Clusters with at least `minOccurrences` members - the promotable ones. */
  repeatedClusters: number;
  largestCluster: number;
  singletons: number;
  snapshot: ClusterSnapshot[];
};
