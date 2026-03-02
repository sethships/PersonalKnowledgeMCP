/**
 * Tests for trigger_incremental_update MCP tool - completeness fields
 *
 * Validates that completeness check results from the coordinator are
 * correctly surfaced in the MCP tool response.
 *
 * @module tests/mcp/tools/trigger-incremental-update-completeness
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import type { IncrementalUpdateCoordinator } from "../../../src/services/incremental-update-coordinator.js";
import type { CoordinatorResult } from "../../../src/services/incremental-update-coordinator-types.js";
import { createTriggerUpdateHandler } from "../../../src/mcp/tools/trigger-incremental-update.js";
import { MCPRateLimiter } from "../../../src/mcp/rate-limiter.js";
import { JobTracker } from "../../../src/mcp/job-tracker.js";
import { initializeLogger } from "../../../src/logging/index.js";

/**
 * Response interface for completeness-aware success response
 */
interface SyncSuccessResponse {
  success: true;
  repository: string;
  status: "updated" | "no_changes";
  files_added: number;
  files_modified: number;
  files_deleted: number;
  chunks_upserted: number;
  chunks_deleted: number;
  duration_ms: number;
  commit_sha?: string;
  commit_message?: string;
  completeness_status?: "complete" | "incomplete" | "error";
  completeness_indexed_files?: number;
  completeness_eligible_files?: number;
  completeness_missing_files?: number;
  completeness_divergence_percent?: number;
}

/**
 * Helper to extract JSON from MCP response
 */
function parseResponse(content: unknown): SyncSuccessResponse {
  const arr = content as Array<{ type: string; text: string }>;
  const first = arr[0];
  if (!first) throw new Error("Expected at least one content element");
  return JSON.parse(first.text) as SyncSuccessResponse;
}

