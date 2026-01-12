/**
 * Ollama embedding provider implementation
 *
 * Provides embedding generation using local Ollama server via REST API.
 * Enables GPU-accelerated, offline, privacy-preserving semantic search.
 *
 * @see ADR-0003: Local Embeddings Architecture
 */

import type { EmbeddingProvider, EmbeddingProviderConfig, ProviderCapabilities } from "./types.js";
import {
  EmbeddingError,
  EmbeddingValidationError,
  EmbeddingNetworkError,
  EmbeddingTimeoutError,
} from "./errors.js";

/**
 * Configuration specific to Ollama embedding provider
 */
export interface OllamaProviderConfig extends EmbeddingProviderConfig {
  /**
   * Model name as registered in Ollama
   *
   * @example "nomic-embed-text"
   * @example "mxbai-embed-large"
   */
  modelName: string;

  /**
   * Ollama server base URL
   *
   * @default "http://localhost:11434"
   */
  baseUrl?: string;

  /**
   * Keep model loaded in memory between requests
   *
   * Format: duration string like "5m", "1h", "0" (unload immediately)
   *
   * @default "5m"
   */
  keepAlive?: string;
}

/**
 * Response from Ollama /api/embeddings endpoint
 */
interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * Response from Ollama /api/tags endpoint (for health check)
 */
interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
  }>;
}

