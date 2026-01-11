/**
 * @module services/graph-service-types
 *
 * Type definitions for GraphService operations.
 *
 * This module defines the interfaces for graph-based structural queries including
 * dependency analysis, path finding, and architecture exploration.
 *
 * @see {@link file://./../../docs/pm/knowledge-graph-PRD.md} Section 5.2 and 6.1
 */

import type { RelationshipType } from "../graph/types.js";

// =============================================================================
// Entity Types
// =============================================================================

/**
 * Entity type for graph queries
 */
export type EntityType = "file" | "function" | "class";

/**
 * Extended entity type including modules
 */
export type ExtendedEntityType = EntityType | "module";

/**
 * Structure level for architecture queries
 */
export type DetailLevel = "packages" | "modules" | "files" | "entities";

/**
 * Architecture node type in hierarchy
 */
export type ArchitectureNodeType = "package" | "module" | "file" | "function" | "class";

// =============================================================================
// Query Input Types
// =============================================================================

/**
 * Input parameters for getDependencies query
 *
 * Queries what a given entity depends on (forward dependencies).
 */
export interface DependencyQuery {
  /**
   * Type of entity to query dependencies for
   */
  entity_type: EntityType;

  /**
   * Entity identifier:
   * - For files: relative path (e.g., 'src/auth/middleware.ts')
   * - For functions/classes: fully qualified name (e.g., 'AuthMiddleware' or 'src/auth/middleware.ts::AuthMiddleware')
   */
  entity_path: string;

  /**
   * Repository name to scope the query
   */
  repository: string;

  /**
   * Depth of transitive dependencies to include (1 = direct only, 2+ = transitive)
   * @default 1
   * @minimum 1
   * @maximum 5
   */
  depth?: number;

  /**
   * Filter to specific relationship types. Omit for all types.
   */
  relationship_types?: RelationshipType[];

  /**
   * Include transitive dependencies in results
   * @default false
   */
  include_transitive?: boolean;
}

/**
 * Input parameters for getDependents query
 *
 * Queries what depends on a given entity (reverse dependencies / impact analysis).
 */
export interface DependentQuery {
  /**
   * Type of entity to find dependents for
   */
  entity_type: EntityType;

  /**
   * Entity identifier (path or name)
   */
  entity_path: string;

  /**
   * Repository name. If omitted, searches all repositories.
   */
  repository?: string;

  /**
   * Depth of transitive dependents to include
   * @default 1
   * @minimum 1
   * @maximum 5
   */
  depth?: number;

  /**
   * Include dependents from other repositories
   * @default false
   */
  include_cross_repo?: boolean;
}

/**
 * Entity reference for path queries
 */
export interface EntityReference {
  /**
   * Entity type
   */
  type: EntityType;

  /**
   * Entity path or name
   */
  path: string;

  /**
   * Repository containing the entity
   */
  repository: string;
}

/**
 * Input parameters for getPath query
 *
 * Finds the relationship path between two code entities.
 */
export interface PathQuery {
  /**
   * Starting entity for path search
   */
  from_entity: EntityReference;

  /**
   * Target entity to find path to
   */
  to_entity: EntityReference;

  /**
   * Maximum path length to search
   * @default 5
   * @minimum 1
   * @maximum 20
   */
  max_hops?: number;

  /**
   * Limit path to specific relationship types
   */
  relationship_types?: RelationshipType[];
}

/**
 * Input parameters for getArchitecture query
 *
 * Gets the architectural structure of a repository.
 */
export interface ArchitectureQuery {
  /**
   * Repository name to analyze
   */
  repository: string;

  /**
   * Specific package or directory to focus on (e.g., 'src/services')
   * If omitted, analyzes full repository.
   */
  scope?: string;

  /**
   * Level of detail to return
   */
  detail_level: DetailLevel;

  /**
   * Include external dependencies (node_modules, etc.)
   * @default false
   */
  include_external?: boolean;
}

// =============================================================================
// Query Result Types
// =============================================================================

