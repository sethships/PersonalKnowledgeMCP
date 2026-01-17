/**
 * Unit tests for get_dependents MCP tool handler
 *
 * Tests the MCP tool implementation for querying reverse dependencies (impact analysis).
 * Uses mock GraphService to isolate testing from actual Neo4j database.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getDependentsToolDefinition,
  createGetDependentsHandler,
} from "../../../../src/mcp/tools/get-dependents.js";
import { validateGetDependentsArgs } from "../../../../src/mcp/validation.js";
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
  private dependentResult: DependentResult = {
    entity: {
      type: "file",
      path: "src/test.ts",
      repository: "test-repo",
      display_name: "test.ts",
    },
    dependents: [],
    impact_analysis: {
      direct_impact_count: 0,
      transitive_impact_count: 0,
      impact_score: 0,
    },
    metadata: {
      total_count: 0,
      query_time_ms: 10,
      from_cache: false,
      repositories_searched: ["test-repo"],
    },
  };

  private error: Error | null = null;

  setDependentResult(result: DependentResult): void {
    this.dependentResult = result;
  }

  setError(error: Error): void {
    this.error = error;
  }

  async getDependencies(): Promise<DependencyResult> {
    throw new Error("Not implemented in mock");
  }

  async getDependents(): Promise<DependentResult> {
    if (this.error) {
      throw this.error;
    }
    return this.dependentResult;
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

  clearCache(): void {
    // Mock implementation - no-op
  }

  clearCacheForRepository(_repository: string): void {
    // Mock implementation - no-op
  }
}

describe("get_dependents MCP Tool", () => {
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
      expect(getDependentsToolDefinition.name).toBe("get_dependents");
    });

    it("should have description mentioning dependents and impact", () => {
      expect(getDependentsToolDefinition.description).toContain("depends on");
      expect(getDependentsToolDefinition.description).toContain("impact analysis");
    });

    it("should require entity_type and entity_path only (not repository)", () => {
      const schema = getDependentsToolDefinition.inputSchema;
      expect(schema.required).toContain("entity_type");
      expect(schema.required).toContain("entity_path");
      expect(schema.required).not.toContain("repository");
    });

    it("should define valid entity_type values including package", () => {
      const schema = getDependentsToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const entityTypeProperty = properties["entity_type"] as { enum?: string[] };
      expect(entityTypeProperty).toBeDefined();
      expect(entityTypeProperty.enum).toEqual(["file", "function", "class", "package"]);
    });

    it("should define depth with correct range", () => {
      const schema = getDependentsToolDefinition.inputSchema;
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

    it("should define include_cross_repo boolean with default false", () => {
      const schema = getDependentsToolDefinition.inputSchema;
      const properties = schema["properties"] as Record<string, unknown>;
      const crossRepoProperty = properties["include_cross_repo"] as {
        type?: string;
        default?: boolean;
      };
      expect(crossRepoProperty).toBeDefined();
      expect(crossRepoProperty.type).toBe("boolean");
      expect(crossRepoProperty.default).toBe(false);
    });
  });

  describe("Argument Validation", () => {
    it("should validate valid arguments with all fields", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/services/auth.ts",
        repository: "my-project",
        depth: 2,
        include_cross_repo: true,
      };

      const validated = validateGetDependentsArgs(args);

      expect(validated.entity_type).toBe("file");
      expect(validated.entity_path).toBe("src/services/auth.ts");
      expect(validated.repository).toBe("my-project");
      expect(validated.depth).toBe(2);
      expect(validated.include_cross_repo).toBe(true);
    });

    it("should apply default depth of 1", () => {
      const args = {
        entity_type: "function",
        entity_path: "myFunction",
      };

      const validated = validateGetDependentsArgs(args);

      expect(validated.depth).toBe(1);
    });

    it("should apply default include_cross_repo of false", () => {
      const args = {
        entity_type: "function",
        entity_path: "myFunction",
      };

      const validated = validateGetDependentsArgs(args);

      expect(validated.include_cross_repo).toBe(false);
    });

    it("should allow repository to be omitted", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
      };

      const validated = validateGetDependentsArgs(args);

      expect(validated.repository).toBeUndefined();
    });

    it("should trim whitespace from string fields", () => {
      const args = {
        entity_type: "file",
        entity_path: "  src/test.ts  ",
        repository: "  my-repo  ",
      };

      const validated = validateGetDependentsArgs(args);

      expect(validated.entity_path).toBe("src/test.ts");
      expect(validated.repository).toBe("my-repo");
    });

    it("should accept package as entity_type", () => {
      const args = {
        entity_type: "package",
        entity_path: "src/services",
      };

      const validated = validateGetDependentsArgs(args);

      expect(validated.entity_type).toBe("package");
    });

    it("should reject invalid entity_type", () => {
      const args = {
        entity_type: "module", // Invalid (not in the enum)
        entity_path: "src/test.ts",
      };

      expect(() => validateGetDependentsArgs(args)).toThrow();
    });

    it("should reject empty entity_path", () => {
      const args = {
        entity_type: "file",
        entity_path: "",
      };

      expect(() => validateGetDependentsArgs(args)).toThrow(/Entity path cannot be empty/);
    });

    it("should reject empty repository when provided", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "   ", // Whitespace only
      };

      expect(() => validateGetDependentsArgs(args)).toThrow(/Repository name cannot be empty/);
    });

    it("should reject depth below minimum", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        depth: 0,
      };

      expect(() => validateGetDependentsArgs(args)).toThrow(/Depth must be at least 1/);
    });

    it("should reject depth above maximum", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        depth: 10,
      };

      expect(() => validateGetDependentsArgs(args)).toThrow(/Depth cannot exceed 5/);
    });

    it("should reject unknown properties (strict mode)", () => {
      const args = {
        entity_type: "file",
        entity_path: "src/test.ts",
        unknownField: "value",
      };

      expect(() => validateGetDependentsArgs(args)).toThrow();
    });
  });

  describe("Handler Execution", () => {
    it("should return successful result with dependents and impact_analysis", async () => {
      const mockResult: DependentResult = {
        entity: {
          type: "function",
          path: "validateToken",
          repository: "my-project",
          display_name: "validateToken",
        },
        dependents: [
          {
            type: "file",
            path: "src/routes/auth.ts",
            repository: "my-project",
            relationship_type: RelationshipType.IMPORTS,
            depth: 1,
          },
          {
            type: "function",
            path: "loginHandler",
            repository: "my-project",
            relationship_type: RelationshipType.CALLS,
            depth: 1,
          },
        ],
        impact_analysis: {
          direct_impact_count: 2,
          transitive_impact_count: 5,
          impact_score: 0.7,
        },
        metadata: {
          total_count: 2,
          query_time_ms: 15,
          from_cache: false,
          repositories_searched: ["my-project"],
        },
      };

      mockGraphService.setDependentResult(mockResult);
      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "function",
        entity_path: "validateToken",
        repository: "my-project",
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      expect(content0?.type).toBe("text");

      const textContent = content0 as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.entity.type).toBe("function");
      expect(parsed.entity.path).toBe("validateToken");
      expect(parsed.dependents).toHaveLength(2);
      expect(parsed.dependents[0].relationship).toBe("imports");
      expect(parsed.dependents[1].relationship).toBe("calls");
      expect(parsed.impact_analysis.direct_impact_count).toBe(2);
      expect(parsed.impact_analysis.transitive_impact_count).toBe(5);
      expect(parsed.impact_analysis.impact_score).toBe(0.7);
      expect(parsed.metadata.total_count).toBe(2);
      expect(parsed.metadata.repositories_searched).toEqual(["my-project"]);
    });

    it("should return empty dependents array when none found", async () => {
      mockGraphService.setDependentResult({
        entity: {
          type: "file",
          path: "src/standalone.ts",
          repository: "test-repo",
          display_name: "standalone.ts",
        },
        dependents: [],
        impact_analysis: {
          direct_impact_count: 0,
          transitive_impact_count: 0,
          impact_score: 0,
        },
        metadata: {
          total_count: 0,
          query_time_ms: 5,
          from_cache: false,
          repositories_searched: ["test-repo"],
        },
      });

      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/standalone.ts",
      });

      expect(result.isError).toBe(false);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.dependents).toEqual([]);
      expect(parsed.metadata.total_count).toBe(0);
      expect(parsed.impact_analysis.impact_score).toBe(0);
    });

    it("should handle validation errors gracefully", async () => {
      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "invalid",
        entity_path: "test.ts",
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

      const handler = createGetDependentsHandler(mockGraphService);

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

      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
      });

      expect(result.isError).toBe(true);

      const textContent = result.content[0] as { type: "text"; text: string };
      expect(textContent.text).toContain("Invalid query parameters");
    });

    it("should handle GraphServiceTimeoutError", async () => {
      mockGraphService.setError(new GraphServiceTimeoutError("Query timed out", 5000));

      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("timed out");
    });

    it("should handle GraphServiceOperationError", async () => {
      mockGraphService.setError(new GraphServiceOperationError("Neo4j connection lost", true));

      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("Graph operation failed");
    });

    it("should handle generic Error from GraphService", async () => {
      mockGraphService.setError(new Error("Unexpected database error"));

      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/test.ts",
        repository: "test-repo",
      });

      expect(result.isError).toBe(true);

      const content0 = result.content[0];
      expect(content0).toBeDefined();
      const textContent = content0 as { type: "text"; text: string };
      expect(textContent.text).toContain("Error:");
    });

    it("should include repository in dependent items", async () => {
      const mockResult: DependentResult = {
        entity: {
          type: "file",
          path: "src/shared/utils.ts",
          repository: "shared-lib",
          display_name: "utils.ts",
        },
        dependents: [
          {
            type: "file",
            path: "src/app.ts",
            repository: "project-a",
            relationship_type: RelationshipType.IMPORTS,
            depth: 1,
          },
          {
            type: "file",
            path: "src/main.ts",
            repository: "project-b",
            relationship_type: RelationshipType.IMPORTS,
            depth: 1,
          },
        ],
        impact_analysis: {
          direct_impact_count: 2,
          transitive_impact_count: 0,
          impact_score: 0.5,
        },
        metadata: {
          total_count: 2,
          query_time_ms: 20,
          from_cache: false,
          repositories_searched: ["shared-lib", "project-a", "project-b"],
        },
      };

      mockGraphService.setDependentResult(mockResult);
      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/shared/utils.ts",
        include_cross_repo: true,
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.dependents[0].repository).toBe("project-a");
      expect(parsed.dependents[1].repository).toBe("project-b");
      expect(parsed.metadata.repositories_searched).toContain("project-a");
      expect(parsed.metadata.repositories_searched).toContain("project-b");
    });
  });

  describe("Response Format", () => {
    it("should format relationship types as lowercase strings", async () => {
      const mockResult: DependentResult = {
        entity: {
          type: "class",
          path: "AuthService",
          repository: "test-repo",
          display_name: "AuthService",
        },
        dependents: [
          {
            type: "class",
            path: "AdminAuthService",
            repository: "test-repo",
            relationship_type: RelationshipType.EXTENDS,
            depth: 1,
          },
          {
            type: "class",
            path: "AuthController",
            repository: "test-repo",
            relationship_type: RelationshipType.REFERENCES,
            depth: 1,
          },
        ],
        impact_analysis: {
          direct_impact_count: 2,
          transitive_impact_count: 0,
          impact_score: 0.3,
        },
        metadata: {
          total_count: 2,
          query_time_ms: 12,
          from_cache: false,
          repositories_searched: ["test-repo"],
        },
      };

      mockGraphService.setDependentResult(mockResult);
      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "class",
        entity_path: "AuthService",
        repository: "test-repo",
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.dependents[0].relationship).toBe("extends");
      expect(parsed.dependents[1].relationship).toBe("references");
    });

    it("should include all impact_analysis fields", async () => {
      const mockResult: DependentResult = {
        entity: {
          type: "file",
          path: "src/core/utils.ts",
          repository: "test-repo",
          display_name: "utils.ts",
        },
        dependents: [],
        impact_analysis: {
          direct_impact_count: 10,
          transitive_impact_count: 50,
          impact_score: 0.85,
        },
        metadata: {
          total_count: 0,
          query_time_ms: 8,
          from_cache: true,
          repositories_searched: ["test-repo"],
        },
      };

      mockGraphService.setDependentResult(mockResult);
      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "file",
        entity_path: "src/core/utils.ts",
        repository: "test-repo",
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.impact_analysis).toEqual({
        direct_impact_count: 10,
        transitive_impact_count: 50,
        impact_score: 0.85,
      });
    });

    it("should include metadata in response", async () => {
      const mockResult: DependentResult = {
        entity: {
          type: "function",
          path: "validateInput",
          repository: "test-repo",
          display_name: "validateInput",
        },
        dependents: [],
        impact_analysis: {
          direct_impact_count: 0,
          transitive_impact_count: 0,
          impact_score: 0,
        },
        metadata: {
          total_count: 0,
          query_time_ms: 42,
          from_cache: false,
          repositories_searched: ["test-repo", "other-repo"],
        },
      };

      mockGraphService.setDependentResult(mockResult);
      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "function",
        entity_path: "validateInput",
      });

      const textContent = result.content[0] as { type: "text"; text: string };
      const parsed = JSON.parse(textContent.text);

      expect(parsed.metadata.total_count).toBe(0);
      expect(parsed.metadata.query_time_ms).toBe(42);
      expect(parsed.metadata.repositories_searched).toEqual(["test-repo", "other-repo"]);
    });
  });

  describe("Entity Types", () => {
    it("should handle all valid entity types", async () => {
      const validTypes = ["file", "function", "class", "package"] as const;

      for (const entityType of validTypes) {
        const args = {
          entity_type: entityType,
          entity_path: "src/test",
        };

        // Should not throw
        expect(() => validateGetDependentsArgs(args)).not.toThrow();
      }
    });

    it("should pass package entity type to handler correctly", async () => {
      const mockResult: DependentResult = {
        entity: {
          type: "file", // GraphService may normalize package to file in response
          path: "src/services",
          repository: "test-repo",
          display_name: "services",
        },
        dependents: [],
        impact_analysis: {
          direct_impact_count: 0,
          transitive_impact_count: 0,
          impact_score: 0,
        },
        metadata: {
          total_count: 0,
          query_time_ms: 5,
          from_cache: false,
          repositories_searched: ["test-repo"],
        },
      };

      mockGraphService.setDependentResult(mockResult);
      const handler = createGetDependentsHandler(mockGraphService);

      const result = await handler({
        entity_type: "package",
        entity_path: "src/services",
      });

      expect(result.isError).toBe(false);
    });
  });
});
