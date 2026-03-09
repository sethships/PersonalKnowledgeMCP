/**
 * semantic_search MCP Tool Implementation
 *
 * This module implements the semantic_search tool for the MCP server, enabling
 * natural language search across indexed code repositories using vector similarity.
 * Optionally includes document search results when include_documents is true.
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { SearchService, SearchResponse } from "../../services/types.js";
import type {
  DocumentSearchService,
  DocumentSearchResponse,
  DocumentSearchResult,
} from "../../services/document-search-types.js";
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
    "or locate specific functionality across your indexed codebases. " +
    "Set include_documents=true to also search indexed documents (PDFs, DOCX, Markdown, TXT) " +
    "and get merged results ranked by similarity score.",
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
          "all indexed repositories with 'ready' status.",
      },
      language: {
        type: "string",
        description:
          "Optional programming language filter. If provided, only returns results from files " +
          "of the specified language. Supported values: typescript, tsx, javascript, jsx, python, java, go, rust, csharp, c, cpp. " +
          "Use this to narrow search results to a specific language.",
        enum: [
          "typescript",
          "tsx",
          "javascript",
          "jsx",
          "python",
          "java",
          "go",
          "rust",
          "csharp",
          "c",
          "cpp",
        ],
      },
      include_documents: {
        type: "boolean",
        description:
          "When true, also searches indexed documents (PDFs, DOCX, Markdown, TXT) and " +
          "merges results with code results, ranked by similarity score. Each result " +
          "includes a source_type field ('code' or 'document'). Default: false.",
        default: false,
      },
    },
    required: ["query"],
  },
};

/**
 * Creates the semantic_search tool handler
 *
 * This factory function enables dependency injection of the SearchService and
 * optional DocumentSearchService, allowing for easier testing and loose coupling
 * between MCP layer and business logic.
 *
 * @param searchService - Injected search service instance for code search
 * @param documentSearchService - Optional document search service for include_documents support
 * @returns Tool handler function that executes semantic search
 *
 * @example
 * ```typescript
 * const searchService = new SearchServiceImpl(provider, storage, repoService);
 * const handler = createSemanticSearchHandler(searchService);
 * const result = await handler({ query: "authentication", limit: 5 });
 * ```
 */
export function createSemanticSearchHandler(
  searchService: SearchService,
  documentSearchService?: DocumentSearchService
): ToolHandler {
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
          language: validatedArgs.language,
          include_documents: validatedArgs.include_documents,
        },
        "Executing semantic_search tool"
      );

      // Step 2: Execute search(es)
      if (validatedArgs.include_documents) {
        // Run code search and document search in parallel
        const content = await executeIncludeDocumentsSearch(
          searchService,
          documentSearchService,
          validatedArgs,
          log
        );

        const duration = performance.now() - startTime;
        log.info(
          { duration_ms: Math.round(duration) },
          "semantic_search with include_documents completed"
        );

        return { content: [content], isError: false };
      }

      // Code-only path: identical to legacy behavior
      const response = await searchService.search({
        query: validatedArgs.query,
        limit: validatedArgs.limit,
        threshold: validatedArgs.threshold,
        repository: validatedArgs.repository,
        language: validatedArgs.language,
      });

      // Step 3: Format response for MCP (legacy format)
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
 * Executes parallel code + document search and merges results
 *
 * Runs both searches concurrently via Promise.allSettled. If DocumentSearchService
 * is not available, returns code-only results with a warning.
 *
 * @param searchService - Code search service
 * @param documentSearchService - Optional document search service
 * @param validatedArgs - Validated tool arguments
 * @param log - Logger instance
 * @returns Formatted MCP TextContent with merged results
 */
