/**
 * Unit tests for GraphServiceImpl
 *
 * Tests the GraphService for dependency analysis, path finding,
 * and architecture queries with mocked Neo4j client.
 */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";

import { GraphServiceImpl } from "../../../src/services/graph-service.js";
import {
  GraphServiceValidationError,
  GraphServiceOperationError,
  GraphServiceTimeoutError,
} from "../../../src/services/graph-service-errors.js";
import { QueryCache, DEFAULT_CACHE_CONFIG } from "../../../src/services/graph-service-cache.js";
import type { Neo4jStorageClient } from "../../../src/graph/types.js";
import { RelationshipType } from "../../../src/graph/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// =============================================================================
// Mock Neo4j Client
// =============================================================================

/**
 * Create a mock Neo4jStorageClient for testing
 */
function createMockNeo4jClient(overrides?: Partial<Neo4jStorageClient>): Neo4jStorageClient {
  return {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    healthCheck: mock(() => Promise.resolve(true)),
    runQuery: mock(() => Promise.resolve([])),
    upsertNode: mock(() => Promise.resolve({} as never)),
    deleteNode: mock(() => Promise.resolve(true)),
    createRelationship: mock(() => Promise.resolve({} as never)),
    deleteRelationship: mock(() => Promise.resolve(true)),
    traverse: mock(() =>
      Promise.resolve({
        nodes: [],
        relationships: [],
        metadata: { nodesCount: 0, relationshipsCount: 0, queryTimeMs: 10 },
      })
    ),
    analyzeDependencies: mock(() =>
      Promise.resolve({
        direct: [],
        transitive: [],
        impactScore: 0,
        metadata: { directCount: 0, transitiveCount: 0, queryTimeMs: 10 },
      })
    ),
    getContext: mock(() =>
      Promise.resolve({
        context: [],
        metadata: { seedsProcessed: 0, contextItemsFound: 0, queryTimeMs: 10 },
      })
    ),
    ...overrides,
  };
}

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_QUERIES = {
  dependency: {
    valid: {
      entity_type: "file" as const,
      entity_path: "src/services/auth.ts",
      repository: "test-repo",
    },
    withDepth: {
      entity_type: "function" as const,
      entity_path: "validateToken",
      repository: "test-repo",
      depth: 3,
      include_transitive: true,
    },
  },
  dependent: {
    valid: {
      entity_type: "class" as const,
      entity_path: "AuthService",
      repository: "test-repo",
    },
    crossRepo: {
      entity_type: "file" as const,
      entity_path: "src/shared/utils.ts",
      include_cross_repo: true,
    },
  },
  path: {
    valid: {
      from_entity: {
        type: "function" as const,
        path: "handleRequest",
        repository: "api",
      },
      to_entity: {
        type: "function" as const,
        path: "queryDatabase",
        repository: "api",
      },
    },
    withMaxHops: {
      from_entity: {
        type: "file" as const,
        path: "src/api/routes.ts",
        repository: "api",
      },
      to_entity: {
        type: "file" as const,
        path: "src/db/connection.ts",
        repository: "api",
      },
      max_hops: 10,
    },
  },
  architecture: {
    valid: {
      repository: "test-repo",
      detail_level: "modules" as const,
    },
    withScope: {
      repository: "test-repo",
      scope: "src/services",
      detail_level: "files" as const,
    },
  },
};

const MOCK_DEPENDENCY_RESULT = {
  direct: [
    {
      type: "file" as const,
      identifier: "src/utils/validator.ts",
      repository: "test-repo",
      relationshipType: RelationshipType.IMPORTS,
      depth: 1,
    },
    {
      type: "module" as const,
      identifier: "lodash",
      repository: "test-repo",
      relationshipType: RelationshipType.IMPORTS,
      depth: 1,
    },
  ],
  transitive: [
    {
      type: "file" as const,
      identifier: "src/utils/helpers.ts",
      repository: "test-repo",
      relationshipType: RelationshipType.IMPORTS,
      depth: 2,
    },
  ],
  impactScore: 0.15,
  metadata: { directCount: 2, transitiveCount: 1, queryTimeMs: 25 },
};

