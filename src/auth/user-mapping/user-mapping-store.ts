/**
 * User Mapping Store Implementation
 *
 * Provides a singleton file-based storage implementation for user mapping rules.
 * Uses atomic writes to prevent data corruption and supports file watching for
 * runtime configuration updates.
 *
 * @module auth/user-mapping/store
 */

import { join } from "path";
import { watch, type FSWatcher } from "fs";
import type { Logger } from "pino";
import type {
  UserMappingStore,
  UserMappingRule,
  UserMappingStoreFile,
} from "./user-mapping-types.js";
import { UserMappingStorageError, UserMappingWatcherError } from "./user-mapping-errors.js";
import { UserMappingStoreFileSchema } from "./user-mapping-validation.js";
import { getComponentLogger } from "../../logging/index.js";

/**
 * Singleton implementation of user mapping storage
 *
 * Manages mapping rule persistence in a JSON file with atomic writes for data safety.
 * Supports file watching for runtime configuration updates without restart.
 *
 * **File Location:** `{DATA_PATH}/user-mappings.json`
 *
 * **Features:**
 * - Singleton pattern for global access
 * - In-memory cache for fast rule access
 * - Atomic writes using temp file + rename pattern
 * - File watching with debounced reload
 * - Automatic file creation if missing
 * - Performance metrics logging
 *
 * @example
 * ```typescript
 * // Get singleton instance
 * const store = UserMappingStoreImpl.getInstance("./data");
 *
 * // Load rules (uses cache after first load)
 * const rules = await store.loadRules();
 *
 * // Start watching for file changes
 * store.onRulesChanged(() => console.log("Rules updated!"));
 * store.startWatcher();
 * ```
 */
export class UserMappingStoreImpl implements UserMappingStore {
  /**
   * Singleton instance
   */
  private static instance: UserMappingStoreImpl | null = null;

  /**
   * Absolute path to the user-mappings JSON file
   */
  private readonly filePath: string;

  /**
   * Lazy-initialized logger
   */
  private _logger: Logger | null = null;

  /**
   * In-memory cache for rules
   */
  private rulesCache: UserMappingRule[] | null = null;

  /**
   * File system watcher instance
   */
  private watcher: FSWatcher | null = null;

  /**
   * Registered change callbacks
   */
  private changeCallbacks: Set<() => void> = new Set();

  /**
   * Debounce timer for file watcher
   */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Debounce delay in milliseconds
   */
  private readonly debounceMs: number;

  /**
   * Private constructor enforces singleton pattern
   *
   * @param dataPath - Base directory for data storage
   * @param debounceMs - Debounce delay for file watcher (default: 500ms)
   */
  private constructor(dataPath: string, debounceMs: number = 500) {
    this.filePath = join(dataPath, "user-mappings.json");
    this.debounceMs = debounceMs;
  }

  /**
   * Lazy-initialized component logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("auth:user-mapping-store");
    }
    return this._logger;
  }

  /**
   * Get the singleton instance of the user mapping store
   *
   * @param dataPath - Optional data directory path
   * @param debounceMs - Optional debounce delay for file watcher
   * @returns The singleton store instance
   */
  public static getInstance(dataPath?: string, debounceMs?: number): UserMappingStoreImpl {
    if (!UserMappingStoreImpl.instance) {
      const path = dataPath || process.env["DATA_PATH"] || "./data";
      UserMappingStoreImpl.instance = new UserMappingStoreImpl(path, debounceMs);
    } else if (dataPath !== undefined || debounceMs !== undefined) {
      const logger = getComponentLogger("auth:user-mapping-store");
      logger.warn(
        { requestedPath: dataPath, requestedDebounceMs: debounceMs },
        "getInstance called with parameters after singleton already initialized - ignoring new values"
      );
    }
    return UserMappingStoreImpl.instance;
  }

  /**
   * Reset the singleton instance
   *
   * **FOR TESTING ONLY**
   *
   * @internal
   */
  public static resetInstance(): void {
    if (UserMappingStoreImpl.instance) {
      UserMappingStoreImpl.instance.stopWatcher();
    }
    UserMappingStoreImpl.instance = null;
  }

  /**
   * Get the storage file path
   */
  getStoragePath(): string {
    return this.filePath;
  }

