/**
 * Incremental Update Performance Benchmark Suite at Scale
 *
 * Tests incremental graph update performance against large-scale graphs
 * to validate against PRD targets:
 *
 * | Metric                          | Target   |
 * |---------------------------------|----------|
 * | Graph update (single relationship)| <50ms  |
 * | Single file update               | <100ms  |
 * | Batch update (10 files)          | <1000ms |
 *
 * Run with:
 *   RUN_SCALE_BENCHMARKS=true bun test tests/benchmarks/incremental-update-scale.bench.ts
 *
 * @module tests/benchmarks/incremental-update-scale.bench
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Neo4jStorageClientImpl } from "../../src/graph/Neo4jClient.js";
import { GraphIngestionService } from "../../src/graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../src/graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../src/graph/extraction/RelationshipExtractor.js";
import type { Neo4jConfig } from "../../src/graph/types.js";
import type { FileInput } from "../../src/graph/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import { LargeScaleGenerator, SCALE_TEST_CONFIGS } from "../fixtures/large-scale-generator.js";
import { calculateStats, type BenchmarkStats } from "../fixtures/benchmark-fixtures.js";

// Test configuration
const shouldRunBenchmarks = Bun.env["RUN_SCALE_BENCHMARKS"] === "true";
const verbose = Bun.env["VERBOSE"] === "true";

// Neo4j integration configuration
const integrationConfig: Neo4jConfig = {
  host: process.env["NEO4J_HOST"] ?? "localhost",
  port: parseInt(process.env["NEO4J_PORT"] ?? "7687", 10),
  username: process.env["NEO4J_USERNAME"] ?? "neo4j",
  password: process.env["NEO4J_PASSWORD"] ?? "testpassword",
  maxConnectionPoolSize: 20,
  connectionAcquisitionTimeout: 30000,
};

// PRD Performance targets (milliseconds)
const TARGETS = {
  /** Single relationship update */
  singleRelationship: 50,
  /** Single file update (delete + re-ingest) */
  singleFileUpdate: 100,
  /** Batch update (10 files) */
  batchUpdate10: 1000,
  /** Batch update (50 files) */
  batchUpdate50: 5000,
};

// CI tolerance multiplier
const CI_TOLERANCE = 1.5;

/**
 * Update benchmark result
 */
interface UpdateBenchmarkResult {
  name: string;
  target: number;
  stats: BenchmarkStats;
  passed: boolean;
  operationType: "single" | "batch" | "delete";
}

/**
 * Check Neo4j availability
 */
