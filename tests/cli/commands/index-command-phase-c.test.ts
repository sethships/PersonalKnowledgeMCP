/**
 * Phase C tests for the `index` CLI command (issue #566 / T4.1).
 *
 * Covers: auto-detect local-folder vs git URL, the new `--tier`, `--watch`,
 * `--no-watch`, and `--follow-symlinks` flags, refusal of watch flags on git
 * URLs, and that local-folder defaults (watch=true) flow through to
 * `IngestionService.indexRepository`.
 *
 * @module tests/cli/commands/index-command-phase-c
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { indexCommand } from "../../../src/cli/commands/index-command.js";
import type { CliDependencies } from "../../../src/cli/utils/dependency-init.js";
import type { IndexResult } from "../../../src/services/ingestion-types.js";
import { initializeLogger, resetLogger } from "../../../src/logging/index.js";

function makeIndexResult(name: string): IndexResult {
  return {
    status: "success",
    repository: name,
    collectionName: `repo_${name}`,
    stats: {
      filesScanned: 1,
      filesProcessed: 1,
      filesFailed: 0,
      chunksCreated: 1,
      embeddingsGenerated: 1,
      documentsStored: 1,
      durationMs: 1,
    },
    errors: [],
    completedAt: new Date(),
  };
}

describe("Index command — Phase C local-folder flags", () => {
  let folderDir: string;
  let gitDir: string;
  let mockIndexRepository: ReturnType<typeof mock>;
  let deps: CliDependencies;

  beforeEach(async () => {
    initializeLogger({ level: "silent", format: "json" });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    folderDir = join(import.meta.dir, "..", "..", "..", "test-temp", `idx-folder-${stamp}`);
    gitDir = join(import.meta.dir, "..", "..", "..", "test-temp", `idx-git-${stamp}`);
    await mkdir(folderDir, { recursive: true });
    await mkdir(join(gitDir, ".git"), { recursive: true });

    mockIndexRepository = mock(async (_url: string, _opts: any) =>
      makeIndexResult("auto-name")
    );
    deps = {
      ingestionService: { indexRepository: mockIndexRepository },
      repositoryService: { getRepository: mock(async () => null) },
    } as unknown as CliDependencies;
  });

  afterEach(async () => {
    await rm(folderDir, { recursive: true, force: true });
    await rm(gitDir, { recursive: true, force: true });
    resetLogger();
  });

  it("auto-detects a non-git folder and defaults watch=true", async () => {
    await indexCommand(folderDir, {}, deps);
    expect(mockIndexRepository.mock.calls.length).toBe(1);
    const opts = mockIndexRepository.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts["watch"]).toBe(true);
    expect(opts["followSymlinks"]).toBe(false);
  });

  it("auto-detects a local-git folder and does NOT default watch=true", async () => {
    await indexCommand(gitDir, {}, deps);
    const opts = mockIndexRepository.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts["watch"]).toBe(false);
  });

  it("honours --no-watch (option.watch = false) on a non-git folder", async () => {
    await indexCommand(folderDir, { watch: false }, deps);
    const opts = mockIndexRepository.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts["watch"]).toBe(false);
  });

  it("propagates --tier private and --follow-symlinks on a folder", async () => {
    await indexCommand(
      folderDir,
      { tier: "private", followSymlinks: true },
      deps
    );
    const opts = mockIndexRepository.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts["tier"]).toBe("private");
    expect(opts["followSymlinks"]).toBe(true);
    expect(opts["watch"]).toBe(true);
  });

  it("refuses --watch on a git URL", async () => {
    await expect(
      indexCommand("https://github.com/user/repo.git", { watch: true }, deps)
    ).rejects.toThrow(/local folders/i);
  });

  it("refuses --follow-symlinks on a git URL", async () => {
    await expect(
      indexCommand(
        "https://github.com/user/repo.git",
        { followSymlinks: true },
        deps
      )
    ).rejects.toThrow(/local folders/i);
  });
});
