/**
 * Index Command - Index a repository for semantic search
 *
 * Clones a repository, processes files, generates embeddings, and stores in ChromaDB.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import type { CliDependencies } from "../utils/dependency-init.js";
import {
  createIndexSpinner,
  updateIndexSpinner,
  completeIndexSpinner,
} from "../output/progress.js";

/**
 * Index command options
 */
export interface IndexCommandOptions {
  name?: string;
  branch?: string;
  force?: boolean;
  /** Embedding provider to use (openai, transformersjs, local, ollama) */
  provider?: string;
  /** Security tier — passed through to IngestionService (which enforces folder-specific rules). */
  tier?: "private" | "work" | "public";
  /**
   * Whether to enable the filesystem watcher after indexing finishes. Only
   * applied when the path resolves to a `local-folder` source. `undefined`
   * means "use the default for this source" — true for local folders, false
   * for git sources.
   */
  watch?: boolean;
  /** Whether the local-folder watcher should follow symlinks. Default false. */
  followSymlinks?: boolean;
}

import { resolve, normalize, basename } from "node:path";
import { stat } from "node:fs/promises";
import { isLocalPath } from "../../utils/path-utils.js";

/**
 * Extract repository name from URL or local path.
 *
 * @param url - Git repository URL or local path
 * @returns Repository name
 */
function extractRepositoryName(url: string): string {
  if (isLocalPath(url)) {
    const name = basename(normalize(resolve(url)));
    if (!name || name === "." || name === "..") {
      throw new Error(
        "Could not extract repository name from local path. Please use --name to specify explicitly."
      );
    }
    return name;
  }

  // Remove trailing .git
  const cleanUrl = url.endsWith(".git") ? url.slice(0, -4) : url;

  // Extract last path segment
  const parts = cleanUrl.split("/");
  const lastPart = parts[parts.length - 1];

  // Handle edge cases
  if (!lastPart || lastPart === "") {
    throw new Error(
      "Could not extract repository name from URL. Please use --name to specify explicitly."
    );
  }

  // Security: Reject names with path traversal patterns
  if (lastPart.includes("..") || lastPart.includes("/") || lastPart.includes("\\")) {
    throw new Error(
      "Invalid repository name extracted from URL. Please use --name to specify explicitly."
    );
  }

  return lastPart;
}

/**
 * Validate repository URL or local path format.
 *
 * @param url - Git repository URL or local filesystem path
 * @returns True if valid, throws otherwise
 */
function validateUrl(url: string): boolean {
  // Local paths are accepted — the ingestion service validates existence
  if (isLocalPath(url)) return true;

  // Basic validation - ensure it looks like a Git URL for any host
  const gitUrlPattern = /^(https:\/\/|git@)[\w\-.]+(\/|:)[\w\-./]+\.git$/i;
  const gitUrlWithoutExtPattern = /^(https:\/\/|git@)[\w\-.]+(\/|:)[\w\-./]+$/i;

  if (!gitUrlPattern.test(url) && !gitUrlWithoutExtPattern.test(url)) {
    throw new Error(
      "Invalid repository URL or path format.\n" +
        "Expected: https://<host>/owner/repo.git, git@<host>:owner/repo.git, or a local path."
    );
  }

  return true;
}

/**
 * Execute index command
 *
 * Indexes a repository by URL with real-time progress updates.
 *
 * @param url - Git repository URL
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function indexCommand(
  url: string,
  options: IndexCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // Validate URL
  validateUrl(url);

  // Extract or use provided repository name
  const repositoryName = options.name || extractRepositoryName(url);

  // Resolve flag semantics by source. We auto-detect local vs git via
  // isLocalPath; for local paths we additionally probe `.git` so the watch
  // default doesn't activate for local-git sources (those have a remote
  // equivalent and shouldn't pull in the local-folder watcher pipeline).
  const looksLocal = isLocalPath(url);
  let isLocalFolderSource = false;
  if (looksLocal) {
    try {
      const resolved = normalize(resolve(url));
      const pathStat = await stat(resolved);
      if (pathStat.isDirectory()) {
        try {
          await stat(`${resolved}/.git`);
          isLocalFolderSource = false; // has .git → local-git, not local-folder
        } catch {
          isLocalFolderSource = true;
        }
      }
    } catch {
      // Path stat will fail again inside IngestionService and surface a typed
      // error; we just don't set the watcher defaults here.
    }
  }

  // Phase C (T4.1): refuse non-local flags on git URLs early so the user
  // doesn't get a confusing IngestionService error after a long clone.
  if (!looksLocal && (options.watch === true || options.followSymlinks === true)) {
    throw new Error(
      "--watch and --follow-symlinks are only valid for local folders, not git URLs.\n" +
        "Either omit these flags or pass a local path."
    );
  }
  if (!isLocalFolderSource && options.tier === "public" && looksLocal) {
    // local-git rejects `tier=public` only for the folder source; we let
    // IngestionService be the single source of truth for public-tier policy
    // on git-remote / local-git so the message stays consistent.
  }

  // Check if repository already exists (unless force)
  if (!options.force) {
    const existing = await deps.repositoryService.getRepository(repositoryName);
    if (existing) {
      throw new Error(
        `Repository '${repositoryName}' is already indexed.\n` +
          "Use --force to reindex: " +
          chalk.gray(`pk-mcp index ${url} --force`)
      );
    }
  }

  // Create spinner
  const spinner = createIndexSpinner(repositoryName);

  try {
    // Resolve watch default by source: local-folder → true unless --no-watch
    // explicitly disables it; everything else → false.
    const effectiveWatch = isLocalFolderSource
      ? options.watch !== false
      : false;

    // Index repository with progress callback
    const result = await deps.ingestionService.indexRepository(url, {
      name: options.name,
      branch: options.branch,
      force: options.force,
      tier: options.tier,
      watch: effectiveWatch,
      followSymlinks: options.followSymlinks ?? false,
      onProgress: (progress) => {
        updateIndexSpinner(spinner, progress);
      },
    });

    // Complete spinner based on result status
    if (result.status === "success" && result.stats) {
      completeIndexSpinner(spinner, true, result.stats);
    } else if (result.status === "partial" && result.stats) {
      completeIndexSpinner(spinner, true, result.stats);
      console.log(
        chalk.yellow("\n⚠ Indexing completed with warnings:") +
          "\n  " +
          `${result.stats.filesFailed} file(s) failed to process`
      );
      if (result.errors.length > 0) {
        console.log(chalk.gray("\nErrors:"));
        for (const error of result.errors.slice(0, 5)) {
          console.log(chalk.gray(`  • ${error.message}`));
        }
        if (result.errors.length > 5) {
          console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
        }
      }
    } else {
      // Failed
      const firstError = result.errors.length > 0 ? result.errors[0] : null;
      const errorMessage = firstError?.message || "Unknown error";
      completeIndexSpinner(spinner, false, undefined, errorMessage);
      throw new Error(`Indexing failed: ${errorMessage}`);
    }
  } catch (error) {
    // Stop spinner and rethrow
    if (spinner.isSpinning) {
      completeIndexSpinner(
        spinner,
        false,
        undefined,
        error instanceof Error ? error.message : String(error)
      );
    }
    throw error;
  }
}
