/**
 * Watch Commands - Manage watched folders
 *
 * Commands for managing folders registered for watching and indexing:
 * - add: Register a folder for watching and indexing
 * - list: Display all watched folders with status
 * - remove: Unregister a watched folder
 * - pause: Disable watching without removing registration
 * - resume: Re-enable a paused watched folder
 * - rescan: Manually trigger full or incremental re-indexing
 *
 * @see Issue #389: Implement pk-mcp watch commands
 */

/* eslint-disable no-console */

import chalk from "chalk";
import { resolve, basename } from "node:path";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import ora from "ora";
import type { WatchedFolderStoreService } from "../../services/watched-folder-store.js";
import type { WatchedFolder } from "../../services/folder-watcher-types.js";
import type { FileScanner } from "../../ingestion/file-scanner.js";
import type { IncrementalUpdatePipeline } from "../../services/incremental-update-pipeline.js";
import type { ChromaStorageClient } from "../../storage/types.js";
import type { FileChange } from "../../services/incremental-update-types.js";
import { SUPPORTED_EXTENSIONS } from "../../documents/constants.js";
import { formatWatchListTable, formatWatchListJson } from "../output/watch-formatters.js";

// ============================================================================
// Dependency Types
// ============================================================================

/**
 * Dependencies required by watch commands
 *
 * Uses a subset of CliDependencies to keep watch commands loosely coupled.
 */
export interface WatchCommandDeps {
  folderStore: WatchedFolderStoreService;
  fileScanner: FileScanner;
  updatePipeline: IncrementalUpdatePipeline;
  chromaClient: ChromaStorageClient;
}

// ============================================================================
// Command Option Types
// ============================================================================

/**
 * Options for watch add command
 */
export interface WatchAddOptions {
  name?: string;
  json?: boolean;
}

/**
 * Options for watch list command
 */
export interface WatchListOptions {
  json?: boolean;
}

/**
 * Options for watch remove command
 */
export interface WatchRemoveOptions {
  force?: boolean;
  json?: boolean;
}

/**
 * Options for watch pause command
 */
export interface WatchPauseOptions {
  json?: boolean;
}

/**
 * Options for watch resume command
 */
export interface WatchResumeOptions {
  json?: boolean;
}

/**
 * Options for watch rescan command
 */
export interface WatchRescanOptions {
  full?: boolean;
  json?: boolean;
  provider?: string;
}

// ============================================================================
// Shared Helper
// ============================================================================

/**
 * Resolve a watched folder by name or path
 *
 * Resolution priority:
 * 1. Exact name match
 * 2. Exact path match (after resolving to absolute)
 * 3. Partial name match (starts with)
 *
 * @param nameOrPath - Folder name or path to resolve
 * @param deps - Dependencies with folder store
 * @returns The matched WatchedFolder
 * @throws Error if no folder matches the given name or path
 */
async function resolveFolderByNameOrPath(
  nameOrPath: string,
  deps: Pick<WatchCommandDeps, "folderStore">
): Promise<WatchedFolder> {
  const folders = await deps.folderStore.listFolders();

  // 1. Exact name match
  const byName = folders.find((f) => f.name === nameOrPath);
  if (byName) return byName;

  // 2. Exact path match (resolve to absolute)
  const resolvedPath = resolve(nameOrPath);
  const byPath = folders.find((f) => f.path === resolvedPath);
  if (byPath) return byPath;

  // 3. Partial name match (starts with)
  const partial = folders.filter((f) => f.name.toLowerCase().startsWith(nameOrPath.toLowerCase()));
  if (partial.length === 1 && partial[0]) return partial[0];

  if (partial.length > 1) {
    const names = partial.map((f) => `  - ${f.name}`).join("\n");
    throw new Error(
      `Ambiguous folder reference '${nameOrPath}'. Multiple matches:\n${names}\n` +
        "Please provide a more specific name or use the full path."
    );
  }

  throw new Error(
    `No watched folder found matching '${nameOrPath}'.\n` +
      "Use `pk-mcp watch list` to see registered folders."
  );
}

/**
 * Confirm action with user via readline prompt
 *
 * @param message - Confirmation message
 * @returns True if user confirms
 */
