/**
 * Unit tests for GraphMetricsCollector
 *
 * Tests metrics collection, aggregation, and calculation logic for graph queries.
 *
 * @see Issue #174: Add graph query timing to metrics
 */

import { describe, it, expect, beforeEach } from "bun:test";

import { GraphMetricsCollector } from "../../../src/services/graph-metrics-collector.js";
import type { GraphQueryRecord } from "../../../src/services/graph-metrics-types.js";
import { GRAPH_QUERY_TYPES } from "../../../src/services/graph-metrics-types.js";

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
 * Create a timestamp N days ago
 */
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

// ============================================================================
// Constructor Tests
// ============================================================================

describe("GraphMetricsCollector", () => {
  describe("constructor", () => {
    it("should create collector with default max records", () => {
      const collector = new GraphMetricsCollector();
      expect(collector.getRecordCount()).toBe(0);
    });

    it("should create collector with custom max records", () => {
      const collector = new GraphMetricsCollector(500);
      expect(collector.getRecordCount()).toBe(0);
    });
  });

  // ============================================================================
  // Recording Tests
  // ============================================================================

  describe("record", () => {
    let collector: GraphMetricsCollector;

    beforeEach(() => {
      collector = new GraphMetricsCollector(100);
    });

    it("should add record to collector", () => {
      const record = createTestRecord();
      collector.record(record);
      expect(collector.getRecordCount()).toBe(1);
    });

    it("should store record with all fields", () => {
      const record = createTestRecord({
        queryType: "getDependents",
        durationMs: 250,
        resultCount: 5,
        depth: 2,
        fromCache: true,
        repository: "my-repo",
        error: false,
      });
      collector.record(record);

      const records = collector.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(record);
    });

    it("should enforce max records limit (circular buffer)", () => {
      const maxRecords = 10;
      const collector = new GraphMetricsCollector(maxRecords);

      // Add more than max records
      for (let i = 0; i < 15; i++) {
        collector.record(createTestRecord({ durationMs: i * 10 }));
      }

      expect(collector.getRecordCount()).toBe(maxRecords);

      // Oldest records should be removed (0-4 removed, 5-14 remain)
      const records = collector.getRecords();
      expect(records[0]?.durationMs).toBe(50); // First remaining is i=5
      expect(records[9]?.durationMs).toBe(140); // Last is i=14
    });

    it("should handle records without optional fields", () => {
      const record = createTestRecord({
        depth: undefined,
        repository: undefined,
        error: undefined,
      });
      collector.record(record);

      const records = collector.getRecords();
      expect(records[0]?.depth).toBeUndefined();
      expect(records[0]?.repository).toBeUndefined();
    });
  });

  // ============================================================================
  // getMetrics Tests
  // ============================================================================

  describe("getMetrics", () => {
    let collector: GraphMetricsCollector;

    beforeEach(() => {
      collector = new GraphMetricsCollector(1000);
    });

    it("should return empty metrics when no records exist", () => {
      const metrics = collector.getMetrics();

      expect(metrics.totalQueries).toBe(0);
      expect(metrics.averageDurationMs).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.byQueryType).toHaveLength(4);
      expect(metrics.last7DaysTrend.queryCount).toBe(0);
    });

    it("should calculate aggregate metrics correctly", () => {
      collector.record(createTestRecord({ durationMs: 100, fromCache: false }));
      collector.record(createTestRecord({ durationMs: 200, fromCache: true }));
      collector.record(createTestRecord({ durationMs: 300, fromCache: false }));

      const metrics = collector.getMetrics();

      expect(metrics.totalQueries).toBe(3);
      expect(metrics.averageDurationMs).toBe(200); // (100+200+300)/3
      expect(metrics.cacheHitRate).toBeCloseTo(0.333, 2); // 1/3
    });

    it("should include metrics for all query types", () => {
      const metrics = collector.getMetrics();

      expect(metrics.byQueryType).toHaveLength(GRAPH_QUERY_TYPES.length);

      const queryTypes = metrics.byQueryType.map((s) => s.queryType);
      expect(queryTypes).toContain("getDependencies");
      expect(queryTypes).toContain("getDependents");
      expect(queryTypes).toContain("getPath");
      expect(queryTypes).toContain("getArchitecture");
    });

    it("should calculate per-query-type statistics", () => {
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 100 }));
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 200 }));
      collector.record(createTestRecord({ queryType: "getPath", durationMs: 50 }));

      const metrics = collector.getMetrics();
      const depStats = metrics.byQueryType.find((s) => s.queryType === "getDependencies");
      const pathStats = metrics.byQueryType.find((s) => s.queryType === "getPath");

      expect(depStats?.totalQueries).toBe(2);
      expect(depStats?.averageDurationMs).toBe(150);
      expect(pathStats?.totalQueries).toBe(1);
      expect(pathStats?.averageDurationMs).toBe(50);
    });
  });

  // ============================================================================
  // getQueryTypeStats Tests
  // ============================================================================

  describe("getQueryTypeStats", () => {
    let collector: GraphMetricsCollector;

    beforeEach(() => {
      collector = new GraphMetricsCollector(1000);
    });

    it("should return empty stats for query type with no records", () => {
      const stats = collector.getQueryTypeStats("getDependencies");

      expect(stats.queryType).toBe("getDependencies");
      expect(stats.totalQueries).toBe(0);
      expect(stats.averageDurationMs).toBe(0);
      expect(stats.maxDurationMs).toBe(0);
      expect(stats.minDurationMs).toBe(0);
      expect(stats.cacheHitRate).toBe(0);
      expect(stats.averageResultCount).toBe(0);
      expect(stats.errorCount).toBe(0);
    });

    it("should calculate min/max duration correctly", () => {
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 50 }));
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 150 }));
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 100 }));

      const stats = collector.getQueryTypeStats("getDependencies");

      expect(stats.minDurationMs).toBe(50);
      expect(stats.maxDurationMs).toBe(150);
    });

    it("should calculate average result count", () => {
      collector.record(createTestRecord({ queryType: "getDependents", resultCount: 10 }));
      collector.record(createTestRecord({ queryType: "getDependents", resultCount: 20 }));
      collector.record(createTestRecord({ queryType: "getDependents", resultCount: 30 }));

      const stats = collector.getQueryTypeStats("getDependents");

      expect(stats.averageResultCount).toBe(20);
    });

    it("should count cache hits correctly", () => {
      collector.record(createTestRecord({ queryType: "getPath", fromCache: true }));
      collector.record(createTestRecord({ queryType: "getPath", fromCache: false }));
      collector.record(createTestRecord({ queryType: "getPath", fromCache: true }));
      collector.record(createTestRecord({ queryType: "getPath", fromCache: false }));

      const stats = collector.getQueryTypeStats("getPath");

      expect(stats.cacheHitRate).toBe(0.5); // 2/4
    });

    it("should count errors", () => {
      collector.record(createTestRecord({ queryType: "getArchitecture", error: false }));
      collector.record(createTestRecord({ queryType: "getArchitecture", error: true }));
      collector.record(createTestRecord({ queryType: "getArchitecture", error: true }));

      const stats = collector.getQueryTypeStats("getArchitecture");

      expect(stats.errorCount).toBe(2);
    });

    it("should only include records for specified query type", () => {
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 100 }));
      collector.record(createTestRecord({ queryType: "getDependents", durationMs: 200 }));
      collector.record(createTestRecord({ queryType: "getDependencies", durationMs: 150 }));

      const depStats = collector.getQueryTypeStats("getDependencies");
      const dentStats = collector.getQueryTypeStats("getDependents");

      expect(depStats.totalQueries).toBe(2);
      expect(depStats.averageDurationMs).toBe(125);
      expect(dentStats.totalQueries).toBe(1);
      expect(dentStats.averageDurationMs).toBe(200);
    });
  });

  // ============================================================================
  // Trend Metrics Tests
  // ============================================================================

  describe("7-day trend metrics", () => {
    let collector: GraphMetricsCollector;

    beforeEach(() => {
      collector = new GraphMetricsCollector(1000);
    });

    it("should include only recent records in trend", () => {
      // Add old record (10 days ago)
      collector.record(createTestRecord({ timestamp: daysAgo(10), durationMs: 1000 }));
      // Add recent records (within 7 days)
      collector.record(createTestRecord({ timestamp: daysAgo(3), durationMs: 100 }));
      collector.record(createTestRecord({ timestamp: daysAgo(1), durationMs: 200 }));

      const metrics = collector.getMetrics();

      expect(metrics.last7DaysTrend.queryCount).toBe(2);
      expect(metrics.last7DaysTrend.averageDurationMs).toBe(150); // (100+200)/2
    });

    it("should return empty trend when no recent records", () => {
      collector.record(createTestRecord({ timestamp: daysAgo(10) }));
      collector.record(createTestRecord({ timestamp: daysAgo(15) }));

      const metrics = collector.getMetrics();

      expect(metrics.last7DaysTrend.queryCount).toBe(0);
      expect(metrics.last7DaysTrend.averageDurationMs).toBe(0);
      expect(metrics.last7DaysTrend.cacheHitRate).toBe(0);
    });

    it("should calculate trend cache hit rate correctly", () => {
      collector.record(createTestRecord({ timestamp: daysAgo(2), fromCache: true }));
      collector.record(createTestRecord({ timestamp: daysAgo(2), fromCache: false }));
      collector.record(createTestRecord({ timestamp: daysAgo(2), fromCache: true }));
      // Old record should not affect trend
      collector.record(createTestRecord({ timestamp: daysAgo(10), fromCache: false }));

      const metrics = collector.getMetrics();

      expect(metrics.last7DaysTrend.cacheHitRate).toBeCloseTo(0.667, 2); // 2/3
    });
  });

  // ============================================================================
  // Clear and Utility Tests
  // ============================================================================

  describe("clear", () => {
    it("should remove all records", () => {
      const collector = new GraphMetricsCollector(100);
      collector.record(createTestRecord());
      collector.record(createTestRecord());
      collector.record(createTestRecord());

      expect(collector.getRecordCount()).toBe(3);

      collector.clear();

      expect(collector.getRecordCount()).toBe(0);
      expect(collector.getMetrics().totalQueries).toBe(0);
    });
  });

  describe("getRecords", () => {
    it("should return a copy of records", () => {
      const collector = new GraphMetricsCollector(100);
      collector.record(createTestRecord({ durationMs: 100 }));

      const records = collector.getRecords();
      records.push(createTestRecord({ durationMs: 200 }));

      // Original should not be modified
      expect(collector.getRecordCount()).toBe(1);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("edge cases", () => {
    it("should handle single record correctly", () => {
      const collector = new GraphMetricsCollector(100);
      collector.record(
        createTestRecord({
          durationMs: 100,
          resultCount: 5,
          fromCache: true,
        })
      );

      const metrics = collector.getMetrics();
      const stats = collector.getQueryTypeStats("getDependencies");

      expect(metrics.totalQueries).toBe(1);
      expect(metrics.averageDurationMs).toBe(100);
      expect(metrics.cacheHitRate).toBe(1);
      expect(stats.minDurationMs).toBe(100);
      expect(stats.maxDurationMs).toBe(100);
    });

    it("should handle all query types in metrics", () => {
      const collector = new GraphMetricsCollector(100);

      for (const queryType of GRAPH_QUERY_TYPES) {
        collector.record(createTestRecord({ queryType }));
      }

      const metrics = collector.getMetrics();

      expect(metrics.totalQueries).toBe(4);
      for (const stats of metrics.byQueryType) {
        expect(stats.totalQueries).toBe(1);
      }
    });

    it("should handle zero duration records", () => {
      const collector = new GraphMetricsCollector(100);
      collector.record(createTestRecord({ durationMs: 0 }));
      collector.record(createTestRecord({ durationMs: 0 }));

      const metrics = collector.getMetrics();

      expect(metrics.averageDurationMs).toBe(0);
    });
  });
});
