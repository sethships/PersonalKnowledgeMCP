/**
 * Integration tests for the local-folder lifecycle (#565 Phase B).
 *
 * Wires up real `RepositoryMetadataStoreImpl`, real `FileManifestStoreImpl`,
 * and a real filesystem fixture. The downstream `IncrementalUpdatePipeline` is
 * stubbed to avoid spinning up ChromaDB / FalkorDB — the focus here is
 * verifying that LocalFolderUpdateCoordinator correctly drives the manifest
 * + metadata round-trip end-to-end and surfaces drift_detected when the
 * registered folder disappears.
 *
 * Pipeline-level coverage (chunk updates, graph nodes) is already provided by
 * the existing IncrementalUpdatePipeline test suite and is not re-asserted
 * here; the contract between coordinator and pipeline is verified by mock.
 *
 * @module tests/integration/services/local-folder-lifecycle.integration.test
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositoryMetadataStoreImpl } from "../../../src/repositories/metadata-store.js";
import { FileManifestStoreImpl } from "../../../src/services/file-manifest-store.js";
import { LocalFolderUpdateCoordinator } from "../../../src/services/local-folder-update-coordinator.js";
import { LocalFolderChangeDetector } from "../../../src/services/local-folder-change-detector.js";
import type { IncrementalUpdatePipeline } from "../../../src/services/incremental-update-pipeline.js";
import type { RepositoryInfo } from "../../../src/repositories/types.js";
import type { UpdateResult } from "../../../src/services/incremental-update-types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

function makeRepo(name: string, localPath: string): RepositoryInfo {
  return {
    name,
    source: "local-folder",
    url: null,
    localPath,
    collectionName: `repo_${name}`,
    fileCount: 1,
    chunkCount: 1,
    lastIndexedAt: new Date().toISOString(),
    indexDurationMs: 0,
    status: "ready",
    branch: "(local-folder)",
    includeExtensions: [".ts", ".md"],
    excludePatterns: [],
    tier: "private",
    incrementalUpdateCount: 0,
  };
}

function defaultPipelineStub() {
  return {
    processChanges: mock(
      async (): Promise<UpdateResult> => ({
        stats: {
          filesAdded: 0,
          filesModified: 1,
          filesDeleted: 0,
          chunksUpserted: 3,
          chunksDeleted: 1,
          durationMs: 25,
        },
        errors: [],
        filterStats: {
          totalChanges: 1,
          eligibleChanges: 1,
          filteredChanges: 1,
          skippedChanges: 0,
        },
      })
    ),
  } as unknown as IncrementalUpdatePipeline;
}

describe("Local folder lifecycle integration", () => {
  let folderDir: string;
  let dataDir: string;
  let store: RepositoryMetadataStoreImpl;
  let manifestStore: FileManifestStoreImpl;

  beforeEach(async () => {
    initializeLogger({ level: "error", format: "json" });
    folderDir = await mkdtemp(join(tmpdir(), "lflc-folder-"));
    dataDir = await mkdtemp(join(tmpdir(), "lflc-data-"));
    RepositoryMetadataStoreImpl.resetInstance();
    FileManifestStoreImpl.resetInstance();
    store = RepositoryMetadataStoreImpl.getInstance(dataDir);
    manifestStore = FileManifestStoreImpl.getInstance(dataDir);
  });

  afterEach(async () => {
    try {
      await rm(folderDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    try {
      await rm(dataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    RepositoryMetadataStoreImpl.resetInstance();
    FileManifestStoreImpl.resetInstance();
    resetLogger();
  });

  it("registers a local folder, updates after a file change, and persists state", async () => {
    // 1. Seed the folder with one file and pre-populate the manifest as if
    //    IngestionService had just done its first scan.
    await writeFile(join(folderDir, "a.ts"), "console.log('v1');");
    const repo = makeRepo("smoke", folderDir);
    repo.lastManifestId = manifestStore.computeManifestId(repo.name);
    await store.updateRepository(repo);

    const detector = new LocalFolderChangeDetector(manifestStore);
    const seed = await detector.detect(repo);
    await manifestStore.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date(Date.now() - 60_000).toISOString(),
      files: seed.nextManifestFiles,
    });

    // 2. Modify the file so the next coordinator run will see one change.
    await writeFile(join(folderDir, "a.ts"), "console.log('v2-much-longer');");

    const pipeline = defaultPipelineStub();
    const coord = new LocalFolderUpdateCoordinator(store, pipeline, detector, manifestStore);

    const result = await coord.updateRepository(repo.name);

    expect(result.status).toBe("updated");
    expect(pipeline.processChanges).toHaveBeenCalledTimes(1);

    // Pipeline received the right shape: one modified path.
    const callArgs = (pipeline.processChanges as ReturnType<typeof mock>).mock.calls[0]!;
    const changes = callArgs[0] as Array<{ path: string; status: string }>;
    expect(changes).toEqual([{ path: "a.ts", status: "modified" }]);

    // Manifest now reflects v2 content.
    const persistedManifest = await manifestStore.loadManifest(repo.name);
    expect(persistedManifest.files["a.ts"]?.sizeBytes).toBeGreaterThan(20);

    // Repository metadata advanced: history entry + counters bumped.
    const updated = await store.getRepository(repo.name);
    expect(updated?.updateHistory?.length).toBe(1);
    expect(updated?.updateHistory?.[0]?.previousCommit.startsWith("local-")).toBe(true);
    expect(updated?.updateHistory?.[0]?.newCommit.startsWith("local-")).toBe(true);
    expect(updated?.incrementalUpdateCount).toBe(1);
    expect(updated?.updateInProgress ?? false).toBe(false);
  });

  it("reports drift_detected when the registered folder is gone", async () => {
    await mkdir(folderDir, { recursive: true });
    await writeFile(join(folderDir, "a.ts"), "x");
    const repo = makeRepo("drifted", folderDir);
    await store.updateRepository(repo);

    // Simulate the user moving / deleting their folder out from under us.
    await rm(folderDir, { recursive: true, force: true });

    const pipeline = defaultPipelineStub();
    const coord = new LocalFolderUpdateCoordinator(
      store,
      pipeline,
      new LocalFolderChangeDetector(manifestStore),
      manifestStore
    );

    const result = await coord.updateRepository(repo.name);
    expect(result.status).toBe("drift_detected");
    expect(pipeline.processChanges).not.toHaveBeenCalled();

    // Metadata is NOT mutated on drift — coordinator returns before any write.
    const after = await store.getRepository(repo.name);
    expect(after?.updateInProgress ?? false).toBe(false);
    expect(after?.updateHistory ?? []).toEqual([]);
  });

  it("returns no_changes when nothing on disk has moved", async () => {
    await writeFile(join(folderDir, "a.ts"), "stable");
    const repo = makeRepo("stable", folderDir);
    await store.updateRepository(repo);

    const detector = new LocalFolderChangeDetector(manifestStore);
    const seed = await detector.detect(repo);
    await manifestStore.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: seed.nextManifestFiles,
    });

    const pipeline = defaultPipelineStub();
    const coord = new LocalFolderUpdateCoordinator(store, pipeline, detector, manifestStore);

    const result = await coord.updateRepository(repo.name);
    expect(result.status).toBe("no_changes");
    expect(pipeline.processChanges).not.toHaveBeenCalled();
  });
});
