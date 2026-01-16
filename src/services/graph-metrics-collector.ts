/**
 * Graph Metrics Collector Service
 *
 * Collects and aggregates performance metrics for graph-based structural queries.
 * Stores recent query records in memory and calculates statistics on demand.
 *
 * @module services/graph-metrics-collector
 */

import type {
  GraphQueryRecord,
  GraphQueryType,
  GraphQueryTypeStats,
  GraphMetrics,
  GraphTrendMetrics,
} from "./graph-metrics-types.js";
import { GRAPH_QUERY_TYPES } from "./graph-metrics-types.js";

/**
 * Default maximum number of records to retain in memory.
 */
const DEFAULT_MAX_RECORDS = 1000;

/**
 * Graph Metrics Collector
 *
 * Collects graph query execution metrics and provides aggregated statistics.
 * Uses a circular buffer approach to limit memory usage while maintaining
 * recent query history.
 *
 * @example
 * ```typescript
 * const collector = new GraphMetricsCollector(500);
 *
 * // Record a query
 * collector.record({
 *   queryType: "getDependencies",
 *   timestamp: new Date().toISOString(),
 *   durationMs: 145,
 *   resultCount: 12,
 *   depth: 2,
 *   fromCache: false,
 *   repository: "my-project",
 * });
 *
 * // Get aggregate metrics
 * const metrics = collector.getMetrics();
 * console.log(`Total queries: ${metrics.totalQueries}`);
 * ```
 */
export class GraphMetricsCollector {
  private records: GraphQueryRecord[] = [];
  private readonly maxRecords: number;

  /**
   * Create a new GraphMetricsCollector instance.
   *
   * @param maxRecords - Maximum number of records to retain (default: 1000)
   */
  constructor(maxRecords: number = DEFAULT_MAX_RECORDS) {
    this.maxRecords = maxRecords;
  }

  /**
   * Record a graph query execution.
   *
   * If the maximum number of records is exceeded, the oldest record is removed.
   *
   * @param record - Query record to store
   */
  record(record: GraphQueryRecord): void {
    this.records.push(record);

    // Trim to max records (circular buffer behavior)
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }

  /**
   * Get aggregate metrics for all graph queries.
   *
   * Calculates comprehensive statistics including:
   * - Total query count
   * - Average duration
   * - Cache hit rate
   * - Per-query-type statistics
   * - Last 7 days trend
   *
   * @returns Aggregate metrics for all stored records
   */
  getMetrics(): GraphMetrics {
    if (this.records.length === 0) {
      return this.emptyMetrics();
    }

    // Calculate aggregate statistics
    let totalDurationMs = 0;
    let cacheHits = 0;

    for (const record of this.records) {
      totalDurationMs += record.durationMs;
      if (record.fromCache) {
        cacheHits++;
      }
    }

    const totalQueries = this.records.length;
    const averageDurationMs = totalDurationMs / totalQueries;
    const cacheHitRate = cacheHits / totalQueries;

    // Calculate per-query-type statistics
    const byQueryType = GRAPH_QUERY_TYPES.map((queryType) =>
      this.calculateQueryTypeStats(queryType)
    );

    // Calculate 7-day trend
    const last7DaysTrend = this.calculateTrendMetrics(7);

    return {
      totalQueries,
      averageDurationMs,
      cacheHitRate,
      byQueryType,
      last7DaysTrend,
    };
  }

  /**
   * Get statistics for a specific query type.
   *
   * @param queryType - The query type to get statistics for
   * @returns Statistics for the specified query type
   */
  getQueryTypeStats(queryType: GraphQueryType): GraphQueryTypeStats {
    return this.calculateQueryTypeStats(queryType);
  }

  /**
   * Get all stored records.
   *
   * Returns a copy to prevent external modification.
   *
   * @returns Array of all stored query records
   */
  getRecords(): GraphQueryRecord[] {
    return [...this.records];
  }

