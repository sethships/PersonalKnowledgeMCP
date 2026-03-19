/**
 * Shared test fixtures for folder watcher tests
 */

import * as path from "node:path";
import * as os from "node:os";
import type { WatchedFolder } from "../../src/services/folder-watcher-types.js";

/**
 * Create a test WatchedFolder object with sensible defaults.
 * Override any field via the `overrides` parameter.
 */
export function createTestFolder(overrides: Partial<WatchedFolder> = {}): WatchedFolder {
  return {
    id: `test-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path: path.join(os.tmpdir(), `test-folder-watcher-${Date.now()}`),
    name: "Test Folder",
    enabled: true,
    includePatterns: null,
    excludePatterns: null,
    debounceMs: 100,
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
    lastScanAt: null,
    fileCount: 0,
    updatedAt: null,
    ...overrides,
  };
}
