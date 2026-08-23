/**
 * Unit tests for Interrupted Update Detector Service
 *
 * Tests detection of interrupted updates, flag clearing, and recovery helpers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import {
  detectInterruptedUpdates,
  clearInterruptedUpdateFlag,
  markAsInterrupted,
  formatElapsedTime,
  getStaleUpdateLockMs,
  isStaleUpdateLock,
} from "../../../src/services/interrupted-update-detector.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../../src/repositories/types.js";

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
    source: "git-remote",
    url: "https://github.com/test/test-repo.git",
    localPath: "/data/repos/test-repo",
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

// Helper to create mock repository service
function createMockRepositoryService(repositories: RepositoryInfo[]): RepositoryMetadataService {
  return {
    listRepositories: mock(async () => repositories),
    getRepository: mock(async (name: string) => repositories.find((r) => r.name === name) || null),
    updateRepository: mock(async () => {}),
    removeRepository: mock(async () => {}),
  };
}

describe("detectInterruptedUpdates", () => {
  it("should return empty array when no repositories exist", async () => {
    const service = createMockRepositoryService([]);

    const result = await detectInterruptedUpdates(service);

    expect(result.interrupted).toHaveLength(0);
    expect(result.totalRepositories).toBe(0);
    expect(result.detectionDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("should return empty array when no repositories have interrupted updates", async () => {
    const repos = [
      createMockRepo({ name: "repo1" }),
      createMockRepo({ name: "repo2", updateInProgress: false }),
      createMockRepo({ name: "repo3", updateInProgress: undefined }),
    ];
    const service = createMockRepositoryService(repos);

    const result = await detectInterruptedUpdates(service);

    expect(result.interrupted).toHaveLength(0);
    expect(result.totalRepositories).toBe(3);
  });

  it("should detect single repository with interrupted update", async () => {
    const updateStartedAt = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
    const repos = [
      createMockRepo({
        name: "interrupted-repo",
        updateInProgress: true,
        updateStartedAt,
        status: "indexing",
      }),
    ];
    const service = createMockRepositoryService(repos);

    const result = await detectInterruptedUpdates(service);

    expect(result.interrupted).toHaveLength(1);
    expect(result.interrupted[0]!.repositoryName).toBe("interrupted-repo");
    expect(result.interrupted[0]!.updateStartedAt).toBe(updateStartedAt);
    expect(result.interrupted[0]!.elapsedMs).toBeGreaterThan(50000); // Close to 60s
    expect(result.interrupted[0]!.status).toBe("indexing");
    expect(result.totalRepositories).toBe(1);
  });

  it("should detect multiple repositories with interrupted updates", async () => {
    const repos = [
      createMockRepo({ name: "normal-repo" }),
      createMockRepo({
        name: "interrupted-1",
        updateInProgress: true,
        updateStartedAt: new Date(Date.now() - 120000).toISOString(),
      }),
      createMockRepo({ name: "another-normal" }),
      createMockRepo({
        name: "interrupted-2",
        updateInProgress: true,
        updateStartedAt: new Date(Date.now() - 300000).toISOString(),
        lastIndexedCommitSha: "abc123def456",
      }),
    ];
    const service = createMockRepositoryService(repos);

    const result = await detectInterruptedUpdates(service);

    expect(result.interrupted).toHaveLength(2);
    expect(result.interrupted.map((i) => i.repositoryName)).toContain("interrupted-1");
    expect(result.interrupted.map((i) => i.repositoryName)).toContain("interrupted-2");
    expect(result.totalRepositories).toBe(4);

    // Check that lastKnownCommit is included
    const interrupted2 = result.interrupted.find((i) => i.repositoryName === "interrupted-2");
    expect(interrupted2?.lastKnownCommit).toBe("abc123def456");
  });

  it("should handle missing updateStartedAt by using current time", async () => {
    const repos = [
      createMockRepo({
        name: "no-timestamp",
        updateInProgress: true,
        updateStartedAt: undefined,
      }),
    ];
    const service = createMockRepositoryService(repos);

    const result = await detectInterruptedUpdates(service);

    expect(result.interrupted).toHaveLength(1);
    expect(result.interrupted[0]!.updateStartedAt).toBeDefined();
    // Elapsed should be very small since we default to now
    expect(result.interrupted[0]!.elapsedMs).toBeLessThan(1000);
  });

  it("should include full repository info in result", async () => {
    const repos = [
      createMockRepo({
        name: "full-info-repo",
        updateInProgress: true,
        updateStartedAt: new Date().toISOString(),
        lastIndexedCommitSha: "commit123",
      }),
    ];
    const service = createMockRepositoryService(repos);

    const result = await detectInterruptedUpdates(service);

    expect(result.interrupted[0]!.repository).toBeDefined();
    expect(result.interrupted[0]!.repository.name).toBe("full-info-repo");
    expect(result.interrupted[0]!.repository.url).toBe("https://github.com/test/test-repo.git");
  });
});

describe("clearInterruptedUpdateFlag", () => {
  it("should clear updateInProgress flag", async () => {
    const repo = createMockRepo({
      name: "interrupted",
      updateInProgress: true,
      updateStartedAt: new Date().toISOString(),
    });
    const service = createMockRepositoryService([repo]);

    const result = await clearInterruptedUpdateFlag(service, "interrupted");

    expect(result.updateInProgress).toBe(false);
    expect(result.updateStartedAt).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(service.updateRepository).toHaveBeenCalled();
  });

  it("should throw error if repository not found", async () => {
    const service = createMockRepositoryService([]);

    // eslint-disable-next-line @typescript-eslint/await-thenable
    await expect(clearInterruptedUpdateFlag(service, "nonexistent")).rejects.toThrow(
      "Repository 'nonexistent' not found"
    );
  });

  it("should preserve other repository fields", async () => {
    const repo = createMockRepo({
      name: "preserve-fields",
      updateInProgress: true,
      updateStartedAt: new Date().toISOString(),
      fileCount: 200,
      chunkCount: 1000,
      lastIndexedCommitSha: "abc123",
    });
    const service = createMockRepositoryService([repo]);

    const result = await clearInterruptedUpdateFlag(service, "preserve-fields");

    expect(result.fileCount).toBe(200);
    expect(result.chunkCount).toBe(1000);
    expect(result.lastIndexedCommitSha).toBe("abc123");
  });
});

describe("markAsInterrupted", () => {
  it("should set status to error and clear in-progress flag", async () => {
    const updateStartedAt = "2024-12-14T15:30:00.000Z";
    const repo = createMockRepo({
      name: "mark-interrupted",
      updateInProgress: true,
      updateStartedAt,
      status: "indexing",
    });
    const service = createMockRepositoryService([repo]);

    const result = await markAsInterrupted(service, "mark-interrupted", updateStartedAt);

    expect(result.updateInProgress).toBe(false);
    expect(result.updateStartedAt).toBeUndefined();
    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("Update interrupted");
    expect(result.errorMessage).toContain(updateStartedAt);
    expect(result.errorMessage).toContain("pk-mcp update mark-interrupted --force");
  });

  it("should throw error if repository not found", async () => {
    const service = createMockRepositoryService([]);

    // eslint-disable-next-line @typescript-eslint/await-thenable
    await expect(
      markAsInterrupted(service, "nonexistent", new Date().toISOString())
    ).rejects.toThrow("Repository 'nonexistent' not found");
  });

  it("should call updateRepository with correct data", async () => {
    const repo = createMockRepo({
      name: "test-update-call",
      updateInProgress: true,
    });
    const service = createMockRepositoryService([repo]);

    await markAsInterrupted(service, "test-update-call", "2024-12-14T15:30:00.000Z");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(service.updateRepository).toHaveBeenCalled();
    const updateCall = (service.updateRepository as ReturnType<typeof mock>).mock.calls[0]!;
    const updatedRepo = updateCall[0] as RepositoryInfo;
    expect(updatedRepo.status).toBe("error");
    expect(updatedRepo.updateInProgress).toBe(false);
  });
});

describe("formatElapsedTime", () => {
  it("should format seconds only", () => {
    expect(formatElapsedTime(30000)).toBe("30s");
    expect(formatElapsedTime(1000)).toBe("1s");
    expect(formatElapsedTime(500)).toBe("0s");
  });

  it("should format minutes and seconds", () => {
    expect(formatElapsedTime(60000)).toBe("1m 0s");
    expect(formatElapsedTime(90000)).toBe("1m 30s");
    expect(formatElapsedTime(150000)).toBe("2m 30s");
    expect(formatElapsedTime(3599000)).toBe("59m 59s");
  });

  it("should format hours and minutes", () => {
    expect(formatElapsedTime(3600000)).toBe("1h 0m");
    expect(formatElapsedTime(5400000)).toBe("1h 30m");
    expect(formatElapsedTime(7200000)).toBe("2h 0m");
    expect(formatElapsedTime(8100000)).toBe("2h 15m");
  });

  it("should handle edge cases", () => {
    expect(formatElapsedTime(0)).toBe("0s");
    expect(formatElapsedTime(999)).toBe("0s");
    expect(formatElapsedTime(59999)).toBe("59s");
  });

  it("renders a non-finite elapsed time as text rather than NaN", () => {
    expect(formatElapsedTime(NaN)).toBe("unknown (invalid timestamp)");
  });
});

/**
 * The `updateInProgress` flag is a lease, not a permanent lock. These tests pin
 * the lease arithmetic that lets a new update take over a flag left behind by a
 * hard kill or an indefinitely hung run. Without the lease, a leftover flag
 * wedges the repository forever: every later update throws ConcurrentUpdateError
 * and the MCP surface has no tool to clear it.
 */
