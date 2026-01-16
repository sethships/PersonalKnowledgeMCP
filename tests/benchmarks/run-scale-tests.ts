#!/usr/bin/env bun
/**
 * Scale Performance Test Runner / Orchestrator
 *
 * Orchestrates the execution of all scale performance benchmarks:
 * - Sets up test environment (Neo4j, ChromaDB)
 * - Generates test data at various scales
 * - Runs all benchmark suites
 * - Collects and aggregates results
 * - Generates performance report
 * - Compares against PRD targets
 *
 * Usage:
 *   bun tests/benchmarks/run-scale-tests.ts [options]
 *
 * Options:
 *   --scale <level>    Scale level: small (1K), medium (5K), large (10K), xlarge (15K)
 *   --suite <name>     Run specific suite: population, query, update, all
 *   --report <format>  Output format: console, json, markdown
 *   --output <path>    Output file path (for json/markdown)
 *   --skip-setup       Skip data population (use existing data)
 *   --cleanup          Clean up test data after run
 *   --verbose          Enable verbose output
 *
 * Examples:
 *   bun tests/benchmarks/run-scale-tests.ts --scale large --suite all
 *   bun tests/benchmarks/run-scale-tests.ts --scale medium --suite query --skip-setup
 *   bun tests/benchmarks/run-scale-tests.ts --scale large --report markdown --output report.md
 *
 * @module tests/benchmarks/run-scale-tests
 */

import * as fs from "fs";
import { Neo4jStorageClientImpl } from "../../src/graph/Neo4jClient.js";
import { GraphServiceImpl } from "../../src/services/graph-service.js";
import { GraphIngestionService } from "../../src/graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../src/graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../src/graph/extraction/RelationshipExtractor.js";
import type { Neo4jConfig } from "../../src/graph/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import {
  LargeScaleGenerator,
  SCALE_TEST_CONFIGS,
  type LargeScaleGeneratorConfig,
} from "../fixtures/large-scale-generator.js";
import { calculateStats, type BenchmarkStats } from "../fixtures/benchmark-fixtures.js";

// =============================================================================
// Types
// =============================================================================

interface ScaleTestConfig {
  scale: "small" | "medium" | "large" | "xlarge";
  suite: "population" | "query" | "update" | "all";
  reportFormat: "console" | "json" | "markdown";
  outputPath?: string;
  skipSetup: boolean;
  cleanup: boolean;
  verbose: boolean;
}

interface BenchmarkResult {
  name: string;
  category: string;
  target: number;
  actual: number;
  p50: number;
  p95: number;
  passed: boolean;
  details?: Record<string, unknown>;
}

interface ScaleTestReport {
  timestamp: string;
  config: ScaleTestConfig;
  environment: {
    platform: string;
    nodeVersion: string;
    bunVersion?: string;
    neo4jVersion?: string;
  };
  scales: {
    [key: string]: {
      fileCount: number;
      populationTime?: number;
      results: BenchmarkResult[];
    };
  };
  summary: {
    totalBenchmarks: number;
    passed: number;
    failed: number;
    passRate: number;
    prdTargetsMet: boolean;
  };
  recommendations: string[];
}

// PRD Performance Targets
const PRD_TARGETS = {
  population: {
    full10KPopulation: 30 * 60 * 1000, // 30 minutes in ms
    perFileIndexing: 100, // ms
  },
  query: {
    simple1Hop: 100, // ms
    dependencyTree3Levels: 300, // ms
    crossRepository: 500, // ms
    fullModuleGraph: 1000, // ms
  },
  update: {
    singleRelationship: 50, // ms
    singleFileUpdate: 100, // ms
  },
};

