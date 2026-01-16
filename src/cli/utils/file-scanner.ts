/**
 * File scanning utilities for graph populate commands.
 *
 * Provides shared file scanning functionality for populating the Neo4j
 * knowledge graph from indexed repositories.
 *
 * NOTE: This is a lightweight scanner specifically for graph population.
 * It scans for tree-sitter parseable files (.ts, .tsx, .js, .jsx) and
 * includes file content in the results.
 *
 * For full repository scanning with gitignore support, file size filtering,
 * and progress callbacks, see src/ingestion/file-scanner.ts (FileScanner class).
 */

import { readdir, readFile } from "fs/promises";
import { join, extname } from "path";
import type { FileInput } from "../../graph/ingestion/types.js";

/**
 * Supported file extensions for graph population.
 *
 * These are extensions supported by tree-sitter parsing.
 */
export const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Directories to exclude from file scanning.
 */
export const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "out",
  "__pycache__",
]);

/**
 * Recursively scan directory for supported files.
 *
 * Tracks files that couldn't be read due to I/O errors (permissions, encoding, etc.)
 * so they can be reported to the user.
 *
 * @param dirPath - Directory to scan
 * @param basePath - Base path for relative path calculation
 * @param skippedFiles - Array to accumulate skipped file paths (mutated)
 * @returns Array of FileInput objects
 */
export async function scanDirectory(
  dirPath: string,
  basePath: string,
  skippedFiles: string[] = []
): Promise<FileInput[]> {
  const files: FileInput[] = [];

  // Defensive error handling: if directory becomes inaccessible, return empty
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    // Directory may have become inaccessible (permissions, deleted, etc.)
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        const subFiles = await scanDirectory(fullPath, basePath, skippedFiles);
        files.push(...subFiles);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        try {
          const content = await readFile(fullPath, "utf-8");
          const relativePath = fullPath.substring(basePath.length + 1).replace(/\\/g, "/");
          files.push({
            path: relativePath,
            content,
          });
        } catch {
          // Track skipped files so we can report them
          const relativePath = fullPath.substring(basePath.length + 1).replace(/\\/g, "/");
          skippedFiles.push(relativePath);
        }
      }
    }
  }

  return files;
}

/**
 * Format duration in milliseconds to human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string (e.g., "150ms", "2.5s")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

/**
 * Format phase name for display.
 *
 * Maps internal phase identifiers to human-readable display names
 * for use in progress output.
 *
 * @param phase - Phase identifier from GraphIngestionProgress
 * @returns Human-readable phase name
 */
export function formatPhase(phase: string): string {
  const phases: Record<string, string> = {
    initializing: "Initializing",
    extracting_entities: "Extracting entities",
    extracting_relationships: "Extracting relationships",
    creating_repository_node: "Creating repository node",
    creating_file_nodes: "Creating file nodes",
    creating_entity_nodes: "Creating entity nodes",
    creating_module_nodes: "Creating module nodes",
    creating_relationships: "Creating relationships",
    verifying: "Verifying",
    completed: "Completed",
  };
  return phases[phase] || phase;
}
