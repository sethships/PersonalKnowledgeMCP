/**
 * Unit tests for migration definitions
 *
 * Tests the individual migration files and their structure.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  ALL_MIGRATIONS,
  registerAllMigrations,
  MigrationRunner,
} from "../../../../src/graph/migration/index.js";
import { migration0001 } from "../../../../src/graph/migration/migrations/0001-initial-schema.js";
import { getAllSchemaStatements } from "../../../../src/graph/schema.js";
import type { Neo4jStorageClient } from "../../../../src/graph/types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Initialize logger for tests
beforeEach(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterEach(() => {
  resetLogger();
});

/**
 * Create a minimal mock client for registration testing
 */
function createMinimalMockClient(): Neo4jStorageClient {
  return {
    runQuery: async <T>(): Promise<T[]> => [] as T[],
    connect: async () => {},
    disconnect: async () => {},
    healthCheck: async () => true,
    upsertNode: async () => ({}) as never,
    deleteNode: async () => true,
    createRelationship: async () => ({}) as never,
    deleteRelationship: async () => true,
    traverse: async () => ({ nodes: [], relationships: [], paths: [], metadata: {} }) as never,
    analyzeDependencies: async () => ({}) as never,
    getContext: async () => ({ context: [], metadata: {} }) as never,
  } as Neo4jStorageClient;
}

describe("Migration 0001: Initial Schema", () => {
  test("should have version 1.0.0", () => {
    expect(migration0001.version).toBe("1.0.0");
  });

  test("should have a description", () => {
    expect(migration0001.description).toBeDefined();
    expect(migration0001.description.length).toBeGreaterThan(0);
    expect(migration0001.description).toContain("Initial");
  });

  test("should include all schema statements", () => {
    const expectedStatements = getAllSchemaStatements();
    expect(migration0001.statements).toEqual(expectedStatements);
    expect(migration0001.statements.length).toBeGreaterThan(0);
  });

  test("should have idempotent statements (IF NOT EXISTS)", () => {
    for (const statement of migration0001.statements) {
      expect(statement).toContain("IF NOT EXISTS");
    }
  });

  test("should include constraint statements", () => {
    const constraintStatements = migration0001.statements.filter((s) =>
      s.startsWith("CREATE CONSTRAINT")
    );
    expect(constraintStatements.length).toBeGreaterThan(0);
  });

  test("should include index statements", () => {
    const indexStatements = migration0001.statements.filter(
      (s) => s.startsWith("CREATE INDEX") && !s.includes("FULLTEXT")
    );
    expect(indexStatements.length).toBeGreaterThan(0);
  });

  test("should include fulltext index statements", () => {
    const fulltextStatements = migration0001.statements.filter((s) =>
      s.startsWith("CREATE FULLTEXT INDEX")
    );
    expect(fulltextStatements.length).toBeGreaterThan(0);
  });
});

describe("ALL_MIGRATIONS", () => {
  test("should export array of migrations", () => {
    expect(Array.isArray(ALL_MIGRATIONS)).toBe(true);
    expect(ALL_MIGRATIONS.length).toBeGreaterThan(0);
  });

  test("should include migration 0001", () => {
    const m0001 = ALL_MIGRATIONS.find((m) => m.version === "1.0.0");
    expect(m0001).toBeDefined();
    expect(m0001).toBe(migration0001);
  });

  test("should have migrations in version order", () => {
    const versions = ALL_MIGRATIONS.map((m) => m.version);
    const sortedVersions = [...versions].sort((a, b) => {
      const [aMajor = 0, aMinor = 0, aPatch = 0] = a.split(".").map(Number);
      const [bMajor = 0, bMinor = 0, bPatch = 0] = b.split(".").map(Number);

      if (aMajor !== bMajor) return aMajor - bMajor;
      if (aMinor !== bMinor) return aMinor - bMinor;
      return aPatch - bPatch;
    });

    expect(versions).toEqual(sortedVersions);
  });

  test("should have unique versions", () => {
    const versions = ALL_MIGRATIONS.map((m) => m.version);
    const uniqueVersions = new Set(versions);
    expect(uniqueVersions.size).toBe(versions.length);
  });

  test("all migrations should have valid semver format", () => {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    for (const migration of ALL_MIGRATIONS) {
      expect(migration.version).toMatch(semverRegex);
    }
  });

  test("all migrations should have non-empty description", () => {
    for (const migration of ALL_MIGRATIONS) {
      expect(migration.description).toBeDefined();
      expect(migration.description.length).toBeGreaterThan(0);
    }
  });

  test("all migrations should have at least one statement", () => {
    for (const migration of ALL_MIGRATIONS) {
      expect(Array.isArray(migration.statements)).toBe(true);
      expect(migration.statements.length).toBeGreaterThan(0);
    }
  });
});