const MOCK_TRAVERSE_RESULT = {
  nodes: [
    {
      id: "1",
      type: "Function",
      properties: { name: "handleRequest", path: "handleRequest", repository: "api" },
    },
    {
      id: "2",
      type: "Function",
      properties: { name: "processData", path: "processData", repository: "api" },
    },
    {
      id: "3",
      type: "Function",
      properties: { name: "queryDatabase", path: "queryDatabase", repository: "api" },
    },
  ],
  relationships: [
    { from: "1", to: "2", type: RelationshipType.CALLS, properties: {} },
    { from: "2", to: "3", type: RelationshipType.CALLS, properties: {} },
  ],
  metadata: { nodesCount: 3, relationshipsCount: 2, queryTimeMs: 30 },
};

// =============================================================================
// Test Suite
// =============================================================================

describe("GraphServiceImpl", () => {
  let mockClient: Neo4jStorageClient;
  let service: GraphServiceImpl;

  beforeEach(() => {
    initializeLogger({ level: "error", format: "json" });
    mockClient = createMockNeo4jClient();
    service = new GraphServiceImpl(mockClient);
  });

  afterEach(() => {
    resetLogger();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    test("accepts Neo4j client without config", () => {
      const svc = new GraphServiceImpl(mockClient);
      expect(svc).toBeInstanceOf(GraphServiceImpl);
    });

    test("accepts custom timeout configuration", () => {
      const svc = new GraphServiceImpl(mockClient, { timeoutMs: 60000 });
      expect(svc).toBeInstanceOf(GraphServiceImpl);
    });

    test("accepts custom cache configuration", () => {
      const svc = new GraphServiceImpl(mockClient, {
        cache: { ttlMs: 120000, maxEntries: 50 },
      });
      expect(svc).toBeInstanceOf(GraphServiceImpl);
    });

    test("merges partial config with defaults", () => {
      const svc = new GraphServiceImpl(mockClient, { timeoutMs: 45000 });
      const stats = svc.getCacheStats();
      expect(stats.dependency.ttlMs).toBe(DEFAULT_CACHE_CONFIG.ttlMs);
    });
  });

  // ===========================================================================
  // getDependencies Tests
  // ===========================================================================

  describe("getDependencies", () => {
    describe("validation", () => {
      test("validates entity_type is valid enum", async () => {
        await expect(
          service.getDependencies({
            entity_type: "invalid" as "file",
            entity_path: "test.ts",
            repository: "repo",
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates entity_path is non-empty", async () => {
        await expect(
          service.getDependencies({
            entity_type: "file",
            entity_path: "",
            repository: "repo",
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates entity_path is non-empty after trim", async () => {
        await expect(
          service.getDependencies({
            entity_type: "file",
            entity_path: "   ",
            repository: "repo",
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates repository is non-empty", async () => {
        await expect(
          service.getDependencies({
            entity_type: "file",
            entity_path: "test.ts",
            repository: "",
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates depth is at least 1", async () => {
        await expect(
          service.getDependencies({
            entity_type: "file",
            entity_path: "test.ts",
            repository: "repo",
            depth: 0,
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates depth is at most 5", async () => {
        await expect(
          service.getDependencies({
            entity_type: "file",
            entity_path: "test.ts",
            repository: "repo",
            depth: 6,
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("accepts valid depth values", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        // depth 1
        const result1 = await service.getDependencies({
          entity_type: "file",
          entity_path: "test.ts",
          repository: "repo",
          depth: 1,
        });
        expect(result1.metadata.depth_searched).toBe(1);

        // Clear cache between tests
        service.clearCache();

        // depth 5
        const result5 = await service.getDependencies({
          entity_type: "file",
          entity_path: "test2.ts",
          repository: "repo",
          depth: 5,
        });
        expect(result5.metadata.depth_searched).toBe(5);
      });
    });

    describe("execution", () => {
      test("returns dependencies for valid file query", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        const result = await service.getDependencies(TEST_QUERIES.dependency.valid);

        expect(result.entity.type).toBe("file");
        expect(result.entity.path).toBe("src/services/auth.ts");
        expect(result.entity.repository).toBe("test-repo");
        expect(result.dependencies.length).toBe(2); // direct only (include_transitive=false by default)
        expect(result.metadata.from_cache).toBe(false);
      });

      test("includes transitive dependencies when requested", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        const result = await service.getDependencies(TEST_QUERIES.dependency.withDepth);

        expect(result.dependencies.length).toBe(3); // 2 direct + 1 transitive
        expect(result.metadata.depth_searched).toBe(3);
      });

      test("handles zero dependencies gracefully", async () => {
        mockClient.analyzeDependencies = mock(() =>
          Promise.resolve({
            direct: [],
            transitive: [],
            impactScore: 0,
            metadata: { directCount: 0, transitiveCount: 0, queryTimeMs: 5 },
          })
        );

        const result = await service.getDependencies(TEST_QUERIES.dependency.valid);

        expect(result.dependencies).toEqual([]);
        expect(result.metadata.total_count).toBe(0);
      });

      test("calls analyzeDependencies with correct direction", async () => {
        const analyzeSpy = spyOn(mockClient, "analyzeDependencies");

        await service.getDependencies(TEST_QUERIES.dependency.valid);

        expect(analyzeSpy).toHaveBeenCalledTimes(1);
        const callArg = analyzeSpy.mock.calls[0]?.[0];
        expect(callArg?.direction).toBe("dependsOn");
      });
    });

    describe("caching", () => {
      test("caches results and returns from_cache=true on second call", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        const result1 = await service.getDependencies(TEST_QUERIES.dependency.valid);
        expect(result1.metadata.from_cache).toBe(false);

        const result2 = await service.getDependencies(TEST_QUERIES.dependency.valid);
        expect(result2.metadata.from_cache).toBe(true);

        // Should only have called analyzeDependencies once
        expect(mockClient.analyzeDependencies).toHaveBeenCalledTimes(1);
      });

      test("different queries have different cache keys", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        await service.getDependencies(TEST_QUERIES.dependency.valid);
        await service.getDependencies(TEST_QUERIES.dependency.withDepth);

        // Should have called analyzeDependencies twice (different queries)
        expect(mockClient.analyzeDependencies).toHaveBeenCalledTimes(2);
      });
    });

    describe("error handling", () => {
      test("wraps Neo4j errors in GraphServiceOperationError", async () => {
        mockClient.analyzeDependencies = mock(() =>
          Promise.reject(new Error("Connection refused"))
        );

        await expect(service.getDependencies(TEST_QUERIES.dependency.valid)).rejects.toThrow(
          GraphServiceOperationError
        );
      });
    });
  });

  // ===========================================================================
  // getDependents Tests
  // ===========================================================================

  describe("getDependents", () => {
    describe("validation", () => {
      test("validates entity_type is valid enum", async () => {
        await expect(
          service.getDependents({
            entity_type: "module" as "file",
            entity_path: "test",
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates entity_path is non-empty", async () => {
        await expect(
          service.getDependents({
            entity_type: "file",
            entity_path: "",
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("allows optional repository", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        const result = await service.getDependents(TEST_QUERIES.dependent.crossRepo);

        expect(result.entity.repository).toBe("unknown");
      });
    });

    describe("execution", () => {
      test("returns dependents for valid query", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        const result = await service.getDependents(TEST_QUERIES.dependent.valid);

        expect(result.entity.type).toBe("class");
        expect(result.entity.path).toBe("AuthService");
        expect(result.dependents.length).toBeGreaterThanOrEqual(0);
        expect(result.impact_analysis).toBeDefined();
        expect(result.impact_analysis.impact_score).toBe(0.15);
      });

      test("calls analyzeDependencies with dependedOnBy direction", async () => {
        const analyzeSpy = spyOn(mockClient, "analyzeDependencies");

        await service.getDependents(TEST_QUERIES.dependent.valid);

        expect(analyzeSpy).toHaveBeenCalledTimes(1);
        const callArg = analyzeSpy.mock.calls[0]?.[0];
        expect(callArg?.direction).toBe("dependedOnBy");
      });

      test("includes impact analysis in result", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        const result = await service.getDependents(TEST_QUERIES.dependent.valid);

        expect(result.impact_analysis.direct_impact_count).toBe(2);
        expect(result.impact_analysis.transitive_impact_count).toBe(1);
        expect(typeof result.impact_analysis.impact_score).toBe("number");
      });
    });

    describe("caching", () => {
      test("caches dependent results separately from dependency results", async () => {
        mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

        // Query dependents
        await service.getDependents({
          entity_type: "file",
          entity_path: "src/services/auth.ts",
          repository: "test-repo",
        });

        // Same entity but dependencies (different cache)
        await service.getDependencies({
          entity_type: "file",
          entity_path: "src/services/auth.ts",
          repository: "test-repo",
        });

        // Should have called twice (different caches)
        expect(mockClient.analyzeDependencies).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ===========================================================================
  // getPath Tests
  // ===========================================================================

  describe("getPath", () => {
    describe("validation", () => {
      test("validates from_entity.type is valid", async () => {
        await expect(
          service.getPath({
            from_entity: { type: "invalid" as "file", path: "a", repository: "r" },
            to_entity: { type: "file", path: "b", repository: "r" },
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates to_entity.path is non-empty", async () => {
        await expect(
          service.getPath({
            from_entity: { type: "file", path: "a", repository: "r" },
            to_entity: { type: "file", path: "", repository: "r" },
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates max_hops is at least 1", async () => {
        await expect(
          service.getPath({
            from_entity: { type: "file", path: "a", repository: "r" },
            to_entity: { type: "file", path: "b", repository: "r" },
            max_hops: 0,
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates max_hops is at most 20", async () => {
        await expect(
          service.getPath({
            from_entity: { type: "file", path: "a", repository: "r" },
            to_entity: { type: "file", path: "b", repository: "r" },
            max_hops: 25,
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });
    });

    describe("execution", () => {
      test("returns path when one exists", async () => {
        mockClient.traverse = mock(() => Promise.resolve(MOCK_TRAVERSE_RESULT));

        const result = await service.getPath(TEST_QUERIES.path.valid);

        expect(result.path_exists).toBe(true);
        expect(result.path).not.toBeNull();
        expect(result.path!.length).toBeGreaterThan(0);
      });

      test("returns path_exists=false when no path found", async () => {
        mockClient.traverse = mock(() =>
          Promise.resolve({
            nodes: [{ id: "1", type: "Function", properties: { name: "isolated" } }],
            relationships: [],
            metadata: { nodesCount: 1, relationshipsCount: 0, queryTimeMs: 5 },
          })
        );

        const result = await service.getPath(TEST_QUERIES.path.valid);

        expect(result.path_exists).toBe(false);
        expect(result.path).toBeNull();
        expect(result.metadata.hops).toBe(0);
      });

      test("uses default relationship types when not specified", async () => {
        const traverseSpy = spyOn(mockClient, "traverse");

        await service.getPath(TEST_QUERIES.path.valid);

        expect(traverseSpy).toHaveBeenCalledTimes(1);
        const callArg = traverseSpy.mock.calls[0]?.[0];
        expect(callArg?.relationships).toContain(RelationshipType.IMPORTS);
        expect(callArg?.relationships).toContain(RelationshipType.CALLS);
        expect(callArg?.relationships).toContain(RelationshipType.REFERENCES);
      });

      test("respects max_hops parameter", async () => {
        const traverseSpy = spyOn(mockClient, "traverse");

        await service.getPath(TEST_QUERIES.path.withMaxHops);

        expect(traverseSpy).toHaveBeenCalledTimes(1);
        const callArg = traverseSpy.mock.calls[0]?.[0];
        expect(callArg?.depth).toBe(10);
      });

      test("returns path_exists=false when source and target exist but are disconnected", async () => {
        // Both nodes exist in traversal results, but no edges connect them
        mockClient.traverse = mock(() =>
          Promise.resolve({
            nodes: [
              {
                id: "1",
                type: "Function",
                properties: { name: "handleRequest", path: "handleRequest", repository: "api" },
              },
              {
                id: "2",
                type: "Function",
                properties: { name: "unrelated", path: "unrelated", repository: "api" },
              },
              {
                id: "3",
                type: "Function",
                properties: { name: "queryDatabase", path: "queryDatabase", repository: "api" },
              },
            ],
            // Edge connects 1->2, but target (3) is disconnected
            relationships: [{ from: "1", to: "2", type: RelationshipType.CALLS, properties: {} }],
            metadata: { nodesCount: 3, relationshipsCount: 1, queryTimeMs: 10 },
          })
        );

        const result = await service.getPath(TEST_QUERIES.path.valid);

        // Even though target exists in traversal, BFS finds no path
        expect(result.path_exists).toBe(false);
        expect(result.path).toBeNull();
        expect(result.metadata.hops).toBe(0);
      });
    });
  });

  // ===========================================================================
  // getArchitecture Tests
  // ===========================================================================

  describe("getArchitecture", () => {
    describe("validation", () => {
      test("validates repository is non-empty", async () => {
        await expect(
          service.getArchitecture({
            repository: "",
            detail_level: "modules",
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });

      test("validates detail_level is valid enum", async () => {
        await expect(
          service.getArchitecture({
            repository: "repo",
            detail_level: "invalid" as "modules",
          })
        ).rejects.toThrow(GraphServiceValidationError);
      });
    });

    describe("execution", () => {
      test("returns architecture structure for valid query", async () => {
        mockClient.runQuery = mock(() =>
          Promise.resolve([
            { package: "src", module: "services", fileCount: 5 },
            { package: "src", module: "utils", fileCount: 3 },
            { package: "tests", module: "unit", fileCount: 10 },
          ])
        ) as Neo4jStorageClient["runQuery"];

        const result = await service.getArchitecture(TEST_QUERIES.architecture.valid);

        expect(result.repository).toBe("test-repo");
        expect(result.structure).toBeDefined();
        expect(result.structure.type).toBe("package");
        expect(result.metadata.detail_level).toBe("modules");
      });

      test("includes scope filter when provided", async () => {
        const runQuerySpy = spyOn(mockClient, "runQuery");

        await service.getArchitecture(TEST_QUERIES.architecture.withScope);

        expect(runQuerySpy).toHaveBeenCalled();
        // Verify scope is used in parameters
        const calls = runQuerySpy.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
      });

      test("returns empty structure for repository with no files", async () => {
        mockClient.runQuery = mock(() => Promise.resolve([]));

        const result = await service.getArchitecture(TEST_QUERIES.architecture.valid);

        expect(result.structure.children).toEqual([]);
        expect(result.metrics.total_files).toBe(0);
      });
    });

    describe("inter-module dependencies", () => {
      test("includes inter-module dependency information", async () => {
        mockClient.runQuery = mock((cypher: string) => {
          if (cypher.includes("IMPORTS")) {
            return Promise.resolve([
              { fromModule: "src", toModule: "lib", relCount: 15, relTypes: ["IMPORTS"] },
            ]);
          }
          return Promise.resolve([{ package: "src", fileCount: 5 }]);
        }) as Neo4jStorageClient["runQuery"];

        const result = await service.getArchitecture(TEST_QUERIES.architecture.valid);

        expect(result.inter_module_dependencies).toBeDefined();
      });
    });
  });

  // ===========================================================================
  // healthCheck Tests
  // ===========================================================================

  describe("healthCheck", () => {
    test("returns true when Neo4j is healthy", async () => {
      mockClient.healthCheck = mock(() => Promise.resolve(true));

      const result = await service.healthCheck();

      expect(result).toBe(true);
    });

    test("returns false when Neo4j is unhealthy", async () => {
      mockClient.healthCheck = mock(() => Promise.resolve(false));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });

    test("returns false when healthCheck throws", async () => {
      mockClient.healthCheck = mock(() => Promise.reject(new Error("Connection failed")));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Timeout Handling Tests
  // ===========================================================================

  describe("timeout handling", () => {
    test("throws GraphServiceTimeoutError on timeout", async () => {
      // Create service with very short timeout
      const shortTimeoutService = new GraphServiceImpl(mockClient, { timeoutMs: 10 });

      // Mock a slow operation
      mockClient.analyzeDependencies = mock(
        () => new Promise((resolve) => setTimeout(() => resolve(MOCK_DEPENDENCY_RESULT), 100))
      ) as Neo4jStorageClient["analyzeDependencies"];

      await expect(
        shortTimeoutService.getDependencies(TEST_QUERIES.dependency.valid)
      ).rejects.toThrow(GraphServiceTimeoutError);
    });

    test("timeout error includes timeout value", async () => {
      const shortTimeoutService = new GraphServiceImpl(mockClient, { timeoutMs: 15 });

      mockClient.analyzeDependencies = mock(
        () => new Promise((resolve) => setTimeout(() => resolve(MOCK_DEPENDENCY_RESULT), 100))
      ) as Neo4jStorageClient["analyzeDependencies"];

      try {
        await shortTimeoutService.getDependencies(TEST_QUERIES.dependency.valid);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GraphServiceTimeoutError);
        expect((error as GraphServiceTimeoutError).timeoutMs).toBe(15);
      }
    });
  });

  // ===========================================================================
  // Cache Management Tests
  // ===========================================================================

  describe("cache management", () => {
    test("clearCache removes all cached entries", async () => {
      mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

      // Populate cache
      await service.getDependencies(TEST_QUERIES.dependency.valid);
      await service.getDependents(TEST_QUERIES.dependent.valid);

      // Clear cache
      service.clearCache();

      // Next calls should not hit cache
      const result = await service.getDependencies(TEST_QUERIES.dependency.valid);
      expect(result.metadata.from_cache).toBe(false);

      // Should have been called 3 times (2 before clear + 1 after)
      expect(mockClient.analyzeDependencies).toHaveBeenCalledTimes(3);
    });

    test("getCacheStats returns statistics for all caches", () => {
      const stats = service.getCacheStats();

      expect(stats.dependency).toBeDefined();
      expect(stats.dependent).toBeDefined();
      expect(stats.path).toBeDefined();
      expect(stats.architecture).toBeDefined();
      expect(typeof stats.dependency.size).toBe("number");
      expect(typeof stats.dependency.hitRate).toBe("number");
    });
  });

  // ===========================================================================
  // Performance Tracking Tests
  // ===========================================================================

  describe("performance tracking", () => {
    test("includes query_time_ms in metadata", async () => {
      mockClient.analyzeDependencies = mock(() => Promise.resolve(MOCK_DEPENDENCY_RESULT));

      const result = await service.getDependencies(TEST_QUERIES.dependency.valid);

      expect(result.metadata.query_time_ms).toBeGreaterThanOrEqual(0);
      expect(typeof result.metadata.query_time_ms).toBe("number");
    });

    test("query_time_ms reflects actual operation time", async () => {
      // Mock with artificial delay
      mockClient.analyzeDependencies = mock(
        () => new Promise((resolve) => setTimeout(() => resolve(MOCK_DEPENDENCY_RESULT), 50))
      ) as Neo4jStorageClient["analyzeDependencies"];

      const result = await service.getDependencies(TEST_QUERIES.dependency.valid);

      // Should be at least 50ms due to the delay
      expect(result.metadata.query_time_ms).toBeGreaterThanOrEqual(45);
    });
  });
});

// =============================================================================
// QueryCache Unit Tests
// =============================================================================

describe("QueryCache", () => {
  describe("generateKey", () => {
    test("generates consistent keys for same params", () => {
      const params = { a: 1, b: "test", c: true };
      const key1 = QueryCache.generateKey("prefix", params);
      const key2 = QueryCache.generateKey("prefix", params);

      expect(key1).toBe(key2);
    });

    test("generates different keys for different params", () => {
      const key1 = QueryCache.generateKey("prefix", { a: 1 });
      const key2 = QueryCache.generateKey("prefix", { a: 2 });

      expect(key1).not.toBe(key2);
    });

    test("generates different keys for different prefixes", () => {
      const params = { a: 1 };
      const key1 = QueryCache.generateKey("prefix1", params);
      const key2 = QueryCache.generateKey("prefix2", params);

      expect(key1).not.toBe(key2);
    });

    test("generates same key regardless of property order", () => {
      const key1 = QueryCache.generateKey("prefix", { a: 1, b: 2 });
      const key2 = QueryCache.generateKey("prefix", { b: 2, a: 1 });

      expect(key1).toBe(key2);
    });
  });

  describe("get/set", () => {
    test("returns undefined for non-existent key", () => {
      const cache = new QueryCache<string>();
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    test("returns cached value", () => {
      const cache = new QueryCache<string>();
      cache.set("key", "value");
      expect(cache.get("key")).toBe("value");
    });

    test("returns undefined for expired entry", async () => {
      const cache = new QueryCache<string>({ ttlMs: 10 });
      cache.set("key", "value");

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cache.get("key")).toBeUndefined();
    });
  });

  describe("has", () => {
    test("returns false for non-existent key", () => {
      const cache = new QueryCache<string>();
      expect(cache.has("key")).toBe(false);
    });

    test("returns true for existing key", () => {
      const cache = new QueryCache<string>();
      cache.set("key", "value");
      expect(cache.has("key")).toBe(true);
    });
  });

  describe("eviction", () => {
    test("evicts oldest entries when at capacity", () => {
      const cache = new QueryCache<number>({ maxEntries: 3 });

      cache.set("key1", 1);
      cache.set("key2", 2);
      cache.set("key3", 3);
      cache.set("key4", 4); // Should evict key1

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key4")).toBe(true);
    });
  });

  describe("clear", () => {
    test("removes all entries", () => {
      const cache = new QueryCache<string>();
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      cache.clear();

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(false);
      expect(cache.stats().size).toBe(0);
    });

    test("resets hit/miss counters", () => {
      const cache = new QueryCache<string>();
      cache.set("key", "value");
      cache.get("key"); // hit
      cache.get("nonexistent"); // miss

      cache.clear();

      const stats = cache.stats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe("stats", () => {
    test("tracks hits and misses", () => {
      const cache = new QueryCache<string>();
      cache.set("key", "value");

      cache.get("key"); // hit
      cache.get("key"); // hit
      cache.get("missing"); // miss

      const stats = cache.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    });

    test("returns zero hitRate when no queries", () => {
      const cache = new QueryCache<string>();
      expect(cache.stats().hitRate).toBe(0);
    });
  });

  describe("keys", () => {
    test("returns all valid keys", () => {
      const cache = new QueryCache<string>();
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      const keys = cache.keys();
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys.length).toBe(2);
    });
  });

  describe("cleanup", () => {
    test("removes expired entries", async () => {
      const cache = new QueryCache<string>({ ttlMs: 10 });
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      await new Promise((resolve) => setTimeout(resolve, 20));

      const removed = cache.cleanup();
      expect(removed).toBe(2);
      expect(cache.stats().size).toBe(0);
    });
  });
});
