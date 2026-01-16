/**
 * Graph Populate All Command - Populate Neo4j knowledge graph for all indexed repositories
 *
 * Iterates through all indexed repositories with status "ready" and populates
 * their Neo4j knowledge graphs. Continues on individual repository failures
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
import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";
import { Neo4jStorageClientImpl } from "../../graph/Neo4jClient.js";
import { GraphIngestionService } from "../../graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../graph/extraction/RelationshipExtractor.js";
import { RepositoryExistsError } from "../../graph/ingestion/errors.js";
import type { Neo4jConfig } from "../../graph/types.js";
import type {
  FileInput,
  GraphIngestionProgress,
  GraphIngestionStats,
} from "../../graph/ingestion/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../repositories/types.js";
import type { ValidatedGraphPopulateAllOptions } from "../utils/validation.js";
import { getNeo4jConfig } from "../utils/neo4j-config.js";

/**
 * Supported file extensions for graph population.
 *
 * These are extensions supported by tree-sitter parsing.
 */
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Directories to exclude from file scanning.
 */
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "out",
  "__pycache__",
]);

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
 * Recursively scan directory for supported files.
 *
 * @param dirPath - Directory to scan
 * @param basePath - Base path for relative path calculation
 * @param skippedFiles - Array to accumulate skipped file paths (mutated)
 * @returns Array of FileInput objects
 */
async function scanDirectory(
  dirPath: string,
  basePath: string,
  skippedFiles: string[] = []
): Promise<FileInput[]> {
  const files: FileInput[] = [];

  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        const subFiles = await scanDirectory(fullPath, basePath, skippedFiles);
        files.push(...subFiles);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        try {
          const content = await readFile(fullPath, "utf-8");
          const relativePath = fullPath.substring(basePath.length + 1).replace(/\\/g, "/");
          files.push({
            path: relativePath,
            content,
          });
        } catch {
          const relativePath = fullPath.substring(basePath.length + 1).replace(/\\/g, "/");
          skippedFiles.push(relativePath);
        }
      }
    }
  }

  return files;
}

/**
 * Format duration in milliseconds to human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

/**
 * Format phase name for display.
 */
function formatPhase(phase: string): string {
  const phases: Record<string, string> = {
    initializing: "Initializing",
    extracting_entities: "Extracting entities",
    extracting_relationships: "Extracting relationships",
    creating_repository_node: "Creating repository node",
    creating_file_nodes: "Creating file nodes",
    creating_entity_nodes: "Creating entity nodes",
    creating_module_nodes: "Creating module nodes",
    creating_relationships: "Creating relationships",
    verifying: "Verifying",
    completed: "Completed",
  };
  return phases[phase] || phase;
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
 * Populates the Neo4j knowledge graph for all indexed repositories
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

  // Step 1: Get Neo4j config (fail early if not configured)
  let config: Neo4jConfig;
  try {
    config = getNeo4jConfig();
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
      console.error("  • Set NEO4J_PASSWORD in your .env file");
      console.error("  • Or export NEO4J_PASSWORD in your shell");
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

  // Step 3: Connect to Neo4j (once for all repositories)
  let client: Neo4jStorageClientImpl | null = null;
  const results: GraphPopulateAllResult[] = [];

  try {
    if (!json) {
      const connectSpinner = ora({
        text: "Connecting to Neo4j...",
        spinner: "dots",
      }).start();

      client = new Neo4jStorageClientImpl(config);
      await client.connect();

      connectSpinner.succeed("Connected to Neo4j");
      console.log();
    } else {
      client = new Neo4jStorageClientImpl(config);
      await client.connect();
    }

    // Step 4: Create shared extractors and ingestion service
    const entityExtractor = new EntityExtractor();
    const relationshipExtractor = new RelationshipExtractor();
    const ingestionService = new GraphIngestionService(
      client,
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
    // Step 6: Disconnect from Neo4j
    if (client) {
      try {
        await client.disconnect();
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
