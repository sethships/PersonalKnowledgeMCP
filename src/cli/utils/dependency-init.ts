/**
 * Dependency Initialization for CLI
 *
 * Mirrors the initialization pattern from src/index.ts to set up all
 * required dependencies for CLI commands.
 */

import type { Logger } from "pino";
import type { EmbeddingProvider } from "../../providers/types.js";
import type { ChromaStorageClient } from "../../storage/types.js";
import type { RepositoryMetadataService } from "../../repositories/types.js";
import type { SearchService } from "../../services/types.js";
import type { IngestionService } from "../../services/ingestion-service.js";
import type { GitHubClient } from "../../services/github-client-types.js";
import { SearchServiceImpl } from "../../services/search-service.js";
import { IngestionService as IngestionServiceImpl } from "../../services/ingestion-service.js";
import { ChromaStorageClientImpl } from "../../storage/chroma-client.js";
import { createEmbeddingProvider } from "../../providers/factory.js";
import { RepositoryMetadataStoreImpl } from "../../repositories/metadata-store.js";
import { RepositoryCloner } from "../../ingestion/repository-cloner.js";
import { FileScanner } from "../../ingestion/file-scanner.js";
import { FileChunker } from "../../ingestion/file-chunker.js";
import { GitHubClientImpl } from "../../services/github-client.js";
import { IncrementalUpdatePipeline } from "../../services/incremental-update-pipeline.js";
import { IncrementalUpdateCoordinator } from "../../services/incremental-update-coordinator.js";
import { initializeLogger, getComponentLogger, type LogLevel } from "../../logging/index.js";

/**
 * Parse integer from environment variable with validation
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Parsed integer value
 * @throws {Error} If value is not a valid number
 */
function parseIntEnv(key: string, defaultValue: number): number {
  const value = Bun.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid value for ${key}: expected a number, got '${value}'`);
  }
  return parsed;
}

/**
 * All dependencies required by CLI commands
 */
export interface CliDependencies {
  embeddingProvider: EmbeddingProvider;
  chromaClient: ChromaStorageClient;
  repositoryService: RepositoryMetadataService;
  searchService: SearchService;
  ingestionService: IngestionService;
  githubClient: GitHubClient;
  updatePipeline: IncrementalUpdatePipeline;
  updateCoordinator: IncrementalUpdateCoordinator;
  logger: Logger;
}

/**
 * Initialize all dependencies for CLI commands
 *
 * This mirrors the initialization pattern from src/index.ts but with
 * CLI-appropriate logging configuration.
 *
 * @throws {Error} If required environment variables are missing
 * @throws {Error} If ChromaDB connection fails
 */
export async function initializeDependencies(): Promise<CliDependencies> {
  // Initialize logger for CLI (less verbose by default)
  initializeLogger({
    level: (Bun.env["LOG_LEVEL"] as LogLevel) || "warn",
    format: (Bun.env["LOG_FORMAT"] as "json" | "pretty") || "pretty",
  });

  const logger = getComponentLogger("cli");

  try {
    // Step 1: Load configuration from environment variables
    const config = {
      chromadb: {
        host: Bun.env["CHROMADB_HOST"] || "localhost",
        port: parseIntEnv("CHROMADB_PORT", 8000),
      },
      embedding: {
        provider: "openai",
        model: Bun.env["EMBEDDING_MODEL"] || "text-embedding-3-small",
        dimensions: parseIntEnv("EMBEDDING_DIMENSIONS", 1536),
        batchSize: parseIntEnv("EMBEDDING_BATCH_SIZE", 100),
        maxRetries: parseIntEnv("EMBEDDING_MAX_RETRIES", 3),
        timeoutMs: parseIntEnv("EMBEDDING_TIMEOUT_MS", 30000),
      },
      data: {
        path: Bun.env["DATA_PATH"] || "./data",
      },
      ingestion: {
        clonePath: Bun.env["CLONE_PATH"] || "./data/repositories",
      },
    };

    // Step 2: Initialize embedding provider (OpenAI)
    const embeddingProvider = createEmbeddingProvider(config.embedding);

    // Verify OpenAI API key is set
    if (!Bun.env["OPENAI_API_KEY"]) {
      throw new Error(
        "OPENAI_API_KEY environment variable is not set.\n" +
          "Please set your OpenAI API key in the .env file or environment."
      );
    }

    logger.debug(
      {
        provider: embeddingProvider.providerId,
        model: embeddingProvider.modelId,
        dimensions: embeddingProvider.dimensions,
      },
      "Embedding provider initialized"
    );

    // Step 3: Initialize ChromaDB storage client
    const chromaClient = new ChromaStorageClientImpl({
      host: config.chromadb.host,
      port: config.chromadb.port,
    });

    // Connect to ChromaDB
    logger.debug(
      { host: config.chromadb.host, port: config.chromadb.port },
      "Connecting to ChromaDB"
    );

    try {
      await chromaClient.connect();
    } catch (error) {
      throw new Error(
        `Failed to connect to ChromaDB at ${config.chromadb.host}:${config.chromadb.port}.\n` +
          "Please ensure ChromaDB is running (docker-compose up -d) and the connection details are correct.\n" +
          `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Verify connection health
    const isHealthy = await chromaClient.healthCheck();
    if (!isHealthy) {
      throw new Error(
        "ChromaDB health check failed.\n" +
          "The connection was established but the service is not responding properly.\n" +
          "Please check ChromaDB logs: docker-compose logs chromadb"
      );
    }

    logger.debug("ChromaDB connection established and healthy");

    // Step 4: Initialize repository metadata service (singleton)
    const repositoryService = RepositoryMetadataStoreImpl.getInstance(config.data.path);
    logger.debug("Repository metadata service initialized");

    // Step 5: Initialize search service
    const searchService = new SearchServiceImpl(embeddingProvider, chromaClient, repositoryService);
    logger.debug("Search service initialized");

    // Step 6: Initialize ingestion service components
    const repositoryCloner = new RepositoryCloner({
      clonePath: config.ingestion.clonePath,
      githubPat: Bun.env["GITHUB_PAT"],
    });
    const fileScanner = new FileScanner();
    const fileChunker = new FileChunker();

    // Step 7: Initialize ingestion service
    const ingestionService = new IngestionServiceImpl(
      repositoryCloner,
      fileScanner,
      fileChunker,
      embeddingProvider,
      chromaClient,
      repositoryService
    );
    logger.debug("Ingestion service initialized");

    // Step 8: Initialize GitHub client
    const githubClient = new GitHubClientImpl({
      token: Bun.env["GITHUB_TOKEN"],
    });
    logger.debug("GitHub client initialized");

    // Step 9: Initialize incremental update pipeline
    const updatePipeline = new IncrementalUpdatePipeline(
      fileChunker,
      embeddingProvider,
      chromaClient,
      getComponentLogger("services:incremental-update-pipeline")
    );
    logger.debug("Incremental update pipeline initialized");

    // Step 10: Initialize incremental update coordinator
    const updateCoordinator = new IncrementalUpdateCoordinator(
      githubClient,
      repositoryService,
      updatePipeline
    );
    logger.debug("Incremental update coordinator initialized");

    return {
      embeddingProvider,
      chromaClient,
      repositoryService,
      searchService,
      ingestionService,
      githubClient,
      updatePipeline,
      updateCoordinator,
      logger,
    };
  } catch (error) {
    // Log initialization failure
    logger.error({ error }, "Failed to initialize CLI dependencies");
    throw error;
  }
}
