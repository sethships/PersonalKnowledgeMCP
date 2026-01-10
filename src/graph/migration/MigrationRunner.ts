/**
 * @module graph/migration/MigrationRunner
 *
 * Schema migration runner for Neo4j knowledge graph.
 *
 * This module handles applying schema migrations to Neo4j in a controlled,
 * versioned manner. Migrations are tracked using SchemaVersion nodes in
 * the database itself.
 *
 * @example
 * ```typescript
 * const runner = new MigrationRunner(neo4jClient);
 * const result = await runner.migrate({ dryRun: false });
 * console.log(`Applied ${result.applied.length} migrations`);
 * ```
 */

import { compare as semverCompare } from "semver";
import { getComponentLogger } from "../../logging/index.js";
import { GraphSchemaError } from "../errors.js";
import type { Neo4jStorageClient } from "../types.js";
import type {
  AppliedMigration,
  MigrationOptions,
  MigrationRegistry,
  MigrationResult,
  SchemaStatus,
  SchemaMigration,
} from "./types.js";

// =============================================================================
// Logger Setup
// =============================================================================

type Logger = ReturnType<typeof getComponentLogger>;
let logger: Logger | null = null;

function getLogger(): Logger {
  if (!logger) {
    logger = getComponentLogger("graph:migration");
  }
  return logger;
}

// =============================================================================
// Default Migration Registry
// =============================================================================

/**
 * Simple migration registry implementation
 *
 * Stores migrations in memory and provides access in version order.
 */
class DefaultMigrationRegistry implements MigrationRegistry {
  private migrations: SchemaMigration[] = [];

  /**
   * Register a migration
   *
   * @param migration - Migration to register
   */
  register(migration: SchemaMigration): void {
    // Validate version format
    if (!/^\d+\.\d+\.\d+$/.test(migration.version)) {
      throw new GraphSchemaError(
        `Invalid migration version format: ${migration.version}. Expected semver (e.g., "1.0.0")`,
        migration.version
      );
    }

    // Check for duplicate versions
    if (this.migrations.some((m) => m.version === migration.version)) {
      throw new GraphSchemaError(
        `Duplicate migration version: ${migration.version}`,
        migration.version
      );
    }

    this.migrations.push(migration);
    // Keep sorted by version
    this.migrations.sort((a, b) => semverCompare(a.version, b.version));
  }

  getMigrations(): SchemaMigration[] {
    return [...this.migrations];
  }

  getMigration(version: string): SchemaMigration | undefined {
    return this.migrations.find((m) => m.version === version);
  }

  getLatestVersion(): string {
    if (this.migrations.length === 0) {
      return "0.0.0";
    }
    const lastMigration = this.migrations[this.migrations.length - 1];
    return lastMigration ? lastMigration.version : "0.0.0";
  }
}

// =============================================================================
// Migration Runner
// =============================================================================

/**
 * Manages Neo4j schema migrations
 *
 * Tracks applied migrations using SchemaVersion nodes in Neo4j.
 * All migrations should be idempotent using IF NOT EXISTS patterns.
 */
export class MigrationRunner {
  private readonly client: Neo4jStorageClient;
  private readonly registry: DefaultMigrationRegistry;

  constructor(client: Neo4jStorageClient) {
    this.client = client;
    this.registry = new DefaultMigrationRegistry();
  }

  /**
   * Register a migration to be managed by this runner
   *
   * @param migration - Migration definition to register
   */
  registerMigration(migration: SchemaMigration): void {
    this.registry.register(migration);
    getLogger().debug({ version: migration.version }, "Migration registered");
  }

  /**
   * Get the registry for direct access to migrations
   */
  getRegistry(): MigrationRegistry {
    return this.registry;
  }

  /**
   * Get current schema status
   *
   * @returns Schema status including current version and pending migrations
   */
  async getStatus(): Promise<SchemaStatus> {
    const history = await this.getAppliedMigrations();
    const firstHistory = history[0];
    const currentVersion = firstHistory ? firstHistory.version : null;
    const allMigrations = this.registry.getMigrations();
    const latestVersion = this.registry.getLatestVersion();

    // Find pending migrations
    const pendingVersions = allMigrations
      .filter((m) => !currentVersion || semverCompare(m.version, currentVersion) > 0)
      .map((m) => m.version);

    return {
      currentVersion,
      latestVersion,
      pendingCount: pendingVersions.length,
      pendingVersions,
      history,
    };
  }