async function confirmAction(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.on("error", () => {
      rl.close();
      resolve(false);
    });
    rl.on("close", () => resolve(false));

    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ============================================================================
// Watch Add Command
// ============================================================================

/**
 * Register a folder for watching and indexing
 *
 * Resolves the folder path to an absolute path, validates it exists and is a
 * directory, checks for duplicates, then persists the registration.
 *
 * @param folderPath - Local folder path to register
 * @param options - Command options
 * @param deps - Watch command dependencies
 */
export async function watchAddCommand(
  folderPath: string,
  options: WatchAddOptions,
  deps: WatchCommandDeps
): Promise<void> {
  // 1. Resolve and validate absolute folder path
  const resolvedPath = resolve(folderPath);

  try {
    const stats = await stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedPath}`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(`Folder does not exist: ${resolvedPath}`);
    }
    throw error;
  }

  // 2. Check if already registered by path
  const existingFolders = await deps.folderStore.listFolders();
  const existing = existingFolders.find((f) => f.path === resolvedPath);
  if (existing) {
    throw new Error(
      `Folder already registered at path ${resolvedPath}. Use \`watch remove\` first.`
    );
  }

  // 3. Create folder record
  const folder: WatchedFolder = {
    id: crypto.randomUUID(),
    name: options.name ?? basename(resolvedPath),
    path: resolvedPath,
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 2000,
    fileCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastScanAt: null,
  };

  // 4. Persist
  await deps.folderStore.addFolder(folder);

  // 5. Output
  if (options.json) {
    console.log(JSON.stringify({ success: true, id: folder.id, path: resolvedPath }, null, 2));
  } else {
    console.log(chalk.green("Folder registered for watching."));
    console.log(chalk.gray(`  ID:   ${folder.id}`));
    console.log(chalk.gray(`  Name: ${folder.name}`));
    console.log(chalk.gray(`  Path: ${resolvedPath}`));
  }
}

// ============================================================================
// Watch List Command
// ============================================================================

/**
 * Display all watched folders with status
 *
 * @param options - Command options
 * @param deps - Watch command dependencies
 */
export async function watchListCommand(
  options: WatchListOptions,
  deps: WatchCommandDeps
): Promise<void> {
  const folders = await deps.folderStore.listFolders();

  if (folders.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ totalFolders: 0, folders: [] }, null, 2));
    } else {
      console.log("No watched folders registered.");
    }
    return;
  }

  if (options.json) {
    formatWatchListJson(folders);
  } else {
    formatWatchListTable(folders);
  }
}

// ============================================================================
// Watch Remove Command
// ============================================================================

/**
 * Unregister a watched folder
 *
 * @param nameOrPath - Folder name or path to remove
 * @param options - Command options
 * @param deps - Watch command dependencies
 */
export async function watchRemoveCommand(
  nameOrPath: string,
  options: WatchRemoveOptions,
  deps: WatchCommandDeps
): Promise<void> {
  const folder = await resolveFolderByNameOrPath(nameOrPath, deps);

  // Confirm unless --force
  if (!options.force) {
    const confirmed = await confirmAction(
      `Remove watched folder '${folder.name}' (${folder.path})?`
    );
    if (!confirmed) {
      console.log(chalk.gray("Cancelled."));
      return;
    }
  }

  await deps.folderStore.removeFolder(folder.id);

  if (options.json) {
    console.log(JSON.stringify({ success: true, id: folder.id, name: folder.name }, null, 2));
  } else {
    console.log(chalk.green(`Folder '${folder.name}' removed.`));
  }
}

// ============================================================================
// Watch Pause Command
// ============================================================================

/**
 * Disable watching without removing registration
 *
 * @param nameOrPath - Folder name or path to pause
 * @param options - Command options
 * @param deps - Watch command dependencies
 */
export async function watchPauseCommand(
  nameOrPath: string,
  options: WatchPauseOptions,
  deps: WatchCommandDeps
): Promise<void> {
  const folder = await resolveFolderByNameOrPath(nameOrPath, deps);

  if (!folder.enabled) {
    console.warn(`Folder '${folder.name}' is already paused.`);
    return;
  }

  await deps.folderStore.updateFolder({
    ...folder,
    enabled: false,
    updatedAt: new Date(),
  });

  if (options.json) {
    console.log(
      JSON.stringify({ success: true, id: folder.id, name: folder.name, enabled: false }, null, 2)
    );
  } else {
    console.log(chalk.green(`Folder '${folder.name}' paused.`));
  }
}

// ============================================================================
// Watch Resume Command
// ============================================================================

/**
 * Re-enable a paused watched folder
 *
 * @param nameOrPath - Folder name or path to resume
 * @param options - Command options
 * @param deps - Watch command dependencies
 */
