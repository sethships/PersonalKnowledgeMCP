/**
 * Tests for `IngestionService.enforceLocalFolderSizeGuardrails`.
 *
 * Covers PR #573 review TEST-1: soft-warn, hard-refusal, and `--force` bypass
 * across the size-and-file-count guardrail. Thresholds are injected so tests
 * can use tiny limits (5 files / 1 KiB) without fixturing 100K files.
 *
 * @module tests/services/ingestion-service-size-guard
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { IngestionService } from "../../src/services/ingestion-service.js";
import { LocalFolderSizeRefusedError } from "../../src/services/ingestion-errors.js";
import { initializeLogger, resetLogger } from "../../src/logging/index.js";
import type { EmbeddingProvider } from "../../src/providers/types.js";
import type { ChromaStorageClient } from "../../src/storage/types.js";
import type { RepositoryMetadataService } from "../../src/repositories/types.js";

function stubProvider(): EmbeddingProvider {
  return {
    providerId: "stub",
    modelId: "stub-model",
    dimensions: 4,
    generateEmbedding: mock(async () => [0, 0, 0, 0] as number[]),
    generateEmbeddings: mock(async (texts: string[]) => texts.map(() => [0, 0, 0, 0] as number[])),
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

function stubStorage(): ChromaStorageClient {
  return {
    deleteCollection: mock(async () => undefined),
    addDocuments: mock(async () => undefined),
    getOrCreateCollection: mock(async () => undefined),
    healthCheck: mock(async () => true),
  } as unknown as ChromaStorageClient;
}

function stubMetadata(): RepositoryMetadataService {
  return {
    listRepositories: mock(async () => []),
    getRepository: mock(async () => null),
    updateRepository: mock(async () => undefined),
    removeRepository: mock(async () => undefined),
  } as unknown as RepositoryMetadataService;
}

function makeService(): IngestionService {
  return new IngestionService(
    { clone: mock(), cleanup: mock() } as any,
    { scanFiles: mock() } as any,
    {} as any,
    stubProvider(),
    stubStorage(),
    stubMetadata()
  );
}

describe("IngestionService.enforceLocalFolderSizeGuardrails", () => {
  let testDir: string;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testDir = join(import.meta.dir, "..", "..", "test-temp", `is-sg-${stamp}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    resetLogger();
  });

  it("returns no soft-warn under both soft thresholds", async () => {
    await writeFile(join(testDir, "a.ts"), "x");
    await writeFile(join(testDir, "b.ts"), "y");

    const result = await makeService().enforceLocalFolderSizeGuardrails(
      "tiny",
      testDir,
      {},
      {
        softFileLimit: 100,
        softByteLimit: 100_000,
        hardFileLimit: 1_000,
        hardByteLimit: 1_000_000,
      }
    );

    expect(result.fileCount).toBe(2);
    expect(result.softWarn).toBe(false);
  });

  it("flips softWarn=true once the soft file-count threshold is exceeded", async () => {
    // Six small files, soft file limit of 5.
    for (let i = 0; i < 6; i++) {
      await writeFile(join(testDir, `f${i}.ts`), "x");
    }

    const result = await makeService().enforceLocalFolderSizeGuardrails(
      "softfiles",
      testDir,
      {},
      {
        softFileLimit: 5,
        softByteLimit: 1_000_000,
        hardFileLimit: 1_000,
        hardByteLimit: 1_000_000,
      }
    );

    expect(result.fileCount).toBe(6);
    expect(result.softWarn).toBe(true);
  });

  it("flips softWarn=true once the soft byte-size threshold is exceeded", async () => {
    // Two files totalling 200 bytes; soft byte limit of 100.
    await writeFile(join(testDir, "a.ts"), "a".repeat(120));
    await writeFile(join(testDir, "b.ts"), "b".repeat(120));

    const result = await makeService().enforceLocalFolderSizeGuardrails(
      "softbytes",
      testDir,
      {},
      {
        softFileLimit: 100,
        softByteLimit: 100,
        hardFileLimit: 1_000,
        hardByteLimit: 1_000_000,
      }
    );

    expect(result.softWarn).toBe(true);
    expect(result.totalBytes).toBeGreaterThan(100);
  });

  it("throws LocalFolderSizeRefusedError when hard file-count threshold is exceeded", async () => {
    // Eight tiny files, hard file limit of 5.
    for (let i = 0; i < 8; i++) {
      await writeFile(join(testDir, `f${i}.ts`), "x");
    }

    let caught: unknown;
    try {
      await makeService().enforceLocalFolderSizeGuardrails(
        "hardfiles",
        testDir,
        {},
        {
          softFileLimit: 1,
          softByteLimit: 1,
          hardFileLimit: 5,
          hardByteLimit: 1_000_000,
        }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LocalFolderSizeRefusedError);
  });

  it("throws LocalFolderSizeRefusedError when hard byte-size threshold is exceeded", async () => {
    // One large file (1200 bytes), hard byte limit of 1024.
    await writeFile(join(testDir, "big.ts"), "x".repeat(1200));

    let caught: unknown;
    try {
      await makeService().enforceLocalFolderSizeGuardrails(
        "hardbytes",
        testDir,
        {},
        {
          softFileLimit: 1,
          softByteLimit: 1,
          hardFileLimit: 1_000,
          hardByteLimit: 1024,
        }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LocalFolderSizeRefusedError);
  });

  it("force=true bypasses hard refusal even when both hard thresholds are exceeded", async () => {
    // Eight files totalling >1500 bytes; hard limits set to 5 / 1024.
    for (let i = 0; i < 8; i++) {
      await writeFile(join(testDir, `f${i}.ts`), "x".repeat(200));
    }

    const result = await makeService().enforceLocalFolderSizeGuardrails(
      "forced",
      testDir,
      { force: true },
      {
        softFileLimit: 1,
        softByteLimit: 1,
        hardFileLimit: 5,
        hardByteLimit: 1024,
      }
    );

    // No throw; counts still report the full walk because the early-exit
    // branch is gated on `!options.force`.
    expect(result.fileCount).toBe(8);
    expect(result.softWarn).toBe(true);
  });

  it("respects the gitignore filter when counting files", async () => {
    await writeFile(join(testDir, ".gitignore"), "ignored.ts\n");
    await writeFile(join(testDir, "kept.ts"), "x");
    await writeFile(join(testDir, "ignored.ts"), "x");

    const result = await makeService().enforceLocalFolderSizeGuardrails(
      "gitignore",
      testDir,
      {},
      {
        softFileLimit: 100,
        softByteLimit: 100_000,
        hardFileLimit: 1_000,
        hardByteLimit: 1_000_000,
      }
    );

    // ignored.ts MUST be excluded — same eligibility predicate the scanner uses.
    expect(result.fileCount).toBe(1);
  });

  it("excludes default-exclusion directories like node_modules without a .gitignore", async () => {
    await writeFile(join(testDir, "kept.ts"), "x");
    const nm = join(testDir, "node_modules");
    await mkdir(nm, { recursive: true });
    for (let i = 0; i < 50; i++) {
      await writeFile(join(nm, `dep${i}.ts`), "x");
    }

    const result = await makeService().enforceLocalFolderSizeGuardrails(
      "nm",
      testDir,
      {},
      {
        softFileLimit: 100,
        softByteLimit: 100_000,
        hardFileLimit: 1_000,
        hardByteLimit: 1_000_000,
      }
    );

    // The 50 node_modules files MUST NOT count — divergence from FileScanner
    // here is the H-2 bug the shared eligibility predicate fixes.
    expect(result.fileCount).toBe(1);
  });

  it("excludes oversized files via the shared MAX_FILE_SIZE_BYTES cap", async () => {
    // The size cap is 1 MiB. Generate one file just over.
    const big = "y".repeat(1_048_576 + 100);
    await writeFile(join(testDir, "huge.ts"), big);
    await writeFile(join(testDir, "small.ts"), "z");

    const result = await makeService().enforceLocalFolderSizeGuardrails(
      "oversized",
      testDir,
      {},
      {
        softFileLimit: 100,
        softByteLimit: 100_000_000,
        hardFileLimit: 1_000,
        hardByteLimit: 1_000_000_000,
      }
    );

    // The huge file is excluded; only `small.ts` counts.
    expect(result.fileCount).toBe(1);
  });
});
