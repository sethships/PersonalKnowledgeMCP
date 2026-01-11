/**
 * Type definitions for embedding provider interfaces
 *
 * This module defines the core interfaces for interacting with embedding providers.
 * The abstraction allows swapping between OpenAI, HuggingFace, Ollama, or other providers.
 */

/**
 * Capabilities and limitations of an embedding provider
 *
 * Describes the operational characteristics and constraints of an embedding provider.
 * This information helps callers make informed decisions about batching strategies,
 * deployment options, and provider selection based on requirements.
 *
 * @example
 * ```typescript
 * const caps = provider.getCapabilities();
 * if (caps.requiresNetwork && !isOnline) {
 *   throw new Error("Network required for this provider");
 * }
 * const batchSize = Math.min(texts.length, caps.maxBatchSize);
 * ```
 */
export interface ProviderCapabilities {
  /**
   * Maximum number of texts that can be embedded in a single API call
   *
   * For API-based providers, this is typically limited by the service.
   * For local providers, this may be limited by memory or compute resources.
   *
   * @example 100 (OpenAI), 32 (typical local model)
   */
  maxBatchSize: number;

  /**
   * Maximum tokens per input text
   *
   * Texts exceeding this limit may be truncated or rejected depending
   * on the provider's behavior. This is an approximate limit.
   *
   * @example 8191 (OpenAI text-embedding-3-*), 512 (typical local model)
   */
  maxTokensPerText: number;

  /**
   * Whether this provider supports GPU acceleration
   *
   * True for local providers that can utilize GPU hardware.
   * False for API-based providers (GPU is handled server-side).
   *
   * @example false (OpenAI), true (Transformers.js with WebGPU)
   */
  supportsGPU: boolean;

  /**
   * Whether this provider requires network connectivity
   *
   * True for API-based providers that call external services.
   * False for local providers that run entirely on the local machine.
   *
   * @example true (OpenAI), false (Transformers.js)
   */
  requiresNetwork: boolean;

  /**
   * Estimated latency in milliseconds for single-text embedding
   *
   * This is an approximate value for typical conditions. Actual latency
   * may vary based on network conditions, text length, and system load.
   *
   * @example 200 (OpenAI API), 50 (local GPU), 500 (local CPU)
   */
  estimatedLatencyMs: number;
}

/**
 * Configuration for embedding provider instances
 *
 * This configuration is used to initialize an embedding provider with the
 * necessary parameters for API connectivity, model selection, and behavior tuning.
 */
export interface EmbeddingProviderConfig {
  /** Provider identifier (e.g., "openai", "azure-openai", "ollama") */
  provider: string;

  /** Model identifier (e.g., "text-embedding-3-small", "text-embedding-3-large") */
  model: string;

  /** Expected embedding vector dimensions */
  dimensions: number;

  /** Maximum number of texts per batch request (provider-specific limits apply) */
  batchSize: number;

  /** Maximum retry attempts for retryable errors */
  maxRetries: number;

  /** Request timeout in milliseconds */
  timeoutMs: number;

  /** Provider-specific options (e.g., temperature, truncation strategy) */
  options?: Record<string, unknown>;
}

/**
 * Core interface for embedding providers
 *
 * This interface abstracts the details of specific embedding providers,
 * allowing the application to swap between OpenAI, local models, or other services
 * without changing calling code.
 *
 * Implementations must:
 * - Handle API authentication
 * - Manage rate limiting and retries
 * - Batch requests when beneficial
 * - Sanitize errors to prevent credential leakage
 *
 * @example
 * ```typescript
 * const provider: EmbeddingProvider = createEmbeddingProvider(config);
 *
 * // Generate single embedding
 * const embedding = await provider.generateEmbedding("Hello world");
 * console.log(embedding.length); // 1536 for text-embedding-3-small
 *
 * // Generate batch embeddings
 * const texts = ["Hello", "World", "Test"];
 * const embeddings = await provider.generateEmbeddings(texts);
 * console.log(embeddings.length); // 3
 * ```
 */
