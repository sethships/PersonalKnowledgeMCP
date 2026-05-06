/**
 * Change detection for `local-folder` repositories.
 *
 * Diffs the current state of a registered folder against its last persisted
 * `FileManifest` and emits `FileChange[]` matching the contract that
 * `IncrementalUpdatePipeline.processChanges` already accepts. This is the
 * non-git equivalent of the `git diff --name-status` output that drives
 * `IncrementalUpdateCoordinator`'s git-remote and local-git paths.
 *
 * The diff algorithm is `(size, mtime)`-fast-path with sha256 fallback:
 *
 *   - In current, not in manifest      → `added`   (sha256 captured for the new manifest)
 *   - In manifest, not in current      → `deleted`
 *   - Both, `(size, mtime)` differ     → recompute sha256
 *       - hashes also differ           → `modified`
 *       - hashes match (touch only)    → skip; carry the prior fingerprint forward
 *   - Both, `(size, mtime)` match      → skip (fast path; no hash)
 *   - `paranoid: true`                 → unconditionally hash both sides;
 *                                         mitigates the SMB / Docker bind-mount
 *                                         mtime-unreliability risk in the
 *                                         implementation plan §5.
 *
 * Renames are NOT detected in v1; a moved file is reported as `deleted` +
 * `added`. The downstream pipeline re-embeds the new path; the only cost is
 * the wasted re-embed which is acceptable for v1.
 *
 * @module services/local-folder-change-detector
 */

import { readdir } from "node:fs/promises";
import { join, relative, sep, posix } from "node:path";
import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import { GitignoreFilter } from "../ingestion/gitignore-filter.js";
import { DEFAULT_EXTENSIONS } from "../ingestion/default-extensions.js";
import {
  shouldDescendDir,
  shouldIncludeFile,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  type DirEntryLike,
} from "../ingestion/file-eligibility.js";
import { streamSha256 } from "../ingestion/sha256-stream.js";
import {
  FileManifestStoreImpl,
  type FileManifest,
  type FileManifestEntry,
} from "./file-manifest-store.js";
import type { RepositoryInfo } from "../repositories/types.js";
import type { FileChange } from "./incremental-update-types.js";

/** Options controlling change-detection behavior. */
export interface DetectOptions {
  /**
   * When `true`, recompute sha256 for every file even when `(size, mtime)`
   * match the manifest. Off by default. Useful on filesystems that report
   * unreliable mtimes (SMB, certain Docker bind mounts) — costlier but
   * impervious to mtime drift.
   */
  paranoid?: boolean;
}

/**
 * Result of a `detect()` call.
 *
 * `changes` is what the update pipeline consumes; `nextManifestFiles` is the
 * fingerprint map the coordinator will persist after the pipeline succeeds
 * (so a partial pipeline failure does NOT leave the on-disk manifest ahead
 * of the actual chunk/graph state).
 */
export interface ChangeDetectionResult {
  changes: FileChange[];
  /** New per-file fingerprints, keyed by POSIX-relative path. */
  nextManifestFiles: Record<string, FileManifestEntry>;
}

/**
 * Detects file-level changes in a `local-folder` repository by diffing the
 * filesystem against the persisted `FileManifest`.
 */
export class LocalFolderChangeDetector {
  private readonly logger: Logger;
  private readonly manifestStore: FileManifestStoreImpl;

  constructor(manifestStore?: FileManifestStoreImpl) {
    this.logger = getComponentLogger("services:local-folder-change-detector");
    this.manifestStore = manifestStore ?? FileManifestStoreImpl.getInstance();
  }