  /**
   * Get the number of stored records.
   *
   * @returns Number of records currently stored
   */
  getRecordCount(): number {
    return this.records.length;
  }

  /**
   * Clear all stored records.
   */
  clear(): void {
    this.records = [];
  }

  /**
   * Calculate statistics for a specific query type.
   *
   * @param queryType - Query type to calculate stats for
   * @returns Statistics for the query type
   */
  private calculateQueryTypeStats(queryType: GraphQueryType): GraphQueryTypeStats {
    const typeRecords = this.records.filter((r) => r.queryType === queryType);

    if (typeRecords.length === 0) {
      return {
        queryType,
        totalQueries: 0,
        averageDurationMs: 0,
        maxDurationMs: 0,
        minDurationMs: 0,
        cacheHitRate: 0,
        averageResultCount: 0,
        errorCount: 0,
      };
    }

    let totalDurationMs = 0;
    let maxDurationMs = 0;
    let minDurationMs = Number.MAX_SAFE_INTEGER;
    let cacheHits = 0;
    let totalResultCount = 0;
    let errorCount = 0;

    for (const record of typeRecords) {
      totalDurationMs += record.durationMs;
      maxDurationMs = Math.max(maxDurationMs, record.durationMs);
      minDurationMs = Math.min(minDurationMs, record.durationMs);
      totalResultCount += record.resultCount;

      if (record.fromCache) {
        cacheHits++;
      }
      if (record.error) {
        errorCount++;
      }
    }

    const totalQueries = typeRecords.length;

    return {
      queryType,
      totalQueries,
      averageDurationMs: totalDurationMs / totalQueries,
      maxDurationMs,
      minDurationMs,
      cacheHitRate: cacheHits / totalQueries,
      averageResultCount: totalResultCount / totalQueries,
      errorCount,
    };
  }

  /**
   * Calculate trend metrics for a specific time period.
   *
   * Filters records to those within the specified number of days from now.
   *
   * @param daysBack - Number of days to look back
   * @returns Trend metrics for the time period
   */
  private calculateTrendMetrics(daysBack: number): GraphTrendMetrics {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    const cutoffTimestamp = cutoffDate.toISOString();

    // Filter records within time period
    const recentRecords = this.records.filter((record) => record.timestamp >= cutoffTimestamp);

    if (recentRecords.length === 0) {
      return {
        queryCount: 0,
        averageDurationMs: 0,
        cacheHitRate: 0,
      };
    }

    let totalDurationMs = 0;
    let cacheHits = 0;

    for (const record of recentRecords) {
      totalDurationMs += record.durationMs;
      if (record.fromCache) {
        cacheHits++;
      }
    }

    const queryCount = recentRecords.length;

    return {
      queryCount,
      averageDurationMs: totalDurationMs / queryCount,
      cacheHitRate: cacheHits / queryCount,
    };
  }

  /**
   * Create empty metrics structure.
   *
   * @returns Empty metrics with all zeros
   */
  private emptyMetrics(): GraphMetrics {
    return {
      totalQueries: 0,
      averageDurationMs: 0,
      cacheHitRate: 0,
      byQueryType: GRAPH_QUERY_TYPES.map((queryType) => ({
        queryType,
        totalQueries: 0,
        averageDurationMs: 0,
        maxDurationMs: 0,
        minDurationMs: 0,
        cacheHitRate: 0,
        averageResultCount: 0,
        errorCount: 0,
      })),
      last7DaysTrend: {
        queryCount: 0,
        averageDurationMs: 0,
        cacheHitRate: 0,
      },
    };
  }
}

/**
 * Singleton instance of the graph metrics collector.
 *
 * Use this instance for application-wide metrics collection.
 *
 * @example
 * ```typescript
 * import { graphMetricsCollector } from "./graph-metrics-collector.js";
 *
 * graphMetricsCollector.record({...});
 * const metrics = graphMetricsCollector.getMetrics();
 * ```
 */
export const graphMetricsCollector = new GraphMetricsCollector();
