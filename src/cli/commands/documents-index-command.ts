/**
 * Documents Index Command - Index a local folder of documents
 *
 * Scans a local folder for supported document types (PDF, DOCX, Markdown, TXT, images),
 * registers the folder in the watched-folder store, and indexes all matching files
 * via the incremental update pipeline.
 */

/* eslint-disable no-console */

import chalk from "chalk";
import { resolve, basename, posix } from "node:path";
import { stat } from "node:fs/promises";
import ora from "ora";
import type { CliDependencies } from "../utils/dependency-init.js";
import {
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
} from "../../documents/constants.js";
import type { FileChange } from "../../services/incremental-update-types.js";
import type { WatchedFolder } from "../../services/folder-watcher-types.js";

/**
 * Document index command options
 */
export interface DocumentsIndexCommandOptions {
  recursive?: boolean;
  types?: string;
  dryRun?: boolean;
  force?: boolean;
  name?: string;
  provider?: string;
}

/**
 * Mapping from --types CLI value to file extensions
 */
const TYPE_TO_EXTENSIONS: Record<string, readonly string[]> = {
  pdf: DOCUMENT_EXTENSIONS.pdf,
  docx: DOCUMENT_EXTENSIONS.docx,
  md: DOCUMENT_EXTENSIONS.markdown,
  markdown: DOCUMENT_EXTENSIONS.markdown,
  txt: DOCUMENT_EXTENSIONS.txt,
  image: IMAGE_EXTENSIONS,
};

/**
 * Parse the --types option into a list of file extensions to include.
 *
 * @param types - Comma-separated type names (e.g. "pdf,docx,md")
 * @returns Array of file extensions (e.g. [".pdf", ".docx", ".md"])
 * @throws Error if any type value is unrecognized
 */
function parseTypesToExtensions(types?: string): string[] {
  if (!types) {
    return [...SUPPORTED_EXTENSIONS];
  }

  const typeList = types
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  const extensions = new Set<string>();

  for (const t of typeList) {
    const exts = TYPE_TO_EXTENSIONS[t];
    if (!exts) {
      const validTypes = Object.keys(TYPE_TO_EXTENSIONS).join(", ");
      throw new Error(`Unknown document type: '${t}'. Valid types: ${validTypes}`);
    }
    for (const ext of exts) {
      extensions.add(ext);
    }
  }

  return [...extensions];
}

/**
 * Validate that a path exists and is a directory.
 *
 * @param folderPath - Absolute path to validate
 * @throws Error if path does not exist or is not a directory
 */
