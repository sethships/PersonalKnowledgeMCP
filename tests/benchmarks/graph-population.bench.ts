/**
 * Graph Population Benchmark Suite
 *
 * Benchmarks the full graph population pipeline at scale (1K-15K files)
 * to validate against PRD performance targets:
 *
 * | Metric                          | Target      |
 * |---------------------------------|-------------|
 * | Full repository graph population| <30 min for 10K files |
 * | Graph indexing (per file)       | <100ms      |
 *
 * Run with:
 *   RUN_SCALE_BENCHMARKS=true bun test tests/benchmarks/graph-population.bench.ts
 *
 * @module tests/benchmarks/graph-population.bench
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Neo4jStorageClientImpl } from "../../src/graph/Neo4jClient.js";
import { GraphIngestionService } from "../../src/graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../src/graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../src/graph/extraction/RelationshipExtractor.js";
import type { Neo4jConfig } from "../../src/graph/types.js";
import type { GraphIngestionProgress } from "../../src/graph/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import { LargeScaleGenerator, SCALE_TEST_CONFIGS } from "../fixtures/large-scale-generator.js";
import { measureMemory } from "../fixtures/benchmark-fixtures.js";

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

// PRD Performance targets
const TARGETS = {
  /** Full 10K file repository population in milliseconds (30 minutes) */
  fullPopulation10K: 30 * 60 * 1000,
  /** Per-file graph indexing in milliseconds */
  perFileIndexing: 100,
  /** Maximum memory growth during population (4GB) */
  maxMemoryGrowthMB: 4096,
};

/**
 * Population benchmark result
 */
interface PopulationBenchmarkResult {
  scale: string;
  fileCount: number;
  totalDurationMs: number;
  perFileDurationMs: number;
  nodesCreated: number;
  relationshipsCreated: number;
  memoryStartMB: number;
  memoryPeakMB: number;
  memoryGrowthMB: number;
  filesPerSecond: number;
  passedTarget: boolean;
}

/**
 * Phase timing breakdown
 */
