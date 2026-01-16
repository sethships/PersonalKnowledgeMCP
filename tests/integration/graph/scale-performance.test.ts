/**
 * Scale Performance Integration Tests
 *
 * CI-friendly performance tests for large-scale graph operations.
 * Uses smaller data sets (1K files) by default for regular CI runs,
 * with optional flags for full-scale (10K+) testing.
 *
 * Run in CI (default 1K scale):
 *   bun test tests/integration/graph/scale-performance.test.ts
 *
 * Run with full scale (10K files):
 *   SCALE_TEST_SIZE=large bun test tests/integration/graph/scale-performance.test.ts
 *
 * Environment variables:
 *   - SCALE_TEST_SIZE: "small" (1K), "medium" (5K), "large" (10K), "xlarge" (15K)
 *   - CI_TOLERANCE: Multiplier for timing assertions (default 2.0 for CI variance)
 *   - SKIP_CLEANUP: Set to "true" to keep test data for debugging
 *   - VERBOSE: Set to "true" for detailed output
 *
 * @module tests/integration/graph/scale-performance.test
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { Neo4jStorageClientImpl } from "../../../src/graph/Neo4jClient.js";
import { GraphIngestionService } from "../../../src/graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../../src/graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../../src/graph/extraction/RelationshipExtractor.js";
import { GraphServiceImpl } from "../../../src/services/graph-service.js";
import type { Neo4jConfig } from "../../../src/graph/types.js";
import type {
  DependencyQuery,
  ArchitectureQuery,
} from "../../../src/services/graph-service-types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import {
  LargeScaleGenerator,
  SCALE_TEST_CONFIGS,
  type LargeScaleGeneratorConfig,
} from "../../fixtures/large-scale-generator.js";
import { measureMemory } from "../../fixtures/benchmark-fixtures.js";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Determine test scale from environment
 */
function getTestScale(): keyof typeof SCALE_TEST_CONFIGS {
  const envScale = process.env["SCALE_TEST_SIZE"]?.toLowerCase();
  if (envScale && envScale in SCALE_TEST_CONFIGS) {
    return envScale as keyof typeof SCALE_TEST_CONFIGS;
  }
  // Default to "small" (1K files) for CI
  return "small";
}

/**
 * Get CI tolerance multiplier
 * CI environments have more variance, so we allow higher tolerance
 * Reduced from 2.0x to 1.5x to catch regressions earlier
 */
