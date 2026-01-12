/**
 * Factory for creating embedding providers from configuration
 *
 * Provides a unified interface for instantiating embedding providers
 * based on configuration, with automatic environment variable handling.
 *
 * This module provides backward-compatible function API by delegating
 * to the class-based EmbeddingProviderFactory.
 *
 * @see EmbeddingProviderFactory for the class-based factory pattern
 */

import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";
import { EmbeddingProviderFactory } from "./EmbeddingProviderFactory.js";

/**
 * Singleton factory instance for delegation
 */
const factory = new EmbeddingProviderFactory();

/**
 * Create an embedding provider from configuration
 *
 * Reads provider-specific credentials from environment variables and
 * instantiates the appropriate provider implementation.
 *
 * Supported providers:
 * - "openai": OpenAI Embeddings API (requires OPENAI_API_KEY)
 * - "transformersjs" / "transformers" / "local": Local Transformers.js models
 * - "ollama": Local Ollama server (GPU-accelerated)
 *
 * @param config - Provider configuration (without sensitive credentials)
 * @returns Initialized embedding provider
 * @throws {EmbeddingValidationError} If provider is unsupported or credentials are missing
 *
 * @example
 * ```typescript
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
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  return factory.createProvider(config);
}
