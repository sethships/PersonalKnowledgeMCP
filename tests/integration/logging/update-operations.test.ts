/**
 * Integration Tests for Update Operations Logging
 *
 * Tests correlation ID propagation, structured logging, and traceability
 * across the incremental update workflow.
 *
 * @module tests/integration/logging/update-operations
 */

/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { IncrementalUpdateCoordinator } from "../../../src/services/incremental-update-coordinator.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import { createLogCapture } from "../../helpers/log-capture.js";
import type {
  GitHubClient,
  CommitInfo,
  CommitComparison,
} from "../../../src/services/github-client-types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import type { IncrementalUpdatePipeline } from "../../../src/services/incremental-update-pipeline.js";
import type {
  UpdateResult,
  UpdateOptions,
} from "../../../src/services/incremental-update-types.js";

describe("Update Operations Logging Integration", () => {
  let coordinator: IncrementalUpdateCoordinator;
  let mockGitHubClient: GitHubClient;
  let mockRepositoryService: RepositoryMetadataService;
  let mockUpdatePipeline: IncrementalUpdatePipeline;
  let logCapture: ReturnType<typeof createLogCapture>;

  // Test fixture: Repository metadata
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
    lastIndexedCommitSha: "abc123def456abc123def456abc123def456abc1",
    lastIncrementalUpdateAt: "2024-12-01T00:00:00.000Z",
    incrementalUpdateCount: 0,
  };

  // Test fixture: HEAD commit
  const headCommit: CommitInfo = {
    sha: "def456abc123def456abc123def456abc123def4",
    message: "feat: add new feature",
    author: "Test Author",
    date: "2024-12-02T00:00:00.000Z",
  };

  // Test fixture: Commit comparison
  const comparison: CommitComparison = {
    baseSha: "abc123def456abc123def456abc123def456abc1",
    headSha: "def456abc123def456abc123def456abc123def4",
    totalCommits: 5,
    files: [
      { path: "src/new.ts", status: "added" },
      { path: "src/updated.ts", status: "modified" },
      { path: "src/old.ts", status: "deleted" },
    ],
  };

  beforeEach(() => {
    // Create log capture
    logCapture = createLogCapture();

    // Initialize logger with custom stream for log capture
    initializeLogger({
      level: "debug",
      format: "json",
      stream: logCapture.stream,
    });

    // Create mock GitHub client with rate limit info
    mockGitHubClient = {
      getHeadCommit: mock(async (_owner, _repo, _branch, _correlationId) => headCommit),
      compareCommits: mock(async (_owner, _repo, _base, _head, _correlationId) => comparison),
      healthCheck: mock(async () => true),
    };

    // Create mock repository service
    mockRepositoryService = {
      listRepositories: mock(async () => [testRepo]),
      getRepository: mock(async (name) => (name === "test-repo" ? testRepo : null)),
      updateRepository: mock(async (_repo) => {}),
      removeRepository: mock(async (_name) => {}),
    };

    // Create mock update pipeline
    const mockPipelineResult: UpdateResult = {
      stats: {
        filesAdded: 1,
        filesModified: 1,
        filesDeleted: 1,
        chunksUpserted: 15,
        chunksDeleted: 5,
        durationMs: 1500,
      },
      errors: [],
    };
    mockUpdatePipeline = {
      processChanges: mock(async (_changes, _options) => mockPipelineResult),
    } as unknown as IncrementalUpdatePipeline;

    // Create coordinator with mocked git pull
    coordinator = new IncrementalUpdateCoordinator(
      mockGitHubClient,
      mockRepositoryService,
      mockUpdatePipeline,
      {
        customGitPull: mock(async (_localPath: string, _branch: string) => {
          // No-op for tests
        }),
      }
    );
  });

  afterEach(() => {
    resetLogger();
    logCapture.clear();
  });

  describe("Correlation ID Propagation", () => {
    it("should generate correlation ID with correct format", async () => {
      await coordinator.updateRepository("test-repo");

      // Get all logs
      const allLogs = logCapture.getAll();
      expect(allLogs.length).toBeGreaterThan(0);

      // Find coordinator start log to extract correlation ID
      const coordinatorStartLog = logCapture.find(
        (log) =>
          log.component === "services:incremental-update-coordinator" &&
          log.msg === "Starting incremental update"
      );

      expect(coordinatorStartLog).toBeDefined();
      expect(coordinatorStartLog?.correlationId).toBeDefined();

      const correlationId = coordinatorStartLog?.correlationId as string;

      // Verify correlation ID format: update-{timestamp}-{shortHash}
      expect(correlationId).toMatch(/^update-\d{10}-[0-9a-f]{5}$/);
    });

    it("should pass correlation ID to GitHub client operations", async () => {
      await coordinator.updateRepository("test-repo");

      // Verify GitHub client methods were called with correlation ID
      expect(mockGitHubClient.getHeadCommit).toHaveBeenCalled();
      expect(mockGitHubClient.compareCommits).toHaveBeenCalled();

      // Extract correlation ID from getHeadCommit call
      const getHeadCommitCalls = (mockGitHubClient.getHeadCommit as ReturnType<typeof mock>).mock
        .calls;
      const correlationIdArg = getHeadCommitCalls[0]?.[3] as string | undefined; // 4th parameter
      expect(correlationIdArg).toBeDefined();
      expect(typeof correlationIdArg).toBe("string");
      expect(correlationIdArg).toMatch(/^update-\d{10}-[0-9a-f]{5}$/);

      // Verify same correlation ID passed to compareCommits
      const compareCommitsCalls = (mockGitHubClient.compareCommits as ReturnType<typeof mock>).mock
        .calls;
      const compareCorrelationId = compareCommitsCalls[0]?.[4] as string | undefined; // 5th parameter
      expect(compareCorrelationId).toBe(correlationIdArg);
    });

    it("should pass correlation ID to pipeline operations", async () => {
      await coordinator.updateRepository("test-repo");

      // Verify pipeline was called
      expect(mockUpdatePipeline.processChanges).toHaveBeenCalled();

      // Extract options from pipeline call
      const pipelineCalls = (mockUpdatePipeline.processChanges as ReturnType<typeof mock>).mock
        .calls;
      const options = pipelineCalls[0]?.[1] as UpdateOptions | undefined; // 2nd parameter (UpdateOptions)
      expect(options).toBeDefined();

      // Verify correlationId is in options
      expect(options?.correlationId).toBeDefined();
      expect(typeof options?.correlationId).toBe("string");
      expect(options?.correlationId).toMatch(/^update-\d{10}-[0-9a-f]{5}$/);
    });

    it("should generate unique correlation IDs for different updates", async () => {
      // First update
      await coordinator.updateRepository("test-repo");
      const firstLogs = logCapture.getAll();
      const firstCorrelationId = firstLogs.find((log) => log.correlationId)
        ?.correlationId as string;
      expect(firstCorrelationId).toBeDefined();

      // Clear logs
      logCapture.clear();

      // Reset mocks to allow second update
      const newHeadCommit: CommitInfo = {
        ...headCommit,
        sha: "new123abc456new123abc456new123abc456new1",
      };
      mockGitHubClient.getHeadCommit = mock(
        async (_owner, _repo, _branch, _correlationId) => newHeadCommit
      );

      const newComparison: CommitComparison = {
        ...comparison,
        headSha: newHeadCommit.sha,
      };
      mockGitHubClient.compareCommits = mock(
        async (_owner, _repo, _base, _head, _correlationId) => newComparison
      );

      const repoAfterFirstUpdate: RepositoryInfo = {
        ...testRepo,
        lastIndexedCommitSha: headCommit.sha,
      };
      mockRepositoryService.getRepository = mock(async () => repoAfterFirstUpdate);

      // Second update
      await coordinator.updateRepository("test-repo");
      const secondLogs = logCapture.getAll();
      const secondCorrelationId = secondLogs.find((log) => log.correlationId)
        ?.correlationId as string;

      // Correlation IDs should be different
      expect(secondCorrelationId).toBeDefined();
      expect(secondCorrelationId).not.toBe(firstCorrelationId);
    });
  });

  describe("Structured Logging Fields", () => {
    it("should include correlation ID in coordinator logs", async () => {
      await coordinator.updateRepository("test-repo");

      // Get coordinator logs
      const coordinatorLogs = logCapture.getByComponent("services:incremental-update-coordinator");
      expect(coordinatorLogs.length).toBeGreaterThan(0);

      // Extract correlation ID
      const correlationId = coordinatorLogs.find((log) => log.correlationId)
        ?.correlationId as string;
      expect(correlationId).toBeDefined();

      // All coordinator logs should have the same correlation ID
      coordinatorLogs.forEach((log) => {
        if (log.correlationId) {
          expect(log.correlationId).toBe(correlationId);
        }
      });
    });

    it("should include repository context in logs", async () => {
      await coordinator.updateRepository("test-repo");

      // Get coordinator logs
      const coordinatorLogs = logCapture.getByComponent("services:incremental-update-coordinator");

      // Most logs should include repository name
      const logsWithRepo = coordinatorLogs.filter((log) => log.repository === "test-repo");
      expect(logsWithRepo.length).toBeGreaterThan(0);
    });

    it("should include metric log for completion", async () => {
      const result = await coordinator.updateRepository("test-repo");
      expect(result.status).toBe("updated");

      // Find metric log
      const metricLog = logCapture.find((log) => log.metric === "incremental_update_duration_ms");

      expect(metricLog).toBeDefined();
      expect(metricLog?.value).toBeDefined();
      expect(typeof metricLog?.value).toBe("number");
      expect(metricLog?.repository).toBe("test-repo");
      expect(metricLog?.status).toBe("updated");
    });

    it("should include stats in coordinator completion log", async () => {
      await coordinator.updateRepository("test-repo");

      // Find coordinator completion log
      const completionLog = logCapture.find(
        (log) =>
          log.component === "services:incremental-update-coordinator" &&
          log.msg === "Pipeline processing completed"
      );

      expect(completionLog).toBeDefined();
      expect(completionLog?.filesAdded).toBe(1);
      expect(completionLog?.filesModified).toBe(1);
      expect(completionLog?.filesDeleted).toBe(1);
      expect(completionLog?.chunksUpserted).toBe(15);
      expect(completionLog?.chunksDeleted).toBe(5);
    });
  });

  describe("Error Logging", () => {
    it("should include error field in coordinator error logs", async () => {
      // Mock GitHub client to throw error
      const testError = new Error("GitHub API error");
      mockGitHubClient.getHeadCommit = mock(async (_owner, _repo, _branch, _correlationId) => {
        throw testError;
      });

      // Expect the error to be thrown
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(coordinator.updateRepository("test-repo")).rejects.toThrow(testError);

      // Get error logs from coordinator
      const errorLogs = logCapture
        .getByComponent("services:incremental-update-coordinator")
        .filter((log) => log.level === "error");

      expect(errorLogs.length).toBeGreaterThan(0);

      // Find coordinator error log
      const coordinatorErrorLog = errorLogs.find((log) => log.msg === "Incremental update failed");

      expect(coordinatorErrorLog).toBeDefined();
      expect(coordinatorErrorLog?.error).toBeDefined();
      expect(coordinatorErrorLog?.correlationId).toBeDefined();
      expect(coordinatorErrorLog?.repository).toBe("test-repo");
    });
  });

  describe("Complete Update Trace", () => {
    it("should produce traceable logs with correlation ID", async () => {
      const result = await coordinator.updateRepository("test-repo");
      expect(result.status).toBe("updated");

      // Get all logs
      const allLogs = logCapture.getAll();

      // Extract correlation ID
      const logWithCorrelationId = allLogs.find((log) => log.correlationId);
      const correlationId = logWithCorrelationId?.correlationId as string;
      expect(correlationId).toBeDefined();

      // Get all logs for this update using correlation ID
      const updateLogs = logCapture.getByCorrelationId(correlationId);
      expect(updateLogs.length).toBeGreaterThan(3); // Should have multiple log entries

      // Verify coordinator is present
      const components = new Set(updateLogs.map((log) => log.component));
      expect(components).toContain("services:incremental-update-coordinator");

      // Verify key messages are present
      const messages = updateLogs.map((log) => log.msg);
      expect(messages).toContain("Starting incremental update");
      expect(messages).toContain("Incremental update completed");

      // All logs should have the same correlation ID
      updateLogs.forEach((log) => {
        expect(log.correlationId).toBe(correlationId);
      });
    });

    it("should include complete workflow phases in logs", async () => {
      await coordinator.updateRepository("test-repo");

      const coordinatorLogs = logCapture.getByComponent("services:incremental-update-coordinator");

      // Verify key workflow phases are logged
      const messages = coordinatorLogs.map((log) => log.msg);

      expect(messages).toContain("Starting incremental update");
      expect(messages).toContain("Repository metadata loaded");
      expect(messages).toContain("Fetched HEAD commit from GitHub");
      expect(messages).toContain("Compared commits");
      expect(messages).toContain("Updated local clone");
      expect(messages).toContain("Pipeline processing completed");
      expect(messages).toContain("Incremental update completed");
    });
  });
});
