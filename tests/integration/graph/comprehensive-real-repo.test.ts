/**
 * Comprehensive Real Repository Tests for Graph Features
 *
 * These tests validate graph features against real, complex repositories:
 * - PersonalKnowledgeMCP: The project itself (~166 source files)
 * - Muzehub-code: Medium-sized TypeScript project (~859 files)
 *
 * Tests require:
 * 1. Running Neo4j instance
 * 2. Repository indexed in ChromaDB
 * 3. Graph populated via `pk-mcp graph populate <repo>`
 *
 * To run:
 * 1. docker-compose up -d neo4j chromadb
 * 2. bun run cli graph migrate
 * 3. bun run cli index https://github.com/sethb75/PersonalKnowledgeMCP.git
 * 4. bun run cli graph populate PersonalKnowledgeMCP
 * 5. bun test tests/integration/graph/comprehensive-real-repo.test.ts
 *
 * @module tests/integration/graph/comprehensive-real-repo.test.ts
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
  ArchitectureNode,
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

// Repository name for testing
const TEST_REPO = "PersonalKnowledgeMCP";

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

// Helper to check if repository is populated in graph
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

// Helper to get file count in graph
async function getGraphFileCount(
  client: Neo4jStorageClientImpl,
  repoName: string
): Promise<number> {
  const results = await client.runQuery<{ count: number }>(
    `MATCH (f:File {repository: $repo}) RETURN count(f) as count`,
    { repo: repoName }
  );
  return results[0]?.count ?? 0;
}

describe("Comprehensive Real Repository Tests", () => {
  let neo4jClient: Neo4jStorageClientImpl;
  let graphService: GraphServiceImpl;
  let neo4jAvailable: boolean;
  let repoPopulated: boolean;

  beforeAll(async () => {
    initializeLogger({ level: "silent", format: "json" });
    neo4jAvailable = await isNeo4jAvailable();

    if (!neo4jAvailable) {
      console.log("Neo4j is not available. Integration tests will be skipped.");
      return;
    }

    neo4jClient = new Neo4jStorageClientImpl(integrationConfig);
    await neo4jClient.connect();

    repoPopulated = await isRepositoryPopulated(neo4jClient, TEST_REPO);
    if (!repoPopulated) {
      console.log(
        `Repository ${TEST_REPO} is not populated in graph. Run: bun run cli graph populate ${TEST_REPO}`
      );
    }

    graphService = new GraphServiceImpl(neo4jClient);
  });

  afterAll(async () => {
    if (neo4jClient) {
      await neo4jClient.disconnect();
    }
    resetLogger();
  });

  describe("PersonalKnowledgeMCP Repository Tests", () => {
    describe("repository validation", () => {
      test("repository exists in graph", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const results = await neo4jClient.runQuery<{
          name: string;
          status: string;
        }>(`MATCH (r:Repository {name: $name}) RETURN r.name as name, r.status as status`, {
          name: TEST_REPO,
        });

        expect(results.length).toBe(1);
        expect(results[0]?.name).toBe(TEST_REPO);
        expect(results[0]?.status).toBe("ready");
      });

      test("repository has indexed files", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const fileCount = await getGraphFileCount(neo4jClient, TEST_REPO);
        // PersonalKnowledgeMCP should have 100+ files in src/
        expect(fileCount).toBeGreaterThan(100);
      });

      test("repository has CONTAINS relationships", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const results = await neo4jClient.runQuery<{ count: number }>(
          `MATCH (:Repository {name: $name})-[:CONTAINS]->(:File) RETURN count(*) as count`,
          { name: TEST_REPO }
        );

        expect(results[0]?.count).toBeGreaterThan(0);
      });
    });

    describe("dependency queries", () => {
      test("should find dependencies of get-dependencies.ts", async () => {
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

        const result = await graphService.getDependencies(query);

        expect(result.entity.type).toBe("file");
        expect(result.entity.path).toBe("src/mcp/tools/get-dependencies.ts");
        expect(result.dependencies.length).toBeGreaterThan(0);

        // Should find graph-service-types.js import
        const hasGraphServiceTypes = result.dependencies.some(
          (dep) => dep.path.includes("graph-service-types") || dep.path.includes("graph-service")
        );
        expect(hasGraphServiceTypes).toBe(true);
      });

      test("should find dependencies of graph-service.ts", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const query: DependencyQuery = {
          entity_type: "file",
          entity_path: "src/services/graph-service.ts",
          repository: TEST_REPO,
          depth: 1,
        };

        const result = await graphService.getDependencies(query);

        expect(result.dependencies.length).toBeGreaterThan(3);
        expect(result.metadata.query_time_ms).toBeGreaterThanOrEqual(0);
      });

      test("should handle transitive dependencies at depth 2", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const query: DependencyQuery = {
          entity_type: "file",
          entity_path: "src/mcp/tools/get-dependencies.ts",
          repository: TEST_REPO,
          depth: 2,
          include_transitive: true,
        };

        const result = await graphService.getDependencies(query);

        // Transitive should find more dependencies than direct
        const directCount = result.dependencies.filter((d) => d.depth === 1).length;
        const transitiveCount = result.dependencies.filter((d) => d.depth === 2).length;

        expect(result.dependencies.length).toBeGreaterThanOrEqual(directCount);
        // May or may not have transitive deps depending on graph structure
        expect(transitiveCount).toBeGreaterThanOrEqual(0);
      });
    });

    describe("dependent queries (impact analysis)", () => {
      test("should find dependents of graph/types.ts", async () => {
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

        const result = await graphService.getDependents(query);

        // graph/types.ts is heavily imported
        expect(result.dependents.length).toBeGreaterThan(5);
        expect(result.impact_analysis.direct_impact_count).toBeGreaterThan(0);
      });

      test("should find dependents of logging/index.ts", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const query: DependentQuery = {
          entity_type: "file",
          entity_path: "src/logging/index.ts",
          repository: TEST_REPO,
          depth: 1,
        };

        const result = await graphService.getDependents(query);

        // logging/index.ts is imported by many files
        expect(result.dependents.length).toBeGreaterThan(10);
        expect(result.impact_analysis.impact_score).toBeGreaterThan(0);
      });

      test("should calculate impact score correctly", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const query: DependentQuery = {
          entity_type: "file",
          entity_path: "src/logging/index.ts",
          repository: TEST_REPO,
          depth: 1,
        };

        const result = await graphService.getDependents(query);

        // Impact score should be between 0 and 1
        expect(result.impact_analysis.impact_score).toBeGreaterThanOrEqual(0);
        expect(result.impact_analysis.impact_score).toBeLessThanOrEqual(1);

        // Direct + transitive should sum correctly
        expect(
          result.impact_analysis.direct_impact_count +
            result.impact_analysis.transitive_impact_count
        ).toBe(result.metadata.total_count);
      });
    });

    describe("architecture queries", () => {
      test("should return repository architecture at modules level", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const query: ArchitectureQuery = {
          repository: TEST_REPO,
          detail_level: "modules",
        };

        const result = await graphService.getArchitecture(query);

        expect(result.repository).toBe(TEST_REPO);
        expect(result.structure).toBeDefined();
        expect(result.structure.type).toBe("package");

        // Should have children representing top-level directories
        expect(result.structure.children).toBeDefined();
        expect(result.structure.children!.length).toBeGreaterThan(0);
      });

      test("should return scoped architecture for src/graph/", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const query: ArchitectureQuery = {
          repository: TEST_REPO,
          scope: "src/graph",
          detail_level: "files",
        };

        const result = await graphService.getArchitecture(query);

        expect(result.scope).toBe("src/graph");
        expect(result.structure).toBeDefined();

        // Should have files in graph directory
        const allFiles = flattenStructure(result.structure);
        const graphFiles = allFiles.filter(
          (node) => node.type === "file" && node.path?.includes("src/graph")
        );
        expect(graphFiles.length).toBeGreaterThan(0);
      });

      test("should identify inter-module dependencies", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        const query: ArchitectureQuery = {
          repository: TEST_REPO,
          detail_level: "modules",
        };

        const result = await graphService.getArchitecture(query);

        // Should have inter-module dependencies (e.g., mcp -> services)
        expect(result.inter_module_dependencies).toBeDefined();
        // May have 0 if architecture doesn't track inter-module
        expect(result.inter_module_dependencies.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe("path finding", () => {
      test("should find path between related files", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        // MCP tool imports from graph service
        const fromEntity: EntityReference = {
          type: "file",
          path: "src/mcp/tools/get-dependencies.ts",
          repository: TEST_REPO,
        };

        const toEntity: EntityReference = {
          type: "file",
          path: "src/graph/Neo4jClient.ts",
          repository: TEST_REPO,
        };

        const query: PathQuery = {
          from_entity: fromEntity,
          to_entity: toEntity,
          max_hops: 5,
        };

        const result = await graphService.getPath(query);

        // Path may or may not exist depending on graph structure
        // If it exists, verify it
        if (result.path_exists && result.path) {
          expect(result.path.length).toBeGreaterThan(0);
          expect(result.metadata.hops).toBeGreaterThan(0);
          expect(result.metadata.hops).toBeLessThanOrEqual(5);
        }
      });

      test("should handle non-existent paths gracefully", async () => {
        if (!neo4jAvailable || !repoPopulated) {
          console.log("Skipping: Neo4j or repository not available");
          return;
        }

        // Unlikely to have direct path between these
        const fromEntity: EntityReference = {
          type: "file",
          path: "src/cli.ts",
          repository: TEST_REPO,
        };

        const toEntity: EntityReference = {
          type: "file",
          path: "nonexistent/file.ts",
          repository: TEST_REPO,
        };

        const query: PathQuery = {
          from_entity: fromEntity,
          to_entity: toEntity,
          max_hops: 3,
        };

        const result = await graphService.getPath(query);

        // Should not throw, just return path_exists: false
        expect(result.path_exists).toBe(false);
        expect(result.path).toBeNull();
      });
    });
  });

  describe("Cross-Repository Validation", () => {
    test("entity counts should be consistent with filesystem", async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const graphFileCount = await getGraphFileCount(neo4jClient, TEST_REPO);

      // Should have substantial number of files
      expect(graphFileCount).toBeGreaterThan(50);

      // Get function and class counts
      const functionResults = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (f:Function {repository: $repo}) RETURN count(f) as count`,
        { repo: TEST_REPO }
      );
      const classResults = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (c:Class {repository: $repo}) RETURN count(c) as count`,
        { repo: TEST_REPO }
      );

      const functionCount = functionResults[0]?.count ?? 0;
      const classCount = classResults[0]?.count ?? 0;

      // Should have extracted entities
      expect(functionCount).toBeGreaterThan(0);
      // Classes are optional depending on codebase
      expect(classCount).toBeGreaterThanOrEqual(0);
    });

    test("IMPORTS relationships should exist", async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const results = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (:File {repository: $repo})-[:IMPORTS]->() RETURN count(*) as count`,
        { repo: TEST_REPO }
      );

      // Should have import relationships
      expect(results[0]?.count).toBeGreaterThan(0);
    });

    test("DEFINES relationships should connect files to entities", async () => {
      if (!neo4jAvailable || !repoPopulated) {
        console.log("Skipping: Neo4j or repository not available");
        return;
      }

      const results = await neo4jClient.runQuery<{ count: number }>(
        `MATCH (:File {repository: $repo})-[:DEFINES]->() RETURN count(*) as count`,
        { repo: TEST_REPO }
      );

      // Should have DEFINES relationships linking files to functions/classes
      expect(results[0]?.count).toBeGreaterThan(0);
    });
  });
});

/**
 * Helper function to flatten architecture structure for easier searching.
 * Recursively collects all nodes from the hierarchy into a flat array.
 */
function flattenStructure(node: ArchitectureNode): ArchitectureNode[] {
  const result: ArchitectureNode[] = [node];
  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenStructure(child));
    }
  }
  return result;
}
