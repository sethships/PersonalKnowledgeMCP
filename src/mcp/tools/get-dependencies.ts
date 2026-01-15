/**
 * get_dependencies MCP Tool Implementation
 *
 * This module implements the get_dependencies tool for the MCP server, enabling
 * Claude Code and other MCP clients to query forward dependencies of a file,
 * function, or class in the knowledge graph.
 *
 * The tool is designed per PRD Section 6.1 (Tool 1: get_dependencies).
 *
 * @module mcp/tools/get-dependencies
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { GraphService, DependencyResult } from "../../services/graph-service-types.js";
import { RelationshipType } from "../../graph/types.js";
import { validateGetDependenciesArgs } from "../validation.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler, GetDependenciesArgs } from "../types.js";
import { mapMCPRelationshipTypes } from "./utils/relationship-mapper.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:get-dependencies");
  }
  return logger;
}

/**
 * MCP tool definition for get_dependencies
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 *
 * Per PRD Section 6.1, this tool queries what a given entity depends on
 * (forward dependencies).
 */
export const getDependenciesToolDefinition: Tool = {
  name: "get_dependencies",
  description:
    "Get all dependencies of a file, function, or class. Returns what the entity imports, " +
    "calls, or extends. Use this to understand what a piece of code relies on before making " +
    "changes or to explore the codebase structure.",
  inputSchema: {
    type: "object",
    properties: {
      entity_type: {
        type: "string",
        enum: ["file", "function", "class"],
        description: "Type of entity to query dependencies for",
      },
      entity_path: {
        type: "string",
        description:
          "For files: relative path (e.g., 'src/auth/middleware.ts'). " +
          "For functions/classes: name or fully qualified name (e.g., 'AuthMiddleware' or " +
          "'src/auth/middleware.ts::AuthMiddleware')",
      },
      repository: {
        type: "string",
        description: "Repository name to scope the query",
      },
      depth: {
        type: "integer",
        description:
          "Depth of transitive dependencies to include (1 = direct only, 2+ = transitive). " +
          "Default: 1. Maximum: 5.",
        default: 1,
        minimum: 1,
        maximum: 5,
      },
      relationship_types: {
        type: "array",
        items: {
          type: "string",
          enum: ["imports", "calls", "extends", "implements", "references"],
        },
        description: "Filter to specific relationship types. Omit for all types.",
      },
    },
    required: ["entity_type", "entity_path", "repository"],
  },
};

/**
 * Creates the get_dependencies tool handler
 *
 * This factory function enables dependency injection of the GraphService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param graphService - Injected GraphService instance
 * @returns Tool handler function that executes dependency queries
 *
 * @example
 * ```typescript
 * const graphService = new GraphServiceImpl(neo4jClient);
 * const handler = createGetDependenciesHandler(graphService);
 * const result = await handler({
 *   entity_type: "file",
 *   entity_path: "src/services/auth.ts",
 *   repository: "my-project",
 *   depth: 2
 * });
 * ```
 */
export function createGetDependenciesHandler(graphService: GraphService): ToolHandler {
  return async (args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    try {
      // Step 1: Validate MCP arguments
      const validatedArgs = validateGetDependenciesArgs(args);

      log.info(
        {
          entity_type: validatedArgs.entity_type,
          entity_path: validatedArgs.entity_path,
          repository: validatedArgs.repository,
          depth: validatedArgs.depth,
          relationship_types: validatedArgs.relationship_types,
        },
        "Executing get_dependencies tool"
      );

      // Step 2: Map arguments to GraphService query format
      const query = {
        entity_type: validatedArgs.entity_type,
        entity_path: validatedArgs.entity_path,
        repository: validatedArgs.repository,
        depth: validatedArgs.depth,
        include_transitive: validatedArgs.depth > 1,
        relationship_types: mapMCPRelationshipTypes(validatedArgs.relationship_types),
      };

      // Step 3: Call GraphService with validated parameters
      const response = await graphService.getDependencies(query);

      // Step 4: Format response for MCP
      const content = formatDependencyResponse(response, validatedArgs);

      const duration = performance.now() - startTime;
      log.info(
        {
          resultCount: response.dependencies.length,
          duration_ms: Math.round(duration),
          entity_type: validatedArgs.entity_type,
          repository: validatedArgs.repository,
        },
        "get_dependencies completed successfully"
      );

      return {
        content: [content],
        isError: false,
      };
    } catch (error) {
      // Step 5: Handle all errors gracefully
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "get_dependencies failed");

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
 * Formats DependencyResult as MCP TextContent
 *
 * Converts the GraphService response into a JSON structure that matches
 * the PRD response schema (Section 6.1). The JSON is formatted with
 * indentation for readability in Claude Code's interface.
 *
 * @param response - Dependency result from GraphService
 * @param args - Original validated arguments (for metadata)
 * @returns MCP text content with formatted JSON
 */
function formatDependencyResponse(
  response: DependencyResult,
  _args: GetDependenciesArgs
): TextContent {
  // Map internal RelationshipType enum to lowercase strings for MCP output
  const relationshipToString = (relType: RelationshipType): string => {
    return relType.toLowerCase();
  };

  const output = {
    entity: {
      type: response.entity.type,
      path: response.entity.path,
      repository: response.entity.repository,
    },
    dependencies: response.dependencies.map((dep) => ({
      type: dep.type,
      path: dep.path,
      relationship: relationshipToString(dep.relationship_type),
      depth: dep.depth,
      metadata: dep.metadata,
    })),
    metadata: {
      total_count: response.metadata.total_count,
      query_time_ms: response.metadata.query_time_ms,
      max_depth_reached: response.metadata.depth_searched,
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
