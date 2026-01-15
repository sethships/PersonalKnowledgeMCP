/**
 * Custom error classes for model cache operations
 *
 * These error classes provide structured error handling for model download,
 * caching, validation, and import operations.
 *
 * @see Issue #165: Add model download and caching logic
 */

import type { CacheableProvider } from "./model-cache-types.js";

/**
 * Base error class for all model cache-related errors
 *
 * Extends the native Error class with additional context including error codes,
 * retryability flags, and cause chaining for integration with error handling systems.
 */
export class ModelCacheError extends Error {
  /**
   * Error code for categorization and handling
   */
  public readonly code: string;

  /**
   * Indicates whether this error represents a transient failure that may succeed on retry
   */
  public readonly retryable: boolean;

  /**
   * Original error that caused this error (if any)
   */
  public override readonly cause?: Error;

  /**
   * Create a new ModelCacheError
   *
   * @param message - Human-readable error message
   * @param code - Error code for categorization (default: 'MODEL_CACHE_ERROR')
   * @param retryable - Whether this error is retryable (default: false)
   * @param cause - Original error that caused this error
   */
  constructor(
    message: string,
    code: string = "MODEL_CACHE_ERROR",
    retryable: boolean = false,
    cause?: Error
  ) {
    super(message);
    this.name = "ModelCacheError";
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;

    // Maintain proper stack trace for where our error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Include cause stack trace if available
    if (cause && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

/**
 * Error thrown when a model is not found in the cache
 *
 * This error indicates that the requested model does not exist in the cache
 * and needs to be downloaded first.
 *
 * @example
 * ```typescript
 * try {
 *   const model = await cacheService.getCachedModel("transformersjs", "unknown-model");
 * } catch (error) {
 *   if (error instanceof ModelNotFoundError) {
 *     console.log("Model not cached, downloading...");
 *     await cacheService.downloadModel("transformersjs", "unknown-model");
 *   }
 * }
 * ```
 */
export class ModelNotFoundError extends ModelCacheError {
  /**
   * Provider where the model was not found
   */
  public readonly provider: CacheableProvider;

  /**
   * Model identifier that was not found
   */
  public readonly modelId: string;

  constructor(provider: CacheableProvider, modelId: string, cause?: Error) {
    super(`Model "${modelId}" not found in ${provider} cache`, "MODEL_NOT_FOUND", false, cause);
    this.name = "ModelNotFoundError";
    this.provider = provider;
    this.modelId = modelId;
  }
}

/**
 * Error thrown when a model download fails
 *
 * This error indicates that downloading a model from the remote source failed.
 * This IS retryable as the network issue may be temporary.
 *
 * @example
 * ```typescript
 * try {
 *   await cacheService.downloadModel("transformersjs", "Xenova/all-MiniLM-L6-v2");
 * } catch (error) {
 *   if (error instanceof ModelDownloadError) {
 *     if (error.retryable) {
 *       console.log("Retrying download...");
 *     } else {
 *       console.error("Download failed permanently:", error.message);
 *     }
 *   }
 * }
 * ```
 */
export class ModelDownloadError extends ModelCacheError {
  /**
   * Provider for which the download failed
   */
  public readonly provider: CacheableProvider;

  /**
   * Model identifier that failed to download
   */
  public readonly modelId: string;

  /**
   * HTTP status code if the failure was from an HTTP response
   */
  public readonly statusCode?: number;

  constructor(
    provider: CacheableProvider,
    modelId: string,
    message: string,
    retryable: boolean = true,
    statusCode?: number,
    cause?: Error
  ) {
    super(
      `Failed to download model "${modelId}" for ${provider}: ${message}`,
      "MODEL_DOWNLOAD_ERROR",
      retryable,
      cause
    );
    this.name = "ModelDownloadError";
    this.provider = provider;
    this.modelId = modelId;
    this.statusCode = statusCode;
  }
}

/**
 * Error thrown when model validation fails
 *
 * This error indicates that a cached model is corrupted or incomplete.
 * This is NOT retryable - the model needs to be re-downloaded.
 *
 * @example
 * ```typescript
 * try {
 *   await cacheService.validateCachedModel("transformersjs", "Xenova/all-MiniLM-L6-v2");
 * } catch (error) {
 *   if (error instanceof ModelValidationError) {
 *     console.log("Model corrupted, re-downloading...");
 *     await cacheService.downloadModel("transformersjs", "Xenova/all-MiniLM-L6-v2", { force: true });
 *   }
 * }
 * ```
 */
export class ModelValidationError extends ModelCacheError {
  /**
   * Provider for which validation failed
   */
  public readonly provider: CacheableProvider;

  /**
   * Model identifier that failed validation
   */
  public readonly modelId: string;

  /**
   * List of specific validation issues found
   */
  public readonly issues: string[];

  constructor(provider: CacheableProvider, modelId: string, issues: string[], cause?: Error) {
    const issueList = issues.length > 0 ? `: ${issues.join(", ")}` : "";
    super(
      `Model "${modelId}" in ${provider} cache failed validation${issueList}`,
      "MODEL_VALIDATION_ERROR",
      false,
      cause
    );
    this.name = "ModelValidationError";
    this.provider = provider;
    this.modelId = modelId;
    this.issues = issues;
  }
}

/**
 * Error thrown when model import fails
 *
 * This error indicates that importing a model from local files failed.
 * This is NOT retryable as it usually indicates a configuration or file system issue.
 *
 * @example
 * ```typescript
 * try {
 *   await cacheService.importModel({
 *     sourcePath: "/path/to/model",
 *     provider: "transformersjs",
 *     modelId: "custom-model"
 *   });
 * } catch (error) {
 *   if (error instanceof ModelImportError) {
 *     console.error("Import failed:", error.message);
 *   }
 * }
 * ```
 */
export class ModelImportError extends ModelCacheError {
  /**
   * Provider for which import failed
   */
  public readonly provider: CacheableProvider;

  /**
   * Model identifier for the import
   */
  public readonly modelId: string;

  /**
   * Source path that was being imported from
   */
  public readonly sourcePath: string;

  constructor(
    provider: CacheableProvider,
    modelId: string,
    sourcePath: string,
    message: string,
    cause?: Error
  ) {
    super(
      `Failed to import model "${modelId}" for ${provider} from "${sourcePath}": ${message}`,
      "MODEL_IMPORT_ERROR",
      false,
      cause
    );
    this.name = "ModelImportError";
    this.provider = provider;
    this.modelId = modelId;
    this.sourcePath = sourcePath;
  }
}

/**
 * Error thrown when cache clearing fails
 *
 * This error indicates that clearing the model cache failed.
 * This may be retryable depending on the cause (e.g., file in use).
 *
 * @example
 * ```typescript
 * try {
 *   await cacheService.clearModel("transformersjs", "Xenova/all-MiniLM-L6-v2");
 * } catch (error) {
 *   if (error instanceof CacheClearError) {
 *     console.error("Failed to clear cache:", error.message);
 *   }
 * }
 * ```
 */
export class CacheClearError extends ModelCacheError {
  /**
   * Provider for which clearing failed
   */
  public readonly provider?: CacheableProvider;

  /**
   * Model identifier that failed to clear (if specific model)
   */
  public readonly modelId?: string;

  constructor(message: string, provider?: CacheableProvider, modelId?: string, cause?: Error) {
    const context = modelId
      ? `model "${modelId}" in ${provider}`
      : provider
        ? `${provider} cache`
        : "all caches";
    super(`Failed to clear ${context}: ${message}`, "CACHE_CLEAR_ERROR", false, cause);
    this.name = "CacheClearError";
    this.provider = provider;
    this.modelId = modelId;
  }
}

/**
 * Error thrown when the cache directory cannot be accessed
 *
 * This error indicates file system permission or access issues.
 * This is NOT retryable without fixing the underlying permission issue.
 *
 * @example
 * ```typescript
 * try {
 *   const status = await cacheService.getCacheStatus("transformersjs");
 * } catch (error) {
 *   if (error instanceof CacheAccessError) {
 *     console.error("Cannot access cache directory:", error.path);
 *   }
 * }
 * ```
 */
export class CacheAccessError extends ModelCacheError {
  /**
   * Path that could not be accessed
   */
  public readonly path: string;

  /**
   * Type of access that failed (read, write, create)
   */
  public readonly accessType: "read" | "write" | "create";

  constructor(
    path: string,
    accessType: "read" | "write" | "create",
    message: string,
    cause?: Error
  ) {
    super(
      `Cannot ${accessType} cache at "${path}": ${message}`,
      "CACHE_ACCESS_ERROR",
      false,
      cause
    );
    this.name = "CacheAccessError";
    this.path = path;
    this.accessType = accessType;
  }
}

/**
 * Error thrown when the provider is not available
 *
 * This error indicates that the provider (e.g., Ollama server) is not running
 * or not accessible.
 *
 * @example
 * ```typescript
 * try {
 *   const status = await cacheService.getCacheStatus("ollama");
 * } catch (error) {
 *   if (error instanceof ProviderNotAvailableError) {
 *     console.error("Ollama server not running at", error.endpoint);
 *   }
 * }
 * ```
 */
export class ProviderNotAvailableError extends ModelCacheError {
  /**
   * Provider that is not available
   */
  public readonly provider: CacheableProvider;

  /**
   * Endpoint that could not be reached (for server-based providers)
   */
  public readonly endpoint?: string;

  constructor(provider: CacheableProvider, message: string, endpoint?: string, cause?: Error) {
    super(
      `Provider "${provider}" is not available: ${message}`,
      "PROVIDER_NOT_AVAILABLE",
      true,
      cause
    );
    this.name = "ProviderNotAvailableError";
    this.provider = provider;
    this.endpoint = endpoint;
  }
}
