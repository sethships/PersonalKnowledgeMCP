/**
 * Unit tests for MigrationRunner
 *
 * Tests migration registration, status retrieval, and migration execution
 * with mocked Neo4j client.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MigrationRunner } from "../../../../src/graph/migration/MigrationRunner.js";
import { GraphSchemaError } from "../../../../src/graph/errors.js";
import type { SchemaMigration } from "../../../../src/graph/migration/types.js";
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
 * Create a mock Neo4j client for testing
 */
function createMockClient(
  options: {
    appliedVersions?: string[];
    queryResults?: Map<string, unknown[]>;
    shouldFail?: boolean;
    failError?: Error;
  } = {}
): Neo4jStorageClient {
  const {
    appliedVersions = [],
    queryResults = new Map(),
    shouldFail = false,
    failError = new Error("Mock query failed"),
  } = options;

  return {
    runQuery: async <T>(cypher: string, _params?: Record<string, unknown>): Promise<T[]> => {
      if (shouldFail) {
        throw failError;
      }

      // Return applied migrations for SchemaVersion queries
      if (cypher.includes("SchemaVersion") && cypher.includes("MATCH")) {
        if (cypher.includes("ORDER BY") && cypher.includes("LIMIT 1")) {
          // getCurrentVersion query
          const lastVersion = appliedVersions[appliedVersions.length - 1];
          if (lastVersion) {
            return [{ version: lastVersion }] as T[];
          }
          return [] as T[];
        }
        // getAppliedMigrations query - return in DESC order (newest first)
        const sortedVersions = [...appliedVersions].sort((a, b) => {
          const [aMajor = 0, aMinor = 0, aPatch = 0] = a.split(".").map(Number);
          const [bMajor = 0, bMinor = 0, bPatch = 0] = b.split(".").map(Number);
          if (bMajor !== aMajor) return bMajor - aMajor;
          if (bMinor !== aMinor) return bMinor - aMinor;
          return bPatch - aPatch;
        });
        return sortedVersions.map((v) => ({
          version: v,
          description: `Migration ${v}`,
          appliedAt: new Date().toISOString(),
        })) as T[];
      }

      // Check for custom query results
      for (const [pattern, result] of queryResults.entries()) {
        if (cypher.includes(pattern)) {
          return result as T[];
        }
      }

      return [] as T[];
    },
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

/**
 * Sample migrations for testing
 */
const sampleMigrations: SchemaMigration[] = [
  {
    version: "1.0.0",
    description: "Initial schema",
    statements: ["CREATE CONSTRAINT test IF NOT EXISTS FOR (n:Test) REQUIRE n.id IS UNIQUE"],
  },
  {
    version: "1.1.0",
    description: "Add index",
    statements: ["CREATE INDEX test_name IF NOT EXISTS FOR (n:Test) ON (n.name)"],
  },
  {
    version: "2.0.0",
    description: "Major update",
    statements: [
      "CREATE CONSTRAINT test2 IF NOT EXISTS FOR (n:Test2) REQUIRE n.id IS UNIQUE",
      "CREATE INDEX test2_name IF NOT EXISTS FOR (n:Test2) ON (n.name)",
    ],
  },
];

describe("MigrationRunner", () => {
  describe("constructor", () => {
    test("should create instance with client", () => {
      const client = createMockClient();
      const runner = new MigrationRunner(client);
      expect(runner).toBeInstanceOf(MigrationRunner);
    });
  });

  describe("registerMigration", () => {
    test("should register a valid migration", () => {
      const client = createMockClient();
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);

      const registry = runner.getRegistry();
      expect(registry.getMigrations()).toHaveLength(1);
      expect(registry.getMigration("1.0.0")).toBeDefined();
    });

    test("should register multiple migrations in version order", () => {
      const client = createMockClient();
      const runner = new MigrationRunner(client);

      // Register out of order
      runner.registerMigration(sampleMigrations[2]!);
      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      const registry = runner.getRegistry();
      const migrations = registry.getMigrations();

      expect(migrations).toHaveLength(3);
      expect(migrations[0]?.version).toBe("1.0.0");
      expect(migrations[1]?.version).toBe("1.1.0");
      expect(migrations[2]?.version).toBe("2.0.0");
    });

    test("should throw on invalid version format", () => {
      const client = createMockClient();
      const runner = new MigrationRunner(client);

      const invalidMigration: SchemaMigration = {
        version: "v1.0",
        description: "Invalid",
        statements: [],
      };

      expect(() => runner.registerMigration(invalidMigration)).toThrow(GraphSchemaError);
      expect(() => runner.registerMigration(invalidMigration)).toThrow(
        /Invalid migration version format/
      );
    });

    test("should throw on duplicate version", () => {
      const client = createMockClient();
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);

      const duplicateMigration: SchemaMigration = {
        version: "1.0.0",
        description: "Duplicate",
        statements: [],
      };

      expect(() => runner.registerMigration(duplicateMigration)).toThrow(GraphSchemaError);
      expect(() => runner.registerMigration(duplicateMigration)).toThrow(
        /Duplicate migration version/
      );
    });

    test("should reject invalid version formats", () => {
      const client = createMockClient();
      const runner = new MigrationRunner(client);

      const invalidVersions = [
        "1.0", // Missing patch
        "1", // Missing minor and patch
        "1.0.0.0", // Extra segment
        "v1.0.0", // Prefix
        "1.0.0-beta", // Pre-release
        "abc", // Non-numeric
      ];

      for (const version of invalidVersions) {
        const migration: SchemaMigration = {
          version,
          description: "Test",
          statements: [],
        };

        expect(() => runner.registerMigration(migration)).toThrow(GraphSchemaError);
      }
    });
  });

  describe("getRegistry", () => {
    test("should return registry with registered migrations", () => {
      const client = createMockClient();
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      const registry = runner.getRegistry();

      expect(registry.getMigrations()).toHaveLength(2);
      expect(registry.getLatestVersion()).toBe("1.1.0");
    });

    test("should return empty registry when no migrations registered", () => {
      const client = createMockClient();
      const runner = new MigrationRunner(client);

      const registry = runner.getRegistry();

      expect(registry.getMigrations()).toHaveLength(0);
      expect(registry.getLatestVersion()).toBe("0.0.0");
    });
  });

  describe("getStatus", () => {
    test("should return status with no applied migrations", async () => {
      const client = createMockClient({ appliedVersions: [] });
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      const status = await runner.getStatus();

      expect(status.currentVersion).toBeNull();
      expect(status.latestVersion).toBe("1.1.0");
      expect(status.pendingCount).toBe(2);
      expect(status.pendingVersions).toEqual(["1.0.0", "1.1.0"]);
      expect(status.history).toHaveLength(0);
    });

    test("should return status with some applied migrations", async () => {
      const client = createMockClient({ appliedVersions: ["1.0.0"] });
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);
      runner.registerMigration(sampleMigrations[2]!);

      const status = await runner.getStatus();

      expect(status.currentVersion).toBe("1.0.0");
      expect(status.latestVersion).toBe("2.0.0");
      expect(status.pendingCount).toBe(2);
      expect(status.pendingVersions).toEqual(["1.1.0", "2.0.0"]);
    });

    test("should return status when fully up to date", async () => {
      const client = createMockClient({ appliedVersions: ["1.0.0", "1.1.0"] });
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      const status = await runner.getStatus();

      expect(status.currentVersion).toBe("1.1.0"); // First in DESC order (highest version)
      expect(status.latestVersion).toBe("1.1.0");
      expect(status.pendingCount).toBe(0);
      expect(status.pendingVersions).toEqual([]);
    });
  });

  describe("migrate", () => {
    test("should apply pending migrations", async () => {
      const client = createMockClient({ appliedVersions: [] });
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      const result = await runner.migrate();

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(2);
      expect(result.applied[0]?.version).toBe("1.0.0");
      expect(result.applied[1]?.version).toBe("1.1.0");
      expect(result.skipped).toHaveLength(0);
      expect(result.dryRun).toBe(false);
      expect(result.currentVersion).toBe("1.1.0");
    });

    test("should skip already applied migrations", async () => {
      const client = createMockClient({ appliedVersions: ["1.0.0"] });
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      const result = await runner.migrate();

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]?.version).toBe("1.1.0");
      expect(result.skipped).toEqual(["1.0.0"]);
    });

    test("should return success when no migrations to apply", async () => {
      const client = createMockClient({ appliedVersions: ["1.0.0", "1.1.0"] });
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      const result = await runner.migrate();

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(0);
      expect(result.skipped).toEqual(["1.0.0", "1.1.0"]);
    });

    test("should support dry run mode", async () => {
      const executedQueries: string[] = [];
      const client = {
        ...createMockClient({ appliedVersions: [] }),
        runQuery: async <T>(cypher: string): Promise<T[]> => {
          executedQueries.push(cypher);
          if (cypher.includes("SchemaVersion")) {
            return [] as T[];
          }
          return [] as T[];
        },
      } as Neo4jStorageClient;

      const runner = new MigrationRunner(client);
      runner.registerMigration(sampleMigrations[0]!);

      const result = await runner.migrate({ dryRun: true });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]?.version).toBe("1.0.0");

      // Should not have executed the actual migration statements
      const migrationQueries = executedQueries.filter(
        (q) => q.includes("CREATE CONSTRAINT") || q.includes("CREATE INDEX")
      );
      expect(migrationQueries).toHaveLength(0);
    });

    test("should force re-apply all migrations", async () => {
      const client = createMockClient({ appliedVersions: ["1.0.0"] });
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      const result = await runner.migrate({ force: true });

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
    });

    test("should respect target version", async () => {
      const client = createMockClient({ appliedVersions: [] });
      const runner = new MigrationRunner(client);

      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);
      runner.registerMigration(sampleMigrations[2]!);

      const result = await runner.migrate({ targetVersion: "1.1.0" });

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(2);
      expect(result.applied[0]?.version).toBe("1.0.0");
      expect(result.applied[1]?.version).toBe("1.1.0");
      expect(result.currentVersion).toBe("1.1.0");
    });

    test("should handle migration failure", async () => {
      // Create a client that fails only on migration statements, not on version checks
      const client = {
        ...createMockClient({ appliedVersions: [] }),
        runQuery: async <T>(cypher: string): Promise<T[]> => {
          // Allow version queries to pass
          if (cypher.includes("SchemaVersion") && cypher.includes("MATCH")) {
            return [] as T[];
          }
          // Fail on CREATE statements (migration execution)
          if (cypher.includes("CREATE CONSTRAINT") || cypher.includes("CREATE INDEX")) {
            throw new Error("Database connection lost");
          }
          return [] as T[];
        },
      } as Neo4jStorageClient;

      const runner = new MigrationRunner(client);
      runner.registerMigration(sampleMigrations[0]!);

      const result = await runner.migrate();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Database connection lost");
      expect(result.applied).toHaveLength(0);
    });

    test("should record applied migrations in Neo4j", async () => {
      const recordedMigrations: Array<{ version: string; description: string }> = [];
      const client = {
        ...createMockClient({ appliedVersions: [] }),
        runQuery: async <T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> => {
          if (cypher.includes("MERGE") && cypher.includes("SchemaVersion")) {
            recordedMigrations.push({
              version: params?.["version"] as string,
              description: params?.["description"] as string,
            });
          }
          if (cypher.includes("SchemaVersion") && cypher.includes("MATCH")) {
            return [] as T[];
          }
          return [] as T[];
        },
      } as Neo4jStorageClient;

      const runner = new MigrationRunner(client);
      runner.registerMigration(sampleMigrations[0]!);
      runner.registerMigration(sampleMigrations[1]!);

      await runner.migrate();

      expect(recordedMigrations).toHaveLength(2);
      expect(recordedMigrations[0]).toEqual({ version: "1.0.0", description: "Initial schema" });
      expect(recordedMigrations[1]).toEqual({ version: "1.1.0", description: "Add index" });
    });

    test("should execute all statements in a migration", async () => {
      const executedStatements: string[] = [];
      const client = {
        ...createMockClient({ appliedVersions: [] }),
        runQuery: async <T>(cypher: string): Promise<T[]> => {
          executedStatements.push(cypher);
          if (cypher.includes("SchemaVersion") && cypher.includes("MATCH")) {
            return [] as T[];
          }
          return [] as T[];
        },
      } as Neo4jStorageClient;

      const runner = new MigrationRunner(client);
      runner.registerMigration(sampleMigrations[2]!); // Has 2 statements

      await runner.migrate();

      const schemaStatements = executedStatements.filter(
        (s) => s.includes("CREATE CONSTRAINT test2") || s.includes("CREATE INDEX test2_name")
      );
      expect(schemaStatements).toHaveLength(2);
    });
  });
});

