/**
 * Graph Populate Command - Populate knowledge graph from indexed repository
 *
 * Reads files from an already-indexed repository's local clone, parses them
 * using tree-sitter, extracts entities and relationships, and stores them
 * in the knowledge graph.
 *
 * @example
 * ```bash
 * # Populate graph for a repository
 * pk-mcp graph populate PersonalKnowledgeMCP
 *
 * # Force repopulate (delete existing graph data)
 * pk-mcp graph populate PersonalKnowledgeMCP --force
 *
 * # JSON output
 * pk-mcp graph populate PersonalKnowledgeMCP --json
 * ```
 */

/* eslint-disable no-console */

import chalk from "chalk";
import ora from "ora";
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
import type { GraphIngestionProgress } from "../../graph/ingestion/types.js";
import type { RepositoryMetadataService } from "../../repositories/types.js";
import type { ValidatedGraphPopulateOptions } from "../utils/validation.js";
import { getGraphConfig } from "../utils/neo4j-config.js";
import {
  SUPPORTED_EXTENSIONS,
  scanDirectory,
  formatDuration,
  formatPhase,
} from "../utils/file-scanner.js";

/**
 * Threshold for warning about large repository file counts.
 * Processing many files may consume significant memory.
 */
const LARGE_REPO_THRESHOLD = 5000;

/**
 * Execute graph populate command
 *
 * @param repositoryName - Name of the repository to populate
 * @param options - Command options
 * @param repositoryService - Repository metadata service
 */
export async function graphPopulateCommand(
  repositoryName: string,
  options: ValidatedGraphPopulateOptions,
  repositoryService: RepositoryMetadataService
): Promise<void> {
  const { force = false, json = false } = options;

  // Get graph config
  let config: GraphStorageConfig;
  try {
    config = getGraphConfig();
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
    process.exit(1);
  }

  const spinner = ora({
    text: "Looking up repository...",
    color: "cyan",
  });

  if (!json) {
    spinner.start();
  }

  let adapter: GraphStorageAdapter | null = null;

  try {
    // Step 1: Look up repository metadata
    const repository = await repositoryService.getRepository(repositoryName);

    if (!repository) {
      throw new Error(
        `Repository "${repositoryName}" not found.\n` +
          "Use 'pk-mcp status' to list indexed repositories.\n" +
          "Use 'pk-mcp index <url>' to index a new repository first."
      );
    }

    if (!repository.localPath) {
      throw new Error(
        `Repository "${repositoryName}" does not have a local clone.\n` +
          "The repository must be indexed with a local clone to populate the graph."
      );
    }

    // Verify local path exists
    try {
      await stat(repository.localPath);
    } catch {
      throw new Error(
        `Local repository path not found: ${repository.localPath}\n` +
          "The local clone may have been deleted. Try re-indexing with 'pk-mcp index'."
      );
    }

    if (!json) {
      spinner.text = "Scanning files...";
    }

    // Step 2: Scan files from local repository
    const skippedFiles: string[] = [];
    const files = await scanDirectory(repository.localPath, repository.localPath, skippedFiles);

    if (files.length === 0) {
      throw new Error(
        `No supported files found in repository "${repositoryName}".\n` +
          `Supported extensions: ${Array.from(SUPPORTED_EXTENSIONS).join(", ")}`
      );
    }

    // Report skipped files if any
    if (skippedFiles.length > 0 && !json) {
      spinner.warn(
        `Found ${files.length} files to process (${skippedFiles.length} files skipped due to read errors)`
      );
    } else if (!json) {
      spinner.succeed(`Found ${files.length} files to process`);
    }

    // Warn about large repositories
    if (files.length > LARGE_REPO_THRESHOLD && !json) {
      console.warn(
        chalk.yellow(
          `\nWarning: Processing ${files.length} files. This may consume significant memory.\n`
        )
      );
    }

    if (!json) {
      spinner.text = "Connecting to graph database...";
      spinner.start();
    }

    // Step 3: Connect to graph database
    adapter = createGraphAdapter("neo4j", config);
    await adapter.connect();

    if (!json) {
      spinner.succeed("Connected to graph database");
    }

    // Step 4: Create ingestion service
    const entityExtractor = new EntityExtractor();
    const relationshipExtractor = new RelationshipExtractor();
    const ingestionService = new GraphIngestionService(
      adapter,
      entityExtractor,
      relationshipExtractor
    );

    // Step 5: Progress callback
    let lastPhase = "";
    const onProgress = (progress: GraphIngestionProgress): void => {
      if (!json && progress.phase !== lastPhase) {
        lastPhase = progress.phase;
        const phaseText = formatPhase(progress.phase);
        spinner.text = `${phaseText} (${progress.percentage}%)`;
      }
    };

    // Step 6: Ingest files
    if (!json) {
      spinner.text = "Populating knowledge graph...";
      spinner.start();
    }

    const result = await ingestionService.ingestFiles(files, {
      repository: repositoryName,
      repositoryUrl: repository.url,
      force,
      onProgress,
    });

    if (!json) {
      spinner.stop();
    }

    // Step 7: Report results
    if (json) {
      // Include skipped files in JSON output
      const jsonResult = {
        ...result,
        skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
      };
      console.log(JSON.stringify(jsonResult, null, 2));
    } else {
      printResults(repositoryName, result.status, result.stats, result.errors, skippedFiles);
    }

    // Exit with error code if failed
    if (result.status === "failed") {
      process.exit(1);
    }
  } catch (error) {
    if (!json) {
      spinner.fail("Graph population failed");
    }

    // Handle specific errors
    if (error instanceof RepositoryExistsError) {
      if (json) {
        console.log(
          JSON.stringify({
            success: false,
            error: `Repository "${repositoryName}" already has graph data. Use --force to repopulate.`,
          })
        );
      } else {
        console.error(
          chalk.red(`\nRepository "${repositoryName}" already has graph data in Neo4j.`)
        );
        console.error("\n" + chalk.bold("Options:"));
        console.error("  • Use --force to delete existing data and repopulate");
        console.error(`  • Example: pk-mcp graph populate ${repositoryName} --force`);
      }
      process.exit(1);
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: errorMessage,
        })
      );
    } else {
      console.error(chalk.red(`\nError: ${errorMessage}`));

      // Provide context-specific guidance
      if (errorMessage.includes("Neo4j") || errorMessage.includes("connect")) {
        console.error("\n" + chalk.bold("Next steps:"));
        console.error("  • Verify Neo4j is running: " + chalk.gray("docker compose up neo4j -d"));
        console.error("  • Check Neo4j connection settings in .env");
        console.error(
          "  • Ensure schema migrations are applied: " + chalk.gray("pk-mcp graph migrate")
        );
      }
    }

    process.exit(1);
  } finally {
    // Disconnect from graph database
    if (adapter) {
      try {
        await adapter.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
    }
  }
}

