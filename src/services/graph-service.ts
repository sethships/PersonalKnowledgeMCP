/**
 * @module services/graph-service
 *
 * GraphService implementation for graph-based structural queries.
 *
 * This module provides the core business logic for querying code dependencies,
 * finding paths between entities, and exploring repository architecture using
 * the Neo4j knowledge graph.
 *
 * @see {@link file://./../../docs/pm/knowledge-graph-PRD.md} Section 5.2 and 6.1
 */

import { z } from "zod";
import type { Logger } from "pino";
import type { Neo4jStorageClient } from "../graph/types.js";
import { RelationshipType } from "../graph/types.js";
import { isRetryableGraphError } from "../graph/errors.js";
import { getComponentLogger } from "../logging/index.js";
import { QueryCache, type CacheConfig, DEFAULT_CACHE_CONFIG } from "./graph-service-cache.js";
import {
  DependencyQuerySchema,
  DependentQuerySchema,
  PathQuerySchema,
  ArchitectureQuerySchema,
  type ValidatedDependencyQuery,
  type ValidatedDependentQuery,
  type ValidatedPathQuery,
  type ValidatedArchitectureQuery,
} from "./graph-service-validation.js";
import { graphMetricsCollector } from "./graph-metrics-collector.js";
import {
  GraphServiceValidationError,
  GraphServiceOperationError,
  GraphServiceTimeoutError,
} from "./graph-service-errors.js";
import type {
  GraphService,
  DependencyQuery,
  DependentQuery,
  PathQuery,
  ArchitectureQuery,
  DependencyResult,
  DependentResult,
  PathResult,
  ArchitectureResult,
  DependencyItem,
  DependentItem,
  PathNode,
  ArchitectureNode,
  ModuleDependency,
  DetailLevel,
} from "./graph-service-types.js";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for GraphService
 */
export interface GraphServiceConfig {
  /**
   * Query timeout in milliseconds
   * @default 30000
   */
  timeoutMs: number;

  /**
   * Cache configuration
   */
  cache: Partial<CacheConfig>;
}

/**
 * Maximum number of nodes to return in a graph traversal query.
 * This limit prevents runaway queries on large graphs.
 */
const MAX_TRAVERSE_NODES = 1000;

/**
 * Default GraphService configuration
 */
export const DEFAULT_GRAPH_SERVICE_CONFIG: GraphServiceConfig = {
  timeoutMs: 30000, // 30 seconds
  cache: DEFAULT_CACHE_CONFIG,
};

// =============================================================================
// GraphService Implementation
// =============================================================================

/**
 * Implementation of GraphService using Neo4j for graph queries
 *
 * Provides high-level operations for analyzing code dependencies,
 * finding paths between entities, and exploring repository architecture.
 *
 * @example
 * ```typescript
 * const graphService = new GraphServiceImpl(neo4jClient);
 *
 * // Find what a file depends on
 * const deps = await graphService.getDependencies({
 *   entity_type: "file",
 *   entity_path: "src/services/auth.ts",
 *   repository: "my-project",
 * });
 *
 * // Find what depends on a function
 * const dependents = await graphService.getDependents({
 *   entity_type: "function",
 *   entity_path: "validateToken",
 *   repository: "my-project",
 *   depth: 2,
 * });
 * ```
 */
export class GraphServiceImpl implements GraphService {
  private _logger: Logger | null = null;
  private readonly config: GraphServiceConfig;

  // Separate caches for each query type to prevent key collisions
  private readonly dependencyCache: QueryCache<DependencyResult>;
  private readonly dependentCache: QueryCache<DependentResult>;
  private readonly pathCache: QueryCache<PathResult>;
  private readonly architectureCache: QueryCache<ArchitectureResult>;

  /**
   * Create a new GraphService instance
   *
   * @param neo4jClient - Neo4j storage client for graph operations
   * @param config - Optional configuration overrides
   */
  constructor(
    private readonly neo4jClient: Neo4jStorageClient,
    config: Partial<GraphServiceConfig> = {}
  ) {
    this.config = {
      ...DEFAULT_GRAPH_SERVICE_CONFIG,
      ...config,
      cache: { ...DEFAULT_CACHE_CONFIG, ...config.cache },
    };

    // Initialize caches
    this.dependencyCache = new QueryCache(this.config.cache);
    this.dependentCache = new QueryCache(this.config.cache);
    this.pathCache = new QueryCache(this.config.cache);
    this.architectureCache = new QueryCache(this.config.cache);
  }

