/**
 * @module graph
 *
 * Knowledge Graph Module
 *
 * This module provides the public API for:
 * - AST parsing and entity extraction (parsing submodule)
 * - Neo4j knowledge graph operations (types, errors)
 *
 * The knowledge graph complements ChromaDB vector search by storing explicit
 * relationships between code entities (functions, classes, modules) enabling
 * relationship-aware queries and dependency analysis.
 *
 * @see {@link file://./../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 *
 * @example
 * ```typescript
 * import {
 *   Neo4jStorageClient,
 *   Neo4jConfig,
 *   GraphTraverseInput,
 *   RelationshipType,
 *   GraphError,
 * } from "./graph/index.js";
 *
 * const config: Neo4jConfig = {
 *   host: "localhost",
 *   port: 7687,
 *   username: "neo4j",
 *   password: process.env.NEO4J_PASSWORD,
 * };
 *
 * // Use the client (implementation in separate issue)
 * const result = await client.traverse({
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
// Configuration Types
// =============================================================================

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
// Client Interface
// =============================================================================

export type { Neo4jStorageClient } from "./types.js";

// =============================================================================
// Client Implementation
// =============================================================================

export { Neo4jStorageClientImpl } from "./Neo4jClient.js";

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

export { isRetryableGraphError, mapNeo4jError } from "./errors.js";