describe("getStaleUpdateLockMs", () => {
  const ENV_KEY = "UPDATE_STALE_LOCK_MS";
  const DEFAULT_LEASE_MS = 60 * 60 * 1000;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = Bun.env[ENV_KEY];
    delete Bun.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete Bun.env[ENV_KEY];
    } else {
      Bun.env[ENV_KEY] = savedEnv;
    }
  });

  it("defaults to one hour when the override is unset", () => {
    expect(getStaleUpdateLockMs()).toBe(DEFAULT_LEASE_MS);
  });

  it("honours a positive numeric UPDATE_STALE_LOCK_MS override", () => {
    Bun.env[ENV_KEY] = "5000";
    expect(getStaleUpdateLockMs()).toBe(5000);
  });

  it("falls back to the default for a non-numeric override", () => {
    Bun.env[ENV_KEY] = "not-a-number";
    expect(getStaleUpdateLockMs()).toBe(DEFAULT_LEASE_MS);
  });

  it("falls back to the default for a zero override", () => {
    Bun.env[ENV_KEY] = "0";
    expect(getStaleUpdateLockMs()).toBe(DEFAULT_LEASE_MS);
  });

  it("falls back to the default for a negative override", () => {
    Bun.env[ENV_KEY] = "-1000";
    expect(getStaleUpdateLockMs()).toBe(DEFAULT_LEASE_MS);
  });

  it("falls back to the default for an empty or whitespace override", () => {
    Bun.env[ENV_KEY] = "   ";
    expect(getStaleUpdateLockMs()).toBe(DEFAULT_LEASE_MS);
  });
});