  /**
   * Lazy-initialized logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:graph");
    }
    return this._logger;
  }

  // ===========================================================================
  // Public API Methods
  // ===========================================================================

  /**
   * Query direct dependencies of an entity
   */
  async getDependencies(query: DependencyQuery): Promise<DependencyResult> {
    const startTime = performance.now();

    try {
      // 1. Validate input
      const validated = this.validateDependencyQuery(query);

      // 2. Check cache
      const cacheKey = QueryCache.generateKey("dep", validated);
      const cached = this.dependencyCache.get(cacheKey);
      if (cached) {
        const queryTimeMs = Math.round(performance.now() - startTime);
        this.logger.debug({ cacheKey }, "Cache hit for getDependencies");

        // Record cache hit metrics
        graphMetricsCollector.record({
          queryType: "getDependencies",
          timestamp: new Date().toISOString(),
          durationMs: queryTimeMs,
          resultCount: cached.dependencies.length,
          depth: validated.depth,
          fromCache: true,
          repository: validated.repository,
        });

        return {
          ...cached,
          metadata: { ...cached.metadata, from_cache: true },
        };
      }

      // 3. Execute query with timeout
      const result = await this.withTimeout(
        this.executeDependencyQuery(validated),
        "getDependencies"
      );

      // 4. Cache result
      this.dependencyCache.set(cacheKey, result);

      // 5. Return with timing
      const queryTimeMs = Math.round(performance.now() - startTime);
      this.logger.info(
        {
          entity_type: validated.entity_type,
          entity_path: validated.entity_path,
          repository: validated.repository,
          dependencies_count: result.dependencies.length,
          query_time_ms: queryTimeMs,
        },
        "getDependencies completed"
      );

      // Record fresh query metrics
      graphMetricsCollector.record({
        queryType: "getDependencies",
        timestamp: new Date().toISOString(),
        durationMs: queryTimeMs,
        resultCount: result.dependencies.length,
        depth: validated.depth,
        fromCache: false,
        repository: validated.repository,
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          query_time_ms: queryTimeMs,
          from_cache: false,
        },
      };
    } catch (error) {
      // Record error metrics
      const errorDurationMs = Math.round(performance.now() - startTime);
      graphMetricsCollector.record({
        queryType: "getDependencies",
        timestamp: new Date().toISOString(),
        durationMs: errorDurationMs,
        resultCount: 0,
        fromCache: false,
        repository: query.repository,
        error: true,
      });
      this.handleError(error, "getDependencies", performance.now() - startTime);
      throw error;
    }
  }

  /**
   * Query what depends on an entity (reverse dependencies)
   */
  async getDependents(query: DependentQuery): Promise<DependentResult> {
    const startTime = performance.now();

    try {
      // 1. Validate input
      const validated = this.validateDependentQuery(query);

      // 2. Check cache
      const cacheKey = QueryCache.generateKey("dnt", validated);
      const cached = this.dependentCache.get(cacheKey);
      if (cached) {
        const queryTimeMs = Math.round(performance.now() - startTime);
        this.logger.debug({ cacheKey }, "Cache hit for getDependents");

        // Record cache hit metrics
        graphMetricsCollector.record({
          queryType: "getDependents",
          timestamp: new Date().toISOString(),
          durationMs: queryTimeMs,
          resultCount: cached.dependents.length,
          depth: validated.depth,
          fromCache: true,
          repository: validated.repository,
        });

        return {
          ...cached,
          metadata: { ...cached.metadata, from_cache: true },
        };
      }

      // 3. Execute query with timeout
      const result = await this.withTimeout(this.executeDependentQuery(validated), "getDependents");

      // 4. Cache result
      this.dependentCache.set(cacheKey, result);

      // 5. Return with timing
      const queryTimeMs = Math.round(performance.now() - startTime);
      this.logger.info(
        {
          entity_type: validated.entity_type,
          entity_path: validated.entity_path,
          repository: validated.repository,
          dependents_count: result.dependents.length,
          impact_score: result.impact_analysis.impact_score,
          query_time_ms: queryTimeMs,
        },
        "getDependents completed"
      );

      // Record fresh query metrics
      graphMetricsCollector.record({
        queryType: "getDependents",
        timestamp: new Date().toISOString(),
        durationMs: queryTimeMs,
        resultCount: result.dependents.length,
        depth: validated.depth,
        fromCache: false,
        repository: validated.repository,
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          query_time_ms: queryTimeMs,
          from_cache: false,
        },
      };
    } catch (error) {
      // Record error metrics
      const errorDurationMs = Math.round(performance.now() - startTime);
      graphMetricsCollector.record({
        queryType: "getDependents",
        timestamp: new Date().toISOString(),
        durationMs: errorDurationMs,
        resultCount: 0,
        fromCache: false,
        repository: query.repository,
        error: true,
      });
      this.handleError(error, "getDependents", performance.now() - startTime);
      throw error;
    }
  }