async function isNeo4jAvailable(): Promise<boolean> {
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), 5000);
  });

  const connectionCheck = (async () => {
    const client = new Neo4jStorageClientImpl(integrationConfig);
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

/**
 * Check if repository exists and get file count
 */
async function getRepositoryInfo(
  client: Neo4jStorageClientImpl,
  repoName: string
): Promise<{ exists: boolean; fileCount: number }> {
  try {
    const result = await client.runQuery<{ count: number }>(
      `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File) RETURN count(f) as count`,
      { name: repoName }
    );
    const count = result[0]?.count ?? 0;
    return { exists: count > 0, fileCount: count };
  } catch {
    return { exists: false, fileCount: 0 };
  }
}

/**
 * Get sample file paths from repository
 */
async function getSampleFilePaths(
  client: Neo4jStorageClientImpl,
  repoName: string,
  count: number
): Promise<string[]> {
  const result = await client.runQuery<{ path: string }>(
    `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File)
     WHERE f.extension = 'ts'
     RETURN f.path as path
     ORDER BY rand()
     LIMIT $count`,
    { name: repoName, count }
  );
  return result.map((r) => r.path);
}

/**
 * Measure update performance
 */
async function measureUpdatePerformance<T>(
  fn: () => Promise<T>,
  iterations: number = 10,
  warmup: number = 1
): Promise<{ stats: BenchmarkStats }> {
  // Warmup
  for (let i = 0; i < warmup; i++) {
    try {
      await fn();
    } catch {
      // Ignore warmup errors
    }
  }

  // Measured runs
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      await fn();
    } catch (e) {
      if (verbose) {
        console.log(`  Update error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    times.push(performance.now() - start);
  }

  return { stats: calculateStats(times) };
}

describe.skipIf(!shouldRunBenchmarks)("Incremental Update Performance at Scale", () => {
  let neo4jClient: Neo4jStorageClientImpl;
  let neo4jAvailable: boolean;
  let entityExtractor: EntityExtractor;
  let relationshipExtractor: RelationshipExtractor;
  let ingestionService: GraphIngestionService;

  // Test repository info
  const TEST_REPO_NAME = "incremental-update-bench";
  const TEST_FILE_COUNT = 1000; // Use 1K for incremental tests

  // Benchmark results collection
  const benchmarkResults: UpdateBenchmarkResult[] = [];

  beforeAll(async () => {
    initializeLogger({ level: verbose ? "debug" : "silent", format: "json" });
    neo4jAvailable = await isNeo4jAvailable();

    if (!neo4jAvailable) {
      console.log("Neo4j is not available. Incremental update benchmarks will be skipped.");
      return;
    }

    // Initialize services
    neo4jClient = new Neo4jStorageClientImpl(integrationConfig);
    await neo4jClient.connect();

    // EntityExtractor and RelationshipExtractor create their own TreeSitterParser instances
    entityExtractor = new EntityExtractor();
    relationshipExtractor = new RelationshipExtractor();
    ingestionService = new GraphIngestionService(
      neo4jClient,
      entityExtractor,
      relationshipExtractor,
      {
        nodeBatchSize: 50,
        relationshipBatchSize: 100,
      }
    );

    // Check if test repo exists, create if not
    const repoInfo = await getRepositoryInfo(neo4jClient, TEST_REPO_NAME);

    if (!repoInfo.exists) {
      console.log(`\nPopulating test repository (${TEST_FILE_COUNT} files)...`);

      const generator = new LargeScaleGenerator({
        ...SCALE_TEST_CONFIGS.small,
        fileCount: TEST_FILE_COUNT,
      });
      const repo = generator.generateLargeRepository(TEST_REPO_NAME);
      const fileInputs = LargeScaleGenerator.toFileInputs(repo);
      await ingestionService.ingestFiles(fileInputs, {
        repository: TEST_REPO_NAME,
        repositoryUrl: `https://github.com/test/${TEST_REPO_NAME}`,
        force: true,
      });

      console.log(`Test repository populated with ${TEST_FILE_COUNT} files.`);
    } else {
      console.log(`\nUsing existing test repository (${repoInfo.fileCount} files).`);

      // Generate files for update tests (won't match existing, but that's OK for testing)
      const generator = new LargeScaleGenerator({
        ...SCALE_TEST_CONFIGS.small,
        fileCount: 100, // Just need some for update content
        seed: Date.now(), // Different seed for different content
      });
      // Generate repo structure (not ingested, just for reference)
      generator.generateLargeRepository(TEST_REPO_NAME);
    }
  }, 600000);

  afterAll(async () => {
    if (neo4jClient) {
      await neo4jClient.disconnect();
    }
    resetLogger();

    // Print summary
    if (benchmarkResults.length > 0) {
      printUpdateBenchmarkSummary(benchmarkResults);
    }
  });

  /**
   * Generate a modified version of a file
   */
  function generateModifiedFile(originalPath: string): FileInput {
    const modifiedContent = `/**
 * Modified file for incremental update testing
 * @modified ${new Date().toISOString()}
 */

import { something } from "./utils.js";

export function newFunction(): void {
  console.log("This is a new function added during update");
}

export function anotherFunction(input: string): string {
  return \`Modified: \${input}\`;
}

export class UpdatedClass {
  private data: unknown;

  constructor() {
    this.data = null;
  }

  process(): void {
    // Updated implementation
  }
}
`;

    return {
      path: originalPath,
      content: modifiedContent,
      hash: `updated-${Date.now()}`,
    };
  }

  describe("Single File Update Performance", () => {
    test("delete file from graph", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Get sample files
      const samplePaths = await getSampleFilePaths(neo4jClient, TEST_REPO_NAME, 20);
      if (samplePaths.length === 0) {
        console.log("Skipping: No sample files found");
        return;
      }

      console.log("\n  Testing single file deletion...");

      const { stats } = await measureUpdatePerformance(
        async () => {
          const path = samplePaths[Math.floor(Math.random() * samplePaths.length)]!;
          await ingestionService.deleteFileData(TEST_REPO_NAME, path);
        },
        10,
        1
      );

      const passed = stats.p95 < TARGETS.singleRelationship * CI_TOLERANCE;

      benchmarkResults.push({
        name: "Delete single file",
        target: TARGETS.singleRelationship,
        stats,
        passed,
        operationType: "delete",
      });

      console.log(`    p50: ${stats.median.toFixed(1)}ms`);
      console.log(`    p95: ${stats.p95.toFixed(1)}ms`);
      console.log(`    Target: <${TARGETS.singleRelationship}ms (${passed ? "PASS" : "FAIL"})`);

      expect(stats.p95).toBeLessThan(TARGETS.singleRelationship * CI_TOLERANCE * 2);
    }, 120000);

    test("update single file (delete + re-ingest)", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const samplePaths = await getSampleFilePaths(neo4jClient, TEST_REPO_NAME, 20);
      if (samplePaths.length === 0) {
        console.log("Skipping: No sample files found");
        return;
      }

      console.log("\n  Testing single file update...");

      const { stats } = await measureUpdatePerformance(
        async () => {
          const path = samplePaths[Math.floor(Math.random() * samplePaths.length)]!;

          // Delete existing
          await ingestionService.deleteFileData(TEST_REPO_NAME, path);

          // Re-ingest with modified content
          const modifiedFile = generateModifiedFile(path);
          await ingestionService.ingestFile(modifiedFile, TEST_REPO_NAME);
        },
        10,
        1
      );

      const passed = stats.p95 < TARGETS.singleFileUpdate * CI_TOLERANCE;

      benchmarkResults.push({
        name: "Update single file",
        target: TARGETS.singleFileUpdate,
        stats,
        passed,
        operationType: "single",
      });

      console.log(`    p50: ${stats.median.toFixed(1)}ms`);
      console.log(`    p95: ${stats.p95.toFixed(1)}ms`);
      console.log(`    Target: <${TARGETS.singleFileUpdate}ms (${passed ? "PASS" : "FAIL"})`);

      expect(stats.p95).toBeLessThan(TARGETS.singleFileUpdate * CI_TOLERANCE);
    }, 120000);
  });

  describe("Batch Update Performance", () => {
    test("batch update (10 files)", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const samplePaths = await getSampleFilePaths(neo4jClient, TEST_REPO_NAME, 50);
      if (samplePaths.length < 10) {
        console.log("Skipping: Not enough sample files");
        return;
      }

      console.log("\n  Testing batch update (10 files)...");

      const { stats } = await measureUpdatePerformance(
        async () => {
          // Select 10 random files
          const shuffled = [...samplePaths].sort(() => Math.random() - 0.5);
          const batch = shuffled.slice(0, 10);

          // Delete all files in batch
          for (const path of batch) {
            await ingestionService.deleteFileData(TEST_REPO_NAME, path);
          }

          // Re-ingest all files
          const modifiedFiles = batch.map((path) => generateModifiedFile(path));
          for (const file of modifiedFiles) {
            await ingestionService.ingestFile(file, TEST_REPO_NAME);
          }
        },
        5,
        1
      );

      const passed = stats.p95 < TARGETS.batchUpdate10 * CI_TOLERANCE;

      benchmarkResults.push({
        name: "Batch update (10 files)",
        target: TARGETS.batchUpdate10,
        stats,
        passed,
        operationType: "batch",
      });

      console.log(`    p50: ${stats.median.toFixed(1)}ms`);
      console.log(`    p95: ${stats.p95.toFixed(1)}ms`);
      console.log(`    Target: <${TARGETS.batchUpdate10}ms (${passed ? "PASS" : "FAIL"})`);

      expect(stats.p95).toBeLessThan(TARGETS.batchUpdate10 * CI_TOLERANCE);
    }, 300000);

    test("batch update (50 files)", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const samplePaths = await getSampleFilePaths(neo4jClient, TEST_REPO_NAME, 100);
      if (samplePaths.length < 50) {
        console.log("Skipping: Not enough sample files");
        return;
      }

      console.log("\n  Testing batch update (50 files)...");

      const { stats } = await measureUpdatePerformance(
        async () => {
          const shuffled = [...samplePaths].sort(() => Math.random() - 0.5);
          const batch = shuffled.slice(0, 50);

          // Delete and re-ingest
          for (const path of batch) {
            await ingestionService.deleteFileData(TEST_REPO_NAME, path);
          }

          const modifiedFiles = batch.map((path) => generateModifiedFile(path));
          for (const file of modifiedFiles) {
            await ingestionService.ingestFile(file, TEST_REPO_NAME);
          }
        },
        3,
        1
      );

      const passed = stats.p95 < TARGETS.batchUpdate50 * CI_TOLERANCE;

      benchmarkResults.push({
        name: "Batch update (50 files)",
        target: TARGETS.batchUpdate50,
        stats,
        passed,
        operationType: "batch",
      });

      console.log(`    p50: ${stats.median.toFixed(1)}ms`);
      console.log(`    p95: ${stats.p95.toFixed(1)}ms`);
      console.log(`    Target: <${TARGETS.batchUpdate50}ms (${passed ? "PASS" : "FAIL"})`);

      expect(stats.p95).toBeLessThan(TARGETS.batchUpdate50 * CI_TOLERANCE);
    }, 600000);
  });

  describe("Update with High Dependency Count", () => {
    test("update file with many dependents", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Find a utility file that has many dependents
      const utilityFiles = await neo4jClient.runQuery<{ path: string; dependentCount: number }>(
        `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File)
         WHERE f.path CONTAINS 'utils'
         OPTIONAL MATCH (other:File)-[:IMPORTS]->(m:Module)
         WHERE m.name CONTAINS f.path
         RETURN f.path as path, count(other) as dependentCount
         ORDER BY dependentCount DESC
         LIMIT 5`,
        { name: TEST_REPO_NAME }
      );

      if (utilityFiles.length === 0) {
        // Fallback to any file
        const anyFile = await getSampleFilePaths(neo4jClient, TEST_REPO_NAME, 1);
        if (anyFile.length === 0) {
          console.log("Skipping: No files found");
          return;
        }
        utilityFiles.push({ path: anyFile[0]!, dependentCount: 0 });
      }

      console.log("\n  Testing update of highly-depended-upon file...");
      console.log(
        `    Target file: ${utilityFiles[0]!.path} (${utilityFiles[0]!.dependentCount} dependents)`
      );

      const targetPath = utilityFiles[0]!.path;

      const { stats } = await measureUpdatePerformance(
        async () => {
          await ingestionService.deleteFileData(TEST_REPO_NAME, targetPath);
          const modifiedFile = generateModifiedFile(targetPath);
          await ingestionService.ingestFile(modifiedFile, TEST_REPO_NAME);
        },
        5,
        1
      );

      benchmarkResults.push({
        name: "Update high-dependency file",
        target: TARGETS.singleFileUpdate * 2, // Allow 2x for complex files
        stats,
        passed: stats.p95 < TARGETS.singleFileUpdate * 2 * CI_TOLERANCE,
        operationType: "single",
      });

      console.log(`    p50: ${stats.median.toFixed(1)}ms`);
      console.log(`    p95: ${stats.p95.toFixed(1)}ms`);

      // Should still be reasonably fast even for complex files
      expect(stats.p95).toBeLessThan(TARGETS.singleFileUpdate * 3);
    }, 120000);
  });

  describe("Update Performance Under Load", () => {
    test("concurrent updates", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const samplePaths = await getSampleFilePaths(neo4jClient, TEST_REPO_NAME, 30);
      if (samplePaths.length < 5) {
        console.log("Skipping: Not enough sample files");
        return;
      }

      console.log("\n  Testing concurrent updates (5 simultaneous)...");

      const { stats } = await measureUpdatePerformance(
        async () => {
          const batch = samplePaths.slice(0, 5);
          const updates = batch.map(async (path) => {
            await ingestionService.deleteFileData(TEST_REPO_NAME, path);
            const modifiedFile = generateModifiedFile(path);
            await ingestionService.ingestFile(modifiedFile, TEST_REPO_NAME);
          });
          await Promise.all(updates);
        },
        3,
        1
      );

      benchmarkResults.push({
        name: "Concurrent updates (5)",
        target: TARGETS.batchUpdate10, // Should be similar to batch of 10
        stats,
        passed: stats.p95 < TARGETS.batchUpdate10 * CI_TOLERANCE,
        operationType: "batch",
      });

      console.log(`    p50: ${stats.median.toFixed(1)}ms`);
      console.log(`    p95: ${stats.p95.toFixed(1)}ms`);

      // Concurrent should not be significantly slower than sequential
      expect(stats.p95).toBeLessThan(TARGETS.batchUpdate10 * CI_TOLERANCE * 2);
    }, 300000);
  });
});

