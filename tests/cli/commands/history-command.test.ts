/**
 * Tests for History Command
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeEach, vi, type Mock } from "bun:test";
import {
  historyCommand,
  type HistoryCommandOptions,
} from "../../../src/cli/commands/history-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { RepositoryInfo, UpdateHistoryEntry } from "../../../src/repositories/types.js";

describe("History Command", () => {
  let mockDeps: CliDependencies;
  let mockGetRepository: Mock<() => Promise<RepositoryInfo | null>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;

  const mockHistoryEntry: UpdateHistoryEntry = {
    timestamp: "2024-12-15T15:30:00.000Z",
    previousCommit: "abc123def456abc123def456abc123def456abc1",
    newCommit: "def456abc123def456abc123def456abc123def4",
    filesAdded: 2,
    filesModified: 3,
    filesDeleted: 1,
    chunksUpserted: 15,
    chunksDeleted: 8,
    durationMs: 2340,
    errorCount: 0,
    status: "success" as const,
  };

  const mockRepositoryInfo: RepositoryInfo = {
    name: "test-repo",
    url: "https://github.com/test/test-repo.git",
    collectionName: "test-repo",
    localPath: "/tmp/test-repo",
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: "2024-12-15T15:30:00.000Z",
    lastIndexedCommitSha: "def456abc123def456abc123def456abc123def4",
    indexDurationMs: 5000,
    status: "ready" as const,
    branch: "main",
    includeExtensions: [],
    excludePatterns: [],
    updateHistory: [mockHistoryEntry],
  };

  beforeEach(() => {
    mockGetRepository = vi.fn();

    // Create or reset console.log spy
    if (consoleLogSpy) {
      consoleLogSpy.mockClear();
    } else {
      consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    }

    mockDeps = {
      repositoryService: {
        getRepository: mockGetRepository,
      },
    } as unknown as CliDependencies;
  });

  describe("Basic history display", () => {
    it("should display history table for repository with history", async () => {
      mockGetRepository.mockResolvedValue(mockRepositoryInfo);

      const options: HistoryCommandOptions = { limit: 10 };
      await historyCommand("test-repo", options, mockDeps);

      expect(mockGetRepository).toHaveBeenCalledWith("test-repo");
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("Update History for");
      expect(output).toContain("test-repo");
    });

    it("should display empty history message for repository without history", async () => {
      const repoWithoutHistory: RepositoryInfo = {
        ...mockRepositoryInfo,
        updateHistory: [],
      };
      mockGetRepository.mockResolvedValue(repoWithoutHistory);

      const options: HistoryCommandOptions = { limit: 10 };
      await historyCommand("test-repo", options, mockDeps);

      expect(mockGetRepository).toHaveBeenCalledWith("test-repo");
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("No update history found");
      expect(output).toContain("test-repo");
      expect(output).toContain("Repository status:");
    });

    it("should handle repository with undefined updateHistory field", async () => {
      const repoWithoutHistoryField: RepositoryInfo = {
        ...mockRepositoryInfo,
        updateHistory: undefined,
      };
      mockGetRepository.mockResolvedValue(repoWithoutHistoryField);

      const options: HistoryCommandOptions = { limit: 10 };
      await historyCommand("test-repo", options, mockDeps);

      expect(mockGetRepository).toHaveBeenCalledWith("test-repo");
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("No update history found");
    });
  });

  describe("Limit option", () => {
    it("should respect limit option", async () => {
      const multipleEntries: UpdateHistoryEntry[] = Array.from({ length: 15 }, (_, i) => ({
        ...mockHistoryEntry,
        timestamp: `2024-12-15T15:${30 + i}:00.000Z`,
      }));

      const repoWithManyEntries: RepositoryInfo = {
        ...mockRepositoryInfo,
        updateHistory: multipleEntries,
      };

      mockGetRepository.mockResolvedValue(repoWithManyEntries);

      const options: HistoryCommandOptions = { limit: 5 };
      await historyCommand("test-repo", options, mockDeps);

      expect(mockGetRepository).toHaveBeenCalledWith("test-repo");
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("5 entries");
    });

    it("should show all entries when limit exceeds history length", async () => {
      mockGetRepository.mockResolvedValue(mockRepositoryInfo);

      const options: HistoryCommandOptions = { limit: 100 };
      await historyCommand("test-repo", options, mockDeps);

      expect(mockGetRepository).toHaveBeenCalledWith("test-repo");
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("1 entry");
    });
  });

  describe("JSON output", () => {
    it("should output JSON when json flag is set", async () => {
      mockGetRepository.mockResolvedValue(mockRepositoryInfo);

      const options: HistoryCommandOptions = { limit: 10, json: true };
      await historyCommand("test-repo", options, mockDeps);

      expect(mockGetRepository).toHaveBeenCalledWith("test-repo");
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);

      expect(parsed.repository).toBe("test-repo");
      expect(parsed.totalEntries).toBe(1);
      expect(parsed.repositoryInfo).toBeDefined();
      expect(parsed.history).toHaveLength(1);
      expect(parsed.history[0]?.timestamp).toBe(mockHistoryEntry.timestamp);
    });

    it("should include all history fields in JSON output", async () => {
      mockGetRepository.mockResolvedValue(mockRepositoryInfo);

      const options: HistoryCommandOptions = { limit: 10, json: true };
      await historyCommand("test-repo", options, mockDeps);

      const output = consoleLogSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      const historyEntry = parsed.history[0];

      expect(historyEntry.timestamp).toBe(mockHistoryEntry.timestamp);
      expect(historyEntry.previousCommit).toBe(mockHistoryEntry.previousCommit);
      expect(historyEntry.newCommit).toBe(mockHistoryEntry.newCommit);
      expect(historyEntry.files.added).toBe(mockHistoryEntry.filesAdded);
      expect(historyEntry.files.modified).toBe(mockHistoryEntry.filesModified);
      expect(historyEntry.files.deleted).toBe(mockHistoryEntry.filesDeleted);
      expect(historyEntry.chunks.upserted).toBe(mockHistoryEntry.chunksUpserted);
      expect(historyEntry.chunks.deleted).toBe(mockHistoryEntry.chunksDeleted);
      expect(historyEntry.durationMs).toBe(mockHistoryEntry.durationMs);
      expect(historyEntry.errorCount).toBe(mockHistoryEntry.errorCount);
      expect(historyEntry.status).toBe(mockHistoryEntry.status);
    });
  });

  describe("Error handling", () => {
    it("should throw error for non-existent repository", async () => {
      mockGetRepository.mockResolvedValue(null);

      const options: HistoryCommandOptions = { limit: 10 };

      await expect(historyCommand("non-existent-repo", options, mockDeps)).rejects.toThrow(
        "Repository 'non-existent-repo' not found"
      );

      expect(mockGetRepository).toHaveBeenCalledWith("non-existent-repo");
    });

    it("should include helpful message in error for non-existent repository", async () => {
      mockGetRepository.mockResolvedValue(null);

      const options: HistoryCommandOptions = { limit: 10 };

      try {
        await historyCommand("non-existent-repo", options, mockDeps);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("pk-mcp status");
      }
    });
  });

  describe("Different status types", () => {
    it("should display partial status correctly", async () => {
      const partialEntry: UpdateHistoryEntry = {
        ...mockHistoryEntry,
        status: "partial" as const,
        errorCount: 3,
      };

      const repoWithPartial: RepositoryInfo = {
        ...mockRepositoryInfo,
        updateHistory: [partialEntry],
      };

      mockGetRepository.mockResolvedValue(repoWithPartial);

      const options: HistoryCommandOptions = { limit: 10 };
      await historyCommand("test-repo", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalled();
      // Table output should contain the status indicator
    });

    it("should display failed status correctly", async () => {
      const failedEntry: UpdateHistoryEntry = {
        ...mockHistoryEntry,
        status: "failed" as const,
        errorCount: 10,
      };

      const repoWithFailed: RepositoryInfo = {
        ...mockRepositoryInfo,
        updateHistory: [failedEntry],
      };

      mockGetRepository.mockResolvedValue(repoWithFailed);

      const options: HistoryCommandOptions = { limit: 10 };
      await historyCommand("test-repo", options, mockDeps);

      expect(consoleLogSpy).toHaveBeenCalled();
      // Table output should contain the status indicator
    });
  });
});
