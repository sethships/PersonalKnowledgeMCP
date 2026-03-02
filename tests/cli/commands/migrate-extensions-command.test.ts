/**
 * Tests for Migrate Extensions Command
 *
 * Verifies backfilling of empty includeExtensions metadata with DEFAULT_EXTENSIONS.
 */

/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import { migrateExtensionsCommand } from "../../../src/cli/commands/migrate-extensions-command.js";
import { DEFAULT_EXTENSIONS } from "../../../src/ingestion/default-extensions.js";
import type { RepositoryInfo, RepositoryMetadataService } from "../../../src/repositories/types.js";

/**
 * Create a minimal mock RepositoryInfo with sensible defaults
 */
function createMockRepo(overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    name: "test-repo",
    url: "https://github.com/user/test-repo.git",
    localPath: "./data/repos/test-repo",
    collectionName: "repo_test_repo",
    fileCount: 100,
    chunkCount: 300,
    lastIndexedAt: "2025-01-01T00:00:00.000Z",
    indexDurationMs: 5000,
    status: "ready",
    branch: "main",
    includeExtensions: [],
    excludePatterns: [],
    ...overrides,
  };
}

/**
 * Create a mock RepositoryMetadataService
 */
function createMockService(repos: RepositoryInfo[]): RepositoryMetadataService {
  return {
    listRepositories: vi.fn().mockResolvedValue(repos),
    getRepository: vi.fn().mockImplementation(async (name: string) => {
      return repos.find((r) => r.name === name) ?? null;
    }),
    updateRepository: vi.fn().mockResolvedValue(undefined),
    removeRepository: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Migrate Extensions Command", () => {
  let consoleLogs: string[];
  const originalConsoleLog = console.log;

  beforeEach(() => {
    consoleLogs = [];
    console.log = vi.fn((...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe("migration behavior", () => {
    it("should migrate all repos with empty includeExtensions", async () => {
      const repos = [
        createMockRepo({ name: "repo-a", includeExtensions: [] }),
        createMockRepo({ name: "repo-b", includeExtensions: [] }),
      ];
      const service = createMockService(repos);

      await migrateExtensionsCommand({ dryRun: false, json: false }, service);

      expect(service.updateRepository).toHaveBeenCalledTimes(2);

      const firstCall = (service.updateRepository as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as RepositoryInfo;
      expect(firstCall.name).toBe("repo-a");
      expect(firstCall.includeExtensions).toEqual([...DEFAULT_EXTENSIONS]);

      const secondCall = (service.updateRepository as ReturnType<typeof vi.fn>).mock
        .calls[1]![0] as RepositoryInfo;
      expect(secondCall.name).toBe("repo-b");
      expect(secondCall.includeExtensions).toEqual([...DEFAULT_EXTENSIONS]);
    });

    it("should skip repos that already have non-empty includeExtensions", async () => {
      const customExtensions = [".ts", ".js", ".py"];
      const repos = [
        createMockRepo({ name: "repo-empty", includeExtensions: [] }),
        createMockRepo({ name: "repo-configured", includeExtensions: customExtensions }),
      ];
      const service = createMockService(repos);

      await migrateExtensionsCommand({ dryRun: false, json: false }, service);

      expect(service.updateRepository).toHaveBeenCalledTimes(1);
      const call = (service.updateRepository as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as RepositoryInfo;
      expect(call.name).toBe("repo-empty");
    });

    it("should be idempotent — running twice produces the same result", async () => {
      const repos = [createMockRepo({ name: "repo-a", includeExtensions: [] })];
      const service = createMockService(repos);

      // First run — migrates
      await migrateExtensionsCommand({ dryRun: false, json: false }, service);
      expect(service.updateRepository).toHaveBeenCalledTimes(1);

      // Simulate that the repo now has extensions after the first run
      const updatedRepos = [
        createMockRepo({ name: "repo-a", includeExtensions: [...DEFAULT_EXTENSIONS] }),
      ];
      const service2 = createMockService(updatedRepos);

      // Second run — skips
      await migrateExtensionsCommand({ dryRun: false, json: false }, service2);
      expect(service2.updateRepository).not.toHaveBeenCalled();
    });

    it("should set exactly DEFAULT_EXTENSIONS values", async () => {
      const repos = [createMockRepo({ name: "repo-a", includeExtensions: [] })];
      const service = createMockService(repos);

      await migrateExtensionsCommand({ dryRun: false, json: false }, service);

      const call = (service.updateRepository as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as RepositoryInfo;
      const expected = [...DEFAULT_EXTENSIONS];
      expect(call.includeExtensions).toEqual(expected);
      expect(call.includeExtensions.length).toBe(DEFAULT_EXTENSIONS.length);
    });

    it("should preserve all other repository fields during migration", async () => {
      const originalRepo = createMockRepo({
        name: "repo-a",
        includeExtensions: [],
        fileCount: 42,
        chunkCount: 126,
        status: "ready",
        branch: "develop",
        embeddingProvider: "openai",
        lastIndexedCommitSha: "abc123",
      });
      const service = createMockService([originalRepo]);

      await migrateExtensionsCommand({ dryRun: false, json: false }, service);

      const call = (service.updateRepository as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as RepositoryInfo;
      expect(call.name).toBe("repo-a");
      expect(call.fileCount).toBe(42);
      expect(call.chunkCount).toBe(126);
      expect(call.status).toBe("ready");
      expect(call.branch).toBe("develop");
      expect(call.embeddingProvider).toBe("openai");
      expect(call.lastIndexedCommitSha).toBe("abc123");
    });
  });

  describe("error handling", () => {
    it("should continue processing remaining repos when updateRepository fails", async () => {
      const repos = [
        createMockRepo({ name: "repo-ok", includeExtensions: [] }),
        createMockRepo({ name: "repo-fail", includeExtensions: [] }),
      ];
      const service = createMockService(repos);

      // First call succeeds, second call rejects
      (service.updateRepository as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("Disk full"));

      // Command should complete without throwing
      await migrateExtensionsCommand({ dryRun: false, json: true }, service);

      // Both repos should have been attempted
      expect(service.updateRepository).toHaveBeenCalledTimes(2);

      // Parse JSON output and verify counts
      const jsonOutput = consoleLogs.join("");
      const parsed = JSON.parse(jsonOutput) as {
        totalRepositories: number;
        migratedCount: number;
        failedCount: number;
        skippedCount: number;
        repositories: Array<{ name: string; action: string; reason?: string }>;
      };

      expect(parsed.totalRepositories).toBe(2);
      expect(parsed.migratedCount).toBe(1);
      expect(parsed.failedCount).toBe(1);
      expect(parsed.skippedCount).toBe(0);

      // Verify per-repo results
      const migrated = parsed.repositories.find((r) => r.name === "repo-ok");
      expect(migrated?.action).toBe("migrated");

      const failed = parsed.repositories.find((r) => r.name === "repo-fail");
      expect(failed?.action).toBe("failed");
      expect(failed?.reason).toBe("Disk full");
    });
  });

  describe("--dry-run flag", () => {
    it("should report changes without modifying data", async () => {
      const repos = [
        createMockRepo({ name: "repo-a", includeExtensions: [] }),
        createMockRepo({ name: "repo-b", includeExtensions: [".ts"] }),
      ];
      const service = createMockService(repos);

      await migrateExtensionsCommand({ dryRun: true, json: false }, service);

      // Should NOT have called updateRepository
      expect(service.updateRepository).not.toHaveBeenCalled();

      // Should mention dry run in output
      const output = consoleLogs.join("\n");
      expect(output).toContain("dry run");
    });

    it("should report correct counts in dry-run mode", async () => {
      const repos = [
        createMockRepo({ name: "repo-a", includeExtensions: [] }),
        createMockRepo({ name: "repo-b", includeExtensions: [] }),
        createMockRepo({ name: "repo-c", includeExtensions: [".ts", ".js"] }),
      ];
      const service = createMockService(repos);

      await migrateExtensionsCommand({ dryRun: true, json: true }, service);

      const jsonOutput = consoleLogs.join("");
      const parsed = JSON.parse(jsonOutput) as {
        migratedCount: number;
        skippedCount: number;
        dryRun: boolean;
      };
      expect(parsed.migratedCount).toBe(2);
      expect(parsed.skippedCount).toBe(1);
      expect(parsed.dryRun).toBe(true);
    });
  });

  describe("--json flag", () => {
    it("should produce valid JSON output", async () => {
      const repos = [
        createMockRepo({ name: "repo-a", includeExtensions: [] }),
        createMockRepo({ name: "repo-b", includeExtensions: [".ts"] }),
      ];
      const service = createMockService(repos);

      await migrateExtensionsCommand({ dryRun: false, json: true }, service);

      const jsonOutput = consoleLogs.join("");
      const parsed = JSON.parse(jsonOutput) as {
        totalRepositories: number;
        migratedCount: number;
        skippedCount: number;
        repositories: Array<{ name: string; action: string; reason?: string }>;
        dryRun: boolean;
      };

      expect(parsed.totalRepositories).toBe(2);
      expect(parsed.migratedCount).toBe(1);
      expect(parsed.skippedCount).toBe(1);
      expect(parsed.dryRun).toBe(false);
      expect(parsed.repositories).toHaveLength(2);

      const migrated = parsed.repositories.find((r) => r.name === "repo-a");
      expect(migrated?.action).toBe("migrated");

      const skipped = parsed.repositories.find((r) => r.name === "repo-b");
      expect(skipped?.action).toBe("skipped");
      expect(skipped?.reason).toBe("already has extensions");
    });
  });

  describe("edge cases", () => {
    it("should handle no repos needing migration", async () => {
      const repos = [
        createMockRepo({ name: "repo-a", includeExtensions: [".ts", ".js"] }),
        createMockRepo({ name: "repo-b", includeExtensions: [".py"] }),
      ];
      const service = createMockService(repos);

      await migrateExtensionsCommand({ dryRun: false, json: true }, service);

      expect(service.updateRepository).not.toHaveBeenCalled();

      const jsonOutput = consoleLogs.join("");
      const parsed = JSON.parse(jsonOutput) as {
        migratedCount: number;
        skippedCount: number;
      };
      expect(parsed.migratedCount).toBe(0);
      expect(parsed.skippedCount).toBe(2);
    });

    it("should handle no repos at all", async () => {
      const service = createMockService([]);

      await migrateExtensionsCommand({ dryRun: false, json: true }, service);

      expect(service.updateRepository).not.toHaveBeenCalled();

      const jsonOutput = consoleLogs.join("");
      const parsed = JSON.parse(jsonOutput) as {
        totalRepositories: number;
        migratedCount: number;
        skippedCount: number;
      };
      expect(parsed.totalRepositories).toBe(0);
      expect(parsed.migratedCount).toBe(0);
      expect(parsed.skippedCount).toBe(0);
    });

    it("should handle no repos at all with text output", async () => {
      const service = createMockService([]);

      await migrateExtensionsCommand({ dryRun: false, json: false }, service);

      expect(service.updateRepository).not.toHaveBeenCalled();

      const output = consoleLogs.join("\n");
      expect(output).toContain("No repositories found");
    });

    it("should treat undefined includeExtensions as needing migration", async () => {
      // Create a repo without includeExtensions set (simulating corrupted/old data)
      const repo = createMockRepo({ name: "repo-old" });
      // Force the field to be undefined to simulate missing data
      (repo as unknown as Record<string, unknown>)["includeExtensions"] = undefined;

      const service = createMockService([repo]);

      await migrateExtensionsCommand({ dryRun: false, json: false }, service);

      expect(service.updateRepository).toHaveBeenCalledTimes(1);
    });
  });

  describe("DEFAULT_EXTENSIONS validation", () => {
    it("should include common source code extensions", async () => {
      // Verify DEFAULT_EXTENSIONS contains expected values
      expect(DEFAULT_EXTENSIONS).toContain(".ts");
      expect(DEFAULT_EXTENSIONS).toContain(".js");
      expect(DEFAULT_EXTENSIONS).toContain(".tsx");
      expect(DEFAULT_EXTENSIONS).toContain(".jsx");
      expect(DEFAULT_EXTENSIONS).toContain(".py");
      expect(DEFAULT_EXTENSIONS).toContain(".cs");
      expect(DEFAULT_EXTENSIONS).toContain(".java");
      expect(DEFAULT_EXTENSIONS).toContain(".go");
      expect(DEFAULT_EXTENSIONS).toContain(".rs");
    });

    it("should include documentation and config extensions", async () => {
      expect(DEFAULT_EXTENSIONS).toContain(".md");
      expect(DEFAULT_EXTENSIONS).toContain(".json");
      expect(DEFAULT_EXTENSIONS).toContain(".yaml");
      expect(DEFAULT_EXTENSIONS).toContain(".yml");
      expect(DEFAULT_EXTENSIONS).toContain(".toml");
    });
  });
});
