/**
 * Factory for creating embedding providers from configuration
 *
 * Provides a unified interface for instantiating embedding providers
 * based on configuration, with automatic environment variable handling.
 *
 * @see EmbeddingProviderFactory for the class-based factory pattern
 */

import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";
import { OpenAIEmbeddingProvider, type OpenAIProviderConfig } from "./openai-embedding.js";
import {
  TransformersJsEmbeddingProvider,
  type TransformersJsProviderConfig,
} from "./transformersjs-embedding.js";
import { OllamaEmbeddingProvider, type OllamaProviderConfig } from "./ollama-embedding.js";
import { EmbeddingValidationError } from "./errors.js";

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
  const providerType = config.provider.toLowerCase();

  switch (providerType) {
    case "openai":
      return createOpenAIProvider(config);

    case "transformersjs":
    case "transformers":
    case "local":
      return createTransformersJsProvider(config);

    case "ollama":
      return createOllamaProvider(config);

    default:
      throw new EmbeddingValidationError(
        `Unsupported provider: ${config.provider}. Supported providers: openai, transformersjs, ollama`,
        "provider"
      );
  }
}

/**
 * Create an OpenAI embedding provider
 *
 * Reads API key from OPENAI_API_KEY environment variable.
 * Optionally reads OPENAI_ORGANIZATION and OPENAI_BASE_URL.
 *
 * @param config - Base provider configuration
 * @returns Initialized OpenAI provider
 * @throws {EmbeddingValidationError} If OPENAI_API_KEY is missing
 */
function createOpenAIProvider(config: EmbeddingProviderConfig): OpenAIEmbeddingProvider {
  // Read API key from environment
  const apiKey = Bun.env["OPENAI_API_KEY"];

  if (!apiKey) {
    throw new EmbeddingValidationError(
      "OPENAI_API_KEY environment variable is required for OpenAI provider",
      "apiKey"
    );
  }

  // Build OpenAI-specific configuration
  const openaiConfig: OpenAIProviderConfig = {
    ...config,
    apiKey,
    organization: Bun.env["OPENAI_ORGANIZATION"],
    baseURL: Bun.env["OPENAI_BASE_URL"],
  };

  return new OpenAIEmbeddingProvider(openaiConfig);
}

/**
 * Create a Transformers.js embedding provider
 *
 * Uses local HuggingFace models via Transformers.js for offline embedding generation.
 * Optionally reads TRANSFORMERS_CACHE for custom cache directory.
 *
 * @param config - Base provider configuration
 * @returns Initialized Transformers.js provider
 */
function createTransformersJsProvider(
  config: EmbeddingProviderConfig
): TransformersJsEmbeddingProvider {
  const transformersConfig: TransformersJsProviderConfig = {
    ...config,
    modelPath: (config.options?.["modelPath"] as string) || "Xenova/all-MiniLM-L6-v2",
    cacheDir: Bun.env["TRANSFORMERS_CACHE"] || undefined,
    quantized: (config.options?.["quantized"] as boolean) || false,
  };

  return new TransformersJsEmbeddingProvider(transformersConfig);
}

/**
 * Create an Ollama embedding provider
 *
 * Connects to a local Ollama server for GPU-accelerated embedding generation.
 * Reads configuration from environment variables:
 * - OLLAMA_BASE_URL: Full URL (takes precedence)
 * - OLLAMA_HOST: Host name (default: localhost)
 * - OLLAMA_PORT: Port number (default: 11434)
 *
 * @param config - Base provider configuration
 * @returns Initialized Ollama provider
 */
function createOllamaProvider(config: EmbeddingProviderConfig): OllamaEmbeddingProvider {
  // Build base URL from environment variables
  let baseUrl = Bun.env["OLLAMA_BASE_URL"];

  if (!baseUrl) {
    const host = Bun.env["OLLAMA_HOST"] || "localhost";
    const port = Bun.env["OLLAMA_PORT"] || "11434";
    baseUrl = `http://${host}:${port}`;
  }

  const ollamaConfig: OllamaProviderConfig = {
    ...config,
    modelName: (config.options?.["modelName"] as string) || "nomic-embed-text",
    baseUrl,
    keepAlive: (config.options?.["keepAlive"] as string) || "5m",
  };

  return new OllamaEmbeddingProvider(ollamaConfig);
}
