/**
 * Tests for trigger_incremental_update MCP Tool
 *
 * Comprehensive test coverage for the tool handler and response formatter.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import type { IncrementalUpdateCoordinator } from "../../../src/services/incremental-update-coordinator.js";
import type { CoordinatorResult } from "../../../src/services/incremental-update-coordinator-types.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import {
  createTriggerUpdateHandler,
  triggerIncrementalUpdateToolDefinition,
} from "../../../src/mcp/tools/trigger-incremental-update.js";
import { MCPRateLimiter } from "../../../src/mcp/rate-limiter.js";
import { JobTracker } from "../../../src/mcp/job-tracker.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

/**
 * Response type interfaces for type-safe JSON parsing
 */
interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  retry_after_seconds?: number;
}

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
  // Graph statistics (present when graph service is configured)
  graph_nodes_created?: number;
  graph_nodes_deleted?: number;
  graph_relationships_created?: number;
  graph_relationships_deleted?: number;
  graph_files_processed?: number;
  graph_files_skipped?: number;
  graph_error_count?: number;
}

interface AsyncSuccessResponse {
  success: true;
  async: true;
  job_id: string;
  repository: string;
  message: string;
}

type TriggerUpdateResponse = ErrorResponse | SyncSuccessResponse | AsyncSuccessResponse;

/**
 * Type guard to check if value is TextContent
 */
function isTextContent(value: unknown): value is TextContent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value
  );
}

/**
 * Helper to safely extract text from MCP response content
 */
function getTextContent(content: unknown): string {
  if (Array.isArray(content) && content.length > 0 && isTextContent(content[0])) {
    return content[0].text;
  }
  throw new Error("Expected text content");
}

/**
 * Create mock repository info
 */
function createMockRepo(name: string): RepositoryInfo {
  return {
    name,
    url: `https://github.com/user/${name}.git`,
    localPath: `/data/repos/${name}`,
    collectionName: `repo_${name}`,
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: "2025-01-15T10:30:00.000Z",
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts", ".js"],
    excludePatterns: ["node_modules/**"],
  };
}

/**
 * Create mock CoordinatorResult
 */
function createMockResult(overrides?: Partial<CoordinatorResult>): CoordinatorResult {
  return {
    status: "updated",
    commitSha: "abc1234567890",
    commitMessage: "feat: test commit",
    stats: {
      filesAdded: 5,
      filesModified: 3,
      filesDeleted: 1,
      chunksUpserted: 20,
      chunksDeleted: 5,
      durationMs: 1500,
    },
    errors: [],
    durationMs: 1500,
    ...overrides,
  };
}

/**
 * Create mock CoordinatorResult with graph statistics
 */
function createMockResultWithGraphStats(overrides?: Partial<CoordinatorResult>): CoordinatorResult {
  return {
    status: "updated",
    commitSha: "abc1234567890",
    commitMessage: "feat: test commit with graph",
    stats: {
      filesAdded: 5,
      filesModified: 3,
      filesDeleted: 1,
      chunksUpserted: 20,
      chunksDeleted: 5,
      durationMs: 1500,
      graph: {
        graphNodesCreated: 50,
        graphNodesDeleted: 10,
        graphRelationshipsCreated: 75,
        graphRelationshipsDeleted: 5,
        graphFilesProcessed: 8,
        graphFilesSkipped: 2,
        graphErrors: [],
      },
    },
    errors: [],
    durationMs: 1500,
    ...overrides,
  };
}

describe("triggerIncrementalUpdateToolDefinition", () => {
  it("should have correct tool name", () => {
    expect(triggerIncrementalUpdateToolDefinition.name).toBe("trigger_incremental_update");
  });

  it("should have a description", () => {
    expect(triggerIncrementalUpdateToolDefinition.description).toBeTruthy();
    expect(triggerIncrementalUpdateToolDefinition.description!.length).toBeGreaterThan(0);
  });

  it("should require repository parameter", () => {
    expect(triggerIncrementalUpdateToolDefinition.inputSchema.required).toContain("repository");
  });

  it("should have optional async parameter", () => {
    const props = triggerIncrementalUpdateToolDefinition.inputSchema.properties as Record<
      string,
      unknown
    >;
    expect(props["async"]).toBeDefined();
    expect((props["async"] as { default?: boolean }).default).toBe(false);
  });
});

