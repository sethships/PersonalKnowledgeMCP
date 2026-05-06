/**
 * Shared file/directory eligibility predicates for local-folder traversals.
 *
 * Three call sites previously walked the local-folder tree with three slightly
 * different filter chains:
 *
 *   1. `FileScanner` (the actual indexing scan) — applies `GitignoreFilter`,
 *      extension whitelist, `DEFAULT_EXCLUSIONS`, glob's `dot: false`, AND a
 *      1 MiB size cap.
 *   2. `LocalFolderChangeDetector` (per-update diff) — applied only the
 *      gitignore filter + extension whitelist.
 *   3. `IngestionService.enforceLocalFolderSizeGuardrails` (size pre-scan) —
 *      same as the change detector.
 *
 * The divergence produced two real correctness bugs (PR #573 review H-1+H-2):
 * change detection emitted spurious `added` events for files the scanner
 * subsequently discarded (size, dotfiles, default exclusions), and the size
 * guard tripped its hard refusal on files the scanner would never touch.
 *
 * This module centralizes the per-entry rules so all three callers agree:
 *
 *   - `shouldDescendDir(absDir, dirName, gitignore)` decides whether to walk
 *     INTO a directory entry.
 *   - `shouldIncludeFile(absPath, ent, opts)` decides whether to report a file.
 *
 * Notably, `shouldDescendDir` hard-skips standard VCS metadata directories
 * (`.git`, `.hg`, `.svn`, `.bzr`, `_darcs`) — addresses review L-1.
 *
 * @module ingestion/file-eligibility
 */

import { stat as fsStat } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { GitignoreFilter } from "./gitignore-filter.js";

/**
 * Default per-pattern exclusions applied by `FileScanner`. Mirrored here so
 * the local-folder change detector and the size guardrail respect the same
 * set without re-running glob.
 *
 * Patterns are intentionally simple and matched as POSIX path segments rather
 * than via a full glob engine — `FileScanner` already filtered through `glob`
 * by the time these are evaluated, but the change detector and size guard
 * walk the raw filesystem and need a cheap predicate.
 */
export const DEFAULT_EXCLUSION_DIR_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "bin",
  "obj",
]);

/**
 * Filename patterns that the scanner's `DEFAULT_EXCLUSIONS` reject regardless
 * of their parent directory. Stored as a literal-name set (no globs needed —
 * these are exact basenames or single-suffix matches handled inline).
 */
export const DEFAULT_EXCLUSION_FILE_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "yarn.lock",
]);

/**
 * Standard VCS metadata directories. These are always skipped during walks —
 * they contain no source content the indexer cares about and may include
 * arbitrarily large object stores.
 */
export const VCS_METADATA_DIR_NAMES: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  ".bzr",
  "_darcs",
]);

/**
 * Default maximum file size for indexable content (1 MiB).
 *
 * Mirrors `FileScanner.MAX_FILE_SIZE_BYTES`. Surfaced here so the change
 * detector and size guardrail can apply the same ceiling without depending
 * on `FileScanner` (which would create a cyclic-ish dependency through
 * `services/`).
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 1_048_576;

/** Lightweight directory entry shape, decoupled from `fs.Dirent`. */
export interface DirEntryLike {
  name: string;
  isDir: boolean;
  isSymlink: boolean;
}

/** Options accepted by {@link shouldIncludeFile}. */
export interface FileEligibilityOptions {
  /** Pre-loaded nested .gitignore filter rooted at the folder's root. */
  gitignore: GitignoreFilter;
  /**
   * Lowercased extension whitelist (each entry must include a leading dot,
   * e.g. `".ts"`). Empty set means "include nothing"; callers should populate
   * with `DEFAULT_EXTENSIONS` when no override is configured.
   */
  extensions: ReadonlySet<string>;
  /**
   * Maximum file size in bytes. Files at or below this size pass; files above
   * are excluded. Match the scanner's 1 MiB ceiling unless callers have a
   * specific reason to deviate.
   */
  maxSizeBytes: number;
  /**
   * Optional injection hook for `fs.stat`. Defaults to `node:fs/promises.stat`.
   * Tests pass in fakes here; production callers should leave undefined.
   */
  stat?: (path: string) => Promise<Stats>;
}

