/**
 * Model Cache Service Types
 *
 * Type definitions for model download and caching functionality.
 * Supports both Transformers.js and Ollama embedding providers.
 *
 * @see Issue #165: Add model download and caching logic
 */

import type { ModelDownloadProgress } from "../providers/transformersjs-embedding.js";

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Supported embedding provider types for caching
 */
export type CacheableProvider = "transformersjs" | "ollama";

// ============================================================================
// Cached Model Information
// ============================================================================

/**
 * Information about a cached embedding model
 */
export interface CachedModelInfo {
  /** Provider that uses this model */
  provider: CacheableProvider;

  /** Model identifier (e.g., "Xenova/all-MiniLM-L6-v2" or "nomic-embed-text") */
  modelId: string;

  /** Full path to the cached model files */
  path: string;

  /** Total size of cached files in bytes */
  sizeBytes: number;

  /** When the model was downloaded */
  downloadedAt: Date;

  /** Last time the model was accessed/used */
  lastAccessedAt?: Date;

  /** Whether the cached model passed validation */
  isValid: boolean;

  /** Model-specific metadata */
  metadata?: CachedModelMetadata;
}

/**
 * Additional metadata for cached models
 */
export interface CachedModelMetadata {
  /** Model version or tag (e.g., "latest", "v1.0") */
  version?: string;

  /** Source URL where the model was downloaded from */
  sourceUrl?: string;

  /** SHA256 checksum for validation (if available) */
  checksum?: string;

  /** Whether this is a quantized model variant */
  quantized?: boolean;

  /** Embedding dimensions for this model */
  dimensions?: number;
}

// ============================================================================
// Cache Status
// ============================================================================

/**
 * Overall cache status for a provider
 */
export interface CacheStatus {
  /** Provider identifier */
  provider: CacheableProvider;

  /** Base cache directory path */
  cacheDir: string;

  /** Whether the cache directory exists */
  exists: boolean;

  /** Total size of all cached models in bytes */
  totalSizeBytes: number;

  /** Number of cached models */
  modelCount: number;

  /** List of cached models */
  models: CachedModelInfo[];
}

/**
 * Aggregated cache status across all providers
 */
export interface AggregatedCacheStatus {
  /** Total size across all providers */
  totalSizeBytes: number;

  /** Total number of cached models */
  totalModelCount: number;

  /** Per-provider status */
  providers: CacheStatus[];
}

// ============================================================================
// Model Download Options
// ============================================================================

/**
 * Options for downloading a model
 */
export interface ModelDownloadOptions {
  /** Force re-download even if model is already cached */
  force?: boolean;

  /** Progress callback for download status */
  onProgress?: (progress: ModelDownloadProgress) => void;

  /** Timeout in milliseconds for the download operation */
  timeout?: number;

  /** Validate the model after download completes */
  validateAfterDownload?: boolean;

  /** Use quantized model variant (Transformers.js only) */
  quantized?: boolean;

  /** Custom cache directory (Transformers.js only) */
  cacheDir?: string;
}

/**
 * Result of a model download operation
 */
export interface ModelDownloadResult {
  /** Whether the download was successful */
  success: boolean;

  /** Model information after download */
  model?: CachedModelInfo;

  /** Error message if download failed */
  error?: string;

  /** Download duration in milliseconds */
  durationMs: number;

  /** Whether the model was already cached (skipped download) */
  skipped?: boolean;
}

// ============================================================================
// Model Validation
// ============================================================================

/**
 * Result of validating a cached model
 */
export interface ModelValidationResult {
  /** Whether the model is valid */
  valid: boolean;

  /** Model identifier that was validated */
  modelId: string;

  /** Provider of the model */
  provider: CacheableProvider;

  /** List of validation issues found (if any) */
  issues?: string[];

  /** Validation timestamp */
  validatedAt: Date;

  /** Details about what was checked */
  checks?: ValidationCheck[];
}

/**
 * Individual validation check result
 */
export interface ValidationCheck {
  /** Name of the check */
  name: string;

  /** Whether this check passed */
  passed: boolean;

  /** Description of what was checked */
  description: string;

  /** Error message if check failed */
  error?: string;
}

// ============================================================================
// Model Import (Air-Gapped Support)
// ============================================================================

/**
 * Options for importing a model from local files
 */
export interface ModelImportOptions {
  /** Source path containing the model files */
  sourcePath: string;

  /** Provider type for the model */
  provider: CacheableProvider;

  /** Model identifier to use in the cache */
  modelId: string;

  /** Validate after import */
  validate?: boolean;

  /** Overwrite existing cached model */
  overwrite?: boolean;
}

/**
 * Result of importing a model
 */
export interface ModelImportResult {
  /** Whether the import was successful */
  success: boolean;

  /** Imported model information */
  model?: CachedModelInfo;

  /** Error message if import failed */
  error?: string;

  /** Number of files copied */
  filesCopied?: number;

  /** Total bytes copied */
  bytesCopied?: number;
}

// ============================================================================
// Cache Clear Operations
// ============================================================================

/**
 * Options for clearing cached models
 */
export interface CacheClearOptions {
  /** Only clear models matching this provider */
  provider?: CacheableProvider;

  /** Only clear this specific model */
  modelId?: string;

  /** Skip confirmation (for CLI) */
  force?: boolean;

  /** Dry run - show what would be cleared without actually clearing */
  dryRun?: boolean;
}

/**
 * Result of a cache clear operation
 */
export interface CacheClearResult {
  /** Whether the operation was successful */
  success: boolean;

  /** Number of models removed */
  modelsCleared: number;

  /** Bytes freed */
  bytesFreed: number;

  /** Models that were cleared */
  clearedModels: string[];

  /** Error message if operation failed */
  error?: string;

  /** Whether this was a dry run */
  dryRun: boolean;
}

// ============================================================================
// Model Path Information
// ============================================================================

/**
 * Path information for manual model placement
 */
export interface ModelPathInfo {
  /** Provider type */
  provider: CacheableProvider;

  /** Model identifier */
  modelId: string;

  /** Base cache directory */
  cacheDir: string;

  /** Full path where model should be placed */
  modelPath: string;

  /** Expected directory structure */
  expectedStructure: string[];

  /** Required files for the model to be valid */
  requiredFiles: string[];
}

// ============================================================================
// Service Configuration
// ============================================================================

/**
 * Configuration for the Model Cache Service
 */
export interface ModelCacheServiceConfig {
  /** Custom cache directory for Transformers.js models */
  transformersCacheDir?: string;

  /** Ollama server base URL */
  ollamaBaseUrl?: string;

  /** Default timeout for download operations in milliseconds */
  defaultTimeoutMs?: number;

  /** Whether to validate models after download by default */
  validateByDefault?: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_MODEL_CACHE_CONFIG: Required<ModelCacheServiceConfig> = {
  transformersCacheDir: "", // Empty string means use default (~/.cache/huggingface/transformers)
  ollamaBaseUrl: "http://localhost:11434",
  defaultTimeoutMs: 300000, // 5 minutes
  validateByDefault: true,
};
