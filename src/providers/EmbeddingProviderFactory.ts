/**
 * EmbeddingProviderFactory - Class-based factory for creating embedding providers
 *
 * Provides a unified interface for instantiating embedding providers based on
 * configuration, with environment variable handling and provider discovery.
 *
 * @see ADR-0003: Local Embeddings Architecture
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
 * Information about an available embedding provider
 */
export interface ProviderInfo {
  /** Provider identifier */
  id: string;

  /** Human-readable provider name */
  name: string;

  /** Brief description of the provider */
  description: string;

  /** Whether this provider requires network connectivity */
  requiresNetwork: boolean;

  /** Whether this provider supports GPU acceleration */
  supportsGPU: boolean;

  /** Alternative names/aliases for this provider */
  aliases: string[];

  /** Required environment variables (empty if none required) */
  requiredEnvVars: string[];

  /** Optional environment variables */
  optionalEnvVars: string[];
}

/**
 * Supported provider types
 */
export type ProviderType = "openai" | "transformersjs" | "ollama";

/**
 * Provider aliases mapping
 */
const PROVIDER_ALIASES: Record<string, ProviderType> = {
  openai: "openai",
  transformersjs: "transformersjs",
  transformers: "transformersjs",
  local: "transformersjs",
  ollama: "ollama",
};

/**
 * Provider metadata for discovery
 */
const PROVIDER_INFO: Record<ProviderType, ProviderInfo> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI Embeddings API (cloud-based, highest quality)",
    requiresNetwork: true,
    supportsGPU: false, // GPU is server-side
    aliases: [],
    requiredEnvVars: ["OPENAI_API_KEY"],
    optionalEnvVars: ["OPENAI_ORGANIZATION", "OPENAI_BASE_URL"],
  },
  transformersjs: {
    id: "transformersjs",
    name: "Transformers.js",
    description: "Local HuggingFace models via Transformers.js (offline, CPU)",
    requiresNetwork: false,
    supportsGPU: false,
    aliases: ["transformers", "local"],
    requiredEnvVars: [],
    optionalEnvVars: ["TRANSFORMERS_CACHE"],
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local Ollama server (offline, GPU-accelerated)",
    requiresNetwork: false,
    supportsGPU: true,
    aliases: [],
    requiredEnvVars: [],
    optionalEnvVars: ["OLLAMA_BASE_URL", "OLLAMA_HOST", "OLLAMA_PORT"],
  },
};

/**
 * EmbeddingProviderFactory - Creates embedding provider instances
 *
 * This factory provides a unified interface for creating embedding providers
 * from different backends (OpenAI, Transformers.js, Ollama). It handles:
 * - Provider instantiation based on configuration
 * - Environment variable resolution for credentials
 * - Provider discovery and metadata
 * - Configuration validation
 *
 * @example
 * ```typescript
 * const factory = new EmbeddingProviderFactory();
 *
 * // Create a provider
 * const provider = factory.createProvider({
 *   provider: "openai",
 *   model: "text-embedding-3-small",
 *   dimensions: 1536,
 *   batchSize: 100,
 *   maxRetries: 3,
 *   timeoutMs: 30000,
 * });
 *
 * // List available providers
 * const providers = factory.listAvailableProviders();
 *
 * // Get default provider
 * const defaultProvider = factory.getDefaultProvider();
 * ```
 */
export class EmbeddingProviderFactory {
  /**
   * Create an embedding provider from configuration
   *
   * Reads provider-specific credentials from environment variables and
   * instantiates the appropriate provider implementation.
   *
   * Supported providers:
   * - "openai": OpenAI Embeddings API (requires OPENAI_API_KEY)
   * - "transformersjs" / "transformers" / "local": Local Transformers.js models
   * - "ollama": Local Ollama server
   *
   * @param config - Provider configuration (without sensitive credentials)
   * @returns Initialized embedding provider
   * @throws {EmbeddingValidationError} If provider is unsupported or credentials are missing
   */
  createProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
    const providerType = this.resolveProviderType(config.provider);

