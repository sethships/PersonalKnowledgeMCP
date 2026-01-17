/**
 * Unit tests for get_architecture MCP tool handler
 *
 * Tests the MCP tool implementation for querying repository architecture.
 * Uses mock GraphService to isolate testing from actual Neo4j database.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getArchitectureToolDefinition,
  createGetArchitectureHandler,
} from "../../../../src/mcp/tools/get-architecture.js";
import { validateGetArchitectureArgs } from "../../../../src/mcp/validation.js";
import type {
  GraphService,
  DependencyResult,
  DependentResult,
  PathResult,
  ArchitectureResult,
  ArchitectureNode,
} from "../../../../src/services/graph-service-types.js";
import { RelationshipType } from "../../../../src/graph/types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";
import {
  GraphServiceValidationError,
  GraphServiceTimeoutError,
  GraphServiceOperationError,
} from "../../../../src/services/graph-service-errors.js";

/**
 * Create a sample ArchitectureNode for testing
 */
function createSampleArchitectureNode(): ArchitectureNode {
  return {
    name: "root",
    type: "package",
    path: "/",
    children: [
      {
        name: "src",
        type: "package",
        path: "src",
        children: [
          {
            name: "services",
            type: "module",
            path: "src/services",
            metrics: { file_count: 5, function_count: 20, class_count: 3 },
          },
          {
            name: "utils",
            type: "module",
            path: "src/utils",
            metrics: { file_count: 3, function_count: 15 },
          },
        ],
      },
    ],
  };
}

/**
 * Create a sample ArchitectureResult for testing
 */
function createSampleArchitectureResult(): ArchitectureResult {
  return {
    repository: "test-repo",
    scope: null,
    structure: createSampleArchitectureNode(),
    metrics: {
      total_files: 8,
      total_modules: 3,
      total_entities: 38,
    },
    inter_module_dependencies: [
      {
        from_module: "src/services",
        to_module: "src/utils",
        relationship_count: 5,
        relationship_types: [RelationshipType.IMPORTS],
      },
    ],
    metadata: {
      detail_level: "modules",
      query_time_ms: 25,
      from_cache: false,
    },
  };
}

// Mock GraphService for isolated testing
class MockGraphService implements GraphService {
  private architectureResult: ArchitectureResult = createSampleArchitectureResult();
  private error: Error | null = null;

  setArchitectureResult(result: ArchitectureResult): void {
    this.architectureResult = result;
  }

  setError(error: Error): void {
    this.error = error;
  }

  async getDependencies(): Promise<DependencyResult> {
    throw new Error("Not implemented in mock");
  }

  async getDependents(): Promise<DependentResult> {
    throw new Error("Not implemented in mock");
  }

  async getPath(): Promise<PathResult> {
    throw new Error("Not implemented in mock");
  }

