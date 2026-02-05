/**
 * @module graph/schema/neo4j
 *
 * Neo4j 5.x schema definitions for the knowledge graph.
 *
 * This module defines the constraints and indexes using Neo4j 5.x Cypher syntax.
 * All schema elements use IF NOT EXISTS syntax for idempotent execution.
 *
 * @see {@link file://./../../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 */

import type { SchemaElement } from "./types.js";

// =============================================================================
// Constraint Definitions (Neo4j 5.x Syntax)
// =============================================================================

/**
 * Unique constraints for node types
 *
 * These ensure data integrity by preventing duplicate nodes
 * with the same identifying properties.
 *
 * Uses Neo4j 5.x syntax: FOR ... REQUIRE ... IS UNIQUE
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
 * Neo4j-specific feature - not available in FalkorDB.
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