describe("createTriggerUpdateHandler", () => {
  let mockRepositoryService: RepositoryMetadataService;
  let mockUpdateCoordinator: IncrementalUpdateCoordinator;
  let rateLimiter: MCPRateLimiter;
  let jobTracker: JobTracker;
  let handler: ReturnType<typeof createTriggerUpdateHandler>;

  beforeEach(() => {
    try {
      initializeLogger({ level: "silent", format: "json" });
    } catch {
      // Logger already initialized
    }

    mockRepositoryService = {
      listRepositories: mock(() => Promise.resolve([])),
      getRepository: mock(() => Promise.resolve(createMockRepo("test-repo"))),
      updateRepository: mock(),
      removeRepository: mock(),
    };

    mockUpdateCoordinator = {
      updateRepository: mock(() => Promise.resolve(createMockResult())),
    } as unknown as IncrementalUpdateCoordinator;

    rateLimiter = new MCPRateLimiter({ cooldownMs: 5000 });
    jobTracker = new JobTracker({ maxJobAgeMs: 60000 });

    handler = createTriggerUpdateHandler({
      repositoryService: mockRepositoryService,
      updateCoordinator: mockUpdateCoordinator,
      rateLimiter,
      jobTracker,
    });
  });

  afterEach(() => {
    rateLimiter.clear();
    jobTracker.clear();
    resetLogger();
  });

  describe("argument validation", () => {
    it("should reject null arguments", async () => {
      const result = await handler(null);
      expect(result.isError).toBe(true);
      const text = getTextContent(result.content);
      expect(text).toContain("Arguments must be an object");
    });

    it("should reject missing repository", async () => {
      const result = await handler({});
      expect(result.isError).toBe(true);
      const text = getTextContent(result.content);
      expect(text).toContain("repository must be a non-empty string");
    });

    it("should reject empty repository", async () => {
      const result = await handler({ repository: "" });
      expect(result.isError).toBe(true);
      const text = getTextContent(result.content);
      expect(text).toContain("repository must be a non-empty string");
    });

    it("should trim repository whitespace", async () => {
      mockRepositoryService.getRepository = mock(() =>
        Promise.resolve(createMockRepo("test-repo"))
      );

      await handler({ repository: "  test-repo  " });

      expect(mockRepositoryService.getRepository).toHaveBeenCalledWith("test-repo");
    });
  });

  describe("repository validation", () => {
    it("should reject non-existent repository", async () => {
      mockRepositoryService.getRepository = mock(() => Promise.resolve(null));

      const result = await handler({ repository: "unknown-repo" });

      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content)) as TriggerUpdateResponse;
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.error).toBe("repository_not_found");
      }
    });
  });

  describe("rate limiting", () => {
    it("should block concurrent updates", async () => {
      rateLimiter.markInProgress("test-repo");

      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content)) as TriggerUpdateResponse;
      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.error).toBe("update_in_progress");
      }
    });

    it("should block updates during cooldown", async () => {
      // Simulate a completed update
      rateLimiter.markInProgress("test-repo");
      rateLimiter.markComplete("test-repo");

      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content)) as ErrorResponse;
      expect(response.error).toBe("rate_limited");
      expect(response.retry_after_seconds).toBeGreaterThan(0);
    });
  });

  describe("synchronous mode", () => {
    it("should execute update and return result", async () => {
      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content)) as SyncSuccessResponse;
      expect(response.success).toBe(true);
      expect(response.repository).toBe("test-repo");
      expect(response.status).toBe("updated");
      expect(response.files_added).toBe(5);
      expect(response.chunks_upserted).toBe(20);
    });

    it("should handle no_changes status", async () => {
      mockUpdateCoordinator.updateRepository = mock(() =>
        Promise.resolve(createMockResult({ status: "no_changes" }))
      );

      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content)) as SyncSuccessResponse;
      expect(response.success).toBe(true);
      expect(response.status).toBe("no_changes");
    });

    it("should handle failed status", async () => {
      mockUpdateCoordinator.updateRepository = mock(() =>
        Promise.resolve(
          createMockResult({
            status: "failed",
            errors: [{ path: "test.ts", error: "Parse error" }],
          })
        )
      );

      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content)) as ErrorResponse;
      expect(response.error).toBe("update_failed");
    });

    it("should truncate commit SHA", async () => {
      const result = await handler({ repository: "test-repo" });

      const response = JSON.parse(getTextContent(result.content)) as SyncSuccessResponse;
      expect(response.commit_sha).toBe("abc1234");
      expect(response.commit_sha?.length).toBe(7);
    });

    it("should mark complete in rate limiter", async () => {
      await handler({ repository: "test-repo" });

      // Next request should be rate limited
      const result = await handler({ repository: "test-repo" });
      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content)) as ErrorResponse;
      expect(response.error).toBe("rate_limited");
    });

    it("should include graph statistics when graph service is configured", async () => {
      mockUpdateCoordinator.updateRepository = mock(() =>
        Promise.resolve(createMockResultWithGraphStats())
      );

      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content)) as SyncSuccessResponse;
      expect(response.success).toBe(true);
      expect(response.graph_nodes_created).toBe(50);
      expect(response.graph_nodes_deleted).toBe(10);
      expect(response.graph_relationships_created).toBe(75);
      expect(response.graph_relationships_deleted).toBe(5);
      expect(response.graph_files_processed).toBe(8);
      expect(response.graph_files_skipped).toBe(2);
      expect(response.graph_error_count).toBe(0);
    });

    it("should not include graph statistics when graph service is not configured", async () => {
      // Default mock has no graph stats
      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content)) as SyncSuccessResponse;
      expect(response.success).toBe(true);
      expect(response.graph_nodes_created).toBeUndefined();
      expect(response.graph_relationships_created).toBeUndefined();
    });
  });

  describe("asynchronous mode", () => {
    it("should return job ID immediately", async () => {
      const result = await handler({ repository: "test-repo", async: true });

      expect(result.isError).toBe(false);
      const response = JSON.parse(getTextContent(result.content)) as AsyncSuccessResponse;
      expect(response.success).toBe(true);
      expect(response.async).toBe(true);
      expect(response.job_id).toBeDefined();
      expect(response.job_id).toMatch(/^update-/);
      expect(response.repository).toBe("test-repo");
    });

    it("should create job in tracker", async () => {
      const result = await handler({ repository: "test-repo", async: true });
      const response = JSON.parse(getTextContent(result.content)) as AsyncSuccessResponse;

      const job = jobTracker.getJob(response.job_id);
      expect(job).toBeDefined();
      expect(job!.repository).toBe("test-repo");
    });

    it("should return existing job ID if already running", async () => {
      // Start first async update
      const result1 = await handler({ repository: "test-repo", async: true });
      const response1 = JSON.parse(getTextContent(result1.content)) as AsyncSuccessResponse;

      // Second call should return same job ID
      const result2 = await handler({ repository: "test-repo", async: true });
      const response2 = JSON.parse(getTextContent(result2.content)) as AsyncSuccessResponse;

      expect(response2.job_id).toBe(response1.job_id);
    });
  });

  describe("error handling", () => {
    it("should handle coordinator errors", async () => {
      mockUpdateCoordinator.updateRepository = mock(() =>
        Promise.reject(new Error("Database connection failed"))
      );

      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content)) as ErrorResponse;
      expect(response.error).toBe("internal_error");
    });

    it("should handle timeout errors", async () => {
      mockUpdateCoordinator.updateRepository = mock(() =>
        Promise.reject(new Error("Update timed out after 10 minutes"))
      );

      const result = await handler({ repository: "test-repo" });

      expect(result.isError).toBe(true);
      const response = JSON.parse(getTextContent(result.content)) as ErrorResponse;
      expect(response.error).toBe("timeout");
    });
  });
});
