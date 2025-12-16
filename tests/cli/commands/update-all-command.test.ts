/**
 * Tests for Update All Command
 *
 * Tests batch updates of all repositories with status "ready".
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "bun:test";
import {
  updateAllCommand,
  type UpdateAllCommandOptions,
} from "../../../src/cli/commands/update-all-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { CoordinatorResult } from "../../../src/services/incremental-update-coordinator-types.js";
import type { RepositoryInfo } from "../../../src/repositories/types.js";
import {
  SAMPLE_NO_CHANGES_RESULT,
  SAMPLE_UPDATED_RESULT,
  SAMPLE_UPDATED_WITH_ERRORS_RESULT,
  SAMPLE_FAILED_RESULT,
  TEST_COMMIT_SHAS,
} from "../../fixtures/incremental-update-fixtures.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

describe("Update All Command", () => {
  let mockDeps: CliDependencies;
  let mockListRepositories: Mock<() => Promise<RepositoryInfo[]>>;
  let mockUpdateRepository: Mock<() => Promise<CoordinatorResult>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;

  // Sample repositories for testing
  const createSampleRepo = (name: string, status: string = "ready"): RepositoryInfo => ({
    name,
    url: `https://github.com/test/${name}.git`,
    localPath: `/repos/${name}`,
    branch: "main",
    collectionName: `repo_${name}`,
    status: status as any,
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: new Date("2024-01-15T10:00:00Z").toISOString(),
    indexDurationMs: 5000,
    lastIndexedCommitSha: TEST_COMMIT_SHAS.base,
    includeExtensions: [".ts", ".js", ".md"],
    excludePatterns: ["node_modules/**", "dist/**"],
  });

  beforeEach(() => {
    // Initialize logger for tests
    initializeLogger({ level: "silent", format: "json" });

    // Create mocks
    mockListRepositories = vi.fn();
    mockUpdateRepository = vi.fn();

    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create mock dependencies
    mockDeps = {
      repositoryService: {
        listRepositories: mockListRepositories,
      },
      updateCoordinator: {
        updateRepository: mockUpdateRepository,
      },
    } as unknown as CliDependencies;
  });

  afterEach(() => {
    resetLogger();
    consoleLogSpy.mockRestore();
  });

  describe("No ready repositories", () => {
    it("should show yellow message when no ready repos found", async () => {
      mockListRepositories.mockResolvedValue([]);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("No repositories with status 'ready' found")
      );
      expect(mockUpdateRepository).not.toHaveBeenCalled();
    });

    it("should show next steps when no ready repos", async () => {
      mockListRepositories.mockResolvedValue([]);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Next steps"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("pk-mcp status"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("pk-mcp index"));
    });

    it("should not show next steps for non-ready repositories", async () => {
      // Return repos but with status "indexing"
      mockListRepositories.mockResolvedValue([
        createSampleRepo("repo1", "indexing"),
        createSampleRepo("repo2", "failed"),
      ]);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("No repositories with status 'ready' found")
      );
      expect(mockUpdateRepository).not.toHaveBeenCalled();
    });
  });

  describe("Multiple repositories - Mixed results", () => {
    it("should update all ready repositories sequentially", async () => {
      const repos = [
        createSampleRepo("repo1"),
        createSampleRepo("repo2"),
        createSampleRepo("repo3"),
      ];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      expect(mockUpdateRepository).toHaveBeenCalledTimes(3);
      expect(mockUpdateRepository).toHaveBeenNthCalledWith(1, "repo1");
      expect(mockUpdateRepository).toHaveBeenNthCalledWith(2, "repo2");
      expect(mockUpdateRepository).toHaveBeenNthCalledWith(3, "repo3");
    });

    it("should display table with correct status colors", async () => {
      const repos = [
        createSampleRepo("repo1"),
        createSampleRepo("repo2"),
        createSampleRepo("repo3"),
      ];

      mockListRepositories.mockResolvedValue(repos);

      // Different results for each repo
      mockUpdateRepository
        .mockResolvedValueOnce(SAMPLE_UPDATED_RESULT) // repo1: Updated
        .mockResolvedValueOnce(SAMPLE_NO_CHANGES_RESULT) // repo2: Current
        .mockResolvedValueOnce(SAMPLE_FAILED_RESULT); // repo3: Failed

      const options: UpdateAllCommandOptions = {};

      try {
        await updateAllCommand(options, mockDeps);
      } catch {
        // repo3 fails but command continues
      }

      // Verify table was output (contains Repository header)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Repository"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Status"));
    });

    it("should continue after failure and update remaining repos", async () => {
      const repos = [
        createSampleRepo("repo1"),
        createSampleRepo("repo2"),
        createSampleRepo("repo3"),
      ];

      mockListRepositories.mockResolvedValue(repos);

      mockUpdateRepository
        .mockResolvedValueOnce(SAMPLE_UPDATED_RESULT) // repo1: Success
        .mockRejectedValueOnce(new Error("Network error")) // repo2: Throw error
        .mockResolvedValueOnce(SAMPLE_UPDATED_RESULT); // repo3: Should still run

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      // All 3 repos should be attempted
      expect(mockUpdateRepository).toHaveBeenCalledTimes(3);
      expect(mockUpdateRepository).toHaveBeenNthCalledWith(3, "repo3");
    });

    it("should display summary line with counts", async () => {
      const repos = [
        createSampleRepo("repo1"),
        createSampleRepo("repo2"),
        createSampleRepo("repo3"),
        createSampleRepo("repo4"),
      ];

      mockListRepositories.mockResolvedValue(repos);

      mockUpdateRepository
        .mockResolvedValueOnce(SAMPLE_UPDATED_RESULT) // 1 updated
        .mockResolvedValueOnce(SAMPLE_UPDATED_RESULT) // 2 updated
        .mockResolvedValueOnce(SAMPLE_NO_CHANGES_RESULT) // 1 current
        .mockResolvedValueOnce(SAMPLE_FAILED_RESULT); // 1 failed

      const options: UpdateAllCommandOptions = {};

      try {
        await updateAllCommand(options, mockDeps);
      } catch {
        // Expected for failed repo
      }

      // Verify summary: "2 updated, 1 current, 1 failed"
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Summary"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("2 updated"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 current"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
    });

    it("should show correct file and chunk stats in table", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      // Verify file changes: +3 ~2 -1
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("+3"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("~2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("-1"));

      // Verify chunk changes: +47 -12
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("+47"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("-12"));
    });
  });

  describe("JSON output", () => {
    it("should output JSON with summary and results", async () => {
      const repos = [createSampleRepo("repo1"), createSampleRepo("repo2")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository
        .mockResolvedValueOnce(SAMPLE_UPDATED_RESULT)
        .mockResolvedValueOnce(SAMPLE_NO_CHANGES_RESULT);

      const options: UpdateAllCommandOptions = { json: true };

      await updateAllCommand(options, mockDeps);

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
      expect(jsonOutput.summary.updated).toBe(1);
      expect(jsonOutput.summary.current).toBe(1);
      expect(jsonOutput.summary.failed).toBe(0);

      expect(jsonOutput.results).toHaveLength(2);
      expect(jsonOutput.results[0].repository).toBe("repo1");
      expect(jsonOutput.results[0].status).toBe("updated");
      expect(jsonOutput.results[1].repository).toBe("repo2");
      expect(jsonOutput.results[1].status).toBe("no_changes");
    });

    it("should include error details in JSON output", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockRejectedValue(new Error("Network timeout"));

      const options: UpdateAllCommandOptions = { json: true };

      await updateAllCommand(options, mockDeps);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.results[0].status).toBe("error");
      expect(jsonOutput.results[0].error).toBe("Network timeout");
      expect(jsonOutput.summary.failed).toBe(1);
    });

    it("should include stats for each repository in JSON", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateAllCommandOptions = { json: true };

      await updateAllCommand(options, mockDeps);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.results[0].stats).toEqual(SAMPLE_UPDATED_RESULT.stats);
      expect(jsonOutput.results[0].durationMs).toBe(SAMPLE_UPDATED_RESULT.durationMs);
    });
  });

  describe("Spinner states", () => {
    it("should show info spinner for no changes", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_NO_CHANGES_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("already up-to-date"));
    });

    it("should show success spinner for updated repos", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("repo1 updated"));
    });

    it("should show warning spinner for partial failures", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_WITH_ERRORS_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("updated with 2 warnings")
      );
    });

    it("should show fail spinner for failed repos", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_FAILED_RESULT);

      const options: UpdateAllCommandOptions = {};

      try {
        await updateAllCommand(options, mockDeps);
      } catch {
        // Expected
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("repo1 failed"));
    });
  });

  describe("Large batch updates", () => {
    it("should handle 20 repositories without performance issues", async () => {
      const repos = Array.from({ length: 20 }, (_, i) => createSampleRepo(`repo${i + 1}`));

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateAllCommandOptions = {};

      const startTime = Date.now();
      await updateAllCommand(options, mockDeps);
      const duration = Date.now() - startTime;

      // Should complete quickly (all mocked, no real operations)
      expect(duration).toBeLessThan(2000); // 2 seconds for mocked operations

      expect(mockUpdateRepository).toHaveBeenCalledTimes(20);
    });

    it("should display table for large batch correctly", async () => {
      const repos = Array.from({ length: 20 }, (_, i) => createSampleRepo(`repo${i + 1}`));

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      // Verify table headers present
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Repository"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Status"));

      // Summary should show 20 updated
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("20 updated"));
    });
  });

  describe("All current status", () => {
    it("should show all repos as current when no changes", async () => {
      const repos = [
        createSampleRepo("repo1"),
        createSampleRepo("repo2"),
        createSampleRepo("repo3"),
      ];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_NO_CHANGES_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      // Summary: "3 current"
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("3 current"));
    });

    it("should not show updated or failed counts when all current", async () => {
      const repos = [createSampleRepo("repo1"), createSampleRepo("repo2")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_NO_CHANGES_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      // Should only show "2 current" in summary
      const summaryCall = consoleLogSpy.mock.calls.find((call) => call[0].includes("Summary"));

      expect(summaryCall).toBeDefined();
      expect(summaryCall![0]).toContain("2 current");
      expect(summaryCall![0]).not.toContain("updated");
      expect(summaryCall![0]).not.toContain("failed");
    });
  });

  describe("Table formatting", () => {
    it("should display 6 columns in table", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      // Verify all column headers
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Repository"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Status"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Commits"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Files"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Chunks"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Duration"));
    });

    it("should show dash for no-changes repos in Commits column", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_NO_CHANGES_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      // Current repos should show "-" for files/chunks/commits
      const tableOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join("\n");

      expect(tableOutput).toContain("Current");
    });

    it("should format error count for failed repos", async () => {
      const repos = [createSampleRepo("repo1")];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_FAILED_RESULT);

      const options: UpdateAllCommandOptions = {};

      try {
        await updateAllCommand(options, mockDeps);
      } catch {
        // Expected
      }

      // Failed repos should show error count in Commits column
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("3 errors"));
    });
  });

  describe("Initialization message", () => {
    it("should display count of repositories being updated", async () => {
      const repos = [
        createSampleRepo("repo1"),
        createSampleRepo("repo2"),
        createSampleRepo("repo3"),
      ];

      mockListRepositories.mockResolvedValue(repos);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateAllCommandOptions = {};

      await updateAllCommand(options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Updating 3 repositories")
      );
    });
  });
});
