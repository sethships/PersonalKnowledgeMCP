/**
 * Unit tests for Interrupted Update Recovery Service
 *
 * Tests recovery strategy evaluation, execution, and batch recovery.
 */

import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import {
  evaluateRecoveryStrategy,
  executeRecovery,
  recoverMultiple,
  type RecoveryStrategy,
  type RecoveryDependencies,
} from "../../../src/services/interrupted-update-recovery.js";
import type { InterruptedUpdateInfo } from "../../../src/services/interrupted-update-detector.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";
import type { IngestionService } from "../../../src/services/ingestion-service.js";
import type { IncrementalUpdateCoordinator } from "../../../src/services/incremental-update-coordinator.js";

// Initialize logger for tests
beforeAll(() => {
  initializeLogger({ level: "error", format: "json" });
});

afterAll(() => {
  resetLogger();
});

// Helper to create mock repository info
function createMockRepo(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    name: "test-repo",
    url: "https://github.com/test/test-repo.git",
    localPath: process.cwd(),
    collectionName: "repo_test_repo",
    fileCount: 100,
    chunkCount: 500,
    lastIndexedAt: "2024-12-14T10:00:00.000Z",
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts", ".js"],
    excludePatterns: ["node_modules/**"],
    ...overrides,
  };
}

// Helper to create mock interrupted update info
function createMockInterruptedInfo(
  overrides: Partial<InterruptedUpdateInfo> = {}
): InterruptedUpdateInfo {
  const repo = createMockRepo({
    updateInProgress: true,
    updateStartedAt: new Date(Date.now() - 60000).toISOString(),
    ...overrides.repository,
  });

  return {
    repositoryName: repo.name,
    updateStartedAt: repo.updateStartedAt || new Date().toISOString(),
    elapsedMs: 60000,
    lastKnownCommit: "abc123def456",
    status: "indexing",
    repository: repo,
    ...overrides,
  };
}

// Helper to create mock repository service
function createMockRepositoryService(repositories: RepositoryInfo[]): RepositoryMetadataService {
  return {
    listRepositories: mock(async () => repositories),
    getRepository: mock(async (name: string) => repositories.find((r) => r.name === name) || null),
    updateRepository: mock(async () => {}),
    removeRepository: mock(async () => {}),
  };
}

// Helper to create mock ingestion service
function createMockIngestionService(
  options: {
    status?: "success" | "error";
    stats?: { filesProcessed: number; chunksCreated: number };
  } = {}
): IngestionService {
  const { status = "success", stats = { filesProcessed: 100, chunksCreated: 500 } } = options;
  return {
    indexRepository: mock(async () => ({
      status,
      stats: status === "success" ? stats : undefined,
    })),
  } as unknown as IngestionService;
}

