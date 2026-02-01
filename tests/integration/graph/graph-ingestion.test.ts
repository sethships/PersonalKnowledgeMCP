/**
 * Integration tests for GraphIngestionService
 *
 * These tests require a running FalkorDB instance and test the complete
 * ingestion pipeline from file content to graph storage.
 *
 * To run these tests:
 * 1. Start FalkorDB: docker compose up -d falkordb
 * 2. Run: bun test tests/integration/graph/graph-ingestion.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  createGraphAdapter,
  type GraphStorageAdapter,
  type GraphStorageConfig,
} from "../../../src/graph/adapters/index.js";
import { GraphIngestionService } from "../../../src/graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../../src/graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../../src/graph/extraction/RelationshipExtractor.js";
import type {
  GraphIngestionOptions,
  GraphIngestionProgress,
  FileInput,
} from "../../../src/graph/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// Integration test configuration
const integrationConfig: GraphStorageConfig = {
  host: process.env["FALKORDB_HOST"] ?? "localhost",
  port: parseInt(process.env["FALKORDB_PORT"] ?? "6379", 10),
  username: process.env["FALKORDB_USER"] ?? "default",
  password: process.env["FALKORDB_PASSWORD"] ?? "testpassword",
  database: process.env["FALKORDB_DATABASE"] ?? "test_graph",
  maxConnectionPoolSize: 10,
  connectionAcquisitionTimeout: 10000,
};

// Test data prefix to avoid conflicts
const TEST_PREFIX = `ingestion_test_${Date.now()}`;

// Sample TypeScript files for testing
const sampleFiles: FileInput[] = [
  {
    path: "src/index.ts",
    content: `
import { helper } from "./utils.js";
import lodash from "lodash";

export function main(): void {
  const result = helper(42);
  console.log(result);
}

export class Application {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  run(): void {
    main();
  }
}
`,
  },
  {
    path: "src/utils.ts",
    content: `
export function helper(value: number): number {
  return value * 2;
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

export interface Config {
  name: string;
  version: string;
}
`,
  },
  {
    path: "src/types.ts",
    content: `
export type Result<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export interface User {
  id: string;
  name: string;
  email: string;
}
`,
  },
];

// Helper to check if FalkorDB is available
async function isFalkorDBAvailable(): Promise<boolean> {
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), 2000);
  });

  const connectionCheck = (async () => {
    const client = createGraphAdapter("falkordb", integrationConfig);
    try {
      await client.connect();
      const healthy = await client.healthCheck();
      await client.disconnect();
      return healthy;
    } catch {
      return false;
    }
  })();

  return Promise.race([connectionCheck, timeout]);
}

describe("GraphIngestionService Integration Tests", () => {
  let client: GraphStorageAdapter;
  let service: GraphIngestionService;
  let entityExtractor: EntityExtractor;
  let relationshipExtractor: RelationshipExtractor;
  let falkordbAvailable: boolean;
  let testRepoName: string;

  beforeAll(async () => {
    initializeLogger({ level: "error", format: "json" });
    falkordbAvailable = await isFalkorDBAvailable();

    if (!falkordbAvailable) {
      console.log("FalkorDB is not available. Integration tests will be skipped.");
      return;
    }

    // Initialize client and extractors
    client = createGraphAdapter("falkordb", integrationConfig);
    await client.connect();

    entityExtractor = new EntityExtractor();
    relationshipExtractor = new RelationshipExtractor();

    service = new GraphIngestionService(client, entityExtractor, relationshipExtractor);
  });

  beforeEach(() => {
    // Generate unique repository name for each test
    testRepoName = `${TEST_PREFIX}_${Date.now()}`;
  });

  afterAll(async () => {
    if (falkordbAvailable && client) {
      // Clean up all test data
      try {
        await client.runQuery(
          `MATCH (n) WHERE n.repository STARTS WITH $prefix OR n.name STARTS WITH $prefix DETACH DELETE n`,
          { prefix: TEST_PREFIX }
        );
      } catch (error) {
        console.error("Failed to clean up test data:", error);
      }
      await client.disconnect();
    }
    resetLogger();
  });

  describe("end-to-end ingestion", () => {
    test("should ingest files and create Repository node", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      const result = await service.ingestFiles(sampleFiles, options);

      expect(result.status).toBe("success");
      expect(result.repository).toBe(testRepoName);

      // Verify Repository node was created
      const repoResult = await client.runQuery<{ name: string; url: string }>(
        `MATCH (r:Repository {name: $name}) RETURN r.name as name, r.url as url`,
        { name: testRepoName }
      );

      expect(repoResult.length).toBe(1);
      expect(repoResult[0]?.name).toBe(testRepoName);
      expect(repoResult[0]?.url).toBe(options.repositoryUrl);
    });

    test("should create File nodes with CONTAINS relationships", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      await service.ingestFiles(sampleFiles, options);

      // Verify File nodes were created
      const fileResult = await client.runQuery<{ path: string }>(
        `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File) RETURN f.path as path ORDER BY f.path`,
        { name: testRepoName }
      );

      expect(fileResult.length).toBe(3);
      expect(fileResult.map((f) => f.path)).toEqual([
        "src/index.ts",
        "src/types.ts",
        "src/utils.ts",
      ]);
    });

    test("should create Function nodes with DEFINES relationships", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      await service.ingestFiles(sampleFiles, options);

      // Verify Function nodes were created
      const funcResult = await client.runQuery<{ name: string; filePath: string }>(
        `MATCH (f:File)-[:DEFINES]->(fn:Function)
         WHERE f.repository = $name
         RETURN fn.name as name, f.path as filePath
         ORDER BY fn.name`,
        { name: testRepoName }
      );

      // Should have main, helper, formatDate
      const funcNames = funcResult.map((f) => f.name);
      expect(funcNames).toContain("main");
      expect(funcNames).toContain("helper");
      expect(funcNames).toContain("formatDate");
    });

    test("should create Class nodes with DEFINES relationships", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      await service.ingestFiles(sampleFiles, options);

      // Verify Class nodes were created
      const classResult = await client.runQuery<{ name: string; filePath: string }>(
        `MATCH (f:File)-[:DEFINES]->(c:Class)
         WHERE f.repository = $name
         RETURN c.name as name, f.path as filePath`,
        { name: testRepoName }
      );

      expect(classResult.length).toBeGreaterThanOrEqual(1);
      const classNames = classResult.map((c) => c.name);
      expect(classNames).toContain("Application");
    });

    test("should create Module nodes with IMPORTS relationships", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      await service.ingestFiles(sampleFiles, options);

      // Verify IMPORTS relationships exist
      const importResult = await client.runQuery<{ moduleName: string; filePath: string }>(
        `MATCH (f:File)-[:IMPORTS]->(m:Module)
         WHERE f.repository = $name
         RETURN m.name as moduleName, f.path as filePath`,
        { name: testRepoName }
      );

      // Should have lodash and ./utils.js imports
      expect(importResult.length).toBeGreaterThanOrEqual(1);
      const moduleNames = importResult.map((r) => r.moduleName);
      expect(moduleNames).toContain("lodash");
    });

    test("should report progress during ingestion", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const progressUpdates: GraphIngestionProgress[] = [];
      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      };

      await service.ingestFiles(sampleFiles, options);

      // Verify progress was reported
      expect(progressUpdates.length).toBeGreaterThan(0);

      // Should have multiple phases
      const phases = new Set(progressUpdates.map((p) => p.phase));
      expect(phases.size).toBeGreaterThan(1);

      // All updates should reference the correct repository
      expect(progressUpdates.every((p) => p.repository === testRepoName)).toBe(true);

      // Progress should go from low to high percentage
      const percentages = progressUpdates.map((p) => p.percentage);
      const maxPercentage = Math.max(...percentages);
      expect(maxPercentage).toBeGreaterThanOrEqual(90);
    });

    test("should return accurate statistics", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      const result = await service.ingestFiles(sampleFiles, options);

      expect(result.stats.filesProcessed).toBe(3);
      expect(result.stats.filesFailed).toBe(0);
      expect(result.stats.nodesCreated).toBeGreaterThan(0);
      expect(result.stats.relationshipsCreated).toBeGreaterThan(0);
      expect(result.stats.durationMs).toBeGreaterThan(0);
    });
  });

  describe("force re-ingestion", () => {
    test("should allow re-ingestion with force flag", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      // First ingestion
      const firstResult = await service.ingestFiles(sampleFiles, options);
      expect(firstResult.status).toBe("success");

      // Second ingestion without force should fail
      try {
        await service.ingestFiles(sampleFiles, options);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).name).toBe("RepositoryExistsError");
      }

      // Second ingestion with force should succeed
      const forceResult = await service.ingestFiles(sampleFiles, {
        ...options,
        force: true,
      });
      expect(forceResult.status).toBe("success");
    });

    test("should delete old data before re-ingestion", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      // First ingestion
      await service.ingestFiles(sampleFiles, options);

      // Count nodes before re-ingestion
      const beforeCountResult = await client.runQuery<{ count: number }>(
        `MATCH (n) WHERE n.repository = $name RETURN count(n) as count`,
        { name: testRepoName }
      );
      const beforeCount = beforeCountResult[0]?.count ?? 0;

      // Re-ingest with force
      await service.ingestFiles(sampleFiles, { ...options, force: true });

      // Count nodes after re-ingestion
      const afterCountResult = await client.runQuery<{ count: number }>(
        `MATCH (n) WHERE n.repository = $name RETURN count(n) as count`,
        { name: testRepoName }
      );
      const afterCount = afterCountResult[0]?.count ?? 0;

      // Node counts should be similar (old data deleted, new data created)
      // Allow some variance due to timing and implementation details
      expect(Math.abs(afterCount - beforeCount)).toBeLessThanOrEqual(beforeCount * 0.5);
    });
  });

  describe("deleteRepositoryData", () => {
    test("should delete all repository data", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      // Ingest files
      await service.ingestFiles(sampleFiles, options);

      // Verify data exists
      const beforeResult = await client.runQuery<{ count: number }>(
        `MATCH (n) WHERE n.repository = $name OR n.name = $name RETURN count(n) as count`,
        { name: testRepoName }
      );
      expect(beforeResult[0]?.count ?? 0).toBeGreaterThan(0);

      // Delete repository data
      await service.deleteRepositoryData(testRepoName);

      // Verify data is deleted
      const afterResult = await client.runQuery<{ count: number }>(
        `MATCH (n) WHERE n.repository = $name OR n.name = $name RETURN count(n) as count`,
        { name: testRepoName }
      );
      expect(afterResult[0]?.count ?? 0).toBe(0);
    });
  });

  describe("error handling", () => {
    test("should handle files with syntax errors gracefully", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const filesWithError: FileInput[] = [
        {
          path: "src/valid.ts",
          content: `export function valid(): void { console.log("valid"); }`,
        },
        {
          path: "src/invalid.ts",
          content: `export function broken( { // missing closing paren and brace`,
        },
      ];

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      const result = await service.ingestFiles(filesWithError, options);

      // Should complete with partial success or success
      // (tree-sitter is error-tolerant, may still extract some nodes)
      expect(["success", "partial"]).toContain(result.status);
      expect(result.stats.filesProcessed).toBeGreaterThan(0);
    });

    test("should skip unsupported file types", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const mixedFiles: FileInput[] = [
        {
          path: "src/app.ts",
          content: `export function app(): void {}`,
        },
        {
          path: "README.md",
          content: `# README\nThis is a readme file.`,
        },
        {
          path: "styles.css",
          content: `.class { color: red; }`,
        },
      ];

      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };

      const result = await service.ingestFiles(mixedFiles, options);

      expect(result.status).toBe("success");
      // All files should be processed (File nodes created), but only .ts should have entities
      expect(result.stats.filesProcessed).toBe(3);
    });
  });

  describe("single file ingestion", () => {
    test("should ingest a single file successfully", async () => {
      if (!falkordbAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      // First create the repository structure
      const options: GraphIngestionOptions = {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
      };
      await service.ingestFiles([sampleFiles[0]!], options);

      // Now ingest another file individually
      const newFile: FileInput = {
        path: "src/newfile.ts",
        content: `export function newFunction(): string { return "new"; }`,
      };

      const result = await service.ingestFile(newFile, testRepoName);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe("src/newfile.ts");
      expect(result.nodesCreated).toBeGreaterThanOrEqual(0);
    });
  });
});
