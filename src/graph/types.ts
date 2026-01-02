/**
 * @module graph/types
 *
 * Type definitions for knowledge graph storage and operations.
 *
 * This module defines the interfaces and types for interacting with the Neo4j
 * knowledge graph database. The graph stores code relationships, dependencies,
 * and semantic concepts to enable relationship-aware queries and impact analysis.
 *
 * @see {@link file://./../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 */

import type { RetryConfig } from "../utils/retry.js";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for Neo4j client connection
 *
 * @example
 * ```typescript
 * const config: Neo4jConfig = {
 *   host: "localhost",
 *   port: 7687,
 *   username: "neo4j",
 *   password: process.env.NEO4J_PASSWORD,
 * };
 * ```
 */
export interface Neo4jConfig {
  /** Neo4j server host (default: 'localhost') */
  host: string;

  /** Neo4j Bolt protocol port (default: 7687) */
  port: number;

  /** Neo4j username for authentication */
  username: string;

  /** Neo4j password for authentication */
  password: string;

  /** Maximum connection pool size (default: 50) */
  maxConnectionPoolSize?: number;

  /** Connection acquisition timeout in ms (default: 30000) */
  connectionAcquisitionTimeout?: number;

  /** Optional retry configuration for transient failures */
  retry?: RetryConfig;
}

// =============================================================================
// Graph Node Types
// =============================================================================

/**
 * Base interface for all graph nodes
 *
 * All node types extend this interface to ensure consistent
 * identification and metadata across the graph.
 */
export interface BaseNode {
  /** Unique identifier for the node within Neo4j */
  id: string;

  /** Neo4j node labels (e.g., ['Repository'], ['File', 'SourceCode']) */
  labels: string[];
}

/**
 * Repository node representing an indexed code repository
 *
 * Maps to Neo4j label: `Repository`
 */
export interface RepositoryNode extends BaseNode {
  /** Repository name (e.g., 'PersonalKnowledgeMCP') */
  name: string;

  /** Full repository URL */
  url: string;

  /** ISO timestamp of last indexing operation */
  lastIndexed: string;

  /** Repository indexing status */
  status: "pending" | "indexing" | "ready" | "error";
}

/**
 * File node representing a source code or documentation file
 *
 * Maps to Neo4j label: `File`
 */
export interface FileNode extends BaseNode {
  /** File path relative to repository root */
  path: string;

  /** File extension (e.g., 'ts', 'md', 'py') */
  extension: string;

  /** SHA256 content hash for change detection */
  hash: string;

  /** Repository name this file belongs to */
  repository: string;
}

/**
 * Function node representing a function or method definition
 *
 * Maps to Neo4j label: `Function`
 */
export interface FunctionNode extends BaseNode {
  /** Function name */
  name: string;

  /** Function signature (e.g., 'async search(query: string): Promise<Result>') */
  signature: string;

  /** Line number where function definition starts */
  startLine: number;

  /** Line number where function definition ends */
  endLine: number;

  /** File path where this function is defined */
  filePath: string;

  /** Repository name */
  repository: string;
}

/**
 * Type of class-like entity in the codebase
 */
export type ClassEntityType = "class" | "interface" | "enum" | "type";

/**
 * Class node representing a class, interface, or enum definition
 *
 * Maps to Neo4j label: `Class`
 */
export interface ClassNode extends BaseNode {
  /** Class/interface/enum name */
  name: string;

  /** Type of entity */
  type: ClassEntityType;

  /** File path where this is defined */
  filePath: string;

  /** Line number where definition starts */
  startLine: number;

  /** Line number where definition ends */
  endLine: number;

  /** Repository name */
  repository: string;
}

/**
 * Type of module import
 */
export type ModuleType = "npm" | "local" | "builtin";

/**
 * Module node representing an ES module or package
 *
 * Maps to Neo4j label: `Module`
 */
