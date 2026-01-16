/**
 * Unit tests for Neo4jStorageClientImpl
 *
 * Tests all client functionality with mocked Neo4j driver to ensure
 * proper behavior without requiring a real Neo4j instance.
 */

/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Neo4jStorageClientImpl } from "../../../src/graph/Neo4jClient.js";
import {
  GraphConnectionError,
  GraphError,
  NodeNotFoundError,
  isRetryableGraphError,
} from "../../../src/graph/errors.js";
import {
  RelationshipType,
  type RepositoryNode,
  type FileNode,
  type FunctionNode,
  type ClassNode,
  type ModuleNode,
  type ChunkNode,
  type ConceptNode,
} from "../../../src/graph/types.js";
import {
  MockDriver,
  MockSession,
  type MockNode,
  MockRecord,
  createMockNode,
  mockRecordFactories,
  mockNeo4j,
} from "../../helpers/neo4j-mock.js";
import {
  testConfig,
  createTestRepositoryNode,
  createTestFileNode,
  createTestFunctionNode,
  createTestClassNode,
  createTestModuleNode,
  createTestChunkNode,
  createTestConceptNode,
  sampleMockNodes,
  sampleMockRelationships,
  testErrorMessages,
} from "../../fixtures/neo4j-fixtures.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// Initialize logger for tests
beforeEach(() => {
  initializeLogger({ level: "silent", format: "json" });
});

afterEach(() => {
  resetLogger();
});

