/**
 * Tests for Graph Populate All Command
 *
 * Tests batch graph population for all indexed repositories with status "ready".
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-floating-promises */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "bun:test";
import { graphPopulateAllCommand } from "../../src/cli/commands/graph-populate-all-command.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import type { GraphIngestionResult, GraphIngestionStats } from "../../src/graph/ingestion/types.js";
import { RepositoryExistsError } from "../../src/graph/ingestion/errors.js";
import { createTestRepositoryInfo } from "../fixtures/repository-fixtures.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

// Mock modules
vi.mock("../../src/graph/Neo4jClient.js", () => ({
  Neo4jStorageClientImpl: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../src/graph/extraction/EntityExtractor.js", () => ({
  EntityExtractor: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../src/graph/extraction/RelationshipExtractor.js", () => ({
  RelationshipExtractor: vi.fn().mockImplementation(() => ({})),
}));

// NOTE: We intentionally do NOT mock neo4j-config.js here.
// Mocking it causes vi.mock() pollution that breaks unit tests for getNeo4jConfig
// in other test files (even with vi.resetModules()). Instead, we set up the
// required environment variables in beforeEach to let the real function work.

// Mock fs/promises for file system operations
vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue("export function test() {}"),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
}));

// Mock GraphIngestionService
const mockIngestFiles = vi.fn();
vi.mock("../../src/graph/ingestion/GraphIngestionService.js", () => ({
  GraphIngestionService: vi.fn().mockImplementation(() => ({
    ingestFiles: mockIngestFiles,
  })),
}));