  /**
   * Trace call/import chain between two entities
   */
  async getPath(query: PathQuery): Promise<PathResult> {
    const startTime = performance.now();

    try {
      // 1. Validate input
      const validated = this.validatePathQuery(query);

      // 2. Check cache
      const cacheKey = QueryCache.generateKey("path", validated);
      const cached = this.pathCache.get(cacheKey);
      if (cached) {
        const queryTimeMs = Math.round(performance.now() - startTime);
        this.logger.debug({ cacheKey }, "Cache hit for getPath");

        // Record cache hit metrics
        graphMetricsCollector.record({
          queryType: "getPath",
          timestamp: new Date().toISOString(),
          durationMs: queryTimeMs,
          resultCount: cached.metadata.hops,
          fromCache: true,
          repository: validated.from_entity.repository,
        });

        return {
          ...cached,
          metadata: { ...cached.metadata, from_cache: true },
        };
      }

      // 3. Execute query with timeout
      const result = await this.withTimeout(this.executePathQuery(validated), "getPath");

      // 4. Cache result
      this.pathCache.set(cacheKey, result);

      // 5. Return with timing
      const queryTimeMs = Math.round(performance.now() - startTime);
      this.logger.info(
        {
          from_entity: validated.from_entity.path,
          to_entity: validated.to_entity.path,
          path_exists: result.path_exists,
          hops: result.metadata.hops,
          query_time_ms: queryTimeMs,
        },
        "getPath completed"
      );

      // Record fresh query metrics
      graphMetricsCollector.record({
        queryType: "getPath",
        timestamp: new Date().toISOString(),
        durationMs: queryTimeMs,
        resultCount: result.metadata.hops,
        fromCache: false,
        repository: validated.from_entity.repository,
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          query_time_ms: queryTimeMs,
          from_cache: false,
        },
      };
    } catch (error) {
      // Record error metrics
      const errorDurationMs = Math.round(performance.now() - startTime);
      graphMetricsCollector.record({
        queryType: "getPath",
        timestamp: new Date().toISOString(),
        durationMs: errorDurationMs,
        resultCount: 0,
        fromCache: false,
        repository: query.from_entity.repository,
        error: true,
      });
      this.handleError(error, "getPath", performance.now() - startTime);
      throw error;
    }
  }

  /**
   * Get module/package structure overview
   */
  async getArchitecture(query: ArchitectureQuery): Promise<ArchitectureResult> {
    const startTime = performance.now();

    try {
      // 1. Validate input
      const validated = this.validateArchitectureQuery(query);

      // 2. Check cache
      const cacheKey = QueryCache.generateKey("arch", validated);
      const cached = this.architectureCache.get(cacheKey);
      if (cached) {
        const queryTimeMs = Math.round(performance.now() - startTime);
        this.logger.debug({ cacheKey }, "Cache hit for getArchitecture");

        // Record cache hit metrics
        graphMetricsCollector.record({
          queryType: "getArchitecture",
          timestamp: new Date().toISOString(),
          durationMs: queryTimeMs,
          resultCount: cached.metrics.total_files,
          fromCache: true,
          repository: validated.repository,
        });

        return {
          ...cached,
          metadata: { ...cached.metadata, from_cache: true },
        };
      }

      // 3. Execute query with timeout
      const result = await this.withTimeout(
        this.executeArchitectureQuery(validated),
        "getArchitecture"
      );

      // 4. Cache result
      this.architectureCache.set(cacheKey, result);

      // 5. Return with timing
      const queryTimeMs = Math.round(performance.now() - startTime);
      this.logger.info(
        {
          repository: validated.repository,
          scope: validated.scope,
          detail_level: validated.detail_level,
          total_files: result.metrics.total_files,
          total_modules: result.metrics.total_modules,
          query_time_ms: queryTimeMs,
        },
        "getArchitecture completed"
      );

      // Record fresh query metrics
      graphMetricsCollector.record({
        queryType: "getArchitecture",
        timestamp: new Date().toISOString(),
        durationMs: queryTimeMs,
        resultCount: result.metrics.total_files,
        fromCache: false,
        repository: validated.repository,
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          query_time_ms: queryTimeMs,
          from_cache: false,
        },
      };
    } catch (error) {
      // Record error metrics
      const errorDurationMs = Math.round(performance.now() - startTime);
      graphMetricsCollector.record({
        queryType: "getArchitecture",
        timestamp: new Date().toISOString(),
        durationMs: errorDurationMs,
        resultCount: 0,
        fromCache: false,
        repository: query.repository,
        error: true,
      });
      this.handleError(error, "getArchitecture", performance.now() - startTime);
      throw error;
    }
  }