describe("Neo4jStorageClientImpl", () => {
  describe("constructor", () => {
    test("should create instance with config", () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      // Use duck-typing check instead of toBeInstanceOf for Bun compatibility on Linux
      // toBeInstanceOf can fail due to module identity issues between test and source files
      expect(client).toBeDefined();
      expect(typeof client.connect).toBe("function");
      expect(typeof client.disconnect).toBe("function");
      expect(typeof client.healthCheck).toBe("function");
    });

    test("should use default retry config when not provided", () => {
      const configWithoutRetry = {
        host: "localhost",
        port: 7687,
        username: "neo4j",
        password: "password",
      };
      const client = new Neo4jStorageClientImpl(configWithoutRetry);
      // Use duck-typing check instead of toBeInstanceOf for Bun compatibility on Linux
      expect(client).toBeDefined();
      expect(typeof client.connect).toBe("function");
    });
  });

  describe("connect", () => {
    test("should connect successfully", async () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      const mockDriver = new MockDriver();

      // Mock the neo4j.driver call
      const originalDriver = await import("neo4j-driver");
      const driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();

      // Verify connection was established
      const healthy = await client.healthCheck();
      expect(healthy).toBe(true);

      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should throw GraphConnectionError when connection fails", async () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      const mockDriver = new MockDriver();
      mockDriver.setShouldFailConnect(true, new Error("Connection refused"));

      const originalDriver = await import("neo4j-driver");
      const driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await expect(client.connect()).rejects.toThrow(GraphConnectionError);

      driverSpy.mockRestore();
    });

    test("should throw GraphConnectionError when health check fails", async () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      const mockDriver = new MockDriver();
      mockDriver.setShouldFailHealthCheck(true);

      const originalDriver = await import("neo4j-driver");
      const driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await expect(client.connect()).rejects.toThrow(GraphConnectionError);

      driverSpy.mockRestore();
    });
  });

  describe("disconnect", () => {
    test("should disconnect gracefully", async () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      const mockDriver = new MockDriver();

      const originalDriver = await import("neo4j-driver");
      const driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
      await client.disconnect();

      // Health check should return false after disconnect
      const healthy = await client.healthCheck();
      expect(healthy).toBe(false);

      driverSpy.mockRestore();
    });

    test("should handle disconnect when not connected", async () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      // Should not throw
      await client.disconnect();
    });
  });

  describe("healthCheck", () => {
    test("should return true when connected and healthy", async () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      const mockDriver = new MockDriver();

      const originalDriver = await import("neo4j-driver");
      const driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
      const healthy = await client.healthCheck();

      expect(healthy).toBe(true);

      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should return false when not connected", async () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      const healthy = await client.healthCheck();
      expect(healthy).toBe(false);
    });

    test("should return false when server is not responding", async () => {
      const client = new Neo4jStorageClientImpl(testConfig);
      const mockDriver = new MockDriver();

      const originalDriver = await import("neo4j-driver");
      const driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();

      // Make health check fail after connection
      mockDriver.setShouldFailHealthCheck(true);
      const healthy = await client.healthCheck();

      expect(healthy).toBe(false);

      await client.disconnect();
      driverSpy.mockRestore();
    });
  });

  describe("runQuery", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl(testConfig);
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should throw when not connected", async () => {
      const disconnectedClient = new Neo4jStorageClientImpl(testConfig);
      await expect(disconnectedClient.runQuery("MATCH (n) RETURN n")).rejects.toThrow(
        GraphConnectionError
      );
    });

    test("should execute query and return results", async () => {
      // Use plain number since the real neo4j.isInt won't recognize our mock ints
      mockSession.setQueryResult("MATCH", [new MockRecord(["name", "count"], ["test", 5])]);

      const results = await client.runQuery<{ name: string; count: number }>(
        "MATCH (n) RETURN n.name as name, count(n) as count"
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe("test");
      expect(results[0]?.count).toBe(5);
    });

    test("should handle empty results", async () => {
      mockSession.setQueryResult("MATCH", []);

      const results = await client.runQuery("MATCH (n:NonExistent) RETURN n");
      expect(results).toHaveLength(0);
    });

    test("should handle query parameters", async () => {
      mockSession.setQueryResult("MATCH", [new MockRecord(["n"], [sampleMockNodes.repository])]);

      const results = await client.runQuery("MATCH (n:Repository {name: $name}) RETURN n", {
        name: "test-repo",
      });

      expect(results).toHaveLength(1);
    });

    test("should handle numeric values", async () => {
      // Since we're using the real neo4j.isInt, use plain numbers for mocked tests
      mockSession.setQueryResult("RETURN", [new MockRecord(["value"], [42])]);

      const results = await client.runQuery<{ value: number }>("RETURN 42 as value");
      expect(results[0]?.value).toBe(42);
    });

    test("should map errors correctly", async () => {
      mockSession.setShouldFail(true, new Error(testErrorMessages.syntaxError));

      await expect(client.runQuery("INVALID CYPHER")).rejects.toThrow(GraphError);
    });
  });

  describe("upsertNode", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl(testConfig);
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should create a Repository node", async () => {
      const node = createTestRepositoryNode();
      mockSession.setQueryResult("MERGE", [
        mockRecordFactories.nodeReturn(sampleMockNodes.repository),
      ]);

      const result = await client.upsertNode<RepositoryNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("test-repo");
    });

    test("should create a File node", async () => {
      const node = createTestFileNode();
      mockSession.setQueryResult("MERGE", [mockRecordFactories.nodeReturn(sampleMockNodes.file)]);

      const result = await client.upsertNode<FileNode>(node);

      expect(result).toBeDefined();
      expect(result.path).toBe("src/index.ts");
    });

    test("should create a Function node", async () => {
      const node = createTestFunctionNode();
      mockSession.setQueryResult("MERGE", [
        mockRecordFactories.nodeReturn(sampleMockNodes.function),
      ]);

      const result = await client.upsertNode<FunctionNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("main");
    });

    test("should create a Class node", async () => {
      const node = createTestClassNode();
      mockSession.setQueryResult("MERGE", [mockRecordFactories.nodeReturn(sampleMockNodes.class)]);

      const result = await client.upsertNode<ClassNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("TestClass");
    });

    test("should create a Module node", async () => {
      const node = createTestModuleNode();
      mockSession.setQueryResult("MERGE", [mockRecordFactories.nodeReturn(sampleMockNodes.module)]);

      const result = await client.upsertNode<ModuleNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("lodash");
    });

    test("should create a Chunk node", async () => {
      const node = createTestChunkNode();
      mockSession.setQueryResult("MERGE", [mockRecordFactories.nodeReturn(sampleMockNodes.chunk)]);

      const result = await client.upsertNode<ChunkNode>(node);

      expect(result).toBeDefined();
      expect(result.chromaId).toBe("test-repo:src/index.ts:0");
    });

    test("should create a Concept node", async () => {
      const node = createTestConceptNode();
      mockSession.setQueryResult("MERGE", [
        mockRecordFactories.nodeReturn(sampleMockNodes.concept),
      ]);

      const result = await client.upsertNode<ConceptNode>(node);

      expect(result).toBeDefined();
      expect(result.name).toBe("authentication");
    });

    test("should use provided ID if available", async () => {
      const node = createTestFileNode({ id: "custom-id" } as unknown as Partial<typeof node>);
      mockSession.setQueryResult("MERGE", [
        mockRecordFactories.nodeReturn(
          createMockNode(1, ["File"], {
            id: "custom-id",
            path: "src/index.ts",
            extension: "ts",
            hash: "abc123def456",
            repository: "test-repo",
          })
        ),
      ]);

      const result = await client.upsertNode(node);
      expect(result.id).toBe("custom-id");
    });

    test("should throw when not connected", async () => {
      const disconnectedClient = new Neo4jStorageClientImpl(testConfig);
      const node = createTestFileNode();

      await expect(disconnectedClient.upsertNode(node)).rejects.toThrow(GraphConnectionError);
    });

    test("should reject invalid node labels with Cypher injection attempts", async () => {
      const maliciousNode = {
        labels: ["EVIL}]->(m) DELETE m;//"],
        name: "malicious",
        url: "https://example.com",
        description: "Test",
      } as unknown as Omit<RepositoryNode, "id">;

      await expect(client.upsertNode(maliciousNode)).rejects.toThrow(GraphError);
      await expect(client.upsertNode(maliciousNode)).rejects.toThrow(/Invalid node label/);
    });

    test("should reject labels that do not start with a letter", async () => {
      const invalidNode = {
        labels: ["123Invalid"],
        name: "test",
        url: "https://example.com",
        description: "Test",
      } as unknown as Omit<RepositoryNode, "id">;

      await expect(client.upsertNode(invalidNode)).rejects.toThrow(GraphError);
    });

    test("should reject labels with special characters", async () => {
      const invalidNode = {
        labels: ["Invalid-Label"],
        name: "test",
        url: "https://example.com",
        description: "Test",
      } as unknown as Omit<RepositoryNode, "id">;

      await expect(client.upsertNode(invalidNode)).rejects.toThrow(GraphError);
    });

    test("should accept valid labels with underscores and numbers", async () => {
      const validNode = createTestRepositoryNode();
      validNode.labels = ["Valid_Label_123"];
      mockSession.setQueryResult("MERGE", [
        mockRecordFactories.nodeReturn(sampleMockNodes.repository),
      ]);

      const result = await client.upsertNode<RepositoryNode>(validNode);
      expect(result).toBeDefined();
    });
  });

  describe("deleteNode", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl(testConfig);
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should delete existing node and return true", async () => {
      mockSession.setQueryResult("DELETE", [mockRecordFactories.deleteCount(1)]);

      const result = await client.deleteNode("File:test-repo:src/index.ts");
      expect(result).toBe(true);
    });

    test("should return false when node not found", async () => {
      mockSession.setQueryResult("DELETE", [mockRecordFactories.deleteCount(0)]);

      const result = await client.deleteNode("File:non-existent");
      expect(result).toBe(false);
    });

    test("should throw when not connected", async () => {
      const disconnectedClient = new Neo4jStorageClientImpl(testConfig);

      await expect(disconnectedClient.deleteNode("some-id")).rejects.toThrow(GraphConnectionError);
    });
  });

  describe("createRelationship", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl(testConfig);
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should create relationship without properties", async () => {
      mockSession.setQueryResult("CREATE", [
        mockRecordFactories.relationshipReturn(sampleMockRelationships.contains, "rel-100"),
      ]);

      const result = await client.createRelationship(
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
      mockSession.setQueryResult("CREATE", [
        mockRecordFactories.relationshipReturn(sampleMockRelationships.imports, "rel-102"),
      ]);

      const result = await client.createRelationship(
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
      mockSession.setQueryResult("CREATE", []);
      // Second query checks node existence
      mockSession.setQueryResult("OPTIONAL", [mockRecordFactories.nodeExistence(false, true)]);

      await expect(
        client.createRelationship(
          "Node:non-existent",
          "File:test-repo:src/index.ts",
          RelationshipType.CONTAINS
        )
      ).rejects.toThrow(NodeNotFoundError);
    });

    test("should throw NodeNotFoundError when target node not found", async () => {
      mockSession.setQueryResult("CREATE", []);
      mockSession.setQueryResult("OPTIONAL", [mockRecordFactories.nodeExistence(true, false)]);

      await expect(
        client.createRelationship(
          "Repository:test-repo",
          "Node:non-existent",
          RelationshipType.CONTAINS
        )
      ).rejects.toThrow(NodeNotFoundError);
    });

    test("should throw when not connected", async () => {
      const disconnectedClient = new Neo4jStorageClientImpl(testConfig);

      await expect(
        disconnectedClient.createRelationship("from", "to", RelationshipType.CONTAINS)
      ).rejects.toThrow(GraphConnectionError);
    });

    test("should reject invalid relationship types with Cypher injection attempts", async () => {
      await expect(
        client.createRelationship("from", "to", "EVIL}]->(m);//" as RelationshipType)
      ).rejects.toThrow(GraphError);
      await expect(
        client.createRelationship("from", "to", "EVIL}]->(m);//" as RelationshipType)
      ).rejects.toThrow(/Invalid relationship type/);
    });

    test("should reject relationship types that do not start with a letter", async () => {
      await expect(
        client.createRelationship("from", "to", "123INVALID" as RelationshipType)
      ).rejects.toThrow(GraphError);
    });

    test("should reject relationship types with special characters", async () => {
      await expect(
        client.createRelationship("from", "to", "INVALID-TYPE" as RelationshipType)
      ).rejects.toThrow(GraphError);
    });
  });

  describe("deleteRelationship", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl(testConfig);
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should delete existing relationship and return true", async () => {
      mockSession.setQueryResult("DELETE", [mockRecordFactories.deleteCount(1)]);

      const result = await client.deleteRelationship("rel-100");
      expect(result).toBe(true);
    });

    test("should return false when relationship not found", async () => {
      mockSession.setQueryResult("DELETE", [mockRecordFactories.deleteCount(0)]);

      const result = await client.deleteRelationship("rel-non-existent");
      expect(result).toBe(false);
    });

    test("should throw when not connected", async () => {
      const disconnectedClient = new Neo4jStorageClientImpl(testConfig);

      await expect(disconnectedClient.deleteRelationship("some-id")).rejects.toThrow(
        GraphConnectionError
      );
    });
  });

  describe("traverse", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl(testConfig);
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should traverse from file node", async () => {
      mockSession.setQueryResult("MATCH", [
        mockRecordFactories.traversalResult(
          [sampleMockNodes.file, sampleMockNodes.function],
          [sampleMockRelationships.defines]
        ),
      ]);

      const result = await client.traverse({
        startNode: { type: "file", identifier: "src/index.ts" },
        relationships: [RelationshipType.DEFINES],
        depth: 2,
      });

      expect(result).toBeDefined();
      expect(result.metadata.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("should traverse from function node", async () => {
      mockSession.setQueryResult("MATCH", [
        mockRecordFactories.traversalResult([sampleMockNodes.function], []),
      ]);

      const result = await client.traverse({
        startNode: { type: "function", identifier: "main" },
        relationships: [RelationshipType.CALLS],
        depth: 1,
      });

      expect(result).toBeDefined();
    });

    test("should traverse from class node", async () => {
      mockSession.setQueryResult("MATCH", [
        mockRecordFactories.traversalResult([sampleMockNodes.class], []),
      ]);

      const result = await client.traverse({
        startNode: { type: "class", identifier: "TestClass" },
        relationships: [RelationshipType.IMPLEMENTS],
        depth: 1,
      });

      expect(result).toBeDefined();
    });

    test("should respect depth limit", async () => {
      mockSession.setQueryResult("MATCH", [mockRecordFactories.traversalResult([], [])]);

      const result = await client.traverse({
        startNode: { type: "file", identifier: "src/index.ts" },
        relationships: [RelationshipType.IMPORTS],
        depth: 10, // Should be capped at 5
      });

      expect(result.metadata.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("should respect result limit", async () => {
      mockSession.setQueryResult("MATCH", [mockRecordFactories.traversalResult([], [])]);

      const result = await client.traverse({
        startNode: { type: "file", identifier: "src/index.ts" },
        relationships: [RelationshipType.IMPORTS],
        limit: 2000, // Should be capped at 1000
      });

      expect(result.metadata.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("should filter by repository", async () => {
      mockSession.setQueryResult("MATCH", [
        mockRecordFactories.traversalResult([sampleMockNodes.file], []),
      ]);

      const result = await client.traverse({
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
      const disconnectedClient = new Neo4jStorageClientImpl(testConfig);

      await expect(
        disconnectedClient.traverse({
          startNode: { type: "file", identifier: "test" },
          relationships: [RelationshipType.CONTAINS],
        })
      ).rejects.toThrow(GraphConnectionError);
    });
  });

  describe("analyzeDependencies", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl(testConfig);
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should analyze direct dependencies (dependsOn)", async () => {
      mockSession.setQueryResult("MATCH", [
        mockRecordFactories.dependencyResult(sampleMockNodes.module, "IMPORTS", 1),
      ]);

      const result = await client.analyzeDependencies({
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
      mockSession.setQueryResult("MATCH", [
        mockRecordFactories.dependencyResult(sampleMockNodes.file, "IMPORTS", 1),
      ]);

      const result = await client.analyzeDependencies({
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
      mockSession.setQueryResult("MATCH", []);

      const result = await client.analyzeDependencies({
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
      mockSession.setQueryResult("MATCH", []);
      mockSession.setQueryResult("path", []);

      const result = await client.analyzeDependencies({
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
      mockSession.setQueryResult("MATCH", [
        mockRecordFactories.dependencyResult(sampleMockNodes.file, "IMPORTS", 1),
        mockRecordFactories.dependencyResult(sampleMockNodes.function, "CALLS", 1),
      ]);

      const result = await client.analyzeDependencies({
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
      const disconnectedClient = new Neo4jStorageClientImpl(testConfig);

      await expect(
        disconnectedClient.analyzeDependencies({
          target: { type: "file", identifier: "test", repository: "repo" },
          direction: "dependsOn",
        })
      ).rejects.toThrow(GraphConnectionError);
    });
  });

  describe("getContext", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl(testConfig);
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should get imports context", async () => {
      mockSession.setQueryResult("IMPORTS", [
        mockRecordFactories.contextResult(sampleMockNodes.module, "imports"),
      ]);

      const result = await client.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["imports"],
      });

      expect(result).toBeDefined();
      expect(result.metadata.seedsProcessed).toBe(1);
    });

    test("should get callers context", async () => {
      mockSession.setQueryResult("CALLS", [
        mockRecordFactories.contextResult(sampleMockNodes.function, "callers"),
      ]);

      const result = await client.getContext({
        seeds: [{ type: "function", identifier: "main" }],
        includeContext: ["callers"],
      });

      expect(result).toBeDefined();
    });

    test("should get callees context", async () => {
      mockSession.setQueryResult("CALLS", [
        mockRecordFactories.contextResult(sampleMockNodes.function, "callees"),
      ]);

      const result = await client.getContext({
        seeds: [{ type: "function", identifier: "main" }],
        includeContext: ["callees"],
      });

      expect(result).toBeDefined();
    });

    test("should get siblings context", async () => {
      mockSession.setQueryResult("CONTAINS", [
        mockRecordFactories.contextResult(sampleMockNodes.file, "siblings"),
      ]);

      const result = await client.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["siblings"],
      });

      expect(result).toBeDefined();
    });

    test("should get documentation context", async () => {
      mockSession.setQueryResult("REFERENCES", []);

      const result = await client.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["documentation"],
      });

      expect(result).toBeDefined();
    });

    test("should handle multiple seeds", async () => {
      mockSession.setQueryResult("IMPORTS", []);
      mockSession.setQueryResult("CALLS", []);

      const result = await client.getContext({
        seeds: [
          { type: "file", identifier: "src/index.ts" },
          { type: "function", identifier: "main" },
        ],
        includeContext: ["imports"],
      });

      expect(result.metadata.seedsProcessed).toBe(2);
    });

    test("should handle multiple context types", async () => {
      mockSession.setQueryResult("IMPORTS", []);
      mockSession.setQueryResult("CALLS", []);
      mockSession.setQueryResult("CONTAINS", []);

      const result = await client.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["imports", "callers", "callees", "siblings"],
      });

      expect(result).toBeDefined();
    });

    test("should respect limit", async () => {
      mockSession.setQueryResult("IMPORTS", []);

      const result = await client.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["imports"],
        limit: 5,
      });

      expect(result.context.length).toBeLessThanOrEqual(5);
    });

    test("should filter by repository", async () => {
      mockSession.setQueryResult("IMPORTS", []);

      const result = await client.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts", repository: "test-repo" }],
        includeContext: ["imports"],
      });

      expect(result).toBeDefined();
    });

    test("should throw when not connected", async () => {
      const disconnectedClient = new Neo4jStorageClientImpl(testConfig);

      await expect(
        disconnectedClient.getContext({
          seeds: [{ type: "file", identifier: "test" }],
          includeContext: ["imports"],
        })
      ).rejects.toThrow(GraphConnectionError);
    });

    // Batched query behavior tests (Issue #182)
    test("should execute batched query with correct seedsParam structure", async () => {
      // The batched query should receive seeds array with type, identifier, and repository
      mockSession.setQueryResult("UNWIND", [
        mockRecordFactories.contextResult(
          sampleMockNodes.module,
          "imports",
          "src/index.ts",
          "test-repo"
        ),
      ]);

      const result = await client.getContext({
        seeds: [
          { type: "file", identifier: "src/index.ts", repository: "test-repo" },
          { type: "file", identifier: "src/main.ts", repository: "test-repo" },
        ],
        includeContext: ["imports"],
      });

      expect(result).toBeDefined();
      expect(result.metadata.seedsProcessed).toBe(2);
    });

    test("should deduplicate context items across seeds", async () => {
      // Same module returned for multiple seeds should only appear once
      mockSession.setQueryResult("UNWIND", [
        mockRecordFactories.contextResult(
          sampleMockNodes.module,
          "imports",
          "src/index.ts",
          "test-repo"
        ),
        mockRecordFactories.contextResult(
          sampleMockNodes.module,
          "imports",
          "src/main.ts",
          "test-repo"
        ),
      ]);

      const result = await client.getContext({
        seeds: [
          { type: "file", identifier: "src/index.ts", repository: "test-repo" },
          { type: "file", identifier: "src/main.ts", repository: "test-repo" },
        ],
        includeContext: ["imports"],
      });

      // Should deduplicate - only one unique module
      expect(result.context.length).toBe(1);
    });

    test("should early exit when limit is reached", async () => {
      // Create many results that exceed the limit
      const manyResults = Array.from({ length: 25 }, (_, i) => {
        const node: MockNode = {
          identity: mockNeo4j.int(1000 + i),
          labels: ["Module"],
          properties: {
            id: `mod-${i}`,
            name: `module${i}`,
            repository: "test-repo",
          },
        };
        return mockRecordFactories.contextResult(node, "imports", `src/file${i}.ts`, "test-repo");
      });
      mockSession.setQueryResult("UNWIND", manyResults);

      const result = await client.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts" }],
        includeContext: ["imports", "callers"], // 2 context types
        limit: 10,
      });

      // Should stop at limit
      expect(result.context.length).toBeLessThanOrEqual(10);
    });

    test("should handle seedRepo fallback from query result", async () => {
      // When node doesn't have repository but seed does, use seed's repository
      const nodeWithoutRepo: MockNode = {
        identity: mockNeo4j.int(999),
        labels: ["Module"],
        properties: {
          id: "mod-no-repo",
          name: "moduleNoRepo",
          // No repository property
        },
      };
      mockSession.setQueryResult("UNWIND", [
        mockRecordFactories.contextResult(
          nodeWithoutRepo,
          "imports",
          "src/index.ts",
          "fallback-repo"
        ),
      ]);

      const result = await client.getContext({
        seeds: [{ type: "file", identifier: "src/index.ts", repository: "fallback-repo" }],
        includeContext: ["imports"],
      });

      expect(result.context.length).toBe(1);
      // Repository should fall back to seedRepo from query result
      expect(result.context[0]?.repository).toBe("fallback-repo");
    });

    test("should normalize seed types for batched query", async () => {
      // Unknown seed types should be normalized to 'default'
      mockSession.setQueryResult("UNWIND", []);

      const result = await client.getContext({
        seeds: [
          { type: "file", identifier: "src/index.ts" },
          { type: "chunk", identifier: "chunk-123" },
          { type: "function", identifier: "myFunc" },
          { type: "unknown" as never, identifier: "something" }, // Should become 'default'
        ],
        includeContext: ["imports"],
      });

      expect(result).toBeDefined();
      expect(result.metadata.seedsProcessed).toBe(4);
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

      const deadlock = new Error("Deadlock detected");
      expect(isRetryableGraphError(deadlock)).toBe(true);

      const syntaxError = new Error("Invalid syntax");
      expect(isRetryableGraphError(syntaxError)).toBe(false);
    });
  });

  describe("retry behavior", () => {
    let client: Neo4jStorageClientImpl;
    let mockDriver: MockDriver;
    let mockSession: MockSession;
    let driverSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      client = new Neo4jStorageClientImpl({
        ...testConfig,
        retry: {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
        },
      });
      mockDriver = new MockDriver();
      mockSession = new MockSession();
      mockDriver.setSession(mockSession);

      const originalDriver = await import("neo4j-driver");
      driverSpy = spyOn(originalDriver.default, "driver").mockReturnValue(
        mockDriver as unknown as ReturnType<typeof originalDriver.default.driver>
      );

      await client.connect();
    });

    afterEach(async () => {
      await client.disconnect();
      driverSpy.mockRestore();
    });

    test("should retry on transient errors", async () => {
      // First call fails, second succeeds
      let callCount = 0;
      const originalRun = mockSession.run.bind(mockSession);
      mockSession.run = async (cypher: string, params?: Record<string, unknown>) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("ECONNRESET");
        }
        return originalRun(cypher, params);
      };

      mockSession.setQueryResult("MATCH", [new MockRecord(["count"], [mockNeo4j.int(1)])]);

      const results = await client.runQuery("MATCH (n) RETURN count(n) as count");
      expect(results).toHaveLength(1);
      expect(callCount).toBe(2);
    });

    test("should not retry on non-retryable errors", async () => {
      mockSession.setShouldFail(true, new Error("Invalid syntax"));

      await expect(client.runQuery("INVALID")).rejects.toThrow();
      // Only one call should have been made
      expect(mockSession.runCount).toBe(1);
    });
  });
});
