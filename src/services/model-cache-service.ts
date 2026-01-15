/**
 * Model Cache Service
 *
 * Provides unified model download and cache management for embedding providers.
 * Supports both Transformers.js and Ollama embedding models.
 *
 * Features:
 * - Query cache status and list cached models
 * - Download models with progress reporting
 * - Validate cached model integrity
 * - Clear models from cache
 * - Support for air-gapped/manual model placement
 *
 * @see Issue #165: Add model download and caching logic
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { existsSync, statSync, readdirSync } from "node:fs";
import * as os from "node:os";

import type {
  CacheableProvider,
  CachedModelInfo,
  CacheStatus,
  AggregatedCacheStatus,
  ModelDownloadOptions,
  ModelDownloadResult,
  ModelValidationResult,
  ValidationCheck,
  ModelImportOptions,
  ModelImportResult,
  CacheClearOptions,
  CacheClearResult,
  ModelPathInfo,
  ModelCacheServiceConfig,
} from "./model-cache-types.js";
import type { ModelDownloadProgress } from "../providers/transformersjs-embedding.js";
import {
  ModelCacheError,
  ModelNotFoundError,
  ModelDownloadError,
  ModelValidationError,
  ModelImportError,
  CacheClearError,
  CacheAccessError,
  ProviderNotAvailableError,
} from "./model-cache-errors.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Default cache directory for Transformers.js models
 */
const DEFAULT_TRANSFORMERS_CACHE_DIR = path.join(
  os.homedir(),
  ".cache",
  "huggingface",
  "transformers"
);

/**
 * Default Ollama server URL
 */
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * Timeout for Ollama API requests (5 seconds)
 */
const OLLAMA_API_TIMEOUT_MS = 5000;

/**
 * Timeout for model download operations (5 minutes default)
 */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 300000;

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Model Cache Service
 *
 * Manages model caching for Transformers.js and Ollama embedding providers.
 */
export class ModelCacheService {
  private readonly config: Required<ModelCacheServiceConfig>;

  /**
   * Create a new ModelCacheService
   *
   * @param config - Service configuration options
   */
  constructor(config: Partial<ModelCacheServiceConfig> = {}) {
    this.config = {
      transformersCacheDir: config.transformersCacheDir || "",
      ollamaBaseUrl: config.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL,
      defaultTimeoutMs: config.defaultTimeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS,
      validateByDefault: config.validateByDefault ?? true,
    };
  }

  // ==========================================================================
  // Cache Directory Methods
  // ==========================================================================

  /**
   * Get the cache directory for a provider
   *
   * @param provider - The provider to get the cache directory for
   * @returns Full path to the cache directory
   */
  getCacheDir(provider: CacheableProvider): string {
    switch (provider) {
      case "transformersjs":
        return this.config.transformersCacheDir || DEFAULT_TRANSFORMERS_CACHE_DIR;
      case "ollama":
        // Ollama manages its own cache internally - return a descriptive path
        return "[managed by Ollama server]";
      default:
        throw new ModelCacheError(`Unknown provider: ${String(provider)}`);
    }
  }

  // ==========================================================================
  // Cache Status Methods
  // ==========================================================================

  /**
   * Get cache status for a specific provider
   *
   * @param provider - The provider to get status for
   * @returns Cache status including size, model count, and model list
   */
  async getCacheStatus(provider: CacheableProvider): Promise<CacheStatus> {
    switch (provider) {
      case "transformersjs":
        return this.getTransformersCacheStatus();
      case "ollama":
        return this.getOllamaCacheStatus();
      default:
        throw new ModelCacheError(`Unknown provider: ${String(provider)}`);
    }
  }

  /**
   * Get aggregated cache status across all providers
   *
   * @returns Combined cache status for all providers
   */
  async getAggregatedCacheStatus(): Promise<AggregatedCacheStatus> {
    const providers: CacheStatus[] = [];

    // Get Transformers.js status
    try {
      providers.push(this.getTransformersCacheStatus());
    } catch (error) {
      // Include error status for the provider
      providers.push({
        provider: "transformersjs",
        cacheDir: this.getCacheDir("transformersjs"),
        exists: false,
        totalSizeBytes: 0,
        modelCount: 0,
        models: [],
      });
    }

    // Get Ollama status
    try {
      providers.push(await this.getOllamaCacheStatus());
    } catch {
      providers.push({
        provider: "ollama",
        cacheDir: this.getCacheDir("ollama"),
        exists: false,
        totalSizeBytes: 0,
        modelCount: 0,
        models: [],
      });
    }

    return {
      totalSizeBytes: providers.reduce((sum, p) => sum + p.totalSizeBytes, 0),
      totalModelCount: providers.reduce((sum, p) => sum + p.modelCount, 0),
      providers,
    };
  }

