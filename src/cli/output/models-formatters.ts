/**
 * Models Output Formatters for CLI
 *
 * Functions for formatting model cache information as tables or JSON.
 *
 * @see Issue #165: Add model download and caching logic
 */

import Table from "cli-table3";
import chalk from "chalk";
import type {
  CachedModelInfo,
  CacheStatus,
  AggregatedCacheStatus,
  ModelValidationResult,
  ModelPathInfo,
  CacheClearResult,
  ModelImportResult,
} from "../../services/model-cache-types.js";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format bytes to human-readable size
 *
 * @param bytes - Size in bytes
 * @returns Formatted size string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Format date to relative time or ISO string
 *
 * @param date - Date to format
 * @returns Formatted date string
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? "just now" : `${diffMins}m ago`;
    }
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return "yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toISOString().split("T")[0] || date.toISOString();
  }
}

/**
 * Get validity indicator
 *
 * @param isValid - Whether the model is valid
 * @returns Colored validity indicator
 */
function getValidityIndicator(isValid: boolean): string {
  return isValid ? chalk.green("✓ Valid") : chalk.red("✗ Invalid");
}

/**
 * Get provider display name
 *
 * @param provider - Provider identifier
 * @returns Display name
 */
function getProviderName(provider: string): string {
  const names: Record<string, string> = {
    transformersjs: "Transformers.js",
    ollama: "Ollama",
  };
  return names[provider] || provider;
}

// ============================================================================
// Models List Formatting
// ============================================================================

/**
 * Create a formatted table of cached models
 *
 * @param models - Array of cached model info
 * @returns Formatted table string
 */
export function createModelsListTable(models: CachedModelInfo[]): string {
  if (models.length === 0) {
    return (
      chalk.yellow("\nNo cached models found.\n") +
      chalk.gray("Use 'pk-mcp providers setup <provider>' to download models.\n")
    );
  }

  const table = new Table({
    head: [
      chalk.cyan("Model"),
      chalk.cyan("Provider"),
      chalk.cyan("Size"),
      chalk.cyan("Status"),
      chalk.cyan("Downloaded"),
    ],
    colWidths: [35, 15, 12, 12, 15],
    wordWrap: true,
  });

  for (const model of models) {
    table.push([
      model.modelId,
      getProviderName(model.provider),
      formatBytes(model.sizeBytes),
      getValidityIndicator(model.isValid),
      formatDate(model.downloadedAt),
    ]);
  }

  const totalSize = models.reduce((sum, m) => sum + m.sizeBytes, 0);

  return (
    `\n${chalk.bold("Cached Models")}\n${table.toString()}\n` +
    chalk.gray(`Total: ${models.length} model(s), ${formatBytes(totalSize)}\n`)
  );
}

/**
 * Format models list as JSON
 *
 * @param models - Array of cached model info
 * @returns JSON string
 */
export function formatModelsJson(models: CachedModelInfo[]): string {
  return JSON.stringify(
    {
      models: models.map((m) => ({
        modelId: m.modelId,
        provider: m.provider,
        path: m.path,
        sizeBytes: m.sizeBytes,
        downloadedAt: m.downloadedAt.toISOString(),
        lastAccessedAt: m.lastAccessedAt?.toISOString(),
        isValid: m.isValid,
        metadata: m.metadata,
      })),
      summary: {
        totalModels: models.length,
        totalSizeBytes: models.reduce((sum, m) => sum + m.sizeBytes, 0),
      },
    },
    null,
    2
  );
}

// ============================================================================
// Cache Status Formatting
// ============================================================================

/**
 * Create a formatted table of cache status
 *
 * @param status - Cache status (single provider or aggregated)
 * @returns Formatted table string
 */