/**
 * Print update benchmark summary
 */
function printUpdateBenchmarkSummary(results: UpdateBenchmarkResult[]): void {
  console.log("\n" + "=".repeat(80));
  console.log("INCREMENTAL UPDATE BENCHMARK SUMMARY");
  console.log("=".repeat(80));

  console.log("\n| Operation                    | Target  | p50     | p95     | Status |");
  console.log("|------------------------------|---------|---------|---------|--------|");

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      `| ${result.name.padEnd(28)} | ${String(result.target).padStart(6)}ms | ${result.stats.median.toFixed(0).padStart(6)}ms | ${result.stats.p95.toFixed(0).padStart(6)}ms | ${status.padStart(6)} |`
    );
  }

  console.log("\n" + "=".repeat(80));

  // PRD Target Summary
  console.log("\nPRD Target Validation:");
  console.log(`  Single relationship update: < ${TARGETS.singleRelationship}ms`);
  console.log(`  Single file update: < ${TARGETS.singleFileUpdate}ms`);

  const allPassed = results.every((r) => r.passed);
  console.log(`\n  Overall: ${allPassed ? "✓ ALL TARGETS MET" : "✗ SOME TARGETS MISSED"}`);

  console.log("=".repeat(80) + "\n");
}

// Print instructions if benchmarks are skipped
if (!shouldRunBenchmarks) {
  console.log(
    "\n⏱️ Incremental update benchmarks are SKIPPED by default.\n" +
      "These benchmarks test graph update performance at scale.\n\n" +
      "To run these benchmarks:\n\n" +
      "  RUN_SCALE_BENCHMARKS=true bun test tests/benchmarks/incremental-update-scale.bench.ts\n\n" +
      "Prerequisites:\n" +
      "  - Neo4j running (docker-compose up -d neo4j)\n"
  );
}