  /**
   * Diff the current state of `repo.localPath` against `repo`'s manifest.
   *
   * @param repo - Repository metadata (must have `source === "local-folder"`).
   *   Caller is responsible for validating that the localPath still exists;
   *   this method will surface filesystem errors as a thrown `Error` rather
   *   than fabricating changes.
   * @param opts - Detection options (paranoid mode).
   * @returns Changes + the new fingerprint map for the next manifest write.
   */
  async detect(repo: RepositoryInfo, opts: DetectOptions = {}): Promise<ChangeDetectionResult> {
    const startMs = Date.now();
    const prior = await this.manifestStore.loadManifest(repo.name);
    const filter = await GitignoreFilter.load(repo.localPath);
    const extensions: Set<string> = new Set(
      (repo.includeExtensions.length > 0 ? repo.includeExtensions : DEFAULT_EXTENSIONS).map((e) =>
        e.toLowerCase()
      )
    );

    // Build the "current snapshot" — POSIX relative path → (sizeBytes, mtimeMs).
    const current = new Map<string, { absPath: string; sizeBytes: number; mtimeMs: number }>();
    await this.walk(repo.localPath, repo.localPath, filter, extensions, current);

    const changes: FileChange[] = [];
    const nextManifestFiles: Record<string, FileManifestEntry> = {};

    // Pass 1: files present in the current snapshot.
    for (const [relPath, snap] of current.entries()) {
      const priorEntry = prior.files[relPath];
      const fastPathMatch =
        !opts.paranoid &&
        priorEntry !== undefined &&
        priorEntry.sizeBytes === snap.sizeBytes &&
        priorEntry.mtimeMs === snap.mtimeMs;

      if (fastPathMatch && priorEntry) {
        // Unchanged — carry the prior fingerprint forward without re-hashing.
        nextManifestFiles[relPath] = priorEntry;
        continue;
      }

      // Either added, modified, or paranoid recheck — we need a fresh hash.
      let sha256: string;
      try {
        sha256 = await streamSha256(snap.absPath);
      } catch (err) {
        // Hash failure (transient I/O, permission flake, etc.) — emit the
        // file as `modified` (or `added` when no prior entry) and DROP it
        // from the next manifest. This forces a re-hash on the next update
        // rather than leaving the prior fingerprint in place, which would
        // make a genuinely-modified-but-temporarily-unreadable file look
        // unchanged forever once the read recovers and `(size, mtime)`
        // happens to match.
        this.logger.warn(
          { relPath, err },
          "Could not hash file; emitting as changed and skipping fingerprint"
        );
        if (priorEntry) {
          changes.push({ path: relPath, status: "modified" });
        } else {
          changes.push({ path: relPath, status: "added" });
        }
        // Intentionally do NOT add an entry to nextManifestFiles for this path —
        // the next walk will discover it again and try to hash from scratch.
        continue;
      }

      const fingerprint: FileManifestEntry = {
        sha256,
        sizeBytes: snap.sizeBytes,
        mtimeMs: snap.mtimeMs,
      };
      nextManifestFiles[relPath] = fingerprint;

      if (!priorEntry) {
        changes.push({ path: relPath, status: "added" });
      } else if (priorEntry.sha256 !== sha256) {
        changes.push({ path: relPath, status: "modified" });
      }
      // else: hash matches; either a touch (mtime drift) or a paranoid hit.
      // Either way the content is unchanged — no FileChange emitted.
    }

    // Pass 2: deletions — files in prior manifest but no longer on disk.
    for (const relPath of Object.keys(prior.files)) {
      if (!current.has(relPath)) {
        changes.push({ path: relPath, status: "deleted" });
      }
    }

    this.logger.info(
      {
        repository: repo.name,
        currentFileCount: current.size,
        priorFileCount: Object.keys(prior.files).length,
        changeCount: changes.length,
        durationMs: Date.now() - startMs,
        paranoid: Boolean(opts.paranoid),
      },
      "Local folder change detection complete"
    );

    return { changes, nextManifestFiles };
  }

  /**
   * Recursively walk `dir` accumulating per-file snapshots into `out`.
   *
   * Eligibility (gitignore, extension whitelist, default exclusions, dotfile
   * skip, VCS metadata skip, size cap, symlink skip) is delegated to the
   * shared `shouldDescendDir` / `shouldIncludeFile` predicates so this walk
   * agrees with `FileScanner` on what counts as an indexable file. See
   * `src/ingestion/file-eligibility.ts` for the full rule list.
   *
   * @param rootPath - Repository root (used to compute POSIX-relative paths)
   * @param dir - Current directory being walked
   * @param filter - Pre-loaded nested .gitignore filter
   * @param extensions - Lowercased extension whitelist (with leading dot)
   * @param out - Map to fill, keyed by POSIX-relative path
   */
  private async walk(
    rootPath: string,
    dir: string,
    filter: GitignoreFilter,
    extensions: Set<string>,
    out: Map<string, { absPath: string; sizeBytes: number; mtimeMs: number }>
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      this.logger.debug({ dir, err }, "readdir failed during walk; skipping");
      return;
    }

    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      // Symlinks are never followed (cycle / out-of-tree escape).
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (!shouldDescendDir(absPath, entry.name, filter)) continue;
        await this.walk(rootPath, absPath, filter, extensions, out);
        continue;
      }

      if (!entry.isFile()) continue;

      const ent: DirEntryLike = { name: entry.name, isDir: false, isSymlink: false };
      const verdict = await shouldIncludeFile(absPath, ent, {
        gitignore: filter,
        extensions,
        maxSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
      });
      if (!verdict.eligible || !verdict.stats) continue;

      const relPath = posix.normalize(relative(rootPath, absPath).split(sep).join(posix.sep));
      out.set(relPath, {
        absPath,
        sizeBytes: verdict.stats.size,
        mtimeMs: verdict.stats.mtimeMs,
      });
    }
  }

  /**
   * Convenience helper for callers that need to write the next manifest after
   * the update pipeline succeeds. Wraps the entries in the standard manifest
   * envelope and delegates to the store.
   */
  buildNextManifest(repository: string, entries: Record<string, FileManifestEntry>): FileManifest {
    return {
      version: "1.0",
      repository,
      generatedAt: new Date().toISOString(),
      files: entries,
    };
  }
}
