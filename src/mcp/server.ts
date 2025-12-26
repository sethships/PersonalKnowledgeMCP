/**
 * Personal Knowledge MCP Server
 *
 * This module implements the main MCP server class that orchestrates the
 * Model Context Protocol communication with Claude Code and other MCP clients.
 * Supports multiple transport types:
 * - stdio: For Claude Code integration
 * - HTTP/SSE: For Cursor, VS Code (legacy transport)
 * - Streamable HTTP: For modern MCP clients (2025-03-26 specification)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { SearchService } from "../services/types.js";
import type { RepositoryMetadataService } from "../repositories/types.js";
import type { MCPServerConfig, ToolRegistry, MCPServerOptionalDeps } from "./types.js";
import { createToolRegistry, getToolDefinitions, getToolHandler } from "./tools/index.js";
import { createMethodNotFoundError } from "./errors.js";
import { getComponentLogger } from "../logging/index.js";

/** Default server configuration */
const DEFAULT_CONFIG: MCPServerConfig = {
  name: "personal-knowledge-mcp",
  version: "1.0.0",
  capabilities: { tools: true },
};

/**
 * Personal Knowledge MCP Server
 *
 * Exposes semantic search and knowledge retrieval capabilities via the
 * Model Context Protocol. Handles:
 * - MCP protocol lifecycle (initialization, connection, shutdown)
 * - Tool discovery (ListTools requests)
 * - Tool execution (CallTool requests)
 * - Error handling and logging
 *
 * Supports multiple transport types:
 * - stdio: For Claude Code integration (single connection)
 * - HTTP/SSE: For legacy network clients (multiple sessions)
 * - Streamable HTTP: For modern MCP clients per 2025-03-26 spec (multiple sessions)
 */
/**
 * Pre-shutdown hook type for coordinating multi-transport shutdown
 */
export type PreShutdownHook = () => Promise<void>;

export class PersonalKnowledgeMCPServer {
  private server: Server;
  private toolRegistry: ToolRegistry;
  private config: MCPServerConfig;
  private logger = getComponentLogger("mcp:server");
  private isShuttingDown = false;
  private shutdownHandlersRegistered = false;
  private preShutdownHooks: PreShutdownHook[] = [];

  /**
   * Creates a new MCP server instance
   *
   * @param searchService - Search service for semantic_search tool
   * @param repositoryService - Repository metadata service for list_indexed_repositories tool
   * @param config - Server configuration (name, version, capabilities)
   *
   * @example
   * ```typescript
   * const searchService = new SearchServiceImpl(provider, storage, repoService);
   * const repositoryService = RepositoryMetadataStoreImpl.getInstance();
   * const server = new PersonalKnowledgeMCPServer(searchService, repositoryService, {
   *   name: "personal-knowledge-mcp",
   *   version: "1.0.0",
   *   capabilities: { tools: true }
   * });
   * await server.start();
   * ```
   */
  constructor(
    searchService: SearchService,
    repositoryService: RepositoryMetadataService,
    config: MCPServerConfig = DEFAULT_CONFIG,
    optionalDeps?: MCPServerOptionalDeps
  ) {
    // Store config for creating additional server instances (SSE sessions)
    this.config = config;

    // Initialize primary MCP SDK server (used for stdio transport)
    this.server = this.createSdkServer();

    // Create tool registry with all available tools
    // Use the new dependency object signature if optional deps are provided
    if (optionalDeps?.updateCoordinator && optionalDeps?.rateLimiter && optionalDeps?.jobTracker) {
      this.toolRegistry = createToolRegistry({
        searchService,
        repositoryService,
        updateCoordinator: optionalDeps.updateCoordinator,
        rateLimiter: optionalDeps.rateLimiter,
        jobTracker: optionalDeps.jobTracker,
      });
    } else {
      // Legacy path - only core tools
      this.toolRegistry = createToolRegistry(searchService, repositoryService);
    }

    // Register request handlers on primary server
    this.registerHandlersOnServer(this.server);

    this.logger.info(
      {
        serverName: config.name,
        version: config.version,
        toolCount: Object.keys(this.toolRegistry).length,
        adminToolsEnabled: !!optionalDeps?.updateCoordinator,
      },
      "MCP server initialized"
    );
  }

  /**
   * Register a pre-shutdown hook for coordinated multi-transport shutdown
   *
   * Hooks are called in order before the MCP server closes. Use this to
   * close HTTP server, SSE sessions, and other resources gracefully.
   *
   * @param hook - Async function to call before shutdown
   *
   * @example
   * ```typescript
   * mcpServer.registerPreShutdownHook(async () => {
   *   await closeAllSessions();
   *   await httpServer.close();
   * });
   * ```
   */
  registerPreShutdownHook(hook: PreShutdownHook): void {
    this.preShutdownHooks.push(hook);
    this.logger.debug({ hookCount: this.preShutdownHooks.length }, "Pre-shutdown hook registered");
  }

