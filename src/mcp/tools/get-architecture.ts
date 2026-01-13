/**
 * get_architecture MCP Tool Implementation
 *
 * This module implements the get_architecture tool for the MCP server, enabling
 * Claude Code and other MCP clients to query the architectural structure of a
 * repository, including package/module hierarchy and inter-module dependencies.
 *
 * The tool is designed per PRD Section 6.1 (Tool 3: get_architecture).
 *
 * @module mcp/tools/get-architecture
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type {
  GraphService,
  ArchitectureResult,
  ArchitectureNode,
  ModuleDependency,
} from "../../services/graph-service-types.js";
import { validateGetArchitectureArgs } from "../validation.js";
import { mapToMCPError } from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler, GetArchitectureArgs } from "../types.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:get-architecture");
  }
  return logger;
}

/**
 * MCP tool definition for get_architecture
 *
 * This definition is returned in response to ListTools requests and describes
 * the tool's interface contract to MCP clients like Claude Code.
 *
 * Per PRD Section 6.1, this tool queries the architectural structure of a
 * repository, returning hierarchical organization and inter-module dependencies.
 */
export const getArchitectureToolDefinition: Tool = {
  name: "get_architecture",
  description:
    "Get the architectural structure of a repository, package, or module. Returns hierarchical " +
    "organization and inter-module dependencies. Use this to understand codebase organization, " +
    "module boundaries, and high-level structure before diving into specific files.",
  inputSchema: {
    type: "object",
    properties: {
      repository: {
        type: "string",
        description: "Repository name to analyze",
      },
      scope: {
        type: "string",
        description:
          "Specific package or directory to focus on (e.g., 'src/services'). " +
          "Omit for full repository analysis.",
      },
      detail_level: {
        type: "string",
        enum: ["packages", "modules", "files", "entities"],
        description:
          "Level of detail to return: " +
          "'packages' for high-level structure, " +
          "'modules' for packages and their internal modules, " +
          "'files' for full file listing, " +
          "'entities' for individual functions and classes.",
      },
      include_external: {
        type: "boolean",
        description: "Include external dependencies (node_modules, etc.). Default: false.",
        default: false,
      },
    },
    required: ["repository", "detail_level"],
  },
};

/**
 * Creates the get_architecture tool handler
 *
 * This factory function enables dependency injection of the GraphService,
 * allowing for easier testing and loose coupling between MCP layer and business logic.
 *
 * @param graphService - Injected GraphService instance
 * @returns Tool handler function that executes architecture queries
 *
 * @example
 * ```typescript
 * const graphService = new GraphServiceImpl(neo4jClient);
 * const handler = createGetArchitectureHandler(graphService);
 * const result = await handler({
 *   repository: "my-project",
 *   detail_level: "modules"
 * });
 * ```
 */
export function createGetArchitectureHandler(graphService: GraphService): ToolHandler {
  return async (args: unknown): Promise<CallToolResult> => {
    const startTime = performance.now();
    const log = getLogger();

    try {
      // Step 1: Validate MCP arguments
      const validatedArgs = validateGetArchitectureArgs(args);

      log.info(
        {
          repository: validatedArgs.repository,
          scope: validatedArgs.scope,
          detail_level: validatedArgs.detail_level,
          include_external: validatedArgs.include_external,
        },
        "Executing get_architecture tool"
      );

      // Step 2: Map arguments to GraphService query format
      const query = {
        repository: validatedArgs.repository,
        scope: validatedArgs.scope,
        detail_level: validatedArgs.detail_level,
        include_external: validatedArgs.include_external,
      };

      // Step 3: Call GraphService with validated parameters
      const response = await graphService.getArchitecture(query);

      // Step 4: Format response for MCP
      const content = formatArchitectureResponse(response, validatedArgs);

      const duration = performance.now() - startTime;
      log.info(
        {
          duration_ms: Math.round(duration),
          repository: validatedArgs.repository,
          detail_level: validatedArgs.detail_level,
          total_files: response.metrics.total_files,
          total_modules: response.metrics.total_modules,
        },
        "get_architecture completed successfully"
      );

      return {
        content: [content],
        isError: false,
      };
    } catch (error) {
      // Step 5: Handle all errors gracefully
      const duration = performance.now() - startTime;
      log.error({ error, duration_ms: Math.round(duration) }, "get_architecture failed");

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
 * Formatted architecture node for MCP output
 */
interface FormattedArchitectureNode {
  name: string;
  type: string;
  path: string;
  metrics?: {
    file_count?: number;
    function_count?: number;
    class_count?: number;
  };
  dependencies?: Array<{
    target: string;
    relationship: string;
    count: number;
  }>;
  children?: FormattedArchitectureNode[];
}

/**
 * Recursively formats an ArchitectureNode for MCP output
 *
 * Converts the internal node structure to a JSON-friendly format with
 * consistent field naming (snake_case).
 *
 * @param node - Architecture node to format
 * @returns Formatted node for JSON serialization
 */
function formatArchitectureNode(node: ArchitectureNode): FormattedArchitectureNode {
  const formatted: FormattedArchitectureNode = {
    name: node.name,
    type: node.type,
    path: node.path,
  };

  // Include metrics if present
  if (node.metrics) {
    formatted.metrics = {
      file_count: node.metrics.file_count,
      function_count: node.metrics.function_count,
      class_count: node.metrics.class_count,
    };
  }

  // Include dependencies if present
  if (node.dependencies && node.dependencies.length > 0) {
    formatted.dependencies = node.dependencies.map((dep) => ({
      target: dep.target,
      relationship: dep.relationship,
      count: dep.count,
    }));
  }

  // Recursively format children
  if (node.children && node.children.length > 0) {
    formatted.children = node.children.map(formatArchitectureNode);
  }

  return formatted;
}

/**
 * Formats ModuleDependency for MCP output
 *
 * @param dep - Module dependency to format
 * @returns Formatted dependency for JSON serialization
 */
function formatModuleDependency(dep: ModuleDependency): Record<string, unknown> {
  return {
    from: dep.from_module,
    to: dep.to_module,
    relationship_count: dep.relationship_count,
    relationship_types: dep.relationship_types.map((t) => t.toLowerCase()),
  };
}

/**
 * Formats ArchitectureResult as MCP TextContent
 *
 * Converts the GraphService response into a JSON structure that matches
 * the PRD response schema (Section 6.1). The JSON is formatted with
 * indentation for readability in Claude Code's interface.
 *
 * @param response - Architecture result from GraphService
 * @param args - Original validated arguments (for metadata)
 * @returns MCP text content with formatted JSON
 */
function formatArchitectureResponse(
  response: ArchitectureResult,
  _args: GetArchitectureArgs
): TextContent {
  const output = {
    repository: response.repository,
    scope: response.scope,
    structure: formatArchitectureNode(response.structure),
    metrics: {
      total_files: response.metrics.total_files,
      total_modules: response.metrics.total_modules,
      total_entities: response.metrics.total_entities,
    },
    inter_module_dependencies: response.inter_module_dependencies.map(formatModuleDependency),
    metadata: {
      detail_level: response.metadata.detail_level,
      query_time_ms: response.metadata.query_time_ms,
    },
  };

  return {
    type: "text",
    text: JSON.stringify(output, null, 2),
  };
}