  /**
   * Health check for Neo4j connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await this.neo4jClient.healthCheck();
    } catch (error) {
      this.logger.error({ err: error }, "GraphService health check failed");
      return false;
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.dependencyCache.clear();
    this.dependentCache.clear();
    this.pathCache.clear();
    this.architectureCache.clear();
    this.logger.info("GraphService caches cleared");
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): {
    dependency: ReturnType<QueryCache<DependencyResult>["stats"]>;
    dependent: ReturnType<QueryCache<DependentResult>["stats"]>;
    path: ReturnType<QueryCache<PathResult>["stats"]>;
    architecture: ReturnType<QueryCache<ArchitectureResult>["stats"]>;
  } {
    return {
      dependency: this.dependencyCache.stats(),
      dependent: this.dependentCache.stats(),
      path: this.pathCache.stats(),
      architecture: this.architectureCache.stats(),
    };
  }

  // ===========================================================================
  // Private: Query Execution Methods
  // ===========================================================================

  /**
   * Execute dependency query using Neo4jClient
   */
  private async executeDependencyQuery(query: ValidatedDependencyQuery): Promise<DependencyResult> {
    // Map to Neo4jClient analyzeDependencies with "dependsOn" direction
    const result = await this.neo4jClient.analyzeDependencies({
      target: {
        type: query.entity_type,
        identifier: query.entity_path,
        repository: query.repository,
      },
      direction: "dependsOn",
      transitive: query.include_transitive,
      maxDepth: query.depth,
    });

    // Transform to GraphService result format
    const dependencies: DependencyItem[] = result.direct.map((dep) => ({
      type: dep.type,
      path: dep.identifier,
      relationship_type: dep.relationshipType,
      depth: dep.depth,
    }));

    // Add transitive if included in query
    if (query.include_transitive && result.transitive && result.transitive.length > 0) {
      for (const dep of result.transitive) {
        dependencies.push({
          type: dep.type,
          path: dep.identifier,
          relationship_type: dep.relationshipType,
          depth: dep.depth,
        });
      }
    }

    return {
      entity: {
        type: query.entity_type,
        path: query.entity_path,
        repository: query.repository,
        display_name: this.getDisplayName(query.entity_path),
      },
      dependencies,
      metadata: {
        total_count: dependencies.length,
        query_time_ms: result.metadata.queryTimeMs,
        from_cache: false,
        depth_searched: query.depth,
      },
    };
  }

  /**
   * Execute dependent query using Neo4jClient
   */
  private async executeDependentQuery(query: ValidatedDependentQuery): Promise<DependentResult> {
    // Map to Neo4jClient analyzeDependencies with "dependedOnBy" direction
    const result = await this.neo4jClient.analyzeDependencies({
      target: {
        type: query.entity_type,
        identifier: query.entity_path,
        repository: query.repository ?? "unknown",
      },
      direction: "dependedOnBy",
      transitive: query.depth > 1,
      maxDepth: query.depth,
    });

    // Transform to GraphService result format
    const dependents: DependentItem[] = result.direct.map((dep) => ({
      type: dep.type,
      path: dep.identifier,
      repository: dep.repository,
      relationship_type: dep.relationshipType,
      depth: dep.depth,
    }));

    // Add transitive if included
    if (result.transitive && result.transitive.length > 0) {
      for (const dep of result.transitive) {
        dependents.push({
          type: dep.type,
          path: dep.identifier,
          repository: dep.repository,
          relationship_type: dep.relationshipType,
          depth: dep.depth,
        });
      }
    }

    const repositoriesSearched = query.include_cross_repo
      ? ["all"]
      : [query.repository ?? "unknown"];

    return {
      entity: {
        type: query.entity_type,
        path: query.entity_path,
        repository: query.repository ?? "unknown",
        display_name: this.getDisplayName(query.entity_path),
      },
      dependents,
      impact_analysis: {
        direct_impact_count: result.metadata.directCount,
        transitive_impact_count: result.metadata.transitiveCount,
        impact_score: result.impactScore,
      },
      metadata: {
        total_count: dependents.length,
        query_time_ms: result.metadata.queryTimeMs,
        from_cache: false,
        repositories_searched: repositoriesSearched,
      },
    };
  }