/**
 * Information about a queried entity
 */
export interface EntityInfo {
  /**
   * Entity type
   */
  type: EntityType;

  /**
   * Full path or identifier
   */
  path: string;

  /**
   * Repository name
   */
  repository: string;

  /**
   * Human-readable display name
   */
  display_name: string;
}

/**
 * A single dependency item
 */
export interface DependencyItem {
  /**
   * Type of the dependency
   */
  type: ExtendedEntityType;

  /**
   * Path or identifier of the dependency
   */
  path: string;

  /**
   * Type of relationship connecting to target
   */
  relationship_type: RelationshipType;

  /**
   * Distance from the target (1 = direct, 2+ = transitive)
   */
  depth: number;

  /**
   * Additional metadata about the dependency
   */
  metadata?: {
    /**
     * Line number where dependency is referenced
     */
    line_number?: number;

    /**
     * Whether this is an external dependency (node_modules, etc.)
     */
    external?: boolean;
  };
}

/**
 * A single dependent item (reverse dependency)
 */
export interface DependentItem extends DependencyItem {
  /**
   * Repository containing the dependent
   */
  repository: string;
}

/**
 * Metadata for query results
 */
export interface QueryMetadata {
  /**
   * Total end-to-end query time in milliseconds
   */
  query_time_ms: number;

  /**
   * Whether result was served from cache
   */
  from_cache: boolean;
}

/**
 * Result of getDependencies query
 */
export interface DependencyResult {
  /**
   * Information about the queried entity
   */
  entity: EntityInfo;

  /**
   * Dependencies found for the entity
   */
  dependencies: DependencyItem[];

  /**
   * Query execution metadata
   */
  metadata: QueryMetadata & {
    /**
     * Total number of dependencies found
     */
    total_count: number;

    /**
     * Maximum depth that was searched
     */
    depth_searched: number;
  };
}

/**
 * Impact analysis for dependents query
 */
export interface ImpactAnalysis {
  /**
   * Count of direct dependents (depth = 1)
   */
  direct_impact_count: number;

  /**
   * Count of transitive dependents (depth > 1)
   */
  transitive_impact_count: number;

  /**
   * Normalized impact score (0 = no impact, 1 = high impact)
   * Calculated based on dependent count relative to repository size.
   */
  impact_score: number;
}

/**
 * Result of getDependents query
 */
export interface DependentResult {
  /**
   * Information about the queried entity
   */
  entity: EntityInfo;

  /**
   * Dependents found for the entity
   */
  dependents: DependentItem[];

  /**
   * Impact analysis summary
   */
  impact_analysis: ImpactAnalysis;

  /**
   * Query execution metadata
   */
  metadata: QueryMetadata & {
    /**
     * Total number of dependents found
     */
    total_count: number;

    /**
     * Repositories that were searched
     */
    repositories_searched: string[];
  };
}

/**
 * A node in the path between two entities
 */
export interface PathNode {
  /**
   * Node type
   */
  type: string;

  /**
   * Node identifier (path or name)
   */
  identifier: string;

  /**
   * Repository containing the node
   */
  repository: string;

  /**
   * Relationship type to the next node in the path
   * (undefined for the last node)
   */
  relationship_to_next?: RelationshipType;
}

/**
 * Result of getPath query
 */
export interface PathResult {
  /**
   * Whether a path exists between the entities
   */
  path_exists: boolean;

  /**
   * The path from source to target (null if no path exists)
   * Nodes are ordered from source to target.
   */
  path: PathNode[] | null;

  /**
   * Query execution metadata
   */
  metadata: QueryMetadata & {
    /**
     * Number of hops in the found path (0 if no path)
     */
    hops: number;
  };
}

/**
 * A node in the architecture hierarchy
 */
export interface ArchitectureNode {
  /**
   * Node name (e.g., directory name, file name)
   */
  name: string;

  /**
   * Type of architectural component
   */
  type: ArchitectureNodeType;

  /**
   * Full path relative to repository root
   */
  path: string;

