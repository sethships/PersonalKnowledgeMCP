/**
 * Unit tests for get_graph_metrics MCP tool handler
 *
 * Tests the MCP tool implementation for retrieving graph query metrics.
 * Uses custom GraphMetricsCollector instances to isolate testing.
 *
 * @see Issue #174: Add graph query timing to metrics
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getGraphMetricsToolDefinition,
  createGetGraphMetricsHandler,
} from "../../../../src/mcp/tools/get-graph-metrics.js";
import { GraphMetricsCollector } from "../../../../src/services/graph-metrics-collector.js";
import { GRAPH_QUERY_TYPES } from "../../../../src/services/graph-metrics-types.js";
import type { GraphQueryRecord } from "../../../../src/services/graph-metrics-types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { initializeLogger, resetLogger } from "../../../../src/logging/index.js";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a test record with sensible defaults
 */
function createTestRecord(overrides: Partial<GraphQueryRecord> = {}): GraphQueryRecord {
  return {
    queryType: "getDependencies",
    timestamp: new Date().toISOString(),
    durationMs: 100,
    resultCount: 10,
    depth: 1,
    fromCache: false,
    repository: "test-repo",
    ...overrides,
  };
}

/**
 * Parse JSON from tool response
 */
function parseToolResponse<T>(result: CallToolResult): T {
  const content0 = result.content[0];
  if (!content0 || content0.type !== "text") {
    throw new Error("No text content in response");
  }
  return JSON.parse(content0.text) as T;
}

// ============================================================================
// Tests
// ============================================================================

