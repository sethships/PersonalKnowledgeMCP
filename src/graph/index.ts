/**
 * @module graph
 *
 * Knowledge Graph Module
 *
 * This module provides the public API for:
 * - AST parsing and entity extraction (parsing submodule)
 * - Graph database operations via the adapter pattern (FalkorDB)
 *
 * The knowledge graph complements ChromaDB vector search by storing explicit
 * relationships between code entities (functions, classes, modules) enabling
 * relationship-aware queries and dependency analysis.
 *
 * Note: Neo4j support was removed in favor of FalkorDB per ADR-0004.
 *
 * @see {@link file://./../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 *
 * @example
 * ```typescript
 * import {
 *   createGraphAdapter,
 *   type GraphStorageAdapter,
 *   type GraphStorageConfig,
 *   GraphTraverseInput,
 *   RelationshipType,
 *   GraphError,
 * } from "./graph/index.js";
 *
 * const config: GraphStorageConfig = {
 *   host: "localhost",
 *   port: 6379,
 *   username: "default",
 *   password: process.env.FALKORDB_PASSWORD,
 *   database: "knowledge_graph",
 * };
 *
 * // Create adapter using factory function
 * const adapter = createGraphAdapter('falkordb', config);
 * await adapter.connect();
 *
 * const result = await adapter.traverse({
 *   startNode: { type: "function", identifier: "searchService" },
 *   relationships: [RelationshipType.CALLS],
 *   depth: 2,
 * });
 * ```
 */

// =============================================================================
// Parsing Module (AST parsing, entity extraction)
// =============================================================================

export * from "./parsing/index.js";

// =============================================================================
// Extraction Module (High-level entity extraction API)
// =============================================================================

export * from "./extraction/index.js";

// =============================================================================
// Adapter Module (Database-agnostic adapter interface)
// =============================================================================

export { createGraphAdapter } from "./adapters/index.js";

export type {
  GraphAdapterType,
  GraphStorageConfig,
  GraphStorageAdapter,
} from "./adapters/types.js";

// =============================================================================
// Configuration Types (Deprecated - use GraphStorageConfig instead)
// =============================================================================

/**
 * @deprecated Use GraphStorageConfig from './adapters/types.js' instead.
 * Neo4j was removed in favor of FalkorDB per ADR-0004.
 */
export type { Neo4jConfig } from "./types.js";

// =============================================================================
// Node Types
// =============================================================================

export type {
  BaseNode,
  RepositoryNode,
  FileNode,
  FunctionNode,
  ClassNode,
  ModuleNode,
  ChunkNode,
  ConceptNode,
  GraphNode,
  ClassEntityType,
  ModuleType,
} from "./types.js";

// =============================================================================
// Relationship Types
// =============================================================================

export { RelationshipType } from "./types.js";

export type {
  BaseRelationship,
  Relationship,
  RelationshipProperties,
  ImportType,
  ImportsRelationshipProps,
  CallsRelationshipProps,
  DefinesRelationshipProps,
  ReferencesRelationshipProps,
  HasChunkRelationshipProps,
  RelatedToRelationshipProps,
  TaggedWithRelationshipProps,
} from "./types.js";

// =============================================================================
// Query Types
// =============================================================================

export type {
  NodeTypeFilter,
  TraversalStartNode,
  GraphTraverseInput,
  GraphTraverseResult,
  DependencyDirection,
  GraphDependenciesInput,
  DependencyInfo,
  GraphDependenciesResult,
  ContextType,
  GraphContextInput,
  ContextItem,
  GraphContextResult,
} from "./types.js";

// =============================================================================
// Client Interface (Deprecated - use GraphStorageAdapter instead)
// =============================================================================

/**
 * @deprecated Use GraphStorageAdapter from './adapters/types.js' instead.
 * Neo4j was removed in favor of FalkorDB per ADR-0004.
 */
export type { Neo4jStorageClient } from "./types.js";

// =============================================================================
// Error Classes
// =============================================================================

export {
  GraphError,
  GraphConnectionError,
  GraphAuthenticationError,
  GraphQueryError,
  GraphQueryTimeoutError,
  NodeNotFoundError,
  NodeConstraintError,
  RelationshipError,
  RelationshipNotFoundError,
  GraphSchemaError,
  TraversalLimitError,
} from "./errors.js";

// =============================================================================
// Error Utilities
// =============================================================================

export { isRetryableGraphError, mapGraphError } from "./errors.js";

// Schema Module
// =============================================================================

export {
  CONSTRAINTS,
  INDEXES,
  FULLTEXT_INDEXES,
  ALL_SCHEMA_ELEMENTS,
  getAllSchemaStatements,
  getSchemaElementsByType,
} from "./schema.js";

export type { SchemaElement, SchemaElementType } from "./schema.js";

// =============================================================================
// Migration Module
// =============================================================================

export { MigrationRunner, registerAllMigrations, ALL_MIGRATIONS } from "./migration/index.js";

export type {
  SchemaMigration,
  AppliedMigration,
  MigrationOptions,
  MigrationResult,
  SchemaStatus,
  MigrationRegistry,
} from "./migration/index.js";

// =============================================================================
// Ingestion Module (Graph data ingestion)
// =============================================================================

export * from "./ingestion/index.js";
