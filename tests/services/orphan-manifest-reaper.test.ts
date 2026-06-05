/**
 * Tests for the orphan FileManifest reaper.
 *
 * Covers PR #573 review M-2: a `local-folder` registration that crashes
 * between manifest write and metadata write leaves an orphaned manifest. The
 * reaper deletes any manifest whose repository name is absent from the
 * metadata store.
 *
 * @module tests/services/orphan-manifest-reaper
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { FileManifestStoreImpl } from "../../src/services/file-manifest-store.js";
import { pruneOrphanManifests } from "../../src/services/orphan-manifest-reaper.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import type { RepositoryInfo, RepositoryMetadataService } from "../../src/repositories/types.js";

function makeRepo(name: string): RepositoryInfo {
  return {
    name,
    source: "local-folder",
    url: null,
    localPath: `/tmp/${name}`,
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

function makeMetadataService(repos: RepositoryInfo[]): RepositoryMetadataService {
  return {
    listRepositories: mock(async () => repos),
    getRepository: mock(async () => null),
    updateRepository: mock(async () => undefined),
    removeRepository: mock(async () => undefined),
  } as unknown as RepositoryMetadataService;
}

describe("pruneOrphanManifests", () => {
  let dataDir: string;
  let store: FileManifestStoreImpl;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dataDir = join(import.meta.dir, "..", "..", "test-temp", `omr-${stamp}`);
    await mkdir(dataDir, { recursive: true });
    FileManifestStoreImpl.resetInstance();
    store = FileManifestStoreImpl.getInstance(dataDir);
  });

  afterEach(async () => {
    FileManifestStoreImpl.resetInstance();
    await rm(dataDir, { recursive: true, force: true });
    resetLogger();
  });

  it("deletes manifests whose repository names are absent from metadata", async () => {
    // Two manifests on disk.
    await store.saveManifest("registered", {
      version: "1.0",
      repository: "registered",
      generatedAt: new Date().toISOString(),
      files: {},
    });
    await store.saveManifest("orphaned", {
      version: "1.0",
      repository: "orphaned",
      generatedAt: new Date().toISOString(),
      files: {},
    });

    // Only "registered" is in the metadata store.
    const metadata = makeMetadataService([makeRepo("registered")]);

    const result = await pruneOrphanManifests(metadata, store);

    expect(result.totalManifests).toBe(2);
    expect(result.reaped).toEqual(["orphaned"]);
    expect(result.retained).toEqual(["registered"]);
    expect(result.failed).toEqual([]);

    // Sanity: orphaned manifest is gone from the store.
    const orphanedAfter = await store.loadManifest("orphaned");
    expect(Object.keys(orphanedAfter.files)).toEqual([]);
    expect(orphanedAfter.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns an empty result when no manifests exist", async () => {
    const metadata = makeMetadataService([]);
    const result = await pruneOrphanManifests(metadata, store);
    expect(result.totalManifests).toBe(0);
    expect(result.reaped).toEqual([]);
    expect(result.retained).toEqual([]);
  });

  it("retains all manifests when every repository is registered", async () => {
    await store.saveManifest("a", {
      version: "1.0",
      repository: "a",
      generatedAt: new Date().toISOString(),
      files: {},
    });
    await store.saveManifest("b", {
      version: "1.0",
      repository: "b",
      generatedAt: new Date().toISOString(),
      files: {},
    });

    const metadata = makeMetadataService([makeRepo("a"), makeRepo("b")]);

    const result = await pruneOrphanManifests(metadata, store);

    expect(result.totalManifests).toBe(2);
    expect(result.reaped).toEqual([]);
    expect(result.retained.sort()).toEqual(["a", "b"]);
  });

  it("records a failure (instead of throwing) when deleteManifest rejects", async () => {
    await store.saveManifest("orphaned", {
      version: "1.0",
      repository: "orphaned",
      generatedAt: new Date().toISOString(),
      files: {},
    });

    // Wrap the real store so listManifests still works but deleteManifest fails.
    const wrapped: typeof store = {
      ...store,
      listManifests: () => store.listManifests(),
      loadManifest: (n: string) => store.loadManifest(n),
      saveManifest: (n: string, m: any) => store.saveManifest(n, m),
      deleteManifest: () => Promise.reject(new Error("permission denied")),
    } as any;

    const metadata = makeMetadataService([]);

    const result = await pruneOrphanManifests(metadata, wrapped);

    // Reaper completes without throwing; the failure is reported to the caller.
    expect(result.failed).toEqual(["orphaned"]);
    expect(result.reaped).toEqual([]);
  });
});
