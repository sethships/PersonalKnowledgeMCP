/**
 * semantic_search MCP Tool Implementation
 *
 * This module implements the semantic_search tool for the MCP server, enabling
 * natural language search across indexed code repositories using vector similarity.
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { SearchService, SearchResponse } from "../../services/types.js";
import { validateSemanticSearchArgs } from "../validation.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:semantic-search");
  }
  return logger;
}

/**
 * MCP tool definition for semantic search
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 */
export const semanticSearchToolDefinition: Tool = {
  name: "semantic_search",
  description:
    "Performs semantic search across indexed code repositories using vector similarity. " +
    "Returns relevant code chunks with metadata including file paths, similarity scores, " +
    "and repository information. Use this to find code examples, understand implementations, " +
    "or locate specific functionality across your indexed codebases.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural language search query describing the code, concept, or functionality " +
          "you're looking for. Be specific for best results (e.g., 'JWT authentication " +
          "middleware' instead of 'auth').",
        minLength: 1,
        maxLength: 1000,
      },
      limit: {
        type: "number",
        description:
          "Maximum number of results to return. Higher values provide more context but " +
          "may include less relevant results. Range: 1-50.",
        minimum: 1,
        maximum: 50,
        default: 10,
      },
      threshold: {
        type: "number",
        description:
          "Minimum similarity score threshold (0.0-1.0). Higher values (e.g., 0.8) return " +
          "only highly relevant results. Lower values (e.g., 0.5) cast a wider net. " +
          "Default 0.7 provides a good balance.",
        minimum: 0.0,
        maximum: 1.0,
        default: 0.7,
      },
      repository: {
        type: "string",
        description:
          "Optional repository name to limit search scope. If omitted, searches across " +
          "all indexed repositories with 'ready' status. Use 'list_repositories' tool " +
          "to see available repositories.",
      },
    },
    required: ["query"],
  },
};

/**
 * Creates the semantic_search tool handler
 *
 * This factory function enables dependency injection of the SearchService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param searchService - Injected search service instance
 * @returns Tool handler function that executes semantic search
 *
 * @example
 * ```typescript
 * const searchService = new SearchServiceImpl(provider, storage, repoService);
 * const handler = createSemanticSearchHandler(searchService);
 * const result = await handler({ query: "authentication", limit: 5 });
 * ```
 */
export function createSemanticSearchHandler(searchService: SearchService): ToolHandler {
  return async (args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    try {
      // Step 1: Validate MCP arguments
      const validatedArgs = validateSemanticSearchArgs(args);

      log.info(
        {
          query: validatedArgs.query,
          limit: validatedArgs.limit,
          threshold: validatedArgs.threshold,
          repository: validatedArgs.repository,
        },
        "Executing semantic_search tool"
      );

      // Step 2: Call SearchService with validated parameters
      const response = await searchService.search({
        query: validatedArgs.query,
        limit: validatedArgs.limit,
        threshold: validatedArgs.threshold,
        repository: validatedArgs.repository,
      });

      // Step 3: Format response for MCP
      const content = formatSearchResponse(response);

      const duration = performance.now() - startTime;
      log.info(
        {
          resultCount: response.results.length,
          duration_ms: Math.round(duration),
          repositories: response.metadata.repositories_searched,
        },
        "semantic_search completed successfully"
      );

      return {
        content: [content],
        isError: false,
      };
    } catch (error) {
      // Step 4: Handle all errors gracefully
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "semantic_search failed");

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

/**
 * Formats SearchResponse as MCP TextContent
 *
 * Converts the SearchService response into a JSON structure suitable for
 * consumption by MCP clients. The JSON is formatted with indentation for
 * readability in Claude Code's interface.
 *
 * @param response - Search response from SearchService
 * @returns MCP text content with formatted JSON
 */
function formatSearchResponse(response: SearchResponse): TextContent {
  const output = {
    results: response.results.map((result) => ({
      content: result.content_snippet,
      similarity_score: result.similarity_score,
      metadata: {
        file_path: result.file_path,
        repository: result.repository,
        chunk_index: result.chunk_index,
        file_extension: result.metadata.file_extension,
        file_size_bytes: result.metadata.file_size_bytes,
        indexed_at: result.metadata.indexed_at,
      },
    })),
    metadata: {
      total_matches: response.metadata.total_matches,
      query_time_ms: response.metadata.query_time_ms,
      embedding_time_ms: response.metadata.embedding_time_ms,
      search_time_ms: response.metadata.search_time_ms,
      repositories_searched: response.metadata.repositories_searched,
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
