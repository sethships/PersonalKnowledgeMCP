/**
 * Orphan FileManifest reaper.
 *
 * On startup, deletes any persisted `FileManifest` whose repository name does
 * not appear in `RepositoryMetadataService.listRepositories()`. This addresses
 * PR #573 review M-2: a `local-folder` registration that crashes between
 * `writeInitialFileManifest` and `repositoryService.updateRepository` leaves
 * a manifest file on disk with no matching metadata entry. If the user then
 * re-registers the same path under a DIFFERENT name, the original orphan
 * persists indefinitely — `removeRepository` only deletes manifests for names
 * the metadata store knows about.
 *
 * The reaper is idempotent and best-effort: failures to delete an individual
 * orphan are logged at warn level and don't block boot. We never DELETE a
 * manifest that has a metadata entry, so the reaper cannot regress active
 * repositories.
 *
 * @module services/orphan-manifest-reaper
 */

import { getComponentLogger } from "../logging/index.js";
import type { RepositoryMetadataService } from "../repositories/types.js";
import type { FileManifestStoreService } from "./file-manifest-store.js";

/**
 * Result of a single reaper invocation.
 *
 * Surfaced to the caller for logging / observability — there's no further
 * action required because the orphans have already been deleted.
 */
export interface ReaperResult {
  /** Total manifests examined. */
  totalManifests: number;
  /** Names of manifests deleted as orphans. */
  reaped: string[];
  /** Names of manifests retained because they have a metadata entry. */
  retained: string[];
  /** Names that were detected as orphans but failed to delete. */
  failed: string[];
}

/**
 * Delete every persisted manifest whose repository name is absent from the
 * metadata store.
 *
 * @param metadataService Source of truth for valid repository names.
 * @param manifestStore Manifest persistence layer (typically the singleton
 *   `FileManifestStoreImpl.getInstance()`).
 * @returns A {@link ReaperResult} summarizing what was reaped and retained.
 */
export async function pruneOrphanManifests(
  metadataService: RepositoryMetadataService,
  manifestStore: FileManifestStoreService
): Promise<ReaperResult> {
  const logger = getComponentLogger("services:orphan-manifest-reaper");

  const [registeredRepos, manifestRepos] = await Promise.all([
    metadataService.listRepositories(),
    manifestStore.listManifests(),
  ]);

  const knownNames = new Set<string>(registeredRepos.map((r) => r.name));
  const reaped: string[] = [];
  const retained: string[] = [];
  const failed: string[] = [];

  for (const name of manifestRepos) {
    if (knownNames.has(name)) {
      retained.push(name);
      continue;
    }
    try {
      await manifestStore.deleteManifest(name);
      reaped.push(name);
    } catch (err) {
      failed.push(name);
      logger.warn(
        { repository: name, err },
        "Failed to delete orphan manifest (will retry on next boot)"
      );
    }
  }

  if (reaped.length > 0) {
    logger.info(
      { reapedCount: reaped.length, reaped, retained: retained.length },
      "Reaped orphan FileManifest entries"
    );
  } else {
    logger.debug(
      { totalManifests: manifestRepos.length, retained: retained.length },
      "No orphan manifests detected"
    );
  }

  return {
    totalManifests: manifestRepos.length,
    reaped,
    retained,
    failed,
  };
}
