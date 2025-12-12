/**
 * Unit tests for MCP input validation
 *
 * Tests Zod schema validation for semantic_search tool arguments including
 * boundary conditions, defaults, and error messages.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { validateSemanticSearchArgs, SemanticSearchArgsSchema } from "../../src/mcp/validation.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

describe("MCP Validation", () => {
  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });
  });

  afterEach(() => {
    resetLogger();
  });

  describe("validateSemanticSearchArgs", () => {
    describe("query validation", () => {
      it("should accept valid query", () => {
        const result = validateSemanticSearchArgs({
          query: "find authentication code",
        });

        expect(result.query).toBe("find authentication code");
      });

      it("should trim whitespace from query", () => {
        const result = validateSemanticSearchArgs({
          query: "  search query  ",
        });

        expect(result.query).toBe("search query");
      });

      it("should reject empty query", () => {
        expect(() => {
          validateSemanticSearchArgs({ query: "" });
        }).toThrow();
      });

      it("should reject query with only whitespace", () => {
        expect(() => {
          validateSemanticSearchArgs({ query: "   " });
        }).toThrow();
      });

      it("should reject query exceeding 1000 characters", () => {
        const longQuery = "a".repeat(1001);

        expect(() => {
          validateSemanticSearchArgs({ query: longQuery });
        }).toThrow();

        try {
          validateSemanticSearchArgs({ query: longQuery });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.code).toBe(ErrorCode.InvalidParams);
          expect(mcpError.message).toContain("1000");
        }
      });

      it("should accept query with exactly 1000 characters", () => {
        const maxQuery = "a".repeat(1000);
        const result = validateSemanticSearchArgs({ query: maxQuery });

        expect(result.query).toBe(maxQuery);
      });

      it("should accept query with exactly 1 character", () => {
        const result = validateSemanticSearchArgs({ query: "a" });

        expect(result.query).toBe("a");
      });

      it("should reject missing query", () => {
        expect(() => {
          validateSemanticSearchArgs({});
        }).toThrow();
      });

      it("should provide helpful error message for empty query", () => {
        try {
          validateSemanticSearchArgs({ query: "" });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.message).toContain("cannot be empty");
        }
      });
    });

    describe("limit validation", () => {
      it("should apply default limit of 10", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
        });

        expect(result.limit).toBe(10);
      });

      it("should accept valid limit", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          limit: 20,
        });

        expect(result.limit).toBe(20);
      });

      it("should accept limit of 1 (minimum)", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          limit: 1,
        });

        expect(result.limit).toBe(1);
      });

      it("should accept limit of 50 (maximum)", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          limit: 50,
        });

        expect(result.limit).toBe(50);
      });

      it("should reject limit of 0", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            limit: 0,
          });
        }).toThrow();
      });

      it("should reject limit of 51", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            limit: 51,
          });
        }).toThrow();

        try {
          validateSemanticSearchArgs({ query: "test", limit: 51 });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.code).toBe(ErrorCode.InvalidParams);
          expect(mcpError.message).toContain("50");
        }
      });

      it("should reject negative limit", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            limit: -1,
          });
        }).toThrow();
      });

      it("should reject non-integer limit", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            limit: 10.5,
          });
        }).toThrow();

        try {
          validateSemanticSearchArgs({ query: "test", limit: 10.5 });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.message).toContain("integer");
        }
      });
    });

    describe("threshold validation", () => {
      it("should apply default threshold of 0.7", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
        });

        expect(result.threshold).toBe(0.7);
      });

      it("should accept valid threshold", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          threshold: 0.85,
        });

        expect(result.threshold).toBe(0.85);
      });

      it("should accept threshold of 0.0 (minimum)", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          threshold: 0.0,
        });

        expect(result.threshold).toBe(0.0);
      });

      it("should accept threshold of 1.0 (maximum)", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          threshold: 1.0,
        });

        expect(result.threshold).toBe(1.0);
      });

      it("should reject threshold < 0.0", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            threshold: -0.1,
          });
        }).toThrow();

        try {
          validateSemanticSearchArgs({ query: "test", threshold: -0.1 });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.code).toBe(ErrorCode.InvalidParams);
          expect(mcpError.message).toContain("0.0");
        }
      });

      it("should reject threshold > 1.0", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            threshold: 1.1,
          });
        }).toThrow();

        try {
          validateSemanticSearchArgs({ query: "test", threshold: 1.1 });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.message).toContain("1.0");
        }
      });

      it("should accept floating point thresholds", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          threshold: 0.75,
        });

        expect(result.threshold).toBe(0.75);
      });
    });

    describe("repository validation", () => {
      it("should accept repository filter", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          repository: "my-api",
        });

        expect(result.repository).toBe("my-api");
      });

      it("should trim whitespace from repository", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
          repository: "  my-repo  ",
        });

        expect(result.repository).toBe("my-repo");
      });

      it("should reject empty repository name", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            repository: "",
          });
        }).toThrow();
      });

      it("should reject repository with only whitespace", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            repository: "   ",
          });
        }).toThrow();
      });

      it("should allow omitting repository (undefined)", () => {
        const result = validateSemanticSearchArgs({
          query: "test",
        });

        expect(result.repository).toBeUndefined();
      });
    });

    describe("combined validation", () => {
      it("should accept all valid parameters", () => {
        const result = validateSemanticSearchArgs({
          query: "authentication middleware",
          limit: 25,
          threshold: 0.8,
          repository: "backend-api",
        });

        expect(result.query).toBe("authentication middleware");
        expect(result.limit).toBe(25);
        expect(result.threshold).toBe(0.8);
        expect(result.repository).toBe("backend-api");
      });

      it("should reject unknown properties (strict mode)", () => {
        expect(() => {
          validateSemanticSearchArgs({
            query: "test",
            unknownField: "value",
          });
        }).toThrow();
      });

      it("should provide comprehensive error for multiple invalid fields", () => {
        try {
          validateSemanticSearchArgs({
            query: "",
            limit: 100,
            threshold: 1.5,
          });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.message).toContain("semantic_search");
          // Should mention at least one validation error
          expect(mcpError.message.length).toBeGreaterThan(20);
        }
      });
    });

    describe("error message format", () => {
      it("should include field path in error message", () => {
        try {
          validateSemanticSearchArgs({
            query: "test",
            limit: -5,
          });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.message).toContain("limit");
        }
      });

      it("should start with descriptive prefix", () => {
        try {
          validateSemanticSearchArgs({ query: "" });
        } catch (error: unknown) {
          const mcpError = error as McpError;
          expect(mcpError.message).toContain("Invalid semantic_search arguments");
        }
      });
    });
  });

  describe("SemanticSearchArgsSchema", () => {
    it("should export the schema for external use", () => {
      expect(SemanticSearchArgsSchema).toBeDefined();
      expect(typeof SemanticSearchArgsSchema.parse).toBe("function");
    });

    it("should work with safeParse for custom handling", () => {
      const result = SemanticSearchArgsSchema.safeParse({
        query: "test query",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query).toBe("test query");
      }
    });
  });
});