interface PhaseTiming {
  phase: string;
  durationMs: number;
  percentage: number;
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
 * Delete all test data from Neo4j
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

describe.skipIf(!shouldRunBenchmarks)("Graph Population Benchmarks", () => {
  let neo4jClient: Neo4jStorageClientImpl;
  let neo4jAvailable: boolean;
  let entityExtractor: EntityExtractor;
  let relationshipExtractor: RelationshipExtractor;
  let ingestionService: GraphIngestionService;

  // Benchmark results for final report
  const benchmarkResults: PopulationBenchmarkResult[] = [];

  beforeAll(async () => {
    initializeLogger({ level: verbose ? "debug" : "silent", format: "json" });
    neo4jAvailable = await isNeo4jAvailable();

    if (!neo4jAvailable) {
      console.log("Neo4j is not available. Population benchmarks will be skipped.");
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
  }, 120000);

  afterAll(async () => {
    if (neo4jClient) {
      await neo4jClient.disconnect();
    }
    resetLogger();

    // Print final benchmark summary
    if (benchmarkResults.length > 0) {
      printBenchmarkSummary(benchmarkResults);
    }
  });

  /**
   * Run population benchmark for a given scale
   */
  async function runPopulationBenchmark(
    scaleName: string,
    config: typeof SCALE_TEST_CONFIGS.small
  ): Promise<PopulationBenchmarkResult> {
    const repoName = `bench-${scaleName}-${Date.now()}`;

    // Generate test data
    console.log(`\nGenerating ${config.fileCount} files for ${scaleName} benchmark...`);
    const generator = new LargeScaleGenerator(config);
    const generatedRepo = generator.generateLargeRepository(repoName);
    const fileInputs = LargeScaleGenerator.toFileInputs(generatedRepo);

    console.log(`Generated repository stats:`);
    console.log(`  Files: ${generatedRepo.stats.totalFiles}`);
    console.log(`  Functions: ${generatedRepo.stats.totalFunctions}`);
    console.log(`  Classes: ${generatedRepo.stats.totalClasses}`);
    console.log(`  Imports: ${generatedRepo.stats.totalImports}`);
    console.log(`  Avg imports/file: ${generatedRepo.stats.avgImportsPerFile.toFixed(2)}`);

    // Track memory
    const memoryBefore = measureMemory();
    let memoryPeak = memoryBefore;

    // Track phase timings
    const phaseTimings: PhaseTiming[] = [];
    let lastPhaseStart = performance.now();
    let lastPhase = "initializing";

    // Progress callback
    const onProgress = (progress: GraphIngestionProgress): void => {
      const currentMemory = measureMemory();
      if (currentMemory.heapUsed > memoryPeak.heapUsed) {
        memoryPeak = currentMemory;
      }

      if (progress.phase !== lastPhase) {
        const phaseDuration = performance.now() - lastPhaseStart;
        phaseTimings.push({
          phase: lastPhase,
          durationMs: phaseDuration,
          percentage: 0, // Calculated later
        });
        lastPhase = progress.phase;
        lastPhaseStart = performance.now();

        if (verbose) {
          console.log(`  Phase: ${progress.phase} (${progress.percentage}%)`);
        }
      }
    };

    // Run ingestion
    console.log(`Starting graph population...`);
    const startTime = performance.now();

    try {
      const result = await ingestionService.ingestFiles(fileInputs, {
        repository: repoName,
        repositoryUrl: `https://github.com/test/${repoName}`,
        force: true,
        onProgress,
      });

      const totalDurationMs = performance.now() - startTime;

      // Add final phase
      phaseTimings.push({
        phase: lastPhase,
        durationMs: performance.now() - lastPhaseStart,
        percentage: 0,
      });

      // Calculate percentages
      for (const phase of phaseTimings) {
        phase.percentage = (phase.durationMs / totalDurationMs) * 100;
      }

      // Calculate metrics
      const perFileDurationMs = totalDurationMs / config.fileCount;
      const filesPerSecond = (config.fileCount / totalDurationMs) * 1000;
      const memoryGrowthMB = (memoryPeak.heapUsed - memoryBefore.heapUsed) / 1024 / 1024;

      // Determine if target was met (extrapolate to 10K scale)
      const extrapolatedTo10K = (totalDurationMs / config.fileCount) * 10000;
      const passedTarget = extrapolatedTo10K <= TARGETS.fullPopulation10K;

      const benchResult: PopulationBenchmarkResult = {
        scale: scaleName,
        fileCount: config.fileCount,
        totalDurationMs,
        perFileDurationMs,
        nodesCreated: result.stats.nodesCreated,
        relationshipsCreated: result.stats.relationshipsCreated,
        memoryStartMB: memoryBefore.heapUsed / 1024 / 1024,
        memoryPeakMB: memoryPeak.heapUsed / 1024 / 1024,
        memoryGrowthMB,
        filesPerSecond,
        passedTarget,
      };

      // Print detailed results
      console.log(`\n${scaleName} Population Results:`);
      console.log(`  Total duration: ${formatDuration(totalDurationMs)}`);
      console.log(`  Per-file average: ${perFileDurationMs.toFixed(2)}ms`);
      console.log(`  Files/second: ${filesPerSecond.toFixed(2)}`);
      console.log(`  Nodes created: ${result.stats.nodesCreated}`);
      console.log(`  Relationships created: ${result.stats.relationshipsCreated}`);
      console.log(`  Memory growth: ${memoryGrowthMB.toFixed(2)} MB`);
      console.log(`  Extrapolated 10K time: ${formatDuration(extrapolatedTo10K)}`);
      console.log(`  Target: ${passedTarget ? "PASS" : "FAIL"} (< 30 min for 10K)`);

      if (verbose) {
        console.log(`\nPhase breakdown:`);
        for (const phase of phaseTimings) {
          console.log(
            `  ${phase.phase}: ${phase.durationMs.toFixed(0)}ms (${phase.percentage.toFixed(1)}%)`
          );
        }
      }

      return benchResult;
    } finally {
      // Cleanup test data
      await cleanupTestData(neo4jClient, repoName);
    }
  }

  test("population benchmark - 1K files (baseline)", async () => {
    if (!neo4jAvailable) {
      console.log("Skipping: Neo4j not available");
      return;
    }

    const result = await runPopulationBenchmark("1K", SCALE_TEST_CONFIGS.small);
    benchmarkResults.push(result);

    // Per-file should be under target
    expect(result.perFileDurationMs).toBeLessThan(TARGETS.perFileIndexing * 3);
  }, 600000); // 10 minute timeout

  test("population benchmark - 5K files (medium scale)", async () => {
    if (!neo4jAvailable) {
      console.log("Skipping: Neo4j not available");
      return;
    }

    const result = await runPopulationBenchmark("5K", SCALE_TEST_CONFIGS.medium);
    benchmarkResults.push(result);

    // Check scaling behavior
    expect(result.perFileDurationMs).toBeLessThan(TARGETS.perFileIndexing * 2);
  }, 1200000); // 20 minute timeout

  test("population benchmark - 10K files (PRD target)", async () => {
    if (!neo4jAvailable) {
      console.log("Skipping: Neo4j not available");
      return;
    }

    const result = await runPopulationBenchmark("10K", SCALE_TEST_CONFIGS.large);
    benchmarkResults.push(result);

    // Must meet PRD target
    expect(result.totalDurationMs).toBeLessThan(TARGETS.fullPopulation10K);
    expect(result.perFileDurationMs).toBeLessThan(TARGETS.perFileIndexing * 1.5);
    expect(result.memoryGrowthMB).toBeLessThan(TARGETS.maxMemoryGrowthMB);
  }, 2400000); // 40 minute timeout

  test.skip("population benchmark - 15K files (stress test)", async () => {
    // Skip by default as it's beyond PRD requirements
    if (!neo4jAvailable) {
      console.log("Skipping: Neo4j not available");
      return;
    }

    const result = await runPopulationBenchmark("15K", SCALE_TEST_CONFIGS.xlarge);
    benchmarkResults.push(result);

    // Just measure, don't fail on stress test
    expect(result.totalDurationMs).toBeGreaterThan(0);
  }, 3600000); // 60 minute timeout
});

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

/**
 * Print benchmark summary table
 */
function printBenchmarkSummary(results: PopulationBenchmarkResult[]): void {
  console.log("\n" + "=".repeat(100));
  console.log("GRAPH POPULATION BENCHMARK SUMMARY");
  console.log("=".repeat(100));
  console.log(
    "\n| Scale | Files | Duration | Per-File | Files/sec | Nodes | Rels | Memory | Status |"
  );
  console.log(
    "|-------|-------|----------|----------|-----------|-------|------|--------|--------|"
  );

  for (const result of results) {
    const status = result.passedTarget ? "PASS" : "FAIL";
    console.log(
      `| ${result.scale.padEnd(5)} | ${String(result.fileCount).padStart(5)} | ${formatDuration(result.totalDurationMs).padStart(8)} | ${result.perFileDurationMs.toFixed(0).padStart(6)}ms | ${result.filesPerSecond.toFixed(1).padStart(9)} | ${String(result.nodesCreated).padStart(5)} | ${String(result.relationshipsCreated).padStart(4)} | ${result.memoryGrowthMB.toFixed(0).padStart(4)}MB | ${status.padStart(6)} |`
    );
  }

  console.log("\n" + "=".repeat(100));

  // PRD Target Check
  console.log("\nPRD Target Validation:");
  console.log(`  Full 10K population: < 30 minutes`);
  console.log(`  Per-file indexing: < ${TARGETS.perFileIndexing}ms`);

  const target10K = results.find((r) => r.scale === "10K");
  if (target10K) {
    const passedTime = target10K.totalDurationMs < TARGETS.fullPopulation10K;
    const passedPerFile = target10K.perFileDurationMs < TARGETS.perFileIndexing;
    console.log(
      `\n  10K Result: ${formatDuration(target10K.totalDurationMs)} (${passedTime ? "PASS" : "FAIL"})`
    );
    console.log(
      `  Per-file: ${target10K.perFileDurationMs.toFixed(2)}ms (${passedPerFile ? "PASS" : "FAIL"})`
    );
  }

  console.log("=".repeat(100) + "\n");
}

// Print instructions if benchmarks are skipped
if (!shouldRunBenchmarks) {
  console.log(
    "\n⏱️ Graph population benchmarks are SKIPPED by default.\n" +
      "These benchmarks test large-scale graph population (1K-10K+ files).\n\n" +
      "To run these benchmarks:\n\n" +
      "  RUN_SCALE_BENCHMARKS=true bun test tests/benchmarks/graph-population.bench.ts\n\n" +
      "With verbose output:\n" +
      "  RUN_SCALE_BENCHMARKS=true VERBOSE=true bun test tests/benchmarks/graph-population.bench.ts\n\n" +
      "Prerequisites:\n" +
      "  - Neo4j running (docker-compose up -d neo4j)\n" +
      "  - At least 4GB memory available\n" +
      "  - Tests may take 30+ minutes for full 10K benchmark\n"
  );
}