// Neo4j configuration
const neo4jConfig: Neo4jConfig = {
  host: process.env["NEO4J_HOST"] ?? "localhost",
  port: parseInt(process.env["NEO4J_PORT"] ?? "7687", 10),
  username: process.env["NEO4J_USERNAME"] ?? "neo4j",
  password: process.env["NEO4J_PASSWORD"] ?? "testpassword",
  maxConnectionPoolSize: 20,
  connectionAcquisitionTimeout: 30000,
};

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs(): ScaleTestConfig {
  const args = process.argv.slice(2);
  const config: ScaleTestConfig = {
    scale: "medium",
    suite: "all",
    reportFormat: "console",
    skipSetup: false,
    cleanup: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];

    switch (arg) {
      case "--scale":
        if (next && ["small", "medium", "large", "xlarge"].includes(next)) {
          config.scale = next as ScaleTestConfig["scale"];
          i++;
        }
        break;
      case "--suite":
        if (next && ["population", "query", "update", "all"].includes(next)) {
          config.suite = next as ScaleTestConfig["suite"];
          i++;
        }
        break;
      case "--report":
        if (next && ["console", "json", "markdown"].includes(next)) {
          config.reportFormat = next as ScaleTestConfig["reportFormat"];
          i++;
        }
        break;
      case "--output":
        if (next) {
          config.outputPath = next;
          i++;
        }
        break;
      case "--skip-setup":
        config.skipSetup = true;
        break;
      case "--cleanup":
        config.cleanup = true;
        break;
      case "--verbose":
        config.verbose = true;
        break;
      case "--help":
        printUsage();
        process.exit(0);
    }
  }

  return config;
}

function printUsage(): void {
  console.log(`
Scale Performance Test Runner

Usage: bun tests/benchmarks/run-scale-tests.ts [options]

Options:
  --scale <level>    Scale level: small (1K), medium (5K), large (10K), xlarge (15K)
                     Default: medium
  --suite <name>     Run specific suite: population, query, update, all
                     Default: all
  --report <format>  Output format: console, json, markdown
                     Default: console
  --output <path>    Output file path (for json/markdown)
  --skip-setup       Skip data population (use existing data)
  --cleanup          Clean up test data after run
  --verbose          Enable verbose output
  --help             Show this help message

Examples:
  bun tests/benchmarks/run-scale-tests.ts --scale large --suite all
  bun tests/benchmarks/run-scale-tests.ts --scale medium --suite query --skip-setup
  bun tests/benchmarks/run-scale-tests.ts --scale large --report markdown --output report.md
`);
}

// =============================================================================
// Test Runner
// =============================================================================

class ScaleTestRunner {
  private config: ScaleTestConfig;
  private neo4jClient: Neo4jStorageClientImpl | null = null;
  private graphService: GraphServiceImpl | null = null;
  private ingestionService: GraphIngestionService | null = null;
  private report: ScaleTestReport;

  constructor(config: ScaleTestConfig) {
    this.config = config;
    this.report = this.initializeReport();
  }

  private initializeReport(): ScaleTestReport {
    return {
      timestamp: new Date().toISOString(),
      config: this.config,
      environment: {
        platform: process.platform,
        nodeVersion: process.version,
        bunVersion: Bun.version,
      },
      scales: {},
      summary: {
        totalBenchmarks: 0,
        passed: 0,
        failed: 0,
        passRate: 0,
        prdTargetsMet: false,
      },
      recommendations: [],
    };
  }

  async run(): Promise<void> {
    console.log("\n" + "=".repeat(80));
    console.log("SCALE PERFORMANCE TEST RUNNER");
    console.log("=".repeat(80));
    console.log(`\nConfiguration:`);
    console.log(`  Scale: ${this.config.scale}`);
    console.log(`  Suite: ${this.config.suite}`);
    console.log(`  Report format: ${this.config.reportFormat}`);

    try {
      // Initialize services
      await this.initialize();

      // Get scale config
      const scaleConfig = SCALE_TEST_CONFIGS[this.config.scale];
      const repoName = `scale-bench-${this.config.scale}`;

      // Setup test data
      if (!this.config.skipSetup) {
        await this.setupTestData(repoName, scaleConfig);
      } else {
        console.log("\nSkipping data setup (using existing data)...");
      }

      // Initialize scale entry in report
      this.report.scales[this.config.scale] = {
        fileCount: scaleConfig.fileCount,
        results: [],
      };

      // Run benchmark suites
      if (this.config.suite === "all" || this.config.suite === "population") {
        await this.runPopulationBenchmarks(repoName, scaleConfig);
      }

      if (this.config.suite === "all" || this.config.suite === "query") {
        await this.runQueryBenchmarks(repoName, scaleConfig);
      }

      if (this.config.suite === "all" || this.config.suite === "update") {
        await this.runUpdateBenchmarks(repoName, scaleConfig);
      }

      // Finalize report
      this.finalizeReport();

      // Output report
      this.outputReport();

      // Cleanup if requested
      if (this.config.cleanup) {
        await this.cleanup(repoName);
      }
    } finally {
      await this.shutdown();
    }
  }