export interface ModuleNode extends BaseNode {
  /** Module name (package name or relative path) */
  name: string;

  /** Module type */
  type: ModuleType;

  /** Version for npm packages (optional) */
  version?: string;
}

/**
 * Chunk node representing a reference to a ChromaDB vector chunk
 *
 * This node type bridges the graph database with the vector database,
 * enabling combined queries across both stores.
 *
 * Maps to Neo4j label: `Chunk`
 */
export interface ChunkNode extends BaseNode {
  /** ChromaDB document ID for this chunk */
  chromaId: string;

  /** Index of this chunk within the file (0-based) */
  chunkIndex: number;

  /** File path this chunk belongs to */
  filePath: string;

  /** Repository name */
  repository: string;
}

/**
 * Concept node representing a semantic concept or topic
 *
 * Used for tagging code entities with semantic meaning and
 * enabling concept-based queries.
 *
 * Maps to Neo4j label: `Concept`
 */
export interface ConceptNode extends BaseNode {
  /** Concept name (e.g., 'authentication', 'caching', 'error-handling') */
  name: string;

  /** Human-readable description of the concept */
  description?: string;

  /** Confidence score for auto-extracted concepts (0-1) */
  confidence?: number;
}

/**
 * Union type of all graph node types
 */
export type GraphNode =
  | RepositoryNode
  | FileNode
  | FunctionNode
  | ClassNode
  | ModuleNode
  | ChunkNode
  | ConceptNode;

// =============================================================================
// Relationship Types
// =============================================================================

/**
 * Enumeration of all relationship types in the knowledge graph
 *
 * @see ADR-0002 for relationship semantics and usage patterns
 */
export enum RelationshipType {
  /** Repository contains a file */
  CONTAINS = "CONTAINS",

  /** File defines a function, class, or other entity */
  DEFINES = "DEFINES",

  /** File imports a module */
  IMPORTS = "IMPORTS",

  /** Function calls another function */
  CALLS = "CALLS",

  /** Class implements an interface */
  IMPLEMENTS = "IMPLEMENTS",

  /** Class extends another class */
  EXTENDS = "EXTENDS",

  /** File references another file (e.g., documentation link) */
  REFERENCES = "REFERENCES",

  /** File has an associated vector chunk */
  HAS_CHUNK = "HAS_CHUNK",

  /** Concept is related to another concept */
  RELATED_TO = "RELATED_TO",

  /** Entity is tagged with a concept */
  TAGGED_WITH = "TAGGED_WITH",
}

/**
 * Base interface for all graph relationships
 */
export interface BaseRelationship {
  /** Unique identifier for the relationship */
  id: string;

  /** Relationship type */
  type: RelationshipType;

  /** ID of the source node */
  fromNodeId: string;

  /** ID of the target node */
  toNodeId: string;
}

/**
 * Import type for IMPORTS relationship
 */
export type ImportType = "named" | "default" | "namespace" | "side-effect";

/**
 * Properties for IMPORTS relationship
 */
export interface ImportsRelationshipProps {
  /** Type of import statement */
  importType: ImportType;

  /** Imported symbols (for named imports) */
  importedSymbols?: string[];
}

/**
 * Properties for CALLS relationship
 */
export interface CallsRelationshipProps {
  /** Number of times this call appears in the caller */
  callCount: number;

  /** Whether this is an async/await call */
  isAsync: boolean;
}

/**
 * Properties for DEFINES relationship
 */
export interface DefinesRelationshipProps {
  /** Line number where definition starts */
  startLine: number;

  /** Line number where definition ends */
  endLine: number;
}

/**
 * Properties for REFERENCES relationship
 */
export interface ReferencesRelationshipProps {
  /** Link text used in the reference */
  linkText?: string;

  /** Surrounding context of the reference */
  context?: string;
}

/**
 * Properties for HAS_CHUNK relationship
 */
