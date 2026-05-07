/**
 * Provider-aware embedding-config defaults.
 *
 * Resolves the model + dimensions to use for a given embedding provider, with
 * special handling for the case where `EMBEDDING_MODEL` in `.env` belongs to a
 * different provider than the one the user explicitly selected (#581).
 *
 * The classic case: a `.env` configured for OpenAI (`EMBEDDING_MODEL=text-embedding-3-small`)
 * leaking into `bun run cli index ... --provider transformersjs`, which then
 * tries to download `https://huggingface.co/text-embedding-3-small/...` and fails.
 *
 * @see ADR-0003 — provider configuration
 * @see GitHub issue #581
 */
import type { ProviderType } from "./EmbeddingProviderFactory.js";

/**
 * Default model to use for each provider when no compatible env override is supplied.
 */
export const PROVIDER_DEFAULT_MODEL: Record<ProviderType, string> = {
  openai: "text-embedding-3-small",
  transformersjs: "Xenova/all-MiniLM-L6-v2",
  ollama: "nomic-embed-text",
};

/**
 * Default embedding dimensions for each provider's default model. Used when the
 * helper substitutes a provider default (caller's `envDimensions` are likely
 * shaped for a different provider in that scenario).
 */
export const PROVIDER_DEFAULT_DIMENSIONS: Record<ProviderType, number> = {
  openai: 1536,
  transformersjs: 384,
  ollama: 768,
};

/**
 * Result of resolving provider-aware embedding defaults.
 */
export interface ResolvedEmbeddingDefaults {
  /** Model to use — either the env-supplied value or a provider default. */
  model: string;
  /** Dimensions to use — overrides upstream when model was substituted. */
  dimensions: number;
  /** Populated when the env-supplied model was substituted with a provider default. */
  warning?: string;
}

/**
 * Returns true when `envModel` plausibly belongs to `provider`.
 *
 * Heuristic only — catches the obvious cross-provider mismatch (e.g. an OpenAI
 * model name passed to transformersjs) without trying to validate model
 * existence. The provider's `initialize()` performs the real download/health
 * check.
 */
function isModelCompatibleWithProvider(model: string, provider: ProviderType): boolean {
  const looksLikeOpenAI = model.startsWith("text-embedding-");
  const looksLikeHuggingFace = model.includes("/");

  if (provider === "openai") {
    // Trust whatever the user set — OpenAI accepts arbitrary model strings and
    // a non-OpenAI-shaped value would just produce a clean API error.
    return true;
  }

  if (provider === "transformersjs") {
    // Transformers.js models are HuggingFace IDs (`org/model`). An OpenAI-shaped
    // name without a slash will fail the HuggingFace download — substitute.
    return !looksLikeOpenAI;
  }

  if (provider === "ollama") {
    // Ollama models are simple slugs (no `/`) and not OpenAI-prefixed.
    return !looksLikeOpenAI && !looksLikeHuggingFace;
  }

  return true;
}

/**
 * Resolves the model + dimensions to use for the given provider, taking the
 * environment values into account when they're compatible and substituting
 * the provider default when they're not.
 *
 * @param provider - Canonical provider type (caller is responsible for alias resolution).
 * @param envModel - Value of `EMBEDDING_MODEL` env var (or undefined if unset).
 * @param envDimensions - Value of `EMBEDDING_DIMENSIONS` env var (or undefined if unset).
 * @returns Resolved model + dimensions, plus a warning string when env model was substituted.
 */
export function resolveEmbeddingDefaults(
  provider: ProviderType,
  envModel: string | undefined,
  envDimensions: number | undefined
): ResolvedEmbeddingDefaults {
  const defaultModel = PROVIDER_DEFAULT_MODEL[provider];
  const defaultDimensions = PROVIDER_DEFAULT_DIMENSIONS[provider];

  if (!envModel || envModel.trim() === "") {
    return {
      model: defaultModel,
      dimensions: envDimensions ?? defaultDimensions,
    };
  }

  if (isModelCompatibleWithProvider(envModel, provider)) {
    return {
      model: envModel,
      dimensions: envDimensions ?? defaultDimensions,
    };
  }

  return {
    model: defaultModel,
    dimensions: defaultDimensions,
    warning:
      `EMBEDDING_MODEL='${envModel}' is not compatible with provider '${provider}'. ` +
      `Using provider default model '${defaultModel}' (${defaultDimensions} dimensions). ` +
      `Set EMBEDDING_MODEL to a ${provider}-compatible model in your .env to silence this warning.`,
  };
}