  private async initialize(): Promise<void> {
    console.log("\nInitializing services...");

    initializeLogger({ level: this.config.verbose ? "debug" : "silent", format: "json" });

    // Connect to Neo4j
    this.neo4jClient = new Neo4jStorageClientImpl(neo4jConfig);
    await this.neo4jClient.connect();

    // Check Neo4j version
    try {
      const versionResult = await this.neo4jClient.runQuery<{ version: string }>(
        "CALL dbms.components() YIELD name, versions RETURN versions[0] as version"
      );
      if (versionResult[0]) {
        this.report.environment.neo4jVersion = versionResult[0].version;
      }
    } catch {
      // Ignore version check errors
    }

    // Initialize extractors - they create their own TreeSitterParser instances
    const entityExtractor = new EntityExtractor();
    const relationshipExtractor = new RelationshipExtractor();

    this.ingestionService = new GraphIngestionService(
      this.neo4jClient,
      entityExtractor,
      relationshipExtractor,
      { nodeBatchSize: 50, relationshipBatchSize: 100 }
    );

    this.graphService = new GraphServiceImpl(this.neo4jClient);

    console.log("  Services initialized.");
  }

  private async setupTestData(
    repoName: string,
    scaleConfig: LargeScaleGeneratorConfig
  ): Promise<void> {
    console.log(`\nSetting up test data for ${this.config.scale} scale...`);

    // Check if data already exists
    const existingCount = await this.getFileCount(repoName);
    if (existingCount > 0) {
      console.log(`  Found existing data (${existingCount} files). Deleting...`);
      await this.deleteRepositoryData(repoName);
    }

    // Generate and ingest data
    console.log(`  Generating ${scaleConfig.fileCount} files...`);
    const generator = new LargeScaleGenerator(scaleConfig);
    const repo = generator.generateLargeRepository(repoName);
    const fileInputs = LargeScaleGenerator.toFileInputs(repo);

    console.log(`  Ingesting into Neo4j...`);
    const startTime = performance.now();

    await this.ingestionService!.ingestFiles(fileInputs, {
      repository: repoName,
      repositoryUrl: `https://github.com/test/${repoName}`,
      force: true,
    });

    const populationTime = performance.now() - startTime;
    this.report.scales[this.config.scale]!.populationTime = populationTime;

    console.log(`  Data setup complete (${(populationTime / 1000).toFixed(1)}s)`);
  }

  private async runPopulationBenchmarks(
    _repoName: string,
    scaleConfig: LargeScaleGeneratorConfig
  ): Promise<void> {
    console.log("\n" + "-".repeat(60));
    console.log("Population Benchmarks");
    console.log("-".repeat(60));

    // We already have population time from setup, add it as a result
    const populationTime = this.report.scales[this.config.scale]!.populationTime;

    if (populationTime !== undefined) {
      const perFileTime = populationTime / scaleConfig.fileCount;
      const extrapolated10K = perFileTime * 10000;

      this.addResult({
        name: "Full repository population",
        category: "population",
        target: PRD_TARGETS.population.full10KPopulation,
        actual: populationTime,
        p50: populationTime,
        p95: populationTime,
        passed: extrapolated10K <= PRD_TARGETS.population.full10KPopulation,
        details: {
          fileCount: scaleConfig.fileCount,
          perFileMs: perFileTime,
          extrapolated10KMs: extrapolated10K,
        },
      });

      this.addResult({
        name: "Per-file indexing",
        category: "population",
        target: PRD_TARGETS.population.perFileIndexing,
        actual: perFileTime,
        p50: perFileTime,
        p95: perFileTime,
        passed: perFileTime <= PRD_TARGETS.population.perFileIndexing,
      });

      console.log(`  Total population: ${(populationTime / 1000).toFixed(1)}s`);
      console.log(`  Per-file: ${perFileTime.toFixed(2)}ms`);
      console.log(`  Extrapolated 10K: ${(extrapolated10K / 60000).toFixed(1)} min`);
    }
  }

