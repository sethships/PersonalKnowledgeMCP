/**
 * @module graph/migration/types
 *
 * Type definitions for the Neo4j schema migration system.
 *
 * The migration system tracks schema versions in Neo4j itself using
 * SchemaVersion nodes, ensuring consistent schema state across deployments.
 */

// =============================================================================
// Migration Definition Types
// =============================================================================

/**
 * A single schema migration definition
 *
 * Migrations are immutable once deployed - never modify an existing migration.
 * Instead, create a new migration with any changes needed.
 */
export interface SchemaMigration {
  /**
   * Semantic version for this migration (e.g., "1.0.0")
   *
   * Versions are compared using semver ordering to determine
   * which migrations need to be applied.
   */
  version: string;

  /**
   * Human-readable description of what this migration does
   */
  description: string;

  /**
   * Cypher statements to execute in order
   *
   * All statements should be idempotent (safe to run multiple times)
   * using IF NOT EXISTS or similar patterns.
   */
  statements: string[];
}

/**
 * Record of an applied migration stored in Neo4j
 */
export interface AppliedMigration {
  /**
   * The version that was applied
   */
  version: string;

  /**
   * Description from the migration definition
   */
  description: string;

  /**
   * Timestamp when the migration was applied
   */
  appliedAt: Date;
}

// =============================================================================
// Migration Runner Types
// =============================================================================

/**
 * Options for running migrations
 */
export interface MigrationOptions {
  /**
   * If true, show what would be executed without actually applying
   */
  dryRun?: boolean;

  /**
   * If true, re-apply all migrations even if already applied
   *
   * Use with caution - this assumes all statements are idempotent
   */
  force?: boolean;

  /**
   * Target version to migrate to (default: latest)
   *
   * If specified, only migrations up to this version are applied
   */
  targetVersion?: string;
}

/**
 * Result of a migration run
 */
export interface MigrationResult {
  /**
   * Whether the migration run was successful
   */
  success: boolean;

  /**
   * Migrations that were applied during this run
   */
  applied: AppliedMigration[];

  /**
   * Migrations that were skipped (already applied)
   */
  skipped: string[];

  /**
   * Current schema version after migration
   */
  currentVersion: string | null;

  /**
   * Error message if migration failed
   */
  error?: string;

  /**
   * Whether this was a dry run
   */
  dryRun: boolean;
}

/**
 * Schema status information
 */
export interface SchemaStatus {
  /**
   * Current schema version (null if no migrations applied)
   */
  currentVersion: string | null;

  /**
   * Latest available migration version
   */
  latestVersion: string;

  /**
   * Number of pending migrations
   */
  pendingCount: number;

  /**
   * List of pending migration versions
   */
  pendingVersions: string[];

  /**
   * History of applied migrations (most recent first)
   */
  history: AppliedMigration[];
}

// =============================================================================
// Migration Registry Types
// =============================================================================

/**
 * Interface for registering migrations
 *
 * All migrations must be registered with the migration runner
 * before they can be applied.
 */
export interface MigrationRegistry {
  /**
   * Get all registered migrations sorted by version
   */
  getMigrations(): SchemaMigration[];

  /**
   * Get a specific migration by version
   */
  getMigration(version: string): SchemaMigration | undefined;

  /**
   * Get the latest migration version
   */
  getLatestVersion(): string;
}
