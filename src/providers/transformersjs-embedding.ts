/**
 * Transformers.js embedding provider implementation
 *
 * Provides embedding generation using local HuggingFace models via Transformers.js.
 * Enables offline, cost-free, privacy-preserving semantic search without external API calls.
 *
 * @see ADR-0003: Local Embeddings Architecture
 */

import type { EmbeddingProvider, EmbeddingProviderConfig, ProviderCapabilities } from "./types.js";
import { EmbeddingError, EmbeddingValidationError, EmbeddingNetworkError } from "./errors.js";

/**
 * Progress information during model download
 */
export interface ModelDownloadProgress {
  /** Current status of the download */
  status: "initiate" | "download" | "progress" | "done";

  /** Name of the file being downloaded (if applicable) */
  file?: string;

  /** Download progress as a percentage (0-100) */
  progress?: number;

  /** Total bytes to download */
  total?: number;

  /** Bytes downloaded so far */
  loaded?: number;
}

/**
 * Configuration specific to Transformers.js embedding provider
 */
export interface TransformersJsProviderConfig extends EmbeddingProviderConfig {
  /**
   * Model identifier from HuggingFace
   *
   * @example "Xenova/all-MiniLM-L6-v2"
   * @example "Xenova/bge-small-en-v1.5"
   */
  modelPath: string;

  /**
   * Optional: Directory for model cache
   *
   * Defaults to ~/.cache/huggingface/transformers if not specified.
   */
  cacheDir?: string;

  /**
   * Optional: Use quantized model variant for smaller size and faster inference
   *
   * @default false
   */
  quantized?: boolean;

  /**
   * Optional: Progress callback for model download
   *
   * Called during initial model download to report progress.
   */
  onProgress?: (progress: ModelDownloadProgress) => void;
}

/**
 * Type for the Transformers.js pipeline function result
 * Using a minimal interface to avoid importing the full library types
 */
interface FeatureExtractionPipeline {
  (
    text: string | string[],
    options?: { pooling?: string; normalize?: boolean }
  ): Promise<{ data: Float32Array; dims: number[] }>;
}

/**
 * Transformers.js embedding provider implementation
 *
 * Implements the EmbeddingProvider interface using local HuggingFace models
 * via Transformers.js (ONNX Runtime).
 *
 * Features:
 * - Lazy model loading (only loads on first use)
 * - Automatic model download and caching
 * - Progress reporting during model download
 * - Offline operation after initial download
 * - Sequential batch processing to manage memory
 *
 * @example
 * ```typescript
 * const provider = new TransformersJsEmbeddingProvider({
 *   provider: "transformersjs",
 *   model: "Xenova/all-MiniLM-L6-v2",
 *   dimensions: 384,
 *   batchSize: 32,
 *   maxRetries: 0,
 *   timeoutMs: 60000,
 *   modelPath: "Xenova/all-MiniLM-L6-v2",
 * });
 *
 * const embedding = await provider.generateEmbedding("Hello world");
 * console.log(embedding.length); // 384
 * ```
 */
