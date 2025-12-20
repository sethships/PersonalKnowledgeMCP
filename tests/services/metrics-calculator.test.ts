/**
 * Unit tests for metrics calculator
 */

import { describe, it, expect } from "bun:test";
import type { RepositoryInfo, UpdateHistoryEntry } from "../../src/repositories/types.js";
import {
  calculateAggregateMetrics,
  calculateRepositoryMetrics,
  calculateTrendMetrics,
} from "../../src/services/metrics-calculator.js";

/**
 * Helper function to create a mock update history entry
 */
function createMockHistoryEntry(overrides?: Partial<UpdateHistoryEntry>): UpdateHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    previousCommit: "abc123def456abc123def456abc123def456abc1",
    newCommit: "def456abc123def456abc123def456abc123def4",
    filesAdded: 2,
    filesModified: 3,
    filesDeleted: 1,
    chunksUpserted: 15,
    chunksDeleted: 5,
    durationMs: 2000,
    errorCount: 0,
    status: "success",
    ...overrides,
  };
}

/**
 * Helper function to create a mock repository
 */
function createMockRepository(overrides?: Partial<RepositoryInfo>): RepositoryInfo {
  return {
    name: "test-repo",
    url: "https://github.com/test/repo.git",
    localPath: "/data/repos/test-repo",
    collectionName: "repo_test_repo",
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: new Date().toISOString(),
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts", ".js"],
    excludePatterns: ["node_modules/**"],
    updateHistory: [],
    ...overrides,
  };
}

describe("calculateAggregateMetrics", () => {
  it("should return zero metrics when no repositories provided", () => {
    const metrics = calculateAggregateMetrics([]);

    expect(metrics.totalUpdates).toBe(0);
    expect(metrics.averageDurationMs).toBe(0);
    expect(metrics.totalFilesProcessed).toBe(0);
    expect(metrics.totalChunksModified).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.successRate).toBe(0);
    expect(metrics.last7DaysTrend.updateCount).toBe(0);
  });

  it("should return zero metrics when repositories have no history", () => {
    const repos: RepositoryInfo[] = [
      createMockRepository({ name: "repo1" }),
      createMockRepository({ name: "repo2" }),
    ];

    const metrics = calculateAggregateMetrics(repos);

    expect(metrics.totalUpdates).toBe(0);
    expect(metrics.averageDurationMs).toBe(0);
    expect(metrics.totalFilesProcessed).toBe(0);
    expect(metrics.totalChunksModified).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.successRate).toBe(0);
  });

  it("should calculate metrics from single repository", () => {
    const history: UpdateHistoryEntry[] = [
      createMockHistoryEntry({ filesAdded: 2, filesModified: 3, filesDeleted: 1, durationMs: 1000 }),
      createMockHistoryEntry({ filesAdded: 1, filesModified: 2, filesDeleted: 0, durationMs: 2000 }),
    ];

    const repos: RepositoryInfo[] = [createMockRepository({ updateHistory: history })];

    const metrics = calculateAggregateMetrics(repos);

    expect(metrics.totalUpdates).toBe(2);
    expect(metrics.averageDurationMs).toBe(1500); // (1000 + 2000) / 2
    expect(metrics.totalFilesProcessed).toBe(9); // (2+3+1) + (1+2+0)
    expect(metrics.totalChunksModified).toBe(40); // (15+5) + (15+5)
    expect(metrics.successRate).toBe(1.0); // 2 success / 2 total
    expect(metrics.errorRate).toBe(0.0);
  });

  it("should calculate metrics across multiple repositories", () => {
    const history1: UpdateHistoryEntry[] = [
      createMockHistoryEntry({ durationMs: 1000, status: "success" }),
    ];

    const history2: UpdateHistoryEntry[] = [
      createMockHistoryEntry({ durationMs: 2000, status: "partial" }),
      createMockHistoryEntry({ durationMs: 3000, status: "failed" }),
    ];

    const repos: RepositoryInfo[] = [
      createMockRepository({ name: "repo1", updateHistory: history1 }),
      createMockRepository({ name: "repo2", updateHistory: history2 }),
    ];

    const metrics = calculateAggregateMetrics(repos);

    expect(metrics.totalUpdates).toBe(3);
    expect(metrics.averageDurationMs).toBe(2000); // (1000 + 2000 + 3000) / 3
    expect(metrics.successRate).toBeCloseTo(0.333, 2); // 1 success / 3 total
    expect(metrics.errorRate).toBeCloseTo(0.667, 2); // 2 errors / 3 total
  });

  it("should calculate correct error rate with mixed statuses", () => {
    const history: UpdateHistoryEntry[] = [
      createMockHistoryEntry({ status: "success" }),
      createMockHistoryEntry({ status: "success" }),
      createMockHistoryEntry({ status: "success" }),
      createMockHistoryEntry({ status: "partial" }),
      createMockHistoryEntry({ status: "failed" }),
    ];

    const repos: RepositoryInfo[] = [createMockRepository({ updateHistory: history })];

    const metrics = calculateAggregateMetrics(repos);

    expect(metrics.totalUpdates).toBe(5);
    expect(metrics.successRate).toBe(0.6); // 3 / 5
    expect(metrics.errorRate).toBe(0.4); // 2 / 5
  });
});