  /**
   * Load all mapping rules from storage
   *
   * Uses in-memory cache for subsequent calls.
   * Creates an empty store if the file doesn't exist.
   *
   * @returns Array of mapping rules
   * @throws {UserMappingStorageError} If file cannot be read or parsed
   */
  async loadRules(): Promise<UserMappingRule[]> {
    // Return cached rules if available (fast path)
    if (this.rulesCache !== null) {
      return [...this.rulesCache];
    }

    const startTime = performance.now();

    try {
      const file = Bun.file(this.filePath);
      const exists = await file.exists();

      if (!exists) {
        this.logger.info(
          { filePath: this.filePath },
          "User mapping store not found - creating empty store"
        );
        this.rulesCache = [];
        await this.saveRules(this.rulesCache);
        return [...this.rulesCache];
      }

      const content = await file.text();
      const parsed: unknown = JSON.parse(content);

      // Validate file format
      const validated = UserMappingStoreFileSchema.parse(parsed);

      // Cache rules
      this.rulesCache = validated.rules;

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        {
          metric: "user_mapping_store.load_ms",
          value: durationMs,
          ruleCount: this.rulesCache.length,
        },
        "User mapping store loaded"
      );

      return [...this.rulesCache];
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      if (error instanceof SyntaxError) {
        this.logger.error(
          {
            metric: "user_mapping_store.load_ms",
            value: durationMs,
            filePath: this.filePath,
            err: error,
          },
          "User mapping store file contains invalid JSON"
        );
        throw new UserMappingStorageError(
          "read",
          `Invalid JSON in user mapping store: ${error.message}`,
          error,
          false
        );
      }

      this.logger.error(
        {
          metric: "user_mapping_store.load_ms",
          value: durationMs,
          filePath: this.filePath,
          err: error,
        },
        "Failed to load user mapping store"
      );

      throw new UserMappingStorageError(
        "read",
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined,
        false
      );
    }
  }

  /**
   * Save mapping rules to storage
   *
   * Uses atomic write pattern (temp file + rename) to prevent data corruption.
   * Updates the in-memory cache after successful write.
   *
   * @param rules - Array of mapping rules to save
   * @throws {UserMappingStorageError} If file cannot be written
   */
  async saveRules(rules: UserMappingRule[]): Promise<void> {
    const tempPath = `${this.filePath}.tmp`;
    const startTime = performance.now();

    try {
      // Ensure directory exists
      const fs = await import("fs/promises");
      const path = await import("path");
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });

      // Prepare file content
      const storeFile: UserMappingStoreFile = {
        version: "1.0",
        rules,
        lastModified: new Date().toISOString(),
      };

      const content = JSON.stringify(storeFile, null, 2);

      // Write to temporary file using Bun's native API
      await Bun.write(tempPath, content);

      // Atomic rename
      await fs.rename(tempPath, this.filePath);

      // Update cache
      this.rulesCache = [...rules];

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.debug(
        {
          metric: "user_mapping_store.save_ms",
          value: durationMs,
          ruleCount: rules.length,
        },
        "User mapping store saved"
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      // Attempt to clean up temp file
      try {
        const fs = await import("fs/promises");
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      this.logger.error(
        {
          metric: "user_mapping_store.save_ms",
          value: durationMs,
          filePath: this.filePath,
          err: error,
        },
        "Failed to save user mapping store"
      );

      throw new UserMappingStorageError(
        "write",
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined,
        false
      );
    }
  }

  /**
   * Invalidate the in-memory cache
   *
   * Forces next `loadRules()` call to read from disk.
   */
  invalidateCache(): void {
    this.rulesCache = null;
  }

  /**
   * Start watching the storage file for changes
   *
   * Uses debouncing to prevent multiple rapid reloads.
   */
  startWatcher(): void {
    if (this.watcher) {
      this.logger.debug("File watcher already running");
      return;
    }

    try {
      // Bind handler to preserve 'this' context in callback
      const boundHandler = (): void => this.handleFileChange();
      this.watcher = watch(this.filePath, (eventType) => {
        if (eventType === "change") {
          boundHandler();
        }
      });

      this.watcher.on("error", (error: Error) => {
        this.logger.error({ err: error, filePath: this.filePath }, "File watcher error");

        // Attempt to restart watcher
        this.stopWatcher();
        setTimeout(() => {
          try {
            this.startWatcher();
          } catch {
            // Ignore restart errors
          }
        }, 1000);
      });

      this.logger.info(
        { filePath: this.filePath, debounceMs: this.debounceMs },
        "Started file watcher for user mapping store"
      );
    } catch (error) {
      throw new UserMappingWatcherError(
        "Failed to start file watcher",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Stop watching the storage file
   */
  stopWatcher(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.logger.info("Stopped file watcher for user mapping store");
    }
  }

  /**
   * Check if file watcher is running
   */
  isWatcherRunning(): boolean {
    return this.watcher !== null;
  }

  /**
   * Register a callback for when rules change
   *
   * @param callback - Function to call when rules change
   */
  onRulesChanged(callback: () => void): void {
    this.changeCallbacks.add(callback);
  }

  /**
   * Unregister a rules changed callback
   *
   * @param callback - Function to unregister
   */
  offRulesChanged(callback: () => void): void {
    this.changeCallbacks.delete(callback);
  }

  /**
   * Handle file change event with debouncing
   */
  private handleFileChange(): void {
    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new debounce timer
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;

      this.logger.debug("File change detected, reloading rules");

      // Invalidate cache to force reload
      this.invalidateCache();

      // Reload rules asynchronously and notify callbacks
      void this.reloadAfterChange();
    }, this.debounceMs);
  }

  /**
   * Reload rules after file change and notify callbacks
   */
  private async reloadAfterChange(): Promise<void> {
    try {
      // Reload rules to validate and update cache
      await this.loadRules();

      // Notify all registered callbacks
      for (const callback of this.changeCallbacks) {
        try {
          callback();
        } catch (error) {
          this.logger.error({ err: error }, "Error in rules changed callback");
        }
      }

      this.logger.info("Rules reloaded after file change");
    } catch (error) {
      this.logger.error({ err: error }, "Failed to reload rules after file change");
    }
  }
}