async function validateFolderPath(folderPath: string): Promise<void> {
  try {
    const stats = await stat(folderPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${folderPath}`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(`Folder does not exist: ${folderPath}`);
    }
    throw error;
  }
}

/**
 * Execute the documents index command.
 *
 * Scans a local folder for supported document files and indexes them
 * via the incremental update pipeline. Supports dry-run mode, type
 * filtering, and recursive/non-recursive scanning.
 *
 * @param folderPath - Local folder path to index
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function documentsIndexCommand(
  folderPath: string,
  options: DocumentsIndexCommandOptions,
  deps: CliDependencies
): Promise<void> {
  // 1. Resolve and validate absolute folder path
  const absolutePath = resolve(folderPath);
  await validateFolderPath(absolutePath);

  // 2. Parse --types to filter extensions
  const includeExtensions = parseTypesToExtensions(options.types);

  // 3. Determine display name
  const folderName = options.name ?? basename(absolutePath);

  // 4. Check if folder is already registered (look by path)
  const existingFolders = await deps.folderStore.listFolders();
  const existingFolder = existingFolders.find((f) => f.path === absolutePath);

  if (existingFolder && !options.force) {
    throw new Error(
      `Folder '${folderName}' at '${absolutePath}' is already indexed.\n` +
        `Use --force to re-index: ` +
        chalk.gray(`pk-mcp documents index "${folderPath}" --force`)
    );
  }

  // 5. Prepare folder record (registration is deferred until after dry-run check)
  let folder: WatchedFolder;
  let isNewFolder = false;

  if (existingFolder) {
    // Re-use existing folder record (force mode)
    folder = existingFolder;
  } else {
    // Create new folder record — will be persisted after dry-run guard
    const folderId = crypto.randomUUID();
    folder = {
      id: folderId,
      path: absolutePath,
      name: folderName,
      enabled: true,
      includePatterns: includeExtensions.map((ext) => `*${ext}`),
      excludePatterns: null,
      debounceMs: 2000,
      createdAt: new Date(),
      lastScanAt: null,
      fileCount: 0,
      updatedAt: null,
    };
    isNewFolder = true;
  }

  // 6. Scan files via FileScanner with document extensions
  const spinner = ora({
    text: `Scanning ${chalk.cyan(folderName)}...`,
    color: "cyan",
  }).start();

  let scannedFiles;
  try {
    scannedFiles = await deps.fileScanner.scanFiles(absolutePath, {
      includeExtensions,
    });
  } catch (error) {
    spinner.fail(chalk.red("Scan failed"));
    throw error;
  }

  // 7. Post-filter: if not --recursive, keep only top-level files
  const filteredFiles = options.recursive
    ? scannedFiles
    : scannedFiles.filter((f) => posix.dirname(f.relativePath.replace(/\\/g, "/")) === ".");

  // 8. If --dry-run: display file list and exit
  if (options.dryRun) {
    spinner.stop();
    console.log(
      chalk.bold(
        `\nDry run — would index ${chalk.cyan(String(filteredFiles.length))} file(s) from '${folderName}':\n`
      )
    );

    if (filteredFiles.length === 0) {
      console.log(chalk.gray("  (no matching files found)"));
    } else {
      for (const file of filteredFiles) {
        console.log(`  ${chalk.gray("•")} ${file.relativePath}`);
      }
    }

    console.log(
      chalk.gray(
        `\n  Folder: ${absolutePath}` +
          `\n  Types: ${options.types ?? "all"}` +
          `\n  Recursive: ${options.recursive ? "yes" : "no"}`
      )
    );
    return;
  }

  // Register new folder now that we are past the dry-run guard
  if (isNewFolder) {
    await deps.folderStore.addFolder(folder);
  }

  if (filteredFiles.length === 0) {
    spinner.warn(chalk.yellow("No matching files found"));
    console.log(chalk.gray(`  Folder: ${absolutePath}`));
    console.log(chalk.gray(`  Types filter: ${options.types ?? "all"}`));
    if (!options.recursive) {
      console.log(chalk.gray("  Note: use --recursive to include subdirectories"));
    }
    return;
  }

  spinner.text = `Indexing ${chalk.cyan(String(filteredFiles.length))} file(s) from '${folderName}'...`;

  // 9. Build FileChange[] with all files as "added"
  const changes: FileChange[] = filteredFiles.map((f) => ({
    path: f.relativePath,
    status: "added" as const,
  }));

  // 10. Derive repository/collection names consistent with FolderDocumentIndexingService
  const repositoryName = `folder-${folder.id}`;
  const collectionName = `folder_${folder.id}`;

  // 11. If re-indexing with --force, clear stale chunks from the previous index
  if (existingFolder && options.force) {
    try {
      await deps.chromaClient.deleteCollection(collectionName);
    } catch {
      // Collection may not exist yet — safe to ignore
    }
  }

  // 12. Call IncrementalUpdatePipeline.processChanges()
  let result;
  try {
    result = await deps.updatePipeline.processChanges(changes, {
      repository: repositoryName,
      localPath: absolutePath,
      collectionName,
      includeExtensions,
      excludePatterns: [],
    });
  } catch (error) {
    spinner.fail(chalk.red("Indexing failed"));
    throw error;
  }

  // 13. Update fileCount and lastScanAt in store
  const updatedFolder: WatchedFolder = {
    ...folder,
    fileCount: filteredFiles.length,
    lastScanAt: new Date(),
    updatedAt: new Date(),
  };
  await deps.folderStore.updateFolder(updatedFolder);

  // 14. Display success summary
  const durationSec = (result.stats.durationMs / 1000).toFixed(1);
  const hasErrors = result.errors.length > 0;

  if (hasErrors) {
    spinner.warn(chalk.yellow("Indexing completed with warnings"));
  } else {
    spinner.succeed(chalk.green("Indexing complete!"));
  }

  console.log(
    `  Files indexed: ${chalk.cyan(String(result.stats.filesAdded))}` +
      `\n  Chunks upserted: ${chalk.cyan(String(result.stats.chunksUpserted))}` +
      `\n  Duration: ${chalk.cyan(durationSec + "s")}`
  );

  if (hasErrors) {
    console.log(chalk.yellow(`\n⚠ ${result.errors.length} file(s) failed to process:`));
    for (const err of result.errors.slice(0, 5)) {
      console.log(chalk.gray(`  • ${err.path}: ${err.error}`));
    }
    if (result.errors.length > 5) {
      console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
    }
  }

  console.log(chalk.gray(`\n  Folder ID: ${folder.id}`));
  console.log(chalk.gray(`  Collection: ${collectionName}`));
}
