/**
 * Models Commands - Manage embedding model cache
 *
 * Commands for managing cached embedding models:
 * - list: List all cached models
 * - status: Show cache status and disk usage
 * - validate: Validate cached model integrity
 * - clear: Clear cached models
 * - path: Show path for manual model placement
 * - import: Import model from local files (air-gapped)
 *
 * @see Issue #165: Add model download and caching logic
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import { createInterface } from "node:readline";
import { createModelCacheService } from "../../services/model-cache-service.js";
import type {
  CacheableProvider,
  CacheClearOptions,
  ModelImportOptions,
} from "../../services/model-cache-types.js";
import {
  ModelNotFoundError,
  ProviderNotAvailableError,
} from "../../services/model-cache-errors.js";
import {
  createModelsListTable,
  createCacheStatusTable,
  createValidationResultTable,
  createModelPathTable,
  formatModelsJson,
  formatCacheStatusJson,
  formatValidationJson,
  formatClearResult,
  formatImportResult,
  formatBytes,
} from "../output/models-formatters.js";

// ============================================================================
// Command Option Types
// ============================================================================

/**
 * Options for models list command
 */
export interface ModelsListOptions {
  /** Filter to specific provider */
  provider?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Options for models status command
 */
export interface ModelsStatusOptions {
  /** Filter to specific provider */
  provider?: string;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Options for models validate command
 */
export interface ModelsValidateOptions {
  /** Provider for the model */
  provider?: string;
  /** Attempt to fix invalid models by re-downloading */
  fix?: boolean;
  /** Output as JSON */
  json?: boolean;
}

/**
 * Options for models clear command
 */
export interface ModelsClearOptions {
  /** Provider for the model */
  provider?: string;
  /** Skip confirmation prompt */
  force?: boolean;
  /** Show what would be cleared without actually clearing */
  dryRun?: boolean;
}

/**
 * Options for models path command
 */
export interface ModelsPathOptions {
  /** Provider for the model */
  provider?: string;
}

/**
 * Options for models import command
 */
export interface ModelsImportOptions {
  /** Provider for the model */
  provider: string;
  /** Model identifier */
  modelId: string;
  /** Validate after import */
  validate?: boolean;
  /** Overwrite existing */
  overwrite?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize provider name to canonical form
 *
 * @param provider - Provider name or alias
 * @returns Canonical provider name or undefined
 */
function normalizeProvider(provider?: string): CacheableProvider | undefined {
  if (!provider) return undefined;

  const aliases: Record<string, CacheableProvider> = {
    transformersjs: "transformersjs",
    transformers: "transformersjs",
    local: "transformersjs",
    ollama: "ollama",
  };

  return aliases[provider.toLowerCase()];
}

/**
 * Confirm action with user
 *
 * @param message - Confirmation message
 * @returns True if user confirms
 */
async function confirmAction(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ============================================================================
// Models List Command
// ============================================================================

/**
 * Execute models list command
 *
 * Lists all cached embedding models with their status.
 *
 * @param options - Command options
 */
export async function modelsListCommand(options: ModelsListOptions): Promise<void> {
  const spinner = ora({
    text: "Scanning model cache...",
    color: "cyan",
  }).start();

  try {
    const service = createModelCacheService();
    const provider = normalizeProvider(options.provider);

    const models = await service.listCachedModels(provider);

    spinner.stop();

    if (options.json) {
      console.log(formatModelsJson(models));
    } else {
      console.log(createModelsListTable(models));
    }
  } catch (error) {
    spinner.fail(chalk.red("Failed to list models"));
    if (error instanceof ProviderNotAvailableError) {
      console.error(chalk.yellow(`\nProvider not available: ${error.message}`));
      if (error.provider === "ollama") {
        console.error(chalk.gray("Ensure Ollama is running: ollama serve"));
      }
    } else {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
    process.exit(1);
  }
}

// ============================================================================
// Models Status Command
// ============================================================================

/**
 * Execute models status command
 *
 * Shows cache status including directories and disk usage.
 *
 * @param options - Command options
 */
export async function modelsStatusCommand(options: ModelsStatusOptions): Promise<void> {
  const spinner = ora({
    text: "Getting cache status...",
    color: "cyan",
  }).start();

  try {
    const service = createModelCacheService();
    const provider = normalizeProvider(options.provider);

    let status;
    if (provider) {
      status = await service.getCacheStatus(provider);
    } else {
      status = await service.getAggregatedCacheStatus();
    }

    spinner.stop();

    if (options.json) {
      console.log(formatCacheStatusJson(status));
    } else {
      console.log(createCacheStatusTable(status));
    }
  } catch (error) {
    spinner.fail(chalk.red("Failed to get cache status"));
    if (error instanceof ProviderNotAvailableError) {
      console.error(chalk.yellow(`\nProvider not available: ${error.message}`));
    } else {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
    process.exit(1);
  }
}

// ============================================================================
// Models Validate Command
// ============================================================================

/**
 * Execute models validate command
 *
 * Validates cached model integrity.
 *
 * @param modelId - Optional model ID to validate (all if not specified)
 * @param options - Command options
 */
export async function modelsValidateCommand(
  modelId: string | undefined,
  options: ModelsValidateOptions
): Promise<void> {
  const spinner = ora({
    text: "Validating models...",
    color: "cyan",
  }).start();

  try {
    const service = createModelCacheService();
    const provider = normalizeProvider(options.provider);

    // Get models to validate
    const models = await service.listCachedModels(provider);

    if (modelId) {
      // Validate specific model
      const model = models.find((m) => m.modelId === modelId);
      if (!model) {
        spinner.fail(chalk.red(`Model "${modelId}" not found in cache`));
        process.exit(1);
      }

      spinner.text = `Validating ${modelId}...`;
      const result = await service.validateCachedModel(model.provider, modelId);

      spinner.stop();

      if (options.json) {
        console.log(formatValidationJson([result]));
      } else {
        console.log(createValidationResultTable([result]));
      }

      // Attempt fix if requested
      if (!result.valid && options.fix) {
        console.log(chalk.yellow("\nAttempting to fix by re-downloading..."));
        const downloadSpinner = ora("Downloading model...").start();
        try {
          await service.downloadModel(model.provider, modelId, {
            force: true,
            validateAfterDownload: true,
          });
          downloadSpinner.succeed(chalk.green("Model re-downloaded and validated"));
        } catch (downloadError) {
          downloadSpinner.fail(chalk.red("Failed to re-download model"));
          console.error(
            chalk.red(
              downloadError instanceof Error ? downloadError.message : String(downloadError)
            )
          );
        }
      }
    } else {
      // Validate all models
      const results = [];
      for (const model of models) {
        spinner.text = `Validating ${model.modelId}...`;
        const result = await service.validateCachedModel(model.provider, model.modelId);
        results.push(result);
      }

      spinner.stop();

      if (options.json) {
        console.log(formatValidationJson(results));
      } else {
        console.log(createValidationResultTable(results));
      }

      // Summary
      const invalidCount = results.filter((r) => !r.valid).length;
      if (invalidCount > 0 && !options.json) {
        console.log(
          chalk.yellow(`\n${invalidCount} model(s) failed validation.`) +
            chalk.gray(" Use --fix to attempt re-download.")
        );
      }
    }
  } catch (error) {
    spinner.fail(chalk.red("Failed to validate models"));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

// ============================================================================
// Models Clear Command
// ============================================================================

/**
 * Execute models clear command
 *
 * Clears cached models.
 *
 * @param modelId - Optional model ID to clear (all if not specified)
 * @param options - Command options
 */
export async function modelsClearCommand(
  modelId: string | undefined,
  options: ModelsClearOptions
): Promise<void> {
  const service = createModelCacheService();
  const provider = normalizeProvider(options.provider);

  // Get models to clear
  const models = await service.listCachedModels(provider);

  if (models.length === 0) {
    console.log(chalk.yellow("No cached models to clear."));
    return;
  }

  // Determine what will be cleared
  let modelsToShow = models;
  if (modelId) {
    modelsToShow = models.filter((m) => m.modelId === modelId);
    if (modelsToShow.length === 0) {
      console.log(chalk.yellow(`Model "${modelId}" not found in cache.`));
      return;
    }
  }

  // Calculate total size
  const totalSize = modelsToShow.reduce((sum, m) => sum + m.sizeBytes, 0);

  // Show what will be cleared
  console.log(chalk.bold("\nModels to clear:"));
  for (const model of modelsToShow) {
    console.log(
      `  ${chalk.cyan(model.modelId)} (${chalk.gray(model.provider)}) - ${formatBytes(model.sizeBytes)}`
    );
  }
  console.log(chalk.bold(`\nTotal: ${formatBytes(totalSize)}`));

  // Dry run check
  if (options.dryRun) {
    console.log(chalk.yellow("\n[Dry run] No models were actually cleared."));
    return;
  }

  // Confirm unless force
  if (!options.force) {
    const confirmed = await confirmAction("\nAre you sure you want to clear these models?");
    if (!confirmed) {
      console.log(chalk.gray("Cancelled."));
      return;
    }
  }

  // Clear models
  const spinner = ora("Clearing models...").start();

  try {
    let result;
    if (modelId && provider) {
      result = await service.clearModel(provider, modelId);
    } else if (modelId) {
      // Find the provider for this model
      const model = modelsToShow[0];
      if (!model) {
        throw new ModelNotFoundError("unknown" as CacheableProvider, modelId);
      }
      result = await service.clearModel(model.provider, modelId);
    } else {
      const clearOptions: CacheClearOptions = { provider };
      result = await service.clearAllCache(clearOptions);
    }

    spinner.succeed(chalk.green("Models cleared"));
    console.log(formatClearResult(result));
  } catch (error) {
    spinner.fail(chalk.red("Failed to clear models"));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

// ============================================================================
// Models Path Command
// ============================================================================

/**
 * Execute models path command
 *
 * Shows the path where a model should be placed for manual installation.
 *
 * @param modelId - Model identifier
 * @param options - Command options
 */
export function modelsPathCommand(modelId: string, options: ModelsPathOptions): void {
  const service = createModelCacheService();
  const provider = normalizeProvider(options.provider) || "transformersjs";

  const pathInfo = service.getModelPath(provider, modelId);

  console.log(createModelPathTable(pathInfo));
}

// ============================================================================
// Models Import Command
// ============================================================================

/**
 * Execute models import command
 *
 * Imports a model from local files for air-gapped installations.
 *
 * @param sourcePath - Source path containing model files
 * @param options - Command options
 */
export async function modelsImportCommand(
  sourcePath: string,
  options: ModelsImportOptions
): Promise<void> {
  const provider = normalizeProvider(options.provider);
  if (!provider) {
    console.error(
      chalk.red(`Invalid provider: ${options.provider}. Use "transformersjs" or "ollama".`)
    );
    process.exit(1);
  }

  const spinner = ora({
    text: `Importing model from ${sourcePath}...`,
    color: "cyan",
  }).start();

  try {
    const service = createModelCacheService();

    const importOptions: ModelImportOptions = {
      sourcePath,
      provider,
      modelId: options.modelId,
      validate: options.validate,
      overwrite: options.overwrite,
    };

    const result = await service.importModel(importOptions);

    spinner.succeed(chalk.green("Model imported"));
    console.log(formatImportResult(result));
  } catch (error) {
    spinner.fail(chalk.red("Failed to import model"));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