  /**
   * Child nodes (for hierarchical structure)
   */
  children?: ArchitectureNode[];

  /**
   * Metrics for this node (if applicable)
   */
  metrics?: {
    file_count?: number;
    function_count?: number;
    class_count?: number;
  };

  /**
   * Dependencies this node has to other nodes
   */
  dependencies?: Array<{
    target: string;
    relationship: string;
    count: number;
  }>;
}

/**
 * A dependency between modules
 */
export interface ModuleDependency {
  /**
   * Source module path
   */
  from_module: string;

  /**
   * Target module path
   */
  to_module: string;

  /**
   * Count of relationships between modules
   */
  relationship_count: number;

  /**
   * Types of relationships
   */
  relationship_types: RelationshipType[];
}

/**
 * Metrics for the entire architecture
 */
export interface ArchitectureMetrics {
  /**
   * Total number of files
   */
  total_files: number;

  /**
   * Total number of modules/directories
   */
  total_modules: number;

  /**
   * Total number of code entities (functions + classes)
   */
  total_entities: number;
}

/**
 * Result of getArchitecture query
 */
export interface ArchitectureResult {
  /**
   * Repository analyzed
   */
  repository: string;

  /**
   * Scope filter applied (null if full repository)
   */
  scope: string | null;

  /**
   * Hierarchical structure of the repository
   */
  structure: ArchitectureNode;

  /**
   * Aggregate metrics
   */
  metrics: ArchitectureMetrics;

  /**
   * Dependencies between modules/packages
   */
  inter_module_dependencies: ModuleDependency[];

  /**
   * Query execution metadata
   */
  metadata: QueryMetadata & {
    /**
     * Detail level used for query
     */
    detail_level: DetailLevel;
  };
}

// =============================================================================
// Service Interface
// =============================================================================

/**
 * GraphService interface for graph-based structural queries
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
 * // Analyze impact of changing a function
 * const impact = await graphService.getDependents({
 *   entity_type: "function",
 *   entity_path: "validateToken",
 *   repository: "my-project",
 *   depth: 2,
 * });
 * ```
 */
export interface GraphService {
  /**
   * Query direct dependencies of an entity
   *
   * @param query - Dependency query parameters
   * @returns Dependencies with metadata
   * @throws {GraphServiceValidationError} Invalid query parameters
   * @throws {EntityNotFoundError} Entity not found in graph
   * @throws {GraphServiceTimeoutError} Query timed out
   * @throws {GraphServiceOperationError} Graph operation failed
   */
  getDependencies(query: DependencyQuery): Promise<DependencyResult>;

  /**
   * Query what depends on an entity (reverse dependencies)
   *
   * @param query - Dependent query parameters
   * @returns Dependents with impact analysis
   * @throws {GraphServiceValidationError} Invalid query parameters
   * @throws {EntityNotFoundError} Entity not found in graph
   * @throws {GraphServiceTimeoutError} Query timed out
   * @throws {GraphServiceOperationError} Graph operation failed
   */
  getDependents(query: DependentQuery): Promise<DependentResult>;

  /**
   * Trace call/import chain between two entities
   *
   * @param query - Path query parameters
   * @returns Path between entities if one exists
   * @throws {GraphServiceValidationError} Invalid query parameters
   * @throws {GraphServiceTimeoutError} Query timed out
   * @throws {GraphServiceOperationError} Graph operation failed
   */
  getPath(query: PathQuery): Promise<PathResult>;

  /**
   * Get module/package structure overview
   *
   * @param query - Architecture query parameters
   * @returns Hierarchical structure with metrics
   * @throws {GraphServiceValidationError} Invalid query parameters
   * @throws {GraphServiceTimeoutError} Query timed out
   * @throws {GraphServiceOperationError} Graph operation failed
   */
  getArchitecture(query: ArchitectureQuery): Promise<ArchitectureResult>;

  /**
   * Health check for Neo4j connection
   *
   * @returns true if graph database is healthy, false otherwise
   */
  healthCheck(): Promise<boolean>;
}