  /**
   * Apply pending migrations
   *
   * @param options - Migration options
   * @returns Result of the migration run
   */
  async migrate(options: MigrationOptions = {}): Promise<MigrationResult> {
    const { dryRun = false, force = false, targetVersion } = options;
    const log = getLogger();

    log.info({ dryRun, force, targetVersion }, "Starting migration run");

    try {
      const appliedVersions = force ? new Set<string>() : await this.getAppliedVersionSet();
      const allMigrations = this.registry.getMigrations();

      // Filter migrations to apply
      const migrationsToApply = allMigrations.filter((m) => {
        // Skip already applied unless forcing
        if (appliedVersions.has(m.version)) {
          return false;
        }
        // Filter by target version if specified
        if (targetVersion && semverCompare(m.version, targetVersion) > 0) {
          return false;
        }
        return true;
      });

      // Build lists
      const skipped = allMigrations
        .filter((m) => appliedVersions.has(m.version))
        .map((m) => m.version);

      if (migrationsToApply.length === 0) {
        log.info("No migrations to apply");
        const currentVersion = await this.getCurrentVersion();
        return {
          success: true,
          applied: [],
          skipped,
          currentVersion,
          dryRun,
        };
      }

      log.info(
        { count: migrationsToApply.length, versions: migrationsToApply.map((m) => m.version) },
        "Migrations to apply"
      );

      if (dryRun) {
        // For dry run, just return what would be applied
        const lastMigrationToApply = migrationsToApply[migrationsToApply.length - 1];
        return {
          success: true,
          applied: migrationsToApply.map((m) => ({
            version: m.version,
            description: m.description,
            appliedAt: new Date(),
          })),
          skipped,
          currentVersion: lastMigrationToApply ? lastMigrationToApply.version : null,
          dryRun: true,
        };
      }

      // Apply migrations in order
      const applied: AppliedMigration[] = [];

      for (const migration of migrationsToApply) {
        log.info({ version: migration.version }, "Applying migration");

        await this.applyMigration(migration);

        applied.push({
          version: migration.version,
          description: migration.description,
          appliedAt: new Date(),
        });

        log.info({ version: migration.version }, "Migration applied successfully");
      }

      const lastApplied = applied[applied.length - 1];
      const currentVersion = lastApplied ? lastApplied.version : null;

      return {
        success: true,
        applied,
        skipped,
        currentVersion,
        dryRun: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ err: error }, "Migration failed");

      return {
        success: false,
        applied: [],
        skipped: [],
        currentVersion: await this.getCurrentVersion(),
        error: errorMessage,
        dryRun,
      };
    }
  }

  /**
   * Apply a single migration
   *
   * @param migration - Migration to apply
   */
  private async applyMigration(migration: SchemaMigration): Promise<void> {
    const log = getLogger();

    // Execute each statement in the migration
    for (let i = 0; i < migration.statements.length; i++) {
      const statement = migration.statements[i];
      if (!statement) {
        continue;
      }
      log.debug({ version: migration.version, statementIndex: i }, "Executing statement");

      try {
        await this.client.runQuery(statement);
      } catch (error) {
        throw new GraphSchemaError(
          `Failed to execute migration ${migration.version} statement ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
          migration.version,
          error instanceof Error ? error : undefined
        );
      }
    }

    // Record the migration as applied
    await this.recordMigration(migration);
  }

  /**
   * Record a migration as applied in Neo4j
   *
   * @param migration - Migration that was applied
   */
  private async recordMigration(migration: SchemaMigration): Promise<void> {
    const cypher = `
      MERGE (s:SchemaVersion {version: $version})
      SET s.description = $description,
          s.appliedAt = datetime()
    `;

    await this.client.runQuery(cypher, {
      version: migration.version,
      description: migration.description,
    });
  }

  /**
   * Get the current schema version
   *
   * @returns Current version or null if no migrations applied
   */
  private async getCurrentVersion(): Promise<string | null> {
    const cypher = `
      MATCH (s:SchemaVersion)
      RETURN s.version AS version
      ORDER BY s.version DESC
      LIMIT 1
    `;

    const results = await this.client.runQuery<{ version: string }>(cypher);
    const firstResult = results[0];
    return firstResult ? firstResult.version : null;
  }

  /**
   * Get all applied migrations
   *
   * @returns List of applied migrations, most recent first
   */
  private async getAppliedMigrations(): Promise<AppliedMigration[]> {
    const cypher = `
      MATCH (s:SchemaVersion)
      RETURN s.version AS version, s.description AS description, s.appliedAt AS appliedAt
      ORDER BY s.version DESC
    `;

    const results = await this.client.runQuery<{
      version: string;
      description: string;
      appliedAt: Date | string;
    }>(cypher);

    return results.map((r) => ({
      version: r.version,
      description: r.description,
      appliedAt: r.appliedAt instanceof Date ? r.appliedAt : new Date(r.appliedAt),
    }));
  }

  /**
   * Get set of applied version strings for quick lookup
   *
   * @returns Set of applied version strings
   */
  private async getAppliedVersionSet(): Promise<Set<string>> {
    const applied = await this.getAppliedMigrations();
    return new Set(applied.map((m) => m.version));
  }
}