  async getArchitecture(): Promise<ArchitectureResult> {
    if (this.error) {
      throw this.error;
    }
    return this.architectureResult;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  clearCache(): void {
    // Mock implementation - no-op
  }

  clearCacheForRepository(_repository: string): void {
    // Mock implementation - no-op
  }
}

describe("get_architecture MCP Tool", () => {
  let mockGraphService: MockGraphService;

  beforeEach(() => {
    // Initialize logger in silent mode for tests
    initializeLogger({ level: "silent", format: "json" });
    mockGraphService = new MockGraphService();
  });

  afterEach(() => {
    resetLogger();
  });

  describe("Tool Definition", () => {
    it("should have correct tool name", () => {
      expect(getArchitectureToolDefinition.name).toBe("get_architecture");
    });

    it("should have description mentioning architecture", () => {
      expect(getArchitectureToolDefinition.description).toContain("architectural structure");
    });

    it("should require repository and detail_level", () => {
      const schema = getArchitectureToolDefinition.inputSchema;
      expect(schema.required).toContain("repository");
      expect(schema.required).toContain("detail_level");
    });

    it("should define valid detail_level values", () => {
      const schema = getArchitectureToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const detailLevelProperty = properties["detail_level"] as { enum?: string[] };
      expect(detailLevelProperty).toBeDefined();
      expect(detailLevelProperty.enum).toEqual(["packages", "modules", "files", "entities"]);
    });

    it("should define scope as optional string", () => {
      const schema = getArchitectureToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const scopeProperty = properties["scope"] as { type?: string };
      expect(scopeProperty).toBeDefined();
      expect(scopeProperty.type).toBe("string");
      // scope should NOT be in required
      expect(schema.required).not.toContain("scope");
    });

    it("should define include_external as optional boolean", () => {
      const schema = getArchitectureToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const includeExternalProperty = properties["include_external"] as {
        type?: string;
        default?: boolean;
      };
      expect(includeExternalProperty).toBeDefined();
      expect(includeExternalProperty.type).toBe("boolean");
      expect(includeExternalProperty.default).toBe(false);
    });
  });

  describe("Argument Validation", () => {
    it("should validate valid arguments with all fields", () => {
      const args = {
        repository: "my-project",
        scope: "src/services",
        detail_level: "modules",
        include_external: true,
      };

      const validated = validateGetArchitectureArgs(args);

      expect(validated.repository).toBe("my-project");
      expect(validated.scope).toBe("src/services");
      expect(validated.detail_level).toBe("modules");
      expect(validated.include_external).toBe(true);
    });

    it("should apply default include_external of false", () => {
      const args = {
        repository: "test-repo",
        detail_level: "packages",
      };

      const validated = validateGetArchitectureArgs(args);

      expect(validated.include_external).toBe(false);
      expect(validated.scope).toBeUndefined();
    });

    it("should trim whitespace from string fields", () => {
      const args = {
        repository: "  my-repo  ",
        scope: "  src/utils  ",
        detail_level: "files",
      };

      const validated = validateGetArchitectureArgs(args);

      expect(validated.repository).toBe("my-repo");
      expect(validated.scope).toBe("src/utils");
    });

    it("should reject invalid detail_level", () => {
      const args = {
        repository: "test-repo",
        detail_level: "invalid",
      };

      expect(() => validateGetArchitectureArgs(args)).toThrow();
    });

    it("should reject empty repository", () => {
      const args = {
        repository: "",
        detail_level: "modules",
      };

      expect(() => validateGetArchitectureArgs(args)).toThrow(/Repository name cannot be empty/);
    });

    it("should reject whitespace-only repository", () => {
      const args = {
        repository: "   ",
        detail_level: "modules",
      };

      expect(() => validateGetArchitectureArgs(args)).toThrow(/Repository name cannot be empty/);
    });

    it("should reject empty scope when provided", () => {
      const args = {
        repository: "test-repo",
        scope: "",
        detail_level: "modules",
      };

      expect(() => validateGetArchitectureArgs(args)).toThrow(/Scope cannot be empty/);
    });

    it("should reject unknown properties (strict mode)", () => {
      const args = {
        repository: "test-repo",
        detail_level: "modules",
        unknownField: "value",
      };

      expect(() => validateGetArchitectureArgs(args)).toThrow();
    });

    it("should accept all valid detail_level values", () => {
      const detailLevels = ["packages", "modules", "files", "entities"] as const;

      for (const level of detailLevels) {
        const args = {
          repository: "test-repo",
          detail_level: level,
        };

        // Should not throw
        expect(() => validateGetArchitectureArgs(args)).not.toThrow();
      }
    });
  });

  describe("Handler Execution", () => {
    it("should return successful result with architecture", async () => {
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        detail_level: "modules",
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      expect(content0?.type).toBe("text");

      const textContent = content0 as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.repository).toBe("test-repo");
      expect(parsed.scope).toBeNull();
      expect(parsed.structure).toBeDefined();
      expect(parsed.structure.name).toBe("root");
      expect(parsed.metrics.total_files).toBe(8);
      expect(parsed.metrics.total_modules).toBe(3);
      expect(parsed.inter_module_dependencies).toHaveLength(1);
      expect(parsed.metadata.detail_level).toBe("modules");
    });

    it("should return architecture with scope filter", async () => {
      const scopedResult: ArchitectureResult = {
        repository: "test-repo",
        scope: "src/services",
        structure: {
          name: "services",
          type: "module",
          path: "src/services",
          children: [
            { name: "auth.ts", type: "file", path: "src/services/auth.ts" },
            { name: "user.ts", type: "file", path: "src/services/user.ts" },
          ],
        },
        metrics: { total_files: 2, total_modules: 1, total_entities: 10 },
        inter_module_dependencies: [],
        metadata: { detail_level: "files", query_time_ms: 15, from_cache: false },
      };

      mockGraphService.setArchitectureResult(scopedResult);
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        scope: "src/services",
        detail_level: "files",
      });

      expect(result.isError).toBe(false);

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.scope).toBe("src/services");
      expect(parsed.structure.name).toBe("services");
      expect(parsed.structure.children).toHaveLength(2);
    });

    it("should return empty structure when no files found", async () => {
      const emptyResult: ArchitectureResult = {
        repository: "empty-repo",
        scope: null,
        structure: { name: "root", type: "package", path: "/" },
        metrics: { total_files: 0, total_modules: 0, total_entities: 0 },
        inter_module_dependencies: [],
        metadata: { detail_level: "modules", query_time_ms: 5, from_cache: false },
      };

      mockGraphService.setArchitectureResult(emptyResult);
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "empty-repo",
        detail_level: "modules",
      });