describe("registerAllMigrations", () => {
  test("should register all migrations to runner", () => {
    const client = createMinimalMockClient();
    const runner = new MigrationRunner(client);

    registerAllMigrations(runner);

    const registry = runner.getRegistry();
    expect(registry.getMigrations().length).toBe(ALL_MIGRATIONS.length);
  });

  test("should register migrations in correct order", () => {
    const client = createMinimalMockClient();
    const runner = new MigrationRunner(client);

    registerAllMigrations(runner);

    const registry = runner.getRegistry();
    const registeredMigrations = registry.getMigrations();

    for (let i = 0; i < ALL_MIGRATIONS.length; i++) {
      expect(registeredMigrations[i]?.version).toBe(ALL_MIGRATIONS[i]?.version);
    }
  });

  test("should make all migrations accessible via registry", () => {
    const client = createMinimalMockClient();
    const runner = new MigrationRunner(client);

    registerAllMigrations(runner);

    const registry = runner.getRegistry();

    for (const migration of ALL_MIGRATIONS) {
      const registered = registry.getMigration(migration.version);
      expect(registered).toBeDefined();
      expect(registered?.description).toBe(migration.description);
    }
  });

  test("should set latest version in registry", () => {
    const client = createMinimalMockClient();
    const runner = new MigrationRunner(client);

    registerAllMigrations(runner);

    const registry = runner.getRegistry();
    const lastMigration = ALL_MIGRATIONS[ALL_MIGRATIONS.length - 1];

    expect(lastMigration).toBeDefined();
    expect(registry.getLatestVersion()).toBe(lastMigration!.version);
  });
});

describe("Migration Idempotency", () => {
  test("all migration statements should be idempotent", () => {
    for (const migration of ALL_MIGRATIONS) {
      for (const statement of migration.statements) {
        // All schema operations should use IF NOT EXISTS
        expect(statement).toContain("IF NOT EXISTS");
      }
    }
  });

  test("migrations can be safely re-registered", () => {
    const client = createMinimalMockClient();
    const runner = new MigrationRunner(client);

    // First registration
    registerAllMigrations(runner);
    const firstCount = runner.getRegistry().getMigrations().length;

    // Create a new runner (simulating fresh start)
    const runner2 = new MigrationRunner(client);
    registerAllMigrations(runner2);
    const secondCount = runner2.getRegistry().getMigrations().length;

    expect(firstCount).toBe(secondCount);
  });
});

describe("Migration Exports", () => {
  test("should export MigrationRunner class", () => {
    expect(MigrationRunner).toBeDefined();
    expect(typeof MigrationRunner).toBe("function");
  });

  test("should export registerAllMigrations function", () => {
    expect(registerAllMigrations).toBeDefined();
    expect(typeof registerAllMigrations).toBe("function");
  });

  test("should export ALL_MIGRATIONS array", () => {
    expect(ALL_MIGRATIONS).toBeDefined();
    expect(Array.isArray(ALL_MIGRATIONS)).toBe(true);
  });
});
