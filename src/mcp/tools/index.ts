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
import type { DocumentSearchService } from "../../services/document-search-types.js";
import type { ImageSearchService } from "../../services/image-search-types.js";
import type { ListWatchedFoldersService } from "../../services/list-watched-folders-types.js";
import type { ToolRegistry, ToolHandler } from "../types.js";
import { semanticSearchToolDefinition, createSemanticSearchHandler } from "./semantic-search.js";
import { searchDocumentsToolDefinition, createSearchDocumentsHandler } from "./search-documents.js";
import { searchImagesToolDefinition, createSearchImagesHandler } from "./search-images.js";
import {
  listWatchedFoldersToolDefinition,
  createListWatchedFoldersHandler,
} from "./list-watched-folders.js";
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
import { getArchitectureToolDefinition, createGetArchitectureHandler } from "./get-architecture.js";
import { findPathToolDefinition, createFindPathHandler } from "./find-path.js";
import {
  getGraphMetricsToolDefinition,
  createGetGraphMetricsHandler,
} from "./get-graph-metrics.js";

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
  /** Optional: DocumentSearchService for document semantic search */
  documentSearchService?: DocumentSearchService;
  /** Optional: ImageSearchService for image metadata search */
  imageSearchService?: ImageSearchService;
  /** Optional: ListWatchedFoldersService for listing watched folders */
  listWatchedFoldersService?: ListWatchedFoldersService;
  /** Optional: Human-readable reason why update tools are unavailable */
  updateToolsUnavailableReason?: string;
}

/**
 * Creates a stub tool handler that returns a service_unavailable error.
 *
 * Used when update tools are registered but their dependencies (GitHub PAT,
 * update coordinator, etc.) are not available.
 *
 * @param toolName - Name of the tool (for error message context)
 * @param reason - Human-readable reason why the tool is unavailable
 * @returns ToolHandler that always returns an error response
 */
export function createUnavailableToolHandler(toolName: string, reason: string): ToolHandler {
  return () =>
    Promise.resolve({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: "service_unavailable",
            message: `${toolName} is currently unavailable: ${reason}`,
          }),
        },
      ],
      isError: true,
    });
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
      handler: createSemanticSearchHandler(deps.searchService, deps.documentSearchService),
    },
    list_indexed_repositories: {
      definition: listIndexedRepositoriesToolDefinition,
      handler: createListRepositoriesHandler(deps.repositoryService),
    },
  };

  // Always register update tools — use real handlers when deps are available, stubs otherwise
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
  } else {
    const reason =
      deps.updateToolsUnavailableReason ||
      "Required dependencies (GitHub PAT, update coordinator) are not configured";

    registry["trigger_incremental_update"] = {
      definition: triggerIncrementalUpdateToolDefinition,
      handler: createUnavailableToolHandler("trigger_incremental_update", reason),
    };

    registry["get_update_status"] = {
      definition: getUpdateStatusToolDefinition,
      handler: createUnavailableToolHandler("get_update_status", reason),
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

    registry["get_architecture"] = {
      definition: getArchitectureToolDefinition,
      handler: createGetArchitectureHandler(deps.graphService),
    };

    registry["find_path"] = {
      definition: findPathToolDefinition,
      handler: createFindPathHandler(deps.graphService),
    };

    registry["get_graph_metrics"] = {
      definition: getGraphMetricsToolDefinition,
      handler: createGetGraphMetricsHandler(),
    };
  }

  // Conditionally add document search tool when DocumentSearchService is provided
  if (deps.documentSearchService) {
    registry["search_documents"] = {
      definition: searchDocumentsToolDefinition,
      handler: createSearchDocumentsHandler(deps.documentSearchService),
    };
  }

  // Conditionally add image search tool when ImageSearchService is provided
  if (deps.imageSearchService) {
    registry["search_images"] = {
      definition: searchImagesToolDefinition,
      handler: createSearchImagesHandler(deps.imageSearchService),
    };
  }

  // Conditionally add list watched folders tool when ListWatchedFoldersService is provided
  if (deps.listWatchedFoldersService) {
    registry["list_watched_folders"] = {
      definition: listWatchedFoldersToolDefinition,
      handler: createListWatchedFoldersHandler(deps.listWatchedFoldersService),
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
