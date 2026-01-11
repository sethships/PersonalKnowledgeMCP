/**
 * Embedding provider module exports
 *
 * This module provides a unified interface for generating embeddings
 * from various providers (OpenAI, Ollama, HuggingFace, etc.).
 *
 * @example
 * ```typescript
 * import { createEmbeddingProvider } from "./providers";
 *
 * const provider = createEmbeddingProvider({
 *   provider: "openai",
 *   model: "text-embedding-3-small",
 *   dimensions: 1536,
 *   batchSize: 100,
 *   maxRetries: 3,
 *   timeoutMs: 30000,
 * });
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

// Factory function
export { createEmbeddingProvider } from "./factory.js";
