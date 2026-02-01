/**
 * @module tests/unit/graph/adapters/index
 *
 * Unit tests for the graph adapter factory function.
 *
 * These tests verify:
 * - Factory function creates correct adapter types
 * - Error handling for unimplemented adapters
 * - Type exports work correctly
 *
 * Note: Neo4j support was removed in favor of FalkorDB per ADR-0004.
 */

import { describe, it, expect, beforeEach, beforeAll } from "bun:test";
import {
  createGraphAdapter,
  type GraphAdapterType,
  type GraphStorageConfig,
  type GraphStorageAdapter,
} from "../../../../src/graph/adapters/index.js";
import { FalkorDBAdapter } from "../../../../src/graph/adapters/FalkorDBAdapter.js";
import { initializeLogger } from "../../../../src/logging/index.js";

// Initialize logger for tests
beforeAll(() => {
  initializeLogger({ level: "error", format: "pretty" });
});

describe("Graph Adapter Factory", () => {
  const testConfig: GraphStorageConfig = {
    host: "localhost",
    port: 6379,
    username: "default",
    password: "test-password",
    database: "knowledge_graph",
  };

  describe("createGraphAdapter", () => {
    describe("FalkorDB adapter", () => {
      it("should create a FalkorDBAdapter for 'falkordb' type", () => {
        const adapter = createGraphAdapter("falkordb", testConfig);

        expect(adapter).toBeInstanceOf(FalkorDBAdapter);
      });

      it("should pass configuration to the FalkorDB adapter", () => {
        const configWithOptions: GraphStorageConfig = {
          ...testConfig,
          maxConnectionPoolSize: 100,
          connectionAcquisitionTimeout: 60000,
          database: "custom_graph",
        };

        const adapter = createGraphAdapter("falkordb", configWithOptions);

        // Adapter is created - configuration is passed internally
        // We can't directly inspect private properties, but the adapter should be valid
        expect(adapter).toBeDefined();
        expect(adapter).toBeInstanceOf(FalkorDBAdapter);
      });

      it("should implement GraphStorageAdapter interface", () => {
        const adapter = createGraphAdapter("falkordb", testConfig);

        // Verify all required methods exist
        expect(typeof adapter.connect).toBe("function");
        expect(typeof adapter.disconnect).toBe("function");
        expect(typeof adapter.healthCheck).toBe("function");
        expect(typeof adapter.runQuery).toBe("function");
        expect(typeof adapter.upsertNode).toBe("function");
        expect(typeof adapter.deleteNode).toBe("function");
        expect(typeof adapter.createRelationship).toBe("function");
        expect(typeof adapter.deleteRelationship).toBe("function");
        expect(typeof adapter.traverse).toBe("function");
        expect(typeof adapter.analyzeDependencies).toBe("function");
        expect(typeof adapter.getContext).toBe("function");
      });
    });

    describe("Invalid adapter type", () => {
      it("should throw an error for unknown adapter types", () => {
        // TypeScript would normally catch this at compile time,
        // but we test runtime behavior for completeness
        expect(() => createGraphAdapter("unknown" as GraphAdapterType, testConfig)).toThrow(
          /Unknown graph adapter type/
        );
      });
    });
  });

  describe("Type exports", () => {
    it("should export GraphAdapterType", () => {
      // Verify type can be used (only falkordb is supported now)
      const falkordb: GraphAdapterType = "falkordb";

      expect(falkordb).toBe("falkordb");
    });

    it("should export GraphStorageConfig", () => {
      // Verify config type works
      const config: GraphStorageConfig = {
        host: "test",
        port: 1234,
        username: "user",
        password: "pass",
      };

      expect(config).toBeDefined();
    });

    it("should export GraphStorageAdapter interface", () => {
      // Verify adapter type works with factory result
      const adapter: GraphStorageAdapter = createGraphAdapter("falkordb", testConfig);

      expect(adapter).toBeDefined();
    });
  });

  describe("Adapter lifecycle", () => {
    let adapter: GraphStorageAdapter;

    beforeEach(() => {
      adapter = createGraphAdapter("falkordb", testConfig);
    });

    it("should create adapter without connecting", () => {
      // Adapter should be created but not connected
      // healthCheck should return false when not connected
      expect(adapter).toBeDefined();
    });

    it("should have disconnect method that can be called safely", async () => {
      // Disconnect should not throw even if not connected
      const disconnectPromise = adapter.disconnect();
      expect(disconnectPromise).toBeInstanceOf(Promise);
      const result = await disconnectPromise;
      expect(result).toBeUndefined();
    });
  });
});

describe("Adapter Factory Integration", () => {
  describe("Configuration validation", () => {
    it("should accept minimal valid configuration", () => {
      const minimalConfig: GraphStorageConfig = {
        host: "localhost",
        port: 6379,
        username: "default",
        password: "test",
      };

      const adapter = createGraphAdapter("falkordb", minimalConfig);
      expect(adapter).toBeDefined();
    });

    it("should accept configuration with retry settings", () => {
      const configWithRetry: GraphStorageConfig = {
        host: "localhost",
        port: 6379,
        username: "default",
        password: "test",
        retry: {
          maxRetries: 3,
          initialDelayMs: 100,
          maxDelayMs: 1000,
          backoffMultiplier: 2,
        },
      };

      const adapter = createGraphAdapter("falkordb", configWithRetry);
      expect(adapter).toBeDefined();
    });

    it("should accept configuration with all optional fields", () => {
      const fullConfig: GraphStorageConfig = {
        host: "graph.example.com",
        port: 6379,
        username: "admin",
        password: "secret",
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 30000,
        database: "production_graph",
        retry: {
          maxRetries: 5,
          initialDelayMs: 200,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
        },
      };

      const adapter = createGraphAdapter("falkordb", fullConfig);
      expect(adapter).toBeDefined();
    });
  });
});
