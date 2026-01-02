/**
 * Integration tests for Neo4jStorageClientImpl
 *
 * These tests require a running Neo4j instance and should be run
 * against a test database. They are skipped if Neo4j is not available.
 *
 * To run these tests:
 * 1. Start Neo4j: docker run -d --name neo4j-test -p 7687:7687 -e NEO4J_AUTH=neo4j/testpassword neo4j:5
 * 2. Run: bun test tests/integration/graph/neo4j-integration.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Neo4jStorageClientImpl } from "../../../src/graph/Neo4jClient.js";
import { RelationshipType } from "../../../src/graph/types.js";
import type {
  Neo4jConfig,
  FileNode,
  FunctionNode,
  RepositoryNode,
} from "../../../src/graph/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// Integration test configuration - uses environment variables or defaults
const integrationConfig: Neo4jConfig = {
  host: process.env["NEO4J_HOST"] ?? "localhost",
  port: parseInt(process.env["NEO4J_PORT"] ?? "7687", 10),
  username: process.env["NEO4J_USERNAME"] ?? "neo4j",
  password: process.env["NEO4J_PASSWORD"] ?? "testpassword",
  maxConnectionPoolSize: 10,
  connectionAcquisitionTimeout: 10000,
};

// Test data prefix to avoid conflicts
const TEST_PREFIX = `test_${Date.now()}`;

// Helper to check if Neo4j is available
async function isNeo4jAvailable(): Promise<boolean> {
  const client = new Neo4jStorageClientImpl(integrationConfig);
  try {
    await client.connect();
    const healthy = await client.healthCheck();
    await client.disconnect();
    return healthy;
  } catch {
    return false;
  }
}

describe("Neo4jStorageClientImpl Integration Tests", () => {
  let client: Neo4jStorageClientImpl;
  let neo4jAvailable: boolean;

  beforeAll(async () => {
    initializeLogger({ level: "silent", format: "json" });
    neo4jAvailable = await isNeo4jAvailable();

    if (!neo4jAvailable) {
      console.log("Neo4j is not available. Integration tests will be skipped.");
      return;
    }

    client = new Neo4jStorageClientImpl(integrationConfig);
    await client.connect();
  });

  afterAll(async () => {
    if (neo4jAvailable && client) {
      // Clean up test data
      try {
        await client.runQuery(`MATCH (n) WHERE n.id STARTS WITH $prefix DETACH DELETE n`, {
          prefix: TEST_PREFIX,
        });
      } catch (error) {
        console.error("Failed to clean up test data:", error);
      }
      await client.disconnect();
    }
    resetLogger();
  });

  describe("connection management", () => {
    test("should connect and pass health check", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const healthy = await client.healthCheck();
      expect(healthy).toBe(true);
    });

    test("should handle multiple connections", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const client2 = new Neo4jStorageClientImpl(integrationConfig);
      await client2.connect();

      const healthy1 = await client.healthCheck();
      const healthy2 = await client2.healthCheck();

      expect(healthy1).toBe(true);
      expect(healthy2).toBe(true);

      await client2.disconnect();
    });
  });

  describe("node operations", () => {
    test("should create and retrieve a File node", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const fileNode: Omit<FileNode, "id"> & { id: string } = {
        id: `${TEST_PREFIX}_File:test-repo:src/test.ts`,
        labels: ["File"],
        path: "src/test.ts",
        extension: "ts",
        hash: "abc123",
        repository: `${TEST_PREFIX}_test-repo`,
      };

      const created = await client.upsertNode<FileNode>(fileNode);
      expect(created).toBeDefined();
      expect(created.path).toBe("src/test.ts");

      // Verify by query
      const results = await client.runQuery<{ n: Record<string, unknown> }>(
        `MATCH (n:File {id: $id}) RETURN n`,
        { id: fileNode.id }
      );
      expect(results.length).toBe(1);
    });

    test("should update existing node on upsert", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const nodeId = `${TEST_PREFIX}_File:test-repo:src/update-test.ts`;

      // Create initial node
      const initial: Omit<FileNode, "id"> & { id: string } = {
        id: nodeId,
        labels: ["File"],
        path: "src/update-test.ts",
        extension: "ts",
        hash: "hash1",
        repository: `${TEST_PREFIX}_test-repo`,
      };
      await client.upsertNode<FileNode>(initial);

      // Update the node
      const updateData: Omit<FileNode, "id"> & { id: string } = {
        id: nodeId,
        labels: ["File"],
        path: "src/update-test.ts",
        extension: "ts",
        hash: "hash2", // Changed hash
        repository: `${TEST_PREFIX}_test-repo`,
      };
      const updated = await client.upsertNode<FileNode>(updateData);

      expect(updated.hash).toBe("hash2");
    });

    test("should delete a node", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const nodeId = `${TEST_PREFIX}_File:test-repo:src/to-delete.ts`;

      // Create node
      const nodeData: Omit<FileNode, "id"> & { id: string } = {
        id: nodeId,
        labels: ["File"],
        path: "src/to-delete.ts",
        extension: "ts",
        hash: "delete-me",
        repository: `${TEST_PREFIX}_test-repo`,
      };
      await client.upsertNode<FileNode>(nodeData);

      // Delete node
      const deleted = await client.deleteNode(nodeId);
      expect(deleted).toBe(true);

      // Verify deletion
      const results = await client.runQuery(`MATCH (n {id: $id}) RETURN n`, { id: nodeId });
      expect(results.length).toBe(0);
    });
  });

  describe("relationship operations", () => {
    test("should create a relationship between nodes", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Create two nodes
      const fileId = `${TEST_PREFIX}_File:rel-test:src/file.ts`;
      const funcId = `${TEST_PREFIX}_Function:rel-test:src/file.ts:myFunc`;

      const fileData: Omit<FileNode, "id"> & { id: string } = {
        id: fileId,
        labels: ["File"],
        path: "src/file.ts",
        extension: "ts",
        hash: "file-hash",
        repository: `${TEST_PREFIX}_rel-test`,
      };
      await client.upsertNode<FileNode>(fileData);

      const funcData: Omit<FunctionNode, "id"> & { id: string } = {
        id: funcId,
        labels: ["Function"],
        name: "myFunc",
        signature: "function myFunc(): void",
        startLine: 1,
        endLine: 10,
        filePath: "src/file.ts",
        repository: `${TEST_PREFIX}_rel-test`,
      };
      await client.upsertNode<FunctionNode>(funcData);

      // Create relationship
      const rel = await client.createRelationship(fileId, funcId, RelationshipType.DEFINES, {
        startLine: 1,
        endLine: 10,
      });

      expect(rel).toBeDefined();
      expect(rel.type).toBe(RelationshipType.DEFINES);
      expect(rel.fromNodeId).toBe(fileId);
      expect(rel.toNodeId).toBe(funcId);
    });

    test("should delete a relationship", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Create nodes
      const node1Id = `${TEST_PREFIX}_File:del-rel:src/a.ts`;
      const node2Id = `${TEST_PREFIX}_File:del-rel:src/b.ts`;

      const file1: Omit<FileNode, "id"> & { id: string } = {
        id: node1Id,
        labels: ["File"],
        path: "src/a.ts",
        extension: "ts",
        hash: "a-hash",
        repository: `${TEST_PREFIX}_del-rel`,
      };
      await client.upsertNode<FileNode>(file1);

      const file2: Omit<FileNode, "id"> & { id: string } = {
        id: node2Id,
        labels: ["File"],
        path: "src/b.ts",
        extension: "ts",
        hash: "b-hash",
        repository: `${TEST_PREFIX}_del-rel`,
      };
      await client.upsertNode<FileNode>(file2);

      // Create and then delete relationship
      const rel = await client.createRelationship(node1Id, node2Id, RelationshipType.REFERENCES);

      const deleted = await client.deleteRelationship(rel.id);
      expect(deleted).toBe(true);
    });
  });

  describe("query operations", () => {
    test("should execute parameterized queries", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Create test node
      const fileData: Omit<FileNode, "id"> & { id: string } = {
        id: `${TEST_PREFIX}_File:query-test:src/query.ts`,
        labels: ["File"],
        path: "src/query.ts",
        extension: "ts",
        hash: "query-hash",
        repository: `${TEST_PREFIX}_query-test`,
      };
      await client.upsertNode<FileNode>(fileData);

      const results = await client.runQuery<{ path: string }>(
        `MATCH (n:File {repository: $repo}) RETURN n.path as path`,
        { repo: `${TEST_PREFIX}_query-test` }
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.path).toBe("src/query.ts");
    });

    test("should handle empty result sets", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const results = await client.runQuery(`MATCH (n:NonExistentLabel) RETURN n`);

      expect(results).toHaveLength(0);
    });
  });

  describe("traversal operations", () => {
    test("should traverse graph relationships", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      // Create a small graph
      const repoId = `${TEST_PREFIX}_Repository:traverse-test`;
      const fileId = `${TEST_PREFIX}_File:traverse-test:src/main.ts`;

      const repoData: Omit<RepositoryNode, "id"> & { id: string } = {
        id: repoId,
        labels: ["Repository"],
        name: `${TEST_PREFIX}_traverse-test`,
        url: "https://example.com/repo",
        lastIndexed: new Date().toISOString(),
        status: "ready",
      };
      await client.upsertNode<RepositoryNode>(repoData);

      const fileData: Omit<FileNode, "id"> & { id: string } = {
        id: fileId,
        labels: ["File"],
        path: "src/main.ts",
        extension: "ts",
        hash: "main-hash",
        repository: `${TEST_PREFIX}_traverse-test`,
      };
      await client.upsertNode<FileNode>(fileData);

      await client.createRelationship(repoId, fileId, RelationshipType.CONTAINS);

      const result = await client.traverse({
        startNode: { type: "file", identifier: "src/main.ts" },
        relationships: [RelationshipType.CONTAINS],
        depth: 1,
      });

      expect(result).toBeDefined();
      expect(result.metadata.queryTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("performance", () => {
    test("should complete queries within acceptable time", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const startTime = Date.now();

      await client.runQuery("RETURN 1 as n");

      const duration = Date.now() - startTime;
      // Query should complete within 500ms (generous for CI)
      expect(duration).toBeLessThan(500);
    });
  });
});
