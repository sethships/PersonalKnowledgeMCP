/**
 * get_dependents MCP Tool Implementation
 *
 * This module implements the get_dependents tool for the MCP server, enabling
 * Claude Code and other MCP clients to query reverse dependencies (what depends
 * on a file, function, or class) in the knowledge graph.
 *
 * The tool is designed per PRD Section 6.1 (Tool 2: get_dependents).
 *
 * @module mcp/tools/get-dependents
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { GraphService, DependentResult } from "../../services/graph-service-types.js";
import { validateGetDependentsArgs } from "../validation.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler, GetDependentsArgs } from "../types.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:get-dependents");
  }
  return logger;
}

/**
 * MCP tool definition for get_dependents
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 *
 * Per PRD Section 6.1, this tool queries what depends on a given entity
 * (reverse dependencies / impact analysis).
 *
 * Key differences from get_dependencies:
 * - repository is OPTIONAL (omit to search all repositories)
 * - entity_type includes "package" for package-level impact analysis
 * - include_cross_repo enables cross-repository dependent search
 * - Response includes impact_analysis with severity metrics
 */
export const getDependentsToolDefinition: Tool = {
  name: "get_dependents",
  description:
    "Get all code that depends on a file, function, or class. Returns what imports, " +
    "calls, or extends the entity. Use this for impact analysis before refactoring.",
  inputSchema: {
    type: "object",
    properties: {
      entity_type: {
        type: "string",
        enum: ["file", "function", "class", "package"],
        description: "Type of entity to find dependents for",
      },
      entity_path: {
        type: "string",
        description:
          "For files: relative path (e.g., 'src/auth/middleware.ts'). " +
          "For functions/classes: name or fully qualified name (e.g., 'AuthMiddleware' or " +
          "'src/auth/middleware.ts::AuthMiddleware'). " +
          "For packages: package name or directory path.",
      },
      repository: {
        type: "string",
        description: "Repository name (omit to search all repositories)",
      },
      depth: {
        type: "integer",
        description:
          "Depth of transitive dependents to include (1 = direct only, 2+ = transitive). " +
          "Default: 1. Maximum: 5.",
        default: 1,
        minimum: 1,
        maximum: 5,
      },
      include_cross_repo: {
        type: "boolean",
        description: "Include dependents from other repositories. Default: false.",
        default: false,
      },
    },
    required: ["entity_type", "entity_path"],
  },
};

/**
 * Creates the get_dependents tool handler
 *
 * This factory function enables dependency injection of the GraphService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param graphService - Injected GraphService instance
 * @returns Tool handler function that executes dependent queries
 *
 * @example
 * ```typescript
 * const graphService = new GraphServiceImpl(neo4jClient);
 * const handler = createGetDependentsHandler(graphService);
 * const result = await handler({
 *   entity_type: "function",
 *   entity_path: "validateToken",
 *   repository: "my-project",
 *   depth: 2,
 *   include_cross_repo: false
 * });
 * ```
 */
export function createGetDependentsHandler(graphService: GraphService): ToolHandler {
  return async (args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    try {
      // Step 1: Validate MCP arguments
      const validatedArgs = validateGetDependentsArgs(args);

      log.info(
        {
          entity_type: validatedArgs.entity_type,
          entity_path: validatedArgs.entity_path,
          repository: validatedArgs.repository,
          depth: validatedArgs.depth,
          include_cross_repo: validatedArgs.include_cross_repo,
        },
        "Executing get_dependents tool"
      );

      // Step 2: Map arguments to GraphService query format
      // Note: The MCP tool accepts "package" as entity_type for package-level impact analysis.
      // GraphService.DependentQuery uses EntityType which is "file" | "function" | "class".
      // When "package" is passed, GraphService treats it as a file path query for the package
      // directory, enabling impact analysis across all files within that package.
      const query = {
        entity_type: validatedArgs.entity_type as "file" | "function" | "class",
        entity_path: validatedArgs.entity_path,
        repository: validatedArgs.repository,
        depth: validatedArgs.depth,
        include_cross_repo: validatedArgs.include_cross_repo,
      };

      // Step 3: Call GraphService with validated parameters
      const response = await graphService.getDependents(query);

      // Step 4: Format response for MCP
      const content = formatDependentResponse(response, validatedArgs);

      const duration = performance.now() - startTime;
      log.info(
        {
          resultCount: response.dependents.length,
          duration_ms: Math.round(duration),
          entity_type: validatedArgs.entity_type,
          repository: validatedArgs.repository ?? "all",
          impact_score: response.impact_analysis.impact_score,
        },
        "get_dependents completed successfully"
      );

      return {
        content: [content],
        isError: false,
      };
    } catch (error) {
      // Step 5: Handle all errors gracefully
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "get_dependents failed");

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
 * Formats DependentResult as MCP TextContent
 *
 * Converts the GraphService response into a JSON structure that matches
 * the PRD response schema (Section 6.1). The JSON is formatted with
 * indentation for readability in Claude Code's interface.
 *
 * Includes impact_analysis with severity metrics for refactoring decisions.
 *
 * @param response - Dependent result from GraphService
 * @param _args - Original validated arguments (for metadata)
 * @returns MCP text content with formatted JSON
 */
function formatDependentResponse(response: DependentResult, _args: GetDependentsArgs): TextContent {
  const output = {
    entity: {
      type: response.entity.type,
      path: response.entity.path,
      repository: response.entity.repository,
    },
    dependents: response.dependents.map((dep) => ({
      type: dep.type,
      path: dep.path,
      repository: dep.repository,
      relationship: dep.relationship_type.toLowerCase(),
      depth: dep.depth,
      metadata: dep.metadata,
    })),
    impact_analysis: {
      direct_impact_count: response.impact_analysis.direct_impact_count,
      transitive_impact_count: response.impact_analysis.transitive_impact_count,
      impact_score: response.impact_analysis.impact_score,
    },
    metadata: {
      total_count: response.metadata.total_count,
      query_time_ms: response.metadata.query_time_ms,
      repositories_searched: response.metadata.repositories_searched,
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
