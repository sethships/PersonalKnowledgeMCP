/**
 * Watch Output Formatters for CLI
 *
 * Functions for formatting watched folder information as tables or JSON.
 *
 * @see Issue #389: Implement pk-mcp watch commands
 */

/* eslint-disable no-console */

import Table from "cli-table3";
import chalk from "chalk";
import type { WatchedFolder } from "../../services/folder-watcher-types.js";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a Date or null to a display string
 *
 * @param date - Date to format, or null
 * @returns Formatted date string or "-" if null
 */
function formatDate(date: Date | null): string {
  if (!date) {
    return chalk.gray("-");
  }

  try {
    return date.toISOString().replace("T", " ").substring(0, 19);
  } catch {
    return chalk.gray("-");
  }
}

/**
 * Get colored status indicator for a watched folder
 *
 * @param enabled - Whether the folder is enabled
 * @returns Colored status string
 */
function getStatusIndicator(enabled: boolean): string {
  return enabled ? chalk.green("Active") : chalk.yellow("Paused");
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string with ellipsis if needed
 */
function truncate(str: string, maxLength: number): string {
  if (maxLength < 4) return str.substring(0, maxLength);
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + "...";
}

// ============================================================================
// Table Formatter
// ============================================================================

/**
 * Format a list of watched folders as a CLI table
 *
 * Displays folder name, path, status, file count, and last scan time.
 *
 * @param folders - List of watched folders to display
 */
export function formatWatchListTable(folders: WatchedFolder[]): void {
  const table = new Table({
    head: [
      chalk.cyan("Name"),
      chalk.cyan("Path"),
      chalk.cyan("Status"),
      chalk.cyan("Files"),
      chalk.cyan("Last Scan"),
    ],
    colAligns: ["left", "left", "left", "right", "left"],
    colWidths: [20, 40, 10, 8, 22],
    style: {
      head: [],
      border: ["gray"],
    },
  });

  for (const folder of folders) {
    table.push([
      truncate(folder.name, 18),
      truncate(folder.path, 38),
      getStatusIndicator(folder.enabled),
      folder.fileCount.toString(),
      formatDate(folder.lastScanAt),
    ]);
  }

  const header = chalk.bold(`\nWatched Folders (${folders.length} total)\n`);
  console.log(header + table.toString());
}

// ============================================================================
// JSON Formatter
// ============================================================================

/**
 * Format a list of watched folders as JSON output
 *
 * @param folders - List of watched folders to display
 */
export function formatWatchListJson(folders: WatchedFolder[]): void {
  console.log(
    JSON.stringify(
      {
        totalFolders: folders.length,
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          path: f.path,
          enabled: f.enabled,
          fileCount: f.fileCount,
          includePatterns: f.includePatterns,
          excludePatterns: f.excludePatterns,
          debounceMs: f.debounceMs,
          createdAt: f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt,
          lastScanAt: f.lastScanAt instanceof Date ? f.lastScanAt.toISOString() : f.lastScanAt,
          updatedAt: f.updatedAt instanceof Date ? f.updatedAt.toISOString() : f.updatedAt,
        })),
      },
      null,
      2
    )
  );
}