function getCITolerance(): number {
  const envTolerance = process.env["CI_TOLERANCE"];
  if (envTolerance) {
    const parsed = parseFloat(envTolerance);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  // Default 1.5x for CI variance (reduced from 2.0x to catch regressions)
  return 1.5;
}

const testScale = getTestScale();
const ciTolerance = getCITolerance();
const verbose = process.env["VERBOSE"] === "true";
const skipCleanup = process.env["SKIP_CLEANUP"] === "true";

// Neo4j configuration
const neo4jConfig: Neo4jConfig = {
  host: process.env["NEO4J_HOST"] ?? "localhost",
  port: parseInt(process.env["NEO4J_PORT"] ?? "7687", 10),
  username: process.env["NEO4J_USERNAME"] ?? "neo4j",
  password: process.env["NEO4J_PASSWORD"] ?? "testpassword",
  maxConnectionPoolSize: 20,
  connectionAcquisitionTimeout: 30000,
};

// PRD Performance targets (from Knowledge Graph PRD)
const PRD_TARGETS = {
  /** Full 10K file repository population in milliseconds (30 minutes) */
  fullPopulation10K: 30 * 60 * 1000,
  /** Per-file graph indexing in milliseconds */
  perFileIndexing: 100,
  /** Maximum memory growth during population (4GB) */
  maxMemoryGrowthMB: 4096,
  /** Simple 1-hop query */
  simple1Hop: 100,
  /** 3-level dependency tree */
  dependencyTree3Levels: 300,
  /** Cross-repository query */
  crossRepository: 500,
  /** Full module graph / architecture overview */
  fullModuleGraph: 1000,
  /** Single relationship update */
  singleRelationshipUpdate: 50,
  /** Single file update */
  singleFileUpdate: 100,
};

// Adjusted targets for CI (with tolerance)
const CI_TARGETS = Object.fromEntries(
  Object.entries(PRD_TARGETS).map(([key, value]) => [key, value * ciTolerance])
) as typeof PRD_TARGETS;

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Check Neo4j availability with timeout
 */
async function isNeo4jAvailable(): Promise<boolean> {
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), 5000);
  });

  const connectionCheck = (async () => {
    const client = new Neo4jStorageClientImpl(neo4jConfig);
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
 * Clean up test repository data
 */
async function cleanupTestData(client: Neo4jStorageClientImpl, repoName: string): Promise<void> {
  try {
    await client.runQuery(
      `
      MATCH (r:Repository {name: $name})
      OPTIONAL MATCH (r)-[:CONTAINS]->(f:File)
      OPTIONAL MATCH (f)-[:DEFINES]->(entity)
      OPTIONAL MATCH (f)-[:IMPORTS]->(module:Module)
      DETACH DELETE entity, module, f, r
      `,
      { name: repoName }
    );
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Measure performance of an async operation
 */
async function measurePerformance<T>(
  fn: () => Promise<T>,
  iterations: number = 5
): Promise<{
  min: number;
  max: number;
  avg: number;
  p95: number;
  times: number[];
}> {
  const times: number[] = [];

  // Warm-up run
  try {
    await fn();
  } catch {
    // Continue even if warm-up fails
  }

  // Measured runs
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      await fn();
    } catch {
      // Continue measuring even on errors
    }
    const end = performance.now();
    times.push(end - start);
  }

  times.sort((a, b) => a - b);

  return {
    min: times[0] ?? 0,
    max: times[times.length - 1] ?? 0,
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    p95: times[Math.floor(times.length * 0.95)] ?? times[times.length - 1] ?? 0,
    times,
  };
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

// ============================================================================
// Test Suite
// ============================================================================

describe(`Scale Performance Tests (${testScale} scale, ${ciTolerance}x tolerance)`, () => {
  let neo4jClient: Neo4jStorageClientImpl;
  let neo4jAvailable: boolean;
  let entityExtractor: EntityExtractor;
  let relationshipExtractor: RelationshipExtractor;
  let ingestionService: GraphIngestionService;
  let graphService: GraphServiceImpl;
  let testRepoName: string;
  let scaleConfig: LargeScaleGeneratorConfig;

  beforeAll(async () => {
    initializeLogger({ level: verbose ? "debug" : "silent", format: "json" });

    // Check Neo4j availability
    neo4jAvailable = await isNeo4jAvailable();
    if (!neo4jAvailable) {
      console.log("Neo4j is not available. Scale performance tests will be skipped.");
      console.log("Start Neo4j with: docker-compose up -d neo4j");
      return;
    }

    // Initialize services
    neo4jClient = new Neo4jStorageClientImpl(neo4jConfig);
    await neo4jClient.connect();

    // EntityExtractor and RelationshipExtractor create their own TreeSitterParser instances
    entityExtractor = new EntityExtractor();
    relationshipExtractor = new RelationshipExtractor();

    // Configure batch sizes based on scale
    scaleConfig = SCALE_TEST_CONFIGS[testScale];
    const batchSize = testScale === "small" ? 20 : testScale === "medium" ? 50 : 100;

    ingestionService = new GraphIngestionService(
      neo4jClient,
      entityExtractor,
      relationshipExtractor,
      {
        nodeBatchSize: batchSize,
        relationshipBatchSize: batchSize * 2,
      }
    );

    graphService = new GraphServiceImpl(neo4jClient);

    // Generate unique test repo name
    testRepoName = `scale-test-${testScale}-${Date.now()}`;

    console.log(`\nScale Performance Test Configuration:`);
    console.log(`  Scale: ${testScale} (${scaleConfig.fileCount} files)`);
    console.log(`  CI Tolerance: ${ciTolerance}x`);
    console.log(`  Test Repository: ${testRepoName}`);
    console.log(`  Batch Size: ${batchSize}`);
  }, 120000);

  afterAll(async () => {
    if (neo4jClient && testRepoName && !skipCleanup) {
      console.log(`\nCleaning up test repository: ${testRepoName}`);
      await cleanupTestData(neo4jClient, testRepoName);
    }

    if (neo4jClient) {
      await neo4jClient.disconnect();
    }

    resetLogger();
  });

  // Track test data for cleanup
  const createdRepos: string[] = [];

  afterEach(async () => {
    // Clean up any additional repos created during tests
    if (neo4jClient && !skipCleanup) {
      for (const repo of createdRepos) {
        if (repo !== testRepoName) {
          await cleanupTestData(neo4jClient, repo);
        }
      }
      createdRepos.length = 0;
    }
  });

  // ============================================================================
  // Population Performance Tests
  // ============================================================================

  describe("Graph Population Performance", () => {
    test("should populate graph within PRD targets", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Generate test data
      console.log(`\nGenerating ${scaleConfig.fileCount} files...`);
      const generator = new LargeScaleGenerator(scaleConfig);
      const generatedRepo = generator.generateLargeRepository(testRepoName);
      const fileInputs = LargeScaleGenerator.toFileInputs(generatedRepo);

      if (verbose) {
        console.log(`Generated repository stats:`);
        console.log(`  Files: ${generatedRepo.stats.totalFiles}`);
        console.log(`  Functions: ${generatedRepo.stats.totalFunctions}`);
        console.log(`  Classes: ${generatedRepo.stats.totalClasses}`);
        console.log(`  Imports: ${generatedRepo.stats.totalImports}`);
      }

      // Track memory
      const memoryBefore = measureMemory();

      // Run ingestion
      console.log(`Starting graph population...`);
      const startTime = performance.now();

      const result = await ingestionService.ingestFiles(fileInputs, {
        repository: testRepoName,
        repositoryUrl: `https://github.com/test/${testRepoName}`,
        force: true,
      });

      const totalDurationMs = performance.now() - startTime;
      const memoryAfter = measureMemory();

      // Calculate metrics
      const perFileDurationMs = totalDurationMs / scaleConfig.fileCount;
      const filesPerSecond = (scaleConfig.fileCount / totalDurationMs) * 1000;
      const memoryGrowthMB = (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024;

      // Extrapolate to 10K for comparison
      const extrapolatedTo10K = (totalDurationMs / scaleConfig.fileCount) * 10000;

      // Print results
      console.log(`\nPopulation Results (${testScale}):`);
      console.log(`  Total duration: ${formatDuration(totalDurationMs)}`);
      console.log(`  Per-file average: ${perFileDurationMs.toFixed(2)}ms`);
      console.log(`  Files/second: ${filesPerSecond.toFixed(2)}`);
      console.log(`  Nodes created: ${result.stats.nodesCreated}`);
      console.log(`  Relationships created: ${result.stats.relationshipsCreated}`);
      console.log(`  Memory growth: ${memoryGrowthMB.toFixed(2)} MB`);
      console.log(`  Extrapolated 10K time: ${formatDuration(extrapolatedTo10K)}`);

      // Validate against targets (with CI tolerance)
      const targetPerFile = CI_TARGETS.perFileIndexing;
      const passedPerFile = perFileDurationMs < targetPerFile;
      console.log(`\n  Per-file target: <${targetPerFile}ms - ${passedPerFile ? "PASS" : "FAIL"}`);

      expect(perFileDurationMs).toBeLessThan(targetPerFile);

      // Memory should stay reasonable
      expect(memoryGrowthMB).toBeLessThan(CI_TARGETS.maxMemoryGrowthMB);

      // Extrapolated 10K time should meet PRD target
      expect(extrapolatedTo10K).toBeLessThan(CI_TARGETS.fullPopulation10K);
    }, 1800000); // 30 minute timeout for large scale
  });

  // ============================================================================
  // Query Performance Tests
  // ============================================================================

  describe("Query Performance at Scale", () => {
    test("simple 1-hop queries should meet PRD targets", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Need populated data
      const hasData = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (r:Repository {name: $name}) RETURN count(r) as count`,
        { name: testRepoName }
      );

      if (!hasData.length || (hasData[0]?.count ?? 0) === 0) {
        console.log("Skipping: Test repository not populated (run population test first)");
        return;
      }

      // Get a file to query
      const files = await neo4jClient.runQuery<{ path: string }>(
        `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File) RETURN f.path as path LIMIT 10`,
        { name: testRepoName }
      );

      if (!files.length) {
        console.log("Skipping: No files found in test repository");
        return;
      }

      const testFile = files[Math.floor(files.length / 2)]?.path ?? files[0]?.path;

      const query: DependencyQuery = {
        entity_type: "file",
        entity_path: testFile!,
        repository: testRepoName,
        depth: 1,
      };

      const stats = await measurePerformance(() => graphService.getDependencies(query), 10);

      console.log(`\nSimple 1-hop Query Performance:`);
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  Target (CI): <${CI_TARGETS.simple1Hop}ms`);

      expect(stats.p95).toBeLessThan(CI_TARGETS.simple1Hop);
    }, 60000);

    test("3-level transitive queries should meet PRD targets", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Check for data
      const hasData = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (r:Repository {name: $name}) RETURN count(r) as count`,
        { name: testRepoName }
      );

      if (!hasData.length || (hasData[0]?.count ?? 0) === 0) {
        console.log("Skipping: Test repository not populated");
        return;
      }

      // Get a file with dependencies for transitive query
      const files = await neo4jClient.runQuery<{ path: string; depCount: number }>(
        `
        MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File)
        OPTIONAL MATCH (f)-[:IMPORTS]->(m:Module)
        WITH f, count(m) as depCount
        WHERE depCount > 0
        RETURN f.path as path, depCount
        ORDER BY depCount DESC
        LIMIT 5
        `,
        { name: testRepoName }
      );

      if (!files.length) {
        console.log("Skipping: No files with dependencies found");
        return;
      }

      const testFile = files[0]?.path;

      const query: DependencyQuery = {
        entity_type: "file",
        entity_path: testFile!,
        repository: testRepoName,
        depth: 3,
        include_transitive: true,
      };

      const stats = await measurePerformance(() => graphService.getDependencies(query), 5);

      console.log(`\n3-Level Transitive Query Performance:`);
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  Target (CI): <${CI_TARGETS.dependencyTree3Levels}ms`);

      expect(stats.p95).toBeLessThan(CI_TARGETS.dependencyTree3Levels);
    }, 60000);

    test("architecture queries should meet PRD targets", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Check for data
      const hasData = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (r:Repository {name: $name}) RETURN count(r) as count`,
        { name: testRepoName }
      );

      if (!hasData.length || (hasData[0]?.count ?? 0) === 0) {
        console.log("Skipping: Test repository not populated");
        return;
      }

      const query: ArchitectureQuery = {
        repository: testRepoName,
        detail_level: "modules",
      };

      const stats = await measurePerformance(() => graphService.getArchitecture(query), 5);

      console.log(`\nArchitecture Query Performance:`);
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  Target (CI): <${CI_TARGETS.fullModuleGraph}ms`);

      expect(stats.p95).toBeLessThan(CI_TARGETS.fullModuleGraph);
    }, 60000);

    test("concurrent queries should scale reasonably", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Check for data
      const hasData = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (r:Repository {name: $name}) RETURN count(r) as count`,
        { name: testRepoName }
      );

      if (!hasData.length || (hasData[0]?.count ?? 0) === 0) {
        console.log("Skipping: Test repository not populated");
        return;
      }

      // Get multiple files
      const files = await neo4jClient.runQuery<{ path: string }>(
        `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File) RETURN f.path as path LIMIT 5`,
        { name: testRepoName }
      );

      if (files.length < 3) {
        console.log("Skipping: Not enough files for concurrent query test");
        return;
      }

      const queries: DependencyQuery[] = files.slice(0, 3).map((f) => ({
        entity_type: "file" as const,
        entity_path: f.path,
        repository: testRepoName,
        depth: 1,
      }));

      // Sequential timing
      const seqStart = performance.now();
      for (const q of queries) {
        await graphService.getDependencies(q);
      }
      const seqDuration = performance.now() - seqStart;

      // Concurrent timing
      const concStart = performance.now();
      await Promise.all(queries.map((q) => graphService.getDependencies(q)));
      const concDuration = performance.now() - concStart;

      console.log(`\nConcurrent Query Performance:`);
      console.log(`  Sequential (3 queries): ${seqDuration.toFixed(2)}ms`);
      console.log(`  Concurrent (3 queries): ${concDuration.toFixed(2)}ms`);
      console.log(`  Speedup: ${(seqDuration / concDuration).toFixed(2)}x`);

      // Concurrent should not be worse than sequential
      expect(concDuration).toBeLessThan(seqDuration * 1.5);
    }, 60000);
  });

  // ============================================================================
  // Incremental Update Performance Tests
  // ============================================================================

  describe("Incremental Update Performance", () => {
    test("single file update should meet PRD targets", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Check for data
      const hasData = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (r:Repository {name: $name}) RETURN count(r) as count`,
        { name: testRepoName }
      );

      if (!hasData.length || (hasData[0]?.count ?? 0) === 0) {
        console.log("Skipping: Test repository not populated");
        return;
      }

      // Get a file to update
      const files = await neo4jClient.runQuery<{ path: string }>(
        `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File) RETURN f.path as path LIMIT 1`,
        { name: testRepoName }
      );

      if (!files.length || !files[0]?.path) {
        console.log("Skipping: No files found");
        return;
      }

      const testFilePath = files[0].path;

      // Generate updated file content
      const updatedContent = `
// Updated file content
import { type Foo } from "./updated-import";

export function updatedFunction(): void {
  console.log("Updated at ${Date.now()}");
}

export class UpdatedClass {
  public value: number = ${Math.random()};
}
`;

      const updateFile = {
        path: testFilePath,
        content: updatedContent,
        extension: ".ts",
      };

      // Measure update performance
      const stats = await measurePerformance(
        () =>
          ingestionService.ingestFiles([updateFile], {
            repository: testRepoName,
            repositoryUrl: `https://github.com/test/${testRepoName}`,
            force: true,
          }),
        5
      );

      console.log(`\nSingle File Update Performance:`);
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  Target (CI): <${CI_TARGETS.singleFileUpdate}ms`);

      expect(stats.p95).toBeLessThan(CI_TARGETS.singleFileUpdate);
    }, 60000);
  });

  // ============================================================================
  // Performance Summary
  // ============================================================================

  describe("Performance Summary Report", () => {
    test("should generate comprehensive performance summary", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Check for data
      const repoStats = await neo4jClient.runQuery<{
        fileCount: number;
        nodeCount: number;
        relCount: number;
      }>(
        `
        MATCH (r:Repository {name: $name})
        OPTIONAL MATCH (r)-[:CONTAINS]->(f:File)
        OPTIONAL MATCH (f)-[:DEFINES]->(e)
        OPTIONAL MATCH (f)-[rel:IMPORTS]->()
        RETURN
          count(DISTINCT f) as fileCount,
          count(DISTINCT e) as nodeCount,
          count(DISTINCT rel) as relCount
        `,
        { name: testRepoName }
      );

      const stats = repoStats[0] ?? { fileCount: 0, nodeCount: 0, relCount: 0 };

      console.log("\n" + "=".repeat(70));
      console.log("SCALE PERFORMANCE TEST SUMMARY");
      console.log("=".repeat(70));
      console.log(`\nTest Configuration:`);
      console.log(`  Scale: ${testScale}`);
      console.log(`  Target Files: ${scaleConfig.fileCount}`);
      console.log(`  CI Tolerance: ${ciTolerance}x`);
      console.log(`\nRepository Statistics:`);
      console.log(`  Files: ${stats.fileCount}`);
      console.log(`  Entities: ${stats.nodeCount}`);
      console.log(`  Relationships: ${stats.relCount}`);
      console.log(`\nPRD Targets (with CI tolerance):`);
      console.log(`  Per-file indexing: <${CI_TARGETS.perFileIndexing}ms`);
      console.log(`  Simple 1-hop query: <${CI_TARGETS.simple1Hop}ms`);
      console.log(`  3-level transitive: <${CI_TARGETS.dependencyTree3Levels}ms`);
      console.log(`  Architecture query: <${CI_TARGETS.fullModuleGraph}ms`);
      console.log(`  Single file update: <${CI_TARGETS.singleFileUpdate}ms`);
      console.log("=".repeat(70) + "\n");

      // Basic validation
      expect(stats.fileCount).toBeGreaterThan(0);
    }, 30000);
  });
});

// ============================================================================
// Print Test Instructions
// ============================================================================

console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    SCALE PERFORMANCE TESTS                           ║
╠══════════════════════════════════════════════════════════════════════╣
║  These tests validate graph performance at scale against PRD targets ║
║                                                                      ║
║  Environment Variables:                                              ║
║    SCALE_TEST_SIZE  - Test scale: small (1K), medium (5K),          ║
║                       large (10K), xlarge (15K)                      ║
║    CI_TOLERANCE     - Timing tolerance multiplier (default: 2.0)     ║
║    SKIP_CLEANUP     - Keep test data after run (true/false)          ║
║    VERBOSE          - Detailed output (true/false)                   ║
║                                                                      ║
║  Prerequisites:                                                      ║
║    - Neo4j running (docker-compose up -d neo4j)                      ║
║    - Sufficient memory for test scale                                ║
║                                                                      ║
║  Examples:                                                           ║
║    # Quick CI run (1K files, 2x tolerance)                          ║
║    bun test tests/integration/graph/scale-performance.test.ts        ║
║                                                                      ║
║    # Full scale test (10K files)                                     ║
║    SCALE_TEST_SIZE=large bun test scale-performance.test.ts          ║
║                                                                      ║
║    # Strict timing validation                                        ║
║    CI_TOLERANCE=1.0 bun test scale-performance.test.ts               ║
╚══════════════════════════════════════════════════════════════════════╝
`);
