/**
 * @module graph/adapters/types
 *
 * Type definitions for the graph storage adapter abstraction layer.
 *
 * This module defines database-agnostic interfaces for graph storage operations,
 * enabling the system to swap between different graph databases (Neo4j, FalkorDB, etc.)
 * without changing business logic.
 *
 * @see {@link file://./../../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 */

import type { RetryConfig } from "../../utils/retry.js";
import type {
  GraphNode,
  RelationshipType,
  Relationship,
  RelationshipProperties,
  GraphTraverseInput,
  GraphTraverseResult,
  GraphDependenciesInput,
  GraphDependenciesResult,
  GraphContextInput,
  GraphContextResult,
} from "../types.js";

// =============================================================================
// Adapter Type Enumeration
// =============================================================================

/**
 * Supported graph database adapter types
 *
 * Used by the factory function to instantiate the correct adapter implementation.
 */
export type GraphAdapterType = "neo4j" | "falkordb";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for any graph storage adapter
 *
 * This interface is database-agnostic and works with both Neo4j and FalkorDB.
 * Database-specific options are handled internally by each adapter implementation.
 *
 * @example
 * ```typescript
 * const config: GraphStorageConfig = {
 *   host: "localhost",
 *   port: 7687,
 *   username: "neo4j",
 *   password: process.env.GRAPH_DB_PASSWORD,
 * };
 * ```
 */
export interface GraphStorageConfig {
  /** Graph database server host (default: 'localhost') */
  host: string;

  /** Graph database server port (Neo4j Bolt: 7687, FalkorDB: 6379) */
  port: number;

  /** Username for authentication */
  username: string;

  /** Password for authentication */
  password: string;

  /** Maximum connection pool size (default: 50) */
  maxConnectionPoolSize?: number;

  /** Connection acquisition timeout in ms (default: 30000) */
  connectionAcquisitionTimeout?: number;

  /** Optional retry configuration for transient failures */
  retry?: RetryConfig;

  /**
   * Database/graph name
   *
   * For Neo4j: The database name (default: 'neo4j')
   * For FalkorDB: The graph name within Redis
   */
  database?: string;
}

// =============================================================================
// Adapter Interface
// =============================================================================

/**
 * Abstract interface for graph storage operations
 *
 * This interface defines the contract for interacting with any graph database.
 * Implementations must provide all methods to ensure consistent behavior across
 * different database backends.
 *
 * Features expected from all implementations:
 * - Connection pooling and lifecycle management
 * - Automatic retry for transient failures
 * - Proper session/transaction handling
 * - Comprehensive error handling with typed errors
 *
 * @example
 * ```typescript
 * const adapter = createGraphAdapter('neo4j', config);
 * await adapter.connect();
 *
 * // Execute queries
 * const results = await adapter.runQuery<{ name: string }>(
 *   "MATCH (n:Repository) RETURN n.name as name"
 * );
 *
 * // Clean up
 * await adapter.disconnect();
 * ```
 */
export interface GraphStorageAdapter {
  /**
   * Connect to the graph database
   *
   * Initializes the connection pool and verifies connectivity.
   * Must be called before any other operations.
   *
   * @throws {GraphConnectionError} If connection fails after all retries
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the graph database
   *
   * Closes all connections and releases resources.
   * Safe to call multiple times.
   */
  disconnect(): Promise<void>;

  /**
   * Check if the connection is healthy
   *
   * @returns true if connected and server is responding
   */
  healthCheck(): Promise<boolean>;

  /**
   * Execute a Cypher query
   *
   * Both Neo4j and FalkorDB support Cypher query language.
   * Parameters should be used to prevent injection attacks.
   *
   * @param cypher - Cypher query string
   * @param params - Query parameters (use these for variable values)
   * @returns Array of query results
   * @throws {GraphQueryError} If query execution fails
   */
  runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;

  /**
   * Create or update a node
   *
   * Uses MERGE semantics - creates if not exists, updates if exists.
   * Node ID is generated based on node type and properties if not provided.
   *
   * @param node - Node data to create or update
   * @returns The created/updated node with ID
   * @throws {NodeConstraintError} If constraint violation occurs
   */
  upsertNode<N extends GraphNode>(node: Omit<N, "id"> & { id?: string }): Promise<N>;

  /**
   * Delete a node by ID
   *
   * Also deletes all relationships connected to the node (DETACH DELETE).
   *
   * @param nodeId - ID of the node to delete
   * @returns true if deleted, false if not found
   */
  deleteNode(nodeId: string): Promise<boolean>;

  /**
   * Create a relationship between nodes
   *
   * Creates a directed relationship from source to target node.
   * Both nodes must exist.
   *
   * @param fromNodeId - Source node ID
   * @param toNodeId - Target node ID
   * @param type - Relationship type
   * @param properties - Optional relationship properties
   * @returns The created relationship
   * @throws {NodeNotFoundError} If either node doesn't exist
   */
  createRelationship<P extends RelationshipProperties>(
    fromNodeId: string,
    toNodeId: string,
    type: RelationshipType,
    properties?: P
  ): Promise<Relationship<P>>;

  /**
   * Delete a relationship by ID
   *
   * @param relationshipId - ID of the relationship to delete
   * @returns true if deleted, false if not found
   */
  deleteRelationship(relationshipId: string): Promise<boolean>;

  /**
   * Traverse the graph from a starting node
   *
   * Performs a graph traversal following specified relationship types
   * up to the specified depth.
   *
   * @param input - Traversal parameters
   * @returns Traversal results with nodes and relationships
   */
  traverse(input: GraphTraverseInput): Promise<GraphTraverseResult>;

  /**
   * Analyze dependencies for a target entity
   *
   * Returns direct and optionally transitive dependencies
   * based on IMPORTS, CALLS, and REFERENCES relationships.
   *
   * @param input - Dependency analysis parameters
   * @returns Dependency analysis results with impact score
   */
  analyzeDependencies(input: GraphDependenciesInput): Promise<GraphDependenciesResult>;

  /**
   * Get related context for RAG enhancement
   *
   * Expands seed nodes to find related context such as imports,
   * callers, callees, siblings, and documentation.
   *
   * @param input - Context expansion parameters
   * @returns Context items for RAG enhancement
   */
  getContext(input: GraphContextInput): Promise<GraphContextResult>;
}

// =============================================================================
// Re-export Graph Types for Convenience
// =============================================================================

export type {
  GraphNode,
  RelationshipType,
  Relationship,
  RelationshipProperties,
  GraphTraverseInput,
  GraphTraverseResult,
  GraphDependenciesInput,
  GraphDependenciesResult,
  GraphContextInput,
  GraphContextResult,
} from "../types.js";