describe("trigger_incremental_update - Completeness Fields", () => {
  const testRepo: RepositoryInfo = {
    name: "test-repo",
    url: "https://github.com/owner/test-repo.git",
    localPath: "/repos/test-repo",
    collectionName: "repo_test_repo",
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: "2024-12-01T00:00:00.000Z",
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts", ".js", ".md"],
    excludePatterns: ["node_modules/**", "dist/**"],
    lastIndexedCommitSha: "abc123",
  };

  let mockRepositoryService: RepositoryMetadataService;

  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });

    mockRepositoryService = {
      listRepositories: mock(async () => [testRepo]),
      getRepository: mock(async (name: string) => (name === "test-repo" ? testRepo : null)),
      updateRepository: mock(async () => {}),
      removeRepository: mock(async () => {}),
    };
  });

  it("should include completeness fields when present in coordinator result", async () => {
    const resultWithCompleteness: CoordinatorResult = {
      status: "updated",
      commitSha: "def456abc123",
      commitMessage: "feat: add new feature",
      stats: {
        filesAdded: 1,
        filesModified: 0,
        filesDeleted: 0,
        chunksUpserted: 5,
        chunksDeleted: 0,
        durationMs: 500,
      },
      errors: [],
      durationMs: 1000,
      completenessCheck: {
        status: "incomplete",
        indexedFileCount: 89,
        eligibleFileCount: 424,
        missingFileCount: 335,
        divergencePercent: 79,
        durationMs: 142,
      },
    };

    const mockCoordinator = {
      updateRepository: mock(async () => resultWithCompleteness),
    } as unknown as IncrementalUpdateCoordinator;

    const handler = createTriggerUpdateHandler({
      repositoryService: mockRepositoryService,
      updateCoordinator: mockCoordinator,
      rateLimiter: new MCPRateLimiter({ cooldownMs: 0 }),
      jobTracker: new JobTracker(),
    });

    const callResult = await handler({ repository: "test-repo" });

    expect(callResult.isError).toBe(false);
    const response = parseResponse(callResult.content);

    expect(response.completeness_status).toBe("incomplete");
    expect(response.completeness_indexed_files).toBe(89);
    expect(response.completeness_eligible_files).toBe(424);
    expect(response.completeness_missing_files).toBe(335);
    expect(response.completeness_divergence_percent).toBe(79);
  });

  it("should include completeness fields for complete status", async () => {
    const resultComplete: CoordinatorResult = {
      status: "no_changes",
      commitSha: "abc123",
      commitMessage: "existing commit",
      stats: {
        filesAdded: 0,
        filesModified: 0,
        filesDeleted: 0,
        chunksUpserted: 0,
        chunksDeleted: 0,
        durationMs: 0,
      },
      errors: [],
      durationMs: 200,
      completenessCheck: {
        status: "complete",
        indexedFileCount: 100,
        eligibleFileCount: 100,
        missingFileCount: 0,
        divergencePercent: 0,
        durationMs: 30,
      },
    };

    const mockCoordinator = {
      updateRepository: mock(async () => resultComplete),
    } as unknown as IncrementalUpdateCoordinator;

    const handler = createTriggerUpdateHandler({
      repositoryService: mockRepositoryService,
      updateCoordinator: mockCoordinator,
      rateLimiter: new MCPRateLimiter({ cooldownMs: 0 }),
      jobTracker: new JobTracker(),
    });

    const callResult = await handler({ repository: "test-repo" });

    expect(callResult.isError).toBe(false);
    const response = parseResponse(callResult.content);

    expect(response.completeness_status).toBe("complete");
    expect(response.completeness_indexed_files).toBe(100);
    expect(response.completeness_eligible_files).toBe(100);
    expect(response.completeness_missing_files).toBe(0);
    expect(response.completeness_divergence_percent).toBe(0);
  });

  it("should omit completeness fields when not present in coordinator result", async () => {
    const resultWithoutCompleteness: CoordinatorResult = {
      status: "updated",
      commitSha: "def456abc123",
      commitMessage: "feat: add feature",
      stats: {
        filesAdded: 1,
        filesModified: 0,
        filesDeleted: 0,
        chunksUpserted: 5,
        chunksDeleted: 0,
        durationMs: 500,
      },
      errors: [],
      durationMs: 1000,
      // No completenessCheck field
    };

    const mockCoordinator = {
      updateRepository: mock(async () => resultWithoutCompleteness),
    } as unknown as IncrementalUpdateCoordinator;

    const handler = createTriggerUpdateHandler({
      repositoryService: mockRepositoryService,
      updateCoordinator: mockCoordinator,
      rateLimiter: new MCPRateLimiter({ cooldownMs: 0 }),
      jobTracker: new JobTracker(),
    });

    const callResult = await handler({ repository: "test-repo" });

    expect(callResult.isError).toBe(false);
    const response = parseResponse(callResult.content);

    expect(response.completeness_status).toBeUndefined();
    expect(response.completeness_indexed_files).toBeUndefined();
    expect(response.completeness_eligible_files).toBeUndefined();
    expect(response.completeness_missing_files).toBeUndefined();
    expect(response.completeness_divergence_percent).toBeUndefined();
  });

  it("should include completeness error status when check failed", async () => {
    const resultWithError: CoordinatorResult = {
      status: "updated",
      commitSha: "def456abc123",
      commitMessage: "feat: add feature",
      stats: {
        filesAdded: 1,
        filesModified: 0,
        filesDeleted: 0,
        chunksUpserted: 5,
        chunksDeleted: 0,
        durationMs: 500,
      },
      errors: [],
      durationMs: 1000,
      completenessCheck: {
        status: "error",
        indexedFileCount: 100,
        eligibleFileCount: 0,
        missingFileCount: 0,
        divergencePercent: 0,
        durationMs: 10,
        errorMessage: "ENOENT: no such file or directory",
      },
    };

    const mockCoordinator = {
      updateRepository: mock(async () => resultWithError),
    } as unknown as IncrementalUpdateCoordinator;

    const handler = createTriggerUpdateHandler({
      repositoryService: mockRepositoryService,
      updateCoordinator: mockCoordinator,
      rateLimiter: new MCPRateLimiter({ cooldownMs: 0 }),
      jobTracker: new JobTracker(),
    });

    const callResult = await handler({ repository: "test-repo" });

    expect(callResult.isError).toBe(false);
    const response = parseResponse(callResult.content);

    expect(response.completeness_status).toBe("error");
    expect(response.completeness_indexed_files).toBe(100);
    expect(response.completeness_eligible_files).toBe(0);
  });
});
