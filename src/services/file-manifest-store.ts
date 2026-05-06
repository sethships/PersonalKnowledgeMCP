/**
 * File Manifest Store Implementation
 *
 * Per-repository content fingerprint storage. For `local-folder` repositories
 * (Phase A foundation, issue #564) the manifest captures sha256 + size + mtime
 * for every indexed file, enabling a future change detector to produce
 * `FileChange[]` for the existing incremental update pipeline.
 *
 * Mirrors the singleton + atomic-write + serialized-write-queue pattern from
 * `watched-folder-store.ts`. Each repository gets its own manifest file under
 * `{DATA_PATH}/manifests/<sanitized-repo-name>.json`.
 *
 * @module services/file-manifest-store
 */

import { join, dirname } from "path";
import { rename, unlink, mkdir } from "fs/promises";
import type { Logger } from "pino";
import { z } from "zod";
import { getComponentLogger } from "../logging/index.js";
import { sanitizeCollectionName } from "../repositories/metadata-store.js";

/**
 * Schema version literal for persisted manifests.
 *
 * Centralized so the TypeScript type, the zod runtime schema, and the on-disk
 * payload stay in lockstep. When bumping the schema, update only this constant
 * and the migration logic — the type and schema follow automatically (Issue
 * #11 from PR #569 review).
 */
export const FILE_MANIFEST_VERSION = "1.0";
export type FileManifestVersion = typeof FILE_MANIFEST_VERSION;

/**
 * Sentinel `generatedAt` value returned by `loadManifest` for repositories
 * with no persisted manifest.
 *
 * Callers can compare against this value to detect "never persisted" without
 * incurring a separate "exists" call. Using a fixed Unix-epoch ISO string
 * guarantees deterministic reads — two consecutive `loadManifest("missing")`
 * calls produce identical results, which matters for code that derives
 * `local-<isoDate>` markers from manifest timestamps (Issue #7 from PR #569
 * review).
 */
export const FILE_MANIFEST_EMPTY_GENERATED_AT = "1970-01-01T00:00:00.000Z";

/**
 * Per-file fingerprint record stored in a manifest.
 *
 * Captures enough state to detect content changes without re-hashing every file
 * on every scan: a fast `(size, mtimeMs)` pair short-circuits unchanged files;
 * sha256 is consulted only when size or mtime differs.
 */
export interface FileManifestEntry {
  /** SHA-256 hex digest of the file's contents (64 lowercase hex chars). */
  sha256: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** POSIX modification time in milliseconds. */
  mtimeMs: number;
}

/**
 * Persisted manifest for a single repository.
 *
 * Stored at `{DATA_PATH}/manifests/<sanitized-repo-name>.json`. The `version`
 * field is a literal `"1.0"` to enable future schema migrations.
 */
export interface FileManifest {
  /** Schema version. Always `"1.0"` in this release (see `FILE_MANIFEST_VERSION`). */
  version: FileManifestVersion;
  /** Repository name this manifest belongs to (echoed back from caller). */
  repository: string;
  /** ISO 8601 timestamp of when this manifest snapshot was generated. */
  generatedAt: string;
  /**
   * Map of POSIX-normalized relative file paths (relative to the repository
   * root) to their fingerprints. Empty when the repository has no indexed
   * files yet.
   */
  files: Record<string, FileManifestEntry>;
}

/**
 * Service interface for persisting per-repository file manifests.
 */
export interface FileManifestStoreService {
  /**
   * Load the manifest for a repository.
   *
   * Returns an in-memory empty manifest if the manifest file does not exist;
   * the empty manifest is NOT written to disk by this call. The empty
   * manifest's `generatedAt` is a deterministic sentinel
   * (`FILE_MANIFEST_EMPTY_GENERATED_AT`, the Unix epoch ISO string) so two
   * consecutive misses return byte-identical results — callers can compare
   * against the sentinel to detect "never persisted".
   *
   * @param repository - Repository name (matches `RepositoryInfo.name`).
   */
  loadManifest(repository: string): Promise<FileManifest>;

