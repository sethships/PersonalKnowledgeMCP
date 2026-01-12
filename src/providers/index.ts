/**
 * Embedding provider module exports
 *
 * This module provides a unified interface for generating embeddings
 * from various providers (OpenAI, Ollama, Transformers.js).
 *
 * @example
 * ```typescript
 * import { createEmbeddingProvider, EmbeddingProviderFactory } from "./providers";
 *
 * // Function-based API (simple)
 * const provider = createEmbeddingProvider({
 *   provider: "openai",
 *   model: "text-embedding-3-small",
 *   dimensions: 1536,
 *   batchSize: 100,
 *   maxRetries: 3,
 *   timeoutMs: 30000,
 * });
 *
 * // Class-based API (for discovery and advanced usage)
 * const factory = new EmbeddingProviderFactory();
 * const providers = factory.listAvailableProviders();
 * const defaultProvider = factory.getDefaultProvider();
 *
 * const embedding = await provider.generateEmbedding("Hello world");
 * ```
 */

// Type definitions
export type { EmbeddingProvider, EmbeddingProviderConfig, ProviderCapabilities } from "./types.js";

// Error classes
export {
  EmbeddingError,
  EmbeddingAuthenticationError,
  EmbeddingRateLimitError,
  EmbeddingNetworkError,
  EmbeddingTimeoutError,
  EmbeddingValidationError,
} from "./errors.js";

// Provider implementations
export { OpenAIEmbeddingProvider } from "./openai-embedding.js";
export type { OpenAIProviderConfig } from "./openai-embedding.js";

export { TransformersJsEmbeddingProvider } from "./transformersjs-embedding.js";
export type {
  TransformersJsProviderConfig,
  ModelDownloadProgress,
} from "./transformersjs-embedding.js";

export { OllamaEmbeddingProvider } from "./ollama-embedding.js";
export type { OllamaProviderConfig } from "./ollama-embedding.js";

// Factory function (backwards compatible)
export { createEmbeddingProvider } from "./factory.js";

// Factory class (for advanced usage and discovery)
export { EmbeddingProviderFactory, embeddingProviderFactory } from "./EmbeddingProviderFactory.js";
export type { ProviderInfo, ProviderType } from "./EmbeddingProviderFactory.js";
