/**
 * Providers Commands - Manage embedding providers
 *
 * Commands for managing and configuring embedding providers:
 * - status: Show available providers and their configuration status
 * - setup: Download and prepare local embedding models
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import type { CliDependencies } from "../utils/dependency-init.js";
import {
  EmbeddingProviderFactory,
  type ProviderInfo,
} from "../../providers/EmbeddingProviderFactory.js";
import {
  TransformersJsEmbeddingProvider,
  type ModelDownloadProgress,
} from "../../providers/transformersjs-embedding.js";
import { OllamaEmbeddingProvider } from "../../providers/ollama-embedding.js";
import {
  createProvidersTable,
  createRepositoryProviderTable,
  formatProvidersJson,
  formatSetupSuccess,
  formatSetupError,
  extractRepositoryProviderUsage,
  type ProviderDisplayInfo,
  type ProviderStatus,
} from "../output/providers-formatters.js";

// ============================================================================
// Default Model Configurations
// ============================================================================

/**
 * Default model for Transformers.js provider
 */
const DEFAULT_TRANSFORMERSJS_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_TRANSFORMERSJS_DIMENSIONS = 384;

/**
 * Default model for Ollama provider
 */
const DEFAULT_OLLAMA_MODEL = "nomic-embed-text";
const DEFAULT_OLLAMA_DIMENSIONS = 768;

/**
 * Default dimensions for OpenAI provider
 */
const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_DIMENSIONS = 1536;

// ============================================================================
// Timeout Constants
// ============================================================================

/** Timeout for server health check (5 seconds) */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Timeout for Transformers.js model download (5 minutes) */
const MODEL_DOWNLOAD_TIMEOUT_MS = 300000;

/** Timeout for Ollama model pull (10 minutes) */
const OLLAMA_PULL_TIMEOUT_MS = 600000;

/** Timeout for provider verification (30 seconds) */
const PROVIDER_VERIFY_TIMEOUT_MS = 30000;

// ============================================================================
// Command Option Types
// ============================================================================

/**
 * Options for providers status command
 */
export interface ProvidersStatusOptions {
  /** Output as JSON */
  json?: boolean;
}

/**
 * Options for providers setup command
 */
export interface ProvidersSetupOptions {
  /** Provider to set up */
  provider: string;
  /** Model to download (provider-specific) */
  model?: string;
  /** Force re-download even if model exists */
  force?: boolean;
}

// ============================================================================
// Provider Status Detection
// ============================================================================

/**
 * Determine the status of the OpenAI provider
 *
 * @param info - Provider info from factory
 * @param factory - Embedding provider factory
 * @returns Provider display information
 */
function getOpenAIStatus(
  info: ProviderInfo,
  factory: EmbeddingProviderFactory
): ProviderDisplayInfo {
  const isAvailable = factory.isProviderAvailable("openai");

  return {
    id: info.id,
    name: info.name,
    description: info.description,
    status: isAvailable ? "ready" : "not-configured",
    model: isAvailable ? DEFAULT_OPENAI_MODEL : undefined,
    dimensions: isAvailable ? DEFAULT_OPENAI_DIMENSIONS : undefined,
    isDefault: factory.getDefaultProvider() === "openai",
    statusMessage: isAvailable ? undefined : "OPENAI_API_KEY environment variable not set",
  };
}

/**
 * Determine the status of the Transformers.js provider
 *
 * For simplicity, we consider the provider "ready" if the environment allows it.
 * The model will be downloaded on first use if not cached.
 *
 * @param info - Provider info from factory
 * @param factory - Embedding provider factory
 * @returns Provider display information
 */
function getTransformersJsStatus(
  info: ProviderInfo,
  factory: EmbeddingProviderFactory
): ProviderDisplayInfo {
  // Transformers.js is always available (no external dependencies)
  // Model download happens on first use
  return {
    id: info.id,
    name: info.name,
    description: info.description,
    status: "ready",
    model: DEFAULT_TRANSFORMERSJS_MODEL,
    dimensions: DEFAULT_TRANSFORMERSJS_DIMENSIONS,
    isDefault: factory.getDefaultProvider() === "transformersjs",
  };
}

/**
 * Determine the status of the Ollama provider
 *
 * @param info - Provider info from factory
 * @param factory - Embedding provider factory
 * @returns Provider display information
 */
