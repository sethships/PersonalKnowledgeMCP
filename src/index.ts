/**
 * Personal Knowledge MCP - Main Entry Point
 *
 * This is the MCP server entry point that initializes all dependencies
 * and starts the MCP server. Supports multiple transport types:
 * - stdio: For Claude Code integration (always enabled)
 * - HTTP/SSE: For legacy network clients (configurable)
 * - Streamable HTTP: For modern MCP clients per 2025-03-26 spec (configurable)
 */

import "dotenv/config";
import { PersonalKnowledgeMCPServer } from "./mcp/server.js";
import { SearchServiceImpl } from "./services/search-service.js";
import { createEmbeddingProvider } from "./providers/factory.js";
import { embeddingProviderFactory } from "./providers/EmbeddingProviderFactory.js";
import { RepositoryMetadataStoreImpl } from "./repositories/metadata-store.js";
import { initializeLogger, getComponentLogger, type LogLevel } from "./logging/index.js";
import {
  detectInterruptedUpdates,
  formatElapsedTime,
} from "./services/interrupted-update-detector.js";
import { evaluateRecoveryStrategy } from "./services/interrupted-update-recovery.js";
import {
  createHttpApp,
  startHttpServer,
  loadHttpConfig,
  startSessionCleanup,
  startStreamableSessionCleanup,
} from "./http/index.js";
import { loadInstanceConfig, getEnabledInstances } from "./config/index.js";
import { createGraphAdapter } from "./graph/adapters/index.js";
import type { GraphStorageAdapter } from "./graph/adapters/types.js";
import { createInstanceRouter } from "./mcp/instance-router.js";
import { GraphServiceImpl } from "./services/graph-service.js";
import type { GraphService } from "./services/graph-service-types.js";

// Initialize logger at application startup
initializeLogger({
  level: (Bun.env["LOG_LEVEL"] as LogLevel) || "info",
  format: (Bun.env["LOG_FORMAT"] as "json" | "pretty") || "pretty",
});

const logger = getComponentLogger("main");

/**
 * Main entry point for Personal Knowledge MCP Server
 *
 * Initialization order:
 * 1. Configuration loading (environment variables)
 * 2. Embedding provider (OpenAI)
 * 3. Storage client (ChromaDB) with connection
 * 4. Repository metadata service (singleton)
 * 5. Search service (wires provider + storage + metadata)
 * 6. MCP server (wires search service)
 * 7a. Start stdio transport (always, for Claude Code)
 * 7b. Start HTTP transport (if enabled, for Cursor/VS Code)
 */