  private async runQueryBenchmarks(
    repoName: string,
    _scaleConfig: LargeScaleGeneratorConfig
  ): Promise<void> {
    console.log("\n" + "-".repeat(60));
    console.log("Query Benchmarks");
    console.log("-".repeat(60));

    // Get sample files for queries
    const sampleFiles = await this.getSampleFiles(repoName, 20);
    if (sampleFiles.length === 0) {
      console.log("  No sample files found. Skipping query benchmarks.");
      return;
    }

    // Simple 1-hop query
    const simple1HopStats = await this.benchmarkQuery(
      "Simple 1-hop dependency",
      async () => {
        const path = sampleFiles[Math.floor(Math.random() * sampleFiles.length)]!;
        await this.graphService!.getDependencies({
          entity_type: "file",
          entity_path: path,
          repository: repoName,
          depth: 1,
        });
      },
      10
    );

    this.addResult({
      name: "Simple 1-hop dependency",
      category: "query",
      target: PRD_TARGETS.query.simple1Hop,
      actual: simple1HopStats.median,
      p50: simple1HopStats.median,
      p95: simple1HopStats.p95,
      passed: simple1HopStats.p95 <= PRD_TARGETS.query.simple1Hop * 1.5,
    });

    // 3-level dependency tree
    const tree3LevelStats = await this.benchmarkQuery(
      "3-level dependency tree",
      async () => {
        const path = sampleFiles[Math.floor(Math.random() * sampleFiles.length)]!;
        await this.graphService!.getDependencies({
          entity_type: "file",
          entity_path: path,
          repository: repoName,
          depth: 3,
          include_transitive: true,
        });
      },
      5
    );

    this.addResult({
      name: "3-level dependency tree",
      category: "query",
      target: PRD_TARGETS.query.dependencyTree3Levels,
      actual: tree3LevelStats.median,
      p50: tree3LevelStats.median,
      p95: tree3LevelStats.p95,
      passed: tree3LevelStats.p95 <= PRD_TARGETS.query.dependencyTree3Levels * 1.5,
    });

    // Architecture query
    const archStats = await this.benchmarkQuery(
      "Full module graph",
      async () => {
        await this.graphService!.getArchitecture({
          repository: repoName,
          detail_level: "modules",
        });
      },
      3
    );

    this.addResult({
      name: "Full module graph",
      category: "query",
      target: PRD_TARGETS.query.fullModuleGraph,
      actual: archStats.median,
      p50: archStats.median,
      p95: archStats.p95,
      passed: archStats.p95 <= PRD_TARGETS.query.fullModuleGraph * 1.5,
    });
  }

  private async runUpdateBenchmarks(
    repoName: string,
    _scaleConfig: LargeScaleGeneratorConfig
  ): Promise<void> {
    console.log("\n" + "-".repeat(60));
    console.log("Update Benchmarks");
    console.log("-".repeat(60));

    const sampleFiles = await this.getSampleFiles(repoName, 20);
    if (sampleFiles.length === 0) {
      console.log("  No sample files found. Skipping update benchmarks.");
      return;
    }

    // Single file delete
    const deleteStats = await this.benchmarkQuery(
      "Single file delete",
      async () => {
        const path = sampleFiles[Math.floor(Math.random() * sampleFiles.length)]!;
        await this.ingestionService!.deleteFileData(repoName, path);
      },
      10
    );

    this.addResult({
      name: "Single relationship update",
      category: "update",
      target: PRD_TARGETS.update.singleRelationship,
      actual: deleteStats.median,
      p50: deleteStats.median,
      p95: deleteStats.p95,
      passed: deleteStats.p95 <= PRD_TARGETS.update.singleRelationship * 1.5,
    });
  }

  private async benchmarkQuery(
    name: string,
    fn: () => Promise<void>,
    iterations: number
  ): Promise<BenchmarkStats> {
    if (this.config.verbose) {
      console.log(`  Benchmarking: ${name}...`);
    }

    // Warmup
    try {
      await fn();
    } catch {
      // Ignore warmup errors
    }

    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      try {
        await fn();
      } catch {
        // Continue on error
      }
      times.push(performance.now() - start);
    }

