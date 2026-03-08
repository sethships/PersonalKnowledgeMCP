/**
 * search_documents MCP Tool Implementation
 *
 * This module implements the search_documents tool for the MCP server, enabling
 * natural language search across indexed documents (PDFs, DOCX, Markdown, TXT)
 * using vector similarity. This is the document counterpart to the semantic_search
 * tool which focuses on code repositories.
 *
 * @module mcp/tools/search-documents
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type {
  DocumentSearchService,
  DocumentSearchResponse,
} from "../../services/document-search-types.js";
import { validateSearchDocumentsArgs } from "../validation.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:search-documents");
  }
  return logger;
}

/**
 * MCP tool definition for document search
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 */
export const searchDocumentsToolDefinition: Tool = {
  name: "search_documents",
  description:
    "Performs semantic search across indexed documents (PDFs, Word documents, Markdown files, " +
    "and text files) using vector similarity. Returns relevant document passages with metadata " +
    "including document path, type, page numbers, section headings, and similarity scores. " +
    "Use this to find information in your indexed document collections.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural language search query describing the information you're looking for. " +
          "Be specific for best results (e.g., 'neural network architecture design' " +
          "instead of 'AI').",
        minLength: 1,
        maxLength: 1000,
      },
      document_types: {
        type: "array",
        description:
          "Filter results to specific document types. Use 'all' to search all types. " +
          "Defaults to ['all'] if not specified.",
        items: {
          type: "string",
          enum: ["pdf", "docx", "markdown", "txt", "all"],
        },
        default: ["all"],
      },
      folder: {
        type: "string",
        description:
          "Optional folder name to limit search scope. If omitted, searches across " +
          "all indexed document folders.",
      },
      limit: {
        type: "integer",
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
      include_tables: {
        type: "string",
        description:
          "Controls whether table content is included in search results. " +
          "'include' (default) searches both tables and text. " +
          "'only' searches only table chunks. " +
          "'exclude' excludes table chunks from results.",
        enum: ["include", "only", "exclude"],
        default: "include",
      },
    },
    required: ["query"],
  },
};

/**
 * Creates the search_documents tool handler
 *
 * This factory function enables dependency injection of the DocumentSearchService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param documentSearchService - Injected document search service instance
 * @returns Tool handler function that executes document search
 *
 * @example
 * ```typescript
 * const service = new DocumentSearchServiceImpl(provider, factory, storage, repoService);
 * const handler = createSearchDocumentsHandler(service);
 * const result = await handler({ query: "machine learning", document_types: ["pdf"] });
 * ```
 */
export function createSearchDocumentsHandler(
  documentSearchService: DocumentSearchService
): ToolHandler {
  return async (args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    try {
      // Step 1: Validate MCP arguments
      const validatedArgs = validateSearchDocumentsArgs(args);

      log.info(
        {
          query: validatedArgs.query,
          limit: validatedArgs.limit,
          threshold: validatedArgs.threshold,
          document_types: validatedArgs.document_types,
          folder: validatedArgs.folder,
        },
        "Executing search_documents tool"
      );

      // Step 2: Call DocumentSearchService with validated parameters
      const response = await documentSearchService.searchDocuments({
        query: validatedArgs.query,
        limit: validatedArgs.limit,
        threshold: validatedArgs.threshold,
        document_types: validatedArgs.document_types,
        folder: validatedArgs.folder,
        include_tables: validatedArgs.include_tables,
      });

      // Step 3: Format response for MCP
      const content = formatDocumentSearchResponse(response);

      const duration = performance.now() - startTime;
      log.info(
        {
          resultCount: response.results.length,
          duration_ms: Math.round(duration),
          searchedFolders: response.metadata.searchedFolders,
        },
        "search_documents completed successfully"
      );

      return {
        content: [content],
        isError: false,
      };
    } catch (error) {
      // Step 4: Handle all errors gracefully
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "search_documents failed");

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
 * Formats DocumentSearchResponse as MCP TextContent
 *
 * Converts the DocumentSearchService response into a JSON structure suitable for
 * consumption by MCP clients. The JSON is formatted with indentation for
 * readability in Claude Code's interface.
 *
 * @param response - Document search response from DocumentSearchService
 * @returns MCP text content with formatted JSON
 */
function formatDocumentSearchResponse(response: DocumentSearchResponse): TextContent {
  const output = {
    results: response.results.map((result) => ({
      content: result.content,
      documentPath: result.documentPath,
      documentTitle: result.documentTitle,
      documentType: result.documentType,
      pageNumber: result.pageNumber,
      sectionHeading: result.sectionHeading,
      similarity: result.similarity,
      folder: result.folder,
      ...(result.isTable && {
        isTable: result.isTable,
        tableCaption: result.tableCaption,
        tableColumnCount: result.tableColumnCount,
        tableRowCount: result.tableRowCount,
      }),
    })),
    metadata: {
      totalResults: response.metadata.totalResults,
      queryTimeMs: response.metadata.queryTimeMs,
      searchedFolders: response.metadata.searchedFolders,
      searchedDocumentTypes: response.metadata.searchedDocumentTypes,
      ...(response.metadata.warnings?.length && { warnings: response.metadata.warnings }),
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