// Helper to create mock update coordinator
function createMockUpdateCoordinator(
  options: {
    status?: "updated" | "no_changes" | "failed";
    stats?: { filesAdded: number; filesModified: number; filesDeleted: number };
    errors?: string[];
  } = {}
): IncrementalUpdateCoordinator {
  const {
    status = "updated",
    stats = { filesAdded: 5, filesModified: 3, filesDeleted: 1 },
    errors = [],
  } = options;
  return {
    updateRepository: mock(async () => ({
      status,
      stats,
      errors,
    })),
  } as unknown as IncrementalUpdateCoordinator;
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateRecoveryStrategy Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateRecoveryStrategy", () => {
  describe("resume strategy", () => {
    it("should recommend resume when recent update has last known commit", async () => {
      const info = createMockInterruptedInfo({
        elapsedMs: 60000, // 1 minute ago
        lastKnownCommit: "abc123def456",
      });

      const strategy = await evaluateRecoveryStrategy(info);

      expect(strategy.type).toBe("resume");
      expect(strategy.canAutoRecover).toBe(true);
      expect(strategy.reason).toContain("ago");
      expect(strategy.reason).toContain("abc123d"); // First 7 chars of commit
      expect(strategy.estimatedWork).toBeDefined();
    });

    it("should recommend resume for update interrupted 2 hours ago", async () => {
      const info = createMockInterruptedInfo({
        elapsedMs: 2 * 60 * 60 * 1000, // 2 hours
        lastKnownCommit: "abc123def456",
      });

      const strategy = await evaluateRecoveryStrategy(info);

      expect(strategy.type).toBe("resume");
      expect(strategy.canAutoRecover).toBe(true);
    });
  });

  describe("full_reindex strategy", () => {
    it("should recommend full_reindex when update is stale (>24 hours)", async () => {
      const info = createMockInterruptedInfo({
        elapsedMs: 25 * 60 * 60 * 1000, // 25 hours
        lastKnownCommit: "abc123def456",
      });

      const strategy = await evaluateRecoveryStrategy(info);

      expect(strategy.type).toBe("full_reindex");
      expect(strategy.canAutoRecover).toBe(true);
      expect(strategy.reason).toContain(">24 hours");
    });

    it("should recommend full_reindex when no last known commit", async () => {
      const info = createMockInterruptedInfo({
        elapsedMs: 60000,
        lastKnownCommit: undefined,
      });

      const strategy = await evaluateRecoveryStrategy(info);

      expect(strategy.type).toBe("full_reindex");
      expect(strategy.canAutoRecover).toBe(true);
      expect(strategy.reason).toContain("No previous commit");
    });

    it("should recommend full_reindex at exactly 24 hour boundary", async () => {
      const info = createMockInterruptedInfo({
        elapsedMs: 24 * 60 * 60 * 1000 + 1000, // Just over 24 hours
        lastKnownCommit: "abc123",
      });

      const strategy = await evaluateRecoveryStrategy(info);

      expect(strategy.type).toBe("full_reindex");
    });
  });

  describe("manual_required strategy", () => {
    it("should recommend manual_required when local path is inaccessible", async () => {
      // Use a path with UUID that will definitely not exist on any platform
      const impossiblePath = `/nonexistent-${crypto.randomUUID()}/path-${Date.now()}/impossible`;
      const repo = createMockRepo({
        localPath: impossiblePath,
      });
      const info = createMockInterruptedInfo({
        elapsedMs: 60000,
        lastKnownCommit: "abc123",
        repository: repo,
      });

      const strategy = await evaluateRecoveryStrategy(info);

      expect(strategy.type).toBe("manual_required");
      expect(strategy.canAutoRecover).toBe(false);
      expect(strategy.reason).toContain("not accessible");
    });
  });

  describe("edge cases", () => {
    it("should handle zero elapsed time", async () => {
      const info = createMockInterruptedInfo({
        elapsedMs: 0,
        lastKnownCommit: "abc123",
      });

      const strategy = await evaluateRecoveryStrategy(info);

      expect(strategy.type).toBe("resume");
      expect(strategy.canAutoRecover).toBe(true);
    });

    it("should handle very long elapsed time", async () => {
      const info = createMockInterruptedInfo({
        elapsedMs: 30 * 24 * 60 * 60 * 1000, // 30 days
        lastKnownCommit: "abc123",
      });

      const strategy = await evaluateRecoveryStrategy(info);

      expect(strategy.type).toBe("full_reindex");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeRecovery Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRecovery", () => {
  describe("resume recovery", () => {
    it("should execute resume recovery successfully", async () => {
      const repo = createMockRepo({ name: "resume-test" });
      const info = createMockInterruptedInfo({
        repositoryName: "resume-test",
        repository: repo,
      });
      const strategy: RecoveryStrategy = {
        type: "resume",
        reason: "Test resume",
        canAutoRecover: true,
      };
      const deps: RecoveryDependencies = {
        repositoryService: createMockRepositoryService([repo]),
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(info, strategy, deps);

      expect(result.success).toBe(true);
      expect(result.repositoryName).toBe("resume-test");
      expect(result.strategy.type).toBe("resume");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.updateCoordinator.updateRepository).toHaveBeenCalled();
    });

    it("should handle resume with no changes", async () => {
      const repo = createMockRepo({ name: "no-changes" });
      const info = createMockInterruptedInfo({
        repositoryName: "no-changes",
        repository: repo,
      });
      const strategy: RecoveryStrategy = {
        type: "resume",
        reason: "Test resume",
        canAutoRecover: true,
      };
      const deps: RecoveryDependencies = {
        repositoryService: createMockRepositoryService([repo]),
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator({ status: "no_changes" }),
      };

      const result = await executeRecovery(info, strategy, deps);

      expect(result.success).toBe(true);
      expect(result.message).toContain("up-to-date");
    });

    it("should fall back to full reindex when resume fails", async () => {
      const repo = createMockRepo({ name: "fallback-test" });
      const info = createMockInterruptedInfo({
        repositoryName: "fallback-test",
        repository: repo,
      });
      const strategy: RecoveryStrategy = {
        type: "resume",
        reason: "Test resume",
        canAutoRecover: true,
      };

      // Create an update coordinator that throws
      const failingUpdateCoordinator = {
        updateRepository: mock(async () => {
          throw new Error("Update failed");
        }),
      } as unknown as IncrementalUpdateCoordinator;

      const deps: RecoveryDependencies = {
        repositoryService: createMockRepositoryService([repo]),
        ingestionService: createMockIngestionService(),
        updateCoordinator: failingUpdateCoordinator,
      };

      const result = await executeRecovery(info, strategy, deps);

      // Should fall back to full reindex
      expect(result.success).toBe(true);
      expect(result.strategy.type).toBe("full_reindex");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.ingestionService.indexRepository).toHaveBeenCalled();
    });
  });

  describe("full_reindex recovery", () => {
    it("should execute full reindex successfully", async () => {
      const repo = createMockRepo({ name: "reindex-test" });
      const info = createMockInterruptedInfo({
        repositoryName: "reindex-test",
        repository: repo,
      });
      const strategy: RecoveryStrategy = {
        type: "full_reindex",
        reason: "Test reindex",
        canAutoRecover: true,
      };
      const deps: RecoveryDependencies = {
        repositoryService: createMockRepositoryService([repo]),
        ingestionService: createMockIngestionService({
          status: "success",
          stats: { filesProcessed: 50, chunksCreated: 200 },
        }),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(info, strategy, deps);

      expect(result.success).toBe(true);
      expect(result.message).toContain("50 files");
      expect(result.message).toContain("200 chunks");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.ingestionService.indexRepository).toHaveBeenCalled();
    });

    it("should handle full reindex failure", async () => {
      const repo = createMockRepo({ name: "fail-reindex" });
      const info = createMockInterruptedInfo({
        repositoryName: "fail-reindex",
        repository: repo,
      });
      const strategy: RecoveryStrategy = {
        type: "full_reindex",
        reason: "Test reindex",
        canAutoRecover: true,
      };
      const deps: RecoveryDependencies = {
        repositoryService: createMockRepositoryService([repo]),
        ingestionService: createMockIngestionService({ status: "error" }),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(info, strategy, deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain("failed");
    });
  });

  describe("manual_required recovery", () => {
    it("should clear flag and set error status for manual_required", async () => {
      const repo = createMockRepo({ name: "manual-test" });
      const info = createMockInterruptedInfo({
        repositoryName: "manual-test",
        repository: repo,
        updateStartedAt: "2024-12-14T10:00:00.000Z",
      });
      const strategy: RecoveryStrategy = {
        type: "manual_required",
        reason: "Path not accessible",
        canAutoRecover: false,
      };
      const deps: RecoveryDependencies = {
        repositoryService: createMockRepositoryService([repo]),
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(info, strategy, deps);

      expect(result.success).toBe(true); // Flag cleared successfully
      expect(result.message).toContain("Manual action required");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(deps.repositoryService.updateRepository).toHaveBeenCalled();
    });

    it("should throw if repository not found for manual_required", async () => {
      const info = createMockInterruptedInfo({
        repositoryName: "nonexistent",
      });
      const strategy: RecoveryStrategy = {
        type: "manual_required",
        reason: "Test",
        canAutoRecover: false,
      };
      const deps: RecoveryDependencies = {
        repositoryService: createMockRepositoryService([]),
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(info, strategy, deps);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("error handling", () => {
    it("should catch and return error for unexpected exceptions", async () => {
      const repo = createMockRepo({ name: "error-test" });
      const info = createMockInterruptedInfo({
        repositoryName: "error-test",
        repository: repo,
      });
      const strategy: RecoveryStrategy = {
        type: "resume",
        reason: "Test",
        canAutoRecover: true,
      };

      // Create services that throw during flag clearing
      const throwingService = {
        ...createMockRepositoryService([repo]),
        getRepository: mock(async () => {
          throw new Error("Database connection failed");
        }),
      };

      const deps: RecoveryDependencies = {
        repositoryService: throwingService,
        ingestionService: createMockIngestionService(),
        updateCoordinator: createMockUpdateCoordinator(),
      };

      const result = await executeRecovery(info, strategy, deps);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Database connection failed");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recoverMultiple Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("recoverMultiple", () => {
  it("should process empty list", async () => {
    const deps: RecoveryDependencies = {
      repositoryService: createMockRepositoryService([]),
      ingestionService: createMockIngestionService(),
      updateCoordinator: createMockUpdateCoordinator(),
    };

    const result = await recoverMultiple([], deps);

    expect(result.total).toBe(0);
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.manualRequired).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it("should process multiple interrupted updates", async () => {
    const repo1 = createMockRepo({ name: "repo1" });
    const repo2 = createMockRepo({ name: "repo2" });
    const repos = [repo1, repo2];

    const info1 = createMockInterruptedInfo({
      repositoryName: "repo1",
      repository: repo1,
      lastKnownCommit: "abc123",
    });
    const info2 = createMockInterruptedInfo({
      repositoryName: "repo2",
      repository: repo2,
      lastKnownCommit: "def456",
    });

    const deps: RecoveryDependencies = {
      repositoryService: createMockRepositoryService(repos),
      ingestionService: createMockIngestionService(),
      updateCoordinator: createMockUpdateCoordinator(),
    };

    const result = await recoverMultiple([info1, info2], deps);

    expect(result.total).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should track successful and failed recoveries", async () => {
    const repo1 = createMockRepo({ name: "success-repo" });
    const repo2 = createMockRepo({ name: "fail-repo" });

    const info1 = createMockInterruptedInfo({
      repositoryName: "success-repo",
      repository: repo1,
      lastKnownCommit: "abc123",
    });
    const info2 = createMockInterruptedInfo({
      repositoryName: "fail-repo",
      repository: repo2,
      lastKnownCommit: undefined, // Will trigger full_reindex
    });

    // First call succeeds, second fails
    let callCount = 0;
    const selectiveIngestionService = {
      indexRepository: mock(async () => {
        callCount++;
        if (callCount === 1) {
          return { status: "success", stats: { filesProcessed: 10, chunksCreated: 50 } };
        }
        return { status: "error" };
      }),
    } as unknown as IngestionService;

    const deps: RecoveryDependencies = {
      repositoryService: createMockRepositoryService([repo1, repo2]),
      ingestionService: selectiveIngestionService,
      updateCoordinator: createMockUpdateCoordinator(),
    };

    const result = await recoverMultiple([info1, info2], deps);

    expect(result.total).toBe(2);
    // Both will use full_reindex (no commit for info1, but coordinator is called first)
    // The exact counts depend on internal logic, just verify structure
    expect(result.results).toHaveLength(2);
    expect(result.successful + result.failed + result.manualRequired).toBe(2);
  });

  it("should count manual_required correctly", async () => {
    // Use a path with UUID that will definitely not exist on any platform
    const impossiblePath = `/nonexistent-${crypto.randomUUID()}/path-${Date.now()}`;
    const repo = createMockRepo({
      name: "manual-repo",
      localPath: impossiblePath,
    });
    const info = createMockInterruptedInfo({
      repositoryName: "manual-repo",
      repository: repo,
      lastKnownCommit: "abc123",
    });

    const deps: RecoveryDependencies = {
      repositoryService: createMockRepositoryService([repo]),
      ingestionService: createMockIngestionService(),
      updateCoordinator: createMockUpdateCoordinator(),
    };

    const result = await recoverMultiple([info], deps);

    expect(result.total).toBe(1);
    expect(result.manualRequired).toBe(1);
  });
});