async function getOllamaStatus(
  info: ProviderInfo,
  factory: EmbeddingProviderFactory
): Promise<ProviderDisplayInfo> {
  // Try to connect to Ollama server
  const baseUrl =
    Bun.env["OLLAMA_BASE_URL"] ||
    `http://${Bun.env["OLLAMA_HOST"] || "localhost"}:${Bun.env["OLLAMA_PORT"] || "11434"}`;

  let status: ProviderStatus = "not-available";
  let statusMessage: string | undefined = "Ollama server not running";

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });

    if (response.ok) {
      status = "ready";
      statusMessage = undefined;
    }
  } catch {
    // Server not reachable
    status = "not-available";
    statusMessage = `Ollama server not running at ${baseUrl}`;
  }

  return {
    id: info.id,
    name: info.name,
    description: info.description,
    status,
    model: status === "ready" ? DEFAULT_OLLAMA_MODEL : undefined,
    dimensions: status === "ready" ? DEFAULT_OLLAMA_DIMENSIONS : undefined,
    isDefault: factory.getDefaultProvider() === "ollama",
    statusMessage,
  };
}

/**
 * Get status for all available providers
 *
 * @param factory - Embedding provider factory
 * @returns Array of provider display information
 */
async function getAllProviderStatuses(
  factory: EmbeddingProviderFactory
): Promise<ProviderDisplayInfo[]> {
  const providers = factory.listAvailableProviders();
  const statuses: ProviderDisplayInfo[] = [];

  for (const info of providers) {
    switch (info.id) {
      case "openai":
        statuses.push(getOpenAIStatus(info, factory));
        break;
      case "transformersjs":
        statuses.push(getTransformersJsStatus(info, factory));
        break;
      case "ollama":
        statuses.push(await getOllamaStatus(info, factory));
        break;
    }
  }

  return statuses;
}

// ============================================================================
// Providers Status Command
// ============================================================================

/**
 * Execute providers status command
 *
 * Shows all available embedding providers and their configuration status,
 * plus repository provider usage information.
 *
 * @param options - Command options
 * @param deps - CLI dependencies
 */
export async function providersStatusCommand(
  options: ProvidersStatusOptions,
  deps: CliDependencies
): Promise<void> {
  const factory = new EmbeddingProviderFactory();

  // Get all provider statuses
  const providerStatuses = await getAllProviderStatuses(factory);

  // Get repository provider usage
  const repositories = await deps.repositoryService.listRepositories();
  const repositoryUsage = extractRepositoryProviderUsage(repositories);

  // Output based on format
  if (options.json) {
    console.log(formatProvidersJson(providerStatuses, repositoryUsage));
  } else {
    console.log(createProvidersTable(providerStatuses));
    console.log(createRepositoryProviderTable(repositoryUsage));
  }
}

// ============================================================================
// Providers Setup Command
// ============================================================================

/**
 * Execute providers setup command
 *
 * Downloads and prepares local embedding models for use.
 * Only applicable to local providers (transformersjs, ollama).
 *
 * @param options - Command options
 */
export async function providersSetupCommand(options: ProvidersSetupOptions): Promise<void> {
  const provider = normalizeProvider(options.provider);

  switch (provider) {
    case "transformersjs":
      await setupTransformersJs(options.model, options.force);
      break;
    case "ollama":
      await setupOllama(options.model);
      break;
    default:
      console.error(
        chalk.red(`Setup is not available for provider "${options.provider}".`) +
          "\n" +
          chalk.gray("Setup is only needed for local providers: transformersjs, ollama")
      );
      process.exit(1);
  }
}

/**
 * Normalize provider name to canonical form
 *
 * @param provider - Provider name or alias
 * @returns Canonical provider name
 */
function normalizeProvider(provider: string): string {
  const aliases: Record<string, string> = {
    transformersjs: "transformersjs",
    transformers: "transformersjs",
    local: "transformersjs",
    ollama: "ollama",
  };

  return aliases[provider.toLowerCase()] || provider.toLowerCase();
}

/**
 * Set up Transformers.js provider by downloading the model
 *
 * @param model - Optional custom model to download
 * @param force - Force re-download even if cached
 */