describe("isStaleUpdateLock", () => {
  const ENV_KEY = "UPDATE_STALE_LOCK_MS";
  const DEFAULT_LEASE_MS = 60 * 60 * 1000;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = Bun.env[ENV_KEY];
    delete Bun.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete Bun.env[ENV_KEY];
    } else {
      Bun.env[ENV_KEY] = savedEnv;
    }
  });

  it("treats a lock taken moments ago as live", () => {
    const now = Date.now();
    const startedAt = new Date(now - 30_000).toISOString();

    expect(isStaleUpdateLock(startedAt, now)).toBe(false);
  });

  it("treats a lock just inside the lease as live", () => {
    const now = Date.now();
    const startedAt = new Date(now - (DEFAULT_LEASE_MS - 1_000)).toISOString();

    expect(isStaleUpdateLock(startedAt, now)).toBe(false);
  });

  it("treats a lock older than the lease as stale", () => {
    const now = Date.now();
    const startedAt = new Date(now - (DEFAULT_LEASE_MS + 1_000)).toISOString();

    expect(isStaleUpdateLock(startedAt, now)).toBe(true);
  });

  it("applies the UPDATE_STALE_LOCK_MS override to the staleness decision", () => {
    Bun.env[ENV_KEY] = "1000";
    const now = Date.now();
    const startedAt = new Date(now - 5_000).toISOString();

    // Stale under the 1s override, but well inside the one hour default.
    expect(isStaleUpdateLock(startedAt, now)).toBe(true);
  });

  it("treats an unparseable timestamp as stale so a corrupt value cannot wedge the repository", () => {
    expect(isStaleUpdateLock("not-a-timestamp", Date.now())).toBe(true);
    expect(isStaleUpdateLock("", Date.now())).toBe(true);
  });

  it("defaults `now` to the current time when not supplied", () => {
    expect(isStaleUpdateLock(new Date().toISOString())).toBe(false);
    expect(isStaleUpdateLock(new Date(Date.now() - DEFAULT_LEASE_MS - 60_000).toISOString())).toBe(
      true
    );
  });
});
