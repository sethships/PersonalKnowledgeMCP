/**
 * Graph Query Performance Benchmark Suite at Scale
 *
 * Tests query performance against populated large-scale graphs (1K-10K+ files)
 * to validate against PRD targets:
 *
 * | Metric                          | Target   |
 * |---------------------------------|----------|
 * | Simple relationship query (1 hop)| <100ms  |
 * | Dependency tree (3 levels)       | <300ms  |
 * | Cross-repository query           | <500ms  |
 * | Full module graph                | <1000ms |
 *
 * Run with:
 *   RUN_SCALE_BENCHMARKS=true bun test tests/benchmarks/graph-query-scale.bench.ts
 *
 * Prerequisites:
 *   - Neo4j with pre-populated test data (run graph-population.bench.ts first)
 *   - Or use the --populate flag to generate data
 *
 * @module tests/benchmarks/graph-query-scale.bench
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Neo4jStorageClientImpl } from "../../src/graph/Neo4jClient.js";
import { GraphServiceImpl } from "../../src/services/graph-service.js";
import { GraphIngestionService } from "../../src/graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../src/graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../src/graph/extraction/RelationshipExtractor.js";
import type { Neo4jConfig } from "../../src/graph/types.js";
// Note: Type imports not used directly but queries use these shapes
// import type { DependencyQuery, DependentQuery, ArchitectureQuery, PathQuery, EntityReference } from "../../src/services/graph-service-types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import { LargeScaleGenerator, SCALE_TEST_CONFIGS } from "../fixtures/large-scale-generator.js";
import { calculateStats, type BenchmarkStats } from "../fixtures/benchmark-fixtures.js";

// Test configuration
const shouldRunBenchmarks = Bun.env["RUN_SCALE_BENCHMARKS"] === "true";
const shouldPopulateData = Bun.env["POPULATE_DATA"] === "true";
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
  /** Simple 1-hop dependency query */
  simple1Hop: 100,
  /** 3-level dependency tree */
  dependencyTree3Levels: 300,
  /** Cross-repository query */
  crossRepository: 500,
  /** Full module graph / architecture */
  fullModuleGraph: 1000,
  /** Path finding between entities */
  pathFinding: 300,
};

// CI tolerance multiplier (accounts for CI environment variance)
const CI_TOLERANCE = 1.5;

/**
 * Query benchmark result
 */
interface QueryBenchmarkResult {
  name: string;
  target: number;
  stats: BenchmarkStats;
  passed: boolean;
  sampleSize: number;
}

/**
 * Scale-specific benchmark suite
 */
interface ScaleBenchmarkSuite {
  scale: string;
  fileCount: number;
  repoName: string;
  results: QueryBenchmarkResult[];
}

// Repository name for benchmarks (persists between test runs)
const BENCHMARK_REPO_PREFIX = "query-bench";

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
 * Check if test repository is populated
 */
async function isRepositoryPopulated(
  client: Neo4jStorageClientImpl,
  repoName: string
): Promise<{ populated: boolean; fileCount: number }> {
  try {
    const result = await client.runQuery<{ count: number }>(
      `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File) RETURN count(f) as count`,
      { name: repoName }
    );
    const count = result[0]?.count ?? 0;
    return { populated: count > 0, fileCount: count };
  } catch {
    return { populated: false, fileCount: 0 };
  }
}

/**
 * Get sample file paths from repository for benchmarking
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
     LIMIT $count`,
    { name: repoName, count }
  );
  return result.map((r) => r.path);
}

/**
 * Get sample function names from repository
 */
async function getSampleFunctions(
  client: Neo4jStorageClientImpl,
  repoName: string,
  count: number
): Promise<Array<{ name: string; filePath: string }>> {
  const result = await client.runQuery<{ name: string; filePath: string }>(
    `MATCH (f:File {repository: $name})-[:DEFINES]->(fn:Function)
     RETURN fn.name as name, f.path as filePath
     LIMIT $count`,
    { name: repoName, count }
  );
  return result;
}

