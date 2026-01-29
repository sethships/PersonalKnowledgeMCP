/**
 * @module graph/adapters
 *
 * Graph storage adapter abstraction layer.
 *
 * This module provides the factory function and exports for creating
 * database-agnostic graph storage adapters. The adapter pattern enables
 * swapping between graph databases (Neo4j, FalkorDB) without changing
 * business logic.
 *
 * @example
 * ```typescript
 * import { createGraphAdapter, type GraphStorageAdapter } from './graph/adapters';
 *
 * const adapter = createGraphAdapter('neo4j', {
 *   host: 'localhost',
 *   port: 7687,
 *   username: 'neo4j',
 *   password: process.env.GRAPH_DB_PASSWORD!,
 * });
 *
 * await adapter.connect();
 * ```
 */

import type { GraphAdapterType, GraphStorageConfig, GraphStorageAdapter } from "./types.js";
import { Neo4jStorageClientImpl } from "../Neo4jClient.js";
import { FalkorDBAdapter } from "./FalkorDBAdapter.js";

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a graph storage adapter for the specified database type
 *
 * Factory function that instantiates the appropriate adapter implementation
 * based on the adapter type. This is the primary entry point for creating
 * graph storage connections.
 *
 * @param type - The graph database adapter type ('neo4j' or 'falkordb')
 * @param config - Configuration for the graph storage connection
 * @returns A configured GraphStorageAdapter instance
 * @throws {Error} If the adapter type is not implemented
 *
 * @example
 * ```typescript
 * // Create a Neo4j adapter
 * const neo4jAdapter = createGraphAdapter('neo4j', {
 *   host: 'localhost',
 *   port: 7687,
 *   username: 'neo4j',
 *   password: 'password',
 * });
 *
 * // Future: Create a FalkorDB adapter
 * const falkorAdapter = createGraphAdapter('falkordb', {
 *   host: 'localhost',
 *   port: 6379,
 *   username: 'default',
 *   password: 'password',
 *   database: 'knowledge_graph',
 * });
 * ```
 */
export function createGraphAdapter(
  type: GraphAdapterType,
  config: GraphStorageConfig
): GraphStorageAdapter {
  switch (type) {
    case "neo4j":
      return new Neo4jStorageClientImpl(config);

    case "falkordb":
      return new FalkorDBAdapter(config);

    default: {
      // TypeScript exhaustiveness check
      const _exhaustiveCheck: never = type;
      throw new Error(`Unknown graph adapter type: ${String(_exhaustiveCheck)}`);
    }
  }
}

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Adapter types
  GraphAdapterType,
  GraphStorageConfig,
  GraphStorageAdapter,
  // Graph entity types (re-exported for convenience)
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
} from "./types.js";