export function createCacheStatusTable(status: CacheStatus | AggregatedCacheStatus): string {
  // Check if this is aggregated status
  const isAggregated = "providers" in status;

  const table = new Table({
    head: [
      chalk.cyan("Provider"),
      chalk.cyan("Cache Directory"),
      chalk.cyan("Models"),
      chalk.cyan("Total Size"),
      chalk.cyan("Status"),
    ],
    colWidths: [15, 45, 10, 12, 12],
    wordWrap: true,
  });

  if (isAggregated) {
    const aggregated = status;
    for (const provider of aggregated.providers) {
      table.push([
        getProviderName(provider.provider),
        provider.cacheDir,
        provider.modelCount.toString(),
        formatBytes(provider.totalSizeBytes),
        provider.exists ? chalk.green("✓ OK") : chalk.yellow("○ Empty"),
      ]);
    }
  } else {
    const single = status;
    table.push([
      getProviderName(single.provider),
      single.cacheDir,
      single.modelCount.toString(),
      formatBytes(single.totalSizeBytes),
      single.exists ? chalk.green("✓ OK") : chalk.yellow("○ Empty"),
    ]);
  }

  let summary = "";
  if (isAggregated) {
    const aggregated = status;
    summary = chalk.gray(
      `\nTotal across all providers: ${aggregated.totalModelCount} model(s), ${formatBytes(aggregated.totalSizeBytes)}\n`
    );
  }

  return `\n${chalk.bold("Cache Status")}\n${table.toString()}${summary}`;
}

/**
 * Format cache status as JSON
 *
 * @param status - Cache status (single provider or aggregated)
 * @returns JSON string
 */
export function formatCacheStatusJson(status: CacheStatus | AggregatedCacheStatus): string {
  const isAggregated = "providers" in status;

  if (isAggregated) {
    const aggregated = status;
    return JSON.stringify(
      {
        totalSizeBytes: aggregated.totalSizeBytes,
        totalModelCount: aggregated.totalModelCount,
        providers: aggregated.providers.map((p) => ({
          provider: p.provider,
          cacheDir: p.cacheDir,
          exists: p.exists,
          totalSizeBytes: p.totalSizeBytes,
          modelCount: p.modelCount,
          models: p.models.map((m) => ({
            modelId: m.modelId,
            sizeBytes: m.sizeBytes,
            isValid: m.isValid,
          })),
        })),
      },
      null,
      2
    );
  }

  const single = status;
  return JSON.stringify(
    {
      provider: single.provider,
      cacheDir: single.cacheDir,
      exists: single.exists,
      totalSizeBytes: single.totalSizeBytes,
      modelCount: single.modelCount,
      models: single.models.map((m) => ({
        modelId: m.modelId,
        sizeBytes: m.sizeBytes,
        isValid: m.isValid,
      })),
    },
    null,
    2
  );
}

// ============================================================================
// Validation Result Formatting
// ============================================================================

/**
 * Create a formatted table of validation results
 *
 * @param results - Array of validation results
 * @returns Formatted table string
 */
export function createValidationResultTable(results: ModelValidationResult[]): string {
  if (results.length === 0) {
    return chalk.yellow("\nNo models to validate.\n");
  }

  const table = new Table({
    head: [chalk.cyan("Model"), chalk.cyan("Provider"), chalk.cyan("Status"), chalk.cyan("Issues")],
    colWidths: [35, 15, 12, 30],
    wordWrap: true,
  });

  for (const result of results) {
    const issues = result.issues?.join(", ") || "-";
    table.push([
      result.modelId,
      getProviderName(result.provider),
      result.valid ? chalk.green("✓ Valid") : chalk.red("✗ Invalid"),
      result.valid ? chalk.gray("-") : chalk.yellow(issues),
    ]);
  }

  const validCount = results.filter((r) => r.valid).length;
  const invalidCount = results.length - validCount;

  let summary = chalk.gray(`\nValidated: ${results.length} model(s) - `);
  if (invalidCount === 0) {
    summary += chalk.green(`All valid`);
  } else {
    summary += chalk.green(`${validCount} valid`) + ", " + chalk.red(`${invalidCount} invalid`);
  }

  return `\n${chalk.bold("Validation Results")}\n${table.toString()}${summary}\n`;
}

/**
 * Format validation results as JSON
 *
 * @param results - Array of validation results
 * @returns JSON string
 */
