/**
 * Token Store Implementation
 *
 * Provides a singleton file-based storage implementation for authentication tokens.
 * Uses atomic writes to prevent data corruption and in-memory caching for
 * fast validation (<10ms target).
 *
 * @module auth/token-store
 */

import { join } from "path";
import type { Logger } from "pino";
import type { TokenStore, StoredToken, TokenStoreFile } from "./types.js";
import { TokenStorageError } from "./errors.js";
import { TokenStoreFileSchema } from "./validation.js";
import { getComponentLogger } from "../logging/index.js";

/**
 * Singleton implementation of token storage
 *
 * Manages token persistence in a JSON file with atomic writes for data safety.
 * Implements the TokenStore interface with a singleton pattern to ensure
 * consistent access across the application.
 *
 * **File Location:** `{DATA_PATH}/tokens.json`
 * **Default DATA_PATH:** `./data`
 *
 * **Features:**
 * - Singleton pattern for global access
 * - In-memory cache for fast validation (<10ms)
 * - Atomic writes using temp file + rename pattern
 * - Automatic file creation if missing
 * - Graceful error handling with detailed error messages
 * - Performance metrics logging
 *
 * @example
 * ```typescript
 * // Get singleton instance
 * const store = TokenStoreImpl.getInstance();
 *
 * // Load tokens (uses cache after first load)
 * const tokens = await store.loadTokens();
 *
 * // Save tokens (atomic write)
 * await store.saveTokens(tokens);
 * ```
 */
export class TokenStoreImpl implements TokenStore {
  /**
   * Singleton instance
   *
   * Ensures only one token store instance exists in the application.
   * Access via `getInstance()` instead of constructing directly.
   */
  private static instance: TokenStoreImpl | null = null;

  /**
   * Absolute path to the tokens JSON file
   */
  private readonly filePath: string;

  /**
   * Lazy-initialized logger to avoid module load-time initialization
   */
  private _logger: Logger | null = null;

  /**
   * In-memory cache for fast validation
   *
   * Populated on first `loadTokens()` call, invalidated on writes.
   */
  private tokenCache: Map<string, StoredToken> | null = null;

  /**
   * Private constructor enforces singleton pattern
   *
   * Use `getInstance()` to obtain the singleton instance.
   *
   * @param dataPath - Base directory for data storage
   */
  private constructor(dataPath: string) {
    this.filePath = join(dataPath, "tokens.json");
  }

  /**
   * Lazy-initialized component logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("auth:token-store");
    }
    return this._logger;
  }

  /**
   * Get the singleton instance of the token store
   *
   * Creates the instance on first call using the specified data path.
   * Subsequent calls return the existing instance regardless of the dataPath parameter.
   *
   * @param dataPath - Optional data directory path (default: process.env.DATA_PATH || "./data")
   * @returns The singleton token store instance
   *
   * @example
   * ```typescript
   * // Get instance with default path
   * const store = TokenStoreImpl.getInstance();
   *
   * // Get instance with custom path (only on first call)
   * const store = TokenStoreImpl.getInstance("/custom/data/path");
   * ```
   */
  public static getInstance(dataPath?: string): TokenStoreImpl {
    if (!TokenStoreImpl.instance) {
      const path = dataPath || process.env["DATA_PATH"] || "./data";
      TokenStoreImpl.instance = new TokenStoreImpl(path);
    } else if (dataPath !== undefined) {
      // Log warning if a different path is requested after initialization
      const logger = getComponentLogger("auth:token-store");
      logger.warn(
        { requestedPath: dataPath },
        "getInstance called with dataPath after singleton already initialized - ignoring new path"
      );
    }
    return TokenStoreImpl.instance;
  }

  /**
   * Reset the singleton instance
   *
   * **FOR TESTING ONLY** - Allows tests to create fresh instances with different configurations.
   * Should never be called in production code.
   *
   * @internal
   */
  public static resetInstance(): void {
    TokenStoreImpl.instance = null;
  }

  /**
   * Get the storage file path
   *
   * @returns Absolute path to the tokens.json file
   */
  getStoragePath(): string {
    return this.filePath;
  }

  /**
   * Load all tokens from storage
   *
   * Uses in-memory cache for subsequent calls to meet <10ms validation target.
   * Creates an empty token store if the file doesn't exist.
   *
   * @returns Map of token hash to stored token record
   * @throws {TokenStorageError} If file cannot be read or parsed
   */
  async loadTokens(): Promise<Map<string, StoredToken>> {
    // Return cached tokens if available (fast path)
    if (this.tokenCache !== null) {
      return new Map(this.tokenCache);
    }

    const startTime = performance.now();

    try {
      const file = Bun.file(this.filePath);
      const exists = await file.exists();

      if (!exists) {
        this.logger.info(
          { filePath: this.filePath },
          "Token store not found - creating empty store"
        );
        this.tokenCache = new Map();
        await this.saveTokens(this.tokenCache);
        return new Map(this.tokenCache);
      }

      const content = await file.text();
      const parsed: unknown = JSON.parse(content);

      // Validate file format
      const validated = TokenStoreFileSchema.parse(parsed);

      // Convert to Map
      this.tokenCache = new Map(Object.entries(validated.tokens));

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.info(
        {
          metric: "token_store.load_ms",
          value: durationMs,
          tokenCount: this.tokenCache.size,
        },
        "Token store loaded"
      );

      return new Map(this.tokenCache);
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);

      if (error instanceof SyntaxError) {
        this.logger.error(
          {
            metric: "token_store.load_ms",
            value: durationMs,
            filePath: this.filePath,
            err: error,
          },
          "Token store file contains invalid JSON"
        );
        throw new TokenStorageError(
          "read",
          `Invalid JSON in token store: ${error.message}`,
          error,
          false
        );
      }

      this.logger.error(
        {
          metric: "token_store.load_ms",
          value: durationMs,
          filePath: this.filePath,
          err: error,
        },
        "Failed to load token store"
      );

      throw new TokenStorageError(
        "read",
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined,
        false
      );
    }
  }

  /**
   * Save all tokens to storage
   *
   * Uses atomic write pattern (temp file + rename) to prevent data corruption.
   * Updates the in-memory cache after successful write.
   *
   * @param tokens - Map of token hash to stored token record
   * @throws {TokenStorageError} If file cannot be written
   */
  async saveTokens(tokens: Map<string, StoredToken>): Promise<void> {
    const tempPath = `${this.filePath}.tmp`;
    const startTime = performance.now();

    try {
      // Prepare file content
      const storeFile: TokenStoreFile = {
        version: "1.0",
        tokens: Object.fromEntries(tokens),
      };

      const content = JSON.stringify(storeFile, null, 2);

      // Write to temporary file using Bun's native API
      await Bun.write(tempPath, content);

      // Atomic rename (use Node.js fs for rename as Bun doesn't expose it)
      const fs = await import("fs/promises");
      await fs.rename(tempPath, this.filePath);

      // Update cache
      this.tokenCache = new Map(tokens);

      const durationMs = Math.round(performance.now() - startTime);
      this.logger.debug(
        {
          metric: "token_store.save_ms",
          value: durationMs,
          tokenCount: tokens.size,
        },
        "Token store saved"
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
          metric: "token_store.save_ms",
          value: durationMs,
          filePath: this.filePath,
          err: error,
        },
        "Failed to save token store"
      );

      throw new TokenStorageError(
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
   * Forces next `loadTokens()` call to read from disk.
   * Used after external modifications or for testing.
   */
  invalidateCache(): void {
    this.tokenCache = null;
  }
}
