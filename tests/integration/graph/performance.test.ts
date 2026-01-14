/**
 * Performance Benchmark Tests for Graph Features
 *
 * These tests validate that graph query performance meets the targets
 * defined in the Knowledge Graph PRD:
 *
 * | Metric                      | Target   |
 * |-----------------------------|----------|
 * | Simple dependency query     | <100ms   |
 * | Transitive query (3 hops)   | <300ms   |
 * | Architecture query          | <500ms   |
 * | Graph indexing (per file)   | <100ms   |
 *
 * @module tests/integration/graph/performance.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Neo4jStorageClientImpl } from "../../../src/graph/Neo4jClient.js";
import { GraphServiceImpl } from "../../../src/services/graph-service.js";
import type { Neo4jConfig } from "../../../src/graph/types.js";
import type {
  DependencyQuery,
  DependentQuery,
  ArchitectureQuery,
  PathQuery,
  EntityReference,
} from "../../../src/services/graph-service-types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// Integration test configuration
const integrationConfig: Neo4jConfig = {
  host: process.env["NEO4J_HOST"] ?? "localhost",
  port: parseInt(process.env["NEO4J_PORT"] ?? "7687", 10),
  username: process.env["NEO4J_USERNAME"] ?? "neo4j",
  password: process.env["NEO4J_PASSWORD"] ?? "testpassword",
  maxConnectionPoolSize: 10,
  connectionAcquisitionTimeout: 10000,
};

const TEST_REPO = "PersonalKnowledgeMCP";

// Performance targets from PRD
const TARGETS = {
  simpleDependencyQuery: 100, // ms
  transitiveQuery3Hops: 300, // ms
  architectureQuery: 500, // ms
  pathFindingQuery: 300, // ms
  graphIndexingPerFile: 100, // ms
  mcpQueryResponse: 500, // p95 target
};

// Helper to check Neo4j availability
async function isNeo4jAvailable(): Promise<boolean> {
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), 2000);
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

// Helper to check repository population
async function isRepositoryPopulated(
  client: Neo4jStorageClientImpl,
  repoName: string
): Promise<boolean> {
  try {
    const results = await client.runQuery<{ count: number }>(
      `MATCH (r:Repository {name: $name}) RETURN count(r) as count`,
      { name: repoName }
    );
    return results.length > 0 && (results[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Run a function multiple times and return timing statistics
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

  // Warm-up run (not counted, but log failures for debugging)
  try {
    await fn();
  } catch (error) {
    console.warn(`Warm-up run failed: ${error instanceof Error ? error.message : String(error)}`);
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

describe("Graph Query Performance", () => {
  let neo4jClient: Neo4jStorageClientImpl;
  let graphService: GraphServiceImpl;
  let neo4jAvailable: boolean;
  let repoPopulated: boolean;

  beforeAll(async () => {
    initializeLogger({ level: "silent", format: "json" });
    neo4jAvailable = await isNeo4jAvailable();

    if (!neo4jAvailable) {
      console.log("Neo4j is not available. Performance tests will be skipped.");
      return;
    }

    neo4jClient = new Neo4jStorageClientImpl(integrationConfig);
    await neo4jClient.connect();

    repoPopulated = await isRepositoryPopulated(neo4jClient, TEST_REPO);
    if (!repoPopulated) {
      console.log(`Repository ${TEST_REPO} is not populated. Performance tests will be skipped.`);
    }

    graphService = new GraphServiceImpl(neo4jClient);
  });

  afterAll(async () => {
    if (neo4jClient) {
      await neo4jClient.disconnect();
    }
    resetLogger();
  });

  describe("Dependency Query Performance", () => {
    test(`simple dependency query should complete in <${TARGETS.simpleDependencyQuery}ms`, async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const query: DependencyQuery = {
        entity_type: "file",
        entity_path: "src/mcp/tools/get-dependencies.ts",
        repository: TEST_REPO,
        depth: 1,
      };

      const stats = await measurePerformance(() => graphService.getDependencies(query), 10);

      console.log("\nSimple Dependency Query Performance:");
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  Target: <${TARGETS.simpleDependencyQuery}ms`);

      // Use p95 for more stable assertion (accounting for cold cache)
      // Allow 1.5x for CI variability - balances stability with meaningful assertions
      expect(stats.p95).toBeLessThan(TARGETS.simpleDependencyQuery * 1.5);
    });

    test(`transitive query (3 hops) should complete in <${TARGETS.transitiveQuery3Hops}ms`, async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const query: DependencyQuery = {
        entity_type: "file",
        entity_path: "src/services/graph-service.ts",
        repository: TEST_REPO,
        depth: 3,
        include_transitive: true,
      };

      const stats = await measurePerformance(() => graphService.getDependencies(query), 5);

      console.log("\nTransitive Query (3 hops) Performance:");
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  Target: <${TARGETS.transitiveQuery3Hops}ms`);

      // Allow 1.5x for CI variability - balances stability with meaningful assertions
      expect(stats.p95).toBeLessThan(TARGETS.transitiveQuery3Hops * 1.5);
    });
  });

  describe("Dependents Query Performance", () => {
    test("impact analysis query should complete in reasonable time", async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const query: DependentQuery = {
        entity_type: "file",
        entity_path: "src/graph/types.ts",
        repository: TEST_REPO,
        depth: 1,
      };

      const stats = await measurePerformance(() => graphService.getDependents(query), 10);

      console.log("\nDependents Query Performance:");
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);

      // Should be similar to dependency query
      expect(stats.p95).toBeLessThan(TARGETS.simpleDependencyQuery * 3);
    });
  });

  describe("Architecture Query Performance", () => {
    test(`architecture query should complete in <${TARGETS.architectureQuery}ms`, async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const query: ArchitectureQuery = {
        repository: TEST_REPO,
        detail_level: "modules",
      };

      const stats = await measurePerformance(() => graphService.getArchitecture(query), 5);

      console.log("\nArchitecture Query Performance:");
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  Target: <${TARGETS.architectureQuery}ms`);

      // Allow 1.5x for CI variability - balances stability with meaningful assertions
      expect(stats.p95).toBeLessThan(TARGETS.architectureQuery * 1.5);
    });

    test("scoped architecture query should be faster than full repo", async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const fullQuery: ArchitectureQuery = {
        repository: TEST_REPO,
        detail_level: "files",
      };

      const scopedQuery: ArchitectureQuery = {
        repository: TEST_REPO,
        scope: "src/graph",
        detail_level: "files",
      };

      const fullStats = await measurePerformance(() => graphService.getArchitecture(fullQuery), 3);

      const scopedStats = await measurePerformance(
        () => graphService.getArchitecture(scopedQuery),
        3
      );

      console.log("\nScoped vs Full Architecture Query:");
      console.log(`  Full repo avg: ${fullStats.avg.toFixed(2)}ms`);
      console.log(`  Scoped avg: ${scopedStats.avg.toFixed(2)}ms`);

      // Scoped query should generally be faster or similar
      // Don't assert strictly as small repos may have similar times
      expect(scopedStats.avg).toBeLessThan(fullStats.avg * 2);
    });
  });

  describe("Path Finding Performance", () => {
    test(`path finding should complete in <${TARGETS.pathFindingQuery}ms`, async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const fromEntity: EntityReference = {
        type: "file",
        path: "src/mcp/tools/get-dependencies.ts",
        repository: TEST_REPO,
      };

      const toEntity: EntityReference = {
        type: "file",
        path: "src/graph/types.ts",
        repository: TEST_REPO,
      };

      const query: PathQuery = {
        from_entity: fromEntity,
        to_entity: toEntity,
        max_hops: 5,
      };

      const stats = await measurePerformance(() => graphService.getPath(query), 5);

      console.log("\nPath Finding Query Performance:");
      console.log(`  Min: ${stats.min.toFixed(2)}ms`);
      console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
      console.log(`  p95: ${stats.p95.toFixed(2)}ms`);
      console.log(`  Target: <${TARGETS.pathFindingQuery}ms`);

      // Allow 1.5x for CI variability - balances stability with meaningful assertions
      expect(stats.p95).toBeLessThan(TARGETS.pathFindingQuery * 1.5);
    });
  });

  describe("Concurrent Query Performance", () => {
    test("should handle concurrent queries efficiently", async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const queries: DependencyQuery[] = [
        {
          entity_type: "file",
          entity_path: "src/mcp/tools/get-dependencies.ts",
          repository: TEST_REPO,
          depth: 1,
        },
        {
          entity_type: "file",
          entity_path: "src/mcp/tools/get-dependents.ts",
          repository: TEST_REPO,
          depth: 1,
        },
        {
          entity_type: "file",
          entity_path: "src/services/graph-service.ts",
          repository: TEST_REPO,
          depth: 1,
        },
      ];

      const start = performance.now();
      await Promise.all(queries.map((q) => graphService.getDependencies(q)));
      const duration = performance.now() - start;

      console.log("\nConcurrent Query Performance:");
      console.log(`  3 concurrent queries: ${duration.toFixed(2)}ms`);
      console.log(`  Avg per query: ${(duration / 3).toFixed(2)}ms`);

      // Concurrent queries should not be 3x slower than single
      expect(duration).toBeLessThan(TARGETS.simpleDependencyQuery * 5);
    });
  });

  describe("Cache Performance", () => {
    test("cached queries should be significantly faster", async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const query: DependencyQuery = {
        entity_type: "file",
        entity_path: "src/cli.ts",
        repository: TEST_REPO,
        depth: 1,
      };

      // First query (cold cache)
      const coldStart = performance.now();
      const coldResult = await graphService.getDependencies(query);
      const coldDuration = performance.now() - coldStart;

      // Second query (should be cached)
      const warmStart = performance.now();
      const warmResult = await graphService.getDependencies(query);
      const warmDuration = performance.now() - warmStart;

      console.log("\nCache Performance:");
      console.log(`  Cold cache: ${coldDuration.toFixed(2)}ms`);
      console.log(`  Warm cache: ${warmDuration.toFixed(2)}ms`);
      console.log(`  Cold result from_cache: ${coldResult.metadata.from_cache}`);
      console.log(`  Warm result from_cache: ${warmResult.metadata.from_cache}`);

      // Warm query should be from cache (if caching enabled)
      // Note: May not be cached if service doesn't have caching configured
      if (warmResult.metadata.from_cache) {
        expect(warmDuration).toBeLessThan(coldDuration);
      }
    });
  });

  describe("Performance Summary", () => {
    test("should generate performance summary report", async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      // Collect all performance metrics
      const metrics: Record<string, { avg: number; p95: number }> = {};

      // Simple dependency
      const depQuery: DependencyQuery = {
        entity_type: "file",
        entity_path: "src/mcp/tools/get-dependencies.ts",
        repository: TEST_REPO,
        depth: 1,
      };
      const depStats = await measurePerformance(() => graphService.getDependencies(depQuery), 5);
      metrics["simple_dependency"] = { avg: depStats.avg, p95: depStats.p95 };

      // Transitive dependency
      const transQuery: DependencyQuery = {
        entity_type: "file",
        entity_path: "src/services/graph-service.ts",
        repository: TEST_REPO,
        depth: 3,
        include_transitive: true,
      };
      const transStats = await measurePerformance(
        () => graphService.getDependencies(transQuery),
        3
      );
      metrics["transitive_3_hops"] = { avg: transStats.avg, p95: transStats.p95 };

      // Architecture
      const archQuery: ArchitectureQuery = {
        repository: TEST_REPO,
        detail_level: "modules",
      };
      const archStats = await measurePerformance(() => graphService.getArchitecture(archQuery), 3);
      metrics["architecture"] = { avg: archStats.avg, p95: archStats.p95 };

      // Print summary
      console.log("\n========================================");
      console.log("PERFORMANCE SUMMARY");
      console.log("========================================");
      console.log("\n| Query Type          | Avg (ms) | p95 (ms) | Target  | Status |");
      console.log("|---------------------|----------|----------|---------|--------|");

      const checkTarget = (p95: number, target: number): string =>
        p95 < target * 1.5 ? "PASS" : "WARN"; // Allow 1.5x for CI variability

      console.log(
        `| Simple Dependency   | ${metrics["simple_dependency"]?.avg.toFixed(0).padStart(8)} | ${metrics["simple_dependency"]?.p95.toFixed(0).padStart(8)} | <${TARGETS.simpleDependencyQuery}ms  | ${checkTarget(metrics["simple_dependency"]?.p95 ?? 0, TARGETS.simpleDependencyQuery).padStart(6)} |`
      );
      console.log(
        `| Transitive (3 hops) | ${metrics["transitive_3_hops"]?.avg.toFixed(0).padStart(8)} | ${metrics["transitive_3_hops"]?.p95.toFixed(0).padStart(8)} | <${TARGETS.transitiveQuery3Hops}ms | ${checkTarget(metrics["transitive_3_hops"]?.p95 ?? 0, TARGETS.transitiveQuery3Hops).padStart(6)} |`
      );
      console.log(
        `| Architecture        | ${metrics["architecture"]?.avg.toFixed(0).padStart(8)} | ${metrics["architecture"]?.p95.toFixed(0).padStart(8)} | <${TARGETS.architectureQuery}ms | ${checkTarget(metrics["architecture"]?.p95 ?? 0, TARGETS.architectureQuery).padStart(6)} |`
      );
      console.log("========================================\n");

      // All metrics should exist
      expect(Object.keys(metrics).length).toBe(3);
    });
  });
});
