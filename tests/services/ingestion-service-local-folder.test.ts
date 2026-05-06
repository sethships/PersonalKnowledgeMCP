/**
 * Focused tests for `IngestionService` Phase B behaviors.
 *
 * - tier="public" + local-folder is refused.
 * - removeRepository deletes the FileManifest.
 *
 * Heavy mocked because IngestionService has many collaborators; we only need
 * the call surface and a real metadata + manifest store to assert against.
 *
 * @module tests/services/ingestion-service-local-folder
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { IngestionService } from "../../src/services/ingestion-service.js";
import { FileManifestStoreImpl } from "../../src/services/file-manifest-store.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import type { EmbeddingProvider } from "../../src/providers/types.js";
import type { ChromaStorageClient } from "../../src/storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../src/repositories/types.js";

function makeStubProvider(): EmbeddingProvider {
  return {
    providerId: "stub",
    modelId: "stub-model",
    dimensions: 4,
    generateEmbedding: mock(async () => [0.1, 0.2, 0.3, 0.4] as number[]),
    generateEmbeddings: mock(async (texts: string[]) =>
      texts.map(() => [0.1, 0.2, 0.3, 0.4] as number[])
    ),
    healthCheck: mock(async () => true),
    getCapabilities: () => ({
      maxBatchSize: 100,
      maxTokensPerText: 8191,
      supportsGPU: false,
      requiresNetwork: false,
      estimatedLatencyMs: 1,
    }),
  };
}

function makeStubStorage(): ChromaStorageClient {
  return {
    deleteCollection: mock(async () => undefined),
    createCollection: mock(async () => undefined),
    addDocuments: mock(async () => undefined),
    getCollection: mock(async () => null),
    listCollections: mock(async () => []),
    queryDocuments: mock(async () => ({ documents: [] })),
    healthCheck: mock(async () => true),
  } as unknown as ChromaStorageClient;
}

interface StubMetadata extends RepositoryMetadataService {
  data: Map<string, RepositoryInfo>;
}

function makeStubMetadata(seed?: RepositoryInfo): StubMetadata {
  const data = new Map<string, RepositoryInfo>();
  if (seed) data.set(seed.name, seed);
  return {
    data,
    listRepositories: mock(async () => Array.from(data.values())),
    getRepository: mock(async (name: string) => data.get(name) ?? null),
    updateRepository: mock(async (info: RepositoryInfo) => {
      data.set(info.name, info);
    }),
    removeRepository: mock(async (name: string) => {
      data.delete(name);
    }),
  } as unknown as StubMetadata;
}

describe("IngestionService Phase B", () => {
  let testDir: string;
  let dataDir: string;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testDir = join(import.meta.dir, "..", "..", "test-temp", `is-lfb-${stamp}`);
    dataDir = join(import.meta.dir, "..", "..", "test-temp", `is-lfb-data-${stamp}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    FileManifestStoreImpl.resetInstance();
    FileManifestStoreImpl.getInstance(dataDir);
  });

  afterEach(async () => {
    FileManifestStoreImpl.resetInstance();
    await rm(testDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    resetLogger();
  });

  it("refuses to register a local folder with tier='public'", async () => {
    await writeFile(join(testDir, "a.ts"), "x");

    const cloner = { clone: mock(), cleanup: mock() } as any;
    // Scanner is never called — the tier check fires before the scan phase.
    const scanner = { scanFiles: mock(async () => []) } as any;
    const chunker = {} as any;
    const provider = makeStubProvider();
    const storage = makeStubStorage();
    const metadata = makeStubMetadata();

    const svc = new IngestionService(cloner, scanner, chunker, provider, storage, metadata);

    const result = await svc.indexRepository(testDir, {
      name: "publicAttempt",
      tier: "public",
    });

    // The IngestionService catches non-Already/InProgress errors and converts
    // to a `failed` IndexResult — assert the failure surfaced the typed error.
    expect(result.status).toBe("failed");
    const errMessages = result.errors.map((e) => e.message ?? "");
    expect(errMessages.some((m) => m.includes("public") && m.includes("local"))).toBe(true);
  });

  it("removeRepository deletes the persisted FileManifest", async () => {
    // Seed a fake repo metadata + a manifest as if a prior local-folder index ran.
    const repo: RepositoryInfo = {
      name: "needs-cleanup",
      source: "local-folder",
      url: null,
      localPath: testDir,
      collectionName: "needs_cleanup",
      fileCount: 1,
      chunkCount: 1,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: 0,
      status: "ready",
      branch: "(local-folder)",
      includeExtensions: [".ts"],
      excludePatterns: [],
      tier: "private",
    };
    const metadata = makeStubMetadata(repo);
    const store = FileManifestStoreImpl.getInstance();
    await store.saveManifest(repo.name, {
      version: "1.0",
      repository: repo.name,
      generatedAt: new Date().toISOString(),
      files: { "a.ts": { sha256: "0".repeat(64), sizeBytes: 1, mtimeMs: 1 } },
    });

    // Sanity: manifest exists before removal.
    const before = await store.loadManifest(repo.name);
    expect(before.files).toHaveProperty(["a.ts"]);

    const svc = new IngestionService(
      { clone: mock(), cleanup: mock() } as any,
      { scanFiles: mock() } as any,
      {} as any,
      makeStubProvider(),
      makeStubStorage(),
      metadata
    );

    await svc.removeRepository(repo.name);

    // Manifest is gone from the store (loadManifest returns the empty sentinel).
    const after = await store.loadManifest(repo.name);
    expect(Object.keys(after.files)).toEqual([]);
  });
});