      expect(result.isError).toBe(false);

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.structure.children).toBeUndefined();
      expect(parsed.metrics.total_files).toBe(0);
      expect(parsed.inter_module_dependencies).toEqual([]);
    });

    it("should handle validation errors gracefully", async () => {
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        detail_level: "invalid_level",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      expect(content0?.type).toBe("text");

      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("Error:");
    });

    it("should handle GraphServiceValidationError", async () => {
      mockGraphService.setError(new GraphServiceValidationError("Invalid repository name"));

      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        detail_level: "modules",
      });

      expect(result.isError).toBe(true);

      const textContent = result.content[0] as { type: "text"; text: string };
      expect(textContent.text).toContain("Invalid repository name");
    });

    it("should handle GraphServiceTimeoutError", async () => {
      mockGraphService.setError(new GraphServiceTimeoutError("Query timed out", 5000));

      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "large-repo",
        detail_level: "entities",
      });

      expect(result.isError).toBe(true);

      const textContent = result.content[0] as { type: "text"; text: string };
      expect(textContent.text).toContain("timed out");
    });

    it("should handle GraphServiceOperationError", async () => {
      mockGraphService.setError(new GraphServiceOperationError("Neo4j connection lost", true));

      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        detail_level: "modules",
      });

      expect(result.isError).toBe(true);

      const textContent = result.content[0] as { type: "text"; text: string };
      expect(textContent.text).toContain("Graph operation failed");
    });

    it("should include inter_module_dependencies in output", async () => {
      const resultWithDeps: ArchitectureResult = {
        repository: "test-repo",
        scope: null,
        structure: createSampleArchitectureNode(),
        metrics: { total_files: 8, total_modules: 3, total_entities: 38 },
        inter_module_dependencies: [
          {
            from_module: "src/services",
            to_module: "src/utils",
            relationship_count: 5,
            relationship_types: [RelationshipType.IMPORTS],
          },
          {
            from_module: "src/services",
            to_module: "src/config",
            relationship_count: 2,
            relationship_types: [RelationshipType.IMPORTS, RelationshipType.CALLS],
          },
        ],
        metadata: { detail_level: "modules", query_time_ms: 30, from_cache: false },
      };

      mockGraphService.setArchitectureResult(resultWithDeps);
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        detail_level: "modules",
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.inter_module_dependencies).toHaveLength(2);
      expect(parsed.inter_module_dependencies[0].from).toBe("src/services");
      expect(parsed.inter_module_dependencies[0].to).toBe("src/utils");
      expect(parsed.inter_module_dependencies[0].relationship_count).toBe(5);
      expect(parsed.inter_module_dependencies[0].relationship_types).toContain("imports");
    });
  });

  describe("Detail Level Behavior", () => {
    it("should return packages for packages detail level", async () => {
      const packagesResult: ArchitectureResult = {
        repository: "test-repo",
        scope: null,
        structure: {
          name: "root",
          type: "package",
          path: "/",
          children: [
            { name: "src", type: "package", path: "src", metrics: { file_count: 50 } },
            { name: "tests", type: "package", path: "tests", metrics: { file_count: 30 } },
          ],
        },
        metrics: { total_files: 80, total_modules: 2, total_entities: 0 },
        inter_module_dependencies: [],
        metadata: { detail_level: "packages", query_time_ms: 10, from_cache: false },
      };

      mockGraphService.setArchitectureResult(packagesResult);
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        detail_level: "packages",
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.metadata.detail_level).toBe("packages");
      expect(parsed.structure.children).toHaveLength(2);
      expect(parsed.structure.children[0].type).toBe("package");
    });

    it("should return entities for entities detail level", async () => {
      const entitiesResult: ArchitectureResult = {
        repository: "test-repo",
        scope: "src/services",
        structure: {
          name: "services",
          type: "module",
          path: "src/services",
          children: [
            {
              name: "auth.ts",
              type: "file",
              path: "src/services/auth.ts",
              children: [
                { name: "AuthService", type: "class", path: "src/services/auth.ts::AuthService" },
                {
                  name: "validateToken",
                  type: "function",
                  path: "src/services/auth.ts::validateToken",
                },
              ],
            },
          ],
        },
        metrics: { total_files: 1, total_modules: 1, total_entities: 2 },
        inter_module_dependencies: [],
        metadata: { detail_level: "entities", query_time_ms: 20, from_cache: false },
      };

      mockGraphService.setArchitectureResult(entitiesResult);
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        scope: "src/services",
        detail_level: "entities",
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.metadata.detail_level).toBe("entities");
      const fileNode = parsed.structure.children[0];
      expect(fileNode.children).toHaveLength(2);
      expect(fileNode.children[0].type).toBe("class");
      expect(fileNode.children[1].type).toBe("function");
    });
  });

  describe("Metrics Formatting", () => {
    it("should include all metrics fields in output", async () => {
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        detail_level: "modules",
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.metrics).toBeDefined();
      expect(typeof parsed.metrics.total_files).toBe("number");
      expect(typeof parsed.metrics.total_modules).toBe("number");
      expect(typeof parsed.metrics.total_entities).toBe("number");
    });

    it("should include node-level metrics when present", async () => {
      const handler = createGetArchitectureHandler(mockGraphService);

      const result = await handler({
        repository: "test-repo",
        detail_level: "modules",
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      // Check that child nodes with metrics have them formatted
      const srcNode = parsed.structure.children[0];
      const servicesNode = srcNode.children[0];
      expect(servicesNode.metrics).toBeDefined();
      expect(servicesNode.metrics.file_count).toBe(5);
      expect(servicesNode.metrics.function_count).toBe(20);
      expect(servicesNode.metrics.class_count).toBe(3);
    });
  });
});