    if (!providerType) {
      throw new EmbeddingValidationError(
        `Unsupported provider: ${config.provider}. Supported providers: ${this.getSupportedProvidersList()}`,
        "provider"
      );
    }

    switch (providerType) {
      case "openai":
        return this.createOpenAIProvider(config);

      case "transformersjs":
        return this.createTransformersJsProvider(config);

      case "ollama":
        return this.createOllamaProvider(config);
    }
  }

  /**
   * List all available embedding providers
   *
   * Returns metadata about each supported provider, including capabilities,
   * required environment variables, and aliases.
   *
   * @returns Array of provider information objects
   */
  listAvailableProviders(): ProviderInfo[] {
    return Object.values(PROVIDER_INFO);
  }

  /**
   * Get the default embedding provider
   *
   * Returns the recommended default provider based on environment.
   * If OPENAI_API_KEY is set, returns "openai".
   * Otherwise returns "transformersjs" for offline operation.
   *
   * @returns Default provider identifier
   */
  getDefaultProvider(): string {
    // If OpenAI API key is available, prefer OpenAI for highest quality
    if (Bun.env["OPENAI_API_KEY"]) {
      return "openai";
    }

    // Otherwise, use Transformers.js for zero-config local operation
    return "transformersjs";
  }

  /**
   * Check if a provider is available (has required configuration)
   *
   * @param providerId - Provider identifier to check
   * @returns True if provider can be used, false otherwise
   */
  isProviderAvailable(providerId: string): boolean {
    const providerType = this.resolveProviderType(providerId);
    if (!providerType) return false;

    const info = PROVIDER_INFO[providerType];
    if (!info) return false;

    // Check required environment variables
    return info.requiredEnvVars.every((envVar) => !!Bun.env[envVar]);
  }

  /**
   * Resolve provider name/alias to canonical provider type
   *
   * @param provider - Provider name or alias
   * @returns Canonical provider type or undefined if unknown
   */
  private resolveProviderType(provider: string): ProviderType | undefined {
    const normalized = provider.toLowerCase();
    return PROVIDER_ALIASES[normalized];
  }

  /**
   * Get comma-separated list of supported providers
   *
   * @returns String like "openai, transformersjs, ollama"
   */
  private getSupportedProvidersList(): string {
    return Object.keys(PROVIDER_INFO).join(", ");
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
  private createOpenAIProvider(config: EmbeddingProviderConfig): OpenAIEmbeddingProvider {
    const apiKey = Bun.env["OPENAI_API_KEY"];

    if (!apiKey) {
      throw new EmbeddingValidationError(
        "OPENAI_API_KEY environment variable is required for OpenAI provider",
        "apiKey"
      );
    }

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
  private createTransformersJsProvider(
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
  private createOllamaProvider(config: EmbeddingProviderConfig): OllamaEmbeddingProvider {
    // Build base URL from environment variables
    let baseUrl = Bun.env["OLLAMA_BASE_URL"];

    if (!baseUrl) {
      const host = Bun.env["OLLAMA_HOST"] || "localhost";
      const port = Bun.env["OLLAMA_PORT"] || "11434";

      // Validate port is numeric
      if (!/^\d+$/.test(port)) {
        throw new EmbeddingValidationError(
          `Invalid OLLAMA_PORT: ${port}. Must be a numeric port number.`,
          "port"
        );
      }

      // Validate host does not contain URL special characters
      if (/[/:@#?]/.test(host)) {
        throw new EmbeddingValidationError(
          `Invalid OLLAMA_HOST: ${host}. Must be a valid hostname without URL special characters.`,
          "host"
        );
      }

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
}

/**
 * Singleton factory instance for convenience
 */
export const embeddingProviderFactory = new EmbeddingProviderFactory();