describe("calculateRepositoryMetrics", () => {
  it("should return zero metrics when repository has no history", () => {
    const repo = createMockRepository({ updateHistory: [] });

    const metrics = calculateRepositoryMetrics(repo);

    expect(metrics.repositoryName).toBe("test-repo");
    expect(metrics.totalUpdates).toBe(0);
    expect(metrics.averageDurationMs).toBe(0);
    expect(metrics.totalFilesProcessed).toBe(0);
    expect(metrics.totalChunksModified).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.successRate).toBe(0);
  });

  it("should calculate metrics for repository with history", () => {
    const history: UpdateHistoryEntry[] = [
      createMockHistoryEntry({
        filesAdded: 5,
        filesModified: 10,
        filesDeleted: 2,
        chunksUpserted: 50,
        chunksDeleted: 10,
        durationMs: 3000,
        status: "success",
      }),
      createMockHistoryEntry({
        filesAdded: 1,
        filesModified: 3,
        filesDeleted: 0,
        chunksUpserted: 20,
        chunksDeleted: 5,
        durationMs: 1000,
        status: "partial",
      }),
    ];

    const repo = createMockRepository({ updateHistory: history });

    const metrics = calculateRepositoryMetrics(repo);

    expect(metrics.repositoryName).toBe("test-repo");
    expect(metrics.totalUpdates).toBe(2);
    expect(metrics.averageDurationMs).toBe(2000); // (3000 + 1000) / 2
    expect(metrics.totalFilesProcessed).toBe(21); // (5+10+2) + (1+3+0)
    expect(metrics.totalChunksModified).toBe(85); // (50+10) + (20+5)
    expect(metrics.successRate).toBe(0.5); // 1 / 2
    expect(metrics.errorRate).toBe(0.5); // 1 / 2
  });
});

describe("calculateTrendMetrics", () => {
  it("should return zero metrics when no history provided", () => {
    const metrics = calculateTrendMetrics([], 7);

    expect(metrics.updateCount).toBe(0);
    expect(metrics.filesProcessed).toBe(0);
    expect(metrics.chunksModified).toBe(0);
    expect(metrics.averageDurationMs).toBe(0);
    expect(metrics.errorRate).toBe(0);
  });

  it("should return zero metrics when all history is outside time range", () => {
    // Create history from 30 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);

    const history: UpdateHistoryEntry[] = [
      createMockHistoryEntry({ timestamp: oldDate.toISOString() }),
    ];

    const metrics = calculateTrendMetrics(history, 7);

    expect(metrics.updateCount).toBe(0);
    expect(metrics.filesProcessed).toBe(0);
    expect(metrics.chunksModified).toBe(0);
  });

  it("should filter to recent history within time range", () => {
    const now = new Date();

    // Create history: 2 recent (within 7 days), 1 old (10 days ago)
    const recentDate1 = new Date(now);
    recentDate1.setDate(recentDate1.getDate() - 2);

    const recentDate2 = new Date(now);
    recentDate2.setDate(recentDate2.getDate() - 5);

    const oldDate = new Date(now);
    oldDate.setDate(oldDate.getDate() - 10);

    const history: UpdateHistoryEntry[] = [
      createMockHistoryEntry({
        timestamp: recentDate1.toISOString(),
        filesAdded: 2,
        filesModified: 1,
        filesDeleted: 0,
        chunksUpserted: 10,
        chunksDeleted: 2,
        durationMs: 1000,
        status: "success",
      }),
      createMockHistoryEntry({
        timestamp: recentDate2.toISOString(),
        filesAdded: 1,
        filesModified: 2,
        filesDeleted: 1,
        chunksUpserted: 15,
        chunksDeleted: 5,
        durationMs: 2000,
        status: "failed",
      }),
      createMockHistoryEntry({
        timestamp: oldDate.toISOString(),
        filesAdded: 10,
        filesModified: 10,
        filesDeleted: 10,
        chunksUpserted: 100,
        chunksDeleted: 50,
        durationMs: 5000,
        status: "success",
      }),
    ];

    const metrics = calculateTrendMetrics(history, 7);

    expect(metrics.updateCount).toBe(2); // Only 2 recent entries
    expect(metrics.filesProcessed).toBe(7); // (2+1+0) + (1+2+1), excluding old entry
    expect(metrics.chunksModified).toBe(32); // (10+2) + (15+5), excluding old entry
    expect(metrics.averageDurationMs).toBe(1500); // (1000 + 2000) / 2
    expect(metrics.errorRate).toBe(0.5); // 1 failed / 2 total
  });

  it("should calculate correct error rate for trend", () => {
    const now = new Date();
    const recentDate = new Date(now);
    recentDate.setDate(recentDate.getDate() - 3);

    const history: UpdateHistoryEntry[] = [
      createMockHistoryEntry({ timestamp: recentDate.toISOString(), status: "success" }),
      createMockHistoryEntry({ timestamp: recentDate.toISOString(), status: "success" }),
      createMockHistoryEntry({ timestamp: recentDate.toISOString(), status: "success" }),
      createMockHistoryEntry({ timestamp: recentDate.toISOString(), status: "partial" }),
    ];

    const metrics = calculateTrendMetrics(history, 7);

    expect(metrics.updateCount).toBe(4);
    expect(metrics.errorRate).toBe(0.25); // 1 error / 4 total
  });
});
