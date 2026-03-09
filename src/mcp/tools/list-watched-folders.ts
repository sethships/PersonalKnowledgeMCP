/**
 * list_watched_folders MCP Tool Implementation
 *
 * This module implements the list_watched_folders tool for the MCP server,
 * enabling discovery of configured watched folders and their indexing status.
 * This helps AI assistants understand what document sources are available.
 *
 * @module mcp/tools/list-watched-folders
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type {
  ListWatchedFoldersService,
  ListWatchedFoldersResponse,
} from "../../services/list-watched-folders-types.js";
import { validateListWatchedFoldersArgs } from "../validation.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:list-watched-folders");
  }
  return logger;
}

/**
 * MCP tool definition for listing watched folders
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 */
export const listWatchedFoldersToolDefinition: Tool = {
  name: "list_watched_folders",
  description:
    "List all configured watched folders and their indexing status. " +
    "Use this to understand what document sources are available for search.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

/**
 * Creates the list_watched_folders tool handler
 *
 * This factory function enables dependency injection of the ListWatchedFoldersService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param listWatchedFoldersService - Injected service for listing watched folders
 * @returns Tool handler function that lists watched folders
 *
 * @example
 * ```typescript
 * const service = new ListWatchedFoldersServiceImpl(folderWatcher);
 * const handler = createListWatchedFoldersHandler(service);
 * const result = await handler({});
 * ```
 */
export function createListWatchedFoldersHandler(
  listWatchedFoldersService: ListWatchedFoldersService
): ToolHandler {
  return async (_args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    try {
      log.info("Executing list_watched_folders tool");

      // Step 1: Validate MCP arguments (no parameters, but validates input is an object)
      validateListWatchedFoldersArgs(_args);

      // Call service to get folder list
      const response = await listWatchedFoldersService.listWatchedFolders();

      // Format response for MCP
      const content = formatListWatchedFoldersResponse(response);

      const duration = performance.now() - startTime;
      log.info(
        {
          folderCount: response.folders.length,
          duration_ms: Math.round(duration),
        },
        "list_watched_folders completed successfully"
      );

      return {
        content: [content],
        isError: false,
      };
    } catch (error) {
      // Handle all errors gracefully
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "list_watched_folders failed");

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
 * Formats ListWatchedFoldersResponse as MCP TextContent
 *
 * @param response - Response from ListWatchedFoldersService
 * @returns MCP text content with formatted JSON
 */
function formatListWatchedFoldersResponse(response: ListWatchedFoldersResponse): TextContent {
  const output = {
    folders: response.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      path: folder.path,
      enabled: folder.enabled,
      documentCount: folder.documentCount,
      imageCount: folder.imageCount,
      lastScanAt: folder.lastScanAt,
      watcherStatus: folder.watcherStatus,
      includePatterns: folder.includePatterns,
      excludePatterns: folder.excludePatterns,
    })),
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
