/**
 * Watched Folder Store Implementation
 *
 * Provides a singleton file-based storage implementation for watched folder configs.
 * Uses atomic writes to prevent data corruption and follows the same pattern
 * as the token store (write to .tmp then rename).
 *
 * @module services/watched-folder-store
 */

import { join } from "path";
import { rename, unlink } from "fs/promises";
import type { Logger } from "pino";
import { z } from "zod";
import { getComponentLogger } from "../logging/index.js";
import type { WatchedFolder } from "./folder-watcher-types.js";

/**
 * Zod schema for the serialized form of a WatchedFolder (ISO date strings instead of Date objects)
 */
const WatchedFolderSerializedSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  includePatterns: z.array(z.string()).nullable(),
  excludePatterns: z.array(z.string()).nullable(),
  debounceMs: z.number(),
  createdAt: z.string(),
  lastScanAt: z.string().nullable(),
  fileCount: z.number(),
  updatedAt: z.string().nullable(),
});

/**
 * Zod schema for the JSON store file format
 */
const WatchedFolderStoreFileSchema = z.object({
  version: z.string(),
  folders: z.array(WatchedFolderSerializedSchema),
});

/** Inferred type for the serialized folder record */
type WatchedFolderSerialized = z.infer<typeof WatchedFolderSerializedSchema>;

/** Inferred type for the store file format */
type WatchedFolderStoreFile = z.infer<typeof WatchedFolderStoreFileSchema>;

/**
 * Service interface for persisting watched folder configurations
 */
export interface WatchedFolderStoreService {
  addFolder(folder: WatchedFolder): Promise<void>;
  updateFolder(folder: WatchedFolder): Promise<void>;
  removeFolder(folderId: string): Promise<void>;
  getFolder(folderId: string): Promise<WatchedFolder | null>;
  listFolders(): Promise<WatchedFolder[]>;
}

/**
 * Singleton implementation of watched folder storage
 *
 * Manages folder config persistence in a JSON file with atomic writes for data safety.
 * Follows the same singleton + atomic write pattern as TokenStoreImpl.
 *
 * **File Location:** `{DATA_PATH}/watched-folders.json`
 *
 * **Features:**
 * - Singleton pattern for global access
 * - In-memory cache for fast reads
 * - Atomic writes using temp file + rename pattern
 * - Automatic file creation if missing
 * - Date serialization (store as ISO strings, parse back to Date)
 */
export class WatchedFolderStoreImpl implements WatchedFolderStoreService {
  /**
   * Singleton instance
   */
  private static instance: WatchedFolderStoreImpl | null = null;

  /**
   * Absolute path to the watched-folders JSON file
   */
  private readonly filePath: string;

  /**
   * Lazy-initialized logger to avoid module load-time initialization
   */
  private _logger: Logger | null = null;

  /**
   * In-memory cache of folders
   */
  private folderCache: WatchedFolder[] | null = null;

  /**
   * Serialized promise queue to prevent concurrent read-modify-write races
   */
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Private constructor enforces singleton pattern
   *
   * @param dataPath - Base directory for data storage
   */
  private constructor(dataPath: string) {
    this.filePath = join(dataPath, "watched-folders.json");
  }

  /**
   * Lazy-initialized component logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:watched-folder-store");
    }
    return this._logger;
  }

  /**
   * Get the singleton instance of the watched folder store
   *
   * @param dataPath - Data directory path (required on first call)
   * @returns The singleton watched folder store instance
   */
  public static getInstance(dataPath?: string): WatchedFolderStoreImpl {
    if (!WatchedFolderStoreImpl.instance) {
      const resolvedPath = dataPath || process.env["DATA_PATH"] || "./data";
      WatchedFolderStoreImpl.instance = new WatchedFolderStoreImpl(resolvedPath);
    } else if (dataPath !== undefined) {
      const logger = getComponentLogger("services:watched-folder-store");
      logger.warn(
        { requestedPath: dataPath },
        "getInstance called with dataPath after singleton already initialized - ignoring new path"
      );
    }
    return WatchedFolderStoreImpl.instance;
  }

  /**
   * Reset the singleton instance
   *
   * **FOR TESTING ONLY** - Allows tests to create fresh instances with different configurations.
   *
   * @internal
   */
  public static resetInstance(): void {
    WatchedFolderStoreImpl.instance = null;
  }

  /**
   * Get the storage file path
   *
   * @returns Absolute path to the watched-folders.json file
   */
  getStoragePath(): string {
    return this.filePath;
  }

