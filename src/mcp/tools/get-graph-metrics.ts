/**
 * get_graph_metrics MCP Tool Implementation
 *
 * This module implements the get_graph_metrics tool for the MCP server,
 * enabling agents to retrieve performance metrics for graph queries.
 *
 * @module mcp/tools/get-graph-metrics
 */

import type { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { getComponentLogger } from "../../logging/index.js";
import type { ToolHandler } from "../types.js";
import {
  graphMetricsCollector,
  type GraphMetricsCollector,
} from "../../services/graph-metrics-collector.js";
import type {
  GraphQueryType,
  GraphMetrics,
  GraphQueryTypeStats,
} from "../../services/graph-metrics-types.js";
import { GRAPH_QUERY_TYPES } from "../../services/graph-metrics-types.js";

/**
 * Lazy-initialized logger to avoid initialization at module load time
 */
let logger: ReturnType<typeof getComponentLogger> | null = null;

function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    logger = getComponentLogger("mcp:get-graph-metrics");
  }
  return logger;
}

/**
 * Validated tool arguments
 */
interface GetGraphMetricsArgs {
  queryType: GraphQueryType | "all";
}

/**
 * Success response format for all metrics
 */
interface AllMetricsResponse {
  success: true;
  metrics: GraphMetrics;
}

/**
 * Success response format for filtered metrics
 */
interface FilteredMetricsResponse {
  success: true;
  queryType: GraphQueryType;
  stats: GraphQueryTypeStats;
}

/**
 * Error response format
 */
interface ErrorResponse {
  success: false;
  error: "invalid_arguments";
  message: string;
}

type GetGraphMetricsResponse = AllMetricsResponse | FilteredMetricsResponse | ErrorResponse;

/**
 * MCP tool definition for get_graph_metrics
 */
export const getGraphMetricsToolDefinition: Tool = {
  name: "get_graph_metrics",
  description:
    "Retrieve performance metrics for graph queries including timing, cache hit rates, " +
    "and query statistics. Use this to monitor Neo4j query performance and identify " +
    "slow queries. Metrics are collected in memory for recent queries.",
  inputSchema: {
    type: "object",
    properties: {
      query_type: {
        type: "string",
        enum: ["all", "getDependencies", "getDependents", "getPath", "getArchitecture"],
        description:
          "Filter metrics to a specific query type. Use 'all' to get aggregate metrics " +
          "across all query types (default: 'all').",
        default: "all",
      },
    },
    required: [],
  },
};

/**
 * Validate and extract arguments
 */
function validateArgs(args: unknown): GetGraphMetricsArgs {
  // Default to "all" if no args provided
  if (args === undefined || args === null) {
    return { queryType: "all" };
  }

  if (typeof args !== "object") {
    throw new Error("Arguments must be an object");
  }

  const obj = args as Record<string, unknown>;

  // Default to "all" if query_type not provided
  if (obj["query_type"] === undefined || obj["query_type"] === null) {
    return { queryType: "all" };
  }

  const queryType = obj["query_type"];

  if (typeof queryType !== "string") {
    throw new Error("query_type must be a string");
  }

  // Validate query type
  const validTypes = ["all", ...GRAPH_QUERY_TYPES];
  if (!validTypes.includes(queryType)) {
    throw new Error(`query_type must be one of: ${validTypes.join(", ")}. Got: ${queryType}`);
  }

  return { queryType: queryType as GraphQueryType | "all" };
}

/**
 * Format response as TextContent
 */
function formatResponse(response: GetGraphMetricsResponse): TextContent {
  return {
    type: "text",
    text: JSON.stringify(response, null, 2),
  };
}

/**
 * Format error response
 */
function formatErrorResponse(message: string): TextContent {
  const response: ErrorResponse = {
    success: false,
    error: "invalid_arguments",
    message,
  };
  return formatResponse(response);
}

/**
 * Dependencies required by the get_graph_metrics handler
 */
export interface GetGraphMetricsDependencies {
  metricsCollector?: GraphMetricsCollector;
}

/**
 * Creates the get_graph_metrics tool handler
 *
 * This factory function enables dependency injection of the metrics collector,
 * allowing for easier testing. If no collector is provided, uses the default
 * singleton instance.
 *
 * @param deps - Optional injected dependencies
 * @returns Tool handler function that retrieves graph metrics
 *
 * @example
 * ```typescript
 * // Use default singleton collector
 * const handler = createGetGraphMetricsHandler();
 * const result = await handler({ query_type: "all" });
 *
 * // Inject custom collector (for testing)
 * const testCollector = new GraphMetricsCollector(100);
 * const handler = createGetGraphMetricsHandler({ metricsCollector: testCollector });
 * ```
 */
export function createGetGraphMetricsHandler(deps: GetGraphMetricsDependencies = {}): ToolHandler {
  const collector = deps.metricsCollector ?? graphMetricsCollector;

  return (args: unknown): Promise<CallToolResult> => {
    const log = getLogger();

    try {
      // Step 1: Validate arguments
      const validatedArgs = validateArgs(args);
      const { queryType } = validatedArgs;

      log.debug({ queryType }, "get_graph_metrics invoked");

      // Step 2: Get metrics based on query type
      if (queryType === "all") {
        const metrics = collector.getMetrics();

        log.info(
          {
            totalQueries: metrics.totalQueries,
            averageDurationMs: metrics.averageDurationMs,
            cacheHitRate: metrics.cacheHitRate,
          },
          "Retrieved aggregate graph metrics"
        );

        const response: AllMetricsResponse = {
          success: true,
          metrics,
        };

        return Promise.resolve({
          content: [formatResponse(response)],
          isError: false,
        });
      }

      // Get filtered metrics for specific query type
      const stats = collector.getQueryTypeStats(queryType);

      log.info(
        {
          queryType,
          totalQueries: stats.totalQueries,
          averageDurationMs: stats.averageDurationMs,
          cacheHitRate: stats.cacheHitRate,
        },
        "Retrieved query type metrics"
      );

      const response: FilteredMetricsResponse = {
        success: true,
        queryType,
        stats,
      };

      return Promise.resolve({
        content: [formatResponse(response)],
        isError: false,
      });
    } catch (error) {
      log.error({ error }, "get_graph_metrics failed");

      return Promise.resolve({
        content: [formatErrorResponse(error instanceof Error ? error.message : "Unknown error")],
        isError: true,
      });
    }
  };
}
