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
import type { TokenService } from "../../auth/types.js";
import type { GraphStorageAdapter } from "../../graph/adapters/types.js";
import { SearchServiceImpl } from "../../services/search-service.js";
import { IngestionService as IngestionServiceImpl } from "../../services/ingestion-service.js";
import { ChromaStorageClientImpl } from "../../storage/chroma-client.js";
import { createEmbeddingProvider } from "../../providers/factory.js";
import { embeddingProviderFactory } from "../../providers/EmbeddingProviderFactory.js";
import { RepositoryMetadataStoreImpl } from "../../repositories/metadata-store.js";
import { RepositoryCloner } from "../../ingestion/repository-cloner.js";
import { FileScanner } from "../../ingestion/file-scanner.js";
import { FileChunker } from "../../ingestion/file-chunker.js";
import { GitHubClientImpl } from "../../services/github-client.js";
import { IncrementalUpdatePipeline } from "../../services/incremental-update-pipeline.js";
import { IncrementalUpdateCoordinator } from "../../services/incremental-update-coordinator.js";
import { TokenServiceImpl } from "../../auth/token-service.js";
import { TokenStoreImpl } from "../../auth/token-store.js";
import { initializeLogger, getComponentLogger, type LogLevel } from "../../logging/index.js";
import { createGraphAdapter } from "../../graph/adapters/index.js";
import { getDefaultAdapterType, getAdapterConfig, getAdapterDisplayName } from "./graph-config.js";
import { GraphIngestionService } from "../../graph/ingestion/GraphIngestionService.js";
import { EntityExtractor } from "../../graph/extraction/EntityExtractor.js";
import { RelationshipExtractor } from "../../graph/extraction/RelationshipExtractor.js";

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
 * Parse non-negative integer from environment variable with validation
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Parsed non-negative integer value
 * @throws {Error} If value is not a valid number or is negative
 */
function parseNonNegativeIntEnv(key: string, defaultValue: number): number {
  const value = parseIntEnv(key, defaultValue);
  if (value < 0) {
    throw new Error(`Invalid value for ${key}: expected a non-negative number, got '${value}'`);
  }
  return value;
}

/**
 * Options for dependency initialization
 */
export interface DependencyOptions {
  /** Optional provider override from CLI flag */
  provider?: string;
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
  tokenService: TokenService;
  /** Optional graph adapter for graph database operations (only if configured) */
  graphAdapter?: GraphStorageAdapter;
  /** Optional graph ingestion service for incremental graph updates (only if graph adapter is configured) */
  graphIngestionService?: GraphIngestionService;
  logger: Logger;
}

/**
 * Initialize all dependencies for CLI commands
 *
 * This mirrors the initialization pattern from src/index.ts but with
 * CLI-appropriate logging configuration.
 *
 * Provider resolution priority:
 * 1. CLI flag (options.provider)
 * 2. Environment variable (EMBEDDING_PROVIDER)
 * 3. Factory default (openai if API key set, else transformersjs)
 *
 * @param options - Optional configuration including provider override
 * @throws {Error} If required environment variables are missing
 * @throws {Error} If ChromaDB connection fails
 * @throws {Error} If specified provider is not available
 */
