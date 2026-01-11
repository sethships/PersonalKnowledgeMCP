/**
 * MCP Tool Registry
 *
 * This module provides abstraction for managing multiple MCP tools, enabling
 * dynamic tool discovery and routing without hardcoding tool names in the server.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { SearchService } from "../../services/types.js";
import type { RepositoryMetadataService } from "../../repositories/types.js";
import type { IncrementalUpdateCoordinator } from "../../services/incremental-update-coordinator.js";
import type { MCPRateLimiter } from "../rate-limiter.js";
import type { JobTracker } from "../job-tracker.js";
import type { GraphService } from "../../services/graph-service-types.js";
import type { ToolRegistry, ToolHandler } from "../types.js";
import { semanticSearchToolDefinition, createSemanticSearchHandler } from "./semantic-search.js";
import {
  listIndexedRepositoriesToolDefinition,
  createListRepositoriesHandler,
} from "./list-indexed-repositories.js";
import {
  triggerIncrementalUpdateToolDefinition,
  createTriggerUpdateHandler,
} from "./trigger-incremental-update.js";
import {
  getUpdateStatusToolDefinition,
  createGetUpdateStatusHandler,
} from "./get-update-status.js";
import { getDependenciesToolDefinition, createGetDependenciesHandler } from "./get-dependencies.js";
import { getDependentsToolDefinition, createGetDependentsHandler } from "./get-dependents.js";

/**
 * Dependencies for tool registry creation
 *
 * Required dependencies are always needed, optional dependencies
 * enable additional administrative tools.
 */
export interface ToolRegistryDependencies {
  /** Required: Search service for semantic_search tool */
  searchService: SearchService;
  /** Required: Repository metadata service for list_indexed_repositories tool */
  repositoryService: RepositoryMetadataService;
  /** Optional: Update coordinator for trigger_incremental_update tool */
  updateCoordinator?: IncrementalUpdateCoordinator;
  /** Optional: Rate limiter for trigger_incremental_update tool */
  rateLimiter?: MCPRateLimiter;
  /** Optional: Job tracker for async update operations */
  jobTracker?: JobTracker;
  /** Optional: GraphService for graph-based dependency queries */
  graphService?: GraphService;
}

/**
 * Creates the tool registry with all available MCP tools
 *
 * This factory function:
 * - Instantiates all tool handlers with their dependencies
 * - Maps tool names to definitions and handlers
 * - Enables easy addition of new tools without modifying the MCP server
 * - Conditionally registers administrative tools when dependencies are provided
 *
 * @param searchService - Injected search service for semantic_search tool
 * @param repositoryService - Injected repository metadata service for list_indexed_repositories tool
 * @returns Complete tool registry with all available tools
 *
 * @example
 * ```typescript
 * // Legacy usage (backwards compatible)
 * const registry = createToolRegistry(searchService, repositoryService);
 *
 * // New usage with optional admin tools
 * const registry = createToolRegistry({
 *   searchService,
 *   repositoryService,
 *   updateCoordinator,
 *   rateLimiter,
 *   jobTracker,
 * });
 * ```
 */
export function createToolRegistry(
  searchService: SearchService,
  repositoryService: RepositoryMetadataService
): ToolRegistry;
export function createToolRegistry(deps: ToolRegistryDependencies): ToolRegistry;
export function createToolRegistry(
  searchServiceOrDeps: SearchService | ToolRegistryDependencies,
  repositoryService?: RepositoryMetadataService
): ToolRegistry {
  // Handle both legacy and new signatures
  let deps: ToolRegistryDependencies;
  if (repositoryService !== undefined) {
    // Legacy signature: (searchService, repositoryService)
    deps = {
      searchService: searchServiceOrDeps as SearchService,
      repositoryService,
    };
  } else {
    // New signature: (deps)
    deps = searchServiceOrDeps as ToolRegistryDependencies;
  }

  // Build the base registry with required tools
  const registry: ToolRegistry = {
    semantic_search: {
      definition: semanticSearchToolDefinition,
      handler: createSemanticSearchHandler(deps.searchService),
    },
    list_indexed_repositories: {
      definition: listIndexedRepositoriesToolDefinition,
      handler: createListRepositoriesHandler(deps.repositoryService),
    },
  };

  // Conditionally add administrative tools when all dependencies are provided
  if (deps.updateCoordinator && deps.rateLimiter && deps.jobTracker) {
    registry["trigger_incremental_update"] = {
      definition: triggerIncrementalUpdateToolDefinition,
      handler: createTriggerUpdateHandler({
        repositoryService: deps.repositoryService,
        updateCoordinator: deps.updateCoordinator,
        rateLimiter: deps.rateLimiter,
        jobTracker: deps.jobTracker,
      }),
    };

    registry["get_update_status"] = {
      definition: getUpdateStatusToolDefinition,
      handler: createGetUpdateStatusHandler({
        jobTracker: deps.jobTracker,
      }),
    };
  }

  // Conditionally add graph-based tools when GraphService is provided
  if (deps.graphService) {
    registry["get_dependencies"] = {
      definition: getDependenciesToolDefinition,
      handler: createGetDependenciesHandler(deps.graphService),
    };

    registry["get_dependents"] = {
      definition: getDependentsToolDefinition,
      handler: createGetDependentsHandler(deps.graphService),
    };
  }

  return registry;
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
export function getToolHandler(registry: ToolRegistry, toolName: string): ToolHandler | undefined {
  return registry[toolName]?.handler;
}
