/**
 * Type definitions for graph query metrics tracking.
 *
 * Provides interfaces for tracking and aggregating performance metrics
 * for graph-based structural queries (dependencies, paths, architecture).
 *
 * @module services/graph-metrics-types
 */

/**
 * Graph query type identifier.
 *
 * Corresponds to the four main GraphService operations.
 */
export type GraphQueryType = "getDependencies" | "getDependents" | "getPath" | "getArchitecture";

/**
 * Array of all valid graph query types for iteration.
 */
export const GRAPH_QUERY_TYPES: GraphQueryType[] = [
  "getDependencies",
  "getDependents",
  "getPath",
  "getArchitecture",
];

/**
 * Individual graph query record.
 *
 * Captures timing and result information for a single query execution.
 *
 * @example
 * ```typescript
 * const record: GraphQueryRecord = {
 *   queryType: "getDependencies",
 *   timestamp: "2025-01-15T10:30:45.123Z",
 *   durationMs: 145,
 *   resultCount: 12,
 *   depth: 2,
 *   fromCache: false,
 *   repository: "PersonalKnowledgeMCP",
 * };
 * ```
 */
export interface GraphQueryRecord {
  /**
   * Type of graph query executed.
   */
  queryType: GraphQueryType;

  /**
   * ISO 8601 timestamp when the query was executed.
   *
   * @example "2025-01-15T10:30:45.123Z"
   */
  timestamp: string;

  /**
   * Total query execution time in milliseconds.
   *
   * Includes validation, cache lookup, execution, and result processing.
   *
   * @example 145
   */
  durationMs: number;

  /**
   * Number of results returned by the query.
   *
   * - getDependencies: number of dependencies
   * - getDependents: number of dependents
   * - getPath: number of hops (0 if no path)
   * - getArchitecture: total_files count
   *
   * @example 12
   */
  resultCount: number;

  /**
   * Query depth for dependency/dependent queries.
   *
   * Only applicable for getDependencies and getDependents.
   * Undefined for getPath and getArchitecture.
   *
   * @example 2
   */
  depth?: number;

  /**
   * Whether the result was served from cache.
   *
   * @example false
   */
  fromCache: boolean;

  /**
   * Repository being queried.
   *
   * May be undefined for cross-repository queries.
   *
   * @example "PersonalKnowledgeMCP"
   */
  repository?: string;

  /**
   * Whether the query resulted in an error.
   *
   * @default false
   */
  error?: boolean;
}

/**
 * Statistics for a specific graph query type.
 *
 * Aggregates metrics across multiple query executions of the same type.
 *
 * @example
 * ```typescript
 * const stats: GraphQueryTypeStats = {
 *   queryType: "getDependencies",
 *   totalQueries: 150,
 *   averageDurationMs: 125.5,
 *   maxDurationMs: 890,
 *   minDurationMs: 15,
 *   cacheHitRate: 0.42,
 *   averageResultCount: 8.3,
 *   errorCount: 2,
 * };
 * ```
 */
export interface GraphQueryTypeStats {
  /**
   * Query type these statistics apply to.
   */
  queryType: GraphQueryType;

  /**
   * Total number of queries executed.
   *
   * @example 150
   */
  totalQueries: number;

  /**
   * Average query duration in milliseconds.
   *
   * @example 125.5
   */
  averageDurationMs: number;

  /**
   * Maximum query duration in milliseconds.
   *
   * @example 890
   */
  maxDurationMs: number;

  /**
   * Minimum query duration in milliseconds.
   *
   * @example 15
   */
  minDurationMs: number;

  /**
   * Cache hit rate (0.0 to 1.0).
   *
   * Ratio of queries served from cache to total queries.
   *
   * @example 0.42 (42% cache hit rate)
   */
  cacheHitRate: number;

  /**
   * Average number of results per query.
   *
   * @example 8.3
   */
  averageResultCount: number;

  /**
   * Number of queries that resulted in errors.
   *
   * @example 2
   */
  errorCount: number;
}

/**
 * Trend metrics for graph queries over a time period.
 *
 * Captures statistics filtered to a time range (e.g., last 7 days).
 *
 * @example
 * ```typescript
 * const trend: GraphTrendMetrics = {
 *   queryCount: 85,
 *   averageDurationMs: 118.2,
 *   cacheHitRate: 0.45,
 * };
 * ```
 */
export interface GraphTrendMetrics {
  /**
   * Number of queries in the time period.
   *
   * @example 85
   */
  queryCount: number;

  /**
   * Average query duration in milliseconds.
   *
   * @example 118.2
   */
  averageDurationMs: number;

  /**
   * Cache hit rate (0.0 to 1.0).
   *
   * @example 0.45
   */
  cacheHitRate: number;
}

/**
 * Aggregate metrics for all graph queries.
 *
 * Provides comprehensive statistics across all query types
 * including totals, averages, per-type breakdowns, and trends.
 *
 * @example
 * ```typescript
 * const metrics: GraphMetrics = {
 *   totalQueries: 450,
 *   averageDurationMs: 135.8,
 *   cacheHitRate: 0.38,
 *   byQueryType: [...],
 *   last7DaysTrend: {...},
 * };
 * ```
 */
export interface GraphMetrics {
  /**
   * Total number of graph queries executed.
   *
   * @example 450
   */
  totalQueries: number;

  /**
   * Average query duration across all query types in milliseconds.
   *
   * @example 135.8
   */
  averageDurationMs: number;

  /**
   * Overall cache hit rate (0.0 to 1.0).
   *
   * @example 0.38
   */
  cacheHitRate: number;

  /**
   * Per-query-type statistics.
   *
   * Contains statistics for each of the four query types.
   */
  byQueryType: GraphQueryTypeStats[];

  /**
   * Trend metrics for the last 7 days.
   *
   * Statistics filtered to queries within the past 7 days.
   */
  last7DaysTrend: GraphTrendMetrics;
}
