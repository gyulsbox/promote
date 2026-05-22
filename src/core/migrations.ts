/**
 * Config schema migrations. Runs BEFORE zod validation so the raw parsed YAML
 * can be transformed into the current schema shape regardless of how old it is.
 *
 * Each migration handles a single version bump (v1 → v2 → v3 …). Renames,
 * removed keys, or restructured shapes go here. Pure-additive changes (new
 * optional keys with zod defaults) do NOT need a migration entry — they just
 * land via schema defaults when the old config is reparsed.
 */

export const CURRENT_CONFIG_VERSION = 2;

type RawConfig = Record<string, unknown> & { version?: number };

type Migration = {
  from: number;
  to: number;
  apply: (cfg: RawConfig) => RawConfig;
};

const migrations: Migration[] = [
  {
    from: 1,
    to: 2,
    apply: (cfg) => {
      // v1 → v2: version bookmark for the v0.2/v0.3/v0.4 feature blocks
      // (clusteringModel, firstRejectExcerpt rename in DB only, scope label,
      //  general PR comment matching). All config-level additions are optional
      //  with schema defaults, so no key restructuring is needed here.
      return { ...cfg, version: 2 };
    },
  },
];

export type MigrationResult = {
  config: RawConfig;
  /** Original version before migration, or undefined if the config didn't carry one */
  fromVersion: number | undefined;
  /** True iff at least one migration ran */
  migrated: boolean;
};

export function migrateConfig(rawConfig: RawConfig): MigrationResult {
  const fromVersion = typeof rawConfig.version === "number" ? rawConfig.version : undefined;
  let cfg = rawConfig;
  let migrated = false;

  while (
    typeof cfg.version === "number" &&
    cfg.version < CURRENT_CONFIG_VERSION
  ) {
    const m = migrations.find((entry) => entry.from === cfg.version);
    if (!m) {
      // No registered migration from this version — best-effort bump and stop
      cfg = { ...cfg, version: CURRENT_CONFIG_VERSION };
      migrated = true;
      break;
    }
    cfg = m.apply(cfg);
    migrated = true;
  }

  return { config: cfg, fromVersion, migrated };
}
