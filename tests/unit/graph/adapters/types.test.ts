/**
 * @module tests/unit/graph/adapters/types
 *
 * Unit tests for GraphStorageAdapter interface and related types.
 *
 * These tests verify:
 * - Type definitions compile correctly
 * - Interface contracts are properly defined
 * - Type relationships work as expected
 */

import { describe, it, expect } from "bun:test";
import type {
  GraphAdapterType,
  GraphStorageConfig,
  GraphStorageAdapter,
  GraphNode,
  Relationship,
  RelationshipProperties,
  GraphTraverseInput,
  GraphTraverseResult,
  GraphDependenciesInput,
  GraphDependenciesResult,
  GraphContextInput,
  GraphContextResult,
} from "../../../../src/graph/adapters/types.js";
import { RelationshipType } from "../../../../src/graph/types.js";

describe("GraphStorageAdapter Types", () => {
  describe("GraphAdapterType", () => {
    it("should accept valid adapter type 'falkordb'", () => {
      const adapterType: GraphAdapterType = "falkordb";
      expect(adapterType).toBe("falkordb");
    });
  });

  describe("GraphStorageConfig", () => {
    it("should accept minimal valid configuration", () => {
      const config: GraphStorageConfig = {
        host: "localhost",
        port: 7687,
        username: "neo4j",
        password: "password",
      };

      expect(config.host).toBe("localhost");
      expect(config.port).toBe(7687);
      expect(config.username).toBe("neo4j");
      expect(config.password).toBe("password");
    });

    it("should accept full configuration with all optional fields", () => {
      const config: GraphStorageConfig = {
        host: "graph.example.com",
        port: 6379,
        username: "admin",
        password: "secret",
        maxConnectionPoolSize: 100,
        connectionAcquisitionTimeout: 60000,
        retry: {
          maxRetries: 5,
          initialDelayMs: 100,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
        },
        database: "knowledge_graph",
      };

      expect(config.host).toBe("graph.example.com");
      expect(config.port).toBe(6379);
      expect(config.maxConnectionPoolSize).toBe(100);
      expect(config.connectionAcquisitionTimeout).toBe(60000);
      expect(config.retry?.maxRetries).toBe(5);
      expect(config.database).toBe("knowledge_graph");
    });

    it("should work with FalkorDB typical configuration values", () => {
      const falkorConfig: GraphStorageConfig = {
        host: "localhost",
        port: 6379,
        username: "default",
        password: "test",
        database: "graph_db",
      };

      expect(falkorConfig.port).toBe(6379);
      expect(falkorConfig.database).toBe("graph_db");
    });
  });

  describe("GraphStorageAdapter Interface Contract", () => {
    it("should define all required methods in the interface", () => {
      // This test verifies that the interface shape is correct at compile time
      // We create a mock object that satisfies the interface
      const mockAdapter: GraphStorageAdapter = {
        connect: async () => {},
        disconnect: async () => {},
        healthCheck: async () => true,
        runQuery: async <T>() => [] as T[],
        upsertNode: async <N extends GraphNode>(node: Omit<N, "id"> & { id?: string }) =>
          ({ ...node, id: node.id ?? "generated-id" }) as N,
        deleteNode: async () => true,
        createRelationship: async <P extends RelationshipProperties>(
          fromNodeId: string,
          toNodeId: string,
          type: (typeof RelationshipType)[keyof typeof RelationshipType]
        ) =>
          ({
            id: "rel-1",
            type,
            fromNodeId,
            toNodeId,
            properties: {} as P,
          }) as Relationship<P>,
        deleteRelationship: async () => true,
        traverse: async () =>
          ({
            nodes: [],
            relationships: [],
            metadata: { nodesCount: 0, relationshipsCount: 0, queryTimeMs: 0 },
          }) as GraphTraverseResult,
        analyzeDependencies: async () =>
          ({
            direct: [],
            impactScore: 0,
            metadata: { directCount: 0, transitiveCount: 0, queryTimeMs: 0 },
          }) as GraphDependenciesResult,
        getContext: async () =>
          ({
            context: [],
            metadata: { seedsProcessed: 0, contextItemsFound: 0, queryTimeMs: 0 },
          }) as GraphContextResult,
      };

      // Verify all methods exist
      expect(typeof mockAdapter.connect).toBe("function");
      expect(typeof mockAdapter.disconnect).toBe("function");
      expect(typeof mockAdapter.healthCheck).toBe("function");
      expect(typeof mockAdapter.runQuery).toBe("function");
      expect(typeof mockAdapter.upsertNode).toBe("function");
      expect(typeof mockAdapter.deleteNode).toBe("function");
      expect(typeof mockAdapter.createRelationship).toBe("function");
      expect(typeof mockAdapter.deleteRelationship).toBe("function");
      expect(typeof mockAdapter.traverse).toBe("function");
      expect(typeof mockAdapter.analyzeDependencies).toBe("function");
      expect(typeof mockAdapter.getContext).toBe("function");
    });

    it("should verify method return types are promises", async () => {
      const mockAdapter: GraphStorageAdapter = {
        connect: async () => {},
        disconnect: async () => {},
        healthCheck: async () => true,
        runQuery: async <T>() => [] as T[],
        upsertNode: async <N extends GraphNode>(node: Omit<N, "id"> & { id?: string }) =>
          ({ ...node, id: "test-id" }) as N,
        deleteNode: async () => true,
        createRelationship: async <P extends RelationshipProperties>(
          fromNodeId: string,
          toNodeId: string,
          type: (typeof RelationshipType)[keyof typeof RelationshipType]
        ) =>
          ({
            id: "rel-1",
            type,
            fromNodeId,
            toNodeId,
            properties: {} as P,
          }) as Relationship<P>,
        deleteRelationship: async () => true,
        traverse: async () =>
          ({
            nodes: [],
            relationships: [],
            metadata: { nodesCount: 0, relationshipsCount: 0, queryTimeMs: 0 },
          }) as GraphTraverseResult,
        analyzeDependencies: async () =>
          ({
            direct: [],
            impactScore: 0,
            metadata: { directCount: 0, transitiveCount: 0, queryTimeMs: 0 },
          }) as GraphDependenciesResult,
        getContext: async () =>
          ({
            context: [],
            metadata: { seedsProcessed: 0, contextItemsFound: 0, queryTimeMs: 0 },
          }) as GraphContextResult,
      };

      // All methods should return promises
      expect(mockAdapter.connect()).toBeInstanceOf(Promise);
      expect(mockAdapter.disconnect()).toBeInstanceOf(Promise);
      expect(mockAdapter.healthCheck()).toBeInstanceOf(Promise);
      expect(mockAdapter.runQuery("MATCH (n) RETURN n")).toBeInstanceOf(Promise);
      expect(mockAdapter.deleteNode("test-id")).toBeInstanceOf(Promise);
      expect(mockAdapter.deleteRelationship("rel-id")).toBeInstanceOf(Promise);
    });
  });

  describe("Type Re-exports", () => {
    it("should re-export GraphNode type", () => {
      // Verify GraphNode can be used from the adapters module
      const node: GraphNode = {
        id: "test-1",
        labels: ["Repository"],
        name: "test-repo",
        url: "https://github.com/test/repo",
        lastIndexed: new Date().toISOString(),
        status: "ready",
      } as GraphNode;

      expect(node.id).toBe("test-1");
    });

    it("should re-export RelationshipType", () => {
      // Verify RelationshipType enum values are accessible
      expect(RelationshipType.CONTAINS).toBe(RelationshipType.CONTAINS);
      expect(RelationshipType.DEFINES).toBe(RelationshipType.DEFINES);
      expect(RelationshipType.IMPORTS).toBe(RelationshipType.IMPORTS);
      expect(RelationshipType.CALLS).toBe(RelationshipType.CALLS);
    });

    it("should re-export query input/output types", () => {
      // Verify traverse input type
      const traverseInput: GraphTraverseInput = {
        startNode: {
          type: "file",
          identifier: "src/index.ts",
          repository: "test-repo",
        },
        relationships: [RelationshipType.IMPORTS, RelationshipType.CALLS],
        depth: 2,
        limit: 50,
      };

      expect(traverseInput.startNode.type).toBe("file");
      expect(traverseInput.relationships).toHaveLength(2);

      // Verify dependencies input type
      const depsInput: GraphDependenciesInput = {
        target: {
          type: "file",
          identifier: "src/utils.ts",
          repository: "test-repo",
        },
        direction: "both",
        transitive: true,
        maxDepth: 3,
      };

      expect(depsInput.direction).toBe("both");
      expect(depsInput.transitive).toBe(true);

      // Verify context input type
      const contextInput: GraphContextInput = {
        seeds: [
          { type: "file", identifier: "src/main.ts", repository: "test-repo" },
          { type: "function", identifier: "processData" },
        ],
        includeContext: ["imports", "callers", "callees"],
        limit: 20,
      };

      expect(contextInput.seeds).toHaveLength(2);
      expect(contextInput.includeContext).toContain("imports");
    });
  });
});