/**
 * Ollama embedding provider implementation
 *
 * Implements the EmbeddingProvider interface using a local Ollama server.
 * Ollama provides GPU-accelerated inference for various embedding models.
 *
 * Features:
 * - REST API for easy integration
 * - GPU acceleration when available
 * - Model persistence with keep_alive parameter
 * - Health check via /api/tags endpoint
 * - Configurable host, port, and timeout
 *
 * @example
 * ```typescript
 * const provider = new OllamaEmbeddingProvider({
 *   provider: "ollama",
 *   model: "nomic-embed-text",
 *   dimensions: 768,
 *   batchSize: 32,
 *   maxRetries: 3,
 *   timeoutMs: 30000,
 *   modelName: "nomic-embed-text",
 *   baseUrl: "http://localhost:11434",
 * });
 *
 * const embedding = await provider.generateEmbedding("Hello world");
 * console.log(embedding.length); // 768
 * ```
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "ollama";
  readonly modelId: string;
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly keepAlive: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  /**
   * Create a new Ollama embedding provider
   *
   * @param config - Provider configuration
   * @throws {EmbeddingValidationError} If configuration is invalid
   */
  constructor(config: OllamaProviderConfig) {
    this.validateConfig(config);

    this.modelId = config.modelName;
    this.dimensions = config.dimensions;
    this.baseUrl = config.baseUrl || "http://localhost:11434";
    this.keepAlive = config.keepAlive || "5m";
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
  }

  /**
   * Generate embedding for a single text
   *
   * @param text - Input text to embed
   * @returns Embedding vector of length `dimensions`
   * @throws {EmbeddingValidationError} If text is empty or invalid
   * @throws {EmbeddingNetworkError} If Ollama server is unreachable
   * @throws {EmbeddingError} For other failures
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    const embedding = embeddings[0];
    if (!embedding) {
      throw new EmbeddingError("Unexpected empty embedding result", "EMPTY_RESULT");
    }
    return embedding;
  }

  /**
   * Generate embeddings for multiple texts
   *
   * Processes texts sequentially as Ollama handles one text per request.
   * The keep_alive parameter keeps the model loaded between requests for efficiency.
   *
   * @param texts - Array of input texts to embed
   * @returns Array of embedding vectors
   * @throws {EmbeddingValidationError} If inputs are invalid
   * @throws {EmbeddingNetworkError} If Ollama server is unreachable
   * @throws {EmbeddingError} For other failures
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    this.validateInputs(texts);

    const embeddings: number[][] = [];

    // Process texts sequentially - Ollama API handles one text at a time
    // Model stays loaded due to keep_alive, so subsequent calls are fast
    for (const text of texts) {
      const embedding = await this.callOllamaAPI(text);
      embeddings.push(embedding);
    }

    return embeddings;
  }

  /**
   * Verify provider connectivity and configuration
   *
   * Checks that the Ollama server is reachable and the specified model
   * is available. This method never throws - it returns false on any failure.
   *
   * @returns Promise resolving to true if healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as OllamaTagsResponse;

      // Check if the specified model is available
      // Model names in Ollama can have tags like "nomic-embed-text:latest"
      return data.models.some(
        (m) => m.name === this.modelId || m.name.startsWith(`${this.modelId}:`)
      );
    } catch {
      return false;
    }
  }

  /**
   * Get provider capabilities and limitations
   *
   * Returns information about Ollama constraints and characteristics.
   * Ollama is a local provider that can leverage GPU acceleration.
   *
   * @returns Provider capabilities for Ollama embeddings
   */
  getCapabilities(): ProviderCapabilities {
    return {
      maxBatchSize: 1, // Ollama processes one text at a time via API
      maxTokensPerText: 8192, // Varies by model, using conservative estimate
      supportsGPU: true, // Ollama can use GPU when available
      requiresNetwork: false, // Local server, no internet required
      estimatedLatencyMs: 50, // Fast with GPU, ~50-100ms warm
    };
  }

  /**
   * Make a request to the Ollama embedding API
   *
   * @param text - Text to embed
   * @returns Embedding vector
   * @throws {EmbeddingNetworkError} If request fails
   * @throws {EmbeddingError} For other API errors
   */
  private async callOllamaAPI(text: string): Promise<number[]> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(`${this.baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.modelId,
            prompt: text,
            keep_alive: this.keepAlive,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          throw new EmbeddingError(
            `Ollama API error: ${response.status} ${response.statusText} - ${errorText}`,
            "API_ERROR",
            response.status === 429 || response.status >= 500 // Retryable
          );
        }

        const data = (await response.json()) as OllamaEmbeddingResponse;

        if (!data.embedding || !Array.isArray(data.embedding)) {
          throw new EmbeddingError(
            "Invalid response from Ollama: missing embedding array",
            "INVALID_RESPONSE"
          );
        }

        return data.embedding;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry non-retryable errors
        if (error instanceof EmbeddingError && !error.retryable) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          break;
        }

        // Exponential backoff with jitter to prevent thundering herd
        const baseDelay = Math.pow(2, attempt) * 100;
        const jitter = Math.random() * baseDelay * 0.5;
        await this.sleep(baseDelay + jitter);
      }
    }

    // Handle final error
    if (lastError) {
      throw this.handleError(lastError);
    }

    throw new EmbeddingError("Unexpected error in Ollama API call", "UNKNOWN_ERROR");
  }

  /**
   * Fetch with timeout support
   *
   * @param url - URL to fetch
   * @param options - Fetch options
   * @returns Response
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new EmbeddingTimeoutError(`Request to Ollama timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Convert errors to our custom error types
   *
   * @param error - Error to handle
   * @returns Appropriate EmbeddingError subclass
   */
  private handleError(error: Error): EmbeddingError {
    if (error instanceof EmbeddingError) {
      return error;
    }

    const errorMessage = error.message.toLowerCase();

    // Check for network-related errors
    if (
      errorMessage.includes("fetch") ||
      errorMessage.includes("network") ||
      errorMessage.includes("econnrefused") ||
      errorMessage.includes("enotfound") ||
      errorMessage.includes("connection refused")
    ) {
      return new EmbeddingNetworkError(
        `Failed to connect to Ollama server at ${this.baseUrl}: ${error.message}. ` +
          "Ensure Ollama is running and accessible.",
        error
      );
    }

    // Generic error
    return new EmbeddingError(
      `Ollama embedding failed: ${error.message}`,
      "OLLAMA_ERROR",
      false,
      error
    );
  }

  /**
   * Validate provider configuration
   *
   * @param config - Configuration to validate
   * @throws {EmbeddingValidationError} If configuration is invalid
   */
  private validateConfig(config: OllamaProviderConfig): void {
    if (!config.modelName || config.modelName.trim().length === 0) {
      throw new EmbeddingValidationError("Model name is required", "modelName");
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

    if (config.maxRetries < 0) {
      throw new EmbeddingValidationError("Max retries cannot be negative", "maxRetries");
    }

    // Validate base URL format and scheme if provided
    if (config.baseUrl) {
      try {
        const parsedUrl = new URL(config.baseUrl);
        const allowedProtocols = ["http:", "https:"];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
          throw new EmbeddingValidationError(
            `Invalid base URL scheme: ${parsedUrl.protocol}. Only http and https are allowed.`,
            "baseUrl"
          );
        }
      } catch (error) {
        if (error instanceof EmbeddingValidationError) {
          throw error;
        }
        throw new EmbeddingValidationError(
          `Invalid base URL: ${config.baseUrl}. Expected format: http://host:port`,
          "baseUrl"
        );
      }
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
   * Sleep for a given number of milliseconds
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
