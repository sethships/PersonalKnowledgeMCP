/**
 * @module graph/schema
 *
 * Adapter-aware graph database schema registry.
 *
 * This module provides schema definitions compatible with different graph
 * database backends (Neo4j, FalkorDB). Each adapter has its own Cypher
 * syntax requirements.
 *
 * @see {@link file://./../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 *
 * @example
 * ```typescript
 * import { getSchemaForAdapter, getAllSchemaStatements } from "./schema/index.js";
 *
 * // Get schema for specific adapter
 * const schema = getSchemaForAdapter("falkordb");
 * console.log(`${schema.constraints.length} constraints defined`);
 *
 * // Get all Cypher statements for migration
 * const statements = getAllSchemaStatements("neo4j");
 * for (const stmt of statements) {
 *   await adapter.runQuery(stmt);
 * }
 * ```
 */

import type { GraphAdapterType } from "../adapters/types.js";
import type { SchemaElement, SchemaElementType, AdapterSchema } from "./types.js";

// Import adapter-specific schemas
import * as neo4jSchema from "./neo4j.js";
import * as falkordbSchema from "./falkordb.js";

// =============================================================================
// Re-export Types
// =============================================================================

export type { SchemaElement, SchemaElementType, AdapterSchema } from "./types.js";

// =============================================================================
// Adapter Schema Registry
// =============================================================================

/**
 * Get schema definitions for a specific graph database adapter
 *
 * Returns the appropriate schema elements (constraints, indexes, fulltext indexes)
 * for the specified adapter type with correct Cypher syntax.
 *
 * @param adapter - Graph database adapter type
 * @returns Schema definition for the adapter
 *
 * @example
 * ```typescript
 * const schema = getSchemaForAdapter("falkordb");
 * // schema.fulltextIndexes will be empty (not supported)
 * // schema.constraints use OpenCypher syntax
 * ```
 */
export function getSchemaForAdapter(adapter: GraphAdapterType): AdapterSchema {
  switch (adapter) {
    case "neo4j":
      return {
        constraints: neo4jSchema.CONSTRAINTS,
        indexes: neo4jSchema.INDEXES,
        fulltextIndexes: neo4jSchema.FULLTEXT_INDEXES,
      };
    case "falkordb":
      return {
        constraints: falkordbSchema.CONSTRAINTS,
        indexes: falkordbSchema.INDEXES,
        fulltextIndexes: falkordbSchema.FULLTEXT_INDEXES,
      };
    default: {
      // TypeScript exhaustiveness check
      const _exhaustiveCheck: never = adapter;
      throw new Error(`Unknown adapter type: ${String(_exhaustiveCheck)}`);
    }
  }
}

/**
 * Get all Cypher statements needed to create the full schema for an adapter
 *
 * Returns statements in the correct execution order:
 * 1. Constraints (create first for data integrity)
 * 2. Regular indexes
 * 3. Fulltext indexes (if supported)
 *
 * @param adapter - Graph database adapter type
 * @returns Array of Cypher statements in execution order
 *
 * @example
 * ```typescript
 * const statements = getAllSchemaStatements("neo4j");
 * for (const stmt of statements) {
 *   await adapter.runQuery(stmt);
 * }
 * ```
 */
export function getAllSchemaStatements(adapter: GraphAdapterType): string[] {
  const schema = getSchemaForAdapter(adapter);
  return [
    ...schema.constraints.map((c) => c.cypher),
    ...schema.indexes.map((i) => i.cypher),
    ...schema.fulltextIndexes.map((f) => f.cypher),
  ];
}

/**
 * Get all schema elements for an adapter
 *
 * @param adapter - Graph database adapter type
 * @returns Array of all schema elements
 */
export function getAllSchemaElements(adapter: GraphAdapterType): readonly SchemaElement[] {
  const schema = getSchemaForAdapter(adapter);
  return [...schema.constraints, ...schema.indexes, ...schema.fulltextIndexes];
}

/**
 * Get schema elements by type for a specific adapter
 *
 * @param adapter - Graph database adapter type
 * @param type - The type of schema elements to retrieve
 * @returns Array of matching schema elements
 */
export function getSchemaElementsByType(
  adapter: GraphAdapterType,
  type: SchemaElementType
): readonly SchemaElement[] {
  return getAllSchemaElements(adapter).filter((element) => element.type === type);
}

// =============================================================================
// Legacy Support - Default to Neo4j (for backward compatibility)
// =============================================================================

/**
 * @deprecated Use getSchemaForAdapter("neo4j") instead
 *
 * Legacy exports for backward compatibility with existing code.
 * These default to Neo4j schema.
 */
export const CONSTRAINTS = neo4jSchema.CONSTRAINTS;
export const INDEXES = neo4jSchema.INDEXES;
export const FULLTEXT_INDEXES = neo4jSchema.FULLTEXT_INDEXES;
export const ALL_SCHEMA_ELEMENTS = neo4jSchema.ALL_SCHEMA_ELEMENTS;