export async function watchResumeCommand(
  nameOrPath: string,
  options: WatchResumeOptions,
  deps: WatchCommandDeps
): Promise<void> {
  const folder = await resolveFolderByNameOrPath(nameOrPath, deps);

  if (folder.enabled) {
    console.warn(`Folder '${folder.name}' is already active.`);
    return;
  }

  await deps.folderStore.updateFolder({
    ...folder,
    enabled: true,
    updatedAt: new Date(),
  });

  if (options.json) {
    console.log(
      JSON.stringify({ success: true, id: folder.id, name: folder.name, enabled: true }, null, 2)
    );
  } else {
    console.log(chalk.green(`Folder '${folder.name}' resumed.`));
  }
}

// ============================================================================
// Watch Rescan Command
// ============================================================================

/**
 * Manually trigger re-indexing for a watched folder
 *
 * Scans the folder for files and processes them through the incremental
 * update pipeline. Supports full re-index (deletes existing collection first)
 * or incremental mode.
 *
 * @param nameOrPath - Folder name or path to rescan
 * @param options - Command options
 * @param deps - Watch command dependencies
 */
export async function watchRescanCommand(
  nameOrPath: string,
  options: WatchRescanOptions,
  deps: WatchCommandDeps
): Promise<void> {
  const folder = await resolveFolderByNameOrPath(nameOrPath, deps);

  // Determine include extensions from folder patterns
  let includeExtensions: string[];
  if (folder.includePatterns) {
    includeExtensions = folder.includePatterns.map((p) => {
      // Strip leading "*" from patterns like "*.md" -> ".md"
      return p.startsWith("*") ? p.substring(1) : p;
    });
  } else {
    includeExtensions = [...SUPPORTED_EXTENSIONS];
  }

  // Build collection name from folder ID (consistent with documents-index-command)
  const repositoryName = `folder-${folder.id}`;
  const collectionName = `folder_${folder.id}`;

  // If --full, delete existing collection for a clean re-index
  if (options.full) {
    const deleteSpinner = ora({
      text: `Deleting existing collection for '${folder.name}'...`,
      color: "cyan",
    }).start();

    try {
      await deps.chromaClient.deleteCollection(collectionName);
      deleteSpinner.succeed(chalk.green("Existing collection deleted"));
    } catch {
      deleteSpinner.info(chalk.gray("No existing collection to delete"));
    }
  }

  // Scan files
  const spinner = ora({
    text: `Scanning '${folder.name}'...`,
    color: "cyan",
  }).start();

  let scannedFiles;
  try {
    scannedFiles = await deps.fileScanner.scanFiles(folder.path, {
      includeExtensions,
    });
  } catch (error) {
    spinner.fail(chalk.red("Scan failed"));
    throw error;
  }

  if (scannedFiles.length === 0) {
    spinner.warn(chalk.yellow("No matching files found"));
    return;
  }

  spinner.text = `Indexing ${chalk.cyan(String(scannedFiles.length))} file(s) from '${folder.name}'...`;

  // Build FileChange[] with all files as "added"
  const changes: FileChange[] = scannedFiles.map((f) => ({
    path: f.relativePath,
    status: "added" as const,
  }));

  // Process changes via update pipeline
  let result;
  try {
    result = await deps.updatePipeline.processChanges(changes, {
      repository: repositoryName,
      localPath: folder.path,
      collectionName,
      includeExtensions,
      excludePatterns: [],
    });
  } catch (error) {
    spinner.fail(chalk.red("Indexing failed"));
    throw error;
  }

  // Update folder store with new counts
  await deps.folderStore.updateFolder({
    ...folder,
    fileCount: scannedFiles.length,
    lastScanAt: new Date(),
    updatedAt: new Date(),
  });

  // Display results
  const durationSec = (result.stats.durationMs / 1000).toFixed(1);

  if (result.errors.length > 0) {
    spinner.warn(chalk.yellow("Rescan completed with warnings"));
  } else {
    spinner.succeed(chalk.green("Rescan complete!"));
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          id: folder.id,
          name: folder.name,
          filesScanned: scannedFiles.length,
          filesIndexed: result.stats.filesAdded,
          chunksUpserted: result.stats.chunksUpserted,
          durationMs: result.stats.durationMs,
          errors: result.errors.length,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `  Files indexed: ${chalk.cyan(String(result.stats.filesAdded))}` +
        `\n  Chunks upserted: ${chalk.cyan(String(result.stats.chunksUpserted))}` +
        `\n  Duration: ${chalk.cyan(durationSec + "s")}`
    );

    if (result.errors.length > 0) {
      console.log(chalk.yellow(`\n  ${result.errors.length} file(s) failed to process:`));
      for (const err of result.errors.slice(0, 5)) {
        console.log(chalk.gray(`  - ${err.path}: ${err.error}`));
      }
      if (result.errors.length > 5) {
        console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
      }
    }
  }
}