export class TransformersJsEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "transformersjs";
  readonly modelId: string;
  readonly dimensions: number;

  private pipeline: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly config: TransformersJsProviderConfig;

  /**
   * Create a new Transformers.js embedding provider
   *
   * @param config - Provider configuration
   * @throws {EmbeddingValidationError} If configuration is invalid
   */
  constructor(config: TransformersJsProviderConfig) {
    this.validateConfig(config);
    this.config = config;
    this.modelId = config.modelPath;
    this.dimensions = config.dimensions;
  }

  /**
   * Generate embedding for a single text
   *
   * @param text - Input text to embed
   * @returns Embedding vector of length `dimensions`
   * @throws {EmbeddingValidationError} If text is empty or invalid
   * @throws {EmbeddingError} For other failures
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    // Safe assertion: generateEmbeddings always returns array with same length as input
    const embedding = embeddings[0];
    if (!embedding) {
      throw new EmbeddingError("Unexpected empty embedding result", "EMPTY_RESULT");
    }
    return embedding;
  }

  /**
   * Generate embeddings for multiple texts
   *
   * Processes texts sequentially to manage memory usage with local models.
   * Results are returned in the same order as input texts.
   *
   * @param texts - Array of input texts to embed
   * @returns Array of embedding vectors
   * @throws {EmbeddingValidationError} If inputs are invalid
   * @throws {EmbeddingError} For other failures
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    this.validateInputs(texts);

    // Ensure model is loaded
    await this.ensureInitialized();

    const embeddings: number[][] = [];

    // Process texts sequentially to avoid memory spikes with local models
    for (const text of texts) {
      try {
        // Pipeline is guaranteed to exist after ensureInitialized()
        if (!this.pipeline) {
          throw new EmbeddingError("Pipeline not initialized", "INITIALIZATION_ERROR");
        }
        const output = await this.pipeline(text, {
          pooling: "mean",
          normalize: true,
        });

        // Convert Float32Array to regular number array
        embeddings.push(Array.from(output.data));
      } catch (error) {
        throw this.handlePipelineError(error);
      }
    }

    return embeddings;
  }

  /**
   * Verify provider connectivity and configuration
   *
   * Attempts to load the model (if not already loaded) to verify the provider
   * is operational. This method never throws - it returns false on any failure.
   *
   * @returns Promise resolving to true if healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      // Generate minimal embedding to verify the pipeline works
      await this.generateEmbedding("test");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get provider capabilities and limitations
   *
   * Returns information about local model constraints and characteristics.
   * Transformers.js is a local provider that works offline after model download.
   *
   * @returns Provider capabilities for Transformers.js embeddings
   */
  getCapabilities(): ProviderCapabilities {
    return {
      maxBatchSize: this.config.batchSize,
      maxTokensPerText: 512, // Typical local model limit
      supportsGPU: false, // Transformers.js in Node.js/Bun is CPU-only
      requiresNetwork: false, // Works offline after model download
      estimatedLatencyMs: 100, // Approximate for warm model on CPU
    };
  }

  /**
   * Validate provider configuration
   *
   * @param config - Configuration to validate
   * @throws {EmbeddingValidationError} If configuration is invalid
   */
  private validateConfig(config: TransformersJsProviderConfig): void {
    if (!config.modelPath || config.modelPath.trim().length === 0) {
      throw new EmbeddingValidationError("Model path is required", "modelPath");
    }

    if (config.dimensions <= 0) {
      throw new EmbeddingValidationError("Dimensions must be positive", "dimensions");
    }

    if (config.batchSize <= 0) {
      throw new EmbeddingValidationError("Batch size must be positive", "batchSize");
    }

    if (config.timeoutMs <= 0) {
      throw new EmbeddingValidationError("Timeout must be positive", "timeoutMs");
    }
  }

  /**
   * Validate input texts
   *
   * @param texts - Texts to validate
   * @throws {EmbeddingValidationError} If inputs are invalid
   */
  private validateInputs(texts: string[]): void {
    if (texts.length === 0) {
      throw new EmbeddingValidationError("Input array cannot be empty");
    }

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];

      if (typeof text !== "string") {
        throw new EmbeddingValidationError(`Input at index ${i} must be a string`, `texts[${i}]`);
      }

      if (text.trim().length === 0) {
        throw new EmbeddingValidationError(
          `Input at index ${i} cannot be empty or whitespace only`,
          `texts[${i}]`
        );
      }
    }
  }

  /**
   * Ensure the model is initialized (lazy loading pattern)
   *
   * Uses a promise-based singleton pattern to prevent concurrent initialization.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    await this.initPromise;
  }

  /**
   * Initialize the Transformers.js pipeline
   *
   * Dynamically imports @xenova/transformers to avoid loading the library
   * until it's actually needed. Configures caching and handles model download.
   */
  private async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid loading if not used
      const transformers = await import("@xenova/transformers");
      const { pipeline, env } = transformers;

      // Configure cache directory if specified
      if (this.config.cacheDir) {
        env.cacheDir = this.config.cacheDir;
      }

      // Allow model downloading
      env.allowLocalModels = true;
      env.allowRemoteModels = true;

      // Create progress callback if provided
      const onProgressCallback = this.config.onProgress;
      const progressCallback = onProgressCallback
        ? (progress: {
            status: string;
            file?: string;
            progress?: number;
            total?: number;
            loaded?: number;
          }) => {
            onProgressCallback({
              status: progress.status as ModelDownloadProgress["status"],
              file: progress.file,
              progress: progress.progress,
              total: progress.total,
              loaded: progress.loaded,
            });
          }
        : undefined;

      // Create the feature extraction pipeline
      this.pipeline = (await pipeline("feature-extraction", this.modelId, {
        quantized: this.config.quantized ?? false,
        progress_callback: progressCallback,
      })) as FeatureExtractionPipeline;
    } catch (error) {
      // Reset state so initialization can be retried
      this.initPromise = null;
      throw this.handleInitializationError(error);
    }
  }

  /**
   * Convert initialization errors to our custom error types
   *
   * @param error - Error from Transformers.js initialization
   * @returns Appropriate EmbeddingError subclass
   */
  private handleInitializationError(error: unknown): EmbeddingError {
    if (error instanceof EmbeddingError) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for network-related errors during model download
    if (
      errorMessage.includes("fetch") ||
      errorMessage.includes("network") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ENOTFOUND")
    ) {
      return new EmbeddingNetworkError(
        `Failed to download model: ${errorMessage}`,
        error instanceof Error ? error : undefined
      );
    }

    // Check for model not found errors
    if (errorMessage.includes("404") || errorMessage.includes("not found")) {
      return new EmbeddingValidationError(
        `Model not found: ${this.modelId}. Please verify the model path is correct.`,
        "modelPath",
        error instanceof Error ? error : undefined
      );
    }

    // Generic initialization error
    return new EmbeddingError(
      `Failed to initialize Transformers.js: ${errorMessage}`,
      "INITIALIZATION_ERROR",
      false,
      error instanceof Error ? error : undefined
    );
  }

  /**
   * Convert pipeline errors to our custom error types
   *
   * @param error - Error from pipeline execution
   * @returns Appropriate EmbeddingError subclass
   */
  private handlePipelineError(error: unknown): EmbeddingError {
    if (error instanceof EmbeddingError) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Generic pipeline error
    return new EmbeddingError(
      `Embedding generation failed: ${errorMessage}`,
      "PIPELINE_ERROR",
      false,
      error instanceof Error ? error : undefined
    );
  }
}