export function formatValidationJson(results: ModelValidationResult[]): string {
  return JSON.stringify(
    {
      results: results.map((r) => ({
        modelId: r.modelId,
        provider: r.provider,
        valid: r.valid,
        issues: r.issues,
        validatedAt: r.validatedAt.toISOString(),
        checks: r.checks,
      })),
      summary: {
        total: results.length,
        valid: results.filter((r) => r.valid).length,
        invalid: results.filter((r) => !r.valid).length,
      },
    },
    null,
    2
  );
}

// ============================================================================
// Model Path Formatting
// ============================================================================

/**
 * Create a formatted display of model path information
 *
 * @param pathInfo - Model path information
 * @returns Formatted string
 */
export function createModelPathTable(pathInfo: ModelPathInfo): string {
  const output = [
    "",
    chalk.bold("Model Placement Information"),
    "",
    chalk.gray("Provider:") + `         ${getProviderName(pathInfo.provider)}`,
    chalk.gray("Model ID:") + `         ${pathInfo.modelId}`,
    chalk.gray("Cache Directory:") + `  ${pathInfo.cacheDir}`,
    chalk.gray("Model Path:") + `       ${chalk.cyan(pathInfo.modelPath)}`,
    "",
    chalk.bold("Expected Structure:"),
  ];

  for (const item of pathInfo.expectedStructure) {
    output.push(`  ${chalk.gray("•")} ${item}`);
  }

  output.push("");
  output.push(chalk.bold("Required Files:"));
  for (const file of pathInfo.requiredFiles) {
    output.push(`  ${chalk.gray("•")} ${file}`);
  }

  output.push("");

  if (pathInfo.provider === "transformersjs") {
    output.push(chalk.gray("To manually install a model:"));
    output.push(chalk.gray("1. Download the model files from HuggingFace"));
    output.push(chalk.gray(`2. Place them in: ${pathInfo.modelPath}`));
    output.push(chalk.gray("3. Run 'pk-mcp models validate' to verify"));
  } else if (pathInfo.provider === "ollama") {
    output.push(chalk.gray("For Ollama models, use:"));
    output.push(chalk.cyan("  ollama create <name> -f Modelfile"));
    output.push(chalk.gray("See: https://ollama.com/docs/importing"));
  }

  output.push("");

  return output.join("\n");
}

// ============================================================================
// Clear Result Formatting
// ============================================================================

/**
 * Format clear operation result
 *
 * @param result - Clear result
 * @returns Formatted string
 */
export function formatClearResult(result: CacheClearResult): string {
  if (result.dryRun) {
    return (
      chalk.yellow("\n[Dry run] Would have cleared:\n") +
      `  Models: ${result.modelsCleared}\n` +
      `  Space freed: ${formatBytes(result.bytesFreed)}\n`
    );
  }

  if (result.modelsCleared === 0) {
    return chalk.gray("\nNo models were cleared.\n");
  }

  return (
    `\n${chalk.green("✓")} Cleared ${result.modelsCleared} model(s)\n` +
    `  Space freed: ${formatBytes(result.bytesFreed)}\n` +
    chalk.gray(`  Models: ${result.clearedModels.join(", ")}\n`)
  );
}

// ============================================================================
// Import Result Formatting
// ============================================================================

/**
 * Format import operation result
 *
 * @param result - Import result
 * @returns Formatted string
 */
export function formatImportResult(result: ModelImportResult): string {
  if (!result.success) {
    return chalk.red(`\n✗ Import failed: ${result.error}\n`);
  }

  const output = ["", chalk.green("✓") + " Model imported successfully", ""];

  if (result.model) {
    output.push(chalk.gray("Model ID:") + `     ${result.model.modelId}`);
    output.push(chalk.gray("Provider:") + `     ${getProviderName(result.model.provider)}`);
    output.push(chalk.gray("Path:") + `         ${result.model.path}`);
    output.push(chalk.gray("Size:") + `         ${formatBytes(result.model.sizeBytes)}`);
  }

  if (result.filesCopied !== undefined) {
    output.push(chalk.gray("Files copied:") + ` ${result.filesCopied}`);
  }

  if (result.bytesCopied !== undefined) {
    output.push(chalk.gray("Bytes copied:") + ` ${formatBytes(result.bytesCopied)}`);
  }

  output.push("");

  return output.join("\n");
}
