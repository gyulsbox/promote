# ADR-001: Namespaced CLI Entry Points in @trpc/* Packages

## Status
Proposed

## Context
The @trpc monorepo contains multiple packages that may expose CLI tools via the `bin` field in package.json. Using generic binary names (e.g., `intent`, `server`) creates collisions in `node_modules/.bin/` when users install multiple @trpc packages, causing installation failures and shadowing real system binaries. This architectural decision establishes a pattern for all current and future CLI entry points across the monorepo.

## Decision
All @trpc packages that expose CLI tools must use namespaced binary names in the format `trpc-<tool-name>` (e.g., `trpc-intent`, `trpc-server`) rather than generic names. Alternatively, packages should avoid re-exporting CLI entry points entirely if the functionality is better served through a dedicated CLI package. Each bin entry must reference an actual file that exists in the package at publish time.

## Consequences
- Eliminates `node_modules/.bin/` collisions across @trpc packages
- Prevents shadowing of real system binaries and tools
- Ensures consistent naming convention across the monorepo
- Requires validation that all bin references point to existing files before publishing
- Improves discoverability by making CLI tools clearly associated with the @trpc namespace
- May require documentation updates to guide users on the new binary naming scheme
- Future package additions must follow this pattern during code review
