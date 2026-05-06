/**
 * Unit tests for LocalFolderRepoWatchManager (issue #566 / T5.3, T5.4).
 *
 * Covers: synthetic WatchedFolder construction, default-deny symlink policy,
 * opt-in followSymlinks with depth cap, validation of source/path/realpath,
 * and stopWatching idempotency.
 *
 * @module tests/services/local-folder-repo-watch-manager
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  LocalFolderRepoWatchManager,
  LocalFolderWatchValidationError,
  SYMLINK_FOLLOW_DEPTH_CAP,
} from "../../src/services/local-folder-repo-watch-manager.js";
import { localFolderIdFor } from "../../src/services/folder-event-router.js";
import type { FolderWatcherService } from "../../src/services/folder-watcher-service.js";
import type { RepositoryInfo } from "../../src/repositories/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

function makeWatcherStub(): FolderWatcherService & {
  startWatching: ReturnType<typeof mock>;
  stopWatching: ReturnType<typeof mock>;
} {
  return {
    startWatching: mock(async () => undefined),
    stopWatching: mock(async () => undefined),
  } as any;
}

function makeRepo(localPath: string, overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    name: "test-repo",
    source: "local-folder",
    url: null,
    localPath,
    collectionName: "repo_test",
    fileCount: 0,
    chunkCount: 0,
    lastIndexedAt: new Date().toISOString(),
    indexDurationMs: 0,
    status: "ready",
    branch: "(local-folder)",
    includeExtensions: [".ts"],
    excludePatterns: [],
    tier: "private",
    ...overrides,
  };
}

describe("LocalFolderRepoWatchManager", () => {
  let testDir: string;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testDir = join(import.meta.dir, "..", "..", "test-temp", `lfrwm-${stamp}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    resetLogger();
  });

  describe("startWatching", () => {
    it("constructs a synthetic WatchedFolder with the local-folder id prefix", async () => {
      const watcher = makeWatcherStub();
      const manager = new LocalFolderRepoWatchManager(watcher);
      const repo = makeRepo(testDir, { name: "ws-1" });

      await manager.startWatching(repo);

      expect(watcher.startWatching.mock.calls.length).toBe(1);
      const synthetic = watcher.startWatching.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(synthetic["id"]).toBe(localFolderIdFor("ws-1"));
      expect(synthetic["path"]).toBe(resolve(testDir));
      expect(synthetic["enabled"]).toBe(true);
    });

    it("default-denies symlinks: synthetic followSymlinks=false, no depth cap", async () => {
      const watcher = makeWatcherStub();
      const manager = new LocalFolderRepoWatchManager(watcher);
      const repo = makeRepo(testDir, { name: "ws-deny", followSymlinks: undefined });

      await manager.startWatching(repo);

      const synthetic = watcher.startWatching.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(synthetic["followSymlinks"]).toBe(false);
      expect(synthetic["depthCap"]).toBeUndefined();
    });

    it("opts-in to symlinks when followSymlinks=true, capping depth at 8", async () => {
      const watcher = makeWatcherStub();
      const manager = new LocalFolderRepoWatchManager(watcher);
      const repo = makeRepo(testDir, { name: "ws-allow", followSymlinks: true });

      await manager.startWatching(repo);

      const synthetic = watcher.startWatching.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(synthetic["followSymlinks"]).toBe(true);
      expect(synthetic["depthCap"]).toBe(SYMLINK_FOLLOW_DEPTH_CAP);
    });

    it("propagates per-repo watchDebounceMs into the synthetic folder", async () => {
      const watcher = makeWatcherStub();
      const manager = new LocalFolderRepoWatchManager(watcher);
      const repo = makeRepo(testDir, { name: "ws-debounce", watchDebounceMs: 750 });

      await manager.startWatching(repo);

      const synthetic = watcher.startWatching.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(synthetic["debounceMs"]).toBe(750);
    });

    it("rejects non-local-folder sources", async () => {
      const watcher = makeWatcherStub();
      const manager = new LocalFolderRepoWatchManager(watcher);
      const gitRepo = makeRepo(testDir, { source: "git-remote", url: "https://x" });

      await expect(manager.startWatching(gitRepo)).rejects.toBeInstanceOf(
        LocalFolderWatchValidationError
      );
      expect(watcher.startWatching.mock.calls.length).toBe(0);
    });

    it("rejects a registered path that does not exist", async () => {
      const watcher = makeWatcherStub();
      const manager = new LocalFolderRepoWatchManager(watcher);
      const ghost = makeRepo(join(testDir, "does-not-exist"));

      await expect(manager.startWatching(ghost)).rejects.toBeInstanceOf(
        LocalFolderWatchValidationError
      );
      expect(watcher.startWatching.mock.calls.length).toBe(0);
    });
  });

  describe("stopWatching", () => {
    it("calls folderWatcherService.stopWatching with the prefixed id", async () => {
      const watcher = makeWatcherStub();
      const manager = new LocalFolderRepoWatchManager(watcher);

      await manager.stopWatching("ws-stop");

      expect(watcher.stopWatching.mock.calls[0]?.[0]).toBe(localFolderIdFor("ws-stop"));
    });

    it("swallows errors from the watcher (idempotent stop)", async () => {
      const watcher = makeWatcherStub();
      watcher.stopWatching = mock(async () => {
        throw new Error("not watched");
      }) as any;
      const manager = new LocalFolderRepoWatchManager(watcher);

      await expect(manager.stopWatching("ghost")).resolves.toBeUndefined();
    });
  });
});
