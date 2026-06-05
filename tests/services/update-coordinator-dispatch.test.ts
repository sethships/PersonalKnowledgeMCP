/**
 * Unit tests for the source-aware update coordinator dispatch helper.
 *
 * Phase B added a parallel coordinator for `local-folder` repos; the dispatch
 * rule must stay consistent across the MCP tool, the CLI commands, and the
 * recovery service so a single helper is shared. This test pins the rule.
 *
 * @module tests/services/update-coordinator-dispatch
 */

import { describe, it, expect } from "bun:test";
import { dispatchCoordinator } from "../../src/services/update-coordinator-dispatch.js";
import type { IncrementalUpdateCoordinator } from "../../src/services/incremental-update-coordinator.js";
import type { LocalFolderUpdateCoordinator } from "../../src/services/local-folder-update-coordinator.js";
import type { RepositoryInfo } from "../../src/repositories/types.js";

function makeRepo(source: RepositoryInfo["source"]): RepositoryInfo {
  return {
    name: "x",
    source,
    url: source === "local-folder" ? null : "https://example.invalid/repo.git",
    localPath: "/tmp/x",
    collectionName: "x",
    fileCount: 0,
    chunkCount: 0,
    lastIndexedAt: new Date().toISOString(),
    indexDurationMs: 0,
    status: "ready",
    branch: "main",
    includeExtensions: [".ts"],
    excludePatterns: [],
  };
}

describe("dispatchCoordinator", () => {
  // Cast empty objects to the coordinator types — we never call methods on them
  // so the implementation surface is irrelevant; only identity matters.
  const gitCoord = { tag: "git" } as unknown as IncrementalUpdateCoordinator;
  const localCoord = { tag: "local" } as unknown as LocalFolderUpdateCoordinator;

  it("returns the git coordinator for git-remote sources", () => {
    expect(dispatchCoordinator(makeRepo("git-remote"), gitCoord, localCoord)).toBe(gitCoord);
  });

  it("returns the git coordinator for local-git sources", () => {
    expect(dispatchCoordinator(makeRepo("local-git"), gitCoord, localCoord)).toBe(gitCoord);
  });

  it("returns the local-folder coordinator for local-folder sources", () => {
    expect(dispatchCoordinator(makeRepo("local-folder"), gitCoord, localCoord)).toBe(localCoord);
  });

  it("returns undefined when local-folder source is requested but no local coordinator is supplied", () => {
    expect(dispatchCoordinator(makeRepo("local-folder"), gitCoord, undefined)).toBeUndefined();
  });

  it("still returns the git coordinator when source is git-remote even without a local coordinator", () => {
    expect(dispatchCoordinator(makeRepo("git-remote"), gitCoord, undefined)).toBe(gitCoord);
  });
});