  /**
   * Create a new MCP SDK Server instance with current configuration
   *
   * Used internally and for creating server instances for SSE sessions.
   *
   * @returns New MCP SDK Server instance
   */
  private createSdkServer(): Server {
    return new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: this.config.capabilities?.tools ? {} : undefined,
          resources: this.config.capabilities?.resources ? {} : undefined,
          prompts: this.config.capabilities?.prompts ? {} : undefined,
        },
      }
    );
  }

  /**
   * Registers MCP protocol request handlers on a server instance
   *
   * Sets up handlers for:
   * - ListTools: Returns available tool definitions
   * - CallTool: Routes to appropriate tool handler
   *
   * @param server - MCP SDK Server instance to register handlers on
   */
  private registerHandlersOnServer(server: Server): void {
    // Handle ListTools request
    server.setRequestHandler(ListToolsRequestSchema, () => {
      this.logger.debug("Handling ListTools request");

      const tools = getToolDefinitions(this.toolRegistry);

      this.logger.info(
        { toolCount: tools.length, tools: tools.map((t) => t.name) },
        "Listed available tools"
      );

      return { tools };
    });

    // Handle CallTool request
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name: toolName, arguments: args } = request.params;

      this.logger.info({ toolName, args }, "Handling CallTool request");

      // Get tool handler from registry
      const handler = getToolHandler(this.toolRegistry, toolName);

      if (!handler) {
        this.logger.warn({ toolName }, "Tool not found");

        const error = createMethodNotFoundError(toolName);
        return {
          content: [
            {
              type: "text",
              text: error.message,
            },
          ],
          isError: true,
        };
      }

      // Execute tool handler
      try {
        const result = await handler(args);

        this.logger.info({ toolName, isError: result.isError }, "CallTool completed");

        return result;
      } catch (error) {
        // This should rarely happen as handlers catch their own errors
        // But we handle it defensively to prevent server crashes
        this.logger.error({ toolName, error }, "Unexpected error in tool handler");

        return {
          content: [
            {
              type: "text",
              text: "An unexpected error occurred while executing the tool.",
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Starts the MCP server with stdio transport
   *
   * This method:
   * - Creates stdio transport for Claude Code communication
   * - Connects the server to the transport
   * - Sets up signal handlers for graceful shutdown
   * - Blocks until server is closed
   *
   * @throws {Error} If server fails to start or connect
   *
   * @deprecated Use startStdio() instead. This method is kept for backward compatibility.
   */
  async start(): Promise<void> {
    return this.startStdio();
  }

  /**
   * Starts the MCP server with stdio transport
   *
   * Use this for Claude Code integration. For HTTP/SSE transport,
   * use createServerForSse() instead.
   *
   * This method:
   * - Creates stdio transport for Claude Code communication
   * - Connects the primary server to the transport
   * - Sets up signal handlers for graceful shutdown
   *
   * @throws {Error} If server fails to start or connect
   */
  async startStdio(): Promise<void> {
    this.logger.info("Starting MCP server with stdio transport");

    const transport = new StdioServerTransport();

    // Handle graceful shutdown signals (register only once)
    if (!this.shutdownHandlersRegistered) {
      const shutdown = async (): Promise<void> => {
        if (this.isShuttingDown) {
          return; // Shutdown already in progress
        }
        this.isShuttingDown = true;
        await this.shutdown();
      };

      process.once("SIGINT", () => {
        this.logger.info("Received SIGINT, initiating shutdown");
        void shutdown();
      });

      process.once("SIGTERM", () => {
        this.logger.info("Received SIGTERM, initiating shutdown");
        void shutdown();
      });

      this.shutdownHandlersRegistered = true;
    }

    try {
      await this.server.connect(transport);
      this.logger.info("MCP server started successfully and ready for requests");
    } catch (error) {
      this.logger.fatal({ error }, "Failed to start MCP server");
      throw error;
    }
  }

  /**
   * Create a new MCP Server instance for SSE transport
   *
   * Each SSE session requires its own Server instance connected to
   * its own SSEServerTransport. This method creates a new server
   * with the same configuration and tool registry as the primary server.
   *
   * @returns New Server instance ready to be connected to an SSE transport
   *
   * @example
   * ```typescript
   * // In SSE route handler:
   * const transport = new SSEServerTransport('/api/v1/sse', res);
   * const server = mcpServer.createServerForSse();
   * await server.connect(transport);
   * await transport.start();
   * ```
   */
  createServerForSse(): Server {
    this.logger.debug("Creating new server instance for SSE session");

    const server = this.createSdkServer();
    this.registerHandlersOnServer(server);

    return server;
  }

  /**
   * Create a new MCP Server instance for Streamable HTTP transport
   *
   * Each Streamable HTTP session requires its own Server instance connected to
   * its own StreamableHTTPServerTransport. This method creates a new server
   * with the same configuration and tool registry as the primary server.
   *
   * This is the modern transport per MCP 2025-03-26 specification.
   *
   * @returns New Server instance ready to be connected to a Streamable HTTP transport
   *
   * @example
   * ```typescript
   * // In Streamable HTTP route handler:
   * const transport = new StreamableHTTPServerTransport({
   *   sessionIdGenerator: () => randomUUID(),
   * });
   * const server = mcpServer.createServerForStreamableHttp();
   * await server.connect(transport);
   * ```
   */
  createServerForStreamableHttp(): Server {
    this.logger.debug("Creating new server instance for Streamable HTTP session");

    const server = this.createSdkServer();
    this.registerHandlersOnServer(server);

    return server;
  }

  /**
   * Gracefully shuts down the MCP server
   *
   * Executes pre-shutdown hooks (for HTTP/SSE cleanup), then closes the
   * server connection and exits the process. Called automatically on
   * SIGINT/SIGTERM signals.
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down MCP server");

    try {
      // Execute pre-shutdown hooks (e.g., close HTTP server, SSE sessions)
      if (this.preShutdownHooks.length > 0) {
        this.logger.info(
          { hookCount: this.preShutdownHooks.length },
          "Executing pre-shutdown hooks"
        );

        for (const hook of this.preShutdownHooks) {
          try {
            await hook();
          } catch (hookError) {
            this.logger.warn({ error: hookError }, "Pre-shutdown hook failed, continuing shutdown");
          }
        }

        this.logger.debug("Pre-shutdown hooks completed");
      }

      // Close the primary MCP server
      await this.server.close();
      this.logger.info("MCP server shut down successfully");
      process.exit(0);
    } catch (error) {
      this.logger.error({ error }, "Error during shutdown");
      process.exit(1);
    }
  }
}
