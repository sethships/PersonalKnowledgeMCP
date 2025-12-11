/**
 * OpenAI embedding provider implementation
 *
 * Provides embedding generation using OpenAI's text-embedding-3-small model.
 * Handles batching, rate limiting, retries, and error sanitization.
 */

import OpenAI from "openai";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";
import {
  EmbeddingError,
  EmbeddingAuthenticationError,
  EmbeddingRateLimitError,
  EmbeddingNetworkError,
  EmbeddingTimeoutError,
  EmbeddingValidationError,
} from "./errors.js";
import { withRetry } from "../utils/retry.js";

/**
 * Configuration specific to OpenAI embedding provider
 */
export interface OpenAIProviderConfig extends EmbeddingProviderConfig {
  /** OpenAI API key (from OPENAI_API_KEY environment variable) */
  apiKey: string;

  /** Optional organization ID for API requests */
  organization?: string;

  /** Optional base URL for API requests (for proxies or Azure OpenAI) */
  baseURL?: string;
}

/**
 * OpenAI embedding provider implementation
 *
 * Implements the EmbeddingProvider interface using OpenAI's Embeddings API.
 * Features:
 * - Automatic batching for large arrays (respects 100-item API limit)
 * - Exponential backoff retry for rate limits
 * - API key sanitization in all errors
 * - Health check with minimal token usage
 *
 * @example
 * ```typescript
 * const provider = new OpenAIEmbeddingProvider({
 *   provider: "openai",
 *   model: "text-embedding-3-small",
 *   dimensions: 1536,
 *   batchSize: 100,
 *   maxRetries: 3,
 *   timeoutMs: 30000,
 *   apiKey: process.env.OPENAI_API_KEY!,
 * });
 *
 * const embedding = await provider.generateEmbedding("Hello world");
 * console.log(embedding.length); // 1536
 * ```
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "openai";
  readonly modelId: string;
  readonly dimensions: number;

  private readonly client: OpenAI;
  private readonly config: OpenAIProviderConfig;

  /**
   * Create a new OpenAI embedding provider
   *
   * @param config - Provider configuration including API key
   * @throws {EmbeddingValidationError} If configuration is invalid
   */
  constructor(config: OpenAIProviderConfig) {
    this.validateConfig(config);
    this.config = config;
    this.modelId = config.model;
    this.dimensions = config.dimensions;

    // Initialize OpenAI client with manual retry handling (maxRetries: 0)
    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organization,
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      maxRetries: 0, // We handle retries manually for better control
    });
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
    return embeddings[0]!;
  }

  /**
   * Generate embeddings for multiple texts in batch
   *
   * Automatically splits large arrays into batches of `batchSize` items.
   * Results are returned in the same order as input texts.
   *
   * @param texts - Array of input texts to embed
   * @returns Array of embedding vectors
   * @throws {EmbeddingValidationError} If inputs are invalid
   * @throws {EmbeddingError} For other failures
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    this.validateInputs(texts);

    // Split into batches based on provider batch size limit
    const batches = this.createBatches(texts);
    const allEmbeddings: number[][] = [];

    // Process batches sequentially to maintain order and avoid overwhelming API
    for (const batch of batches) {
      const embeddings = await withRetry(() => this.processBatch(batch), {
        maxRetries: this.config.maxRetries,
        shouldRetry: (error) => error instanceof EmbeddingError && error.retryable,
        calculateBackoff: (attempt, error) =>
          this.calculateBackoff(attempt, error as EmbeddingError),
      });
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  /**
   * Verify provider connectivity and configuration
   *
   * Generates a minimal embedding to verify the API is reachable and properly configured.
   * This method never throws - it returns false on any failure.
   *
   * @returns Promise resolving to true if healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Generate minimal embedding to verify connectivity
      await this.generateEmbedding("test");
      return true;
    } catch (error) {
      // Health check never throws - just returns false
      return false;
    }
  }

  /**
   * Validate provider configuration
   *
   * @param config - Configuration to validate
   * @throws {EmbeddingValidationError} If configuration is invalid
   */
  private validateConfig(config: OpenAIProviderConfig): void {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new EmbeddingValidationError("API key is required", "apiKey");
    }

    if (!config.apiKey.startsWith("sk-")) {
      throw new EmbeddingValidationError(
        "Invalid OpenAI API key format (must start with 'sk-')",
        "apiKey"
      );
    }

    if (config.dimensions <= 0) {
      throw new EmbeddingValidationError("Dimensions must be positive", "dimensions");
    }

    if (config.batchSize <= 0 || config.batchSize > 100) {
      throw new EmbeddingValidationError("Batch size must be between 1 and 100", "batchSize");
    }

    if (config.maxRetries < 0) {
      throw new EmbeddingValidationError("Max retries must be non-negative", "maxRetries");
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
   * Split texts into batches respecting provider batch size limit
   *
   * @param texts - Texts to batch
   * @returns Array of batches
   */
  private createBatches(texts: string[]): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      batches.push(texts.slice(i, i + this.config.batchSize));
    }
    return batches;
  }

  /**
   * Process a single batch (no retry logic)
   *
   * @param batch - Batch of texts to process
   * @returns Array of embeddings
   * @throws {EmbeddingError} On any failure
   */
  private async processBatch(batch: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.modelId,
        input: batch,
        dimensions: this.dimensions,
      });

      // Extract embeddings and ensure they're in order
      // OpenAI returns them with an index field for verification
      const embeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);

      // Verify we got the expected number of embeddings
      if (embeddings.length !== batch.length) {
        throw new EmbeddingError(
          `Expected ${batch.length} embeddings, got ${embeddings.length}`,
          "RESPONSE_MISMATCH"
        );
      }

      return embeddings;
    } catch (error) {
      throw this.handleOpenAIError(error);
    }
  }

  /**
   * Convert OpenAI SDK errors to our custom error types
   *
   * @param error - Error from OpenAI SDK
   * @returns Appropriate EmbeddingError subclass
   */
  private handleOpenAIError(error: unknown): EmbeddingError {
    // Already converted
    if (error instanceof EmbeddingError) {
      return error;
    }

    // OpenAI SDK errors have a status property
    if (error && typeof error === "object" && "status" in error) {
      const status = (error as { status: number }).status;
      const message = (error as { message?: string }).message || "Unknown error";
      const cause = error as unknown as Error;

      switch (status) {
        case 401:
        case 403:
          return new EmbeddingAuthenticationError(
            "Invalid API key or insufficient permissions",
            cause
          );

        case 429: {
          // Rate limit - check for retry-after header
          const retryAfter = this.extractRetryAfter(error);
          return new EmbeddingRateLimitError("Rate limit exceeded", retryAfter, cause);
        }

        case 408:
        case 504:
          return new EmbeddingTimeoutError("Request timeout", cause);

        default:
          // 500+ are server errors (retryable)
          if (status >= 500) {
            return new EmbeddingNetworkError(`Server error: ${message}`, cause);
          }

          // 400-499 (excluding handled above) are client errors (not retryable)
          return new EmbeddingValidationError(`Client error: ${message}`, undefined, cause);
      }
    }

    // Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();

      if (
        errorMessage.includes("econnrefused") ||
        errorMessage.includes("enotfound") ||
        errorMessage.includes("econnreset")
      ) {
        return new EmbeddingNetworkError("Connection failed", error);
      }

      if (errorMessage.includes("timeout") || errorMessage.includes("etimedout")) {
        return new EmbeddingTimeoutError("Request timeout", error);
      }
    }

    // Generic fallback
    const fallbackError = error instanceof Error ? error : new Error(String(error));
    return new EmbeddingError(
      fallbackError.message || "Unknown error",
      "UNKNOWN_ERROR",
      false,
      fallbackError
    );
  }

  /**
   * Extract retry-after delay from error (if available)
   *
   * @param error - Error that may contain retry-after information
   * @returns Delay in milliseconds, or undefined
   */
  private extractRetryAfter(error: unknown): number | undefined {
    // Check for retry-after in error response headers
    if (error && typeof error === "object" && "response" in error) {
      const response = (error as { response?: { headers?: { "retry-after"?: string } } }).response;
      const retryAfterHeader = response?.headers?.["retry-after"];

      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(seconds)) {
          return seconds * 1000; // Convert to milliseconds
        }
      }
    }

    return undefined;
  }

  /**
   * Calculate backoff delay for retry attempt
   *
   * Implements exponential backoff strategy with base 2:
   * - Attempt 0 (first retry): 2^0 * 1000ms = 1 second
   * - Attempt 1 (second retry): 2^1 * 1000ms = 2 seconds
   * - Attempt 2 (third retry): 2^2 * 1000ms = 4 seconds
   * - Attempt 3 (fourth retry): 2^3 * 1000ms = 8 seconds
   *
   * This exponential backoff strategy provides:
   * - Quick recovery for transient failures (1s first retry)
   * - Reduced load on failing services (increasing delays)
   * - Time for rate limits or service issues to resolve
   *
   * Rate limit errors with retry-after headers take precedence over
   * the exponential backoff calculation.
   *
   * @param attempt - Retry attempt number (0-based: 0 = first retry)
   * @param error - Error that triggered retry (may contain retry-after hint)
   * @returns Delay in milliseconds before next retry attempt
   */
  private calculateBackoff(attempt: number, error: EmbeddingError): number {
    // Use retry-after if provided in rate limit error
    if (error instanceof EmbeddingRateLimitError && error.retryAfterMs) {
      return error.retryAfterMs;
    }

    // Exponential backoff: 2^attempt * 1000ms
    // attempt 0: 1s, attempt 1: 2s, attempt 2: 4s
    return Math.pow(2, attempt) * 1000;
  }
}
