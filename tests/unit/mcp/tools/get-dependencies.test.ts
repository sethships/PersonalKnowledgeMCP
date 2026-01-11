/**
 * Unit tests for get_dependencies MCP tool handler
 *
 * Tests the MCP tool implementation for querying forward dependencies.
 * Uses mock GraphService to isolate testing from actual Neo4j database.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getDependenciesToolDefinition,
  createGetDependenciesHandler,
} from "../../../../src/mcp/tools/get-dependencies.js";
import { validateGetDependenciesArgs } from "../../../../src/mcp/validation.js";
import type {
  GraphService,
  DependencyResult,
  DependentResult,
  PathResult,
  ArchitectureResult,
} from "../../../../src/services/graph-service-types.js";
import { RelationshipType } from "../../../../src/graph/types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";
import {
  GraphServiceValidationError,
  EntityNotFoundError,
  GraphServiceTimeoutError,
  GraphServiceOperationError,
} from "../../../../src/services/graph-service-errors.js";

// Mock GraphService for isolated testing
class MockGraphService implements GraphService {
  private dependencyResult: DependencyResult = {
    entity: {
      type: "file",
      path: "src/test.ts",
      repository: "test-repo",
      display_name: "test.ts",
    },
    dependencies: [],
    metadata: {
      total_count: 0,
      query_time_ms: 10,
      from_cache: false,
      depth_searched: 1,
    },
  };

  private error: Error | null = null;

  setDependencyResult(result: DependencyResult): void {
    this.dependencyResult = result;
  }

  setError(error: Error): void {
    this.error = error;
  }

  async getDependencies(): Promise<DependencyResult> {
    if (this.error) {
      throw this.error;
    }
    return this.dependencyResult;
  }

  async getDependents(): Promise<DependentResult> {
    throw new Error("Not implemented in mock");
  }

  async getPath(): Promise<PathResult> {
    throw new Error("Not implemented in mock");
  }

  async getArchitecture(): Promise<ArchitectureResult> {
    throw new Error("Not implemented in mock");
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe("get_dependencies MCP Tool", () => {
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
      expect(getDependenciesToolDefinition.name).toBe("get_dependencies");
    });

    it("should have description mentioning dependencies", () => {
      expect(getDependenciesToolDefinition.description).toContain("dependencies");
    });

    it("should require entity_type, entity_path, and repository", () => {
      const schema = getDependenciesToolDefinition.inputSchema;
      expect(schema.required).toContain("entity_type");
      expect(schema.required).toContain("entity_path");
      expect(schema.required).toContain("repository");
    });

    it("should define valid entity_type values", () => {
      const schema = getDependenciesToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const entityTypeProperty = properties["entity_type"] as { enum?: string[] };
      expect(entityTypeProperty).toBeDefined();
      expect(entityTypeProperty.enum).toEqual(["file", "function", "class"]);
    });

    it("should define depth with correct range", () => {
      const schema = getDependenciesToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const depthProperty = properties["depth"] as {
        minimum?: number;
        maximum?: number;
        default?: number;
      };
      expect(depthProperty).toBeDefined();
      expect(depthProperty.minimum).toBe(1);
      expect(depthProperty.maximum).toBe(5);
      expect(depthProperty.default).toBe(1);
    });

    it("should define relationship_types array", () => {
      const schema = getDependenciesToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const relTypesProperty = properties["relationship_types"] as { type?: string };
      expect(relTypesProperty).toBeDefined();
      expect(relTypesProperty.type).toBe("array");
    });
  });

  describe("Argument Validation", () => {
    it("should validate valid arguments with all fields", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/services/auth.ts",
        repository: "my-project",
        depth: 2,
        relationship_types: ["imports", "calls"],
      };

      const validated = validateGetDependenciesArgs(args);

      expect(validated.entity_type).toBe("file");
      expect(validated.entity_path).toBe("src/services/auth.ts");
      expect(validated.repository).toBe("my-project");
      expect(validated.depth).toBe(2);
      expect(validated.relationship_types).toEqual(["imports", "calls"]);
    });

    it("should apply default depth of 1", () => {
      const args = {
        entity_type: "function",
        entity_path: "myFunction",
        repository: "test-repo",
      };

      const validated = validateGetDependenciesArgs(args);

      expect(validated.depth).toBe(1);
      expect(validated.relationship_types).toBeUndefined();
    });

    it("should trim whitespace from string fields", () => {
      const args = {
        entity_type: "file",
        entity_path: "  src/test.ts  ",
        repository: "  my-repo  ",
      };

      const validated = validateGetDependenciesArgs(args);

      expect(validated.entity_path).toBe("src/test.ts");
      expect(validated.repository).toBe("my-repo");
    });

    it("should reject invalid entity_type", () => {
      const args = {
        entity_type: "module", // Invalid
        entity_path: "src/test.ts",
        repository: "test-repo",
      };

      expect(() => validateGetDependenciesArgs(args)).toThrow();
    });

    it("should reject empty entity_path", () => {
      const args = {
        entity_type: "file",
        entity_path: "",
        repository: "test-repo",
      };

      expect(() => validateGetDependenciesArgs(args)).toThrow(/Entity path cannot be empty/);
    });

    it("should reject empty repository", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "   ", // Whitespace only
      };

      expect(() => validateGetDependenciesArgs(args)).toThrow(/Repository name cannot be empty/);
    });

    it("should reject depth below minimum", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
        depth: 0,
      };

      expect(() => validateGetDependenciesArgs(args)).toThrow(/Depth must be at least 1/);
    });

    it("should reject depth above maximum", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
        depth: 10,
      };

      expect(() => validateGetDependenciesArgs(args)).toThrow(/Depth cannot exceed 5/);
    });

    it("should reject invalid relationship_types", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
        relationship_types: ["imports", "invalidType"],
      };

      expect(() => validateGetDependenciesArgs(args)).toThrow();
    });

    it("should reject unknown properties (strict mode)", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
        unknownField: "value",
      };

      expect(() => validateGetDependenciesArgs(args)).toThrow();
    });
  });

  describe("Handler Execution", () => {
    it("should return successful result with dependencies", async () => {
      const mockResult: DependencyResult = {
        entity: {
          type: "file",
          path: "src/services/auth.ts",
          repository: "my-project",
          display_name: "auth.ts",
        },
        dependencies: [
          {
            type: "file",
            path: "src/utils/crypto.ts",
            relationship_type: RelationshipType.IMPORTS,
            depth: 1,
          },
          {
            type: "function",
            path: "validateToken",
            relationship_type: RelationshipType.CALLS,
            depth: 1,
          },
        ],
        metadata: {
          total_count: 2,
          query_time_ms: 15,
          from_cache: false,
          depth_searched: 1,
        },
      };

      mockGraphService.setDependencyResult(mockResult);
      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/services/auth.ts",
        repository: "my-project",
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      expect(content0?.type).toBe("text");

      const textContent = content0 as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.entity.type).toBe("file");
      expect(parsed.entity.path).toBe("src/services/auth.ts");
      expect(parsed.dependencies).toHaveLength(2);
      expect(parsed.dependencies[0].relationship).toBe("imports");
      expect(parsed.dependencies[1].relationship).toBe("calls");
      expect(parsed.metadata.total_count).toBe(2);
    });

    it("should return empty dependencies array when none found", async () => {
      mockGraphService.setDependencyResult({
        entity: {
          type: "file",
          path: "src/standalone.ts",
          repository: "test-repo",
          display_name: "standalone.ts",
        },
        dependencies: [],
        metadata: {
          total_count: 0,
          query_time_ms: 5,
          from_cache: false,
          depth_searched: 1,
        },
      });

      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/standalone.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(false);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.dependencies).toEqual([]);
      expect(parsed.metadata.total_count).toBe(0);
    });

    it("should handle validation errors gracefully", async () => {
      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "invalid",
        entity_path: "test.ts",
        repository: "test",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      expect(content0?.type).toBe("text");

      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("Error:");
    });

    it("should handle EntityNotFoundError", async () => {
      mockGraphService.setError(new EntityNotFoundError("file", "src/missing.ts", "test-repo"));

      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/missing.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("Entity not found");
    });

    it("should handle GraphServiceValidationError", async () => {
      mockGraphService.setError(new GraphServiceValidationError("Invalid query parameters"));

      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(true);

      const textContent = result.content[0] as { type: "text"; text: string };
      expect(textContent.text).toContain("Invalid query parameters");
    });

    it("should handle GraphServiceTimeoutError", async () => {
      mockGraphService.setError(new GraphServiceTimeoutError("Query timed out", 5000));

      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("timed out");
    });

    it("should handle GraphServiceOperationError", async () => {
      mockGraphService.setError(new GraphServiceOperationError("Neo4j connection lost", true));

      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("Graph operation failed");
    });

    it("should use depth_searched from response for max_depth_reached", async () => {
      // Set up mock with depth_searched=2, different from requested depth=5
      // This verifies we use the actual depth searched, not the requested depth
      mockGraphService.setDependencyResult({
        entity: {
          type: "file",
          path: "src/test.ts",
          repository: "test-repo",
          display_name: "test.ts",
        },
        dependencies: [],
        metadata: {
          total_count: 0,
          query_time_ms: 5,
          from_cache: false,
          depth_searched: 2, // Actual depth searched (e.g., no more nodes to traverse)
        },
      });

      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
        depth: 5, // Requested depth is 5, but only 2 was actually searched
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      // Should use response.metadata.depth_searched (2), not args.depth (5)
      expect(parsed.metadata.max_depth_reached).toBe(2);
    });
  });

  describe("Relationship Type Mapping", () => {
    it("should map imports to IMPORTS", async () => {
      const mockResult: DependencyResult = {
        entity: {
          type: "file",
          path: "src/test.ts",
          repository: "test-repo",
          display_name: "test.ts",
        },
        dependencies: [
          {
            type: "file",
            path: "src/utils.ts",
            relationship_type: RelationshipType.IMPORTS,
            depth: 1,
          },
        ],
        metadata: {
          total_count: 1,
          query_time_ms: 10,
          from_cache: false,
          depth_searched: 1,
        },
      };

      mockGraphService.setDependencyResult(mockResult);
      const handler = createGetDependenciesHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
        relationship_types: ["imports"],
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.dependencies[0].relationship).toBe("imports");
    });

    it("should handle all valid relationship types", async () => {
      const validTypes = ["imports", "calls", "extends", "implements", "references"];

      for (const relType of validTypes) {
        const args = {
          entity_type: "file" as const,
          entity_path: "src/test.ts",
          repository: "test-repo",
          relationship_types: [relType],
        };

        // Should not throw
        expect(() => validateGetDependenciesArgs(args)).not.toThrow();
      }
    });
  });
});
