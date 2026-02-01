/**
 * Graph Populate All Command - Populate knowledge graph for all indexed repositories
 *
 * Iterates through all indexed repositories with status "ready" and populates
 * their knowledge graphs. Continues on individual repository failures
 * and provides a summary report on completion.
 *
 * @example
 * ```bash
 * # Populate graph for all repositories
 * pk-mcp graph populate-all
 *
 * # Force repopulate (delete existing graph data)
 * pk-mcp graph populate-all --force
 *
 * # JSON output
 * pk-mcp graph populate-all --json
 * ```
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { stat } from "fs/promises";
import {
  createGraphAdapter,
  type GraphStorageAdapter,
  type GraphStorageConfig,
} from "../../graph/adapters/index.js";
import { GraphIngestionService } from "../../graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../graph/extraction/RelationshipExtractor.js";
import { RepositoryExistsError } from "../../graph/ingestion/errors.js";
import type { GraphIngestionProgress, GraphIngestionStats } from "../../graph/ingestion/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../repositories/types.js";
import type { ValidatedGraphPopulateAllOptions } from "../utils/validation.js";
import { getFalkorDBConfig } from "../utils/falkordb-config.js";
import {
  SUPPORTED_EXTENSIONS,
  scanDirectory,
  formatDuration,
  formatPhase,
} from "../utils/file-scanner.js";

/**
 * Result of populating a single repository.
 */
export interface GraphPopulateAllResult {
  /**
   * Repository name.
   */
  repository: string;

  /**
   * Status of the population operation.
   */
  status: "success" | "partial" | "skipped" | "failed";

  /**
   * Statistics from the ingestion process (if successful or partial).
   */
  stats?: GraphIngestionStats;

  /**
   * Error message (if skipped or failed).
   */
  error?: string;

  /**
   * Duration in milliseconds.
   */
  durationMs?: number;
}

/**
 * Create summary table for populate-all results.
 */
function createPopulateAllTable(results: GraphPopulateAllResult[]): InstanceType<typeof Table> {
  const table = new Table({
    head: [
      chalk.bold("Repository"),
      chalk.bold("Status"),
      chalk.bold("Nodes"),
      chalk.bold("Relationships"),
      chalk.bold("Duration"),
    ],
    colWidths: [25, 12, 10, 16, 12],
  });

  for (const result of results) {
    if (result.status === "success") {
      table.push([
        result.repository,
        chalk.green("Success"),
        chalk.cyan(result.stats?.nodesCreated?.toString() ?? "-"),
        chalk.cyan(result.stats?.relationshipsCreated?.toString() ?? "-"),
        formatDuration(result.durationMs ?? 0),
      ]);
    } else if (result.status === "partial") {
      table.push([
        result.repository,
        chalk.yellow("Partial"),
        chalk.cyan(result.stats?.nodesCreated?.toString() ?? "-"),
        chalk.cyan(result.stats?.relationshipsCreated?.toString() ?? "-"),
        formatDuration(result.durationMs ?? 0),
      ]);
    } else if (result.status === "skipped") {
      table.push([
        result.repository,
        chalk.gray("Skipped"),
        chalk.gray("-"),
        chalk.gray("-"),
        chalk.gray("-"),
      ]);
    } else {
      table.push([
        result.repository,
        chalk.red("Failed"),
        chalk.gray("-"),
        chalk.gray("-"),
        chalk.gray("-"),
      ]);
    }
  }

  return table;
}

/**
 * Create JSON output for populate-all results.
 */