async function main(): Promise<void> {
  logger.info("Initializing Personal Knowledge MCP Server");

  try {
    // Step 1: Load configuration from environment variables
    const config = {
      chromadb: {
        host: Bun.env["CHROMADB_HOST"] || "localhost",
        port: parseInt(Bun.env["CHROMADB_PORT"] || "8000", 10),
        authToken: Bun.env["CHROMADB_AUTH_TOKEN"],
      },
      embedding: {
        provider: "openai",
        model: Bun.env["EMBEDDING_MODEL"] || "text-embedding-3-small",
        dimensions: parseInt(Bun.env["EMBEDDING_DIMENSIONS"] || "1536", 10),
        batchSize: parseInt(Bun.env["EMBEDDING_BATCH_SIZE"] || "100", 10),
        maxRetries: parseInt(Bun.env["EMBEDDING_MAX_RETRIES"] || "3", 10),
        timeoutMs: parseInt(Bun.env["EMBEDDING_TIMEOUT_MS"] || "30000", 10),
      },
      data: {
        path: Bun.env["DATA_PATH"] || "./data",
      },
    };

    // Step 1b: Load multi-instance configuration
    const instanceConfig = loadInstanceConfig();
    const enabledInstances = getEnabledInstances(instanceConfig);

    // Log safe subset explicitly (avoid accidentally logging sensitive fields)
    logger.info(
      {
        chromadb: { host: config.chromadb.host, port: config.chromadb.port },
        embedding: {
          model: config.embedding.model,
          dimensions: config.embedding.dimensions,
        },
        data: { path: config.data.path },
        instances: {
          enabled: enabledInstances,
          default: instanceConfig.defaultInstance,
          requireAuth: instanceConfig.requireAuthForDefaultInstance,
        },
      },
      "Configuration loaded"
    );

    // Step 2: Initialize embedding provider (OpenAI)
    logger.info("Initializing embedding provider");
    const embeddingProvider = createEmbeddingProvider(config.embedding);
    logger.info(
      {
        provider: embeddingProvider.providerId,
        model: embeddingProvider.modelId,
        dimensions: embeddingProvider.dimensions,
      },
      "Embedding provider initialized"
    );

    // Step 3: Initialize instance router and ChromaDB storage client
    logger.info("Initializing instance router");
    const instanceRouter = createInstanceRouter(instanceConfig);

    // Get storage client for default instance (backward compatible for stdio transport)
    logger.info(
      { defaultInstance: instanceConfig.defaultInstance },
      "Connecting to default ChromaDB instance"
    );
    const chromaClient = await instanceRouter.getStorageClient();

    // Verify connection health
    const isHealthy = await chromaClient.healthCheck();
    if (!isHealthy) {
      throw new Error("ChromaDB health check failed for default instance");
    }
    logger.info(
      { instance: instanceConfig.defaultInstance },
      "ChromaDB connection established and healthy"
    );

    // Step 3b: Initialize graph adapter (optional - only if configured)
    let graphAdapter: GraphStorageAdapter | undefined;
    const falkordbPassword = Bun.env["FALKORDB_PASSWORD"];
    if (falkordbPassword) {
      try {
        logger.info("Initializing graph adapter (FalkorDB)");
        graphAdapter = createGraphAdapter("falkordb", {
          host: Bun.env["FALKORDB_HOST"] || "localhost",
          port: parseInt(Bun.env["FALKORDB_PORT"] || "6379", 10),
          username: Bun.env["FALKORDB_USER"] || "default",
          password: falkordbPassword,
          database: Bun.env["FALKORDB_DATABASE"] || "knowledge_graph",
        });
        await graphAdapter.connect();
        const graphHealthy = await graphAdapter.healthCheck();
        if (graphHealthy) {
          logger.info("Graph database connection established and healthy");
        } else {
          logger.warn("Graph database connection established but health check failed");
        }
      } catch (error) {
        // Graph database is optional - log warning but don't fail server startup
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "Graph database initialization failed - graph features will be unavailable"
        );
        graphAdapter = undefined;
      }
    } else {
      logger.debug("FALKORDB_PASSWORD not set - Graph database features disabled");
    }

    // Step 3c: Initialize graph service (if adapter available)
    let graphService: GraphService | undefined;
    if (graphAdapter) {
      graphService = new GraphServiceImpl(graphAdapter);
      logger.info("Graph service initialized");
    }

    // Step 4: Initialize repository metadata service (singleton)
    logger.info("Initializing repository metadata service");
    const repositoryService = RepositoryMetadataStoreImpl.getInstance(config.data.path);
    logger.info("Repository metadata service initialized");

    // Step 4b: Check for interrupted updates from previous service crashes
    logger.debug("Checking for interrupted updates");
    const detectionResult = await detectInterruptedUpdates(repositoryService);

    if (detectionResult.interrupted.length > 0) {
      // Log each interrupted update with details and evaluated recovery strategy
      for (const interrupted of detectionResult.interrupted) {
        // Evaluate recovery strategy for this interrupted update
        const strategy = await evaluateRecoveryStrategy(interrupted);

        logger.warn(
          {
            repository: interrupted.repositoryName,
            updateStartedAt: interrupted.updateStartedAt,
            elapsed: formatElapsedTime(interrupted.elapsedMs),
            lastKnownCommit: interrupted.lastKnownCommit?.substring(0, 7),
            currentStatus: interrupted.status,
            recoveryStrategy: strategy.type,
            recoveryReason: strategy.reason,
            canAutoRecover: strategy.canAutoRecover,
          },
          "Detected interrupted update - repository index may be inconsistent"
        );
      }

      // Summary warning with recovery instructions
      logger.warn(
        {
          count: detectionResult.interrupted.length,
          repositories: detectionResult.interrupted.map((i) => i.repositoryName),
        },
        "Interrupted updates detected. Run 'pk-mcp reset-update <repo> --recover' for automatic recovery or 'pk-mcp update <repo> --force' to re-index."
      );
    } else {
      logger.debug("No interrupted updates detected");
    }

    // Step 5: Initialize search service
    logger.info("Initializing search service");
    const searchService = new SearchServiceImpl(
      embeddingProvider,
      embeddingProviderFactory,
      chromaClient,
      repositoryService
    );
    logger.info("Search service initialized");

    // Step 6: Create MCP server
    logger.info("Creating MCP server");
    const mcpServer = new PersonalKnowledgeMCPServer(
      searchService,
      repositoryService,
      {
        name: "personal-knowledge-mcp",
        version: "1.0.0",
        capabilities: {
          tools: true,
        },
      },
      { graphService }
    );

    // Register instance router shutdown hook
    mcpServer.registerPreShutdownHook(async () => {
      logger.info("Shutting down instance router");
      await instanceRouter.shutdown();
    });

    // Register graph adapter shutdown hook if initialized
    if (graphAdapter) {
      mcpServer.registerPreShutdownHook(async () => {
        logger.info("Disconnecting graph adapter");
        await graphAdapter.disconnect();
      });
    }
    logger.info("MCP server created");

    // Step 7a: Start HTTP transport (if enabled)
    // Must start before stdio to avoid blocking
    const httpConfig = loadHttpConfig();
    if (httpConfig.enabled) {
      logger.info({ host: httpConfig.host, port: httpConfig.port }, "Starting HTTP transport");

      const app = createHttpApp({
        createServerForSse: () => mcpServer.createServerForSse(),
        createServerForStreamableHttp: () => mcpServer.createServerForStreamableHttp(),
        checkChromaDb: () => chromaClient.healthCheck(),
        checkNeo4j: graphAdapter ? () => graphAdapter.healthCheck() : undefined,
      });

      const httpServer = await startHttpServer(app, httpConfig);

      // Start session cleanup timers for stale sessions
      startSessionCleanup(); // SSE transport
      startStreamableSessionCleanup(); // Streamable HTTP transport

      // Register HTTP shutdown as pre-shutdown hook for coordinated graceful shutdown
      mcpServer.registerPreShutdownHook(async () => {
        logger.info("Closing HTTP transport via pre-shutdown hook");
        await httpServer.close();
      });

      logger.info("HTTP transport started");
    } else {
      logger.debug("HTTP transport disabled");
    }

    // Step 7b: Start stdio transport (always enabled for Claude Code)
    logger.info("Starting stdio transport");
    await mcpServer.startStdio();

    // Server is now running and will block until shutdown signal
    logger.info("Personal Knowledge MCP Server is running");
  } catch (error) {
    logger.fatal({ error }, "Failed to start MCP server");
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error("Unhandled error in main():", error);
  process.exit(1);
});
