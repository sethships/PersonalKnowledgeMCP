/**
 * Unit tests for FolderEventRouter (issue #566 / T5.1).
 *
 * Covers: id-prefix routing precedence, debounce coalescing, per-repo
 * debounce overrides, missing-repo handling, non-local-folder source
 * rejection, and shutdown cancelling pending timers.
 *
 * @module tests/services/folder-event-router
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  FolderEventRouter,
  LOCAL_FOLDER_ID_PREFIX,
  localFolderIdFor,
  repositoryNameFromLocalFolderId,
  DEFAULT_LOCAL_FOLDER_DEBOUNCE_MS,
} from "../../src/services/folder-event-router.js";
import type { FileEvent } from "../../src/services/folder-watcher-types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

function buildEvent(folderId: string): FileEvent {
  return {
    type: "change",
    absolutePath: "/some/abs/file.txt",
    relativePath: "file.txt",
    extension: "txt",
    folderId,
    folderPath: "/some/abs",
    timestamp: new Date(),
  };
}

function buildLocalFolderRepo(name: string, overrides: Partial<RepositoryInfo> = {}): RepositoryInfo {
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

function buildMetadata(repos: RepositoryInfo[]): RepositoryMetadataService {
  const map = new Map(repos.map((r) => [r.name, r]));
  return {
    getRepository: mock(async (name: string) => map.get(name) ?? null),
    listRepositories: mock(async () => Array.from(map.values())),
    updateRepository: mock(async () => undefined),
    removeRepository: mock(async () => undefined),
  } as unknown as RepositoryMetadataService;
}

describe("FolderEventRouter id-prefix helpers", () => {
  it("encodes and decodes repository names symmetrically", () => {
    const id = localFolderIdFor("my-repo");
    expect(id).toBe(`${LOCAL_FOLDER_ID_PREFIX}my-repo`);
    expect(repositoryNameFromLocalFolderId(id)).toBe("my-repo");
  });

  it("returns null for non-local-folder ids", () => {
    expect(repositoryNameFromLocalFolderId("watched-folder-uuid")).toBeNull();
    expect(repositoryNameFromLocalFolderId("")).toBeNull();
  });
});

describe("FolderEventRouter routing", () => {
  beforeEach(() => initializeLogger({ level: "silent", format: "json" }));
  afterEach(() => resetLogger());

  it("ignores events whose folderId is not in the local-folder namespace", async () => {
    const dispatch = mock(() => undefined);
    const router = new FolderEventRouter(buildMetadata([]), dispatch as any);

    await router.route(buildEvent("watched-folder-uuid-1"));

    expect(dispatch.mock.calls.length).toBe(0);
  });

  it("debounces multiple events for the same repo into a single dispatch", async () => {
    const dispatch = mock(() => undefined);
    const repo = buildLocalFolderRepo("repo-A");
    const router = new FolderEventRouter(buildMetadata([repo]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    const id = localFolderIdFor("repo-A");
    await router.route(buildEvent(id));
    await router.route(buildEvent(id));
    await router.route(buildEvent(id));

    // Before debounce expires, dispatch must NOT have fired.
    expect(dispatch.mock.calls.length).toBe(0);

    await new Promise((r) => setTimeout(r, 30));

    // After expiry, exactly one dispatch fires for the coalesced burst.
    expect(dispatch.mock.calls.length).toBe(1);
    expect(dispatch.mock.calls[0]?.[0]?.name).toBe("repo-A");
  });

  it("respects per-repo watchDebounceMs override", async () => {
    const dispatch = mock(() => undefined);
    const repo = buildLocalFolderRepo("slow-repo", { watchDebounceMs: 50 });
    const router = new FolderEventRouter(buildMetadata([repo]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    await router.route(buildEvent(localFolderIdFor("slow-repo")));
    // After the default would have fired (>10ms), check no dispatch yet.
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatch.mock.calls.length).toBe(0);

    // After the per-repo window (50ms total), dispatch fires.
    await new Promise((r) => setTimeout(r, 40));
    expect(dispatch.mock.calls.length).toBe(1);
  });

  it("dispatches independently for two distinct repos", async () => {
    const dispatch = mock(() => undefined);
    const repos = [buildLocalFolderRepo("a"), buildLocalFolderRepo("b")];
    const router = new FolderEventRouter(buildMetadata(repos), dispatch as any, {
      defaultDebounceMs: 10,
    });

    await router.route(buildEvent(localFolderIdFor("a")));
    await router.route(buildEvent(localFolderIdFor("b")));

    await new Promise((r) => setTimeout(r, 30));

    const dispatchedNames = dispatch.mock.calls.map((c) => (c[0] as RepositoryInfo).name).sort();
    expect(dispatchedNames).toEqual(["a", "b"]);
  });

  it("drops events for unknown local-folder repos", async () => {
    const dispatch = mock(() => undefined);
    const router = new FolderEventRouter(buildMetadata([]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    await router.route(buildEvent(localFolderIdFor("ghost")));
    await new Promise((r) => setTimeout(r, 30));
    expect(dispatch.mock.calls.length).toBe(0);
  });

  it("drops events when the resolved repo is not a local-folder source", async () => {
    const dispatch = mock(() => undefined);
    const repo = buildLocalFolderRepo("mixed", { source: "git-remote", url: "https://x" });
    const router = new FolderEventRouter(buildMetadata([repo]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    await router.route(buildEvent(localFolderIdFor("mixed")));
    await new Promise((r) => setTimeout(r, 30));
    expect(dispatch.mock.calls.length).toBe(0);
  });

  it("shutdown cancels pending timers", async () => {
    const dispatch = mock(() => undefined);
    const repo = buildLocalFolderRepo("cancelme");
    const router = new FolderEventRouter(buildMetadata([repo]), dispatch as any, {
      defaultDebounceMs: 50,
    });

    await router.route(buildEvent(localFolderIdFor("cancelme")));
    router.shutdown();
    await new Promise((r) => setTimeout(r, 100));
    expect(dispatch.mock.calls.length).toBe(0);
  });

  it("uses DEFAULT_LOCAL_FOLDER_DEBOUNCE_MS when no override is provided", () => {
    expect(DEFAULT_LOCAL_FOLDER_DEBOUNCE_MS).toBe(2000);
  });
});