  /**
   * List all cached models for a provider (or all providers)
   *
   * @param provider - Optional provider filter
   * @returns Array of cached model information
   */
  async listCachedModels(provider?: CacheableProvider): Promise<CachedModelInfo[]> {
    if (provider) {
      const status = await this.getCacheStatus(provider);
      return status.models;
    }

    const aggregated = await this.getAggregatedCacheStatus();
    return aggregated.providers.flatMap((p) => p.models);
  }

  /**
   * Check if a specific model is cached
   *
   * @param provider - The provider
   * @param modelId - The model identifier
   * @returns True if the model is cached
   */
  async isModelCached(provider: CacheableProvider, modelId: string): Promise<boolean> {
    const models = await this.listCachedModels(provider);
    return models.some((m) => m.modelId === modelId);
  }

  // ==========================================================================
  // Model Validation Methods
  // ==========================================================================

  /**
   * Validate a cached model
   *
   * @param provider - The provider
   * @param modelId - The model identifier
   * @returns Validation result with details
   */
  async validateCachedModel(
    provider: CacheableProvider,
    modelId: string
  ): Promise<ModelValidationResult> {
    switch (provider) {
      case "transformersjs":
        return this.validateTransformersModel(modelId);
      case "ollama":
        return this.validateOllamaModel(modelId);
      default:
        throw new ModelCacheError(`Unknown provider: ${String(provider)}`);
    }
  }

  // ==========================================================================
  // Model Download Methods
  // ==========================================================================

