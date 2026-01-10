/**
 * @module graph/schema
 *
 * Neo4j schema definitions for the knowledge graph.
 *
 * This module defines the constraints and indexes required for optimal
 * graph performance and data integrity. All schema elements use
 * IF NOT EXISTS syntax for idempotent execution.
 *
 * @see {@link file://./../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 */

// =============================================================================
// Schema Element Types
// =============================================================================

/**
 * Type of schema element for categorization
 */
export type SchemaElementType = "constraint" | "index" | "fulltext_index";

/**
 * A single schema element (constraint or index)
 */
export interface SchemaElement {
  /** Unique name for this schema element */
  name: string;
  /** Type of schema element */
  type: SchemaElementType;
  /** Description of what this element does */
  description: string;
  /** Cypher statement to create the element */
  cypher: string;
}

// =============================================================================
// Constraint Definitions
// =============================================================================

/**
 * Unique constraints for node types
 *
 * These ensure data integrity by preventing duplicate nodes
 * with the same identifying properties.
 */
export const CONSTRAINTS: readonly SchemaElement[] = [
  {
    name: "repo_name",
    type: "constraint",
    description: "Ensure repository names are unique",
    cypher: "CREATE CONSTRAINT repo_name IF NOT EXISTS FOR (r:Repository) REQUIRE r.name IS UNIQUE",
  },
  {
    name: "file_path",
    type: "constraint",
    description: "Ensure file paths are unique within a repository",
    cypher:
      "CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE (f.repository, f.path) IS NODE KEY",
  },
  {
    name: "chunk_id",
    type: "constraint",
    description: "Ensure chunk ChromaDB IDs are unique",
    cypher: "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.chromaId IS UNIQUE",
  },
  {
    name: "concept_name",
    type: "constraint",
    description: "Ensure concept names are unique",
    cypher:
      "CREATE CONSTRAINT concept_name IF NOT EXISTS FOR (co:Concept) REQUIRE co.name IS UNIQUE",
  },
] as const;

// =============================================================================
// Index Definitions
// =============================================================================

/**
 * Performance indexes for common query patterns
 *
 * These indexes speed up lookups on frequently queried properties.
 */
export const INDEXES: readonly SchemaElement[] = [
  {
    name: "file_extension",
    type: "index",
    description: "Index for filtering files by extension",
    cypher: "CREATE INDEX file_extension IF NOT EXISTS FOR (f:File) ON (f.extension)",
  },
  {
    name: "function_name",
    type: "index",
    description: "Index for looking up functions by name",
    cypher: "CREATE INDEX function_name IF NOT EXISTS FOR (fn:Function) ON (fn.name)",
  },
  {
    name: "class_name",
    type: "index",
    description: "Index for looking up classes by name",
    cypher: "CREATE INDEX class_name IF NOT EXISTS FOR (c:Class) ON (c.name)",
  },
  {
    name: "module_name",
    type: "index",
    description: "Index for looking up modules by name",
    cypher: "CREATE INDEX module_name IF NOT EXISTS FOR (m:Module) ON (m.name)",
  },
] as const;

/**
 * Full-text indexes for semantic search across entities
 *
 * These enable natural language search across multiple node types.
 */
export const FULLTEXT_INDEXES: readonly SchemaElement[] = [
  {
    name: "entity_names",
    type: "fulltext_index",
    description: "Full-text search across function, class, and module names",
    cypher:
      "CREATE FULLTEXT INDEX entity_names IF NOT EXISTS FOR (n:Function|Class|Module) ON EACH [n.name]",
  },
] as const;

// =============================================================================
// Combined Schema
// =============================================================================

/**
 * All schema elements combined for iteration
 */
export const ALL_SCHEMA_ELEMENTS: readonly SchemaElement[] = [
  ...CONSTRAINTS,
  ...INDEXES,
  ...FULLTEXT_INDEXES,
] as const;

/**
 * Get all Cypher statements needed to create the full schema
 *
 * @returns Array of Cypher statements in execution order
 */
export function getAllSchemaStatements(): string[] {
  return ALL_SCHEMA_ELEMENTS.map((element) => element.cypher);
}

/**
 * Get schema elements by type
 *
 * @param type - The type of schema elements to retrieve
 * @returns Array of matching schema elements
 */
export function getSchemaElementsByType(type: SchemaElementType): readonly SchemaElement[] {
  return ALL_SCHEMA_ELEMENTS.filter((element) => element.type === type);
}
