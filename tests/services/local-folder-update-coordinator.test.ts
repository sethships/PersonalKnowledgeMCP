/**
 * Unit tests for LocalFolderUpdateCoordinator (T3.2 acceptance).
 *
 * @module tests/services/local-folder-update-coordinator
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LocalFolderUpdateCoordinator } from "../../src/services/local-folder-update-coordinator.js";
import { LocalFolderChangeDetector } from "../../src/services/local-folder-change-detector.js";
import { FileManifestStoreImpl } from "../../src/services/file-manifest-store.js";
import type { IncrementalUpdatePipeline } from "../../src/services/incremental-update-pipeline.js";
import type { RepositoryInfo, RepositoryMetadataService } from "../../src/repositories/types.js";
import type { UpdateResult } from "../../src/services/incremental-update-types.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";

function makeRepo(name: string, localPath: string): RepositoryInfo {
  return {
    name,
    source: "local-folder",
    url: null,
    localPath,
    collectionName: `repo_${name}`,
    fileCount: 0,
    chunkCount: 0,
    lastIndexedAt: new Date().toISOString(),
    indexDurationMs: 0,
    status: "ready",
    branch: "(local-folder)",
    includeExtensions: [".ts"],
    excludePatterns: [],
  };
}

function emptyUpdateResult(): UpdateResult {
  return {
    stats: {
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted: 0,
      chunksDeleted: 0,
      durationMs: 0,
    },
    errors: [],
    filterStats: {
      totalChanges: 0,
      eligibleChanges: 0,
      filteredChanges: 0,
      skippedChanges: 0,
    },
  };
}

interface MockMetadataService extends RepositoryMetadataService {
  current: RepositoryInfo | null;
  saved: RepositoryInfo[];
}

function makeMetadataService(initial: RepositoryInfo | null): MockMetadataService {
  const svc = {
    current: initial,
    saved: [] as RepositoryInfo[],
    listRepositories: mock(async () => (initial ? [initial] : [])),
    getRepository: mock(async (name: string) =>
      svc.current && svc.current.name === name ? svc.current : null
    ),
    updateRepository: mock(async (info: RepositoryInfo) => {
      svc.current = info;
      svc.saved.push(info);
    }),
    removeRepository: mock(async () => {
      svc.current = null;
    }),
  } as unknown as MockMetadataService;
  return svc;
}

describe("LocalFolderUpdateCoordinator", () => {
  let testDir: string;
  let dataDir: string;
  let store: FileManifestStoreImpl;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testDir = join(import.meta.dir, "..", "..", "test-temp", `lfuc-${stamp}`);
    dataDir = join(import.meta.dir, "..", "..", "test-temp", `lfuc-data-${stamp}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    FileManifestStoreImpl.resetInstance();
    store = FileManifestStoreImpl.getInstance(dataDir);
  });

  afterEach(async () => {
    FileManifestStoreImpl.resetInstance();
    await rm(testDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    resetLogger();
  });

  it("returns drift_detected when localPath is missing", async () => {
    const repo = makeRepo("driftRepo", join(testDir, "missing"));
    const metadata = makeMetadataService(repo);
    const pipeline = {
      processChanges: mock(async () => emptyUpdateResult()),
    } as unknown as IncrementalUpdatePipeline;
    const detector = new LocalFolderChangeDetector(store);
    const coord = new LocalFolderUpdateCoordinator(metadata, pipeline, detector, store);

    const result = await coord.updateRepository("driftRepo");

    expect(result.status).toBe("drift_detected");
    expect(pipeline.processChanges).not.toHaveBeenCalled();
  });

  it("returns no_changes when there is nothing to update", async () => {
    await writeFile(join(testDir, "a.ts"), "x");
    const repo = makeRepo("noChange", testDir);
    // Pre-seed manifest matching the current state so detector returns [].
    const detector = new LocalFolderChangeDetector(store);
    const initial = await detector.detect(repo);
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: initial.nextManifestFiles,
    });

    const metadata = makeMetadataService(repo);
    const pipeline = {
      processChanges: mock(async () => emptyUpdateResult()),
    } as unknown as IncrementalUpdatePipeline;
    const coord = new LocalFolderUpdateCoordinator(metadata, pipeline, detector, store);

    const result = await coord.updateRepository("noChange");
    expect(result.status).toBe("no_changes");
    expect(pipeline.processChanges).not.toHaveBeenCalled();
  });

  it("runs the pipeline and rewrites the manifest on a successful update", async () => {
    await writeFile(join(testDir, "a.ts"), "v1");
    const repo = makeRepo("happy", testDir);
    const detector = new LocalFolderChangeDetector(store);

    // Seed manifest reflecting v1.
    const seed = await detector.detect(repo);
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date(Date.now() - 60_000).toISOString(),
      files: seed.nextManifestFiles,
    });

    // Modify file → next detect() returns one modified change.
    await writeFile(join(testDir, "a.ts"), "v2-bigger");

    const metadata = makeMetadataService(repo);
    const pipeline = {
      processChanges: mock(async () => ({
        stats: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          chunksUpserted: 2,
          chunksDeleted: 1,
          durationMs: 12,
        },
        errors: [],
        filterStats: {
          totalChanges: 1,
          eligibleChanges: 1,
          filteredChanges: 1,
          skippedChanges: 0,
        },
      })),
    } as unknown as IncrementalUpdatePipeline;
    const coord = new LocalFolderUpdateCoordinator(metadata, pipeline, detector, store);

    const result = await coord.updateRepository("happy");

    expect(result.status).toBe("updated");
    expect(result.stats.filesModified).toBe(1);
    expect(pipeline.processChanges).toHaveBeenCalledTimes(1);

    // Manifest was rewritten — should now reflect the v2 content.
    const persisted = await store.loadManifest(repo.name);
    expect(persisted.files["a.ts"]?.sizeBytes).toBeGreaterThan(2);

    // History entry appended with local-<isoDate> markers.
    const final = metadata.saved[metadata.saved.length - 1];
    expect(final?.updateHistory?.length ?? 0).toBeGreaterThan(0);
    const hist = final?.updateHistory?.[0];
    expect(hist?.previousCommit.startsWith("local-")).toBe(true);
    expect(hist?.newCommit.startsWith("local-")).toBe(true);
    expect(final?.incrementalUpdateCount).toBe(1);
  });

  it("does NOT rewrite the manifest when the pipeline fully fails", async () => {
    await writeFile(join(testDir, "a.ts"), "v1");
    const repo = makeRepo("fail", testDir);
    const detector = new LocalFolderChangeDetector(store);

    const seed = await detector.detect(repo);
    const seedManifest = {
      version: "1.0" as const,
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: seed.nextManifestFiles,
    };
    await store.saveManifest(repo.name, seedManifest);

    // Modify file so detector emits a change.
    await writeFile(join(testDir, "a.ts"), "v2-bigger");

    const metadata = makeMetadataService(repo);
    const pipeline = {
      processChanges: mock(async () => ({
        stats: {
          filesAdded: 0,
          filesModified: 0,
          filesDeleted: 0,
          chunksUpserted: 0,
          chunksDeleted: 0,
          durationMs: 5,
        },
        // Pipeline reports an error and zero successful processing → "failed".
        errors: [{ path: "a.ts", error: "boom" }],
        filterStats: {
          totalChanges: 1,
          eligibleChanges: 1,
          filteredChanges: 1,
          skippedChanges: 0,
        },
      })),
    } as unknown as IncrementalUpdatePipeline;
    const coord = new LocalFolderUpdateCoordinator(metadata, pipeline, detector, store);

    const result = await coord.updateRepository("fail");
    expect(result.status).toBe("failed");

    // Manifest should still be the seed — old fingerprint preserved so the
    // next attempt sees the same diff and can retry.
    const persisted = await store.loadManifest(repo.name);
    expect(persisted.generatedAt).toBe(seedManifest.generatedAt);
  });

  it("preserves prior fingerprint for files the pipeline reported errors on (partial success)", async () => {
    // Three files modified on disk; pipeline succeeds on two (count=2) and errors
    // on one. With errors < processed, historyStatus is "partial" → manifest IS
    // rewritten. The errored file's prior fingerprint must be carried forward
    // so the next update sees its diff and retries it. Without the fix the
    // manifest would advance past the unprocessed file and silently lose the
    // index update.
    await writeFile(join(testDir, "ok1.ts"), "v1");
    await writeFile(join(testDir, "ok2.ts"), "v1");
    await writeFile(join(testDir, "bad.ts"), "v1");
    const repo = makeRepo("partial", testDir);
    const detector = new LocalFolderChangeDetector(store);

    const seed = await detector.detect(repo);
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: seed.nextManifestFiles,
    });
    const seededBad = seed.nextManifestFiles["bad.ts"]!;
    const seededOk1 = seed.nextManifestFiles["ok1.ts"]!;

    await writeFile(join(testDir, "ok1.ts"), "v2-bigger");
    await writeFile(join(testDir, "ok2.ts"), "v2-bigger");
    await writeFile(join(testDir, "bad.ts"), "v2-also-bigger");

    const metadata = makeMetadataService(repo);
    const pipeline = {
      processChanges: mock(async () => ({
        stats: {
          filesAdded: 0,
          filesModified: 2, // ok1 + ok2 succeeded
          filesDeleted: 0,
          chunksUpserted: 2,
          chunksDeleted: 0,
          durationMs: 5,
        },
        errors: [{ path: "bad.ts", error: "transient embedding failure" }],
        filterStats: {
          totalChanges: 3,
          eligibleChanges: 3,
          filteredChanges: 3,
          skippedChanges: 0,
        },
      })),
    } as unknown as IncrementalUpdatePipeline;
    const coord = new LocalFolderUpdateCoordinator(metadata, pipeline, detector, store);

    const result = await coord.updateRepository("partial");
    expect(result.status).toBe("updated"); // partial-success surfaces as "updated"

    const persisted = await store.loadManifest(repo.name);
    // ok1.ts advanced — sha differs from seed.
    expect(persisted.files["ok1.ts"]?.sha256).not.toBe(seededOk1.sha256);
    // bad.ts kept its prior fingerprint so the next update will see the diff.
    expect(persisted.files["bad.ts"]?.sha256).toBe(seededBad.sha256);
    expect(persisted.files["bad.ts"]?.sizeBytes).toBe(seededBad.sizeBytes);
    expect(persisted.files["bad.ts"]?.mtimeMs).toBe(seededBad.mtimeMs);
  });

  it("refuses to run for a repository whose source is not local-folder", async () => {
    const repo = { ...makeRepo("wrongSource", testDir), source: "git-remote" as const };
    const metadata = makeMetadataService(repo);
    const pipeline = {
      processChanges: mock(async () => emptyUpdateResult()),
    } as unknown as IncrementalUpdatePipeline;
    const coord = new LocalFolderUpdateCoordinator(metadata, pipeline);

    const result = await coord.updateRepository("wrongSource");
    expect(result.status).toBe("failed");
    expect(pipeline.processChanges).not.toHaveBeenCalled();
  });
});