  /**
   * Execute path query using Neo4jClient traverse
   */
  private async executePathQuery(query: ValidatedPathQuery): Promise<PathResult> {
    // Use Neo4j traverse to find shortest path
    const relationshipFilter: RelationshipType[] = query.relationship_types
      ? (query.relationship_types as RelationshipType[])
      : [RelationshipType.IMPORTS, RelationshipType.CALLS, RelationshipType.REFERENCES];

    const result = await this.neo4jClient.traverse({
      startNode: {
        type: query.from_entity.type,
        identifier: query.from_entity.path,
        repository: query.from_entity.repository,
      },
      relationships: relationshipFilter,
      depth: query.max_hops,
      limit: MAX_TRAVERSE_NODES,
    });

    // Check if target node is in results
    const targetFound = result.nodes.some(
      (n) =>
        (n.properties?.["path"] === query.to_entity.path ||
          n.properties?.["name"] === query.to_entity.path) &&
        (n.properties?.["repository"] === query.to_entity.repository || !query.to_entity.repository)
    );

    // Build path if target found in traversal results
    const reconstructedPath = targetFound
      ? this.reconstructPath(result.nodes, result.relationships, query)
      : [];

    // BFS may return empty path even if target exists (disconnected in subgraph)
    const actualPathExists = reconstructedPath.length > 0;
    const path = actualPathExists ? reconstructedPath : null;

    return {
      path_exists: actualPathExists,
      path,
      metadata: {
        hops: path ? path.length - 1 : 0,
        query_time_ms: result.metadata.queryTimeMs,
        from_cache: false,
      },
    };
  }

  /**
   * Execute architecture query using Neo4jClient
   */
  private async executeArchitectureQuery(
    query: ValidatedArchitectureQuery
  ): Promise<ArchitectureResult> {
    // Build Cypher based on detail level
    const cypher = this.buildArchitectureCypher(query);

    // Execute query
    const results = await this.neo4jClient.runQuery<Record<string, unknown>>(cypher, {
      repository: query.repository,
      scope: query.scope ?? "",
    });

    // Build hierarchical structure
    const structure = this.buildArchitectureTree(results, query.detail_level);

    // Get inter-module dependencies
    const moduleDeps = await this.getModuleDependencies(query.repository, query.scope);

    // Calculate metrics
    const metrics = {
      total_files: this.countNodes(structure, "file"),
      total_modules: this.countNodes(structure, "module") + this.countNodes(structure, "package"),
      total_entities: this.countNodes(structure, "function") + this.countNodes(structure, "class"),
    };

    return {
      repository: query.repository,
      scope: query.scope ?? null,
      structure,
      metrics,
      inter_module_dependencies: moduleDeps,
      metadata: {
        query_time_ms: 0, // Will be updated by caller
        from_cache: false,
        detail_level: query.detail_level,
      },
    };
  }

  // ===========================================================================
  // Private: Validation Methods
  // ===========================================================================

  private validateDependencyQuery(query: DependencyQuery): ValidatedDependencyQuery {
    try {
      return DependencyQuerySchema.parse(query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new GraphServiceValidationError(
          `Invalid dependency query: ${errors.join("; ")}`,
          errors
        );
      }
      throw error;
    }
  }

  private validateDependentQuery(query: DependentQuery): ValidatedDependentQuery {
    try {
      return DependentQuerySchema.parse(query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new GraphServiceValidationError(
          `Invalid dependent query: ${errors.join("; ")}`,
          errors
        );
      }
      throw error;
    }
  }

  private validatePathQuery(query: PathQuery): ValidatedPathQuery {
    try {
      return PathQuerySchema.parse(query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new GraphServiceValidationError(`Invalid path query: ${errors.join("; ")}`, errors);
      }
      throw error;
    }
  }