  /**
   * Persist a manifest for a repository using an atomic temp-file + rename.
   *
   * Concurrent calls are serialized through the internal write queue, so the
   * final on-disk state reflects the last-queued payload.
   *
   * @param repository - Repository name (matches `RepositoryInfo.name`).
   * @param manifest - Manifest payload to persist. The `repository` property of
   *                    the manifest is overridden with the `repository` argument
   *                    to keep storage and payload consistent.
   */
  saveManifest(repository: string, manifest: FileManifest): Promise<void>;

  /**
   * Remove the manifest for a repository.
   *
   * Idempotent — succeeds with no error when the manifest file does not exist.
   */
  deleteManifest(repository: string): Promise<void>;
}

/** Zod schema for a single fingerprint entry (validated on read). */
const FileManifestEntrySchema = z.object({
  sha256: z.string(),
  sizeBytes: z.number(),
  mtimeMs: z.number(),
});

/** Zod schema for the persisted manifest file format (validated on read). */
const FileManifestSchema = z.object({
  version: z.literal(FILE_MANIFEST_VERSION),
  repository: z.string(),
  generatedAt: z.string(),
  files: z.record(z.string(), FileManifestEntrySchema),
});

/**
 * Singleton implementation of the file manifest store.
 *
 * Manages per-repository manifest persistence under `{DATA_PATH}/manifests/`.
 * Follows the same singleton + atomic-write + serialized-write-queue pattern
 * as `WatchedFolderStoreImpl`.
 */
export class FileManifestStoreImpl implements FileManifestStoreService {
  private static instance: FileManifestStoreImpl | null = null;

  private readonly manifestsDir: string;
  private _logger: Logger | null = null;

  /** In-memory cache keyed by repository name. */
  private readonly cache: Map<string, FileManifest> = new Map();

  /** Serialized promise queue to prevent concurrent read-modify-write races. */
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(dataPath: string) {
    this.manifestsDir = join(dataPath, "manifests");
  }

