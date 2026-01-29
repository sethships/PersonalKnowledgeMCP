/**
 * Integration tests for FalkorDBAdapter
 *
 * These tests require a running FalkorDB instance and should be run
 * against a test database. They are skipped if FalkorDB is not available.
 *
 * To run these tests:
 * 1. Start FalkorDB: docker compose --profile falkordb up -d
 * 2. Run: bun test tests/integration/graph/falkordb-integration.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { FalkorDBAdapter } from "../../../src/graph/adapters/FalkorDBAdapter.js";
import { RelationshipType } from "../../../src/graph/types.js";
import type {
  FileNode,
  FunctionNode,
  RepositoryNode,
  GraphStorageConfig,
} from "../../../src/graph/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

// Integration test configuration - uses environment variables or defaults
const integrationConfig: GraphStorageConfig = {
  host: process.env["FALKORDB_HOST"] ?? "localhost",
  port: parseInt(process.env["FALKORDB_PORT"] ?? "6380", 10),
  username: process.env["FALKORDB_USERNAME"] ?? "default",
  password: process.env["FALKORDB_PASSWORD"] ?? "testpassword",
  database: "knowledge_graph_test",
  maxConnectionPoolSize: 10,
  connectionAcquisitionTimeout: 10000,
};

// Test data prefix to avoid conflicts
const TEST_PREFIX = `test_${Date.now()}`;

// Helper to check if FalkorDB is available with a short timeout
async function isFalkorDBAvailable(): Promise<boolean> {
  // Use a promise race to timeout quickly if FalkorDB is not available
  // This prevents the beforeAll hook from timing out
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), 2000); // 2 second timeout
  });

  const connectionCheck = (async () => {
    const adapter = new FalkorDBAdapter(integrationConfig);
    try {
      await adapter.connect();
      const healthy = await adapter.healthCheck();
      await adapter.disconnect();
      return healthy;
    } catch {
      return false;
    }
  })();

  return Promise.race([connectionCheck, timeout]);
}

describe("FalkorDBAdapter Integration Tests", () => {
  let adapter: FalkorDBAdapter;
  let falkorDBAvailable: boolean;

  beforeAll(async () => {
    initializeLogger({ level: "silent", format: "json" });
    falkorDBAvailable = await isFalkorDBAvailable();

    if (!falkorDBAvailable) {
      console.log("FalkorDB is not available. Integration tests will be skipped.");
      return;
    }

    adapter = new FalkorDBAdapter(integrationConfig);
    await adapter.connect();
  });

  afterAll(async () => {
    if (falkorDBAvailable && adapter) {
      // Clean up test data
      try {
        await adapter.runQuery(`MATCH (n) WHERE n.id STARTS WITH '${TEST_PREFIX}' DETACH DELETE n`);
      } catch (error) {
        console.error("Failed to clean up test data:", error);
      }
      await adapter.disconnect();
    }
    resetLogger();
  });

  describe("connection management", () => {
    test("should connect and pass health check", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(true);
    });

    test("should handle multiple connections", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const adapter2 = new FalkorDBAdapter(integrationConfig);
      await adapter2.connect();

      const healthy1 = await adapter.healthCheck();
      const healthy2 = await adapter2.healthCheck();

      expect(healthy1).toBe(true);
      expect(healthy2).toBe(true);

      await adapter2.disconnect();
    });
  });

  describe("node operations", () => {
    test("should create and retrieve a File node", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
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

      const created = await adapter.upsertNode<FileNode>(fileNode);
      expect(created).toBeDefined();
      expect(created.path).toBe("src/test.ts");

      // Verify by query
      const results = await adapter.runQuery<{ n: Record<string, unknown> }>(
        `MATCH (n:File {id: '${fileNode.id}'}) RETURN n`
      );
      expect(results.length).toBe(1);
    });

    test("should update existing node on upsert", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
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
      await adapter.upsertNode<FileNode>(initial);

      // Update the node
      const updateData: Omit<FileNode, "id"> & { id: string } = {
        id: nodeId,
        labels: ["File"],
        path: "src/update-test.ts",
        extension: "ts",
        hash: "hash2", // Changed hash
        repository: `${TEST_PREFIX}_test-repo`,
      };
      const updated = await adapter.upsertNode<FileNode>(updateData);

      expect(updated.hash).toBe("hash2");
    });

    test("should delete a node", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
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
      await adapter.upsertNode<FileNode>(nodeData);

      // Delete node
      const deleted = await adapter.deleteNode(nodeId);
      expect(deleted).toBe(true);

      // Verify deletion
      const results = await adapter.runQuery(`MATCH (n {id: '${nodeId}'}) RETURN n`);
      expect(results.length).toBe(0);
    });
  });

  describe("relationship operations", () => {
    test("should create a relationship between nodes", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
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
      await adapter.upsertNode<FileNode>(fileData);

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
      await adapter.upsertNode<FunctionNode>(funcData);

      // Create relationship
      const rel = await adapter.createRelationship(fileId, funcId, RelationshipType.DEFINES, {
        startLine: 1,
        endLine: 10,
      });

      expect(rel).toBeDefined();
      expect(rel.type).toBe(RelationshipType.DEFINES);
      expect(rel.fromNodeId).toBe(fileId);
      expect(rel.toNodeId).toBe(funcId);
    });

    test("should delete a relationship", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
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
      await adapter.upsertNode<FileNode>(file1);

      const file2: Omit<FileNode, "id"> & { id: string } = {
        id: node2Id,
        labels: ["File"],
        path: "src/b.ts",
        extension: "ts",
        hash: "b-hash",
        repository: `${TEST_PREFIX}_del-rel`,
      };
      await adapter.upsertNode<FileNode>(file2);

      // Create and then delete relationship
      const rel = await adapter.createRelationship(node1Id, node2Id, RelationshipType.REFERENCES);

      const deleted = await adapter.deleteRelationship(rel.id);
      expect(deleted).toBe(true);
    });
  });

  describe("query operations", () => {
    test("should execute parameterized queries", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
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
      await adapter.upsertNode<FileNode>(fileData);

      const results = await adapter.runQuery<{ path: string }>(
        `MATCH (n:File {repository: $repo}) RETURN n.path as path`,
        { repo: `${TEST_PREFIX}_query-test` }
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.path).toBe("src/query.ts");
    });

    test("should handle empty result sets", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const results = await adapter.runQuery(`MATCH (n:NonExistentLabel) RETURN n`);

      expect(results).toHaveLength(0);
    });
  });

  describe("traversal operations", () => {
    test("should traverse graph relationships", async () => {
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
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
      await adapter.upsertNode<RepositoryNode>(repoData);

      const fileData: Omit<FileNode, "id"> & { id: string } = {
        id: fileId,
        labels: ["File"],
        path: "src/main.ts",
        extension: "ts",
        hash: "main-hash",
        repository: `${TEST_PREFIX}_traverse-test`,
      };
      await adapter.upsertNode<FileNode>(fileData);

      await adapter.createRelationship(repoId, fileId, RelationshipType.CONTAINS);

      const result = await adapter.traverse({
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
      if (!falkorDBAvailable) {
        console.log("Skipping: FalkorDB not available");
        return;
      }

      const startTime = Date.now();

      await adapter.runQuery("RETURN 1 as n");

      const duration = Date.now() - startTime;
      // Query should complete within 500ms (generous for CI)
      expect(duration).toBeLessThan(500);
    });
  });
});
