/**
 * Unit tests for FalkorDBAdapter
 *
 * Tests all adapter functionality with mocked FalkorDB client to ensure
 * proper behavior without requiring a real FalkorDB instance.
 */

/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  GraphConnectionError,
  GraphError,
  NodeNotFoundError,
  isRetryableGraphError,
} from "../../../../src/graph/errors.js";
import {
  RelationshipType,
  type RepositoryNode,
  type FileNode,
  type FunctionNode,
  type ClassNode,
  type ModuleNode,
  type ChunkNode,
  type ConceptNode,
} from "../../../../src/graph/types.js";
import {
  MockFalkorDBClient,
  MockGraph,
  mockFalkorRecordFactories,
  sampleMockFalkorNodes,
  sampleMockFalkorRelationships,
  testFalkorConfig,
  testFalkorErrorMessages,
  createMockFalkorNode,
} from "../../../helpers/falkordb-mock.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Shared mock state
let mockGraph: MockGraph;
let mockClient: MockFalkorDBClient;

// Mock the falkordb module BEFORE importing the adapter
void mock.module("falkordb", () => {
  return {
    FalkorDB: {
      connect: async () => {
        if (mockClient.shouldFailConnect) {
          throw mockClient.connectError;
        }
        return mockClient;
      },
    },
  };
});

// Import FalkorDBAdapter AFTER the mock is set up
// Dynamic import required so the mock is set up before import
const { FalkorDBAdapter } = await import("../../../../src/graph/adapters/FalkorDBAdapter.js");

// Initialize logger for tests
beforeEach(() => {
  initializeLogger({ level: "silent", format: "json" });
  mockGraph = new MockGraph();
  mockClient = new MockFalkorDBClient();
  mockClient.setGraph(mockGraph);
  // Set a default query result for health check
  mockGraph.setQueryResult("RETURN 1", mockFalkorRecordFactories.emptyResult());
});

afterEach(() => {
  resetLogger();
});