  /** Lazy-initialized component logger. */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:file-manifest-store");
    }
    return this._logger;
  }

  /**
   * Get the singleton instance of the manifest store.
   *
   * @param dataPath - Optional data directory (defaults to `process.env.DATA_PATH || "./data"`).
   */
  public static getInstance(dataPath?: string): FileManifestStoreImpl {
    if (!FileManifestStoreImpl.instance) {
      const resolvedPath = dataPath || process.env["DATA_PATH"] || "./data";
      FileManifestStoreImpl.instance = new FileManifestStoreImpl(resolvedPath);
    } else if (dataPath !== undefined) {
      const logger = getComponentLogger("services:file-manifest-store");
      logger.warn(
        { requestedPath: dataPath },
        "getInstance called with dataPath after singleton already initialized - ignoring new path"
      );
    }
    return FileManifestStoreImpl.instance;
  }

  /**
   * Reset the singleton instance.
   *
   * **FOR TESTING ONLY**.
   *
   * @internal
   */
  public static resetInstance(): void {
    FileManifestStoreImpl.instance = null;
  }

  /**
   * Resolve the on-disk path for a repository's manifest file.
   *
   * Uses `sanitizeCollectionName` to produce a filesystem-safe basename
   * consistent with ChromaDB collection naming, then suffixes with an 8-char
   * hash of the original (case-preserved) repository name. The suffix is
   * required because `sanitizeCollectionName` lowercases and collapses
   * non-alphanumerics, so two distinct repository names (e.g. `"Foo"` vs
   * `"foo"`) would otherwise collide on a single manifest file even though
   * the metadata store treats them as distinct entries.
   */
  public getManifestPath(repository: string): string {
    const base = sanitizeCollectionName(repository);
    const suffix = Bun.hash(repository).toString(16).padStart(16, "0").substring(0, 8);
    return join(this.manifestsDir, `${base}_${suffix}.json`);
  }

  /**
   * Compute the stable manifest identifier for a repository.
   *
   * Phase B callers MUST persist this exact value in
   * `RepositoryInfo.lastManifestId` and pass it back to subsequent
   * `loadManifest`/`saveManifest` calls. The string is opaque — do not parse
   * it; treat it as a key. Today this is simply the repository name itself,
   * which is also the cache key used internally; that may change as the
   * store evolves, so consumers should always go through this method
   * (Issue #10 from PR #569 review).
   */
  public computeManifestId(repository: string): string {
    return repository;
  }

  async loadManifest(repository: string): Promise<FileManifest> {
    const cached = this.cache.get(repository);
    if (cached) {
      return cloneManifest(cached);
    }

    const filePath = this.getManifestPath(repository);
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      this.logger.debug(
        { filePath, repository },
        "Manifest file not found - returning empty manifest"
      );
      return emptyManifest(repository);
    }

    try {
      const content = await file.text();
      const parsed: unknown = JSON.parse(content);
      const manifest = FileManifestSchema.parse(parsed);
      this.cache.set(repository, manifest);
      this.logger.debug(
        { filePath, repository, fileCount: Object.keys(manifest.files).length },
        "Manifest loaded from disk"
      );
      return cloneManifest(manifest);
    } catch (error) {
      this.logger.error(
        {
          filePath,
          repository,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to load manifest"
      );
      throw error;
    }
  }

  async saveManifest(repository: string, manifest: FileManifest): Promise<void> {
    const next = this.writeQueue.then(
      () => this.saveManifestInternal(repository, manifest),
      // Run regardless of whether the previous queued write succeeded or
      // failed. The previous failure was already surfaced to its own caller,
      // and we don't want one bad write to permanently poison the queue
      // (Issue #4 from PR #569 review).
      () => this.saveManifestInternal(repository, manifest)
    );
    // Keep the queue head a resolved promise so future enqueues stay ordered
    // but don't re-throw the failure of past tasks.
    this.writeQueue = next.catch(() => undefined);
    await next;
  }

  async deleteManifest(repository: string): Promise<void> {
    const next = this.writeQueue.then(
      () => this.deleteManifestInternal(repository),
      () => this.deleteManifestInternal(repository)
    );
    this.writeQueue = next.catch(() => undefined);
    await next;
  }

  private async saveManifestInternal(repository: string, manifest: FileManifest): Promise<void> {
    const filePath = this.getManifestPath(repository);
    const tempPath = `${filePath}.tmp`;

    // Ensure manifests/ directory exists
    await mkdir(dirname(filePath), { recursive: true });

    const payload: FileManifest = {
      version: FILE_MANIFEST_VERSION,
      repository,
      generatedAt: manifest.generatedAt,
      files: { ...manifest.files },
    };

    try {
      const content = JSON.stringify(payload, null, 2);
      await Bun.write(tempPath, content);
      await rename(tempPath, filePath);
      this.cache.set(repository, payload);
      this.logger.debug(
        { filePath, repository, fileCount: Object.keys(payload.files).length },
        "Manifest saved to disk"
      );
    } catch (error) {
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      this.logger.error(
        {
          filePath,
          repository,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to save manifest"
      );
      throw error;
    }
  }

  private async deleteManifestInternal(repository: string): Promise<void> {
    const filePath = this.getManifestPath(repository);
    try {
      await unlink(filePath);
      this.logger.debug({ filePath, repository }, "Manifest deleted");
    } catch (error) {
      // Idempotent: missing file is not an error
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug({ filePath, repository }, "Manifest already absent - no-op");
      } else {
        this.logger.error(
          {
            filePath,
            repository,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to delete manifest"
        );
        throw error;
      }
    } finally {
      this.cache.delete(repository);
    }
  }
}

/**
 * Construct an empty in-memory manifest for a repository.
 *
 * The `generatedAt` field is the deterministic sentinel
 * `FILE_MANIFEST_EMPTY_GENERATED_AT`, NOT the current time, so two
 * consecutive `loadManifest` calls for a missing repository return
 * byte-identical results (Issue #7 from PR #569 review).
 */
function emptyManifest(repository: string): FileManifest {
  return {
    version: FILE_MANIFEST_VERSION,
    repository,
    generatedAt: FILE_MANIFEST_EMPTY_GENERATED_AT,
    files: {},
  };
}

/** Deep-copy a manifest so callers can mutate the result without polluting the cache. */
function cloneManifest(manifest: FileManifest): FileManifest {
  return {
    version: manifest.version,
    repository: manifest.repository,
    generatedAt: manifest.generatedAt,
    files: { ...manifest.files },
  };
}