async function setupTransformersJs(model?: string, force?: boolean): Promise<void> {
  const modelPath = model || DEFAULT_TRANSFORMERSJS_MODEL;
  const startTime = Date.now();

  // Note: Force re-download is not yet implemented for Transformers.js
  // Model cache clearing would require access to the Hugging Face cache directory
  if (force) {
    console.log(
      chalk.yellow(
        "Note: --force flag is accepted but cache clearing is not yet implemented for Transformers.js"
      )
    );
  }

  const spinner = ora({
    text: `Setting up ${chalk.cyan("Transformers.js")} with model ${chalk.cyan(modelPath)}...`,
    color: "cyan",
  }).start();

  try {
    // Create provider with progress callback
    const provider = new TransformersJsEmbeddingProvider({
      provider: "transformersjs",
      model: modelPath,
      dimensions: DEFAULT_TRANSFORMERSJS_DIMENSIONS,
      batchSize: 32,
      maxRetries: 0,
      timeoutMs: MODEL_DOWNLOAD_TIMEOUT_MS,
      modelPath,
      onProgress: (progress: ModelDownloadProgress) => {
        if (progress.status === "download" && progress.file) {
          spinner.text = `Downloading ${chalk.cyan(progress.file)}...`;
        } else if (progress.status === "progress" && progress.progress !== undefined) {
          spinner.text = `Downloading model... ${chalk.cyan(`${progress.progress.toFixed(0)}%`)}`;
        } else if (progress.status === "done") {
          spinner.text = "Initializing model...";
        }
      },
    });

    // Trigger model download by calling healthCheck
    spinner.text = "Downloading and initializing model (this may take a few minutes)...";
    const isHealthy = await provider.healthCheck();

    if (!isHealthy) {
      throw new Error("Model initialization failed");
    }

    const duration = Date.now() - startTime;
    spinner.succeed(chalk.green("Setup complete!"));
    console.log(formatSetupSuccess("Transformers.js", modelPath, duration));
  } catch (error) {
    spinner.fail(chalk.red("Setup failed"));
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(formatSetupError("Transformers.js", errorMessage));
    process.exit(1);
  }
}

/**
 * Set up Ollama provider by verifying server connection
 *
 * Ollama models are managed by the Ollama server itself.
 * This command verifies connectivity and optionally pulls a model.
 *
 * @param model - Optional model to pull
 */
async function setupOllama(model?: string): Promise<void> {
  const modelName = model || DEFAULT_OLLAMA_MODEL;
  const startTime = Date.now();

  const baseUrl =
    Bun.env["OLLAMA_BASE_URL"] ||
    `http://${Bun.env["OLLAMA_HOST"] || "localhost"}:${Bun.env["OLLAMA_PORT"] || "11434"}`;

  const spinner = ora({
    text: `Setting up ${chalk.cyan("Ollama")} with model ${chalk.cyan(modelName)}...`,
    color: "cyan",
  }).start();

  try {
    // Check if Ollama server is running
    spinner.text = "Checking Ollama server...";
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });

    if (!tagsResponse.ok) {
      throw new Error(`Ollama server returned ${tagsResponse.status}`);
    }

    // Pull the model (Ollama handles caching)
    spinner.text = `Pulling model ${chalk.cyan(modelName)} (this may take several minutes)...`;

    const pullResponse = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(OLLAMA_PULL_TIMEOUT_MS),
    });

    if (!pullResponse.ok) {
      throw new Error(`Failed to pull model: ${pullResponse.status}`);
    }

    // Process streaming response
    if (pullResponse.body) {
      const reader = pullResponse.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (done) break;

        const text = decoder.decode(result.value as Uint8Array);
        const lines = text.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as {
              status?: string;
              completed?: number;
              total?: number;
            };
            if (data.status) {
              if (data.completed !== undefined && data.total !== undefined) {
                const percent = ((data.completed / data.total) * 100).toFixed(0);
                spinner.text = `${data.status} ${chalk.cyan(`${percent}%`)}`;
              } else {
                spinner.text = data.status;
              }
            }
          } catch {
            // Ignore parse errors for streaming responses
          }
        }
      }
    }

    // Verify the model works
    spinner.text = "Verifying model...";
    const provider = new OllamaEmbeddingProvider({
      provider: "ollama",
      model: modelName,
      dimensions: DEFAULT_OLLAMA_DIMENSIONS,
      batchSize: 32,
      maxRetries: 3,
      timeoutMs: PROVIDER_VERIFY_TIMEOUT_MS,
      modelName,
      baseUrl,
    });

    const isHealthy = await provider.healthCheck();
    if (!isHealthy) {
      throw new Error("Model verification failed");
    }

    const duration = Date.now() - startTime;
    spinner.succeed(chalk.green("Setup complete!"));
    console.log(formatSetupSuccess("Ollama", modelName, duration));
  } catch (error) {
    spinner.fail(chalk.red("Setup failed"));
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("fetch") ||
      errorMessage.includes("timeout")
    ) {
      console.log(
        formatSetupError(
          "Ollama",
          `Cannot connect to Ollama server at ${baseUrl}. Is Ollama running?`
        )
      );
    } else {
      console.log(formatSetupError("Ollama", errorMessage));
    }
    process.exit(1);
  }
}