async function executeIncludeDocumentsSearch(
  searchService: SearchService,
  documentSearchService: DocumentSearchService | undefined,
  validatedArgs: {
    query: string;
    limit: number;
    threshold: number;
    repository?: string;
    language?: string;
  },
  log: ReturnType<typeof getComponentLogger>
): Promise<TextContent> {
  // Build code search promise
  const codeSearchPromise = searchService.search({
    query: validatedArgs.query,
    limit: validatedArgs.limit,
    threshold: validatedArgs.threshold,
    repository: validatedArgs.repository,
    language: validatedArgs.language,
  });

  // If no document search service, return code-only with warning
  if (!documentSearchService) {
    log.warn("include_documents=true but DocumentSearchService not available, returning code only");
    const codeResponse = await codeSearchPromise;
    return formatMergedResponse(codeResponse, null, validatedArgs.limit);
  }

  // Build document search promise
  const docSearchPromise = documentSearchService.searchDocuments({
    query: validatedArgs.query,
    limit: validatedArgs.limit,
    threshold: validatedArgs.threshold,
  });

  // Run both searches in parallel using Promise.allSettled for graceful degradation
  const [codeSettled, docSettled] = await Promise.allSettled([codeSearchPromise, docSearchPromise]);

  // Code search must succeed; document search can gracefully degrade
  if (codeSettled.status === "rejected") {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw codeSettled.reason;
  }

  const codeResponse = codeSettled.value;
  let docResponse: DocumentSearchResponse | null = null;

  if (docSettled.status === "fulfilled") {
    docResponse = docSettled.value;
  } else {
    const docError: unknown = docSettled.reason;
    log.error({ error: docError }, "Document search failed during include_documents search");
  }

  return formatMergedResponse(codeResponse, docResponse, validatedArgs.limit);
}

/**
 * Unified result type for merged code + document results
 */
interface MergedResult {
  source_type: "code" | "document";
  content: string;
  similarity_score: number;
  metadata: Record<string, unknown>;
}

/**
 * Formats merged code + document results as MCP TextContent
 *
 * Results from both sources are tagged with source_type, merged, sorted by
 * similarity_score descending, and truncated to the requested limit.
 *
 * @param codeResponse - Code search response
 * @param docResponse - Document search response (null if unavailable)
 * @param limit - Maximum total results to return
 * @returns MCP text content with formatted JSON
 */
function formatMergedResponse(
  codeResponse: SearchResponse,
  docResponse: DocumentSearchResponse | null,
  limit: number
): TextContent {
  const warnings: string[] = [];

  // Convert code results to unified format
  const codeResults: MergedResult[] = codeResponse.results.map((result) => ({
    source_type: "code" as const,
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
  }));

  // Convert document results to unified format
  let docResults: MergedResult[] = [];
  if (docResponse) {
    docResults = docResponse.results.map((result: DocumentSearchResult) => ({
      source_type: "document" as const,
      content: result.content,
      similarity_score: result.similarity,
      metadata: {
        document_path: result.documentPath,
        document_type: result.documentType,
        folder: result.folder,
        ...(result.documentTitle && { document_title: result.documentTitle }),
        ...(result.documentAuthor && { document_author: result.documentAuthor }),
        ...(result.pageNumber !== undefined && { page_number: result.pageNumber }),
        ...(result.sectionHeading && { section_heading: result.sectionHeading }),
        ...(result.isTable && { is_table: result.isTable }),
        ...(result.tableCaption && { table_caption: result.tableCaption }),
      },
    }));
  } else {
    warnings.push("Document search service is not available. Only code results are included.");
  }

  // Merge, sort by similarity_score descending, and truncate to limit
  const merged = [...codeResults, ...docResults]
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, limit);

  const codeMatchCount = merged.filter((r) => r.source_type === "code").length;
  const docMatchCount = merged.filter((r) => r.source_type === "document").length;

  // Combine warnings from both searches
  const allWarnings: string[] = [...warnings];
  if (codeResponse.metadata.warnings?.length) {
    allWarnings.push(...codeResponse.metadata.warnings.map((w) => w.message));
  }
  if (docResponse?.metadata.warnings?.length) {
    allWarnings.push(...docResponse.metadata.warnings.map((w) => w.message));
  }

  const output = {
    results: merged,
    metadata: {
      total_matches: merged.length,
      code_matches: codeMatchCount,
      document_matches: docMatchCount,
      query_time_ms: codeResponse.metadata.query_time_ms + (docResponse?.metadata.queryTimeMs ?? 0),
      embedding_time_ms: codeResponse.metadata.embedding_time_ms,
      search_time_ms: codeResponse.metadata.search_time_ms,
      repositories_searched: codeResponse.metadata.repositories_searched,
      ...(docResponse && {
        document_folders_searched: docResponse.metadata.searchedFolders,
      }),
      ...(allWarnings.length > 0 && { warnings: allWarnings }),
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}

/**
 * Formats SearchResponse as MCP TextContent (legacy code-only format)
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
      ...(response.metadata.warnings?.length && { warnings: response.metadata.warnings }),
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
