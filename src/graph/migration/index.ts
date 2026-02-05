/**
 * @module graph/migration
 *
 * Graph database schema migration system.
 *
 * This module provides tools for managing graph database schema versions
 * including constraints, indexes, and their migrations. Supports both
 * Neo4j and FalkorDB adapters with appropriate Cypher syntax.
 *
 * @example
 * ```typescript
 * import { MigrationRunner, registerAllMigrations } from "./migration/index.js";
 *
 * const runner = new MigrationRunner(graphAdapter);
 * registerAllMigrations(runner, "falkordb"); // Use adapter-specific schema
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

import { migration0001, createMigration0001 } from "./migrations/0001-initial-schema.js";
import type { MigrationRunner } from "./MigrationRunner.js";
import type { GraphAdapterType } from "../adapters/types.js";
import type { SchemaMigration } from "./types.js";

/**
 * All available migrations in version order (legacy - Neo4j syntax)
 *
 * @deprecated Use registerAllMigrations(runner, adapter) for adapter-aware migrations
 */
export const ALL_MIGRATIONS = [migration0001] as const;

/**
 * Create adapter-aware migrations
 *
 * @param adapter - Graph database adapter type
 * @returns Array of migrations with adapter-appropriate Cypher syntax
 */
export function createAllMigrations(adapter: GraphAdapterType): readonly SchemaMigration[] {
  return [createMigration0001(adapter)] as const;
}

/**
 * Register all migrations with a runner
 *
 * This is a convenience function that registers all known migrations
 * with adapter-appropriate Cypher syntax.
 *
 * @param runner - Migration runner to register migrations with
 * @param adapter - Graph database adapter type (default: "neo4j" for backward compatibility)
 *
 * @example
 * ```typescript
 * const runner = new MigrationRunner(client);
 * registerAllMigrations(runner, "falkordb"); // FalkorDB-compatible syntax
 * await runner.migrate();
 * ```
 */
export function registerAllMigrations(
  runner: MigrationRunner,
  adapter: GraphAdapterType = "neo4j"
): void {
  const migrations = createAllMigrations(adapter);
  for (const migration of migrations) {
    runner.registerMigration(migration);
  }
}
