/**
 * @module graph/schema/falkordb
 *
 * FalkorDB schema definitions for the knowledge graph.
 *
 * FalkorDB's Cypher dialect is restricted compared to Neo4j:
 *
 * - `CREATE CONSTRAINT ...` is **not supported** as a Cypher statement at all.
 *   FalkorDB exposes constraints through a Redis-side `GRAPH.CONSTRAINT CREATE`
 *   command, which also requires a supporting exact-match index. Earlier
 *   versions of this file emitted Neo4j-flavored `CREATE CONSTRAINT name ON
 *   (n:L) ASSERT ...` strings; FalkorDB rejects those at parse time and the
 *   server can drop the connection. We therefore omit constraints from the
 *   schema and rely on application-level uniqueness, which is already enforced
 *   by `FalkorDBAdapter.generateNodeId()` + `MERGE` upserts on a deterministic
 *   `id` property.
 *
 * - `CREATE INDEX <name> FOR ...` (named-index form) is also rejected.
 *   FalkorDB only accepts the unnamed form: `CREATE INDEX FOR (n:L) ON (n.p)`.
 *
 * - `FULLTEXT INDEX` is not supported.
 *
 * @see {@link file://./../../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 */

import type { SchemaElement } from "./types.js";

// =============================================================================
// Constraint Definitions
// =============================================================================

/**
 * FalkorDB does not accept Cypher `CREATE CONSTRAINT` statements. Uniqueness is
 * enforced at the application layer through deterministic node IDs and `MERGE`
 * upserts (see `FalkorDBAdapter.generateNodeId`). The properties that would
 * otherwise be constrained are still indexed below for query performance.
 */
export const CONSTRAINTS: readonly SchemaElement[] = [] as const;

// =============================================================================
// Index Definitions
// =============================================================================

/**
 * Performance indexes for common query patterns.
 *
 * Uses the unnamed FalkorDB Cypher form: `CREATE INDEX FOR (n:Label) ON (n.p)`.
 * The first four entries cover the properties that Neo4j enforces with unique
 * constraints; here they're plain indexes (uniqueness is enforced at the app
 * layer — see the module docstring).
 */
export const INDEXES: readonly SchemaElement[] = [
  // Indexes that backstop application-enforced uniqueness
  {
    name: "repository_name",
    type: "index",
    description: "Index Repository.name (uniqueness enforced at application layer)",
    cypher: "CREATE INDEX FOR (r:Repository) ON (r.name)",
  },
  {
    name: "file_id",
    type: "index",
    description: "Index File.id, the deterministic key 'File:{repository}:{path}'",
    cypher: "CREATE INDEX FOR (f:File) ON (f.id)",
  },
  {
    name: "chunk_id",
    type: "index",
    description: "Index Chunk.chromaId for chunk lookups",
    cypher: "CREATE INDEX FOR (c:Chunk) ON (c.chromaId)",
  },
  {
    name: "concept_name",
    type: "index",
    description: "Index Concept.name (uniqueness enforced at application layer)",
    cypher: "CREATE INDEX FOR (co:Concept) ON (co.name)",
  },
  // Performance indexes
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
  // Document-graph indexes (Phase D / issue #567)
  {
    name: "document_id",
    type: "index",
    description: "Index Document.id, deterministic key 'Document:{repository}:{path}'",
    cypher: "CREATE INDEX FOR (d:Document) ON (d.id)",
  },
  {
    name: "document_repository",
    type: "index",
    description: "Index for filtering documents by repository",
    cypher: "CREATE INDEX FOR (d:Document) ON (d.repository)",
  },
  {
    name: "section_documentId",
    type: "index",
    description: "Index for resolving Sections back to their owning Document",
    cypher: "CREATE INDEX FOR (s:Section) ON (s.documentId)",
  },
] as const;

/**
 * FalkorDB does not support full-text indexes.
 */
export const FULLTEXT_INDEXES: readonly SchemaElement[] = [] as const;

// =============================================================================
// Combined Schema
// =============================================================================

export const ALL_SCHEMA_ELEMENTS: readonly SchemaElement[] = [
  ...CONSTRAINTS,
  ...INDEXES,
  ...FULLTEXT_INDEXES,
] as const;
