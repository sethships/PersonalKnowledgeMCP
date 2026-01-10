/**
 * @module graph/migration
 *
 * Neo4j schema migration system.
 *
 * This module provides tools for managing Neo4j schema versions
 * including constraints, indexes, and their migrations.
 *
 * @example
 * ```typescript
 * import { MigrationRunner, registerAllMigrations } from "./migration/index.js";
 *
 * const runner = new MigrationRunner(neo4jClient);
 * registerAllMigrations(runner);
 *
 * const status = await runner.getStatus();
 * console.log(`Current version: ${status.currentVersion}`);
 *
 * if (status.pendingCount > 0) {
 *   const result = await runner.migrate();
 *   console.log(`Applied ${result.applied.length} migrations`);
 * }
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type {
  SchemaMigration,
  AppliedMigration,
  MigrationOptions,
  MigrationResult,
  SchemaStatus,
  MigrationRegistry,
} from "./types.js";

// =============================================================================
// Migration Runner
// =============================================================================

export { MigrationRunner } from "./MigrationRunner.js";

// =============================================================================
// Migrations
// =============================================================================

import { migration0001 } from "./migrations/0001-initial-schema.js";
import type { MigrationRunner } from "./MigrationRunner.js";

/**
 * All available migrations in version order
 */
export const ALL_MIGRATIONS = [migration0001] as const;

/**
 * Register all migrations with a runner
 *
 * This is a convenience function that registers all known migrations.
 * Call this before running migrations.
 *
 * @param runner - Migration runner to register migrations with
 *
 * @example
 * ```typescript
 * const runner = new MigrationRunner(client);
 * registerAllMigrations(runner);
 * await runner.migrate();
 * ```
 */
export function registerAllMigrations(runner: MigrationRunner): void {
  for (const migration of ALL_MIGRATIONS) {
    runner.registerMigration(migration);
  }
}
