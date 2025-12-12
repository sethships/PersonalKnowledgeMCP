/**
 * MCP Tool Registry
 *
 * This module provides abstraction for managing multiple MCP tools, enabling
 * dynamic tool discovery and routing without hardcoding tool names in the server.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { SearchService } from "../../services/types.js";
import type { ToolRegistry, ToolHandler } from "../types.js";
import {
  semanticSearchToolDefinition,
  createSemanticSearchHandler,
} from "./semantic-search.js";

/**
 * Creates the tool registry with all available MCP tools
 *
 * This factory function:
 * - Instantiates all tool handlers with their dependencies
 * - Maps tool names to definitions and handlers
 * - Enables easy addition of new tools without modifying the MCP server
 *
 * @param searchService - Injected search service for semantic_search tool
 * @returns Complete tool registry with all available tools
 *
 * @example
 * ```typescript
 * const searchService = new SearchServiceImpl(provider, storage, repoService);
 * const registry = createToolRegistry(searchService);
 *
 * // List all tool names
 * const toolNames = Object.keys(registry);
 *
 * // Get a specific tool handler
 * const handler = getToolHandler(registry, 'semantic_search');
 * ```
 */
export function createToolRegistry(searchService: SearchService): ToolRegistry {
  return {
    semantic_search: {
      definition: semanticSearchToolDefinition,
      handler: createSemanticSearchHandler(searchService),
    },
    // Future tools can be added here, for example:
    // list_repositories: {
    //   definition: listRepositoriesToolDefinition,
    //   handler: createListRepositoriesHandler(repositoryService),
    // },
  };
}

/**
 * Gets all tool definitions for ListTools request
 *
 * Extracts the tool definitions from the registry to return in response
 * to MCP ListTools requests.
 *
 * @param registry - Tool registry created by createToolRegistry
 * @returns Array of tool definitions
 */
export function getToolDefinitions(registry: ToolRegistry): Tool[] {
  return Object.values(registry).map((entry) => entry.definition);
}

/**
 * Gets handler for a specific tool by name
 *
 * Used by the MCP server to route CallTool requests to the appropriate handler.
 * Returns undefined if the tool doesn't exist, allowing the server to return
 * a MethodNotFound error.
 *
 * @param registry - Tool registry created by createToolRegistry
 * @param toolName - Name of the tool to retrieve
 * @returns Tool handler function, or undefined if tool not found
 */
export function getToolHandler(
  registry: ToolRegistry,
  toolName: string
): ToolHandler | undefined {
  return registry[toolName]?.handler;
}
