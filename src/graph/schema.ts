/**
 * @module graph/schema
 *
 * Graph database schema definitions for the knowledge graph.
 *
 * This module provides adapter-aware schema definitions for different graph
 * database backends (Neo4j, FalkorDB). Each has different Cypher syntax.
 *
 * For new code, prefer importing from `./schema/index.js` directly.
 * This file provides backward compatibility with existing code.
 *
 * @see {@link file://./../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 * @see {@link ./schema/index.js} Adapter-aware schema registry
 */

// =============================================================================
// Re-export from new schema module (for backward compatibility)
// =============================================================================

export {
  // Types
  type SchemaElement,
  type SchemaElementType,
  type AdapterSchema,
  // Legacy exports (default to Neo4j)
  CONSTRAINTS,
  INDEXES,
  FULLTEXT_INDEXES,
  ALL_SCHEMA_ELEMENTS,
  // New adapter-aware functions
  getSchemaForAdapter,
  getAllSchemaElements,
} from "./schema/index.js";

// Import for local use
import {
  getAllSchemaStatements as _getAllSchemaStatements,
  getSchemaElementsByType as _getSchemaElementsByType,
} from "./schema/index.js";
import type { SchemaElementType, SchemaElement } from "./schema/index.js";
import type { GraphAdapterType } from "./adapters/types.js";

/**
 * Get all Cypher statements needed to create the full schema
 *
 * @param adapter - Graph database adapter type (default: "neo4j" for backward compatibility)
 * @returns Array of Cypher statements in execution order
 */
export function getAllSchemaStatements(adapter: GraphAdapterType = "neo4j"): string[] {
  return _getAllSchemaStatements(adapter);
}

/**
 * Get schema elements by type
 *
 * @param type - The type of schema elements to retrieve
 * @param adapter - Graph database adapter type (default: "neo4j" for backward compatibility)
 * @returns Array of matching schema elements
 */
export function getSchemaElementsByType(
  type: SchemaElementType,
  adapter: GraphAdapterType = "neo4j"
): readonly SchemaElement[] {
  return _getSchemaElementsByType(adapter, type);
}