  /**
   * Download a model with progress reporting
   *
   * @param provider - The provider
   * @param modelId - The model identifier
   * @param options - Download options
   * @returns Download result
   */
  async downloadModel(
    provider: CacheableProvider,
    modelId: string,
    options: ModelDownloadOptions = {}
  ): Promise<ModelDownloadResult> {
    const startTime = Date.now();

    try {
      // Check if already cached (unless force is set)
      if (!options.force) {
        const isCached = await this.isModelCached(provider, modelId);
        if (isCached) {
          const models = await this.listCachedModels(provider);
          const model = models.find((m) => m.modelId === modelId);
          return {
            success: true,
            model,
            durationMs: Date.now() - startTime,
            skipped: true,
          };
        }
      }

      // Clear existing cache if force is set
      if (options.force) {
        try {
          await this.clearModel(provider, modelId, { force: true });
        } catch {
          // Ignore errors if model doesn't exist
        }
      }

      switch (provider) {
        case "transformersjs":
          return this.downloadTransformersModel(modelId, options, startTime);
        case "ollama":
          return this.downloadOllamaModel(modelId, options, startTime);
        default:
          throw new ModelCacheError(`Unknown provider: ${String(provider)}`);
      }
    } catch (error) {
      if (error instanceof ModelCacheError) {
        return {
          success: false,
          error: error.message,
          durationMs: Date.now() - startTime,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ==========================================================================
  // Cache Clear Methods
  // ==========================================================================

  /**
   * Clear a specific model from cache
   *
   * @param provider - The provider
   * @param modelId - The model identifier
   * @param options - Clear options
   * @returns Clear result
   */
  async clearModel(
    provider: CacheableProvider,
    modelId: string,
    options: CacheClearOptions = {}
  ): Promise<CacheClearResult> {
    if (options.dryRun) {
      const isCached = await this.isModelCached(provider, modelId);
      if (!isCached) {
        return {
          success: true,
          modelsCleared: 0,
          bytesFreed: 0,
          clearedModels: [],
          dryRun: true,
        };
      }
      const models = await this.listCachedModels(provider);
      const model = models.find((m) => m.modelId === modelId);
      return {
        success: true,
        modelsCleared: 1,
        bytesFreed: model?.sizeBytes || 0,
        clearedModels: [modelId],
        dryRun: true,
      };
    }

    switch (provider) {
      case "transformersjs":
        return this.clearTransformersModel(modelId);
      case "ollama":
        return this.clearOllamaModel(modelId);
      default:
        throw new ModelCacheError(`Unknown provider: ${String(provider)}`);
    }
  }

  /**
   * Clear all models from cache for a provider (or all providers)
   *
   * @param options - Clear options including optional provider filter
   * @returns Clear result
   */
  async clearAllCache(options: CacheClearOptions = {}): Promise<CacheClearResult> {
    const result: CacheClearResult = {
      success: true,
      modelsCleared: 0,
      bytesFreed: 0,
      clearedModels: [],
      dryRun: options.dryRun || false,
    };

    const providers: CacheableProvider[] = options.provider
      ? [options.provider]
      : ["transformersjs", "ollama"];

    for (const provider of providers) {
      try {
        const models = await this.listCachedModels(provider);
        for (const model of models) {
          const clearResult = await this.clearModel(provider, model.modelId, options);
          result.modelsCleared += clearResult.modelsCleared;
          result.bytesFreed += clearResult.bytesFreed;
          result.clearedModels.push(...clearResult.clearedModels);
        }
      } catch (error) {
        result.success = false;
        result.error = error instanceof Error ? error.message : String(error);
      }
    }

    return result;
  }

  // ==========================================================================
  // Model Import Methods (Air-Gapped Support)
  // ==========================================================================

  /**
   * Import a model from local files for air-gapped installations
   *
   * @param options - Import options
   * @returns Import result
   */
  async importModel(options: ModelImportOptions): Promise<ModelImportResult> {
    const { sourcePath, provider, modelId, validate, overwrite } = options;

    // Normalize and validate source path to prevent directory traversal
    const normalizedSource = path.resolve(sourcePath);

    // Verify source path exists
    if (!existsSync(normalizedSource)) {
      throw new ModelImportError(provider, modelId, sourcePath, "Source path does not exist");
    }

    // Ensure source is a directory
    const sourceStats = statSync(normalizedSource);
    if (!sourceStats.isDirectory()) {
      throw new ModelImportError(provider, modelId, sourcePath, "Source path must be a directory");
    }

    switch (provider) {
      case "transformersjs":
        return this.importTransformersModel(normalizedSource, modelId, validate, overwrite);
      case "ollama":
        // Ollama models should be imported using `ollama create` command
        throw new ModelImportError(
          "ollama",
          modelId,
          sourcePath,
          "Ollama models should be imported using the 'ollama create' command. " +
            "See: https://ollama.com/docs/importing"
        );
      default:
        throw new ModelCacheError(`Unknown provider: ${String(provider)}`);
    }
  }

  /**
   * Get the path where a model should be placed for manual installation
   *
   * @param provider - The provider
   * @param modelId - The model identifier
   * @returns Path information for manual placement
   */
  getModelPath(provider: CacheableProvider, modelId: string): ModelPathInfo {
    switch (provider) {
      case "transformersjs":
        return this.getTransformersModelPath(modelId);
      case "ollama":
        return {
          provider: "ollama",
          modelId,
          cacheDir: "[managed by Ollama]",
          modelPath: "[use 'ollama create' command]",
          expectedStructure: ["Modelfile", "model weights (GGUF format)"],
          requiredFiles: ["Modelfile"],
        };
      default:
        throw new ModelCacheError(`Unknown provider: ${String(provider)}`);
    }
  }

  // ==========================================================================
  // Private: Transformers.js Methods
  // ==========================================================================

  /**
   * Get Transformers.js cache status
   */
  private getTransformersCacheStatus(): CacheStatus {
    const cacheDir = this.getCacheDir("transformersjs");

    if (!existsSync(cacheDir)) {
      return {
        provider: "transformersjs",
        cacheDir,
        exists: false,
        totalSizeBytes: 0,
        modelCount: 0,
        models: [],
      };
    }

    const models: CachedModelInfo[] = [];
    let totalSizeBytes = 0;

    try {
      // Scan cache directory for model folders
      // Structure: cacheDir/models--{org}--{model}/
      const entries = readdirSync(cacheDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("models--")) {
          const modelPath = path.join(cacheDir, entry.name);
          const modelInfo = this.parseTransformersModelDir(modelPath, entry.name);
          if (modelInfo) {
            models.push(modelInfo);
            totalSizeBytes += modelInfo.sizeBytes;
          }
        }
      }
    } catch (error) {
      throw new CacheAccessError(
        cacheDir,
        "read",
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined
      );
    }

    return {
      provider: "transformersjs",
      cacheDir,
      exists: true,
      totalSizeBytes,
      modelCount: models.length,
      models,
    };
  }

  /**
   * Parse a Transformers.js model directory
   */
  private parseTransformersModelDir(modelPath: string, dirName: string): CachedModelInfo | null {
    try {
      // Parse model ID from directory name (models--{org}--{model})
      const parts = dirName.replace("models--", "").split("--");
      if (parts.length < 2) return null;
      const modelId = parts.join("/");

      // Calculate total size
      const sizeBytes = this.getDirectorySize(modelPath);

      // Get directory stats for timestamps
      const stats = statSync(modelPath);

      // Check if model has required files
      const onnxDir = path.join(modelPath, "onnx");
      const hasOnnx =
        existsSync(path.join(onnxDir, "model.onnx")) ||
        existsSync(path.join(onnxDir, "model_quantized.onnx"));

      return {
        provider: "transformersjs",
        modelId,
        path: modelPath,
        sizeBytes,
        downloadedAt: stats.birthtime,
        lastAccessedAt: stats.atime,
        isValid: hasOnnx,
        metadata: {
          quantized: existsSync(path.join(onnxDir, "model_quantized.onnx")),
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Validate a Transformers.js model
   */
  private validateTransformersModel(modelId: string): ModelValidationResult {
    const checks: ValidationCheck[] = [];
    const issues: string[] = [];

    const cacheDir = this.getCacheDir("transformersjs");
    const modelDirName = `models--${modelId.replace("/", "--")}`;
    const modelPath = path.join(cacheDir, modelDirName);

    // Check 1: Model directory exists
    const dirExists = existsSync(modelPath);
    checks.push({
      name: "directory_exists",
      passed: dirExists,
      description: "Model directory exists in cache",
      error: dirExists ? undefined : "Model directory not found",
    });
    if (!dirExists) {
      issues.push("Model directory not found");
      return {
        valid: false,
        modelId,
        provider: "transformersjs",
        issues,
        validatedAt: new Date(),
        checks,
      };
    }

    // Check 2: ONNX directory exists
    const onnxDir = path.join(modelPath, "onnx");
    const onnxExists = existsSync(onnxDir);
    checks.push({
      name: "onnx_directory",
      passed: onnxExists,
      description: "ONNX model directory exists",
      error: onnxExists ? undefined : "ONNX directory not found",
    });
    if (!onnxExists) {
      issues.push("ONNX directory not found");
    }

    // Check 3: Model file exists
    const modelFile = path.join(onnxDir, "model.onnx");
    const quantizedFile = path.join(onnxDir, "model_quantized.onnx");
    const hasModelFile = existsSync(modelFile) || existsSync(quantizedFile);
    checks.push({
      name: "model_file",
      passed: hasModelFile,
      description: "ONNX model file exists",
      error: hasModelFile ? undefined : "No model.onnx or model_quantized.onnx found",
    });
    if (!hasModelFile) {
      issues.push("Model file not found");
    }

    // Check 4: Config file exists
    const configFile = path.join(modelPath, "config.json");
    const hasConfig = existsSync(configFile);
    checks.push({
      name: "config_file",
      passed: hasConfig,
      description: "Model config.json exists",
      error: hasConfig ? undefined : "config.json not found",
    });
    if (!hasConfig) {
      issues.push("config.json not found");
    }

    return {
      valid: issues.length === 0,
      modelId,
      provider: "transformersjs",
      issues: issues.length > 0 ? issues : undefined,
      validatedAt: new Date(),
      checks,
    };
  }

  /**
   * Download a Transformers.js model
   */
  private async downloadTransformersModel(
    modelId: string,
    options: ModelDownloadOptions,
    startTime: number
  ): Promise<ModelDownloadResult> {
    const { TransformersJsEmbeddingProvider } =
      await import("../providers/transformersjs-embedding.js");

    const onProgress = options.onProgress;

    // Create a provider instance to trigger download
    const provider = new TransformersJsEmbeddingProvider({
      provider: "transformersjs",
      model: modelId,
      dimensions: 384, // Placeholder - actual dimensions determined by model
      batchSize: 1,
      maxRetries: 0,
      timeoutMs: options.timeout || this.config.defaultTimeoutMs,
      modelPath: modelId,
      cacheDir: options.cacheDir || this.config.transformersCacheDir || undefined,
      quantized: options.quantized,
      onProgress: onProgress
        ? (progress: ModelDownloadProgress) => {
            onProgress(progress);
          }
        : undefined,
    });

    // Trigger download via healthCheck
    const success = await provider.healthCheck();

    if (!success) {
      throw new ModelDownloadError(
        "transformersjs",
        modelId,
        "Model initialization failed after download"
      );
    }

    // Get model info
    const models = await this.listCachedModels("transformersjs");
    const model = models.find((m) => m.modelId === modelId);

    // Validate if requested
    if (options.validateAfterDownload ?? this.config.validateByDefault) {
      const validation = this.validateTransformersModel(modelId);
      if (!validation.valid) {
        throw new ModelValidationError(
          "transformersjs",
          modelId,
          validation.issues || ["Validation failed"]
        );
      }
    }

    return {
      success: true,
      model,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Clear a Transformers.js model
   */
  private async clearTransformersModel(modelId: string): Promise<CacheClearResult> {
    const cacheDir = this.getCacheDir("transformersjs");
    const modelDirName = `models--${modelId.replace("/", "--")}`;
    const modelPath = path.join(cacheDir, modelDirName);

    if (!existsSync(modelPath)) {
      throw new ModelNotFoundError("transformersjs", modelId);
    }

    // Get size before deletion
    const sizeBytes = this.getDirectorySize(modelPath);

    try {
      await fs.rm(modelPath, { recursive: true, force: true });
      return {
        success: true,
        modelsCleared: 1,
        bytesFreed: sizeBytes,
        clearedModels: [modelId],
        dryRun: false,
      };
    } catch (error) {
      throw new CacheClearError(
        error instanceof Error ? error.message : String(error),
        "transformersjs",
        modelId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Import a Transformers.js model from local files
   */
  private async importTransformersModel(
    sourcePath: string,
    modelId: string,
    validate?: boolean,
    overwrite?: boolean
  ): Promise<ModelImportResult> {
    const cacheDir = this.getCacheDir("transformersjs");
    const modelDirName = `models--${modelId.replace("/", "--")}`;
    const targetPath = path.join(cacheDir, modelDirName);

    // Check if target exists
    if (existsSync(targetPath) && !overwrite) {
      throw new ModelImportError(
        "transformersjs",
        modelId,
        sourcePath,
        "Model already exists in cache. Use overwrite option to replace."
      );
    }

    // Ensure cache directory exists
    if (!existsSync(cacheDir)) {
      await fs.mkdir(cacheDir, { recursive: true });
    }

    // Copy model files
    let filesCopied = 0;
    let bytesCopied = 0;

    try {
      await this.copyDirectory(sourcePath, targetPath);
      const stats = this.getDirectoryStats(targetPath);
      filesCopied = stats.fileCount;
      bytesCopied = stats.totalSize;
    } catch (error) {
      throw new ModelImportError(
        "transformersjs",
        modelId,
        sourcePath,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined
      );
    }

    // Validate if requested
    if (validate) {
      const validation = this.validateTransformersModel(modelId);
      if (!validation.valid) {
        // Clean up on validation failure
        await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
        throw new ModelValidationError("transformersjs", modelId, validation.issues || []);
      }
    }

    // Get model info
    const models = await this.listCachedModels("transformersjs");
    const model = models.find((m) => m.modelId === modelId);

    return {
      success: true,
      model,
      filesCopied,
      bytesCopied,
    };
  }

  /**
   * Get path info for Transformers.js model placement
   */
  private getTransformersModelPath(modelId: string): ModelPathInfo {
    const cacheDir = this.getCacheDir("transformersjs");
    const modelDirName = `models--${modelId.replace("/", "--")}`;
    const modelPath = path.join(cacheDir, modelDirName);

    return {
      provider: "transformersjs",
      modelId,
      cacheDir,
      modelPath,
      expectedStructure: [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "onnx/model.onnx (or model_quantized.onnx)",
      ],
      requiredFiles: ["config.json", "onnx/model.onnx OR onnx/model_quantized.onnx"],
    };
  }

  // ==========================================================================
  // Private: Ollama Methods
  // ==========================================================================

  /**
   * Get Ollama cache status by querying the server
   */
  private async getOllamaCacheStatus(): Promise<CacheStatus> {
    const baseUrl = this.config.ollamaBaseUrl;

    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(OLLAMA_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new ProviderNotAvailableError(
          "ollama",
          `Server returned ${response.status}`,
          baseUrl
        );
      }

      const data = (await response.json()) as {
        models: Array<{
          name: string;
          model: string;
          modified_at: string;
          size: number;
          digest: string;
        }>;
      };

      const models: CachedModelInfo[] = data.models.map((m) => ({
        provider: "ollama" as const,
        modelId: m.name,
        path: `[managed by Ollama: ${m.digest.substring(0, 12)}]`,
        sizeBytes: m.size,
        downloadedAt: new Date(m.modified_at),
        isValid: true, // If Ollama reports it, we trust it
        metadata: {
          checksum: m.digest,
        },
      }));

      const totalSizeBytes = models.reduce((sum, m) => sum + m.sizeBytes, 0);

      return {
        provider: "ollama",
        cacheDir: `[managed by Ollama at ${baseUrl}]`,
        exists: true,
        totalSizeBytes,
        modelCount: models.length,
        models,
      };
    } catch (error) {
      if (error instanceof ProviderNotAvailableError) {
        throw error;
      }
      throw new ProviderNotAvailableError(
        "ollama",
        error instanceof Error ? error.message : "Failed to connect to Ollama server",
        baseUrl,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Validate an Ollama model
   */
  private async validateOllamaModel(modelId: string): Promise<ModelValidationResult> {
    const checks: ValidationCheck[] = [];
    const issues: string[] = [];
    const baseUrl = this.config.ollamaBaseUrl;

    // Check 1: Server is available
    let serverAvailable = false;
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(OLLAMA_API_TIMEOUT_MS),
      });
      serverAvailable = response.ok;
    } catch {
      serverAvailable = false;
    }

    checks.push({
      name: "server_available",
      passed: serverAvailable,
      description: "Ollama server is running and accessible",
      error: serverAvailable ? undefined : `Cannot connect to Ollama at ${baseUrl}`,
    });

    if (!serverAvailable) {
      issues.push(`Ollama server not available at ${baseUrl}`);
      return {
        valid: false,
        modelId,
        provider: "ollama",
        issues,
        validatedAt: new Date(),
        checks,
      };
    }

    // Check 2: Model exists
    const status = await this.getOllamaCacheStatus();
    const modelExists = status.models.some(
      (m) => m.modelId === modelId || m.modelId.startsWith(`${modelId}:`)
    );

    checks.push({
      name: "model_exists",
      passed: modelExists,
      description: "Model is available in Ollama",
      error: modelExists ? undefined : `Model "${modelId}" not found in Ollama`,
    });

    if (!modelExists) {
      issues.push(`Model "${modelId}" not found`);
    }

    return {
      valid: issues.length === 0,
      modelId,
      provider: "ollama",
      issues: issues.length > 0 ? issues : undefined,
      validatedAt: new Date(),
      checks,
    };
  }

  /**
   * Download (pull) an Ollama model
   */
  private async downloadOllamaModel(
    modelId: string,
    options: ModelDownloadOptions,
    startTime: number
  ): Promise<ModelDownloadResult> {
    const baseUrl = this.config.ollamaBaseUrl;
    const onProgress = options.onProgress;

    try {
      const response = await fetch(`${baseUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelId }),
        signal: AbortSignal.timeout(options.timeout || this.config.defaultTimeoutMs),
      });

      if (!response.ok) {
        throw new ModelDownloadError(
          "ollama",
          modelId,
          `Server returned ${response.status}`,
          response.status >= 500,
          response.status
        );
      }

      // Process streaming response for progress
      if (response.body && onProgress) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;

        while (!done) {
          const result = await reader.read();
          done = result.done;
          if (done) break;

          const text = decoder.decode(result.value as Uint8Array);
          const lines = text.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            try {
              const data = JSON.parse(line) as {
                status?: string;
                completed?: number;
                total?: number;
              };
              if (data.status) {
                const progress =
                  data.completed !== undefined && data.total !== undefined
                    ? Math.round((data.completed / data.total) * 100)
                    : undefined;
                onProgress({
                  status: "progress",
                  file: modelId,
                  progress,
                  total: data.total,
                  loaded: data.completed,
                });
              }
            } catch {
              // Ignore parse errors for streaming responses
            }
          }
        }
      } else if (response.body) {
        // Consume the response body even without progress callback
        const reader = response.body.getReader();
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
        }
      }

      // Get model info
      const status = await this.getOllamaCacheStatus();
      const model = status.models.find(
        (m) => m.modelId === modelId || m.modelId.startsWith(`${modelId}:`)
      );

      // Validate if requested
      if (options.validateAfterDownload ?? this.config.validateByDefault) {
        const validation = await this.validateOllamaModel(modelId);
        if (!validation.valid) {
          throw new ModelValidationError("ollama", modelId, validation.issues || []);
        }
      }

      return {
        success: true,
        model,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof ModelCacheError) {
        throw error;
      }
      throw new ModelDownloadError(
        "ollama",
        modelId,
        error instanceof Error ? error.message : String(error),
        true,
        undefined,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Clear an Ollama model
   */
  private async clearOllamaModel(modelId: string): Promise<CacheClearResult> {
    const baseUrl = this.config.ollamaBaseUrl;

    // Get size before deletion
    let sizeBytes = 0;
    try {
      const status = await this.getOllamaCacheStatus();
      const model = status.models.find(
        (m) => m.modelId === modelId || m.modelId.startsWith(`${modelId}:`)
      );
      if (!model) {
        throw new ModelNotFoundError("ollama", modelId);
      }
      sizeBytes = model.sizeBytes;
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        throw error;
      }
      throw new ProviderNotAvailableError(
        "ollama",
        error instanceof Error ? error.message : String(error),
        baseUrl,
        error instanceof Error ? error : undefined
      );
    }

    try {
      const response = await fetch(`${baseUrl}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelId }),
        signal: AbortSignal.timeout(OLLAMA_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new CacheClearError(`Server returned ${response.status}`, "ollama", modelId);
      }

      return {
        success: true,
        modelsCleared: 1,
        bytesFreed: sizeBytes,
        clearedModels: [modelId],
        dryRun: false,
      };
    } catch (error) {
      if (error instanceof CacheClearError) {
        throw error;
      }
      throw new CacheClearError(
        error instanceof Error ? error.message : String(error),
        "ollama",
        modelId,
        error instanceof Error ? error : undefined
      );
    }
  }

  // ==========================================================================
  // Private: Utility Methods
  // ==========================================================================

  /**
   * Get the total size of a directory recursively
   */
  private getDirectorySize(dirPath: string): number {
    let totalSize = 0;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += this.getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          totalSize += statSync(fullPath).size;
        }
      }
    } catch {
      // Ignore errors, return 0 for inaccessible directories
    }

    return totalSize;
  }

  /**
   * Get directory statistics (file count and total size)
   */
  private getDirectoryStats(dirPath: string): { fileCount: number; totalSize: number } {
    let fileCount = 0;
    let totalSize = 0;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const subStats = this.getDirectoryStats(fullPath);
          fileCount += subStats.fileCount;
          totalSize += subStats.totalSize;
        } else if (entry.isFile()) {
          fileCount++;
          totalSize += statSync(fullPath).size;
        }
      }
    } catch {
      // Ignore errors
    }

    return { fileCount, totalSize };
  }

  /**
   * Copy a directory recursively
   */
  private async copyDirectory(source: string, target: string): Promise<void> {
    // Create target directory
    await fs.mkdir(target, { recursive: true });

    const entries = readdirSync(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath);
      } else if (entry.isFile()) {
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  }
}

// Export default instance factory
export function createModelCacheService(
  config?: Partial<ModelCacheServiceConfig>
): ModelCacheService {
  return new ModelCacheService(config);
}
