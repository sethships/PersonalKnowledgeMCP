/**
 * @module graph/schema/types
 *
 * Type definitions for graph database schema elements.
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

/**
 * Schema definition for a specific graph database adapter
 */
export interface AdapterSchema {
  /** Unique constraints for node types */
  constraints: readonly SchemaElement[];
  /** Performance indexes for common query patterns */
  indexes: readonly SchemaElement[];
  /** Full-text indexes for semantic search (may be empty for some adapters) */
  fulltextIndexes: readonly SchemaElement[];
}
