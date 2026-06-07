/**
 * Unit tests for RepositoryEmbeddingProviderResolver (#591).
 *
 * Verifies per-repository provider resolution: default fallback, cache
 * behavior, default-provider short-circuit, provider-aware defaults fill
 * (#581), and factory error propagation.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { RepositoryEmbeddingProviderResolver } from "../../../src/providers/repository-provider-resolver.js";
import { EmbeddingProviderFactory } from "../../../src/providers/EmbeddingProviderFactory.js";
import { EmbeddingValidationError } from "../../../src/providers/errors.js";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../../../src/providers/types.js";

/**
 * Build a lightweight fake provider with the identity fields the resolver
 * inspects. Embedding methods are never called by the resolver itself.
 */
function fakeProvider(providerId: string, modelId: string, dimensions: number): EmbeddingProvider {
  return {
    providerId,
    modelId,
    dimensions,
    generateEmbedding: mock(async () => new Array(dimensions).fill(0) as number[]),
    generateEmbeddings: mock(async (texts: string[]) =>
      texts.map(() => new Array(dimensions).fill(0) as number[])
    ),
    healthCheck: mock(async () => true),
    getCapabilities: () => ({
      maxBatchSize: 100,
      maxTokensPerText: 8191,
      supportsGPU: false,
      requiresNetwork: false,
      estimatedLatencyMs: 1,
    }),
  };
}

describe("RepositoryEmbeddingProviderResolver", () => {
  let factory: EmbeddingProviderFactory;
  let createProviderMock: ReturnType<typeof mock>;
  let defaultProvider: EmbeddingProvider;
  let resolver: RepositoryEmbeddingProviderResolver;

  beforeEach(() => {
    defaultProvider = fakeProvider("openai", "text-embedding-3-small", 1536);

    factory = new EmbeddingProviderFactory();
    createProviderMock = mock((config: EmbeddingProviderConfig) =>
      fakeProvider(config.provider, config.model, config.dimensions)
    );
    factory.createProvider = createProviderMock as unknown as typeof factory.createProvider;

    resolver = new RepositoryEmbeddingProviderResolver(factory, defaultProvider);
  });

  test("returns the default provider when metadata names no provider", () => {
    const provider = resolver.resolve({});
    expect(provider).toBe(defaultProvider);
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  test("creates a provider matching full metadata", () => {
    const provider = resolver.resolve({
      provider: "transformersjs",
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
    });

    expect(provider.providerId).toBe("transformersjs");
    expect(provider.modelId).toBe("Xenova/all-MiniLM-L6-v2");
    expect(provider.dimensions).toBe(384);
    expect(createProviderMock).toHaveBeenCalledTimes(1);
  });

  test("caches providers by provider:model:dimensions", () => {
    const meta = { provider: "transformersjs", model: "Xenova/all-MiniLM-L6-v2", dimensions: 384 };
    const first = resolver.resolve(meta);
    const second = resolver.resolve({ ...meta });

    expect(second).toBe(first);
    expect(createProviderMock).toHaveBeenCalledTimes(1);
  });

  test("different configurations get distinct cache entries", () => {
    const a = resolver.resolve({ provider: "transformersjs", model: "m-a", dimensions: 384 });
    const b = resolver.resolve({ provider: "transformersjs", model: "m-b", dimensions: 384 });

    expect(a).not.toBe(b);
    expect(createProviderMock).toHaveBeenCalledTimes(2);
  });

  test("reuses the default instance when metadata describes it exactly", () => {
    const provider = resolver.resolve({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });

    expect(provider).toBe(defaultProvider);
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  test("fills missing model and dimensions from provider defaults (#581)", () => {
    const provider = resolver.resolve({ provider: "transformersjs" });

    // Provider-aware defaults: transformersjs → Xenova/all-MiniLM-L6-v2 @ 384
    expect(provider.modelId).toBe("Xenova/all-MiniLM-L6-v2");
    expect(provider.dimensions).toBe(384);
    const config = createProviderMock.mock.calls[0]?.[0] as EmbeddingProviderConfig;
    expect(config.model).toBe("Xenova/all-MiniLM-L6-v2");
    expect(config.dimensions).toBe(384);
  });

  test("fills missing dimensions when only model is recorded", () => {
    resolver.resolve({ provider: "transformersjs", model: "Xenova/all-MiniLM-L6-v2" });

    const config = createProviderMock.mock.calls[0]?.[0] as EmbeddingProviderConfig;
    expect(config.dimensions).toBe(384);
  });

  test("propagates factory errors for unsupported providers", () => {
    factory.createProvider = ((config: EmbeddingProviderConfig) => {
      throw new EmbeddingValidationError(`Unsupported provider: ${config.provider}`, "provider");
    }) as typeof factory.createProvider;
    resolver = new RepositoryEmbeddingProviderResolver(factory, defaultProvider);

    expect(() => resolver.resolve({ provider: "no-such-provider", dimensions: 42 })).toThrow(
      EmbeddingValidationError
    );
  });
});