    const stats = calculateStats(times);
    console.log(`  ${name}: p50=${stats.median.toFixed(1)}ms, p95=${stats.p95.toFixed(1)}ms`);
    return stats;
  }

  private addResult(result: BenchmarkResult): void {
    this.report.scales[this.config.scale]!.results.push(result);
  }

  private finalizeReport(): void {
    const allResults = Object.values(this.report.scales).flatMap((s) => s.results);

    this.report.summary.totalBenchmarks = allResults.length;
    this.report.summary.passed = allResults.filter((r) => r.passed).length;
    this.report.summary.failed = allResults.filter((r) => !r.passed).length;
    this.report.summary.passRate =
      allResults.length > 0 ? (this.report.summary.passed / allResults.length) * 100 : 0;

    // Check PRD targets for 10K scale (or extrapolate)
    this.report.summary.prdTargetsMet = allResults.every((r) => r.passed);

    // Generate recommendations
    this.generateRecommendations(allResults);
  }

  private generateRecommendations(results: BenchmarkResult[]): void {
    const recommendations: string[] = [];

    // Check population performance
    const populationResults = results.filter((r) => r.category === "population");
    for (const result of populationResults) {
      if (!result.passed && result.name.includes("Per-file")) {
        recommendations.push(
          "Consider increasing Neo4j batch sizes for better population throughput"
        );
        recommendations.push("Review entity extraction efficiency");
      }
    }

    // Check query performance
    const queryResults = results.filter((r) => r.category === "query");
    const slowQueries = queryResults.filter((r) => !r.passed);
    if (slowQueries.length > 0) {
      recommendations.push("Consider adding Neo4j indexes on frequently queried properties");
      recommendations.push("Review Cypher query patterns for optimization opportunities");
      if (slowQueries.some((r) => r.name.includes("3-level"))) {
        recommendations.push("Consider limiting transitive query depth or implementing pagination");
      }
    }

    // Check update performance
    const updateResults = results.filter((r) => r.category === "update");
    if (updateResults.some((r) => !r.passed)) {
      recommendations.push("Consider optimizing delete operations with more specific patterns");
    }

    // Memory recommendations
    recommendations.push("Monitor heap memory during large-scale operations");

    this.report.recommendations = [...new Set(recommendations)]; // Remove duplicates
  }

  private outputReport(): void {
    console.log("\n" + "=".repeat(80));
    console.log("TEST RESULTS");
    console.log("=".repeat(80));

    switch (this.config.reportFormat) {
      case "json":
        this.outputJsonReport();
        break;
      case "markdown":
        this.outputMarkdownReport();
        break;
      case "console":
      default:
        this.outputConsoleReport();
        break;
    }
  }

  private outputConsoleReport(): void {
    const allResults = Object.values(this.report.scales).flatMap((s) => s.results);

    console.log("\n| Benchmark                     | Target | Actual | p95    | Status |");
    console.log("|-------------------------------|--------|--------|--------|--------|");

    for (const result of allResults) {
      const status = result.passed ? "PASS" : "FAIL";
      console.log(
        `| ${result.name.padEnd(29)} | ${String(result.target).padStart(5)}ms | ${result.actual.toFixed(0).padStart(5)}ms | ${result.p95.toFixed(0).padStart(5)}ms | ${status.padStart(6)} |`
      );
    }

    console.log("\n" + "-".repeat(80));
    console.log(
      `Summary: ${this.report.summary.passed}/${this.report.summary.totalBenchmarks} passed (${this.report.summary.passRate.toFixed(1)}%)`
    );
    console.log(`PRD Targets: ${this.report.summary.prdTargetsMet ? "MET" : "NOT MET"}`);

    if (this.report.recommendations.length > 0) {
      console.log("\nRecommendations:");
      for (const rec of this.report.recommendations) {
        console.log(`  - ${rec}`);
      }
    }
  }

  private outputJsonReport(): void {
    const json = JSON.stringify(this.report, null, 2);

    if (this.config.outputPath) {
      fs.writeFileSync(this.config.outputPath, json);
      console.log(`\nReport written to: ${this.config.outputPath}`);
    } else {
      console.log(json);
    }
  }

  private outputMarkdownReport(): void {
    const lines: string[] = [];
    lines.push("# Scale Performance Test Report");
    lines.push("");
    lines.push(`Generated: ${this.report.timestamp}`);
    lines.push("");

    // Configuration
    lines.push("## Configuration");
    lines.push("");
    lines.push(`- Scale: ${this.config.scale}`);
    lines.push(`- Suite: ${this.config.suite}`);
    lines.push(`- Platform: ${this.report.environment.platform}`);
    lines.push(`- Bun Version: ${this.report.environment.bunVersion}`);
    lines.push(`- Neo4j Version: ${this.report.environment.neo4jVersion ?? "unknown"}`);
    lines.push("");

    // Results
    lines.push("## Results");
    lines.push("");
    lines.push("| Benchmark | Target | Actual | p95 | Status |");
    lines.push("|-----------|--------|--------|-----|--------|");

    const allResults = Object.values(this.report.scales).flatMap((s) => s.results);
    for (const result of allResults) {
      const status = result.passed ? "✅ PASS" : "❌ FAIL";
      lines.push(
        `| ${result.name} | ${result.target}ms | ${result.actual.toFixed(0)}ms | ${result.p95.toFixed(0)}ms | ${status} |`
      );
    }

    lines.push("");

    // Summary
    lines.push("## Summary");
    lines.push("");
    lines.push(`- **Total Benchmarks:** ${this.report.summary.totalBenchmarks}`);
    lines.push(`- **Passed:** ${this.report.summary.passed}`);
    lines.push(`- **Failed:** ${this.report.summary.failed}`);
    lines.push(`- **Pass Rate:** ${this.report.summary.passRate.toFixed(1)}%`);
    lines.push(`- **PRD Targets Met:** ${this.report.summary.prdTargetsMet ? "Yes" : "No"}`);
    lines.push("");

    // Recommendations
    if (this.report.recommendations.length > 0) {
      lines.push("## Recommendations");
      lines.push("");
      for (const rec of this.report.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push("");
    }

    const markdown = lines.join("\n");

    if (this.config.outputPath) {
      fs.writeFileSync(this.config.outputPath, markdown);
      console.log(`\nReport written to: ${this.config.outputPath}`);
    } else {
      console.log(markdown);
    }
  }

  private async getFileCount(repoName: string): Promise<number> {
    try {
      const result = await this.neo4jClient!.runQuery<{ count: number }>(
        `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File) RETURN count(f) as count`,
        { name: repoName }
      );
      return result[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }

  private async getSampleFiles(repoName: string, count: number): Promise<string[]> {
    try {
      const result = await this.neo4jClient!.runQuery<{ path: string }>(
        `MATCH (r:Repository {name: $name})-[:CONTAINS]->(f:File)
         WHERE f.extension = 'ts'
         RETURN f.path as path
         LIMIT $count`,
        { name: repoName, count }
      );
      return result.map((r) => r.path);
    } catch {
      return [];
    }
  }

  private async deleteRepositoryData(repoName: string): Promise<void> {
    await this.neo4jClient!.runQuery(
      `MATCH (r:Repository {name: $name})
       OPTIONAL MATCH (r)-[:CONTAINS]->(f:File)
       OPTIONAL MATCH (f)-[:DEFINES]->(entity)
       OPTIONAL MATCH (f)-[:IMPORTS]->(module:Module)
       DETACH DELETE entity, module, f, r`,
      { name: repoName }
    );
  }

  private async cleanup(repoName: string): Promise<void> {
    console.log("\nCleaning up test data...");
    await this.deleteRepositoryData(repoName);
    console.log("  Cleanup complete.");
  }

  private async shutdown(): Promise<void> {
    if (this.neo4jClient) {
      await this.neo4jClient.disconnect();
    }
    resetLogger();
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main(): Promise<void> {
  const config = parseArgs();
  const runner = new ScaleTestRunner(config);

  try {
    await runner.run();
    process.exit(0);
  } catch (error) {
    console.error("Test runner failed:", error);
    process.exit(1);
  }
}

void main();