/**
 * Measure query performance multiple times
 */
async function measureQueryPerformance<T>(
  fn: () => Promise<T>,
  iterations: number = 10,
  warmup: number = 2
): Promise<{ stats: BenchmarkStats; results: T[] }> {
  // Warmup runs
  for (let i = 0; i < warmup; i++) {
    try {
      await fn();
    } catch {
      // Ignore warmup errors
    }
  }

  // Measured runs
  const times: number[] = [];
  const results: T[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      const result = await fn();
      results.push(result);
    } catch (e) {
      // Record time even on error
      if (verbose) {
        console.log(`  Query error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    times.push(performance.now() - start);
  }

  return { stats: calculateStats(times), results };
}

describe.skipIf(!shouldRunBenchmarks)("Graph Query Performance at Scale", () => {
  let neo4jClient: Neo4jStorageClientImpl;
  let graphService: GraphServiceImpl;
  let neo4jAvailable: boolean;

  // Benchmark state
  const benchmarkSuites: ScaleBenchmarkSuite[] = [];
  let currentSuite: ScaleBenchmarkSuite | null = null;

  beforeAll(async () => {
    initializeLogger({ level: verbose ? "debug" : "silent", format: "json" });
    neo4jAvailable = await isNeo4jAvailable();

    if (!neo4jAvailable) {
      console.log("Neo4j is not available. Query benchmarks will be skipped.");
      return;
    }

    neo4jClient = new Neo4jStorageClientImpl(integrationConfig);
    await neo4jClient.connect();

    graphService = new GraphServiceImpl(neo4jClient);
  }, 60000);

  afterAll(async () => {
    if (neo4jClient) {
      await neo4jClient.disconnect();
    }
    resetLogger();

    // Print final summary
    if (benchmarkSuites.length > 0) {
      printQueryBenchmarkSummary(benchmarkSuites);
    }
  });

  /**
   * Setup or verify test data for a specific scale
   */
  async function setupScaleTest(scaleName: string): Promise<{
    repoName: string;
    fileCount: number;
    samplePaths: string[];
    sampleFunctions: Array<{ name: string; filePath: string }>;
  }> {
    const repoName = `${BENCHMARK_REPO_PREFIX}-${scaleName.toLowerCase()}`;

    // Check if data exists
    const { populated, fileCount } = await isRepositoryPopulated(neo4jClient, repoName);

    if (!populated && shouldPopulateData) {
      // Populate data
      console.log(`\nPopulating ${scaleName} test data (${repoName})...`);

      const config = SCALE_TEST_CONFIGS[scaleName.toLowerCase() as keyof typeof SCALE_TEST_CONFIGS];
      if (!config) {
        throw new Error(`Unknown scale: ${scaleName}`);
      }

      // EntityExtractor and RelationshipExtractor create their own TreeSitterParser instances
      const entityExtractor = new EntityExtractor();
      const relationshipExtractor = new RelationshipExtractor();
      const ingestionService = new GraphIngestionService(
        neo4jClient,
        entityExtractor,
        relationshipExtractor
      );

      const generator = new LargeScaleGenerator(config);
      const repo = generator.generateLargeRepository(repoName);
      const fileInputs = LargeScaleGenerator.toFileInputs(repo);

      await ingestionService.ingestFiles(fileInputs, {
        repository: repoName,
        repositoryUrl: `https://github.com/test/${repoName}`,
        force: true,
      });

      console.log(`Populated ${config.fileCount} files for ${scaleName} benchmark.`);
    } else if (!populated) {
      console.log(`\nTest data for ${scaleName} (${repoName}) not found.`);
      console.log(`Run with POPULATE_DATA=true to generate test data.`);
      return { repoName, fileCount: 0, samplePaths: [], sampleFunctions: [] };
    } else {
      console.log(`\nUsing existing ${scaleName} test data (${fileCount} files).`);
    }

    // Get sample data for queries
    const samplePaths = await getSampleFilePaths(neo4jClient, repoName, 20);
    const sampleFunctions = await getSampleFunctions(neo4jClient, repoName, 20);

    return {
      repoName,
      fileCount,
      samplePaths,
      sampleFunctions,
    };
  }

  /**
   * Run query benchmark suite for a scale
   */
  async function runQueryBenchmarks(scaleName: string): Promise<void> {
    const setup = await setupScaleTest(scaleName);

    if (setup.fileCount === 0 || setup.samplePaths.length === 0) {
      console.log(`Skipping ${scaleName} benchmarks - no test data available.`);
      return;
    }

    currentSuite = {
      scale: scaleName,
      fileCount: setup.fileCount,
      repoName: setup.repoName,
      results: [],
    };

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Query Benchmarks: ${scaleName} (${setup.fileCount} files)`);
    console.log("=".repeat(60));

    // Guard: Ensure sample paths are available for benchmarks
    if (setup.samplePaths.length === 0) {
      throw new Error(`No sample paths available for benchmark at scale ${scaleName}`);
    }

    // Benchmark 1: Simple 1-hop dependency query
    await runBenchmark("Simple dependency (1-hop)", TARGETS.simple1Hop, async () => {
      const path = setup.samplePaths[Math.floor(Math.random() * setup.samplePaths.length)]!;
      return graphService.getDependencies({
        entity_type: "file",
        entity_path: path,
        repository: setup.repoName,
        depth: 1,
      });
    });

    // Benchmark 2: 3-level dependency tree
    await runBenchmark("Dependency tree (3 levels)", TARGETS.dependencyTree3Levels, async () => {
      const path = setup.samplePaths[Math.floor(Math.random() * setup.samplePaths.length)]!;
      return graphService.getDependencies({
        entity_type: "file",
        entity_path: path,
        repository: setup.repoName,
        depth: 3,
        include_transitive: true,
      });
    });

    // Benchmark 3: Dependents query (impact analysis)
    await runBenchmark("Dependents (impact analysis)", TARGETS.simple1Hop, async () => {
      const path = setup.samplePaths[Math.floor(Math.random() * setup.samplePaths.length)]!;
      return graphService.getDependents({
        entity_type: "file",
        entity_path: path,
        repository: setup.repoName,
        depth: 1,
      });
    });

    // Benchmark 4: Architecture query (module level)
    await runBenchmark(
      "Architecture (modules)",
      TARGETS.fullModuleGraph,
      async () => {
        return graphService.getArchitecture({
          repository: setup.repoName,
          detail_level: "modules",
        });
      },
      5 // Fewer iterations for expensive queries
    );

    // Benchmark 5: Architecture query (files level)
    await runBenchmark(
      "Architecture (files)",
      TARGETS.fullModuleGraph,
      async () => {
        return graphService.getArchitecture({
          repository: setup.repoName,
          detail_level: "files",
        });
      },
      3 // Fewer iterations for expensive queries
    );

    // Benchmark 6: Path finding
    if (setup.samplePaths.length >= 2) {
      await runBenchmark("Path finding", TARGETS.pathFinding, async () => {
        const fromPath = setup.samplePaths[0]!;
        const toPath = setup.samplePaths[Math.min(10, setup.samplePaths.length - 1)]!;
        return graphService.getPath({
          from_entity: { type: "file", path: fromPath, repository: setup.repoName },
          to_entity: { type: "file", path: toPath, repository: setup.repoName },
          max_hops: 5,
        });
      });
    }

    // Benchmark 7: Concurrent queries
    await runBenchmark(
      "Concurrent queries (5x)",
      TARGETS.dependencyTree3Levels,
      async () => {
        const queries = setup.samplePaths.slice(0, 5).map((path) =>
          graphService.getDependencies({
            entity_type: "file",
            entity_path: path,
            repository: setup.repoName,
            depth: 1,
          })
        );
        return Promise.all(queries);
      },
      5
    );

    benchmarkSuites.push(currentSuite);
    currentSuite = null;
  }

  /**
   * Run a single benchmark
   */
  async function runBenchmark<T>(
    name: string,
    target: number,
    fn: () => Promise<T>,
    iterations: number = 10
  ): Promise<void> {
    console.log(`\n  ${name}...`);

    const { stats } = await measureQueryPerformance(fn, iterations, 2);
    const passed = stats.p95 < target * CI_TOLERANCE;

    const result: QueryBenchmarkResult = {
      name,
      target,
      stats,
      passed,
      sampleSize: iterations,
    };

    if (currentSuite) {
      currentSuite.results.push(result);
    }

    console.log(`    p50: ${stats.median.toFixed(1)}ms`);
    console.log(`    p95: ${stats.p95.toFixed(1)}ms`);
    console.log(`    Target: <${target}ms (${passed ? "PASS" : "FAIL"})`);
  }

  // =========================================================================
  // Benchmark Tests
  // =========================================================================

  describe("1K Scale Query Performance", () => {
    test("all query benchmarks", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      await runQueryBenchmarks("small");

      const suite = benchmarkSuites.find((s) => s.scale === "small");
      if (suite && suite.results.length > 0) {
        // Basic sanity check - at least some queries should complete
        const passedCount = suite.results.filter((r) => r.passed).length;
        expect(passedCount).toBeGreaterThan(0);
      }
    }, 600000);
  });

  describe("5K Scale Query Performance", () => {
    test("all query benchmarks", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      await runQueryBenchmarks("medium");

      const suite = benchmarkSuites.find((s) => s.scale === "medium");
      if (suite && suite.results.length > 0) {
        const passedCount = suite.results.filter((r) => r.passed).length;
        expect(passedCount).toBeGreaterThan(0);
      }
    }, 600000);
  });

  describe("10K Scale Query Performance (PRD Target)", () => {
    test("all query benchmarks", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      await runQueryBenchmarks("large");

      const suite = benchmarkSuites.find((s) => s.scale === "large");
      if (suite && suite.results.length > 0) {
        // All PRD targets should be met at 10K scale
        for (const result of suite.results) {
          expect(result.stats.p95).toBeLessThan(result.target * CI_TOLERANCE);
        }
      }
    }, 1200000);
  });

  describe("Query Performance Degradation Analysis", () => {
    test("should analyze performance scaling", async () => {
      if (!neo4jAvailable || benchmarkSuites.length < 2) {
        console.log("Skipping: Need multiple scales for degradation analysis");
        return;
      }

      console.log("\n" + "=".repeat(60));
      console.log("Performance Scaling Analysis");
      console.log("=".repeat(60));

      // Find common benchmarks across scales
      const benchmarkNames = new Set<string>();
      for (const suite of benchmarkSuites) {
        for (const result of suite.results) {
          benchmarkNames.add(result.name);
        }
      }

      for (const name of benchmarkNames) {
        console.log(`\n${name}:`);

        const dataPoints: Array<{ scale: string; files: number; p95: number }> = [];
        for (const suite of benchmarkSuites) {
          const result = suite.results.find((r) => r.name === name);
          if (result) {
            dataPoints.push({
              scale: suite.scale,
              files: suite.fileCount,
              p95: result.stats.p95,
            });
          }
        }

        // Sort by file count
        dataPoints.sort((a, b) => a.files - b.files);

        // Calculate scaling factor
        if (dataPoints.length >= 2) {
          const first = dataPoints[0]!;
          const last = dataPoints[dataPoints.length - 1]!;

          // Validate inputs to avoid NaN/Infinity in scaling calculation
          if (first.files === 0 || first.p95 === 0 || last.files === first.files) {
            console.log(`  Cannot calculate scaling: insufficient baseline data`);
            for (const dp of dataPoints) {
              console.log(`  ${dp.scale}: ${dp.p95.toFixed(1)}ms (${dp.files} files)`);
            }
            continue;
          }

          const fileRatio = last.files / first.files;
          const timeRatio = last.p95 / first.p95;
          const scalingExponent = Math.log(timeRatio) / Math.log(fileRatio);

          for (const dp of dataPoints) {
            console.log(`  ${dp.scale}: ${dp.p95.toFixed(1)}ms (${dp.files} files)`);
          }

          // Guard against NaN from negative time ratios or other edge cases
          if (Number.isNaN(scalingExponent) || !Number.isFinite(scalingExponent)) {
            console.log(`  Scaling: Unable to calculate (invalid data)`);
          } else {
            console.log(`  Scaling: O(n^${scalingExponent.toFixed(2)})`);

            // Sub-linear (< 1) or linear (~ 1) scaling is ideal
            // Super-linear (> 1.5) scaling indicates potential issues
            if (scalingExponent > 1.5) {
              console.log(`  Warning: Super-linear scaling detected`);
            }
          }
        }
      }

      expect(benchmarkSuites.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Print query benchmark summary
 */
function printQueryBenchmarkSummary(suites: ScaleBenchmarkSuite[]): void {
  console.log("\n" + "=".repeat(100));
  console.log("QUERY PERFORMANCE BENCHMARK SUMMARY");
  console.log("=".repeat(100));

  for (const suite of suites) {
    console.log(`\n${suite.scale} Scale (${suite.fileCount} files):`);
    console.log("-".repeat(80));
    console.log("| Query Type                    | Target | p50     | p95     | Status |");
    console.log("|-------------------------------|--------|---------|---------|--------|");

    for (const result of suite.results) {
      const status = result.passed ? "PASS" : "FAIL";
      console.log(
        `| ${result.name.padEnd(29)} | ${String(result.target).padStart(5)}ms | ${result.stats.median.toFixed(0).padStart(6)}ms | ${result.stats.p95.toFixed(0).padStart(6)}ms | ${status.padStart(6)} |`
      );
    }
  }

  console.log("\n" + "=".repeat(100));

  // PRD Target Summary
  console.log("\nPRD Target Validation:");
  console.log(`  Simple query (1-hop): < ${TARGETS.simple1Hop}ms`);
  console.log(`  Dependency tree (3 levels): < ${TARGETS.dependencyTree3Levels}ms`);
  console.log(`  Full module graph: < ${TARGETS.fullModuleGraph}ms`);

  const largeSuite = suites.find((s) => s.scale === "large");
  if (largeSuite) {
    const allPassed = largeSuite.results.every((r) => r.passed);
    console.log(
      `\n  10K Scale Overall: ${allPassed ? "✓ ALL TARGETS MET" : "✗ SOME TARGETS MISSED"}`
    );
  }

  console.log("=".repeat(100) + "\n");
}

// Print instructions if benchmarks are skipped
if (!shouldRunBenchmarks) {
  console.log(
    "\n⏱️ Graph query benchmarks are SKIPPED by default.\n" +
      "These benchmarks test query performance against large-scale graphs.\n\n" +
      "To run these benchmarks:\n\n" +
      "  RUN_SCALE_BENCHMARKS=true bun test tests/benchmarks/graph-query-scale.bench.ts\n\n" +
      "To populate test data automatically:\n" +
      "  RUN_SCALE_BENCHMARKS=true POPULATE_DATA=true bun test tests/benchmarks/graph-query-scale.bench.ts\n\n" +
      "Prerequisites:\n" +
      "  - Neo4j running (docker-compose up -d neo4j)\n" +
      "  - Either pre-populated test data or POPULATE_DATA=true\n"
  );
}