export interface EmbeddingProvider {
  /**
   * Unique provider identifier
   *
   * Examples: "openai", "azure-openai", "ollama", "huggingface"
   */
  readonly providerId: string;

  /**
   * Model identifier being used
   *
   * Examples: "text-embedding-3-small", "text-embedding-3-large", "all-MiniLM-L6-v2"
   */
  readonly modelId: string;

  /**
   * Embedding vector dimensions
   *
   * This determines the size of the returned embedding arrays.
   * Common values: 384, 768, 1536, 3072
   */
  readonly dimensions: number;

  /**
   * Generate embedding vector for a single text
   *
   * This is a convenience method that calls generateEmbeddings() with a single-element array.
   *
   * @param text - Input text to embed (must be non-empty string)
   * @returns Embedding vector of length `dimensions`
   * @throws {EmbeddingValidationError} If text is empty or invalid
   * @throws {EmbeddingAuthenticationError} If API credentials are invalid
   * @throws {EmbeddingRateLimitError} If rate limit is exceeded (retryable)
   * @throws {EmbeddingNetworkError} If network connectivity fails (retryable)
   * @throws {EmbeddingTimeoutError} If request times out (retryable)
   * @throws {EmbeddingError} For other failures
   *
   * @example
   * ```typescript
   * const embedding = await provider.generateEmbedding("Hello world");
   * console.log(embedding); // [0.123, -0.456, 0.789, ...]
   * ```
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generate embedding vectors for multiple texts in batch
   *
   * This method handles batching internally based on the provider's batch size limits.
   * Results are returned in the same order as the input texts.
   *
   * Implementers should:
   * - Split large arrays into provider-specific batch sizes
   * - Process batches sequentially to avoid overwhelming the API
   * - Preserve input order in results
   * - Handle partial failures appropriately
   *
   * @param texts - Array of input texts to embed (must be non-empty, all non-empty strings)
   * @returns Array of embedding vectors, one per input text
   * @throws {EmbeddingValidationError} If any text is empty or invalid
   * @throws {EmbeddingAuthenticationError} If API credentials are invalid
   * @throws {EmbeddingRateLimitError} If rate limit is exceeded (retryable)
   * @throws {EmbeddingNetworkError} If network connectivity fails (retryable)
   * @throws {EmbeddingTimeoutError} If request times out (retryable)
   * @throws {EmbeddingError} For other failures
   *
   * @example
   * ```typescript
   * const texts = ["Hello", "World", "Test"];
   * const embeddings = await provider.generateEmbeddings(texts);
   * console.log(embeddings.length); // 3
   * console.log(embeddings[0].length); // 1536
   * ```
   */
  generateEmbeddings(texts: string[]): Promise<number[][]>;

  /**
   * Verify provider connectivity and configuration
   *
   * This method performs a minimal health check to verify that the provider
   * is reachable and properly configured. It typically generates a single
   * embedding with minimal token usage.
   *
   * This method MUST NOT throw errors - it returns false on any failure.
   * This makes it safe to use in monitoring and initialization checks.
   *
   * @returns Promise resolving to true if provider is operational, false otherwise
   *
   * @example
   * ```typescript
   * const isHealthy = await provider.healthCheck();
   * if (!isHealthy) {
   *   console.error("Provider is not available");
   * }
   * ```
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get provider capabilities and limitations
   *
   * Returns information about batch limits, network requirements, GPU support,
   * and performance characteristics. This helps callers make informed decisions
   * about provider selection, batching strategies, and deployment options.
   *
   * @returns Provider capabilities object describing operational characteristics
   *
   * @example
   * ```typescript
   * const caps = provider.getCapabilities();
   * console.log(`Max batch size: ${caps.maxBatchSize}`);
   * console.log(`Requires network: ${caps.requiresNetwork}`);
   * ```
   */
  getCapabilities(): ProviderCapabilities;
}
