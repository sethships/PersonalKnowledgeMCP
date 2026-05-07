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
import {
  getAdapterConfig,
  getAdapterDisplayName,
  getAdapterConfigHint,
  getAdapterDockerCommand,
} from "../utils/graph-config.js";
import {
  SUPPORTED_EXTENSIONS,
  scanDirectory,
  scanDocumentFiles,
  formatDuration,
  formatPhase,
} from "../utils/file-scanner.js";
import { DocumentTypeDetector } from "../../documents/DocumentTypeDetector.js";
import { DocGraphBatcher } from "../../graph/extraction/doc-graph-batch.js";
import type { DocExtractionResult } from "../../graph/extraction/doc-types.js";

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
  const { adapter, force = false, json = false } = options;
  const adapterDisplayName = getAdapterDisplayName(adapter);

  // Get graph config for selected adapter
  let config: GraphStorageConfig;
  try {
    config = getAdapterConfig(adapter);
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
      console.error("  • " + getAdapterConfigHint(adapter));
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

  let graphAdapter: GraphStorageAdapter | null = null;

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

    // Step 2: Scan files from local repository (separate code-file and
    // doc-file passes so we can feed them to the right ingestion entry point).
    const skippedFiles: string[] = [];
    const files = await scanDirectory(repository.localPath, repository.localPath, skippedFiles);
    const docFiles = await scanDocumentFiles(repository.localPath, repository.localPath);

    if (files.length === 0 && docFiles.length === 0) {
      throw new Error(
        `No supported files found in repository "${repositoryName}".\n` +
          `Supported code extensions: ${Array.from(SUPPORTED_EXTENSIONS).join(", ")}\n` +
          "Doc extensions: .md, .markdown, .txt, .pdf, .docx"
      );
    }

    // Report skipped files if any
    if (skippedFiles.length > 0 && !json) {
      spinner.warn(
        `Found ${files.length} code files + ${docFiles.length} doc files (${skippedFiles.length} skipped due to read errors)`
      );
    } else if (!json) {
      spinner.succeed(`Found ${files.length} code files + ${docFiles.length} doc files`);
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
      spinner.text = `Connecting to ${adapterDisplayName}...`;
      spinner.start();
    }

    // Step 3: Connect to graph database
    graphAdapter = createGraphAdapter(adapter, config);
    await graphAdapter.connect();

    if (!json) {
      spinner.succeed(`Connected to ${adapterDisplayName}`);
    }

    // Step 4: Create ingestion service
    const entityExtractor = new EntityExtractor();
    const relationshipExtractor = new RelationshipExtractor();
    const ingestionService = new GraphIngestionService(
      graphAdapter,
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

    const result =
      files.length > 0
        ? await ingestionService.ingestFiles(files, {
            repository: repositoryName,
            // url is non-null for git-remote and local-git repos (the only sources
            // that flow through this CLI command in Phase A). Phase B will branch
            // on repository.source for local-folder repos.
            repositoryUrl: repository.url!,
            force,
            onProgress,
          })
        : null;

    // Step 6b: Doc-graph ingestion (issue #580). Runs after `ingestFiles` so
    // the symbol index built inside `ingestDocumentGraph` sees Function/Class
    // nodes and can resolve MENTIONS. Skipped when no doc files are present.
    let docResult: Awaited<ReturnType<GraphIngestionService["ingestDocumentGraph"]>> | null = null;
    const docExtractionErrors: string[] = [];
    if (docFiles.length > 0) {
      if (!json) {
        spinner.text = "Extracting document graph...";
        spinner.start();
      }
      const detector = new DocumentTypeDetector();
      const batcher = new DocGraphBatcher();
      const docResults: DocExtractionResult[] = [];
      for (const ref of docFiles) {
        try {
          const res = await batcher.fromFile(ref.absolutePath, ref.relativePath, detector);
          if (res) docResults.push(res);
        } catch (err) {
          docExtractionErrors.push(
            `${ref.relativePath}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      if (docResults.length > 0) {
        docResult = await ingestionService.ingestDocumentGraph(repositoryName, docResults);
      }
    }

    if (!json) {
      spinner.stop();
    }

    // Step 7: Report results
    if (json) {
      // Include skipped files in JSON output
      const jsonResult = {
        ...(result ?? {
          status: "success",
          repository: repositoryName,
          stats: { filesProcessed: 0, nodesCreated: 0, relationshipsCreated: 0, durationMs: 0 },
          errors: [],
        }),
        skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
        docGraph:
          docFiles.length > 0
            ? {
                docFilesScanned: docFiles.length,
                ...(docResult ?? {
                  documentsCreated: 0,
                  sectionsCreated: 0,
                  externalLinksCreated: 0,
                  edgesCreated: 0,
                  staleMentionsRemoved: 0,
                }),
                extractionErrors: docExtractionErrors.length > 0 ? docExtractionErrors : undefined,
              }
            : undefined,
      };
      console.log(JSON.stringify(jsonResult, null, 2));
    } else {
      if (result) {
        printResults(repositoryName, result.status, result.stats, result.errors, skippedFiles);
      }
      if (docFiles.length > 0) {
        printDocGraphResults(docFiles.length, docResult, docExtractionErrors);
      }
    }

    // Exit with error code if failed
    if (result && result.status === "failed") {
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
          chalk.red(
            `\nRepository "${repositoryName}" already has graph data in ${adapterDisplayName}.`
          )
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
      if (errorMessage.includes("connect") || errorMessage.includes("ECONNREFUSED")) {
        console.error("\n" + chalk.bold("Next steps:"));
        console.error(
          `  • Verify ${adapterDisplayName} is running: ` +
            chalk.gray(getAdapterDockerCommand(adapter))
        );
        console.error(`  • Check ${adapterDisplayName} connection settings in .env`);
        console.error(
          "  • Ensure schema migrations are applied: " +
            chalk.gray(`pk-mcp graph migrate --adapter ${adapter}`)
        );
      }
    }

    process.exit(1);
  } finally {
    // Disconnect from graph database
    if (graphAdapter) {
      try {
        await graphAdapter.disconnect();
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

/**
 * Print doc-graph results in human-readable format (issue #580).
 *
 * Called after the code-graph summary so a populate run that touched both
 * code and doc files surfaces both result blocks side-by-side.
 */
function printDocGraphResults(
  docFilesScanned: number,
  docResult: {
    documentsCreated: number;
    sectionsCreated: number;
    externalLinksCreated: number;
    edgesCreated: number;
    staleMentionsRemoved: number;
  } | null,
  extractionErrors: string[]
): void {
  console.log();
  console.log(chalk.bold("  Document graph:"));
  console.log(`    Files scanned: ${chalk.cyan(docFilesScanned.toString())}`);
  if (docResult) {
    console.log(chalk.gray(`    Documents:     ${docResult.documentsCreated}`));
    console.log(chalk.gray(`    Sections:      ${docResult.sectionsCreated}`));
    console.log(chalk.gray(`    ExternalLinks: ${docResult.externalLinksCreated}`));
    console.log(chalk.gray(`    Edges:         ${docResult.edgesCreated}`));
    if (docResult.staleMentionsRemoved > 0) {
      console.log(chalk.gray(`    Stale swept:   ${docResult.staleMentionsRemoved}`));
    }
  } else {
    console.log(chalk.gray("    (no extraction results — all files failed or unsupported)"));
  }
  if (extractionErrors.length > 0) {
    console.log(chalk.yellow(`    Extraction errors: ${extractionErrors.length}`));
    for (const e of extractionErrors.slice(0, 5)) {
      console.log(chalk.gray(`      • ${e}`));
    }
    if (extractionErrors.length > 5) {
      console.log(chalk.gray(`      ... and ${extractionErrors.length - 5} more`));
    }
  }
  console.log();
}
