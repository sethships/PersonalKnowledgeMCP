/**
 * Personal Knowledge MCP Server
 *
 * This module implements the main MCP server class that orchestrates the
 * Model Context Protocol communication with Claude Code and other MCP clients.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { SearchService } from "../services/types.js";
import type { RepositoryMetadataService } from "../repositories/types.js";
import type { MCPServerConfig, ToolRegistry } from "./types.js";
import { createToolRegistry, getToolDefinitions, getToolHandler } from "./tools/index.js";
import { createMethodNotFoundError } from "./errors.js";
import { getComponentLogger } from "../logging/index.js";

/**
 * Personal Knowledge MCP Server
 *
 * Exposes semantic search and knowledge retrieval capabilities via the
 * Model Context Protocol. Handles:
 * - MCP protocol lifecycle (initialization, connection, shutdown)
 * - Tool discovery (ListTools requests)
 * - Tool execution (CallTool requests)
 * - Error handling and logging
 */
export class PersonalKnowledgeMCPServer {
  private server: Server;
  private toolRegistry: ToolRegistry;
  private logger = getComponentLogger("mcp:server");
  private isShuttingDown = false;
  private shutdownHandlersRegistered = false;

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
    config: MCPServerConfig = {
      name: "personal-knowledge-mcp",
      version: "1.0.0",
      capabilities: { tools: true },
    }
  ) {
    // Initialize MCP SDK server
    this.server = new Server(
      {
        name: config.name,
        version: config.version,
      },
      {
        capabilities: {
          tools: config.capabilities?.tools ? {} : undefined,
          resources: config.capabilities?.resources ? {} : undefined,
          prompts: config.capabilities?.prompts ? {} : undefined,
        },
      }
    );

    // Create tool registry with all available tools
    this.toolRegistry = createToolRegistry(searchService, repositoryService);

    // Register request handlers
    this.registerHandlers();

    this.logger.info(
      {
        serverName: config.name,
        version: config.version,
        toolCount: Object.keys(this.toolRegistry).length,
      },
      "MCP server initialized"
    );
  }

  /**
   * Registers MCP protocol request handlers
   *
   * Sets up handlers for:
   * - ListTools: Returns available tool definitions
   * - CallTool: Routes to appropriate tool handler
   */
  private registerHandlers(): void {
    // Handle ListTools request
    this.server.setRequestHandler(ListToolsRequestSchema, () => {
      this.logger.debug("Handling ListTools request");

      const tools = getToolDefinitions(this.toolRegistry);

      this.logger.info(
        { toolCount: tools.length, tools: tools.map((t) => t.name) },
        "Listed available tools"
      );

      return { tools };
    });

    // Handle CallTool request
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
   */
  async start(): Promise<void> {
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
   * Gracefully shuts down the MCP server
   *
   * Closes the server connection and exits the process. Called automatically
   * on SIGINT/SIGTERM signals.
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down MCP server");

    try {
      await this.server.close();
      this.logger.info("MCP server shut down successfully");
      process.exit(0);
    } catch (error) {
      this.logger.error({ error }, "Error during shutdown");
      process.exit(1);
    }
  }
}
