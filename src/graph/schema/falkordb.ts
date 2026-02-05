/**
 * @module graph/schema/falkordb
 *
 * FalkorDB schema definitions for the knowledge graph.
 *
 * This module defines the constraints and indexes using OpenCypher syntax
 * compatible with FalkorDB (Redis-based graph database).
 *
 * Key differences from Neo4j 5.x:
 * - Constraint syntax: ON ... ASSERT ... IS UNIQUE (vs FOR ... REQUIRE ... IS UNIQUE)
 * - NODE KEY not supported - file uniqueness enforced at application level
 * - FULLTEXT indexes not supported - use individual indexes instead
 *
 * @see {@link file://./../../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 */

import type { SchemaElement } from "./types.js";

// =============================================================================
// Constraint Definitions (OpenCypher Syntax for FalkorDB)
// =============================================================================

/**
 * Unique constraints for node types
 *
 * These ensure data integrity by preventing duplicate nodes
 * with the same identifying properties.
 *
 * Uses OpenCypher syntax: ON ... ASSERT ... IS UNIQUE
 *
 * Note: NODE KEY constraints are not supported in FalkorDB.
 * File uniqueness (repository + path) is enforced at the application level
 * using a combined `id` property: "File:{repository}:{path}"
 */
export const CONSTRAINTS: readonly SchemaElement[] = [
  {
    name: "repo_name",
    type: "constraint",
    description: "Ensure repository names are unique",
    cypher: "CREATE CONSTRAINT ON (r:Repository) ASSERT r.name IS UNIQUE",
  },
  // Note: FalkorDB does not support NODE KEY (composite constraints)
  // File uniqueness is enforced via the `id` property: "File:{repository}:{path}"
  {
    name: "file_id",
    type: "constraint",
    description: "Ensure file IDs are unique (composite key workaround)",
    cypher: "CREATE CONSTRAINT ON (f:File) ASSERT f.id IS UNIQUE",
  },
  {
    name: "chunk_id",
    type: "constraint",
    description: "Ensure chunk ChromaDB IDs are unique",
    cypher: "CREATE CONSTRAINT ON (c:Chunk) ASSERT c.chromaId IS UNIQUE",
  },
  {
    name: "concept_name",
    type: "constraint",
    description: "Ensure concept names are unique",
    cypher: "CREATE CONSTRAINT ON (co:Concept) ASSERT co.name IS UNIQUE",
  },
] as const;

// =============================================================================
// Index Definitions
// =============================================================================

/**
 * Performance indexes for common query patterns
 *
 * These indexes speed up lookups on frequently queried properties.
 * FalkorDB index syntax is compatible with OpenCypher.
 */
export const INDEXES: readonly SchemaElement[] = [
  {
    name: "file_extension",
    type: "index",
    description: "Index for filtering files by extension",
    cypher: "CREATE INDEX FOR (f:File) ON (f.extension)",
  },
  {
    name: "function_name",
    type: "index",
    description: "Index for looking up functions by name",
    cypher: "CREATE INDEX FOR (fn:Function) ON (fn.name)",
  },
  {
    name: "class_name",
    type: "index",
    description: "Index for looking up classes by name",
    cypher: "CREATE INDEX FOR (c:Class) ON (c.name)",
  },
  {
    name: "module_name",
    type: "index",
    description: "Index for looking up modules by name",
    cypher: "CREATE INDEX FOR (m:Module) ON (m.name)",
  },
  // Additional indexes to compensate for lack of fulltext search
  {
    name: "file_repository",
    type: "index",
    description: "Index for filtering files by repository",
    cypher: "CREATE INDEX FOR (f:File) ON (f.repository)",
  },
  {
    name: "function_repository",
    type: "index",
    description: "Index for filtering functions by repository",
    cypher: "CREATE INDEX FOR (fn:Function) ON (fn.repository)",
  },
  {
    name: "class_repository",
    type: "index",
    description: "Index for filtering classes by repository",
    cypher: "CREATE INDEX FOR (c:Class) ON (c.repository)",
  },
] as const;

/**
 * Full-text indexes for semantic search across entities
 *
 * FalkorDB does not support full-text indexes.
 * This array is empty - use regular indexes for basic filtering.
 */
export const FULLTEXT_INDEXES: readonly SchemaElement[] = [] as const;

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
