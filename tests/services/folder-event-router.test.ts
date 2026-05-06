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
import { mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
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

function buildLocalFolderRepo(
  name: string,
  overrides: Partial<RepositoryInfo> = {}
): RepositoryInfo {
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

  it("treats UUID-shaped Phase 6 ids as non-local-folder (review L-4)", () => {
    // RFC 4122 v4 UUIDs cannot start with "local-folder:" since the first
    // 8 characters must be hex digits. A handful of representative samples
    // covers the structural guarantee.
    const uuidSamples = [
      "550e8400-e29b-41d4-a716-446655440000",
      "00000000-0000-4000-8000-000000000000",
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
      "deadbeef-1234-4567-89ab-cdef01234567",
    ];
    for (const id of uuidSamples) {
      expect(repositoryNameFromLocalFolderId(id)).toBeNull();
      expect(id.startsWith(LOCAL_FOLDER_ID_PREFIX)).toBe(false);
    }
  });
});

describe("FolderEventRouter routing", () => {
  beforeEach(() => initializeLogger({ level: "silent", format: "json" }));
  afterEach(() => resetLogger());

  it("ignores events whose folderId is not in the local-folder namespace", async () => {
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
    const router = new FolderEventRouter(buildMetadata([]), dispatch as any);

    await router.route(buildEvent("watched-folder-uuid-1"));

    expect(dispatch.mock.calls.length).toBe(0);
  });

  it("debounces multiple events for the same repo into a single dispatch", async () => {
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
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
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
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
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
    const repos = [buildLocalFolderRepo("a"), buildLocalFolderRepo("b")];
    const router = new FolderEventRouter(buildMetadata(repos), dispatch as any, {
      defaultDebounceMs: 10,
    });

    await router.route(buildEvent(localFolderIdFor("a")));
    await router.route(buildEvent(localFolderIdFor("b")));

    await new Promise((r) => setTimeout(r, 30));

    const dispatchedNames = dispatch.mock.calls.map((c) => c[0].name).sort();
    expect(dispatchedNames).toEqual(["a", "b"]);
  });

  it("drops events for unknown local-folder repos", async () => {
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
    const router = new FolderEventRouter(buildMetadata([]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    await router.route(buildEvent(localFolderIdFor("ghost")));
    await new Promise((r) => setTimeout(r, 30));
    expect(dispatch.mock.calls.length).toBe(0);
  });

  it("drops events when the resolved repo is not a local-folder source", async () => {
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
    const repo = buildLocalFolderRepo("mixed", { source: "git-remote", url: "https://x" });
    const router = new FolderEventRouter(buildMetadata([repo]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    await router.route(buildEvent(localFolderIdFor("mixed")));
    await new Promise((r) => setTimeout(r, 30));
    expect(dispatch.mock.calls.length).toBe(0);
  });

  it("shutdown cancels pending timers", async () => {
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
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

/**
 * Out-of-folder symlink rejection (review C-2).
 *
 * Uses a real temp-dir fixture with a real symlink so the realpath()
 * comparison in the router actually exercises against the OS. The fixture
 * is platform-portable because Node's `symlink` works on macOS/Linux and on
 * Windows (with developer-mode or admin elevation). When elevation is
 * unavailable on Windows the test self-skips so CI on developer machines
 * doesn't false-fail.
 */
describe("FolderEventRouter out-of-folder symlink rejection", () => {
  let testRoot: string;
  let repoRoot: string;
  let outsideDir: string;
  let outsideFile: string;
  let symlinkPath: string;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testRoot = join(import.meta.dir, "..", "..", "test-temp", `fer-symlink-${stamp}`);
    repoRoot = join(testRoot, "repo");
    outsideDir = join(testRoot, "outside");
    await mkdir(repoRoot, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    outsideFile = join(outsideDir, "secret.txt");
    await writeFile(outsideFile, "should not be indexed");
    symlinkPath = join(repoRoot, "escape");
    try {
      await symlink(outsideDir, symlinkPath, "dir");
    } catch (err) {
      // EPERM on Windows without dev-mode/admin elevation. The router code is
      // still exercised in the no-symlink event-route tests above; this
      // suite simply self-skips on machines that can't make symlinks.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("EPERM") || message.includes("perm")) {
        // Fixture creation failed — flag and rely on early returns in the tests.
        symlinkPath = "";
      } else {
        throw err;
      }
    }
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    resetLogger();
  });

  it("drops events whose realpath escapes the repo root when followSymlinks=true", async () => {
    if (symlinkPath === "") return; // Windows EPERM — see beforeEach
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
    const repo = buildLocalFolderRepo("guarded", {
      localPath: repoRoot,
      followSymlinks: true,
    });
    const router = new FolderEventRouter(buildMetadata([repo]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    const escapingEvent: FileEvent = {
      type: "change",
      // The path the user sees (under repo via the symlink) — chokidar would
      // emit this when followSymlinks: true and the symlink target changes.
      absolutePath: join(symlinkPath, "secret.txt"),
      relativePath: "escape/secret.txt",
      extension: "txt",
      folderId: localFolderIdFor("guarded"),
      folderPath: repoRoot,
      timestamp: new Date(),
    };

    await router.route(escapingEvent);
    await new Promise((r) => setTimeout(r, 30));

    // Realpath resolves both `repoRoot/escape/secret.txt` and `outsideDir/secret.txt`
    // to the same canonical out-of-repo location, which is not a prefix of
    // realpath(repoRoot). Router drops the event.
    expect(dispatch.mock.calls.length).toBe(0);
  });

  it("ALLOWS events that resolve inside the repo root (defence-in-depth false-positive guard)", async () => {
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
    const repo = buildLocalFolderRepo("guarded", {
      localPath: repoRoot,
      followSymlinks: true,
    });
    const router = new FolderEventRouter(buildMetadata([repo]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    // Real file under the repo root — realpath stays inside.
    const insideFile = join(repoRoot, "kept.txt");
    await writeFile(insideFile, "inside content");
    const insideEvent: FileEvent = {
      type: "change",
      absolutePath: resolve(insideFile),
      relativePath: "kept.txt",
      extension: "txt",
      folderId: localFolderIdFor("guarded"),
      folderPath: repoRoot,
      timestamp: new Date(),
    };

    await router.route(insideEvent);
    await new Promise((r) => setTimeout(r, 30));
    expect(dispatch.mock.calls.length).toBe(1);
  });

  it("does NOT run the realpath check when followSymlinks=false (cost optimization)", async () => {
    if (symlinkPath === "") return;
    const dispatch = mock((_repo: RepositoryInfo) => undefined);
    const repo = buildLocalFolderRepo("plain", {
      localPath: repoRoot,
      followSymlinks: false,
    });
    const router = new FolderEventRouter(buildMetadata([repo]), dispatch as any, {
      defaultDebounceMs: 10,
    });

    // chokidar with followSymlinks: false would not normally emit this event;
    // but if it slipped through somehow, the router doesn't second-guess it.
    const event: FileEvent = {
      type: "change",
      absolutePath: join(symlinkPath, "secret.txt"),
      relativePath: "escape/secret.txt",
      extension: "txt",
      folderId: localFolderIdFor("plain"),
      folderPath: repoRoot,
      timestamp: new Date(),
    };

    await router.route(event);
    await new Promise((r) => setTimeout(r, 30));
    // Router DOES dispatch — the symlink filter runs only under followSymlinks=true.
    expect(dispatch.mock.calls.length).toBe(1);
  });
});