export interface HasChunkRelationshipProps {
  /** Index of the chunk within the file */
  chunkIndex: number;
}

/**
 * Properties for RELATED_TO relationship (concept to concept)
 */
export interface RelatedToRelationshipProps {
  /** Similarity score between concepts (0-1) */
  similarity: number;

  /** Type of relationship (e.g., 'synonym', 'hypernym', 'related') */
  relationshipType: string;
}

/**
 * Properties for TAGGED_WITH relationship
 */
export interface TaggedWithRelationshipProps {
  /** Confidence score for the tagging (0-1) */
  confidence: number;
}

/**
 * Union type of all relationship property types
 */
export type RelationshipProperties =
  | ImportsRelationshipProps
  | CallsRelationshipProps
  | DefinesRelationshipProps
  | ReferencesRelationshipProps
  | HasChunkRelationshipProps
  | RelatedToRelationshipProps
  | TaggedWithRelationshipProps
  | Record<string, never>; // For relationships without properties

/**
 * Generic relationship with typed properties
 */
export interface Relationship<
  P extends RelationshipProperties = RelationshipProperties,
> extends BaseRelationship {
  /** Relationship-specific properties */
  properties: P;
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Node type specifier for graph queries
 */
export type NodeTypeFilter = "file" | "function" | "class" | "concept" | "chunk" | "module";

/**
 * Starting point for graph traversal
 */
export interface TraversalStartNode {
  /** Type of the starting node */
  type: NodeTypeFilter;

  /** Identifier (path for files, name for others) */
  identifier: string;

  /** Optional repository filter */
  repository?: string;
}

/**
 * Input for graph traversal operations
 *
 * @example
 * ```typescript
 * const input: GraphTraverseInput = {
 *   startNode: { type: "function", identifier: "searchService" },
 *   relationships: [RelationshipType.CALLS, RelationshipType.IMPORTS],
 *   depth: 2,
 *   limit: 50,
 * };
 * ```
 */
export interface GraphTraverseInput {
  /** Starting point for traversal */
  startNode: TraversalStartNode;

  /** Relationship types to follow */
  relationships: RelationshipType[];

  /** Maximum traversal depth (1-5, default: 2) */
  depth?: number;

  /** Maximum number of results (default: 100) */
  limit?: number;
}

/**
 * Result of a graph traversal operation
 */
export interface GraphTraverseResult {
  /** Nodes found during traversal */
  nodes: Array<{
    id: string;
    type: string;
    properties: Record<string, unknown>;
  }>;

  /** Relationships found during traversal */
  relationships: Array<{
    from: string;
    to: string;
    type: RelationshipType;
    properties: Record<string, unknown>;
  }>;

  /** Query metadata */
  metadata: {
    nodesCount: number;
    relationshipsCount: number;
    queryTimeMs: number;
  };
}

/**
 * Direction for dependency analysis
 */
export type DependencyDirection = "dependsOn" | "dependedOnBy" | "both";

/**
 * Input for dependency analysis operations
 */
export interface GraphDependenciesInput {
  /** Target entity to analyze */
  target: {
    type: "file" | "function" | "class";
    identifier: string;
    repository: string;
  };

  /** Direction of dependency analysis */
  direction: DependencyDirection;

  /** Include transitive dependencies */
  transitive?: boolean;

  /** Maximum depth for transitive analysis (default: 3) */
  maxDepth?: number;
}

/**
 * Information about a single dependency
 */
export interface DependencyInfo {
  /** Type of the dependent entity */
  type: "file" | "function" | "class" | "module";

  /** Entity identifier */
  identifier: string;

  /** Repository name */
  repository: string;

  /** Relationship type connecting to target */
  relationshipType: RelationshipType;

  /** Depth from the target (1 = direct, 2+ = transitive) */
  depth: number;
}

/**
 * Result of dependency analysis
 */
export interface GraphDependenciesResult {
  /** Direct dependencies */
  direct: DependencyInfo[];

  /** Transitive dependencies (if requested) */
  transitive?: DependencyInfo[];

  /** Impact score (0-1, how many things depend on this) */
  impactScore: number;

  /** Query metadata */
  metadata: {
    directCount: number;
    transitiveCount: number;
    queryTimeMs: number;
  };
}

/**
 * Context types to include in RAG enhancement
 */
export type ContextType = "imports" | "callers" | "callees" | "siblings" | "documentation";

/**
 * Input for graph context expansion (RAG enhancement)
 */
export interface GraphContextInput {
  /** Seed nodes from semantic search or explicit files */
  seeds: Array<{
    type: "file" | "chunk" | "function";
    identifier: string;
    repository?: string;
  }>;

  /** Types of context to include */
  includeContext: ContextType[];

  /** Maximum context items (default: 20) */
  limit?: number;
}

/**
 * A single context item in the result
 */
export interface ContextItem {
  /** Entity type */
  type: string;

  /** File path or identifier */
  path: string;

  /** Repository name */
  repository: string;

  /** Relevance score (0-1) */
  relevance: number;

  /** Reason for inclusion */
  reason: string;
}

/**
 * Result of graph context expansion
 */
export interface GraphContextResult {
  /** Context items found */
  context: ContextItem[];

  /** Query metadata */
  metadata: {
    seedsProcessed: number;
    contextItemsFound: number;
    queryTimeMs: number;
  };
}

// =============================================================================
// Client Interface
// =============================================================================

/**
 * Client interface for interacting with Neo4j graph storage
 *
 * This is the primary interface for all graph storage operations.
 * Implementation will be provided in a separate issue.
 *
 * @see Issue #143 for Neo4j Storage Client implementation
 */
export interface Neo4jStorageClient {
  /**
   * Connect to the Neo4j database
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the Neo4j database
   */
  disconnect(): Promise<void>;

  /**
   * Check if the connection is healthy
   */
  healthCheck(): Promise<boolean>;

  /**
   * Execute a Cypher query
   *
   * @param cypher - Cypher query string
   * @param params - Query parameters
   * @returns Query results
   */
  runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;

  /**
   * Create or update a node
   *
   * @param node - Node data to create or update
   * @returns The created/updated node
   */
  upsertNode<N extends GraphNode>(node: Omit<N, "id"> & { id?: string }): Promise<N>;

  /**
   * Delete a node by ID
   *
   * @param nodeId - ID of the node to delete
   * @returns true if deleted, false if not found
   */
  deleteNode(nodeId: string): Promise<boolean>;

  /**
   * Create a relationship between nodes
   *
   * @param fromNodeId - Source node ID
   * @param toNodeId - Target node ID
   * @param type - Relationship type
   * @param properties - Relationship properties
   * @returns The created relationship
   */
  createRelationship<P extends RelationshipProperties>(
    fromNodeId: string,
    toNodeId: string,
    type: RelationshipType,
    properties?: P
  ): Promise<Relationship<P>>;

  /**
   * Delete a relationship by ID
   *
   * @param relationshipId - ID of the relationship to delete
   * @returns true if deleted, false if not found
   */
  deleteRelationship(relationshipId: string): Promise<boolean>;

  /**
   * Traverse the graph from a starting node
   *
   * @param input - Traversal parameters
   * @returns Traversal results
   */
  traverse(input: GraphTraverseInput): Promise<GraphTraverseResult>;

  /**
   * Analyze dependencies for a target entity
   *
   * @param input - Dependency analysis parameters
   * @returns Dependency analysis results
   */
  analyzeDependencies(input: GraphDependenciesInput): Promise<GraphDependenciesResult>;

  /**
   * Get related context for RAG enhancement
   *
   * @param input - Context expansion parameters
   * @returns Context items
   */
  getContext(input: GraphContextInput): Promise<GraphContextResult>;
}