describe("FalkorDBAdapter", () => {
  describe("constructor", () => {
    test("should create instance with config", () => {
      const adapter = new FalkorDBAdapter(testFalkorConfig);
      expect(adapter).toBeDefined();
      expect(typeof adapter.connect).toBe("function");
      expect(typeof adapter.disconnect).toBe("function");
      expect(typeof adapter.healthCheck).toBe("function");
    });

    test("should use default retry config when not provided", () => {
      const configWithoutRetry = {
        host: "localhost",
        port: 6379,
        username: "default",
        password: "password",
      };
      const adapter = new FalkorDBAdapter(configWithoutRetry);
      expect(adapter).toBeDefined();
      expect(typeof adapter.connect).toBe("function");
    });
  });

  describe("connect", () => {
    test("should connect successfully", async () => {
      const adapter = new FalkorDBAdapter(testFalkorConfig);
      // Health check query should succeed
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });

      await adapter.connect();

      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(true);

      await adapter.disconnect();
    });

    test("should throw GraphConnectionError when health check fails", async () => {
      const adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setShouldFail(true, new Error("Connection failed"));

      await expect(adapter.connect()).rejects.toThrow(GraphConnectionError);
    });
  });

  describe("disconnect", () => {
    test("should disconnect gracefully", async () => {
      const adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });

      await adapter.connect();
      await adapter.disconnect();

      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(false);
    });

    test("should handle disconnect when not connected", async () => {
      const adapter = new FalkorDBAdapter(testFalkorConfig);
      // Should not throw
      await adapter.disconnect();
    });
  });

  describe("healthCheck", () => {
    test("should return true when connected and healthy", async () => {
      const adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });

      await adapter.connect();
      const healthy = await adapter.healthCheck();

      expect(healthy).toBe(true);

      await adapter.disconnect();
    });

    test("should return false when not connected", async () => {
      const adapter = new FalkorDBAdapter(testFalkorConfig);
      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe("runQuery", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should throw when not connected", async () => {
      const disconnectedAdapter = new FalkorDBAdapter(testFalkorConfig);
      await expect(disconnectedAdapter.runQuery("MATCH (n) RETURN n")).rejects.toThrow(
        GraphConnectionError
      );
    });

    test("should execute query and return results", async () => {
      // Use FalkorDB's actual format: data is array of objects with named properties
      mockGraph.setQueryResult("MATCH", {
        metadata: [],
        data: [{ name: "test", count: 5 }],
      });

      const results = await adapter.runQuery<{ name: string; count: number }>(
        "MATCH (n) RETURN n.name as name, count(n) as count"
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("test");
      expect(results[0]?.count).toBe(5);
    });

    test("should handle empty results", async () => {
      mockGraph.setQueryResult("MATCH", mockFalkorRecordFactories.emptyResult());

      const results = await adapter.runQuery("MATCH (n:NonExistent) RETURN n");
      expect(results).toHaveLength(0);
    });

    test("should handle query parameters", async () => {
      mockGraph.setQueryResult(
        "MATCH",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.repository)
      );

      const results = await adapter.runQuery("MATCH (n:Repository {name: $name}) RETURN n", {
        name: "test-repo",
      });

      expect(results).toHaveLength(1);
    });

    test("should map errors correctly", async () => {
      mockGraph.setShouldFail(true, new Error(testFalkorErrorMessages.syntaxError));

      await expect(adapter.runQuery("INVALID CYPHER")).rejects.toThrow(GraphError);
    });
  });

  describe("upsertNode", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should create a Repository node", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.repository)
      );

      const node = {
        labels: ["Repository"],
        name: "test-repo",
        url: "https://github.com/test/test-repo",
        lastIndexed: new Date().toISOString(),
        status: "ready" as const,
      };

      const result = await adapter.upsertNode<RepositoryNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("test-repo");
    });

    test("should create a File node", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.file)
      );

      const node = {
        labels: ["File"],
        path: "src/index.ts",
        extension: "ts",
        hash: "abc123def456",
        repository: "test-repo",
      };

      const result = await adapter.upsertNode<FileNode>(node);

      expect(result).toBeDefined();
      expect(result.path).toBe("src/index.ts");
    });

    test("should create a Function node", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.function)
      );

      const node = {
        labels: ["Function"],
        name: "main",
        signature: "async main(): Promise<void>",
        startLine: 10,
        endLine: 20,
        filePath: "src/index.ts",
        repository: "test-repo",
      };

      const result = await adapter.upsertNode<FunctionNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("main");
    });

    test("should create a Class node", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.class)
      );

      const node = {
        labels: ["Class"],
        name: "TestClass",
        type: "class" as const,
        filePath: "src/TestClass.ts",
        startLine: 1,
        endLine: 50,
        repository: "test-repo",
      };

      const result = await adapter.upsertNode<ClassNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("TestClass");
    });

    test("should create a Module node", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.module)
      );

      const node = {
        labels: ["Module"],
        name: "lodash",
        type: "npm" as const,
        version: "4.17.21",
      };

      const result = await adapter.upsertNode<ModuleNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("lodash");
    });

    test("should create a Chunk node", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.chunk)
      );

      const node = {
        labels: ["Chunk"],
        chromaId: "test-repo:src/index.ts:0",
        chunkIndex: 0,
        filePath: "src/index.ts",
        repository: "test-repo",
      };

      const result = await adapter.upsertNode<ChunkNode>(node);

      expect(result).toBeDefined();
      expect(result.chromaId).toBe("test-repo:src/index.ts:0");
    });

    test("should create a Concept node", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.concept)
      );

      const node = {
        labels: ["Concept"],
        name: "authentication",
        description: "User authentication",
        confidence: 0.9,
      };

      const result = await adapter.upsertNode<ConceptNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("authentication");
    });

    test("should use provided ID if available", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(
          createMockFalkorNode(1, ["File"], {
            id: "custom-id",
            path: "src/index.ts",
            extension: "ts",
            hash: "abc123def456",
            repository: "test-repo",
          })
        )
      );

      const node = {
        id: "custom-id",
        labels: ["File"],
        path: "src/index.ts",
        extension: "ts",
        hash: "abc123def456",
        repository: "test-repo",
      };

      const result = await adapter.upsertNode(node);
      expect(result.id).toBe("custom-id");
    });

    test("should throw when not connected", async () => {
      const disconnectedAdapter = new FalkorDBAdapter(testFalkorConfig);
      const node = {
        labels: ["File"],
        path: "src/index.ts",
        extension: "ts",
        hash: "abc123def456",
        repository: "test-repo",
      };

      await expect(disconnectedAdapter.upsertNode(node)).rejects.toThrow(GraphConnectionError);
    });

    test("should reject invalid node labels with Cypher injection attempts", async () => {
      const maliciousNode = {
        labels: ["EVIL}]->(m) DELETE m;//"],
        name: "malicious",
        url: "https://example.com",
        description: "Test",
      } as unknown as Omit<RepositoryNode, "id">;

      await expect(adapter.upsertNode(maliciousNode)).rejects.toThrow(GraphError);
      await expect(adapter.upsertNode(maliciousNode)).rejects.toThrow(/Invalid node label/);
    });

    test("should reject labels that do not start with a letter", async () => {
      const invalidNode = {
        labels: ["123Invalid"],
        name: "test",
        url: "https://example.com",
        description: "Test",
      } as unknown as Omit<RepositoryNode, "id">;

      await expect(adapter.upsertNode(invalidNode)).rejects.toThrow(GraphError);
    });

    test("should reject labels with special characters", async () => {
      const invalidNode = {
        labels: ["Invalid-Label"],
        name: "test",
        url: "https://example.com",
        description: "Test",
      } as unknown as Omit<RepositoryNode, "id">;

      await expect(adapter.upsertNode(invalidNode)).rejects.toThrow(GraphError);
    });

    test("should accept valid labels with underscores and numbers", async () => {
      mockGraph.setQueryResult(
        "MERGE",
        mockFalkorRecordFactories.nodeReturn(sampleMockFalkorNodes.repository)
      );

      const validNode = {
        labels: ["Valid_Label_123"],
        name: "test-repo",
        url: "https://github.com/test/test-repo",
        lastIndexed: new Date().toISOString(),
        status: "ready" as const,
      };

      const result = await adapter.upsertNode<RepositoryNode>(validNode);
      expect(result).toBeDefined();
    });
  });

  describe("deleteNode", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should delete existing node and return true", async () => {
      mockGraph.setQueryResult("DELETE", mockFalkorRecordFactories.deleteCount(1));

      const result = await adapter.deleteNode("File:test-repo:src/index.ts");
      expect(result).toBe(true);
    });

    test("should return false when node not found", async () => {
      mockGraph.setQueryResult("DELETE", mockFalkorRecordFactories.deleteCount(0));

      const result = await adapter.deleteNode("File:non-existent");
      expect(result).toBe(false);
    });

    test("should throw when not connected", async () => {
      const disconnectedAdapter = new FalkorDBAdapter(testFalkorConfig);

      await expect(disconnectedAdapter.deleteNode("some-id")).rejects.toThrow(GraphConnectionError);
    });
  });

  describe("createRelationship", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should create relationship without properties", async () => {
      mockGraph.setQueryResult(
        "CREATE",
        mockFalkorRecordFactories.relationshipReturn(sampleMockFalkorRelationships.contains, 100)
      );

      const result = await adapter.createRelationship(
        "Repository:test-repo",
        "File:test-repo:src/index.ts",
        RelationshipType.CONTAINS
      );

      expect(result).toBeDefined();
      expect(result.type).toBe(RelationshipType.CONTAINS);
      expect(result.fromNodeId).toBe("Repository:test-repo");
      expect(result.toNodeId).toBe("File:test-repo:src/index.ts");
    });

    test("should create relationship with properties", async () => {
      mockGraph.setQueryResult(
        "CREATE",
        mockFalkorRecordFactories.relationshipReturn(sampleMockFalkorRelationships.imports, 102)
      );

      const result = await adapter.createRelationship(
        "File:test-repo:src/index.ts",
        "Module:lodash",
        RelationshipType.IMPORTS,
        { importType: "named", importedSymbols: ["map", "filter"] }
      );

      expect(result).toBeDefined();
      expect(result.type).toBe(RelationshipType.IMPORTS);
      expect(result.properties).toBeDefined();
    });

    test("should throw NodeNotFoundError when source node not found", async () => {
      // First query returns no results
      mockGraph.setQueryResult("CREATE", mockFalkorRecordFactories.emptyResult());
      // Second query checks node existence
      mockGraph.setQueryResult("OPTIONAL", mockFalkorRecordFactories.nodeExistence(false, true));

      await expect(
        adapter.createRelationship(
          "Node:non-existent",
          "File:test-repo:src/index.ts",
          RelationshipType.CONTAINS
        )
      ).rejects.toThrow(NodeNotFoundError);
    });

    test("should throw NodeNotFoundError when target node not found", async () => {
      mockGraph.setQueryResult("CREATE", mockFalkorRecordFactories.emptyResult());
      mockGraph.setQueryResult("OPTIONAL", mockFalkorRecordFactories.nodeExistence(true, false));

      await expect(
        adapter.createRelationship(
          "Repository:test-repo",
          "Node:non-existent",
          RelationshipType.CONTAINS
        )
      ).rejects.toThrow(NodeNotFoundError);
    });

    test("should throw when not connected", async () => {
      const disconnectedAdapter = new FalkorDBAdapter(testFalkorConfig);

      await expect(
        disconnectedAdapter.createRelationship("from", "to", RelationshipType.CONTAINS)
      ).rejects.toThrow(GraphConnectionError);
    });

    test("should reject invalid relationship types with Cypher injection attempts", async () => {
      await expect(
        adapter.createRelationship("from", "to", "EVIL}]->(m);//" as RelationshipType)
      ).rejects.toThrow(GraphError);
      await expect(
        adapter.createRelationship("from", "to", "EVIL}]->(m);//" as RelationshipType)
      ).rejects.toThrow(/Invalid relationship type/);
    });

    test("should reject relationship types that do not start with a letter", async () => {
      await expect(
        adapter.createRelationship("from", "to", "123INVALID" as RelationshipType)
      ).rejects.toThrow(GraphError);
    });

    test("should reject relationship types with special characters", async () => {
      await expect(
        adapter.createRelationship("from", "to", "INVALID-TYPE" as RelationshipType)
      ).rejects.toThrow(GraphError);
    });
  });

  describe("deleteRelationship", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should delete existing relationship and return true", async () => {
      mockGraph.setQueryResult("DELETE", mockFalkorRecordFactories.deleteCount(1));

      const result = await adapter.deleteRelationship("100");
      expect(result).toBe(true);
    });

    test("should return false when relationship not found", async () => {
      mockGraph.setQueryResult("DELETE", mockFalkorRecordFactories.deleteCount(0));

      const result = await adapter.deleteRelationship("999");
      expect(result).toBe(false);
    });

    test("should throw when not connected", async () => {
      const disconnectedAdapter = new FalkorDBAdapter(testFalkorConfig);

      await expect(disconnectedAdapter.deleteRelationship("some-id")).rejects.toThrow(
        GraphConnectionError
      );
    });
  });

  describe("traverse", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should traverse from file node", async () => {
      mockGraph.setQueryResult(
        "MATCH",
        mockFalkorRecordFactories.traversalResult(
          sampleMockFalkorNodes.file,
          [sampleMockFalkorNodes.function],
          [[sampleMockFalkorRelationships.defines]]
        )
      );

      const result = await adapter.traverse({
        startNode: { type: "file", identifier: "src/index.ts" },
        relationships: [RelationshipType.DEFINES],
        depth: 2,
      });

      expect(result).toBeDefined();
      expect(result.metadata.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("should traverse from function node", async () => {
      mockGraph.setQueryResult(
        "MATCH",
        mockFalkorRecordFactories.traversalResult(sampleMockFalkorNodes.function, [], [])
      );

      const result = await adapter.traverse({
        startNode: { type: "function", identifier: "main" },
        relationships: [RelationshipType.CALLS],
        depth: 1,
      });

      expect(result).toBeDefined();
    });

    test("should traverse from class node", async () => {
      mockGraph.setQueryResult(
        "MATCH",
        mockFalkorRecordFactories.traversalResult(sampleMockFalkorNodes.class, [], [])
      );

      const result = await adapter.traverse({
        startNode: { type: "class", identifier: "TestClass" },
        relationships: [RelationshipType.IMPLEMENTS],
        depth: 1,
      });

      expect(result).toBeDefined();
    });

    test("should respect depth limit", async () => {
      mockGraph.setQueryResult(
        "MATCH",
        mockFalkorRecordFactories.traversalResult(sampleMockFalkorNodes.file, [], [])
      );

      const result = await adapter.traverse({
        startNode: { type: "file", identifier: "src/index.ts" },
        relationships: [RelationshipType.IMPORTS],
        depth: 10, // Should be capped at 5
      });

      expect(result.metadata.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("should filter by repository", async () => {
      mockGraph.setQueryResult(
        "MATCH",
        mockFalkorRecordFactories.traversalResult(sampleMockFalkorNodes.file, [], [])
      );

      const result = await adapter.traverse({
        startNode: {
          type: "file",
          identifier: "src/index.ts",
          repository: "test-repo",
        },
        relationships: [RelationshipType.CONTAINS],
      });

      expect(result).toBeDefined();
    });

    test("should throw when not connected", async () => {
      const disconnectedAdapter = new FalkorDBAdapter(testFalkorConfig);

      await expect(
        disconnectedAdapter.traverse({
          startNode: { type: "file", identifier: "test" },
          relationships: [RelationshipType.CONTAINS],
        })
      ).rejects.toThrow(GraphConnectionError);
    });
  });

  describe("analyzeDependencies", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should analyze direct dependencies (dependsOn)", async () => {
      mockGraph.setQueryResult(
        "MATCH",
        mockFalkorRecordFactories.dependencyResult(sampleMockFalkorNodes.module, "IMPORTS", 1)
      );

      const result = await adapter.analyzeDependencies({
        target: {
          type: "file",
          identifier: "src/index.ts",
          repository: "test-repo",
        },
        direction: "dependsOn",
      });

      expect(result).toBeDefined();
      expect(result.metadata.directCount).toBeGreaterThanOrEqual(0);
    });

    test("should analyze direct dependencies (dependedOnBy)", async () => {
      mockGraph.setQueryResult(
        "MATCH",
        mockFalkorRecordFactories.dependencyResult(sampleMockFalkorNodes.file, "IMPORTS", 1)
      );

      const result = await adapter.analyzeDependencies({
        target: {
          type: "function",
          identifier: "main",
          repository: "test-repo",
        },
        direction: "dependedOnBy",
      });

      expect(result).toBeDefined();
    });

    test("should analyze both directions", async () => {
      mockGraph.setQueryResult("MATCH", mockFalkorRecordFactories.emptyResult());

      const result = await adapter.analyzeDependencies({
        target: {
          type: "class",
          identifier: "TestClass",
          repository: "test-repo",
        },
        direction: "both",
      });

      expect(result).toBeDefined();
    });

    test("should include transitive dependencies when requested", async () => {
      mockGraph.setQueryResult("MATCH", mockFalkorRecordFactories.emptyResult());
      mockGraph.setQueryResult("path", mockFalkorRecordFactories.emptyResult());

      const result = await adapter.analyzeDependencies({
        target: {
          type: "file",
          identifier: "src/index.ts",
          repository: "test-repo",
        },
        direction: "dependsOn",
        transitive: true,
        maxDepth: 3,
      });

      expect(result).toBeDefined();
      expect(result.transitive).toBeDefined();
    });

    test("should calculate impact score", async () => {
      mockGraph.setQueryResult("MATCH", {
        metadata: [],
        data: [
          { dep: sampleMockFalkorNodes.file, relType: "IMPORTS", depth: 1 },
          { dep: sampleMockFalkorNodes.function, relType: "CALLS", depth: 1 },
        ],
      });

      const result = await adapter.analyzeDependencies({
        target: {
          type: "file",
          identifier: "src/index.ts",
          repository: "test-repo",
        },
        direction: "dependedOnBy",
      });

      expect(result.impactScore).toBeGreaterThanOrEqual(0);
      expect(result.impactScore).toBeLessThanOrEqual(1);
    });

    test("should throw when not connected", async () => {
      const disconnectedAdapter = new FalkorDBAdapter(testFalkorConfig);

      await expect(
        disconnectedAdapter.analyzeDependencies({
          target: { type: "file", identifier: "test", repository: "repo" },
          direction: "dependsOn",
        })
      ).rejects.toThrow(GraphConnectionError);
    });
  });

  describe("getContext", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter(testFalkorConfig);
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should get imports context", async () => {
      mockGraph.setQueryResult(
        "IMPORTS",
        mockFalkorRecordFactories.contextResult(sampleMockFalkorNodes.module, "imports")
      );

      const result = await adapter.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["imports"],
      });

      expect(result).toBeDefined();
      expect(result.metadata.seedsProcessed).toBe(1);
    });

    test("should get callers context", async () => {
      mockGraph.setQueryResult(
        "CALLS",
        mockFalkorRecordFactories.contextResult(sampleMockFalkorNodes.function, "callers")
      );

      const result = await adapter.getContext({
        seeds: [{ type: "function", identifier: "main" }],
        includeContext: ["callers"],
      });

      expect(result).toBeDefined();
    });

    test("should get callees context", async () => {
      mockGraph.setQueryResult(
        "CALLS",
        mockFalkorRecordFactories.contextResult(sampleMockFalkorNodes.function, "callees")
      );

      const result = await adapter.getContext({
        seeds: [{ type: "function", identifier: "main" }],
        includeContext: ["callees"],
      });

      expect(result).toBeDefined();
    });

    test("should get siblings context", async () => {
      mockGraph.setQueryResult(
        "CONTAINS",
        mockFalkorRecordFactories.contextResult(sampleMockFalkorNodes.file, "siblings")
      );

      const result = await adapter.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["siblings"],
      });

      expect(result).toBeDefined();
    });

    test("should get documentation context", async () => {
      mockGraph.setQueryResult("REFERENCES", mockFalkorRecordFactories.emptyResult());

      const result = await adapter.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["documentation"],
      });

      expect(result).toBeDefined();
    });

    test("should handle multiple seeds", async () => {
      mockGraph.setQueryResult("IMPORTS", mockFalkorRecordFactories.emptyResult());
      mockGraph.setQueryResult("CALLS", mockFalkorRecordFactories.emptyResult());

      const result = await adapter.getContext({
        seeds: [
          { type: "file", identifier: "src/index.ts" },
          { type: "function", identifier: "main" },
        ],
        includeContext: ["imports"],
      });

      expect(result.metadata.seedsProcessed).toBe(2);
    });

    test("should handle multiple context types", async () => {
      mockGraph.setQueryResult("IMPORTS", mockFalkorRecordFactories.emptyResult());
      mockGraph.setQueryResult("CALLS", mockFalkorRecordFactories.emptyResult());
      mockGraph.setQueryResult("CONTAINS", mockFalkorRecordFactories.emptyResult());

      const result = await adapter.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["imports", "callers", "callees", "siblings"],
      });

      expect(result).toBeDefined();
    });

    test("should respect limit", async () => {
      mockGraph.setQueryResult("IMPORTS", mockFalkorRecordFactories.emptyResult());

      const result = await adapter.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["imports"],
        limit: 5,
      });

      expect(result.context.length).toBeLessThanOrEqual(5);
    });

    test("should filter by repository", async () => {
      mockGraph.setQueryResult("IMPORTS", mockFalkorRecordFactories.emptyResult());

      const result = await adapter.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts", repository: "test-repo" }],
        includeContext: ["imports"],
      });

      expect(result).toBeDefined();
    });

    test("should throw when not connected", async () => {
      const disconnectedAdapter = new FalkorDBAdapter(testFalkorConfig);

      await expect(
        disconnectedAdapter.getContext({
          seeds: [{ type: "file", identifier: "test" }],
          includeContext: ["imports"],
        })
      ).rejects.toThrow(GraphConnectionError);
    });
  });

  describe("error handling", () => {
    test("isRetryableGraphError should identify retryable errors", () => {
      const connectionError = new GraphConnectionError("Connection failed");
      expect(isRetryableGraphError(connectionError)).toBe(true);

      const nodeNotFoundError = new NodeNotFoundError("node-1");
      expect(isRetryableGraphError(nodeNotFoundError)).toBe(false);
    });

    test("isRetryableGraphError should identify retryable native errors", () => {
      const econnrefused = new Error("ECONNREFUSED");
      expect(isRetryableGraphError(econnrefused)).toBe(true);

      const syntaxError = new Error("Invalid syntax");
      expect(isRetryableGraphError(syntaxError)).toBe(false);
    });
  });

  describe("retry behavior", () => {
    let adapter: InstanceType<typeof FalkorDBAdapter>;

    beforeEach(async () => {
      adapter = new FalkorDBAdapter({
        ...testFalkorConfig,
        retry: {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        },
      });
      mockGraph.setQueryResult("RETURN 1", { metadata: [], data: [{ health: 1 }] });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    test("should retry on transient errors", async () => {
      // First call fails, second succeeds
      let callCount = 0;
      const originalQuery = mockGraph.query.bind(mockGraph);
      mockGraph.query = async <T>(cypher: string, options?: unknown) => {
        callCount++;
        if (callCount === 1 && cypher.includes("MATCH")) {
          throw new Error("ECONNRESET");
        }
        return originalQuery<T>(cypher, options);
      };

      mockGraph.setQueryResult("MATCH", {
        metadata: [],
        data: [{ count: 1 }],
      });

      const results = await adapter.runQuery("MATCH (n) RETURN count(n) as count");
      expect(results).toHaveLength(1);
      expect(callCount).toBe(2);
    });

    test("should not retry on non-retryable errors", async () => {
      // Reset query count after connection is established
      const initialQueryCount = mockGraph.queryCount;
      mockGraph.setShouldFail(true, new Error("Invalid syntax"));

      await expect(adapter.runQuery("INVALID")).rejects.toThrow();
      // Only one call should have been made (retries don't occur for non-retryable)
      expect(mockGraph.queryCount - initialQueryCount).toBe(1);
    });
  });
});
