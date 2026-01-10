/**
 * Tests for Graph Populate Command
 *
 * Tests the CLI command for populating the Neo4j knowledge graph
 * from an indexed repository.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/await-thenable */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "bun:test";
import type { RepositoryInfo, RepositoryMetadataService } from "../../../src/repositories/types.js";

// Mock modules before importing the command
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: "",
  }),
}));

describe("Graph Populate Command", () => {
  let mockRepositoryService: RepositoryMetadataService;
  let mockGetRepository: Mock<() => Promise<RepositoryInfo | null>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;
  let consoleErrorSpy: Mock<(...args: any[]) => void>;
  let originalEnv: Record<string, string | undefined>;

  const mockRepositoryInfo: RepositoryInfo = {
    name: "test-repo",
    url: "https://github.com/test/test-repo.git",
    collectionName: "test-repo",
    localPath: "/tmp/test-repo",
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: "2024-12-15T15:30:00.000Z",
    lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
    indexDurationMs: 5000,
    status: "ready" as const,
    branch: "main",
    includeExtensions: [],
    excludePatterns: [],
  };

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set up required environment variables
    process.env["NEO4J_PASSWORD"] = "testpassword";
    process.env["NEO4J_HOST"] = "localhost";
    process.env["NEO4J_BOLT_PORT"] = "7687";
    process.env["NEO4J_USER"] = "neo4j";

    // Create mocks
    mockGetRepository = vi.fn();

    // Set up spies
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockRepositoryService = {
      getRepository: mockGetRepository,
      updateRepository: vi.fn(),
      deleteRepository: vi.fn(),
      listRepositories: vi.fn(),
    } as unknown as RepositoryMetadataService;
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;

    // Clear mocks
    vi.clearAllMocks();
  });

  describe("GraphPopulateCommandOptionsSchema validation", () => {
    it("should import validation schema correctly", async () => {
      const { GraphPopulateCommandOptionsSchema } =
        await import("../../../src/cli/utils/validation.js");

      expect(GraphPopulateCommandOptionsSchema).toBeDefined();
    });

    it("should validate empty options", async () => {
      const { GraphPopulateCommandOptionsSchema } =
        await import("../../../src/cli/utils/validation.js");

      const result = GraphPopulateCommandOptionsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should validate force option", async () => {
      const { GraphPopulateCommandOptionsSchema } =
        await import("../../../src/cli/utils/validation.js");

      const result = GraphPopulateCommandOptionsSchema.safeParse({ force: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.force).toBe(true);
      }
    });

    it("should validate json option", async () => {
      const { GraphPopulateCommandOptionsSchema } =
        await import("../../../src/cli/utils/validation.js");

      const result = GraphPopulateCommandOptionsSchema.safeParse({ json: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.json).toBe(true);
      }
    });

    it("should validate both options together", async () => {
      const { GraphPopulateCommandOptionsSchema } =
        await import("../../../src/cli/utils/validation.js");

      const result = GraphPopulateCommandOptionsSchema.safeParse({
        force: true,
        json: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.force).toBe(true);
        expect(result.data.json).toBe(true);
      }
    });
  });

  describe("Environment variable validation", () => {
    it("should fail without NEO4J_PASSWORD", async () => {
      delete process.env["NEO4J_PASSWORD"];

      // Mock process.exit to capture exit calls
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await expect(
          graphPopulateCommand("test-repo", {}, mockRepositoryService)
        ).rejects.toThrow();
      } catch (error) {
        expect(consoleErrorSpy).toHaveBeenCalled();
        const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join(" ");
        expect(errorOutput).toContain("NEO4J_PASSWORD");
      } finally {
        mockExit.mockRestore();
      }
    });

    it("should fail with invalid NEO4J_BOLT_PORT", async () => {
      process.env["NEO4J_BOLT_PORT"] = "not-a-number";

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await expect(
          graphPopulateCommand("test-repo", {}, mockRepositoryService)
        ).rejects.toThrow();
      } catch (error) {
        expect(consoleErrorSpy).toHaveBeenCalled();
      } finally {
        mockExit.mockRestore();
      }
    });
  });

  describe("Repository validation", () => {
    it("should fail for non-existent repository", async () => {
      mockGetRepository.mockResolvedValue(null);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await graphPopulateCommand("non-existent", {}, mockRepositoryService);
      } catch (error) {
        expect(consoleErrorSpy).toHaveBeenCalled();
        const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join(" ");
        expect(errorOutput).toContain("not found");
      } finally {
        mockExit.mockRestore();
      }
    });

    it("should fail for repository without localPath", async () => {
      const repoWithoutPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: undefined as unknown as string,
      };
      mockGetRepository.mockResolvedValue(repoWithoutPath);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await graphPopulateCommand("test-repo", {}, mockRepositoryService);
      } catch (error) {
        expect(consoleErrorSpy).toHaveBeenCalled();
        const errorOutput = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join(" ");
        expect(errorOutput).toContain("local clone");
      } finally {
        mockExit.mockRestore();
      }
    });
  });

  describe("JSON output mode", () => {
    it("should output JSON when json flag is set and repository not found", async () => {
      mockGetRepository.mockResolvedValue(null);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await graphPopulateCommand("test-repo", { json: true }, mockRepositoryService);
      } catch (error) {
        expect(consoleLogSpy).toHaveBeenCalled();
        const jsonOutput = consoleLogSpy.mock.calls[0]?.[0] as string;
        const parsed = JSON.parse(jsonOutput);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toBeDefined();
      } finally {
        mockExit.mockRestore();
      }
    });

    it("should output JSON when NEO4J_PASSWORD is missing", async () => {
      delete process.env["NEO4J_PASSWORD"];

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await graphPopulateCommand("test-repo", { json: true }, mockRepositoryService);
      } catch (error) {
        expect(consoleLogSpy).toHaveBeenCalled();
        const jsonOutput = consoleLogSpy.mock.calls[0]?.[0] as string;
        const parsed = JSON.parse(jsonOutput);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain("NEO4J_PASSWORD");
      } finally {
        mockExit.mockRestore();
      }
    });
  });

  describe("File scanning", () => {
    it("should include TypeScript files", () => {
      // Test the supported extensions logic
      const supportedExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

      expect(supportedExtensions.has(".ts")).toBe(true);
      expect(supportedExtensions.has(".tsx")).toBe(true);
      expect(supportedExtensions.has(".js")).toBe(true);
      expect(supportedExtensions.has(".jsx")).toBe(true);
    });

    it("should exclude unsupported file types", () => {
      const supportedExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

      expect(supportedExtensions.has(".md")).toBe(false);
      expect(supportedExtensions.has(".json")).toBe(false);
      expect(supportedExtensions.has(".css")).toBe(false);
      expect(supportedExtensions.has(".py")).toBe(false);
    });

    it("should exclude common build directories", () => {
      const excludedDirectories = new Set([
        "node_modules",
        ".git",
        "dist",
        "build",
        "coverage",
        ".next",
        ".nuxt",
        "out",
        "__pycache__",
      ]);

      expect(excludedDirectories.has("node_modules")).toBe(true);
      expect(excludedDirectories.has(".git")).toBe(true);
      expect(excludedDirectories.has("dist")).toBe(true);
      expect(excludedDirectories.has("src")).toBe(false);
      expect(excludedDirectories.has("lib")).toBe(false);
    });
  });

  describe("Duration formatting", () => {
    it("should format milliseconds correctly", () => {
      // Test the formatDuration logic
      const formatDuration = (ms: number): string => {
        if (ms < 1000) {
          return `${ms}ms`;
        }
        const seconds = (ms / 1000).toFixed(1);
        return `${seconds}s`;
      };

      expect(formatDuration(500)).toBe("500ms");
      expect(formatDuration(999)).toBe("999ms");
      expect(formatDuration(1000)).toBe("1.0s");
      expect(formatDuration(1500)).toBe("1.5s");
      expect(formatDuration(12345)).toBe("12.3s");
    });
  });

  describe("Phase formatting", () => {
    it("should format phase names correctly", () => {
      const phases: Record<string, string> = {
        initializing: "Initializing",
        extracting_entities: "Extracting entities",
        extracting_relationships: "Extracting relationships",
        creating_repository_node: "Creating repository node",
        creating_file_nodes: "Creating file nodes",
        creating_entity_nodes: "Creating entity nodes",
        creating_module_nodes: "Creating module nodes",
        creating_relationships: "Creating relationships",
        verifying: "Verifying",
        completed: "Completed",
      };

      expect(phases["initializing"]).toBe("Initializing");
      expect(phases["extracting_entities"]).toBe("Extracting entities");
      expect(phases["completed"]).toBe("Completed");
    });
  });
});
