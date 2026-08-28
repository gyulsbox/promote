/**
 * Cross-scan cluster identity.
 *
 * `snooze` / `ignore` / "already promoted" all assume that the same repeated
 * pattern keeps the same candidate ID from one scan to the next. Until v0.8.0
 * that continuity was carried by `Cluster.fingerprint`, which hashes the
 * *medoid* comment's body (see `hac-cluster.ts:generateFingerprint`). The
 * medoid moves as soon as a cluster gains a member, so a growing pattern —
 * exactly the pattern worth promoting — silently changed its fingerprint,
 * missed the lookup, and was re-issued as a brand new candidate. The user's
 * decision from last week vanished.
 *
 * Member comment IDs are the stable thing here: GitHub assigns them, they
 * never change, and a cluster that grows keeps every member it already had.
 * So identity is resolved by member-set overlap, with the old fingerprint
 * kept as a fast exact-match path.
 *
 * Overlap is measured as *containment* — |A ∩ B| / min(|A|, |B|) — not
 * Jaccard. Growth is the normal case (3 members in week 1, 30 by week 6) and
 * Jaccard collapses to 0.1 there, which is precisely when continuity matters
 * most. Containment stays 1.0. Splits are handled by the greedy one-to-one
 * assignment below rather than by the metric.
 *
 * Deliberately independent of embeddings: keying identity on vectors would
 * break every candidate ID the moment the embedding model is swapped.
 */

export type PriorCluster = {
  /** Cluster row ID from a previous scan. */
  clusterId: string;
  /** Candidate ID issued for that cluster — the thing we want to preserve. */
  candidateId: string;
  status: string;
  fingerprint: string;
  memberIds: string[];
};

export type ClusterIdentityInput = {
  /** Caller-supplied handle for this scan's cluster; opaque here. */
  key: string;
  fingerprint: string;
  memberIds: string[];
};

export type IdentityResolution = {
  key: string;
  prior: PriorCluster | null;
  matchedBy: "fingerprint" | "overlap" | null;
  overlap: number;
};

/**
 * Minimum containment for two member sets to count as the same pattern.
 * 0.5 means "more than half of the smaller set is shared". Lower values start
 * merging distinct-but-adjacent conventions; higher values lose continuity
 * whenever a cluster sheds members as they age out of the scan window.
 */
export const DEFAULT_MIN_OVERLAP = 0.5;

/** |A ∩ B| / min(|A|, |B|). Returns 0 when either side is empty. */
export function containment(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let shared = 0;
  const seen = new Set<string>();
  for (const id of b) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (setA.has(id)) shared++;
  }
  return shared / Math.min(setA.size, seen.size);
}

/**
 * Match this scan's clusters against clusters seen in previous scans.
 *
 * Every input cluster gets an entry in the returned map; `prior` is null when
 * the cluster is genuinely new. Each prior is claimed by at most one cluster,
 * so a split cluster inherits the ID on exactly one side and the other side
 * is issued a fresh one.
 *
 * Fully deterministic: fingerprint matches are resolved first, then remaining
 * pairs are sorted by (overlap desc, candidateId asc, key asc) and assigned
 * greedily. No dependence on input ordering or Map insertion order.
 */
export function resolveClusterIdentities(
  clusters: readonly ClusterIdentityInput[],
  priors: readonly PriorCluster[],
  opts: { minOverlap?: number } = {},
): Map<string, IdentityResolution> {
  const minOverlap = opts.minOverlap ?? DEFAULT_MIN_OVERLAP;

  const resolutions = new Map<string, IdentityResolution>();
  for (const c of clusters) {
    resolutions.set(c.key, { key: c.key, prior: null, matchedBy: null, overlap: 0 });
  }

  const claimedPriors = new Set<string>();

  // Pass 1 — exact fingerprint match. Unchanged medoid, unchanged identity.
  // Sorted so that a duplicate fingerprint across two priors resolves the same
  // way on every run.
  const priorsByFingerprint = new Map<string, PriorCluster[]>();
  for (const p of priors) {
    const bucket = priorsByFingerprint.get(p.fingerprint);
    if (bucket) bucket.push(p);
    else priorsByFingerprint.set(p.fingerprint, [p]);
  }
  for (const bucket of priorsByFingerprint.values()) {
    bucket.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  }

  for (const c of [...clusters].sort((a, b) => a.key.localeCompare(b.key))) {
    const bucket = priorsByFingerprint.get(c.fingerprint);
    if (!bucket) continue;
    const prior = bucket.find((p) => !claimedPriors.has(p.clusterId));
    if (!prior) continue;
    claimedPriors.add(prior.clusterId);
    resolutions.set(c.key, {
      key: c.key,
      prior,
      matchedBy: "fingerprint",
      overlap: containment(c.memberIds, prior.memberIds),
    });
  }

  // Pass 2 — member-set overlap for everything the fingerprint missed.
  type Pair = { key: string; prior: PriorCluster; overlap: number };
  const pairs: Pair[] = [];
  for (const c of clusters) {
    if (resolutions.get(c.key)!.prior) continue;
    for (const p of priors) {
      if (claimedPriors.has(p.clusterId)) continue;
      const overlap = containment(c.memberIds, p.memberIds);
      if (overlap >= minOverlap) pairs.push({ key: c.key, prior: p, overlap });
    }
  }

  pairs.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      a.prior.candidateId.localeCompare(b.prior.candidateId) ||
      a.key.localeCompare(b.key),
  );

  const claimedClusters = new Set<string>();
  for (const pair of pairs) {
    if (claimedClusters.has(pair.key)) continue;
    if (claimedPriors.has(pair.prior.clusterId)) continue;
    claimedClusters.add(pair.key);
    claimedPriors.add(pair.prior.clusterId);
    resolutions.set(pair.key, {
      key: pair.key,
      prior: pair.prior,
      matchedBy: "overlap",
      overlap: pair.overlap,
    });
  }

  return resolutions;
}
