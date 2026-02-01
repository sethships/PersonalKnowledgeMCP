/**
 * @module graph/adapters
 *
 * Graph storage adapter abstraction layer.
 *
 * This module provides the factory function and exports for creating
 * graph storage adapters. Currently only FalkorDB is supported after
 * Neo4j was removed per ADR-0004.
 *
 * @example
 * ```typescript
 * import { createGraphAdapter, type GraphStorageAdapter } from './graph/adapters';
 *
 * const adapter = createGraphAdapter('falkordb', {
 *   host: 'localhost',
 *   port: 6379,
 *   username: 'default',
 *   password: process.env.FALKORDB_PASSWORD!,
 *   database: 'knowledge_graph',
 * });
 *
 * await adapter.connect();
 * ```
 */

import type { GraphAdapterType, GraphStorageConfig, GraphStorageAdapter } from "./types.js";
import { FalkorDBAdapter } from "./FalkorDBAdapter.js";

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a graph storage adapter for the specified database type
 *
 * Factory function that instantiates the appropriate adapter implementation
 * based on the adapter type. Currently only FalkorDB is supported.
 *
 * @param type - The graph database adapter type ('falkordb')
 * @param config - Configuration for the graph storage connection
 * @returns A configured GraphStorageAdapter instance
 * @throws {Error} If the adapter type is not implemented
 *
 * @example
 * ```typescript
 * // Create a FalkorDB adapter
 * const adapter = createGraphAdapter('falkordb', {
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