export async function initializeDependencies(
  options?: DependencyOptions
): Promise<CliDependencies> {
  // Initialize logger for CLI (less verbose by default)
  initializeLogger({
    level: (Bun.env["LOG_LEVEL"] as LogLevel) || "warn",
    format: (Bun.env["LOG_FORMAT"] as "json" | "pretty") || "pretty",
  });

  const logger = getComponentLogger("cli");

  try {
    // Step 1: Resolve embedding provider
    // Priority: CLI flag > environment variable > factory default
    // Uses singleton factory instance for performance
    const resolvedProvider =
      options?.provider ||
      Bun.env["EMBEDDING_PROVIDER"] ||
      embeddingProviderFactory.getDefaultProvider();

    // Validate provider is available (has required credentials/configuration)
    if (!embeddingProviderFactory.isProviderAvailable(resolvedProvider)) {
      const providerInfo = embeddingProviderFactory
        .listAvailableProviders()
        .find(
          (p) =>
            p.id === resolvedProvider.toLowerCase() ||
            p.aliases.includes(resolvedProvider.toLowerCase())
        );

      if (providerInfo && providerInfo.requiredEnvVars.length > 0) {
        throw new Error(
          `Provider '${resolvedProvider}' is not available.\n` +
            `Required environment variables: ${providerInfo.requiredEnvVars.join(", ")}\n` +
            `Please set these in your .env file or environment.`
        );
      } else {
        const validProviders = embeddingProviderFactory
          .listAvailableProviders()
          .map((p) => p.id)
          .join(", ");
        throw new Error(
          `Unknown provider: '${resolvedProvider}'.\n` + `Valid providers: ${validProviders}`
        );
      }
    }

    // Step 2: Load configuration from environment variables
    const config = {
      chromadb: {
        host: Bun.env["CHROMADB_HOST"] || "localhost",
        port: parseIntEnv("CHROMADB_PORT", 8000),
        authToken: Bun.env["CHROMADB_AUTH_TOKEN"],
      },
      embedding: {
        provider: resolvedProvider,
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

    // Step 3: Initialize embedding provider
    const embeddingProvider = createEmbeddingProvider(config.embedding);

    logger.debug(
      {
        provider: embeddingProvider.providerId,
        model: embeddingProvider.modelId,
        dimensions: embeddingProvider.dimensions,
      },
      "Embedding provider initialized"
    );

    // Step 4: Initialize ChromaDB storage client
    const chromaClient = new ChromaStorageClientImpl({
      host: config.chromadb.host,
      port: config.chromadb.port,
      authToken: config.chromadb.authToken,
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

    // Step 5: Initialize repository metadata service (singleton)
    const repositoryService = RepositoryMetadataStoreImpl.getInstance(config.data.path);
    logger.debug("Repository metadata service initialized");

    // Step 6: Initialize search service
    const searchService = new SearchServiceImpl(
      embeddingProvider,
      embeddingProviderFactory,
      chromaClient,
      repositoryService
    );
    logger.debug("Search service initialized");

    // Step 7: Initialize ingestion service components
    const repositoryCloner = new RepositoryCloner({
      clonePath: config.ingestion.clonePath,
      githubPat: Bun.env["GITHUB_PAT"],
    });
    const fileScanner = new FileScanner();
    const fileChunker = new FileChunker();

    // Step 8: Initialize ingestion service
    const ingestionService = new IngestionServiceImpl(
      repositoryCloner,
      fileScanner,
      fileChunker,
      embeddingProvider,
      chromaClient,
      repositoryService
    );
    logger.debug("Ingestion service initialized");

    // Step 9: Initialize GitHub client
    const githubClient = new GitHubClientImpl({
      token: Bun.env["GITHUB_PAT"],
    });
    logger.debug("GitHub client initialized");

    // Step 10: Initialize token service for authentication
    const tokenStore = TokenStoreImpl.getInstance(config.data.path);
    const tokenService = new TokenServiceImpl(tokenStore);
    logger.debug("Token service initialized");

    // Step 11: Initialize graph adapter (optional - only if configured)
    // Must be initialized before IncrementalUpdatePipeline so GraphIngestionService can be passed
    let graphAdapter: GraphStorageAdapter | undefined;
    let graphIngestionService: GraphIngestionService | undefined;
    const adapterType = getDefaultAdapterType();
    const adapterDisplayName = getAdapterDisplayName(adapterType);

    // Check if the selected adapter has configuration available
    // Note: FalkorDB allows empty password (passwordless mode), so we check !== undefined
    // Neo4j requires a password, so we use truthy check
    const falkordbPassword = Bun.env["FALKORDB_PASSWORD"];
    const neo4jPassword = Bun.env["NEO4J_PASSWORD"];
    const hasAdapterConfig =
      (adapterType === "falkordb" && falkordbPassword !== undefined) ||
      (adapterType === "neo4j" && neo4jPassword);

    if (hasAdapterConfig) {
      try {
        const graphConfig = getAdapterConfig(adapterType);
        graphAdapter = createGraphAdapter(adapterType, graphConfig);
        await graphAdapter.connect();
        const isHealthy = await graphAdapter.healthCheck();
        if (isHealthy) {
          logger.debug(
            { adapter: adapterType },
            `${adapterDisplayName} adapter initialized and healthy`
          );

          // Create graph ingestion service for incremental updates
          const entityExtractor = new EntityExtractor();
          const relationshipExtractor = new RelationshipExtractor();
          graphIngestionService = new GraphIngestionService(
            graphAdapter,
            entityExtractor,
            relationshipExtractor
          );
          logger.debug("Graph ingestion service initialized");
        } else {
          logger.warn(
            { adapter: adapterType },
            `${adapterDisplayName} adapter initialized but health check failed`
          );
        }
      } catch (error) {
        // Graph database is optional - log warning but don't fail CLI startup
        logger.warn(
          { adapter: adapterType, error: error instanceof Error ? error.message : String(error) },
          `${adapterDisplayName} initialization failed - graph features will be unavailable`
        );
        graphAdapter = undefined;
      }
    } else {
      const envVar = adapterType === "falkordb" ? "FALKORDB_PASSWORD" : "NEO4J_PASSWORD";
      logger.debug(
        { adapter: adapterType },
        `${envVar} not set - Graph database features disabled`
      );
    }

    // Step 12: Initialize incremental update pipeline (with optional graph ingestion service)
    const updatePipeline = new IncrementalUpdatePipeline(
      fileChunker,
      embeddingProvider,
      chromaClient,
      getComponentLogger("services:incremental-update-pipeline"),
      graphIngestionService
    );
    logger.debug(
      { graphEnabled: !!graphIngestionService },
      "Incremental update pipeline initialized"
    );

    // Step 13: Initialize incremental update coordinator
    const updateHistoryLimit = parseNonNegativeIntEnv("UPDATE_HISTORY_LIMIT", 20);
    const changeFileThreshold = parseNonNegativeIntEnv("CHANGE_FILE_THRESHOLD", 500);

    const updateCoordinator = new IncrementalUpdateCoordinator(
      githubClient,
      repositoryService,
      updatePipeline,
      {
        changeFileThreshold,
        updateHistoryLimit,
      }
    );
    logger.debug(
      { changeFileThreshold, updateHistoryLimit },
      "Incremental update coordinator initialized"
    );

    return {
      embeddingProvider,
      chromaClient,
      repositoryService,
      searchService,
      ingestionService,
      githubClient,
      updatePipeline,
      updateCoordinator,
      tokenService,
      graphAdapter,
      graphIngestionService,
      logger,
    };
  } catch (error) {
    // Log initialization failure
    logger.error({ error }, "Failed to initialize CLI dependencies");
    throw error;
  }
}