/**
 * Decide whether a directory entry should be descended into during a walk.
 *
 * Hard-skips:
 *   - VCS metadata dirs ({@link VCS_METADATA_DIR_NAMES})
 *   - dependency / build artifact directories
 *     ({@link DEFAULT_EXCLUSION_DIR_NAMES})
 *   - dotfile-prefixed directories (matches `glob`'s `dot: false`)
 *   - directories the {@link GitignoreFilter} reports as ignored
 *
 * Symlink-resolved directories are NOT covered here; callers must
 * pre-filter `entry.isSymbolicLink()` since walking a symlink risks cycles
 * and out-of-tree escape.
 *
 * @param absDirPath Absolute path of the directory being considered.
 * @param dirName Basename of the directory.
 * @param gitignore Pre-loaded nested .gitignore filter.
 */
export function shouldDescendDir(
  absDirPath: string,
  dirName: string,
  gitignore: GitignoreFilter
): boolean {
  if (VCS_METADATA_DIR_NAMES.has(dirName)) return false;
  if (DEFAULT_EXCLUSION_DIR_NAMES.has(dirName)) return false;
  // Match glob's `dot: false`: dot-prefixed directories are not traversed.
  if (dirName.startsWith(".")) return false;
  if (gitignore.isIgnored(absDirPath)) return false;
  return true;
}

/**
 * Decide whether a file entry should be included by a walk.
 *
 * Mirrors `FileScanner.collectFileMetadata` exactly:
 *   - skip symlinks (cycle / escape risk)
 *   - skip dot-prefixed file names (glob `dot: false` parity)
 *   - skip per-pattern excluded basenames (`package-lock.json`, `*.min.js`,
 *     `*.min.css`, `yarn.lock`)
 *   - apply the gitignore filter
 *   - require the file extension to be in the whitelist
 *   - reject files larger than `maxSizeBytes`
 *
 * `stat` is invoked only after the cheap predicates pass (extension and name
 * checks), to avoid an `fs.stat` per ineligible file.
 *
 * @returns A {@link FileEligibilityResult} describing whether the file is
 *   eligible and, when it is, the file's `Stats`. Returning the stats lets
 *   callers reuse them without a second syscall.
 */
export interface FileEligibilityResult {
  eligible: boolean;
  /** Populated only when `eligible === true`. */
  stats?: Stats;
}

export async function shouldIncludeFile(
  absPath: string,
  ent: DirEntryLike,
  opts: FileEligibilityOptions
): Promise<FileEligibilityResult> {
  // Symlinks: never (cycle / out-of-tree escape).
  if (ent.isSymlink) return { eligible: false };
  // Dot-prefixed filenames mirror glob's `dot: false`.
  if (ent.name.startsWith(".")) return { eligible: false };
  // Default exclusion basenames (lockfiles, minified builds).
  if (DEFAULT_EXCLUSION_FILE_NAMES.has(ent.name)) return { eligible: false };
  if (ent.name.endsWith(".min.js") || ent.name.endsWith(".min.css")) {
    return { eligible: false };
  }

  // Extension whitelist (lowercased lookup, must include leading dot).
  const dotIdx = ent.name.lastIndexOf(".");
  const ext = dotIdx >= 0 ? ent.name.substring(dotIdx).toLowerCase() : "";
  if (!opts.extensions.has(ext)) return { eligible: false };

  // .gitignore is evaluated before stat() to avoid a syscall on ignored files.
  if (opts.gitignore.isIgnored(absPath)) return { eligible: false };

  const stat = opts.stat ?? fsStat;
  let st: Stats;
  try {
    st = await stat(absPath);
  } catch {
    return { eligible: false };
  }

  // Defensive: reject anything that isn't a regular file.
  if (!st.isFile()) return { eligible: false };
  if (st.size > opts.maxSizeBytes) return { eligible: false };

  return { eligible: true, stats: st };
}