  private validateArchitectureQuery(query: ArchitectureQuery): ValidatedArchitectureQuery {
    try {
      return ArchitectureQuerySchema.parse(query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new GraphServiceValidationError(
          `Invalid architecture query: ${errors.join("; ")}`,
          errors
        );
      }
      throw error;
    }
  }

  // ===========================================================================
  // Private: Timeout and Error Handling
  // ===========================================================================

  /**
   * Wrap an operation with timeout handling
   *
   * Uses Promise.race with proper cleanup to avoid timer leaks.
   * The timeout is always cleared when the operation completes (success or failure).
   */
  private async withTimeout<T>(operation: Promise<T>, operationName: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new GraphServiceTimeoutError(
            `${operationName} timed out after ${this.config.timeoutMs}ms`,
            this.config.timeoutMs
          )
        );
      }, this.config.timeoutMs);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Handle and log errors
   */
  private handleError(error: unknown, operation: string, durationMs: number): void {
    const duration = Math.round(durationMs);

    if (error instanceof GraphServiceValidationError || error instanceof GraphServiceTimeoutError) {
      this.logger.warn(
        {
          error_type: error.constructor.name,
          message: error.message,
          retryable: error.retryable,
          duration_ms: duration,
        },
        `${operation} failed with known error`
      );
    } else if (error instanceof Error) {
      const retryable = isRetryableGraphError(error);
      this.logger.error(
        {
          error_type: error.constructor.name,
          message: error.message,
          retryable,
          duration_ms: duration,
          stack: error.stack,
        },
        `${operation} failed with unexpected error`
      );

      // Wrap in GraphServiceOperationError if not already a service error
      if (!(error instanceof GraphServiceOperationError)) {
        throw new GraphServiceOperationError(
          `${operation} failed: ${error.message}`,
          retryable,
          error
        );
      }
    }
  }

  // ===========================================================================
  // Private: Helper Methods
  // ===========================================================================

  /**
   * Extract display name from path
   */
  private getDisplayName(path: string): string {
    const segments = path.split(/[/\\]/);
    return segments[segments.length - 1] ?? path;
  }

  /**
   * Reconstruct path from traversal results
   */
  private reconstructPath(
    nodes: Array<{ id: string; type: string; properties: Record<string, unknown> }>,
    relationships: Array<{ from: string; to: string; type: RelationshipType }>,
    query: ValidatedPathQuery
  ): PathNode[] {
    // Build adjacency map
    const adjMap = new Map<string, Array<{ to: string; type: RelationshipType }>>();
    for (const rel of relationships) {
      if (!adjMap.has(rel.from)) {
        adjMap.set(rel.from, []);
      }
      const edges = adjMap.get(rel.from);
      if (edges) {
        edges.push({ to: rel.to, type: rel.type });
      }
    }

    // Build node lookup
    const nodeMap = new Map<string, { type: string; properties: Record<string, unknown> }>();
    for (const node of nodes) {
      nodeMap.set(node.id, { type: node.type, properties: node.properties });
    }

    // Find source node ID
    const sourceNode = nodes.find(
      (n) =>
        (n.properties?.["path"] === query.from_entity.path ||
          n.properties?.["name"] === query.from_entity.path) &&
        n.properties?.["repository"] === query.from_entity.repository
    );

    // Find target node ID
    const targetNode = nodes.find(
      (n) =>
        (n.properties?.["path"] === query.to_entity.path ||
          n.properties?.["name"] === query.to_entity.path) &&
        n.properties?.["repository"] === query.to_entity.repository
    );

    if (!sourceNode || !targetNode) {
      // Return empty path instead of fabricating a fake direct connection
      // This is more accurate than suggesting a path that may not exist
      this.logger.warn(
        {
          sourceFound: !!sourceNode,
          targetFound: !!targetNode,
          from_entity: query.from_entity.path,
          to_entity: query.to_entity.path,
        },
        "Path reconstruction failed: source or target node not found in traversal results"
      );
      return [];
    }

    // BFS to find shortest path
    const queue: Array<{ nodeId: string; path: PathNode[] }> = [
      {
        nodeId: sourceNode.id,
        path: [
          {
            type: sourceNode.type,
            identifier:
              (sourceNode.properties?.["path"] as string) ||
              (sourceNode.properties?.["name"] as string) ||
              sourceNode.id,
            repository: (sourceNode.properties?.["repository"] as string) || "unknown",
          },
        ],
      },
    ];
    const visited = new Set<string>([sourceNode.id]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;

      if (current.nodeId === targetNode.id) {
        return current.path;
      }

      const edges = adjMap.get(current.nodeId) ?? [];
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          const nextNode = nodeMap.get(edge.to);
          if (nextNode) {
            // Add relationship to current path's last node
            const newPath = [...current.path];
            const lastNode = newPath[newPath.length - 1];
            if (lastNode) {
              lastNode.relationship_to_next = edge.type;
            }

            // Add next node
            newPath.push({
              type: nextNode.type,
              identifier:
                (nextNode.properties?.["path"] as string) ||
                (nextNode.properties?.["name"] as string) ||
                edge.to,
              repository: (nextNode.properties?.["repository"] as string) || "unknown",
            });

            queue.push({ nodeId: edge.to, path: newPath });
          }
        }
      }
    }

    // No path found via BFS - return empty path
    // The caller's path_exists check should handle this case
    this.logger.debug(
      {
        from_entity: query.from_entity.path,
        to_entity: query.to_entity.path,
        nodes_searched: visited.size,
      },
      "BFS completed but no path found to target"
    );
    return [];
  }

  /**
   * Build Cypher query for architecture based on detail level
   */
  private buildArchitectureCypher(query: ValidatedArchitectureQuery): string {
    // Scope filter uses parameterization - $scope is passed as a query parameter
    // This is safe from Cypher injection because:
    // 1. query.scope is validated by Zod schema (non-empty string if present)
    // 2. The actual value is passed via parameterized query, not string interpolation
    // 3. The Neo4j driver handles proper escaping of parameter values
    const scopeFilter = query.scope ? "AND f.path STARTS WITH $scope" : "";

    switch (query.detail_level) {
      case "packages":
        return `
          MATCH (r:Repository {name: $repository})-[:CONTAINS]->(f:File)
          WHERE true ${scopeFilter}
          WITH split(f.path, '/')[0] as package, count(f) as fileCount
          RETURN package, fileCount
          ORDER BY package
        `;

      case "modules":
        return `
          MATCH (r:Repository {name: $repository})-[:CONTAINS]->(f:File)
          WHERE true ${scopeFilter}
          WITH split(f.path, '/') as parts, f
          WHERE size(parts) >= 2
          RETURN parts[0] as package, parts[1] as module, count(f) as fileCount
          ORDER BY package, module
        `;

      case "files":
        return `
          MATCH (r:Repository {name: $repository})-[:CONTAINS]->(f:File)
          WHERE true ${scopeFilter}
          RETURN f.path as path, f.extension as extension
          ORDER BY f.path
        `;

      case "entities":
        return `
          MATCH (r:Repository {name: $repository})-[:CONTAINS]->(f:File)
          WHERE true ${scopeFilter}
          OPTIONAL MATCH (f)-[:DEFINES]->(e)
          RETURN f.path as filePath, labels(e)[0] as entityType, e.name as entityName
          ORDER BY f.path, entityName
        `;

      default:
        return `
          MATCH (r:Repository {name: $repository})-[:CONTAINS]->(f:File)
          WHERE true ${scopeFilter}
          RETURN f.path as path
          ORDER BY f.path
        `;
    }
  }

  /**
   * Build hierarchical architecture tree from query results
   */
  private buildArchitectureTree(
    results: Record<string, unknown>[],
    detailLevel: DetailLevel
  ): ArchitectureNode {
    const root: ArchitectureNode = {
      name: "root",
      type: "package",
      path: "/",
      children: [],
    };

    if (results.length === 0) {
      return root;
    }

    // Group results by path segments
    const pathMap = new Map<string, ArchitectureNode>();

    for (const result of results) {
      switch (detailLevel) {
        case "packages": {
          const packageName = result["package"] as string;
          if (packageName && !pathMap.has(packageName)) {
            const node: ArchitectureNode = {
              name: packageName,
              type: "package",
              path: packageName,
              metrics: { file_count: result["fileCount"] as number },
            };
            pathMap.set(packageName, node);
            if (root.children) {
              root.children.push(node);
            }
          }
          break;
        }

        case "modules": {
          const packageName = result["package"] as string;
          const moduleName = result["module"] as string;
          const key = `${packageName}/${moduleName}`;

          if (!pathMap.has(packageName)) {
            const pkgNode: ArchitectureNode = {
              name: packageName,
              type: "package",
              path: packageName,
              children: [],
            };
            pathMap.set(packageName, pkgNode);
            if (root.children) {
              root.children.push(pkgNode);
            }
          }

          if (!pathMap.has(key)) {
            const modNode: ArchitectureNode = {
              name: moduleName,
              type: "module",
              path: key,
              metrics: { file_count: result["fileCount"] as number },
            };
            pathMap.set(key, modNode);
            const pkgNode = pathMap.get(packageName);
            if (pkgNode?.children) {
              pkgNode.children.push(modNode);
            }
          }
          break;
        }

        case "files": {
          const filePath = result["path"] as string;
          const segments = filePath.split("/");
          let currentPath = "";
          let parentNode = root;

          for (let i = 0; i < segments.length; i++) {
            const segment = segments[i] ?? "";
            if (!segment) continue;
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;

            if (!pathMap.has(currentPath)) {
              const isFile = i === segments.length - 1;
              const node: ArchitectureNode = {
                name: segment,
                type: isFile ? "file" : "module",
                path: currentPath,
                children: isFile ? undefined : [],
              };
              pathMap.set(currentPath, node);
              if (!parentNode.children) {
                parentNode.children = [];
              }
              parentNode.children.push(node);
            }
            const nextParent = pathMap.get(currentPath);
            if (nextParent) {
              parentNode = nextParent;
            }
          }
          break;
        }

        case "entities": {
          const filePath = result["filePath"] as string;
          const entityType = result["entityType"] as string;
          const entityName = result["entityName"] as string;

          if (!pathMap.has(filePath)) {
            const segments = filePath.split("/");
            let currentPath = "";
            let parentNode = root;

            for (let i = 0; i < segments.length; i++) {
              const segment = segments[i] ?? "";
              if (!segment) continue;
              currentPath = currentPath ? `${currentPath}/${segment}` : segment;

              if (!pathMap.has(currentPath)) {
                const isFile = i === segments.length - 1;
                const node: ArchitectureNode = {
                  name: segment,
                  type: isFile ? "file" : "module",
                  path: currentPath,
                  children: isFile ? [] : [],
                };
                pathMap.set(currentPath, node);
                if (!parentNode.children) {
                  parentNode.children = [];
                }
                parentNode.children.push(node);
              }
              const nextParent = pathMap.get(currentPath);
              if (nextParent) {
                parentNode = nextParent;
              }
            }
          }

          // Add entity to file
          if (entityName && entityType) {
            const fileNode = pathMap.get(filePath);
            if (fileNode) {
              if (!fileNode.children) {
                fileNode.children = [];
              }
              const entityNode: ArchitectureNode = {
                name: entityName,
                type: entityType.toLowerCase() as "function" | "class",
                path: `${filePath}::${entityName}`,
              };
              fileNode.children.push(entityNode);
            }
          }
          break;
        }
      }
    }

    return root;
  }

  /**
   * Count nodes of a specific type in the architecture tree
   */
  private countNodes(node: ArchitectureNode, type: string): number {
    let count = node.type === type ? 1 : 0;

    if (node.children) {
      for (const child of node.children) {
        count += this.countNodes(child, type);
      }
    }

    return count;
  }

  /**
   * Get inter-module dependencies
   */
  private async getModuleDependencies(
    repository: string,
    scope?: string
  ): Promise<ModuleDependency[]> {
    const scopeFilter = scope
      ? `AND f1.path STARTS WITH $scope AND f2.path STARTS WITH $scope`
      : "";

    const cypher = `
      MATCH (f1:File {repository: $repository})-[r:IMPORTS]->(f2:File {repository: $repository})
      WHERE true ${scopeFilter}
      WITH split(f1.path, '/')[0] as fromModule, split(f2.path, '/')[0] as toModule, type(r) as relType
      WHERE fromModule <> toModule
      RETURN fromModule, toModule, count(*) as relCount, collect(DISTINCT relType) as relTypes
      ORDER BY relCount DESC
    `;

    const results = await this.neo4jClient.runQuery<{
      fromModule: string;
      toModule: string;
      relCount: number;
      relTypes: string[];
    }>(cypher, { repository, scope: scope ?? "" });

    return results.map((r) => ({
      from_module: r.fromModule,
      to_module: r.toModule,
      relationship_count: typeof r.relCount === "number" ? r.relCount : 0,
      relationship_types: (r.relTypes ?? []) as RelationshipType[],
    }));
  }
}