describe("DefaultMigrationRegistry", () => {
  test("should get migration by version", () => {
    const client = createMockClient();
    const runner = new MigrationRunner(client);

    runner.registerMigration(sampleMigrations[0]!);
    runner.registerMigration(sampleMigrations[1]!);

    const registry = runner.getRegistry();

    expect(registry.getMigration("1.0.0")).toBeDefined();
    expect(registry.getMigration("1.0.0")?.description).toBe("Initial schema");
    expect(registry.getMigration("1.1.0")).toBeDefined();
    expect(registry.getMigration("9.9.9")).toBeUndefined();
  });

  test("should return latest version", () => {
    const client = createMockClient();
    const runner = new MigrationRunner(client);

    expect(runner.getRegistry().getLatestVersion()).toBe("0.0.0");

    runner.registerMigration(sampleMigrations[0]!);
    expect(runner.getRegistry().getLatestVersion()).toBe("1.0.0");

    runner.registerMigration(sampleMigrations[2]!);
    expect(runner.getRegistry().getLatestVersion()).toBe("2.0.0");

    runner.registerMigration(sampleMigrations[1]!);
    expect(runner.getRegistry().getLatestVersion()).toBe("2.0.0");
  });

  test("should return copy of migrations array", () => {
    const client = createMockClient();
    const runner = new MigrationRunner(client);

    runner.registerMigration(sampleMigrations[0]!);

    const registry = runner.getRegistry();
    const migrations1 = registry.getMigrations();
    const migrations2 = registry.getMigrations();

    expect(migrations1).not.toBe(migrations2);
    expect(migrations1).toEqual(migrations2);
  });
});
