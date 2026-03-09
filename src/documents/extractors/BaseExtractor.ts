/**
 * Abstract base class for document extractors.
 *
 * Provides shared infrastructure used by all extractors: lazy logger
 * initialization, file I/O helpers, word counting, and content hashing.
 * Concrete extractors extend this class and implement `extract()` and
 * `supports()` from the {@link DocumentExtractor} interface.
 *
 * @module documents/extractors/BaseExtractor
 */

import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { getComponentLogger } from "../../logging/index.js";
import { FileAccessError, FileTooLargeError } from "../errors.js";
import type { DocumentExtractor, ExtractorConfig } from "../types.js";

/** Shared no-op function for the silent logger */
const noop = (): void => {};

/** No-op logger returned when the logging system is not yet initialized */
const noopLogger = {
  warn: noop,
  info: noop,
  error: noop,
  debug: noop,
  trace: noop,
  fatal: noop,
  level: "silent" as const,
  silent: true,
} as unknown as ReturnType<typeof getComponentLogger>;

/**
 * Abstract base class providing shared extractor infrastructure.
 *
 * Encapsulates the lazy-logger pattern, file I/O helpers, word counting,
 * and content hashing that every concrete extractor needs.
 *
 * @typeParam TConfig - Extractor-specific configuration (must extend {@link ExtractorConfig})
 * @typeParam TResult - The extraction result type returned by `extract()`
 *
 * @example
 * ```typescript
 * class MyExtractor extends BaseExtractor<Required<MyConfig>, MyResult> {
 *   constructor(config?: MyConfig) {
 *     super("documents:my-extractor", {  // Pass fully-resolved config
 *       maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
 *       timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
 *       customOption: config?.customOption ?? true,
 *     });
 *   }
 *
 *   async extract(filePath: string): Promise<MyResult> { ... }
 *   supports(extension: string): boolean { ... }
 * }
 * ```
 */
export abstract class BaseExtractor<
  TConfig extends ExtractorConfig,
  TResult,
> implements DocumentExtractor<TResult> {
  protected readonly config: Required<TConfig>;
  private logger: ReturnType<typeof getComponentLogger> | null = null;
  private readonly componentName: string;

  /**
   * @param componentName - Logger component name (e.g. "documents:pdf-extractor")
   * @param config - Fully-resolved configuration with all defaults applied
   */
  constructor(componentName: string, config: Required<TConfig>) {
    this.componentName = componentName;
    this.config = config;
  }

  // ── Interface methods ────────────────────────────────────────────

  abstract extract(filePath: string): Promise<TResult>;
  abstract supports(extension: string): boolean;

  // ── Public helpers ───────────────────────────────────────────────

  /**
   * Get the current configuration.
   *
   * @returns The extractor configuration
   */
  getConfig(): Readonly<Required<TConfig>> {
    return this.config;
  }

  // ── Protected helpers (available to subclasses) ──────────────────

  /**
   * Get the component logger, initializing lazily on first call.
   *
   * Returns a silent no-op logger when the logging system has not been
   * initialized (e.g. during unit tests), so callers never need to
   * null-check.
   */
  protected getLogger(): ReturnType<typeof getComponentLogger> {
    if (!this.logger) {
      try {
        this.logger = getComponentLogger(this.componentName);
      } catch {
        return noopLogger;
      }
    }
    return this.logger;
  }

  /**
   * Get file stats and handle errors.
   *
   * @param filePath - Path to the file
   * @returns File stats with size and modification time
   * @throws {FileAccessError} If file cannot be accessed
   */
  protected async getFileStats(filePath: string): Promise<{ size: number; mtime: Date }> {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        throw new FileAccessError(`File not found: ${filePath}`, {
          filePath,
          cause: error instanceof Error ? error : undefined,
        });
      }
      if (nodeError.code === "EACCES") {
        throw new FileAccessError(`Permission denied: ${filePath}`, {
          filePath,
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileAccessError(`Cannot access file: ${filePath}`, {
        filePath,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Read file contents as a binary buffer.
   *
   * @param filePath - Path to the file
   * @returns File contents as Buffer
   * @throws {FileAccessError} If file cannot be read
   */
  protected async readFileBuffer(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new FileAccessError(`Cannot read file: ${filePath}`, {
        filePath,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Read file contents as a UTF-8 string.
   *
   * @param filePath - Path to the file
   * @returns File contents as string
   * @throws {FileAccessError} If file cannot be read
   */
  protected async readFileContent(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error) {
      throw new FileAccessError(`Cannot read file: ${filePath}`, {
        filePath,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Validate that a file does not exceed the configured size limit.
   *
   * @param size - Actual file size in bytes
   * @param filePath - Path to the file (for error context)
   * @throws {FileTooLargeError} If file exceeds maximum size
   */
  protected validateFileSize(size: number, filePath: string): void {
    // Safe cast: all concrete subclasses pass Required<TConfig>, so maxFileSizeBytes is always number.
    // TypeScript cannot statically resolve Required<generic>.optionalField to non-optional.
    const maxSize = this.config.maxFileSizeBytes as number;
    if (size > maxSize) {
      throw new FileTooLargeError(
        `File exceeds maximum size of ${maxSize} bytes (actual: ${size} bytes)`,
        size,
        maxSize,
        { filePath }
      );
    }
  }

  /**
   * Count words in text.
   *
   * @param text - Text to count words in
   * @returns Word count
   */
  protected countWords(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }
    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }

  /**
   * Compute SHA-256 hash of content.
   *
   * @param content - Content buffer or string to hash
   * @returns Hex-encoded SHA-256 hash with sha256: prefix
   */
  protected computeContentHash(content: Buffer | string): string {
    const hasher = crypto.createHash("sha256");
    if (typeof content === "string") {
      hasher.update(content, "utf-8");
    } else {
      hasher.update(content);
    }
    return `sha256:${hasher.digest("hex")}`;
  }
}
