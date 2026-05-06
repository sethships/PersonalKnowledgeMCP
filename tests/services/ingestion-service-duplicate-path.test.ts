/**
 * Phase C duplicate-path detection (issue #566 / T4.2).
 *
 * Registering a local-folder under a different name but the same on-disk path
 * must be refused with `LocalFolderPathAlreadyRegisteredError`. Force-flag
 * paths bypass the check (the user is explicitly opting into reindex).
 *
 * Comparison is canonicalised so case-different / mixed-separator strings
 * collide on Windows.
 *
 * @module tests/services/ingestion-service-duplicate-path
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve, normalize } from "node:path";
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

describe("IngestionService duplicate-path detection (Phase C T4.2)", () => {
  let testDir: string;
  let dataDir: string;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testDir = join(import.meta.dir, "..", "..", "test-temp", `is-dup-${stamp}`);
    dataDir = join(import.meta.dir, "..", "..", "test-temp", `is-dup-data-${stamp}`);
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

  it("refuses re-registration of the same path under a different name and points at the existing registration", async () => {
    const canonical = normalize(resolve(testDir));
    const existing: RepositoryInfo = {
      name: "first-name",
      source: "local-folder",
      url: null,
      localPath: canonical,
      collectionName: "first_name",
      fileCount: 0,
      chunkCount: 0,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: 0,
      status: "ready",
      branch: "(local-folder)",
      includeExtensions: [".ts"],
      excludePatterns: [],
      tier: "private",
    };

    const metadata = makeStubMetadata(existing);
    const svc = new IngestionService(
      { clone: mock(), cleanup: mock() } as any,
      { scanFiles: mock(async () => []) } as any,
      {} as any,
      makeStubProvider(),
      makeStubStorage(),
      metadata
    );

    // Path-collision is rethrown (mirrors RepositoryAlreadyExistsError) so the
    // CLI/MCP wrapper can format a user-actionable message with the existing
    // registration's name.
    let caught: unknown;
    try {
      await svc.indexRepository(testDir, { name: "second-name" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const error = caught as Error & { existingRepository?: string };
    expect(error.name).toBe("LocalFolderPathAlreadyRegisteredError");
    expect(error.existingRepository).toBe("first-name");
    expect(error.message).toContain("first-name");
    expect(error.message).toContain(canonical);
  });

  it("does NOT refuse re-registration of the same path under the SAME name (name collision is handled by RepositoryAlreadyExistsError)", async () => {
    // Seed an existing entry with the SAME name we're about to register again.
    const canonical = normalize(resolve(testDir));
    const existing: RepositoryInfo = {
      name: "same-name",
      source: "local-folder",
      url: null,
      localPath: canonical,
      collectionName: "same_name",
      fileCount: 0,
      chunkCount: 0,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: 0,
      status: "ready",
      branch: "(local-folder)",
      includeExtensions: [".ts"],
      excludePatterns: [],
      tier: "private",
    };

    const metadata = makeStubMetadata(existing);
    const svc = new IngestionService(
      { clone: mock(), cleanup: mock() } as any,
      { scanFiles: mock(async () => []) } as any,
      {} as any,
      makeStubProvider(),
      makeStubStorage(),
      metadata
    );

    // Same-name produces RepositoryAlreadyExistsError (also rethrown), NOT
    // the path-collision error — the existing name-collision path runs first.
    let caught: unknown;
    try {
      await svc.indexRepository(testDir, { name: "same-name" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const error = caught as Error;
    expect(error.name).toBe("RepositoryAlreadyExistsError");
    expect(error.message).toContain("already indexed");
    expect(error.message).not.toContain("already registered as repository");
  });

  it("allows re-registration when force=true (path-collision check is bypassed)", async () => {
    const canonical = normalize(resolve(testDir));
    const existing: RepositoryInfo = {
      name: "first-name",
      source: "local-folder",
      url: null,
      localPath: canonical,
      collectionName: "first_name",
      fileCount: 0,
      chunkCount: 0,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: 0,
      status: "ready",
      branch: "(local-folder)",
      includeExtensions: [".ts"],
      excludePatterns: [],
      tier: "private",
    };

    const metadata = makeStubMetadata(existing);
    const svc = new IngestionService(
      { clone: mock(), cleanup: mock() } as any,
      { scanFiles: mock(async () => []) } as any,
      {} as any,
      makeStubProvider(),
      makeStubStorage(),
      metadata
    );

    const result = await svc.indexRepository(testDir, {
      name: "second-name",
      force: true,
    });

    // The path-collision branch is skipped under force; the call may still
    // fail later for unrelated reasons (no scanned files, etc.) but the
    // failure must NOT be the path-already-registered error.
    const messages = result.errors.map((e) => e.message ?? "").join(" || ");
    expect(messages).not.toContain("already registered as repository");
  });
});
