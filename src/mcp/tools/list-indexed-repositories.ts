/**
 * list_indexed_repositories MCP Tool Implementation
 *
 * This module implements the list_indexed_repositories tool for the MCP server,
 * enabling Claude Code to discover what repositories are indexed in the knowledge base.
 */

import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../../repositories/types.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";

/**
 * Response format for a single indexed repository (external API format)
 *
 * Maps internal RepositoryInfo camelCase to external snake_case for JSON API convention.
 */
interface IndexedRepositoryResponse {
  /** Unique repository identifier */
  name: string;
  /** Git clone URL */
  url: string;
  /** ChromaDB collection name */
  collection_name: string;
  /** Number of files indexed */
  file_count: number;
  /** Total number of chunks created */
  chunk_count: number;
  /** ISO 8601 timestamp of last indexing */
  last_indexed: string;
  /** Current repository status */
  status: "ready" | "indexing" | "error";
  /** Duration of last indexing operation in milliseconds */
  index_duration_ms: number;
  /** Error message if status is "error" */
  error_message?: string;
}

/**
 * Summary statistics across all repositories
 */
interface RepositorySummary {
  /** Total number of repositories */
  total_repositories: number;
  /** Sum of all files indexed across repositories */
  total_files_indexed: number;
  /** Sum of all chunks across repositories */
  total_chunks: number;
}

/**
 * Complete response for list_indexed_repositories tool
 */
interface ListIndexedRepositoriesResponse {
  /** Array of repository information */
  repositories: IndexedRepositoryResponse[];
  /** Aggregate statistics */
  summary: RepositorySummary;
}

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:list-indexed-repositories");
  }
  return logger;
}

/**
 * Formats repository metadata for MCP response
 *
 * Maps internal RepositoryInfo to external API format with snake_case fields
 * and calculates summary statistics across all repositories.
 *
 * @param repositories - Array of repository metadata from service
 * @returns Formatted response with repositories and summary
 */
function formatListRepositoriesResponse(
  repositories: RepositoryInfo[]
): ListIndexedRepositoriesResponse {
  // Map each repository to external API format
  const formattedRepos: IndexedRepositoryResponse[] = repositories.map((repo) => ({
    name: repo.name,
    url: repo.url,
    collection_name: repo.collectionName,
    file_count: repo.fileCount,
    chunk_count: repo.chunkCount,
    last_indexed: repo.lastIndexedAt,
    status: repo.status,
    index_duration_ms: repo.indexDurationMs,
    error_message: repo.errorMessage,
  }));

  // Calculate summary statistics
  const summary: RepositorySummary = {
    total_repositories: repositories.length,
    total_files_indexed: repositories.reduce((sum, r) => sum + r.fileCount, 0),
    total_chunks: repositories.reduce((sum, r) => sum + r.chunkCount, 0),
  };

  return {
    repositories: formattedRepos,
    summary,
  };
}

/**
 * MCP tool definition for list_indexed_repositories
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 */
export const listIndexedRepositoriesTool: Tool = {
  name: "list_indexed_repositories",
  description:
    "Lists all repositories currently indexed in the knowledge base. " +
    "Returns repository names, URLs, indexing status (ready/indexing/error), " +
    "file and chunk counts, last indexed timestamps, and summary statistics. " +
    "Use this to discover what repositories are available for semantic search.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
};

/**
 * Creates the list_indexed_repositories tool handler
 *
 * This factory function enables dependency injection of the RepositoryMetadataService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param repositoryService - Injected repository metadata service instance
 * @returns Tool handler function that lists all indexed repositories
 *
 * @example
 * ```typescript
 * const repositoryService = RepositoryMetadataStoreImpl.getInstance();
 * const handler = createListRepositoriesHandler(repositoryService);
 * const result = await handler({});
 * ```
 */
export function createListRepositoriesHandler(
  repositoryService: RepositoryMetadataService
): ToolHandler {
  return async (_args: unknown): Promise<CallToolResult> => {
    const log = getLogger();
    const startTime = performance.now();

    try {
      log.debug("Listing indexed repositories");

      // Fetch all repositories from metadata service
      const repositories = await repositoryService.listRepositories();

      // Format response with summary statistics
      const response = formatListRepositoriesResponse(repositories);

      const duration = performance.now() - startTime;
      log.info(
        {
          repositoryCount: response.summary.total_repositories,
          totalFiles: response.summary.total_files_indexed,
          totalChunks: response.summary.total_chunks,
          duration_ms: Math.round(duration),
        },
        "list_indexed_repositories completed successfully"
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "list_indexed_repositories failed");

      const mcpError = mapToMCPError(error);

      return {
        content: [
          {
            type: "text",
            text: `Error: ${mcpError.message}`,
          },
        ],
        isError: true,
      };
    }
  };
}