  /**
   * Add a new folder to the store
   *
   * If a folder with the same ID already exists, it is updated (upsert behavior).
   * All writes are serialized via the write queue to prevent concurrent modification.
   *
   * @param folder - Folder configuration to persist
   */
  async addFolder(folder: WatchedFolder): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.addFolderInternal(folder));
    await this.writeQueue;
  }

  /**
   * Update an existing folder configuration
   *
   * All writes are serialized via the write queue to prevent concurrent modification.
   *
   * @param folder - Updated folder configuration (matched by id)
   */
  async updateFolder(folder: WatchedFolder): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.updateFolderInternal(folder));
    await this.writeQueue;
  }

  /**
   * Remove a folder from the store
   *
   * No-op if the folder doesn't exist (does not throw).
   * All writes are serialized via the write queue to prevent concurrent modification.
   *
   * @param folderId - ID of the folder to remove
   */
  async removeFolder(folderId: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.removeFolderInternal(folderId));
    await this.writeQueue;
  }

  /**
   * Get a folder by its ID
   *
   * @param folderId - ID of the folder to retrieve
   * @returns The folder configuration or null if not found
   */
  async getFolder(folderId: string): Promise<WatchedFolder | null> {
    const folders = await this.loadFolders();
    return folders.find((f) => f.id === folderId) ?? null;
  }

  /**
   * List all persisted folders
   *
   * @returns Array of all watched folder configurations
   */
  async listFolders(): Promise<WatchedFolder[]> {
    return await this.loadFolders();
  }

  /**
   * Invalidate the in-memory cache
   *
   * Forces next read to load from disk.
   */
  invalidateCache(): void {
    this.folderCache = null;
  }

  // ===========================================================================
  // Private Methods — Write Queue Internals
  // ===========================================================================

  /**
   * Internal add logic (called within the serialized write queue)
   */
  private async addFolderInternal(folder: WatchedFolder): Promise<void> {
    const folders = await this.loadFolders();
    if (folders.some((f) => f.id === folder.id)) {
      this.logger.warn(
        { folderId: folder.id },
        "Folder already exists in store - updating instead"
      );
      const index = folders.findIndex((f) => f.id === folder.id);
      folders[index] = folder;
      await this.saveFolders(folders);
      this.logger.info({ folderId: folder.id }, "Folder updated in store (via addFolder upsert)");
      return;
    }
    folders.push(folder);
    await this.saveFolders(folders);
    this.logger.info({ folderId: folder.id, path: folder.path }, "Folder added to store");
  }

  /**
   * Internal update logic (called within the serialized write queue)
   */
  private async updateFolderInternal(folder: WatchedFolder): Promise<void> {
    const folders = await this.loadFolders();
    const index = folders.findIndex((f) => f.id === folder.id);
    if (index === -1) {
      this.logger.warn({ folderId: folder.id }, "Folder not found for update - adding instead");
      folders.push(folder);
    } else {
      folders[index] = folder;
    }
    await this.saveFolders(folders);
    this.logger.info({ folderId: folder.id }, "Folder updated in store");
  }

  /**
   * Internal remove logic (called within the serialized write queue)
   */
  private async removeFolderInternal(folderId: string): Promise<void> {
    const folders = await this.loadFolders();
    const filtered = folders.filter((f) => f.id !== folderId);
    if (filtered.length === folders.length) {
      this.logger.debug({ folderId }, "Folder not found for removal - no-op");
      return;
    }
    await this.saveFolders(filtered);
    this.logger.info({ folderId }, "Folder removed from store");
  }

  // ===========================================================================
  // Private Methods — Storage I/O
  // ===========================================================================

  /**
   * Load folders from disk (with cache)
   */
  private async loadFolders(): Promise<WatchedFolder[]> {
    if (this.folderCache !== null) {
      return [...this.folderCache];
    }

    try {
      const file = Bun.file(this.filePath);
      const exists = await file.exists();

      if (!exists) {
        this.logger.debug(
          { filePath: this.filePath },
          "Watched folder store not found - returning empty list"
        );
        this.folderCache = [];
        return [];
      }

      const content = await file.text();
      const parsed: unknown = JSON.parse(content);
      const storeFile = WatchedFolderStoreFileSchema.parse(parsed);

      const folders = (storeFile.folders || []).map((s) => this.deserializeFolder(s));
      this.folderCache = folders;

      this.logger.debug({ folderCount: folders.length }, "Watched folder store loaded from disk");

      return [...folders];
    } catch (error) {
      this.logger.error(
        {
          filePath: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to load watched folder store"
      );
      throw error;
    }
  }

  /**
   * Save folders to disk using atomic write (temp file + rename)
   */
  private async saveFolders(folders: WatchedFolder[]): Promise<void> {
    const tempPath = `${this.filePath}.tmp`;

    try {
      const storeFile: WatchedFolderStoreFile = {
        version: "1.0",
        folders: folders.map((f) => this.serializeFolder(f)),
      };

      const content = JSON.stringify(storeFile, null, 2);

      // Write to temporary file using Bun's native API
      await Bun.write(tempPath, content);

      // Atomic rename (use Node.js fs for rename as Bun doesn't expose it)
      await rename(tempPath, this.filePath);

      // Update cache
      this.folderCache = [...folders];

      this.logger.debug({ folderCount: folders.length }, "Watched folder store saved to disk");
    } catch (error) {
      // Attempt to clean up temp file
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      this.logger.error(
        {
          filePath: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to save watched folder store"
      );
      throw error;
    }
  }

  /**
   * Serialize a WatchedFolder to JSON-safe format (Dates -> ISO strings)
   */
  private serializeFolder(folder: WatchedFolder): WatchedFolderSerialized {
    return {
      id: folder.id,
      path: folder.path,
      name: folder.name,
      enabled: folder.enabled,
      includePatterns: folder.includePatterns,
      excludePatterns: folder.excludePatterns,
      debounceMs: folder.debounceMs,
      createdAt:
        folder.createdAt instanceof Date
          ? folder.createdAt.toISOString()
          : String(folder.createdAt),
      lastScanAt:
        folder.lastScanAt instanceof Date ? folder.lastScanAt.toISOString() : folder.lastScanAt,
      fileCount: folder.fileCount,
      updatedAt:
        folder.updatedAt instanceof Date ? folder.updatedAt.toISOString() : folder.updatedAt,
    };
  }

  /**
   * Deserialize a JSON record back to a WatchedFolder (ISO strings -> Dates)
   */
  private deserializeFolder(raw: WatchedFolderSerialized): WatchedFolder {
    return {
      id: raw.id,
      path: raw.path,
      name: raw.name,
      enabled: raw.enabled,
      includePatterns: raw.includePatterns,
      excludePatterns: raw.excludePatterns,
      debounceMs: raw.debounceMs,
      createdAt: new Date(raw.createdAt),
      lastScanAt: raw.lastScanAt ? new Date(raw.lastScanAt) : null,
      fileCount: raw.fileCount,
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : null,
    };
  }
}
