/**
 * Tests for the watch-lifecycle methods on `LocalFolderUpdateCoordinator`
 * (Phase C / issue #566 / T5.3).
 *
 * Covers: startWatching delegating to a watch manager, persistence of
 * `watchEnabled`, no-manager fallback (still persists), source guard, and
 * stopWatching's persistence + delegation.
 *
 * @module tests/services/local-folder-update-coordinator-watch-lifecycle
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/await-thenable */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  LocalFolderUpdateCoordinator,
  type LocalFolderWatchManager,
} from "../../src/services/local-folder-update-coordinator.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

function makeRepo(name: string, overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
  return {
    name,
    source: "local-folder",
    url: null,
    localPath: `/abs/${name}`,
    collectionName: `repo_${name}`,
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

interface MockedMetadata extends RepositoryMetadataService {
  store: Map<string, RepositoryInfo>;
}

function makeMetadata(seed: RepositoryInfo[]): MockedMetadata {
  const store = new Map(seed.map((r) => [r.name, { ...r }]));
  return {
    store,
    listRepositories: mock(async () => Array.from(store.values())),
    getRepository: mock(async (name: string) => store.get(name) ?? null),
    updateRepository: mock(async (info: RepositoryInfo) => {
      store.set(info.name, info);
    }),
    removeRepository: mock(async (name: string) => {
      store.delete(name);
    }),
  } as unknown as MockedMetadata;
}

function makeWatchManager(): LocalFolderWatchManager & {
  startWatching: ReturnType<typeof mock>;
  stopWatching: ReturnType<typeof mock>;
} {
  return {
    startWatching: mock(async () => undefined),
    stopWatching: mock(async () => undefined),
  } as any;
}

describe("LocalFolderUpdateCoordinator watch lifecycle", () => {
  beforeEach(() => initializeLogger({ level: "silent", format: "json" }));
  afterEach(() => resetLogger());

  it("startWatching delegates to the manager AND persists watchEnabled=true", async () => {
    const repo = makeRepo("alpha", { watchEnabled: false });
    const metadata = makeMetadata([repo]);
    const manager = makeWatchManager();

    const coordinator = new LocalFolderUpdateCoordinator(
      metadata,
      {} as any, // pipeline not exercised
      undefined,
      undefined,
      {},
      manager
    );

    await coordinator.startWatching(repo);

    expect(manager.startWatching.mock.calls.length).toBe(1);
    expect((metadata.updateRepository as any).mock.calls.length).toBe(1);
    expect(metadata.store.get("alpha")?.watchEnabled).toBe(true);
  });

  it("startWatching without a watch manager still persists watchEnabled=true", async () => {
    const repo = makeRepo("beta");
    const metadata = makeMetadata([repo]);

    const coordinator = new LocalFolderUpdateCoordinator(
      metadata,
      {} as any,
      undefined,
      undefined,
      {}
      // watchManager omitted
    );

    await coordinator.startWatching(repo);

    expect(metadata.store.get("beta")?.watchEnabled).toBe(true);
  });

  it("startWatching skips redundant metadata writes when already watchEnabled=true", async () => {
    const repo = makeRepo("gamma", { watchEnabled: true });
    const metadata = makeMetadata([repo]);
    const manager = makeWatchManager();

    const coordinator = new LocalFolderUpdateCoordinator(
      metadata,
      {} as any,
      undefined,
      undefined,
      {},
      manager
    );

    await coordinator.startWatching(repo);

    // Manager called every time, but no metadata write needed.
    expect(manager.startWatching.mock.calls.length).toBe(1);
    expect((metadata.updateRepository as any).mock.calls.length).toBe(0);
  });

  it("startWatching rejects non-local-folder sources", async () => {
    const repo = makeRepo("delta", { source: "git-remote", url: "https://x" });
    const metadata = makeMetadata([repo]);
    const manager = makeWatchManager();

    const coordinator = new LocalFolderUpdateCoordinator(
      metadata,
      {} as any,
      undefined,
      undefined,
      {},
      manager
    );

    await expect(coordinator.startWatching(repo)).rejects.toThrow(/local-folder/);
    expect(manager.startWatching.mock.calls.length).toBe(0);
  });

  it("stopWatching delegates and persists watchEnabled=false", async () => {
    const repo = makeRepo("epsilon", { watchEnabled: true });
    const metadata = makeMetadata([repo]);
    const manager = makeWatchManager();

    const coordinator = new LocalFolderUpdateCoordinator(
      metadata,
      {} as any,
      undefined,
      undefined,
      {},
      manager
    );

    await coordinator.stopWatching("epsilon");

    expect(manager.stopWatching.mock.calls.length).toBe(1);
    expect(metadata.store.get("epsilon")?.watchEnabled).toBe(false);
  });

  it("stopWatching is idempotent for unknown repositories", async () => {
    const metadata = makeMetadata([]);
    const manager = makeWatchManager();

    const coordinator = new LocalFolderUpdateCoordinator(
      metadata,
      {} as any,
      undefined,
      undefined,
      {},
      manager
    );

    await expect(coordinator.stopWatching("never-registered")).resolves.toBeUndefined();
    expect(manager.stopWatching.mock.calls.length).toBe(1);
    // No metadata write because the repo doesn't exist.
    expect((metadata.updateRepository as any).mock.calls.length).toBe(0);
  });
});
