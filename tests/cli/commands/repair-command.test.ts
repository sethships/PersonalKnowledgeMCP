/**
 * Tests for Repair Command
 *
 * Verifies diagnose-and-repair behavior: complete (no-op), metadata drift,
 * targeted backfill of missing files, and dry-run (no writes).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
// Note: await-thenable disabled for `await expect(...).rejects.toThrow()` which
// returns a Promise that ESLint's type inference does not recognize.
/* eslint-disable @typescript-eslint/await-thenable */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "bun:test";
import { repairCommand } from "../../../src/cli/commands/repair-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { RepositoryInfo } from "../../../src/repositories/types.js";
import type { FileInfo } from "../../../src/ingestion/types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

function makeFiles(paths: string[]): FileInfo[] {
  return paths.map((p) => ({ relativePath: p })) as unknown as FileInfo[];
}

function pipelineResult(filesAdded: number, chunksUpserted: number) {
  return {
    stats: {
      filesAdded,
      filesModified: 0,
      filesDeleted: 0,
      chunksUpserted,
      chunksDeleted: 0,
      durationMs: 50,
    },
    errors: [],
    filterStats: {
      totalChanges: filesAdded,
      eligibleChanges: filesAdded,
      filteredChanges: filesAdded,
      skippedChanges: 0,
    },
  };
}

describe("Repair Command", () => {
  let mockDeps: CliDependencies;
  let mockGetRepository: Mock<() => Promise<RepositoryInfo | null>>;
  let mockUpdateRepository: Mock<(repo: RepositoryInfo) => Promise<void>>;
  let mockScanFiles: Mock<() => Promise<FileInfo[]>>;
  let mockListIndexed: Mock<() => Promise<Set<string>>>;
  let mockProcessChanges: Mock<(changes: any[], options: any) => Promise<any>>;
  let consoleLogSpy: Mock<(...args: any[]) => void>;

  const sampleRepo: RepositoryInfo = {
    name: "test-repo",
    url: "https://github.com/test/repo.git",
    localPath: "/repos/test-repo",
    branch: "main",
    collectionName: "repo_test_repo",
    status: "ready",
    fileCount: 2,
    chunkCount: 10,
    lastIndexedAt: new Date("2024-01-15T10:00:00Z").toISOString(),
    indexDurationMs: 5000,
    lastIndexedCommitSha: "abc123",
    includeExtensions: [".ts"],
    excludePatterns: ["node_modules/**"],
  };

  beforeEach(() => {
    initializeLogger({ level: "silent", format: "json" });

    mockGetRepository = vi.fn(async () => sampleRepo);
    mockUpdateRepository = vi.fn(async () => {});
    mockScanFiles = vi.fn(async () => makeFiles(["a.ts", "b.ts"]));
    mockListIndexed = vi.fn(async () => new Set(["a.ts", "b.ts"]));
    mockProcessChanges = vi.fn(async (changes: any[]) =>
      pipelineResult(changes.length, changes.length * 3)
    );

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockDeps = {
      repositoryService: {
        getRepository: mockGetRepository,
        updateRepository: mockUpdateRepository,
      },
      fileScanner: {
        scanFiles: mockScanFiles,
      },
      chromaClient: {
        listIndexedFilePaths: mockListIndexed,
      },
      updatePipeline: {
        processChanges: mockProcessChanges,
      },
    } as unknown as CliDependencies;
  });

  afterEach(() => {
    resetLogger();
    consoleLogSpy.mockRestore();
  });

  /** Parse the JSON object emitted by the command (json mode). */
  function getJsonOutput(): any {
    const call = consoleLogSpy.mock.calls
      .map((c) => c[0])
      .filter((arg): arg is string => typeof arg === "string")
      .find((arg) => arg.trim().startsWith("{"));
    return call ? JSON.parse(call) : undefined;
  }

  it("reports complete and makes no changes", async () => {
    await repairCommand("test-repo", { json: true }, mockDeps);

    expect(mockProcessChanges).not.toHaveBeenCalled();
    expect(mockUpdateRepository).not.toHaveBeenCalled();

    const out = getJsonOutput();
    expect(out.status).toBe("complete");
    expect(out.action).toBe("none");
  });

  it("repairs metadata drift without re-embedding", async () => {
    mockGetRepository = vi.fn(async () => ({ ...sampleRepo, fileCount: 9 }));
    mockDeps.repositoryService.getRepository = mockGetRepository;

    await repairCommand("test-repo", { json: true }, mockDeps);

    expect(mockProcessChanges).not.toHaveBeenCalled();
    expect(mockUpdateRepository).toHaveBeenCalledTimes(1);
    const saved = mockUpdateRepository.mock.calls[0]?.[0] as RepositoryInfo;
    expect(saved.fileCount).toBe(2);

    const out = getJsonOutput();
    expect(out.status).toBe("metadata_drift");
    expect(out.action).toBe("metadata_repaired");
  });

  it("backfills only the missing files", async () => {
    mockScanFiles = vi.fn(async () => makeFiles(["a.ts", "b.ts", "c.ts"]));
    mockDeps.fileScanner.scanFiles = mockScanFiles;
    let call = 0;
    mockListIndexed = vi.fn(async () => {
      call += 1;
      return call === 1 ? new Set(["a.ts", "b.ts"]) : new Set(["a.ts", "b.ts", "c.ts"]);
    });
    mockDeps.chromaClient.listIndexedFilePaths = mockListIndexed;

    await repairCommand("test-repo", { json: true }, mockDeps);

    expect(mockProcessChanges).toHaveBeenCalledTimes(1);
    const changes = mockProcessChanges.mock.calls[0]?.[0] as any[];
    expect(changes).toEqual([{ path: "c.ts", status: "added" }]);

    const out = getJsonOutput();
    expect(out.status).toBe("missing_files");
    expect(out.action).toBe("backfilled");
    expect(out.filesBackfilled).toBe(1);
    expect(out.chunksUpserted).toBe(3);
  });

  it("dry-run diagnoses without writing", async () => {
    mockScanFiles = vi.fn(async () => makeFiles(["a.ts", "b.ts", "c.ts"]));
    mockDeps.fileScanner.scanFiles = mockScanFiles;
    mockListIndexed = vi.fn(async () => new Set(["a.ts", "b.ts"]));
    mockDeps.chromaClient.listIndexedFilePaths = mockListIndexed;

    await repairCommand("test-repo", { dryRun: true, json: true }, mockDeps);

    expect(mockProcessChanges).not.toHaveBeenCalled();
    expect(mockUpdateRepository).not.toHaveBeenCalled();

    const out = getJsonOutput();
    expect(out.status).toBe("missing_files");
    expect(out.action).toBe("none");
    expect(out.dryRun).toBe(true);
    expect(out.missingFiles).toEqual(["c.ts"]);
  });

  it("exits with an error when the repository is not found", async () => {
    mockGetRepository = vi.fn(async () => null);
    mockDeps.repositoryService.getRepository = mockGetRepository;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => {
      throw new Error("process.exit called");
    }) as never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(repairCommand("missing", { json: true }, mockDeps)).rejects.toThrow(
      "process.exit called"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
