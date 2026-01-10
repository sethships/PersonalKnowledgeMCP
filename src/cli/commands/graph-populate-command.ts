/**
 * Graph Populate Command - Populate Neo4j knowledge graph from indexed repository
 *
 * Reads files from an already-indexed repository's local clone, parses them
 * using tree-sitter, extracts entities and relationships, and stores them
 * in the Neo4j knowledge graph.
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
import { readdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";
import { Neo4jStorageClientImpl } from "../../graph/Neo4jClient.js";
import { GraphIngestionService } from "../../graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../graph/extraction/RelationshipExtractor.js";
import { RepositoryExistsError } from "../../graph/ingestion/errors.js";
import type { Neo4jConfig } from "../../graph/types.js";
import type { FileInput, GraphIngestionProgress } from "../../graph/ingestion/types.js";
import type { RepositoryMetadataService } from "../../repositories/types.js";
import type { ValidatedGraphPopulateOptions } from "../utils/validation.js";

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
 * Get Neo4j configuration from environment
 *
 * @returns Neo4j configuration object
 * @throws Error if required environment variables are missing or invalid
 */
function getNeo4jConfig(): Neo4jConfig {
  const host = process.env["NEO4J_HOST"] || "localhost";
  const portEnv = process.env["NEO4J_BOLT_PORT"] || "7687";
  const username = process.env["NEO4J_USER"] || "neo4j";
  const password = process.env["NEO4J_PASSWORD"];

  const port = parseInt(portEnv, 10);
  if (!/^\d+$/.test(portEnv) || isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid NEO4J_BOLT_PORT value: "${portEnv}". ` +
        "Port must be a valid integer between 1 and 65535."
    );
  }

  if (!password) {
    throw new Error(
      "NEO4J_PASSWORD environment variable is required. " +
        "Set it in your .env file or export it in your shell."
    );
  }

  return {
    host,
    port,
    username,
    password,
  };
}

/**
 * Recursively scan directory for supported files.
 *
 * @param dirPath - Directory to scan
 * @param basePath - Base path for relative path calculation
 * @returns Array of FileInput objects
 */
async function scanDirectory(dirPath: string, basePath: string): Promise<FileInput[]> {
  const files: FileInput[] = [];

  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        const subFiles = await scanDirectory(fullPath, basePath);
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
          // Skip files that can't be read
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

  // Get Neo4j config
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
    process.exit(1);
  }

  const spinner = ora({
    text: "Looking up repository...",
    color: "cyan",
  });

  if (!json) {
    spinner.start();
  }

  let client: Neo4jStorageClientImpl | null = null;

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
    const files = await scanDirectory(repository.localPath, repository.localPath);

    if (files.length === 0) {
      throw new Error(
        `No supported files found in repository "${repositoryName}".\n` +
          `Supported extensions: ${Array.from(SUPPORTED_EXTENSIONS).join(", ")}`
      );
    }

    if (!json) {
      spinner.succeed(`Found ${files.length} files to process`);
      spinner.text = "Connecting to Neo4j...";
      spinner.start();
    }

    // Step 3: Connect to Neo4j
    client = new Neo4jStorageClientImpl(config);
    await client.connect();

    if (!json) {
      spinner.succeed("Connected to Neo4j");
    }

    // Step 4: Create ingestion service
    const entityExtractor = new EntityExtractor();
    const relationshipExtractor = new RelationshipExtractor();
    const ingestionService = new GraphIngestionService(
      client,
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
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResults(repositoryName, result.status, result.stats, result.errors);
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
    // Disconnect from Neo4j
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
    }
  }
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
  errors: Array<{ message: string; filePath?: string }>
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
