/**
 * find_path MCP Tool Implementation
 *
 * This module implements the find_path tool for the MCP server, enabling
 * Claude Code and other MCP clients to trace relationship paths between
 * two code entities in the knowledge graph.
 *
 * The tool is designed per PRD Section 6.1 (Tool 4: find_path).
 *
 * @module mcp/tools/find-path
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type {
  GraphService,
  PathResult,
  EntityReference,
} from "../../services/graph-service-types.js";
import { RelationshipType } from "../../graph/types.js";
import { validateFindPathArgs } from "../validation.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler, DependencyRelationshipType } from "../types.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:find-path");
  }
  return logger;
}

/**
 * MCP tool definition for find_path
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 *
 * Per PRD Section 6.1, this tool finds the connection path between two
 * code entities to trace execution flow or understand component connections.
 */
export const findPathToolDefinition: Tool = {
  name: "find_path",
  description:
    "Find the connection path between two code entities. Returns the chain of " +
    "relationships linking them. Use this to trace execution flow or understand " +
    "how components are connected.",
  inputSchema: {
    type: "object",
    properties: {
      from_entity: {
        type: "string",
        description: "Starting entity (e.g., 'src/routes/api.ts::handleLogin')",
      },
      to_entity: {
        type: "string",
        description: "Target entity (e.g., 'src/db/users.ts::findUser')",
      },
      repository: {
        type: "string",
        description: "Repository name",
      },
      max_hops: {
        type: "integer",
        description: "Maximum path length to search",
        default: 10,
        minimum: 1,
        maximum: 20,
      },
      relationship_types: {
        type: "array",
        items: {
          type: "string",
          enum: ["imports", "calls", "extends", "implements", "references"],
        },
        description: "Limit path to specific relationship types",
      },
    },
    required: ["from_entity", "to_entity", "repository"],
  },
};

/**
 * Parses an entity string into an EntityReference
 *
 * Entity strings can be:
 * - File paths: 'src/routes/api.ts' (type = "file")
 * - Qualified names: 'src/routes/api.ts::handleLogin' (type inferred from case)
 *   - Uppercase first char = "class"
 *   - Otherwise = "function"
 *
 * @param entity - Entity string from MCP input
 * @param repository - Repository name for the entity
 * @returns Parsed EntityReference for GraphService
 */
function parseEntityReference(entity: string, repository: string): EntityReference {
  if (entity.includes("::")) {
    const parts = entity.split("::");
    const entityName = parts[parts.length - 1]!;
    // Infer type: uppercase first char = class, otherwise function
    const type = /^[A-Z]/.test(entityName) ? "class" : "function";
    return {
      type,
      path: entity, // Keep full qualified path for graph lookups
      repository,
    };
  }
  // No :: separator means it's a file path
  return {
    type: "file",
    path: entity,
    repository,
  };
}

/**
 * Maps MCP relationship type strings to internal RelationshipType enum values
 *
 * @param mcpTypes - Array of lowercase relationship type strings from MCP input
 * @returns Array of RelationshipType enum values for GraphService
 */
function mapRelationshipTypes(
  mcpTypes?: DependencyRelationshipType[]
): RelationshipType[] | undefined {
  if (!mcpTypes || mcpTypes.length === 0) {
    return undefined;
  }

  const mapping: Record<DependencyRelationshipType, RelationshipType> = {
    imports: RelationshipType.IMPORTS,
    calls: RelationshipType.CALLS,
    extends: RelationshipType.EXTENDS,
    implements: RelationshipType.IMPLEMENTS,
    references: RelationshipType.REFERENCES,
  };

  return mcpTypes.map((t) => mapping[t]);
}

/**
 * Creates the find_path tool handler
 *
 * This factory function enables dependency injection of the GraphService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param graphService - Injected GraphService instance
 * @returns Tool handler function that executes path finding queries
 *
 * @example
 * ```typescript
 * const graphService = new GraphServiceImpl(neo4jClient);
 * const handler = createFindPathHandler(graphService);
 * const result = await handler({
 *   from_entity: "src/routes/api.ts::handleLogin",
 *   to_entity: "src/db/users.ts::findUser",
 *   repository: "my-api",
 *   max_hops: 5
 * });
 * ```
 */
export function createFindPathHandler(graphService: GraphService): ToolHandler {
  return async (args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    try {
      // Step 1: Validate MCP arguments
      const validatedArgs = validateFindPathArgs(args);

      log.info(
        {
          from_entity: validatedArgs.from_entity,
          to_entity: validatedArgs.to_entity,
          repository: validatedArgs.repository,
          max_hops: validatedArgs.max_hops,
          relationship_types: validatedArgs.relationship_types,
        },
        "Executing find_path tool"
      );

      // Step 2: Parse entity strings into EntityReferences
      const fromEntity = parseEntityReference(validatedArgs.from_entity, validatedArgs.repository);
      const toEntity = parseEntityReference(validatedArgs.to_entity, validatedArgs.repository);

      // Step 3: Map arguments to GraphService query format
      const query = {
        from_entity: fromEntity,
        to_entity: toEntity,
        max_hops: validatedArgs.max_hops,
        relationship_types: mapRelationshipTypes(validatedArgs.relationship_types),
      };

      // Step 4: Call GraphService with validated parameters
      const response = await graphService.getPath(query);

      // Step 5: Format response for MCP
      const content = formatPathResponse(response);

      const duration = performance.now() - startTime;
      log.info(
        {
          path_exists: response.path_exists,
          hops: response.metadata.hops,
          duration_ms: Math.round(duration),
          repository: validatedArgs.repository,
        },
        "find_path completed successfully"
      );

      return {
        content: [content],
        isError: false,
      };
    } catch (error) {
      // Step 6: Handle all errors gracefully
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "find_path failed");

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
 * Formats PathResult as MCP TextContent
 *
 * Converts the GraphService response into a JSON structure that matches
 * the PRD response schema (Section 6.1). The JSON is formatted with
 * indentation for readability in Claude Code's interface.
 *
 * @param response - Path result from GraphService
 * @returns MCP text content with formatted JSON
 */
function formatPathResponse(response: PathResult): TextContent {
  // Map internal RelationshipType enum to lowercase strings for MCP output
  const relationshipToString = (relType: RelationshipType | undefined): string | undefined => {
    return relType?.toLowerCase();
  };

  const output = {
    path_exists: response.path_exists,
    path: response.path
      ? response.path.map((node) => ({
          type: node.type,
          identifier: node.identifier,
          repository: node.repository,
          relationship_to_next: relationshipToString(node.relationship_to_next),
        }))
      : null,
    metadata: {
      hops: response.metadata.hops,
      query_time_ms: response.metadata.query_time_ms,
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