/**
 * Print results in human-readable format.
 */
function printResults(
  repositoryName: string,
  status: string,
  stats: {
    filesProcessed: number;
    filesFailed: number;
    nodesCreated: number;
    relationshipsCreated: number;
    durationMs: number;
    nodesByType?: {
      repository?: number;
      file?: number;
      function?: number;
      class?: number;
      module?: number;
    };
    relationshipsByType?: {
      contains?: number;
      defines?: number;
      imports?: number;
    };
  },
  errors: Array<{ message: string; filePath?: string }>,
  skippedFiles: string[] = []
): void {
  const statusColor =
    status === "success" ? chalk.green : status === "partial" ? chalk.yellow : chalk.red;
  const statusIcon = status === "success" ? "✓" : status === "partial" ? "⚠" : "✗";

  console.log();
  console.log(statusColor(`${statusIcon} Graph Populated: ${repositoryName}`));
  console.log();

  // File statistics
  console.log(chalk.bold("  Files:"));
  console.log(`    Processed: ${chalk.cyan(stats.filesProcessed.toString())}`);
  if (stats.filesFailed > 0) {
    console.log(`    Failed:    ${chalk.red(stats.filesFailed.toString())}`);
  }
  if (skippedFiles.length > 0) {
    console.log(`    Skipped:   ${chalk.yellow(skippedFiles.length.toString())} (read errors)`);
  }

  // Node statistics
  console.log();
  console.log(chalk.bold("  Nodes created:") + ` ${chalk.cyan(stats.nodesCreated.toString())}`);
  if (stats.nodesByType) {
    const {
      repository = 0,
      file = 0,
      function: func = 0,
      class: cls = 0,
      module = 0,
    } = stats.nodesByType;
    console.log(chalk.gray(`    Repository: ${repository}`));
    console.log(chalk.gray(`    File:       ${file}`));
    console.log(chalk.gray(`    Function:   ${func}`));
    console.log(chalk.gray(`    Class:      ${cls}`));
    console.log(chalk.gray(`    Module:     ${module}`));
  }

  // Relationship statistics
  console.log();
  console.log(
    chalk.bold("  Relationships created:") + ` ${chalk.cyan(stats.relationshipsCreated.toString())}`
  );
  if (stats.relationshipsByType) {
    const { contains = 0, defines = 0, imports = 0 } = stats.relationshipsByType;
    console.log(chalk.gray(`    CONTAINS: ${contains}`));
    console.log(chalk.gray(`    DEFINES:  ${defines}`));
    console.log(chalk.gray(`    IMPORTS:  ${imports}`));
  }

  // Duration
  console.log();
  console.log(`  Duration: ${chalk.cyan(formatDuration(stats.durationMs))}`);

  // Errors (if any)
  if (errors.length > 0) {
    console.log();
    console.log(chalk.yellow(`  Errors: ${errors.length}`));
    const displayErrors = errors.slice(0, 5);
    for (const error of displayErrors) {
      const location = error.filePath ? ` (${error.filePath})` : "";
      console.log(chalk.gray(`    • ${error.message}${location}`));
    }
    if (errors.length > 5) {
      console.log(chalk.gray(`    ... and ${errors.length - 5} more`));
    }
  }

  console.log();
}
