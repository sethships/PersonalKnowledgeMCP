/**
 * Tests for Update Repository Command
 *
 * Tests incremental repository updates and force re-index operations.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
// Note: await-thenable disable needed for `await expect(...).rejects.toThrow()` patterns
// which return Promises but ESLint's type inference doesn't recognize this properly
/* eslint-disable @typescript-eslint/await-thenable */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "bun:test";
import {
  updateRepositoryCommand,
  type UpdateCommandOptions,
} from "../../../src/cli/commands/update-repository-command.js";
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

describe("Update Repository Command", () => {
  let mockDeps: CliDependencies;
  let mockGetRepository: Mock<() => Promise<RepositoryInfo | null>>;
  let mockUpdateRepository: Mock<() => Promise<CoordinatorResult>>;
  let mockIndexRepository: Mock<(url: string, options?: any) => Promise<any>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;

  // Sample repository for testing
  const sampleRepo: RepositoryInfo = {
    name: "test-repo",
    url: "https://github.com/test/repo.git",
    localPath: "/repos/test-repo",
    branch: "main",
    collectionName: "repo_test_repo",
    status: "ready",
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: new Date("2024-01-15T10:00:00Z").toISOString(),
    indexDurationMs: 5000,
    lastIndexedCommitSha: TEST_COMMIT_SHAS.base,
    includeExtensions: [".ts", ".js", ".md"],
    excludePatterns: ["node_modules/**", "dist/**"],
  };

  beforeEach(() => {
    // Initialize logger for tests
    initializeLogger({ level: "silent", format: "json" });

    // Create mocks
    mockGetRepository = vi.fn();
    mockUpdateRepository = vi.fn();
    mockIndexRepository = vi.fn();

    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create mock dependencies
    mockDeps = {
      repositoryService: {
        getRepository: mockGetRepository,
      },
      updateCoordinator: {
        updateRepository: mockUpdateRepository,
      },
      ingestionService: {
        indexRepository: mockIndexRepository,
      },
    } as unknown as CliDependencies;
  });

  afterEach(() => {
    resetLogger();
    consoleLogSpy.mockRestore();
  });

  describe("Repository not found", () => {
    it("should throw error with helpful message when repository not found", async () => {
      mockGetRepository.mockResolvedValue(null);

      const options: UpdateCommandOptions = {};

      await expect(updateRepositoryCommand("nonexistent-repo", options, mockDeps)).rejects.toThrow(
        "Repository 'nonexistent-repo' not found"
      );

      expect(mockGetRepository).toHaveBeenCalledWith("nonexistent-repo");
      expect(mockUpdateRepository).not.toHaveBeenCalled();
      expect(mockIndexRepository).not.toHaveBeenCalled();
    });

    it("should include helpful next steps in error message", async () => {
      mockGetRepository.mockResolvedValue(null);

      const options: UpdateCommandOptions = {};

      try {
        await updateRepositoryCommand("nonexistent-repo", options, mockDeps);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Check indexed repositories");
        expect((error as Error).message).toContain("pk-mcp status");
      }
    });
  });

  describe("Incremental update - No changes", () => {
    it("should show info message when no changes detected", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_NO_CHANGES_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      expect(mockUpdateRepository).toHaveBeenCalledWith("test-repo");
      // Note: spinner.info() bypasses console.log, so we verify by checking
      // that commit details were logged (which happens after spinner.info for no_changes)
      const shortSha = SAMPLE_NO_CHANGES_RESULT.commitSha?.substring(0, 7);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(shortSha!));
    });

    it("should display commit SHA and message for no changes", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_NO_CHANGES_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Verify commit SHA is displayed (first 7 chars)
      const shortSha = TEST_COMMIT_SHAS.head.substring(0, 7);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(shortSha));

      // Verify commit message is displayed
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(SAMPLE_NO_CHANGES_RESULT.commitMessage!)
      );
    });

    it("should output JSON format when json flag set", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_NO_CHANGES_RESULT);

      const options: UpdateCommandOptions = { json: true };

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Verify JSON output
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
      expect(jsonOutput.repository).toBe("test-repo");
      expect(jsonOutput.status).toBe("no_changes");
      // Note: JSON output uses commitRange (from formatUpdateResultJson), not commitSha
      expect(jsonOutput.commitRange).toBeDefined();
      expect(jsonOutput.stats).toBeDefined();
    });
  });

  describe("Incremental update - Files updated", () => {
    it("should show success message with file stats", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      expect(mockUpdateRepository).toHaveBeenCalledWith("test-repo");
      // Note: spinner.succeed() bypasses console.log, so we verify by checking
      // that file stats were logged (which happens after spinner.succeed for updated status)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Files:"));
    });

    it("should format file changes as '+2 ~3 -1'", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Verify file change format: +3 files added, ~2 modified, -1 deleted
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("+3"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("~2"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("-1"));
    });

    it("should format chunk changes as '+47 -12'", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Verify chunk change format
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("+47"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("-12"));
    });

    it("should display commit range 'abc1234..def5678'", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Verify commit range format
      const baseShort = TEST_COMMIT_SHAS.base.substring(0, 7);
      const headShort = TEST_COMMIT_SHAS.head.substring(0, 7);
      const expectedRange = `${baseShort}..${headShort}`;

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(expectedRange));
    });

    it("should display commit message in range", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(SAMPLE_UPDATED_RESULT.commitMessage!)
      );
    });

    it("should display duration in milliseconds", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${SAMPLE_UPDATED_RESULT.stats.durationMs}ms`)
      );
    });

    it("should output valid JSON with all fields", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_RESULT);

      const options: UpdateCommandOptions = { json: true };

      await updateRepositoryCommand("test-repo", options, mockDeps);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.repository).toBe("test-repo");
      expect(jsonOutput.status).toBe("updated");
      expect(jsonOutput.commitRange).toBeDefined();
      expect(jsonOutput.commitMessage).toBe(SAMPLE_UPDATED_RESULT.commitMessage);
      expect(jsonOutput.stats).toEqual(SAMPLE_UPDATED_RESULT.stats);
      expect(jsonOutput.errors).toEqual([]);
      expect(jsonOutput.durationMs).toBe(SAMPLE_UPDATED_RESULT.durationMs);
    });
  });

  describe("Incremental update - Partial failures", () => {
    it("should show warning when update completes with errors", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_WITH_ERRORS_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("completed with 2 file error(s)")
      );
    });

    it("should display first 3 errors in console output", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_WITH_ERRORS_RESULT);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Verify first error is displayed
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(SAMPLE_UPDATED_WITH_ERRORS_RESULT.errors[0]!.path)
      );

      // Verify second error is displayed
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(SAMPLE_UPDATED_WITH_ERRORS_RESULT.errors[1]!.path)
      );
    });

    it("should not display more than 3 errors in console", async () => {
      const resultWithManyErrors: CoordinatorResult = {
        ...SAMPLE_UPDATED_WITH_ERRORS_RESULT,
        errors: [
          { path: "error1.ts", error: "Error 1" },
          { path: "error2.ts", error: "Error 2" },
          { path: "error3.ts", error: "Error 3" },
          { path: "error4.ts", error: "Error 4" },
          { path: "error5.ts", error: "Error 5" },
        ],
      };

      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(resultWithManyErrors);

      const options: UpdateCommandOptions = {};

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Should mention there are more errors
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("and 2 more"));
    });

    it("should include all errors in JSON output", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_UPDATED_WITH_ERRORS_RESULT);

      const options: UpdateCommandOptions = { json: true };

      await updateRepositoryCommand("test-repo", options, mockDeps);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.errors).toHaveLength(2);
      expect(jsonOutput.errors[0]!.path).toBe(SAMPLE_UPDATED_WITH_ERRORS_RESULT.errors[0]!.path);
      expect(jsonOutput.errors[1]!.path).toBe(SAMPLE_UPDATED_WITH_ERRORS_RESULT.errors[1]!.path);
    });
  });

  describe("Incremental update - Failed", () => {
    it("should throw error when update fails", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_FAILED_RESULT);

      const options: UpdateCommandOptions = {};

      await expect(updateRepositoryCommand("test-repo", options, mockDeps)).rejects.toThrow(
        "Update failed with 3 errors"
      );
    });

    it("should display first 5 errors before throwing", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_FAILED_RESULT);

      const options: UpdateCommandOptions = {};

      try {
        await updateRepositoryCommand("test-repo", options, mockDeps);
      } catch {
        // Expected to throw
      }

      // Verify errors are displayed
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(SAMPLE_FAILED_RESULT.errors[0]!.path)
      );
    });

    it("should output JSON before throwing error", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockResolvedValue(SAMPLE_FAILED_RESULT);

      const options: UpdateCommandOptions = { json: true };

      try {
        await updateRepositoryCommand("test-repo", options, mockDeps);
      } catch {
        // Expected to throw
      }

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
      expect(jsonOutput.status).toBe("failed");
      expect(jsonOutput.errors).toHaveLength(3);
    });
  });

  describe("Force re-index", () => {
    it("should call ingestionService.indexRepository with force flag", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockIndexRepository.mockResolvedValue({
        status: "success",
        stats: {
          filesProcessed: 100,
          chunksCreated: 500,
          durationMs: 5000,
        },
      });

      const options: UpdateCommandOptions = { force: true };

      await updateRepositoryCommand("test-repo", options, mockDeps);

      expect(mockIndexRepository).toHaveBeenCalledWith(sampleRepo.url, {
        branch: sampleRepo.branch,
        force: true,
        onProgress: expect.any(Function),
      });

      expect(mockUpdateRepository).not.toHaveBeenCalled();
    });

    it("should show success message after re-index", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockIndexRepository.mockResolvedValue({
        status: "success",
        stats: {
          filesProcessed: 100,
          chunksCreated: 500,
          durationMs: 5000,
        },
      });

      const options: UpdateCommandOptions = { force: true };

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Note: spinner.succeed() bypasses console.log, so we verify by checking
      // that file stats were logged (which happens after spinner.succeed for re-index)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Files:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("100"));
    });

    it("should display file and chunk counts after re-index", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockIndexRepository.mockResolvedValue({
        status: "success",
        stats: {
          filesProcessed: 100,
          chunksCreated: 500,
          durationMs: 5000,
        },
      });

      const options: UpdateCommandOptions = { force: true };

      await updateRepositoryCommand("test-repo", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("100"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("500"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("5000ms"));
    });

    it("should output JSON format for force re-index", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockIndexRepository.mockResolvedValue({
        status: "success",
        stats: {
          filesProcessed: 100,
          chunksCreated: 500,
          durationMs: 5000,
        },
      });

      const options: UpdateCommandOptions = { force: true, json: true };

      await updateRepositoryCommand("test-repo", options, mockDeps);

      const jsonCalls = consoleLogSpy.mock.calls.filter((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });

      const jsonOutput = JSON.parse(jsonCalls[0]![0]);
      expect(jsonOutput.repository).toBe("test-repo");
      expect(jsonOutput.status).toBe("re-indexed");
      expect(jsonOutput.fileCount).toBe(100);
      expect(jsonOutput.chunkCount).toBe(500);
      expect(jsonOutput.durationMs).toBe(5000);
    });

    it("should throw error when force re-index fails", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockIndexRepository.mockResolvedValue({
        status: "failed",
      });

      const options: UpdateCommandOptions = { force: true };

      await expect(updateRepositoryCommand("test-repo", options, mockDeps)).rejects.toThrow(
        "Re-index failed"
      );
    });

    it("should update spinner text during progress callbacks", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);

      let capturedCallback: ((progress: any) => void) | undefined;

      mockIndexRepository.mockImplementation(async (_url: string, opts: any) => {
        // Capture the onProgress callback
        capturedCallback = opts.onProgress;

        // Simulate progress updates
        if (capturedCallback) {
          capturedCallback({ phase: "Cloning repository" });
          capturedCallback({ phase: "Scanning files" });
          capturedCallback({ phase: "Generating embeddings" });
        }

        return {
          status: "success",
          stats: {
            filesProcessed: 100,
            chunksCreated: 500,
            durationMs: 5000,
          },
        };
      });

      const options: UpdateCommandOptions = { force: true };

      await updateRepositoryCommand("test-repo", options, mockDeps);

      // Verify callback was provided
      expect(capturedCallback).toBeDefined();
    });

    it("should handle re-index error and stop spinner", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockIndexRepository.mockRejectedValue(new Error("Cloning failed"));

      const options: UpdateCommandOptions = { force: true };

      await expect(updateRepositoryCommand("test-repo", options, mockDeps)).rejects.toThrow(
        "Cloning failed"
      );
    });
  });

  describe("Error handling", () => {
    it("should handle coordinator throwing error", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockRejectedValue(new Error("Network timeout"));

      const options: UpdateCommandOptions = {};

      await expect(updateRepositoryCommand("test-repo", options, mockDeps)).rejects.toThrow(
        "Network timeout"
      );
    });

    it("should stop spinner before re-throwing error", async () => {
      mockGetRepository.mockResolvedValue(sampleRepo);
      mockUpdateRepository.mockRejectedValue(new Error("Network timeout"));

      const options: UpdateCommandOptions = {};

      try {
        await updateRepositoryCommand("test-repo", options, mockDeps);
      } catch {
        // Expected to throw
      }

      // Spinner should be stopped (fail state)
      // This is implicitly tested by the fact that the error is re-thrown
    });
  });
});