function createJsonOutput(results: GraphPopulateAllResult[]): object {
  const summary = {
    total: results.length,
    success: results.filter((r) => r.status === "success").length,
    partial: results.filter((r) => r.status === "partial").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  return {
    summary,
    results: results.map((r) => ({
      repository: r.repository,
      status: r.status,
      stats: r.stats,
      error: r.error,
      durationMs: r.durationMs,
    })),
  };
}

/**
 * Validate repository is eligible for graph population.
 *
 * @param repo - Repository info
 * @returns Error message if not eligible, undefined if eligible
 */
async function validateRepository(repo: RepositoryInfo): Promise<string | undefined> {
  if (!repo.localPath) {
    return "No local clone available";
  }

  try {
    await stat(repo.localPath);
  } catch {
    return `Local path not found: ${repo.localPath}`;
  }

  return undefined;
}

/**
 * Execute graph populate-all command
 *
 * Populates the FalkorDB knowledge graph for all indexed repositories
 * with status "ready".
 *
 * @param options - Command options
 * @param repositoryService - Repository metadata service
 */
export async function graphPopulateAllCommand(
  options: ValidatedGraphPopulateAllOptions,
  repositoryService: RepositoryMetadataService
): Promise<void> {
  const { force = false, json = false } = options;

  // Step 1: Get graph config (fail early if not configured)
  let config: GraphStorageConfig;
  try {
    config = getFalkorDBConfig();
  } catch (error) {
    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error(chalk.red("\n" + (error instanceof Error ? error.message : String(error))));
      console.error("\n" + chalk.bold("Next steps:"));
      console.error("  • Set FALKORDB_PASSWORD in your .env file");
      console.error("  • Or export FALKORDB_PASSWORD in your shell");
    }
    return;
  }

  // Step 2: Get all repositories with status "ready"
  const allRepos = await repositoryService.listRepositories();
  const readyRepos = allRepos.filter((repo) => repo.status === "ready");

  if (readyRepos.length === 0) {
    if (json) {
      console.log(JSON.stringify({ summary: { total: 0 }, results: [] }));
    } else {
      console.log(chalk.yellow("No repositories with status 'ready' found"));
      console.log("\n" + chalk.bold("Next steps:"));
      console.log("  • Check repository status: " + chalk.gray("pk-mcp status"));
      console.log("  • Index a repository: " + chalk.gray("pk-mcp index <url>"));
    }
    return;
  }

  if (!json) {
    console.log(chalk.bold(`\nPopulating ${readyRepos.length} repositories...\n`));
  }

  // Step 3: Connect to graph database (once for all repositories)
  let adapter: GraphStorageAdapter | null = null;
  const results: GraphPopulateAllResult[] = [];

  try {
    if (!json) {
      const connectSpinner = ora({
        text: "Connecting to graph database...",
        spinner: "dots",
      }).start();

      adapter = createGraphAdapter("falkordb", config);
      await adapter.connect();

      connectSpinner.succeed("Connected to graph database");
      console.log();
    } else {
      adapter = createGraphAdapter("falkordb", config);
      await adapter.connect();
    }

    // Step 4: Create shared extractors and ingestion service
    const entityExtractor = new EntityExtractor();
    const relationshipExtractor = new RelationshipExtractor();
    const ingestionService = new GraphIngestionService(
      adapter,
      entityExtractor,
      relationshipExtractor
    );

    // Step 5: Process each repository sequentially
    for (const repo of readyRepos) {
      const startTime = Date.now();
      const spinner = ora({
        text: `Populating ${chalk.cyan(repo.name)}...`,
        spinner: "dots",
      });

      if (!json) {
        spinner.start();
      }

      try {
        // Validate repository
        const validationError = await validateRepository(repo);
        if (validationError) {
          if (!json) {
            spinner.fail(`${repo.name}: ${validationError}`);
          }
          results.push({
            repository: repo.name,
            status: "failed",
            error: validationError,
          });
          continue;
        }

        // Scan files
        const skippedFiles: string[] = [];
        const files = await scanDirectory(repo.localPath, repo.localPath, skippedFiles);

        if (files.length === 0) {
          const noFilesError = `No supported files found (supported: ${Array.from(SUPPORTED_EXTENSIONS).join(", ")})`;
          if (!json) {
            spinner.warn(`${repo.name}: ${noFilesError}`);
          }
          results.push({
            repository: repo.name,
            status: "skipped",
            error: noFilesError,
          });
          continue;
        }

        // Progress callback
        let lastPhase = "";
        const onProgress = (progress: GraphIngestionProgress): void => {
          if (!json && progress.phase !== lastPhase) {
            lastPhase = progress.phase;
            const phaseText = formatPhase(progress.phase);
            spinner.text = `${repo.name}: ${phaseText} (${progress.percentage}%)`;
          }
        };

        // Ingest files
        const result = await ingestionService.ingestFiles(files, {
          repository: repo.name,
          repositoryUrl: repo.url,
          force,
          onProgress,
        });

        const durationMs = Date.now() - startTime;

        // Record result
        if (result.status === "success") {
          if (!json) {
            spinner.succeed(
              `${repo.name}: ${result.stats.nodesCreated} nodes, ${result.stats.relationshipsCreated} relationships`
            );
          }
          results.push({
            repository: repo.name,
            status: "success",
            stats: result.stats,
            durationMs,
          });
        } else if (result.status === "partial") {
          if (!json) {
            spinner.warn(
              `${repo.name}: ${result.stats.nodesCreated} nodes (${result.errors.length} errors)`
            );
          }
          results.push({
            repository: repo.name,
            status: "partial",
            stats: result.stats,
            durationMs,
          });
        } else {
          if (!json) {
            spinner.fail(`${repo.name}: Ingestion failed`);
          }
          results.push({
            repository: repo.name,
            status: "failed",
            error: result.errors[0]?.message ?? "Unknown error",
            durationMs,
          });
        }
      } catch (error) {
        const durationMs = Date.now() - startTime;

        // Handle RepositoryExistsError specially
        if (error instanceof RepositoryExistsError && !force) {
          if (!json) {
            spinner.warn(`${repo.name}: Already has graph data (use --force to repopulate)`);
          }
          results.push({
            repository: repo.name,
            status: "skipped",
            error: "Already has graph data",
            durationMs,
          });
        } else {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (!json) {
            spinner.fail(`${repo.name}: ${errorMessage}`);
          }
          results.push({
            repository: repo.name,
            status: "failed",
            error: errorMessage,
            durationMs,
          });
        }
        // Continue to next repository
      }
    }
  } finally {
    // Step 6: Disconnect from graph database
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
    }
  }

  // Step 7: Display summary
  if (json) {
    console.log(JSON.stringify(createJsonOutput(results), null, 2));
  } else {
    console.log();
    console.log(createPopulateAllTable(results).toString());
    console.log();

    // Summary line
    const success = results.filter((r) => r.status === "success").length;
    const partial = results.filter((r) => r.status === "partial").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;

    const summaryParts: string[] = [];
    if (success > 0) summaryParts.push(chalk.green(`${success} populated`));
    if (partial > 0) summaryParts.push(chalk.yellow(`${partial} partial`));
    if (skipped > 0) summaryParts.push(chalk.gray(`${skipped} skipped`));
    if (failed > 0) summaryParts.push(chalk.red(`${failed} failed`));

    console.log(chalk.bold("Summary: ") + summaryParts.join(", "));
  }
}
