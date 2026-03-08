/**
 * search_images MCP Tool Implementation
 *
 * This module implements the search_images tool for the MCP server, enabling
 * metadata-based search across indexed images (JPEG, PNG, GIF, WebP, TIFF).
 * Supports filtering by date, dimensions, format, and filename patterns.
 *
 * @module mcp/tools/search-images
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { ImageSearchService, ImageSearchResponse } from "../../services/image-search-types.js";
import { validateSearchImagesArgs } from "../validation.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:search-images");
  }
  return logger;
}

/**
 * MCP tool definition for image search
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 */
export const searchImagesToolDefinition: Tool = {
  name: "search_images",
  description:
    "Search indexed images by metadata including date, dimensions, format, and EXIF data. " +
    "Use this to find screenshots, photos, diagrams, or other visual assets.",
  inputSchema: {
    type: "object",
    properties: {
      folder: {
        type: "string",
        description: "Limit search to a specific watched folder.",
      },
      format: {
        type: "array",
        items: {
          type: "string",
          enum: ["jpeg", "png", "gif", "webp", "tiff", "all"],
        },
        description: "Filter by image format.",
        default: ["all"],
      },
      date_from: {
        type: "string",
        description: "Filter images taken/modified on or after this date (YYYY-MM-DD).",
      },
      date_to: {
        type: "string",
        description: "Filter images taken/modified on or before this date (YYYY-MM-DD).",
      },
      min_width: {
        type: "integer",
        description: "Minimum image width in pixels.",
        minimum: 1,
      },
      min_height: {
        type: "integer",
        description: "Minimum image height in pixels.",
        minimum: 1,
      },
      filename_pattern: {
        type: "string",
        description: "Glob pattern to match filenames (e.g., 'screenshot*', '*.diagram.*').",
      },
      limit: {
        type: "integer",
        description: "Maximum number of results to return.",
        default: 20,
        minimum: 1,
        maximum: 100,
      },
    },
  },
};

/**
 * Creates the search_images tool handler
 *
 * This factory function enables dependency injection of the ImageSearchService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param imageSearchService - Injected image search service instance
 * @returns Tool handler function that executes image search
 *
 * @example
 * ```typescript
 * const service = new ImageSearchServiceImpl(storageClient);
 * const handler = createSearchImagesHandler(service);
 * const result = await handler({ format: ["png"], min_width: 800 });
 * ```
 */
export function createSearchImagesHandler(imageSearchService: ImageSearchService): ToolHandler {
  return async (args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    try {
      // Step 1: Validate MCP arguments
      const validatedArgs = validateSearchImagesArgs(args);

      log.info(
        {
          folder: validatedArgs.folder,
          format: validatedArgs.format,
          date_from: validatedArgs.date_from,
          date_to: validatedArgs.date_to,
          min_width: validatedArgs.min_width,
          min_height: validatedArgs.min_height,
          filename_pattern: validatedArgs.filename_pattern,
          limit: validatedArgs.limit,
        },
        "Executing search_images tool"
      );

      // Step 2: Call ImageSearchService with validated parameters
      const response = await imageSearchService.searchImages({
        folder: validatedArgs.folder,
        format: validatedArgs.format,
        date_from: validatedArgs.date_from,
        date_to: validatedArgs.date_to,
        min_width: validatedArgs.min_width,
        min_height: validatedArgs.min_height,
        filename_pattern: validatedArgs.filename_pattern,
        limit: validatedArgs.limit,
      });

      // Step 3: Format response for MCP
      const content = formatImageSearchResponse(response);

      const duration = performance.now() - startTime;
      log.info(
        {
          resultCount: response.results.length,
          duration_ms: Math.round(duration),
        },
        "search_images completed successfully"
      );

      return {
        content: [content],
        isError: false,
      };
    } catch (error) {
      // Step 4: Handle all errors gracefully
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "search_images failed");

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
 * Formats ImageSearchResponse as MCP TextContent
 *
 * @param response - Image search response from ImageSearchService
 * @returns MCP text content with formatted JSON
 */
function formatImageSearchResponse(response: ImageSearchResponse): TextContent {
  const output = {
    results: response.results.map((result) => ({
      path: result.path,
      filename: result.filename,
      format: result.format,
      width: result.width,
      height: result.height,
      sizeBytes: result.sizeBytes,
      dateTaken: result.dateTaken,
      dateModified: result.dateModified,
      ...(result.exif && { exif: result.exif }),
      folder: result.folder,
    })),
    metadata: {
      totalResults: response.metadata.totalResults,
      queryTimeMs: response.metadata.queryTimeMs,
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
