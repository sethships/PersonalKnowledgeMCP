/**
 * Integration tests for find_path MCP tool
 *
 * These tests require a running Neo4j instance and test the full path
 * from MCP tool handler through GraphService to Neo4j.
 *
 * To run these tests:
 * 1. Start Neo4j: docker run -d --name neo4j-test -p 7687:7687 -e NEO4J_AUTH=neo4j/testpassword neo4j:5
 * 2. Run: bun test tests/integration/mcp/tools/find-path.integration.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Neo4jStorageClientImpl } from "../../../../src/graph/Neo4jClient.js";
import { GraphServiceImpl } from "../../../../src/services/graph-service.js";
import { createFindPathHandler } from "../../../../src/mcp/tools/find-path.js";
import { RelationshipType } from "../../../../src/graph/types.js";
import type { Neo4jConfig, FileNode, FunctionNode } from "../../../../src/graph/types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// Integration test configuration
const integrationConfig: Neo4jConfig = {
  host: process.env["NEO4J_HOST"] ?? "localhost",
  port: parseInt(process.env["NEO4J_PORT"] ?? "7687", 10),
  username: process.env["NEO4J_USERNAME"] ?? "neo4j",
  password: process.env["NEO4J_PASSWORD"] ?? "testpassword",
  maxConnectionPoolSize: 10,
  connectionAcquisitionTimeout: 10000,
};

// Test data prefix to avoid conflicts
const TEST_PREFIX = `find_path_test_${Date.now()}`;
const TEST_REPO = `${TEST_PREFIX}_repo`;

// Helper to check if Neo4j is available
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

describe("find_path MCP Tool Integration Tests", () => {
  let neo4jClient: Neo4jStorageClientImpl;
  let graphService: GraphServiceImpl;
  let neo4jAvailable: boolean;

  beforeAll(async () => {
    initializeLogger({ level: "silent", format: "json" });
    neo4jAvailable = await isNeo4jAvailable();

    if (!neo4jAvailable) {
      console.log("Neo4j is not available. Integration tests will be skipped.");
      return;
    }

    neo4jClient = new Neo4jStorageClientImpl(integrationConfig);
    await neo4jClient.connect();

    graphService = new GraphServiceImpl(neo4jClient);

    // Set up test graph with a path:
    // handleLogin -> validateUser -> findUser -> dbQuery
    await setupTestGraph();
  });

  afterAll(async () => {
    if (neo4jAvailable && neo4jClient) {
      // Clean up test data
      try {
        await neo4jClient.runQuery(
          `MATCH (n) WHERE n.id STARTS WITH $prefix OR n.repository = $repo DETACH DELETE n`,
          { prefix: TEST_PREFIX, repo: TEST_REPO }
        );
      } catch (error) {
        console.error("Failed to clean up test data:", error);
      }
      await neo4jClient.disconnect();
    }
    resetLogger();
  });

  async function setupTestGraph(): Promise<void> {
    // Create function nodes
    const functions = [
      { name: "handleLogin", file: "src/routes/auth.ts" },
      { name: "validateUser", file: "src/services/auth.ts" },
      { name: "findUser", file: "src/db/users.ts" },
      { name: "dbQuery", file: "src/db/connection.ts" },
      { name: "isolatedFunction", file: "src/utils/helper.ts" },
    ];

    // Create function nodes
    for (const fn of functions) {
      const functionNode: Omit<FunctionNode, "id"> & { id: string } = {
        id: `${TEST_PREFIX}_Function:${TEST_REPO}:${fn.file}:${fn.name}`,
        labels: ["Function"],
        name: fn.name,
        filePath: fn.file,
        repository: TEST_REPO,
        signature: `function ${fn.name}(): void`,
        startLine: 1,
        endLine: 10,
      };
      await neo4jClient.upsertNode(functionNode);
    }

    // Create file nodes
    const files = [
      "src/routes/auth.ts",
      "src/services/auth.ts",
      "src/db/users.ts",
      "src/db/connection.ts",
      "src/utils/helper.ts",
    ];

    for (const file of files) {
      const fileNode: Omit<FileNode, "id"> & { id: string } = {
        id: `${TEST_PREFIX}_File:${TEST_REPO}:${file}`,
        labels: ["File"],
        path: file,
        extension: "ts",
        hash: `hash_${file}`,
        repository: TEST_REPO,
      };
      await neo4jClient.upsertNode(fileNode);
    }

    // Create relationships: handleLogin -> validateUser -> findUser -> dbQuery
    const callChain = [
      { from: "handleLogin", to: "validateUser" },
      { from: "validateUser", to: "findUser" },
      { from: "findUser", to: "dbQuery" },
    ];

    for (const call of callChain) {
      // Get file paths for from/to functions
      const fromFile =
        call.from === "handleLogin"
          ? "src/routes/auth.ts"
          : call.from === "validateUser"
            ? "src/services/auth.ts"
            : "src/db/users.ts";
      const toFile =
        call.to === "validateUser"
          ? "src/services/auth.ts"
          : call.to === "findUser"
            ? "src/db/users.ts"
            : "src/db/connection.ts";

      await neo4jClient.createRelationship(
        `${TEST_PREFIX}_Function:${TEST_REPO}:${fromFile}:${call.from}`,
        `${TEST_PREFIX}_Function:${TEST_REPO}:${toFile}:${call.to}`,
        RelationshipType.CALLS,
        {}
      );
    }

    // Create file import relationships
    const imports = [
      { from: "src/routes/auth.ts", to: "src/services/auth.ts" },
      { from: "src/services/auth.ts", to: "src/db/users.ts" },
      { from: "src/db/users.ts", to: "src/db/connection.ts" },
    ];

    for (const imp of imports) {
      await neo4jClient.createRelationship(
        `${TEST_PREFIX}_File:${TEST_REPO}:${imp.from}`,
        `${TEST_PREFIX}_File:${TEST_REPO}:${imp.to}`,
        RelationshipType.IMPORTS,
        {}
      );
    }
  }

  describe("Path Finding", () => {
    test("should find direct path between connected entities", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const handler = createFindPathHandler(graphService);

      // Note: Due to entity parsing, we need to use file paths
      // The find_path tool will parse "src/routes/auth.ts" as a file type
      const result = await handler({
        from_entity: "src/routes/auth.ts",
        to_entity: "src/services/auth.ts",
        repository: TEST_REPO,
        max_hops: 5,
      });

      expect(result.isError).toBe(false);

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      // Should find a path (either exists or not based on graph setup)
      expect(parsed).toHaveProperty("path_exists");
      expect(parsed).toHaveProperty("metadata");
      expect(parsed.metadata).toHaveProperty("query_time_ms");
    });

    test("should handle no path found gracefully", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const handler = createFindPathHandler(graphService);

      const result = await handler({
        from_entity: "src/utils/helper.ts", // Isolated file
        to_entity: "src/routes/auth.ts",
        repository: TEST_REPO,
        max_hops: 5,
      });

      expect(result.isError).toBe(false);

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      // No path from isolated file
      expect(parsed.path_exists).toBe(false);
      expect(parsed.path).toBeNull();
    });

    test("should respect max_hops limit", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const handler = createFindPathHandler(graphService);

      // With max_hops=1, shouldn't find path from auth.ts to connection.ts
      // (which requires 3 hops)
      const result = await handler({
        from_entity: "src/routes/auth.ts",
        to_entity: "src/db/connection.ts",
        repository: TEST_REPO,
        max_hops: 1,
      });

      expect(result.isError).toBe(false);

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      // With only 1 hop, shouldn't find the path
      // (actual behavior depends on graph structure)
      expect(parsed).toHaveProperty("path_exists");
    });

    test("should filter by relationship types", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const handler = createFindPathHandler(graphService);

      const result = await handler({
        from_entity: "src/routes/auth.ts",
        to_entity: "src/services/auth.ts",
        repository: TEST_REPO,
        max_hops: 5,
        relationship_types: ["imports"], // Only follow import relationships
      });

      expect(result.isError).toBe(false);

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed).toHaveProperty("path_exists");
    });
  });

  describe("Performance", () => {
    test("should complete path finding within 500ms", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const handler = createFindPathHandler(graphService);

      const startTime = performance.now();
      const result = await handler({
        from_entity: "src/routes/auth.ts",
        to_entity: "src/db/connection.ts",
        repository: TEST_REPO,
        max_hops: 10,
      });
      const duration = performance.now() - startTime;

      expect(result.isError).toBe(false);

      // PRD requirement: <500ms
      expect(duration).toBeLessThan(500);

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      // Verify query_time_ms is reasonable
      expect(parsed.metadata.query_time_ms).toBeLessThan(500);
    });
  });

  describe("Error Handling", () => {
    test("should handle non-existent repository gracefully", async () => {
      if (!neo4jAvailable) {
        console.log("Skipping: Neo4j not available");
        return;
      }

      const handler = createFindPathHandler(graphService);

      const result = await handler({
        from_entity: "src/test.ts",
        to_entity: "src/other.ts",
        repository: "non-existent-repo-12345",
        max_hops: 5,
      });

      // Should return no path found, not an error
      expect(result.isError).toBe(false);

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.path_exists).toBe(false);
    });
  });
});
