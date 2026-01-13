/**
 * Unit tests for find_path MCP tool handler
 *
 * Tests the MCP tool implementation for finding paths between code entities.
 * Uses mock GraphService to isolate testing from actual Neo4j database.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  findPathToolDefinition,
  createFindPathHandler,
} from "../../../../src/mcp/tools/find-path.js";
import { validateFindPathArgs } from "../../../../src/mcp/validation.js";
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
  private pathResult: PathResult = {
    path_exists: false,
    path: null,
    metadata: {
      hops: 0,
      query_time_ms: 10,
      from_cache: false,
    },
  };

  private error: Error | null = null;

  setPathResult(result: PathResult): void {
    this.pathResult = result;
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
    if (this.error) {
      throw this.error;
    }
    return this.pathResult;
  }

  async getArchitecture(): Promise<ArchitectureResult> {
    throw new Error("Not implemented in mock");
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe("find_path MCP Tool", () => {
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
      expect(findPathToolDefinition.name).toBe("find_path");
    });

    it("should have description mentioning path and connection", () => {
      expect(findPathToolDefinition.description).toContain("path");
      expect(findPathToolDefinition.description).toContain("connection");
    });

    it("should require from_entity, to_entity, and repository", () => {
      const schema = findPathToolDefinition.inputSchema;
      expect(schema.required).toContain("from_entity");
      expect(schema.required).toContain("to_entity");
      expect(schema.required).toContain("repository");
    });

    it("should define max_hops with correct range", () => {
      const schema = findPathToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const maxHopsProperty = properties["max_hops"] as {
        minimum?: number;
        maximum?: number;
        default?: number;
      };
      expect(maxHopsProperty).toBeDefined();
      expect(maxHopsProperty.minimum).toBe(1);
      expect(maxHopsProperty.maximum).toBe(20);
      expect(maxHopsProperty.default).toBe(10);
    });

    it("should define relationship_types array", () => {
      const schema = findPathToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const relTypesProperty = properties["relationship_types"] as { type?: string };
      expect(relTypesProperty).toBeDefined();
      expect(relTypesProperty.type).toBe("array");
    });
  });

  describe("Argument Validation", () => {
    it("should validate valid arguments with all fields", () => {
      const args = {
        from_entity: "src/routes/api.ts::handleLogin",
        to_entity: "src/db/users.ts::findUser",
        repository: "my-api",
        max_hops: 5,
        relationship_types: ["imports", "calls"],
      };

      const validated = validateFindPathArgs(args);

      expect(validated.from_entity).toBe("src/routes/api.ts::handleLogin");
      expect(validated.to_entity).toBe("src/db/users.ts::findUser");
      expect(validated.repository).toBe("my-api");
      expect(validated.max_hops).toBe(5);
      expect(validated.relationship_types).toEqual(["imports", "calls"]);
    });

    it("should apply default max_hops of 10", () => {
      const args = {
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "test-repo",
      };

      const validated = validateFindPathArgs(args);

      expect(validated.max_hops).toBe(10);
      expect(validated.relationship_types).toBeUndefined();
    });

    it("should trim whitespace from string fields", () => {
      const args = {
        from_entity: "  src/test.ts  ",
        to_entity: "  src/other.ts  ",
        repository: "  my-repo  ",
      };

      const validated = validateFindPathArgs(args);

      expect(validated.from_entity).toBe("src/test.ts");
      expect(validated.to_entity).toBe("src/other.ts");
      expect(validated.repository).toBe("my-repo");
    });

    it("should reject empty from_entity", () => {
      const args = {
        from_entity: "",
        to_entity: "src/test.ts",
        repository: "test-repo",
      };

      expect(() => validateFindPathArgs(args)).toThrow(/from_entity cannot be empty/);
    });

    it("should reject empty to_entity", () => {
      const args = {
        from_entity: "src/test.ts",
        to_entity: "",
        repository: "test-repo",
      };

      expect(() => validateFindPathArgs(args)).toThrow(/to_entity cannot be empty/);
    });

    it("should reject empty repository", () => {
      const args = {
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "   ", // Whitespace only
      };

      expect(() => validateFindPathArgs(args)).toThrow(/Repository name cannot be empty/);
    });

    it("should reject max_hops below minimum", () => {
      const args = {
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "test-repo",
        max_hops: 0,
      };

      expect(() => validateFindPathArgs(args)).toThrow(/max_hops must be at least 1/);
    });

    it("should reject max_hops above maximum", () => {
      const args = {
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "test-repo",
        max_hops: 25,
      };

      expect(() => validateFindPathArgs(args)).toThrow(/max_hops cannot exceed 20/);
    });

    it("should reject invalid relationship_types", () => {
      const args = {
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "test-repo",
        relationship_types: ["imports", "invalidType"],
      };

      expect(() => validateFindPathArgs(args)).toThrow();
    });

    it("should reject unknown properties (strict mode)", () => {
      const args = {
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "test-repo",
        unknownField: "value",
      };

      expect(() => validateFindPathArgs(args)).toThrow();
    });
  });

  describe("Handler Execution", () => {
    it("should return successful result with path found", async () => {
      const mockResult: PathResult = {
        path_exists: true,
        path: [
          {
            type: "function",
            identifier: "handleLogin",
            repository: "my-api",
            relationship_to_next: RelationshipType.CALLS,
          },
          {
            type: "function",
            identifier: "validateUser",
            repository: "my-api",
            relationship_to_next: RelationshipType.CALLS,
          },
          {
            type: "function",
            identifier: "findUser",
            repository: "my-api",
          },
        ],
        metadata: {
          hops: 2,
          query_time_ms: 45,
          from_cache: false,
        },
      };

      mockGraphService.setPathResult(mockResult);
      const handler = createFindPathHandler(mockGraphService);

      const result = await handler({
        from_entity: "src/routes/api.ts::handleLogin",
        to_entity: "src/db/users.ts::findUser",
        repository: "my-api",
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      expect(content0?.type).toBe("text");

      const textContent = content0 as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.path_exists).toBe(true);
      expect(parsed.path).toHaveLength(3);
      expect(parsed.path[0].identifier).toBe("handleLogin");
      expect(parsed.path[0].relationship_to_next).toBe("calls");
      expect(parsed.path[2].identifier).toBe("findUser");
      expect(parsed.path[2].relationship_to_next).toBeUndefined();
      expect(parsed.metadata.hops).toBe(2);
    });

    it("should return path_exists: false when no path found", async () => {
      mockGraphService.setPathResult({
        path_exists: false,
        path: null,
        metadata: {
          hops: 0,
          query_time_ms: 30,
          from_cache: false,
        },
      });

      const handler = createFindPathHandler(mockGraphService);

      const result = await handler({
        from_entity: "src/isolated.ts",
        to_entity: "src/other.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(false);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.path_exists).toBe(false);
      expect(parsed.path).toBeNull();
      expect(parsed.metadata.hops).toBe(0);
    });

    it("should handle validation errors gracefully", async () => {
      const handler = createFindPathHandler(mockGraphService);

      const result = await handler({
        from_entity: "",
        to_entity: "test.ts",
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
      mockGraphService.setError(new EntityNotFoundError("function", "handleLogin", "test-repo"));

      const handler = createFindPathHandler(mockGraphService);

      const result = await handler({
        from_entity: "src/routes/api.ts::handleLogin",
        to_entity: "src/db/users.ts::findUser",
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

      const handler = createFindPathHandler(mockGraphService);

      const result = await handler({
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(true);

      const textContent = result.content[0] as { type: "text"; text: string };
      expect(textContent.text).toContain("Invalid query parameters");
    });

    it("should handle GraphServiceTimeoutError", async () => {
      mockGraphService.setError(new GraphServiceTimeoutError("Query timed out", 5000));

      const handler = createFindPathHandler(mockGraphService);

      const result = await handler({
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
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

      const handler = createFindPathHandler(mockGraphService);

      const result = await handler({
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("Graph operation failed");
    });
  });

  describe("Entity Parsing", () => {
    it("should parse file paths without :: as file type", async () => {
      mockGraphService.setPathResult({
        path_exists: true,
        path: [
          {
            type: "file",
            identifier: "src/routes/api.ts",
            repository: "my-api",
            relationship_to_next: RelationshipType.IMPORTS,
          },
          {
            type: "file",
            identifier: "src/db/users.ts",
            repository: "my-api",
          },
        ],
        metadata: {
          hops: 1,
          query_time_ms: 20,
          from_cache: false,
        },
      });

      const handler = createFindPathHandler(mockGraphService);

      // File paths without :: should work
      const result = await handler({
        from_entity: "src/routes/api.ts",
        to_entity: "src/db/users.ts",
        repository: "my-api",
      });

      expect(result.isError).toBe(false);
    });

    it("should parse qualified names with :: as function type", async () => {
      mockGraphService.setPathResult({
        path_exists: true,
        path: [
          {
            type: "function",
            identifier: "handleLogin",
            repository: "my-api",
          },
        ],
        metadata: {
          hops: 0,
          query_time_ms: 10,
          from_cache: false,
        },
      });

      const handler = createFindPathHandler(mockGraphService);

      // Lowercase name should be parsed as function
      const result = await handler({
        from_entity: "src/routes/api.ts::handleLogin",
        to_entity: "src/routes/api.ts::handleLogin", // Same entity
        repository: "my-api",
      });

      expect(result.isError).toBe(false);
    });

    it("should parse qualified names with uppercase as class type", async () => {
      mockGraphService.setPathResult({
        path_exists: true,
        path: [
          {
            type: "class",
            identifier: "AuthService",
            repository: "my-api",
          },
        ],
        metadata: {
          hops: 0,
          query_time_ms: 10,
          from_cache: false,
        },
      });

      const handler = createFindPathHandler(mockGraphService);

      // Uppercase name should be parsed as class
      const result = await handler({
        from_entity: "src/services/auth.ts::AuthService",
        to_entity: "src/services/auth.ts::AuthService",
        repository: "my-api",
      });

      expect(result.isError).toBe(false);
    });
  });

  describe("Relationship Type Mapping", () => {
    it("should handle all valid relationship types", async () => {
      const validTypes = ["imports", "calls", "extends", "implements", "references"];

      for (const relType of validTypes) {
        const args = {
          from_entity: "src/a.ts",
          to_entity: "src/b.ts",
          repository: "test-repo",
          relationship_types: [relType],
        };

        // Should not throw
        expect(() => validateFindPathArgs(args)).not.toThrow();
      }
    });

    it("should map relationship types to lowercase in response", async () => {
      const mockResult: PathResult = {
        path_exists: true,
        path: [
          {
            type: "file",
            identifier: "src/a.ts",
            repository: "test-repo",
            relationship_to_next: RelationshipType.IMPORTS,
          },
          {
            type: "file",
            identifier: "src/b.ts",
            repository: "test-repo",
          },
        ],
        metadata: {
          hops: 1,
          query_time_ms: 15,
          from_cache: false,
        },
      };

      mockGraphService.setPathResult(mockResult);
      const handler = createFindPathHandler(mockGraphService);

      const result = await handler({
        from_entity: "src/a.ts",
        to_entity: "src/b.ts",
        repository: "test-repo",
        relationship_types: ["imports"],
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.path[0].relationship_to_next).toBe("imports");
    });
  });
});
