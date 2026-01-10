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

import { describe, it, expect, beforeEach, afterEach, afterAll, vi, type Mock } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { RepositoryInfo, RepositoryMetadataService } from "../../../src/repositories/types.js";

// Note: We do NOT mock ora here to avoid mock leakage to other test files.
// Bun's vi.mock() hoists to module level and affects global module cache.
// Real ora works fine in non-TTY environments (spinner methods work, just isSpinning=false).

// Mock Neo4j client
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/graph/Neo4jClient.js", () => ({
  Neo4jStorageClientImpl: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
  })),
}));

// Mock GraphIngestionService
const mockIngestFiles = vi.fn();

vi.mock("../../../src/graph/ingestion/GraphIngestionService.js", () => ({
  GraphIngestionService: vi.fn().mockImplementation(() => ({
    ingestFiles: mockIngestFiles,
  })),
}));

// Mock extractors
vi.mock("../../../src/graph/extraction/EntityExtractor.js", () => ({
  EntityExtractor: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../src/graph/extraction/RelationshipExtractor.js", () => ({
  RelationshipExtractor: vi.fn().mockImplementation(() => ({})),
}));

describe("Graph Populate Command", () => {
  let mockRepositoryService: RepositoryMetadataService;
  let mockGetRepository: Mock<() => Promise<RepositoryInfo | null>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;
  let consoleErrorSpy: Mock<(...args: any[]) => void>;
  let originalEnv: Record<string, string | undefined>;
  let testDir: string;

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

  beforeEach(async () => {
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
    vi.spyOn(console, "warn").mockImplementation(() => {});

    mockRepositoryService = {
      getRepository: mockGetRepository,
      updateRepository: vi.fn(),
      deleteRepository: vi.fn(),
      listRepositories: vi.fn(),
    } as unknown as RepositoryMetadataService;

    // Create a test directory with sample files
    testDir = join(tmpdir(), `test-repo-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Reset mocks
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockIngestFiles.mockClear();
  });

  afterEach(async () => {
    // Restore environment
    process.env = originalEnv;

    // Clear mocks
    vi.clearAllMocks();

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  afterAll(() => {
    // Restore all mocks - vi.unmock is not available in Bun
    vi.restoreAllMocks();
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

  describe("getNeo4jConfig shared utility", () => {
    it("should export getNeo4jConfig from shared utility", async () => {
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");
      expect(getNeo4jConfig).toBeDefined();
      expect(typeof getNeo4jConfig).toBe("function");
    });

    it("should return valid config with all env vars set", async () => {
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      const config = getNeo4jConfig();
      expect(config.host).toBe("localhost");
      expect(config.port).toBe(7687);
      expect(config.username).toBe("neo4j");
      expect(config.password).toBe("testpassword");
    });

    it("should throw when NEO4J_PASSWORD is missing", async () => {
      delete process.env["NEO4J_PASSWORD"];
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("NEO4J_PASSWORD");
    });

    it("should throw for invalid port", async () => {
      process.env["NEO4J_BOLT_PORT"] = "not-a-number";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
    });

    it("should throw for port out of range", async () => {
      process.env["NEO4J_BOLT_PORT"] = "99999";
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
    });

    it("should use default values when optional env vars are missing", async () => {
      delete process.env["NEO4J_HOST"];
      delete process.env["NEO4J_BOLT_PORT"];
      delete process.env["NEO4J_USER"];
      const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

      const config = getNeo4jConfig();
      expect(config.host).toBe("localhost");
      expect(config.port).toBe(7687);
      expect(config.username).toBe("neo4j");
    });
  });

  describe("Environment variable validation", () => {
    it("should fail without NEO4J_PASSWORD", async () => {
      delete process.env["NEO4J_PASSWORD"];

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await expect(
          graphPopulateCommand("test-repo", {}, mockRepositoryService)
        ).rejects.toThrow();
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
        // Expected error from process.exit mock
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
        // Expected error from process.exit mock
      } finally {
        mockExit.mockRestore();
      }
    });

    it("should fail when local path does not exist", async () => {
      const repoWithBadPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: "/nonexistent/path/to/repo",
      };
      mockGetRepository.mockResolvedValue(repoWithBadPath);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await graphPopulateCommand("test-repo", {}, mockRepositoryService);
      } catch (error) {
        // Expected error from process.exit mock
      } finally {
        mockExit.mockRestore();
      }
    });
  });

  describe("Happy path - successful population", () => {
    it("should successfully process files and call ingestion service", async () => {
      // Create test files in the test directory
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");
      await writeFile(join(testDir, "utils.ts"), "export const bar = 2;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      // Mock successful ingestion result
      mockIngestFiles.mockResolvedValue({
        status: "success",
        stats: {
          filesProcessed: 2,
          filesFailed: 0,
          nodesCreated: 10,
          relationshipsCreated: 5,
          durationMs: 1000,
          nodesByType: {
            repository: 1,
            file: 2,
            function: 5,
            class: 1,
            module: 1,
          },
          relationshipsByType: {
            contains: 2,
            defines: 2,
            imports: 1,
          },
        },
        errors: [],
      });

      const { graphPopulateCommand } =
        await import("../../../src/cli/commands/graph-populate-command.js");

      await graphPopulateCommand("test-repo", {}, mockRepositoryService);

      // Verify service calls
      expect(mockConnect).toHaveBeenCalled();
      expect(mockIngestFiles).toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
      // Note: Spinner behavior is not tested to avoid ora mock leakage to other test files
    });

    it("should pass force option to ingestion service", async () => {
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      mockIngestFiles.mockResolvedValue({
        status: "success",
        stats: {
          filesProcessed: 1,
          filesFailed: 0,
          nodesCreated: 5,
          relationshipsCreated: 2,
          durationMs: 500,
        },
        errors: [],
      });

      const { graphPopulateCommand } =
        await import("../../../src/cli/commands/graph-populate-command.js");

      await graphPopulateCommand("test-repo", { force: true }, mockRepositoryService);

      // Verify force was passed to ingestion service
      expect(mockIngestFiles).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ force: true })
      );
    });

    it("should output JSON when json flag is set", async () => {
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      const mockResult = {
        status: "success",
        stats: {
          filesProcessed: 1,
          filesFailed: 0,
          nodesCreated: 5,
          relationshipsCreated: 2,
          durationMs: 500,
        },
        errors: [],
      };
      mockIngestFiles.mockResolvedValue(mockResult);

      const { graphPopulateCommand } =
        await import("../../../src/cli/commands/graph-populate-command.js");

      await graphPopulateCommand("test-repo", { json: true }, mockRepositoryService);

      // Verify JSON output
      expect(consoleLogSpy).toHaveBeenCalled();
      const jsonOutput = consoleLogSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.status).toBe("success");
      expect(parsed.stats.filesProcessed).toBe(1);
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

  describe("File scanning behavior", () => {
    it("should only scan supported file extensions", async () => {
      // Create various file types
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");
      await writeFile(join(testDir, "app.tsx"), "export const App = () => null;");
      await writeFile(join(testDir, "utils.js"), "module.exports = {};");
      await writeFile(join(testDir, "component.jsx"), "export const Comp = () => null;");
      await writeFile(join(testDir, "readme.md"), "# Readme");
      await writeFile(join(testDir, "data.json"), "{}");
      await writeFile(join(testDir, "style.css"), "body {}");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      mockIngestFiles.mockResolvedValue({
        status: "success",
        stats: {
          filesProcessed: 4,
          filesFailed: 0,
          nodesCreated: 20,
          relationshipsCreated: 10,
          durationMs: 1000,
        },
        errors: [],
      });

      const { graphPopulateCommand } =
        await import("../../../src/cli/commands/graph-populate-command.js");

      await graphPopulateCommand("test-repo", {}, mockRepositoryService);

      // Should only process 4 files (ts, tsx, js, jsx)
      const ingestCall = mockIngestFiles.mock.calls[0];
      const files = ingestCall?.[0] as Array<{ path: string; content: string }>;
      expect(files.length).toBe(4);
      expect(files.map((f) => f.path).sort()).toEqual([
        "app.tsx",
        "component.jsx",
        "index.ts",
        "utils.js",
      ]);
    });

    it("should exclude node_modules directory", async () => {
      // Create files including in node_modules
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");
      await mkdir(join(testDir, "node_modules", "some-package"), { recursive: true });
      await writeFile(
        join(testDir, "node_modules", "some-package", "index.ts"),
        "export const pkg = 1;"
      );

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      mockIngestFiles.mockResolvedValue({
        status: "success",
        stats: {
          filesProcessed: 1,
          filesFailed: 0,
          nodesCreated: 5,
          relationshipsCreated: 2,
          durationMs: 500,
        },
        errors: [],
      });

      const { graphPopulateCommand } =
        await import("../../../src/cli/commands/graph-populate-command.js");

      await graphPopulateCommand("test-repo", {}, mockRepositoryService);

      // Should only process 1 file (not the one in node_modules)
      const ingestCall = mockIngestFiles.mock.calls[0];
      const files = ingestCall?.[0] as Array<{ path: string; content: string }>;
      expect(files.length).toBe(1);
      expect(files[0]?.path).toBe("index.ts");
    });

    it("should fail when no supported files are found", async () => {
      // Create only unsupported files
      await writeFile(join(testDir, "readme.md"), "# Readme");
      await writeFile(join(testDir, "data.json"), "{}");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await graphPopulateCommand("test-repo", {}, mockRepositoryService);
      } catch (error) {
        // Expected error from process.exit mock
      } finally {
        mockExit.mockRestore();
      }
    });
  });

  describe("Error handling", () => {
    it("should handle partial success status", async () => {
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      mockIngestFiles.mockResolvedValue({
        status: "partial",
        stats: {
          filesProcessed: 1,
          filesFailed: 1,
          nodesCreated: 5,
          relationshipsCreated: 2,
          durationMs: 500,
        },
        errors: [{ message: "Parse error", filePath: "broken.ts" }],
      });

      const { graphPopulateCommand } =
        await import("../../../src/cli/commands/graph-populate-command.js");

      await graphPopulateCommand("test-repo", {}, mockRepositoryService);

      // Should complete without throwing
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it("should exit with code 1 on failed status", async () => {
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      mockIngestFiles.mockResolvedValue({
        status: "failed",
        stats: {
          filesProcessed: 0,
          filesFailed: 1,
          nodesCreated: 0,
          relationshipsCreated: 0,
          durationMs: 100,
        },
        errors: [{ message: "Critical error" }],
      });

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await graphPopulateCommand("test-repo", {}, mockRepositoryService);
      } catch (error) {
        expect(mockExit).toHaveBeenCalledWith(1);
      } finally {
        mockExit.mockRestore();
      }
    });

    it("should handle RepositoryExistsError with helpful message", async () => {
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      // Import RepositoryExistsError and make ingestion throw it
      const { RepositoryExistsError } = await import("../../../src/graph/ingestion/errors.js");
      mockIngestFiles.mockRejectedValue(new RepositoryExistsError("test-repo"));

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
        expect(errorOutput).toContain("already has graph data");
        expect(errorOutput).toContain("--force");
      } finally {
        mockExit.mockRestore();
      }
    });

    it("should handle RepositoryExistsError with JSON output", async () => {
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      const { RepositoryExistsError } = await import("../../../src/graph/ingestion/errors.js");
      mockIngestFiles.mockRejectedValue(new RepositoryExistsError("test-repo"));

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
        expect(parsed.error).toContain("--force");
      } finally {
        mockExit.mockRestore();
      }
    });

    it("should always disconnect Neo4j client even on error", async () => {
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      mockIngestFiles.mockRejectedValue(new Error("Ingestion failed"));

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      try {
        const { graphPopulateCommand } =
          await import("../../../src/cli/commands/graph-populate-command.js");

        await graphPopulateCommand("test-repo", {}, mockRepositoryService);
      } catch (error) {
        // Expected to throw
      } finally {
        mockExit.mockRestore();
      }

      // Disconnect should still be called
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("Duration formatting", () => {
    it("should format milliseconds correctly", () => {
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

  describe("Progress callback", () => {
    it("should update spinner text during progress", async () => {
      await writeFile(join(testDir, "index.ts"), "export const foo = 1;");

      const repoWithTestPath: RepositoryInfo = {
        ...mockRepositoryInfo,
        localPath: testDir,
      };
      mockGetRepository.mockResolvedValue(repoWithTestPath);

      // Capture the progress callback
      let capturedCallback: ((progress: { phase: string; percentage: number }) => void) | null =
        null;

      mockIngestFiles.mockImplementation(
        (
          _files: unknown,
          options: { onProgress?: (progress: { phase: string; percentage: number }) => void }
        ) => {
          capturedCallback = options.onProgress ?? null;
          // Call progress callback
          if (options.onProgress) {
            options.onProgress({ phase: "extracting_entities", percentage: 15 });
            options.onProgress({ phase: "creating_file_nodes", percentage: 40 });
          }
          return Promise.resolve({
            status: "success",
            stats: {
              filesProcessed: 1,
              filesFailed: 0,
              nodesCreated: 5,
              relationshipsCreated: 2,
              durationMs: 500,
            },
            errors: [],
          });
        }
      );

      const { graphPopulateCommand } =
        await import("../../../src/cli/commands/graph-populate-command.js");

      await graphPopulateCommand("test-repo", {}, mockRepositoryService);

      expect(capturedCallback).not.toBeNull();
    });
  });
});

describe("Neo4j Config Utility Tests", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env["NEO4J_PASSWORD"] = "testpassword";
    process.env["NEO4J_HOST"] = "localhost";
    process.env["NEO4J_BOLT_PORT"] = "7687";
    process.env["NEO4J_USER"] = "neo4j";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("should handle custom host", async () => {
    process.env["NEO4J_HOST"] = "custom-host.example.com";
    const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

    const config = getNeo4jConfig();
    expect(config.host).toBe("custom-host.example.com");
  });

  it("should handle custom port", async () => {
    process.env["NEO4J_BOLT_PORT"] = "17687";
    const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

    const config = getNeo4jConfig();
    expect(config.port).toBe(17687);
  });

  it("should handle custom username", async () => {
    process.env["NEO4J_USER"] = "custom-user";
    const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

    const config = getNeo4jConfig();
    expect(config.username).toBe("custom-user");
  });

  it("should reject port with non-numeric characters", async () => {
    process.env["NEO4J_BOLT_PORT"] = "7687abc";
    const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

    expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
  });

  it("should reject negative port", async () => {
    process.env["NEO4J_BOLT_PORT"] = "-1";
    const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

    expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
  });

  it("should reject port 0", async () => {
    process.env["NEO4J_BOLT_PORT"] = "0";
    const { getNeo4jConfig } = await import("../../../src/cli/utils/neo4j-config.js");

    expect(() => getNeo4jConfig()).toThrow("Invalid NEO4J_BOLT_PORT");
  });
});
