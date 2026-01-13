/**
 * Provider Output Formatters for CLI
 *
 * Functions for formatting provider information as tables or JSON.
 */

import Table from "cli-table3";
import chalk from "chalk";
import type { RepositoryInfo } from "../../repositories/types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Provider status values
 */
export type ProviderStatus = "ready" | "not-configured" | "not-available";

/**
 * Display information for a provider in the status output
 */
export interface ProviderDisplayInfo {
  /** Provider identifier */
  id: string;
  /** Display name */
  name: string;
  /** Provider description */
  description: string;
  /** Current status */
  status: ProviderStatus;
  /** Default model name */
  model?: string;
  /** Embedding dimensions */
  dimensions?: number;
  /** Whether this is the default provider */
  isDefault: boolean;
  /** Optional status message */
  statusMessage?: string;
}

/**
 * Repository provider usage information
 */
export interface RepositoryProviderUsage {
  /** Repository name */
  name: string;
  /** Embedding provider used */
  provider: string;
  /** Embedding model used */
  model?: string;
  /** Embedding dimensions */
  dimensions?: number;
  /** Number of chunks indexed */
  chunkCount: number;
}

// ============================================================================
// Provider Status Formatting
// ============================================================================

/**
 * Get colored status indicator
 *
 * @param status - Provider status
 * @returns Colored status string
 */
function getStatusIndicator(status: ProviderStatus): string {
  switch (status) {
    case "ready":
      return chalk.green("✓ Ready");
    case "not-configured":
      return chalk.yellow("○ Not Configured");
    case "not-available":
      return chalk.red("✗ Not Available");
  }
}

/**
 * Create a formatted table of provider status
 *
 * @param providers - Array of provider display info
 * @returns Formatted table string
 */
export function createProvidersTable(providers: ProviderDisplayInfo[]): string {
  if (providers.length === 0) {
    return chalk.yellow("\nNo providers configured\n");
  }

  const table = new Table({
    head: [
      chalk.cyan("Provider"),
      chalk.cyan("Status"),
      chalk.cyan("Model"),
      chalk.cyan("Dimensions"),
      chalk.cyan("Default"),
    ],
    colWidths: [20, 20, 30, 12, 10],
    wordWrap: true,
  });

  for (const provider of providers) {
    table.push([
      provider.name,
      getStatusIndicator(provider.status),
      provider.model || chalk.gray("-"),
      provider.dimensions?.toString() || chalk.gray("-"),
      provider.isDefault ? chalk.green("✓") : "",
    ]);
  }

  return `\n${chalk.bold("Embedding Providers")}\n${table.toString()}\n`;
}

/**
 * Create a formatted table of repository provider usage
 *
 * @param repositories - Array of repository provider usage info
 * @returns Formatted table string
 */
export function createRepositoryProviderTable(repositories: RepositoryProviderUsage[]): string {
  if (repositories.length === 0) {
    return chalk.gray("\nNo repositories indexed\n");
  }

  const table = new Table({
    head: [
      chalk.cyan("Repository"),
      chalk.cyan("Provider"),
      chalk.cyan("Model"),
      chalk.cyan("Dimensions"),
      chalk.cyan("Chunks"),
    ],
    colWidths: [25, 15, 25, 12, 10],
    wordWrap: true,
  });

  for (const repo of repositories) {
    table.push([
      repo.name,
      repo.provider,
      repo.model || chalk.gray("-"),
      repo.dimensions?.toString() || chalk.gray("-"),
      repo.chunkCount.toLocaleString(),
    ]);
  }

  return `\n${chalk.bold("Repository Provider Usage")}\n${table.toString()}\n`;
}

// ============================================================================
// JSON Formatting
// ============================================================================

/**
 * Format providers and repository usage as JSON
 *
 * @param providers - Array of provider display info
 * @param repositories - Array of repository provider usage
 * @returns JSON string
 */
export function formatProvidersJson(
  providers: ProviderDisplayInfo[],
  repositories: RepositoryProviderUsage[]
): string {
  const readyCount = providers.filter((p) => p.status === "ready").length;

  const output = {
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      model: p.model,
      dimensions: p.dimensions,
      isDefault: p.isDefault,
      statusMessage: p.statusMessage,
    })),
    repositories: repositories.map((r) => ({
      name: r.name,
      provider: r.provider,
      model: r.model,
      dimensions: r.dimensions,
      chunkCount: r.chunkCount,
    })),
    summary: {
      totalProviders: providers.length,
      readyProviders: readyCount,
      totalRepositories: repositories.length,
    },
  };

  return JSON.stringify(output, null, 2);
}

// ============================================================================
// Repository Provider Extraction
// ============================================================================

/**
 * Extract provider usage information from repositories
 *
 * @param repositories - Array of repository info
 * @returns Array of repository provider usage
 */
export function extractRepositoryProviderUsage(
  repositories: RepositoryInfo[]
): RepositoryProviderUsage[] {
  return repositories.map((repo) => ({
    name: repo.name,
    provider: repo.embeddingProvider || "openai",
    model: repo.embeddingModel,
    dimensions: repo.embeddingDimensions,
    chunkCount: repo.chunkCount,
  }));
}

// ============================================================================
// Setup Output Formatting
// ============================================================================

/**
 * Format setup success message
 *
 * @param provider - Provider name
 * @param model - Model name
 * @param durationMs - Duration in milliseconds
 * @returns Formatted success message
 */
export function formatSetupSuccess(provider: string, model: string, durationMs: number): string {
  const seconds = (durationMs / 1000).toFixed(1);
  return `
${chalk.green("✓")} ${chalk.bold(provider)} is ready to use

  ${chalk.gray("Model:")}     ${model}
  ${chalk.gray("Duration:")}  ${seconds}s

${chalk.gray("You can now index repositories using this provider with:")}
  ${chalk.cyan(`pk-mcp index <url> --provider ${provider.toLowerCase().replace(/\s+/g, "")}`)}
`;
}

/**
 * Format setup error message
 *
 * @param provider - Provider name
 * @param error - Error message
 * @returns Formatted error message
 */
export function formatSetupError(provider: string, error: string): string {
  return `
${chalk.red("✗")} Failed to set up ${chalk.bold(provider)}

  ${chalk.red("Error:")} ${error}

${chalk.gray("Troubleshooting:")}
  ${provider === "Ollama" ? chalk.gray("• Ensure Ollama is installed and running: ollama serve") : ""}
  ${provider === "Ollama" ? chalk.gray("• Check Ollama is accessible at the configured URL") : ""}
  ${provider === "Transformers.js" ? chalk.gray("• Check your internet connection for model download") : ""}
  ${provider === "Transformers.js" ? chalk.gray("• Verify the model name is correct") : ""}
`;
}
