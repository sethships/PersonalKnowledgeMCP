/**
 * Per-repository embedding provider resolution.
 *
 * Repositories record the embedding provider they were indexed with
 * (`embeddingProvider` / `embeddingModel` / `embeddingDimensions` in repository
 * metadata, mirrored as `app:embedding_*` keys in their ChromaDB collection
 * metadata). Any operation that generates embeddings against an existing
 * collection — query-time search and incremental updates alike — must use that
 * provider, not whatever the process-global default happens to be (issue #591:
 * a transformersjs/384 repo updated by a server whose global provider was
 * openai/1536 had every vector rejected by ChromaDB).
 *
 * This resolver extracts the provider-cache pattern previously duplicated in
 * SearchService.getOrCreateProvider and
 * DocumentSearchService.getProviderForRepository so all consumers share one
 * implementation (and one cache when wired with a shared instance).
 *
 * @see GitHub issue #591
 * @module providers/repository-provider-resolver
 */

import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";
import type { ProviderType } from "./EmbeddingProviderFactory.js";
import { resolveEmbeddingDefaults } from "./provider-defaults.js";

/**
 * Structural factory contract accepted by the resolver.
 *
 * `EmbeddingProviderFactory` satisfies this; consumers that inject a narrower
 * factory (e.g., SearchService's structural factory interface) do too.
 * `resolveProviderType` is optional — without it, provider-aware defaults fall
 * back to pass-through behavior for unrecognized providers.
 */
export interface ProviderFactoryLike {
  /** Create a provider from full configuration. */
  createProvider(config: EmbeddingProviderConfig): EmbeddingProvider;
  /** Resolve a provider id/alias to its canonical type (optional). */
  resolveProviderType?(providerId: string): ProviderType | undefined;
}

/**
 * The subset of repository (or collection) metadata needed to resolve a
 * provider. Matches the optional embedding fields on `RepositoryInfo` and the
 * parsed `app:embedding_*` collection metadata (`ParsedEmbeddingMetadata`).
 */
export interface EmbeddingMetadataLike {
  /** Provider identifier (e.g., "openai", "transformersjs", "ollama"). */
  provider?: string;
  /** Model identifier (e.g., "text-embedding-3-small", "Xenova/all-MiniLM-L6-v2"). */
  model?: string;
  /** Embedding vector dimensions (e.g., 1536, 384, 768). */
  dimensions?: number;
}

/**
 * Resolves embedding providers from repository/collection metadata with
 * caching and a default-provider short-circuit.
 *
 * Resolution rules:
 * - No `provider` in the metadata → the default provider (repos indexed before
 *   per-repository provider support).
 * - Missing `model`/`dimensions` → filled from provider-aware defaults
 *   (`resolveEmbeddingDefaults`, the #581 helper), so a bare provider id still
 *   resolves to a working configuration.
 * - Matching the default provider's `provider:model:dimensions` triple reuses
 *   the default instance instead of constructing a duplicate.
 * - Construction failures propagate the factory's typed `EmbeddingError`
 *   subclasses unchanged (e.g., `EmbeddingValidationError` for unsupported
 *   providers or missing credentials).
 *
 * @example
 * ```typescript
 * const resolver = new RepositoryEmbeddingProviderResolver(factory, defaultProvider);
 * const provider = resolver.resolve({
 *   provider: repo.embeddingProvider,
 *   model: repo.embeddingModel,
 *   dimensions: repo.embeddingDimensions,
 * });
 * ```
 */
export class RepositoryEmbeddingProviderResolver {
  /**
   * Cache of created providers keyed by `provider:model:dimensions`.
   *
   * Providers are stateless beyond their loaded model/connection, so reusing
   * an instance per configuration avoids repeated model loads (significant
   * for transformersjs, where construction implies ONNX model initialization).
   */
  private readonly providerCache = new Map<string, EmbeddingProvider>();

  /**
   * @param factory - Factory used to construct non-default providers
   * @param defaultProvider - Process-global provider used when metadata names
   *   no provider, and reused when metadata matches its configuration
   */
  constructor(
    private readonly factory: ProviderFactoryLike,
    private readonly defaultProvider: EmbeddingProvider
  ) {}

  /**
   * Resolve the embedding provider for the given repository/collection metadata.
   *
   * @param meta - Embedding metadata (provider/model/dimensions, all optional)
   * @returns A provider matching the metadata, or the default provider when no
   *   provider is named
   * @throws {EmbeddingValidationError} If the named provider is unsupported or
   *   its required credentials/configuration are missing
   */
  resolve(meta: EmbeddingMetadataLike): EmbeddingProvider {
    if (!meta.provider) {
      return this.defaultProvider;
    }

    // Fill missing model/dimensions with provider-aware defaults (#581). The
    // recorded model (when present) belongs to the recorded provider, so it is
    // passed through; only absent fields get defaults.
    const providerType = this.factory.resolveProviderType?.(meta.provider);
    const defaults = resolveEmbeddingDefaults(providerType, meta.model, meta.dimensions);
    const model = meta.model ?? defaults.model;
    const dimensions = meta.dimensions ?? defaults.dimensions;

    const cacheKey = `${meta.provider}:${model}:${dimensions}`;

    const cached = this.providerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Reuse the default instance when the metadata describes it exactly
    if (
      meta.provider === this.defaultProvider.providerId &&
      model === this.defaultProvider.modelId &&
      dimensions === this.defaultProvider.dimensions
    ) {
      this.providerCache.set(cacheKey, this.defaultProvider);
      return this.defaultProvider;
    }

    const config: EmbeddingProviderConfig = {
      provider: meta.provider,
      model,
      dimensions,
      batchSize: 100,
      maxRetries: 3,
      timeoutMs: 30000,
    };

    const provider = this.factory.createProvider(config);
    this.providerCache.set(cacheKey, provider);
    return provider;
  }
}
