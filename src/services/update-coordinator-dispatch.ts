/**
 * Shared dispatch helper for picking the right update coordinator based on
 * a repository's `source`.
 *
 * Phase B introduced a parallel coordinator (`LocalFolderUpdateCoordinator`)
 * for `local-folder` repositories because the existing
 * `IncrementalUpdateCoordinator` requires a git commit SHA which local-folder
 * repos don't have. Multiple call sites — the `trigger_incremental_update`
 * MCP tool, the `pk-mcp update` and `update-all` CLI commands, and the
 * interrupted-update recovery service — all need the same dispatch logic.
 * Centralizing it here keeps the rule in one place.
 *
 * @module services/update-coordinator-dispatch
 */

import type { RepositoryInfo } from "../repositories/types.js";
import type { CoordinatorResult } from "./incremental-update-coordinator-types.js";
import type { IncrementalUpdateCoordinator } from "./incremental-update-coordinator.js";
import type { LocalFolderUpdateCoordinator } from "./local-folder-update-coordinator.js";

/**
 * Minimal structural surface every update coordinator must expose. Both
 * `IncrementalUpdateCoordinator` and `LocalFolderUpdateCoordinator` satisfy
 * this implicitly via duck typing.
 */
export interface UpdateCoordinatorLike {
  updateRepository(repositoryName: string): Promise<CoordinatorResult>;
}

/**
 * Pick the coordinator that matches `repo.source`.
 *
 * Returns `undefined` when the repo is `local-folder` but no
 * `localFolderCoordinator` was supplied — callers must handle this and
 * surface an error rather than misroute through the git coordinator (which
 * would throw `MissingCommitShaError` because local-folder repos have no
 * `lastIndexedCommitSha`).
 *
 * @param repo - The resolved `RepositoryInfo` for the target repository.
 * @param gitCoordinator - Coordinator used for `git-remote` and `local-git`.
 * @param localFolderCoordinator - Coordinator used for `local-folder`. May be
 *   `undefined` in legacy bootstrap paths.
 */
export function dispatchCoordinator(
  repo: RepositoryInfo,
  gitCoordinator: IncrementalUpdateCoordinator,
  localFolderCoordinator?: LocalFolderUpdateCoordinator
): UpdateCoordinatorLike | undefined {
  if (repo.source === "local-folder") {
    return localFolderCoordinator;
  }
  return gitCoordinator;
}