describe("Graph Populate All Command", () => {
  let mockRepositoryService: RepositoryMetadataService;
  let mockListRepositories: Mock<() => Promise<RepositoryInfo[]>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;
  let consoleErrorSpy: Mock<(...args: any[]) => void>;

  // Sample ingestion results
  const createSuccessResult = (
    repository: string,
    overrides?: Partial<GraphIngestionStats>
  ): GraphIngestionResult => ({
    status: "success",
    repository,
    stats: {
      filesProcessed: 50,
      filesFailed: 0,
      nodesCreated: 234,
      relationshipsCreated: 567,
      durationMs: 12500,
      nodesByType: {
        repository: 1,
        file: 50,
        function: 120,
        class: 15,
        module: 48,
      },
      relationshipsByType: {
        contains: 170,
        defines: 135,
        imports: 262,
      },
      ...overrides,
    },
    errors: [],
    completedAt: new Date(),
  });

  const createPartialResult = (repository: string): GraphIngestionResult => ({
    status: "partial",
    repository,
    stats: {
      filesProcessed: 45,
      filesFailed: 5,
      nodesCreated: 200,
      relationshipsCreated: 450,
      durationMs: 10000,
    },
    errors: [{ type: "file_error", filePath: "broken.ts", message: "Parse error" }],
    completedAt: new Date(),
  });

  const createFailedResult = (repository: string): GraphIngestionResult => ({
    status: "failed",
    repository,
    stats: {
      filesProcessed: 0,
      filesFailed: 0,
      nodesCreated: 0,
      relationshipsCreated: 0,
      durationMs: 500,
    },
    errors: [{ type: "fatal_error", message: "Neo4j connection lost" }],
    completedAt: new Date(),
  });

  // Create sample repository with localPath
  const createRepoWithLocalPath = (
    name: string,
    status: string = "ready",
    localPath?: string
  ): RepositoryInfo => {
    return createTestRepositoryInfo(name, {
      status: status as any,
      localPath: localPath ?? `/repos/${name}`,
    });
  };

  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    // Save original environment and set up Neo4j config env vars
    // (required since we don't mock neo4j-config.js to avoid vi.mock pollution)
    originalEnv = { ...process.env };
    process.env["NEO4J_PASSWORD"] = "testpassword";
    process.env["NEO4J_HOST"] = "localhost";
    process.env["NEO4J_BOLT_PORT"] = "7687";
    process.env["NEO4J_USER"] = "neo4j";

    // Initialize logger for tests
    initializeLogger({ level: "silent", format: "json" });

    // Reset mocks
    vi.clearAllMocks();
    mockIngestFiles.mockReset();

    // Create mocks
    mockListRepositories = vi.fn();

    // Spy on console
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Create mock repository service
    mockRepositoryService = {
      listRepositories: mockListRepositories,
      getRepository: vi.fn(),
      saveRepository: vi.fn(),
      updateRepository: vi.fn(),
      deleteRepository: vi.fn(),
    } as unknown as RepositoryMetadataService;

    // Default mock for fs stat (verify local path exists)
    const { stat } = await import("fs/promises");
    (stat as Mock<any>).mockResolvedValue({ isDirectory: () => true });
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    resetLogger();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("No eligible repositories", () => {
    it("should show message when no ready repos found", async () => {
      mockListRepositories.mockResolvedValue([]);

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("No repositories with status 'ready' found")
      );
      expect(mockIngestFiles).not.toHaveBeenCalled();
    });

    it("should show next steps when no ready repos", async () => {
      mockListRepositories.mockResolvedValue([]);

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Next steps"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("pk-mcp status"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("pk-mcp index"));
    });

    it("should not process non-ready repositories", async () => {
      mockListRepositories.mockResolvedValue([
        createRepoWithLocalPath("repo1", "indexing"),
        createRepoWithLocalPath("repo2", "error"),
      ]);

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("No repositories with status 'ready' found")
      );
      expect(mockIngestFiles).not.toHaveBeenCalled();
    });

    it("should output empty JSON when no repos and --json flag", async () => {
      mockListRepositories.mockResolvedValue([]);

      await graphPopulateAllCommand({ json: true }, mockRepositoryService);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCalls.length).toBeGreaterThan(0);
      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.summary.total).toBe(0);
      expect(jsonOutput.results).toHaveLength(0);
    });
  });

  describe("Single repository", () => {
    it("should populate a single repository successfully", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      // Mock file system with test files
      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo1"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(mockIngestFiles).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Summary"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 populated"));
    });

    it("should handle repository ingestion failure", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createFailedResult("repo1"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
    });

    it("should skip repository without localPath", async () => {
      const repo = createTestRepositoryInfo("repo1", {
        status: "ready",
        localPath: undefined,
      });
      mockListRepositories.mockResolvedValue([repo]);

      await graphPopulateAllCommand({}, mockRepositoryService);

      // Should fail during validation (no localPath)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
    });

    it("should skip repository with existing graph data (no --force)", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockRejectedValue(new RepositoryExistsError("repo1"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 skipped"));
    });

    it("should repopulate with --force flag", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo1"));

      await graphPopulateAllCommand({ force: true }, mockRepositoryService);

      expect(mockIngestFiles).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ force: true })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 populated"));
    });
  });

  describe("Multiple repositories - Mixed results", () => {
    it("should process all repositories sequentially", async () => {
      const repos = [
        createRepoWithLocalPath("repo1"),
        createRepoWithLocalPath("repo2"),
        createRepoWithLocalPath("repo3"),
      ];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(mockIngestFiles).toHaveBeenCalledTimes(3);
    });

    it("should continue after individual repository failure", async () => {
      const repos = [
        createRepoWithLocalPath("repo1"),
        createRepoWithLocalPath("repo2"),
        createRepoWithLocalPath("repo3"),
      ];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles
        .mockResolvedValueOnce(createSuccessResult("repo1"))
        .mockRejectedValueOnce(new Error("Connection error"))
        .mockResolvedValueOnce(createSuccessResult("repo3"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(mockIngestFiles).toHaveBeenCalledTimes(3);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("2 populated"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
    });

    it("should display correct summary counts", async () => {
      const repos = [
        createRepoWithLocalPath("repo1"),
        createRepoWithLocalPath("repo2"),
        createRepoWithLocalPath("repo3"),
        createRepoWithLocalPath("repo4"),
      ];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles
        .mockResolvedValueOnce(createSuccessResult("repo1"))
        .mockResolvedValueOnce(createPartialResult("repo2"))
        .mockRejectedValueOnce(new RepositoryExistsError("repo3"))
        .mockResolvedValueOnce(createFailedResult("repo4"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Summary"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 populated"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 partial"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 skipped"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
    });
  });

  describe("JSON output", () => {
    it("should output JSON with summary and results", async () => {
      const repos = [createRepoWithLocalPath("repo1"), createRepoWithLocalPath("repo2")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles
        .mockResolvedValueOnce(createSuccessResult("repo1"))
        .mockResolvedValueOnce(createPartialResult("repo2"));

      await graphPopulateAllCommand({ json: true }, mockRepositoryService);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonCalls.length).toBeGreaterThan(0);

      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.summary).toBeDefined();
      expect(jsonOutput.summary.total).toBe(2);
      expect(jsonOutput.summary.success).toBe(1);
      expect(jsonOutput.summary.partial).toBe(1);

      expect(jsonOutput.results).toHaveLength(2);
      expect(jsonOutput.results[0].repository).toBe("repo1");
      expect(jsonOutput.results[0].status).toBe("success");
      expect(jsonOutput.results[0].stats).toBeDefined();
    });

    it("should include error details in JSON output", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockRejectedValue(new Error("Connection timeout"));

      await graphPopulateAllCommand({ json: true }, mockRepositoryService);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.results[0].status).toBe("failed");
      expect(jsonOutput.results[0].error).toBe("Connection timeout");
      expect(jsonOutput.summary.failed).toBe(1);
    });

    it("should include stats for successful repositories", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      const successResult = createSuccessResult("repo1");
      mockIngestFiles.mockResolvedValue(successResult);

      await graphPopulateAllCommand({ json: true }, mockRepositoryService);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.results[0].stats.nodesCreated).toBe(234);
      expect(jsonOutput.results[0].stats.relationshipsCreated).toBe(567);
      expect(jsonOutput.results[0].durationMs).toBeDefined();
    });
  });

  describe("Table output", () => {
    it("should display table with correct columns", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo1"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      // Verify column headers
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Repository"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Status"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Nodes"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Relationships"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Duration"));
    });

    it("should show Success status for successful repos", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo1"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Success"));
    });

    it("should show Skipped status for already-populated repos", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockRejectedValue(new RepositoryExistsError("repo1"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Skipped"));
    });

    it("should show Failed status for failed repos", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createFailedResult("repo1"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Failed"));
    });
  });

  describe("Initialization message", () => {
    it("should display count of repositories being populated", async () => {
      const repos = [
        createRepoWithLocalPath("repo1"),
        createRepoWithLocalPath("repo2"),
        createRepoWithLocalPath("repo3"),
      ];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Populating 3 repositories")
      );
    });
  });

  describe("Force flag behavior", () => {
    it("should skip existing without --force", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockRejectedValue(new RepositoryExistsError("repo1"));

      await graphPopulateAllCommand({ force: false }, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 skipped"));
    });

    it("should pass force flag to ingestion service", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo1"));

      await graphPopulateAllCommand({ force: true }, mockRepositoryService);

      expect(mockIngestFiles).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ force: true })
      );
    });
  });

  describe("Large batch handling", () => {
    it("should handle 10 repositories without issues", async () => {
      const repos = Array.from({ length: 10 }, (_, i) => createRepoWithLocalPath(`repo${i + 1}`));
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo"));

      const startTime = Date.now();
      await graphPopulateAllCommand({}, mockRepositoryService);
      const duration = Date.now() - startTime;

      // Should complete quickly (all mocked)
      expect(duration).toBeLessThan(5000);
      expect(mockIngestFiles).toHaveBeenCalledTimes(10);
    });

    it("should display summary for large batch", async () => {
      const repos = Array.from({ length: 10 }, (_, i) => createRepoWithLocalPath(`repo${i + 1}`));
      mockListRepositories.mockResolvedValue(repos);

      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ]);

      mockIngestFiles.mockResolvedValue(createSuccessResult("repo"));

      await graphPopulateAllCommand({}, mockRepositoryService);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("10 populated"));
    });
  });

  describe("Files without supported extensions", () => {
    it("should skip repository with no supported files", async () => {
      const repos = [createRepoWithLocalPath("repo1")];
      mockListRepositories.mockResolvedValue(repos);

      // Return directory entries with no supported extensions
      const { readdir } = await import("fs/promises");
      (readdir as Mock<any>).mockResolvedValue([
        { name: "readme.md", isDirectory: () => false, isFile: () => true },
        { name: "config.json", isDirectory: () => false, isFile: () => true },
      ]);

      await graphPopulateAllCommand({}, mockRepositoryService);

      // Should be skipped due to no supported files
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 skipped"));
      expect(mockIngestFiles).not.toHaveBeenCalled();
    });
  });
});