describe("get_graph_metrics MCP Tool", () => {
  let collector: GraphMetricsCollector;

  beforeEach(() => {
    // Initialize logger in silent mode for tests
    initializeLogger({ level: "silent", format: "json" });
    collector = new GraphMetricsCollector(100);
  });

  afterEach(() => {
    resetLogger();
  });

  // ==========================================================================
  // Tool Definition Tests
  // ==========================================================================

  describe("Tool Definition", () => {
    it("should have correct tool name", () => {
      expect(getGraphMetricsToolDefinition.name).toBe("get_graph_metrics");
    });

    it("should have description mentioning graph and metrics", () => {
      expect(getGraphMetricsToolDefinition.description).toContain("graph");
      expect(getGraphMetricsToolDefinition.description).toContain("metric");
    });

    it("should have query_type parameter with correct enum values", () => {
      const schema = getGraphMetricsToolDefinition.inputSchema as Record<string, unknown>;
      const properties = schema["properties"] as Record<string, unknown>;
      const queryTypeSchema = properties["query_type"] as Record<string, unknown>;

      expect(queryTypeSchema["type"]).toBe("string");
      expect(queryTypeSchema["enum"]).toContain("all");
      expect(queryTypeSchema["enum"]).toContain("getDependencies");
      expect(queryTypeSchema["enum"]).toContain("getDependents");
      expect(queryTypeSchema["enum"]).toContain("getPath");
      expect(queryTypeSchema["enum"]).toContain("getArchitecture");
    });

    it("should not have required parameters", () => {
      const schema = getGraphMetricsToolDefinition.inputSchema as Record<string, unknown>;
      const required = schema["required"] as string[];
      expect(required).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Handler Tests - Default (all) Query Type
  // ==========================================================================

  describe("Handler with default query type", () => {
    it("should return success with empty metrics when no records", async () => {
      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({});

      expect(result.isError).toBe(false);

      const response = parseToolResponse<{
        success: boolean;
        metrics: { totalQueries: number };
      }>(result);

      expect(response.success).toBe(true);
      expect(response.metrics.totalQueries).toBe(0);
    });

    it("should return aggregate metrics for all query types", async () => {
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 100 }));
      collector.record(createTestRecord({ queryType: "getDependents", durationMs: 200 }));
      collector.record(createTestRecord({ queryType: "getPath", durationMs: 50, fromCache: true }));

      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "all" });

      expect(result.isError).toBe(false);

      const response = parseToolResponse<{
        success: boolean;
        metrics: {
          totalQueries: number;
          averageDurationMs: number;
          cacheHitRate: number;
          byQueryType: Array<{ queryType: string; totalQueries: number }>;
        };
      }>(result);

      expect(response.success).toBe(true);
      expect(response.metrics.totalQueries).toBe(3);
      expect(response.metrics.averageDurationMs).toBeCloseTo(116.67, 1);
      expect(response.metrics.cacheHitRate).toBeCloseTo(0.333, 2);
      expect(response.metrics.byQueryType).toHaveLength(GRAPH_QUERY_TYPES.length);
    });

    it("should handle null arguments as default", async () => {
      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler(null);

      expect(result.isError).toBe(false);

      const response = parseToolResponse<{ success: boolean }>(result);
      expect(response.success).toBe(true);
    });

    it("should handle undefined arguments as default", async () => {
      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler(undefined);

      expect(result.isError).toBe(false);

      const response = parseToolResponse<{ success: boolean }>(result);
      expect(response.success).toBe(true);
    });
  });

  // ==========================================================================
  // Handler Tests - Filtered Query Type
  // ==========================================================================

  describe("Handler with specific query type", () => {
    it("should return filtered metrics for getDependencies", async () => {
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 100 }));
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 200 }));
      collector.record(createTestRecord({ queryType: "getDependents", durationMs: 300 }));

      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "getDependencies" });

      expect(result.isError).toBe(false);

      const response = parseToolResponse<{
        success: boolean;
        queryType: string;
        stats: {
          queryType: string;
          totalQueries: number;
          averageDurationMs: number;
        };
      }>(result);

      expect(response.success).toBe(true);
      expect(response.queryType).toBe("getDependencies");
      expect(response.stats.totalQueries).toBe(2);
      expect(response.stats.averageDurationMs).toBe(150);
    });

    it("should return filtered metrics for getDependents", async () => {
      collector.record(createTestRecord({ queryType: "getDependents", durationMs: 250 }));

      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "getDependents" });

      expect(result.isError).toBe(false);

      const response = parseToolResponse<{
        success: boolean;
        queryType: string;
        stats: { queryType: string; totalQueries: number };
      }>(result);

      expect(response.queryType).toBe("getDependents");
      expect(response.stats.totalQueries).toBe(1);
    });

    it("should return filtered metrics for getPath", async () => {
      collector.record(createTestRecord({ queryType: "getPath" }));

      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "getPath" });

      const response = parseToolResponse<{ queryType: string }>(result);
      expect(response.queryType).toBe("getPath");
    });

    it("should return filtered metrics for getArchitecture", async () => {
      collector.record(createTestRecord({ queryType: "getArchitecture" }));

      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "getArchitecture" });

      const response = parseToolResponse<{ queryType: string }>(result);
      expect(response.queryType).toBe("getArchitecture");
    });

    it("should return empty stats when no records for specified type", async () => {
      collector.record(createTestRecord({ queryType: "getDependencies" }));

      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "getPath" });

      expect(result.isError).toBe(false);

      const response = parseToolResponse<{
        success: boolean;
        stats: { totalQueries: number };
      }>(result);

      expect(response.success).toBe(true);
      expect(response.stats.totalQueries).toBe(0);
    });
  });

  // ==========================================================================
  // Handler Tests - Error Cases
  // ==========================================================================

  describe("Handler error cases", () => {
    it("should return error for invalid query_type", async () => {
      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "invalidType" });

      expect(result.isError).toBe(true);

      const response = parseToolResponse<{
        success: boolean;
        error: string;
        message: string;
      }>(result);

      expect(response.success).toBe(false);
      expect(response.error).toBe("invalid_arguments");
      expect(response.message).toContain("query_type must be one of");
    });

    it("should return error for non-string query_type", async () => {
      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: 123 });

      expect(result.isError).toBe(true);

      const response = parseToolResponse<{
        success: boolean;
        error: string;
      }>(result);

      expect(response.success).toBe(false);
      expect(response.error).toBe("invalid_arguments");
    });

    it("should return error for non-object arguments", async () => {
      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler("invalid");

      expect(result.isError).toBe(true);
    });
  });

  // ==========================================================================
  // Handler Tests - Uses Default Collector
  // ==========================================================================

  describe("Handler without injected collector", () => {
    it("should work with default singleton collector", async () => {
      // Create handler without injecting collector
      const handler = createGetGraphMetricsHandler();
      const result = await handler({});

      expect(result.isError).toBe(false);

      const response = parseToolResponse<{ success: boolean }>(result);
      expect(response.success).toBe(true);
    });
  });

  // ==========================================================================
  // Response Format Tests
  // ==========================================================================

  describe("Response format", () => {
    it("should return properly formatted JSON", async () => {
      collector.record(createTestRecord());

      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({});

      const content = result.content[0];
      expect(content).toBeDefined();
      expect((content as { type: string }).type).toBe("text");

      // Should be valid JSON
      expect(() => JSON.parse((content as { text: string }).text) as unknown).not.toThrow();
    });

    it("should include all query type stats in aggregate response", async () => {
      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "all" });

      const response = parseToolResponse<{
        metrics: {
          byQueryType: Array<{ queryType: string }>;
          last7DaysTrend: { queryCount: number };
        };
      }>(result);

      expect(response.metrics.byQueryType).toHaveLength(4);
      expect(response.metrics.last7DaysTrend).toBeDefined();
    });

    it("should include detailed stats in filtered response", async () => {
      collector.record(
        createTestRecord({
          queryType: "getDependencies",
          durationMs: 100,
          resultCount: 5,
          fromCache: true,
        })
      );

      const handler = createGetGraphMetricsHandler({ metricsCollector: collector });
      const result = await handler({ query_type: "getDependencies" });

      const response = parseToolResponse<{
        stats: {
          totalQueries: number;
          averageDurationMs: number;
          maxDurationMs: number;
          minDurationMs: number;
          cacheHitRate: number;
          averageResultCount: number;
          errorCount: number;
        };
      }>(result);

      expect(response.stats.totalQueries).toBe(1);
      expect(response.stats.averageDurationMs).toBe(100);
      expect(response.stats.maxDurationMs).toBe(100);
      expect(response.stats.minDurationMs).toBe(100);
      expect(response.stats.cacheHitRate).toBe(1);
      expect(response.stats.averageResultCount).toBe(5);
      expect(response.stats.errorCount).toBe(0);
    });
  });
});
