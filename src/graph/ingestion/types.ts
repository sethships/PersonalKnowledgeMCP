/**
 * Type definitions for GraphIngestionService.
 *
 * Defines interfaces and types for graph ingestion operations,
 * including configuration, progress tracking, results, and errors.
 *
 * @module graph/ingestion/types
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for GraphIngestionService.
 *
 * Controls batch sizes and timeout settings for graph ingestion operations.
 *
 * @example
 * ```typescript
 * const config: GraphIngestionConfig = {
 *   nodeBatchSize: 50,
 *   relationshipBatchSize: 100,
 *   transactionTimeoutMs: 60000,
 * };
 * ```
 */
export interface GraphIngestionConfig {
  /**
   * Number of nodes to create per batch operation.
   * Larger batches are more efficient but use more memory.
   * @default 20
   */
  nodeBatchSize?: number;

  /**
   * Number of relationships to create per batch operation.
   * @default 50
   */
  relationshipBatchSize?: number;

  /**
   * Transaction timeout in milliseconds.
   *
   * **Note**: This setting is reserved for future use. Currently not implemented.
   * Once implemented, will control how long individual transactions are allowed
   * to run before being automatically rolled back.
   *
   * @default 30000
   */
  transactionTimeoutMs?: number;
}

/**
 * Default configuration values for GraphIngestionService.
 */
export const DEFAULT_GRAPH_INGESTION_CONFIG: Required<GraphIngestionConfig> = {
  nodeBatchSize: 20,
  relationshipBatchSize: 50,
  transactionTimeoutMs: 30000,
};

// =============================================================================
// Input Types
// =============================================================================

/**
 * Options for ingesting files into the graph database.
 *
 * @example
 * ```typescript
 * const options: GraphIngestionOptions = {
 *   repository: "my-repo",
 *   repositoryUrl: "https://github.com/user/my-repo.git",
 *   force: true,
 *   onProgress: (progress) => console.log(`${progress.phase}: ${progress.percentage}%`),
 * };
 * ```
 */
export interface GraphIngestionOptions {
  /**
   * Repository name for labeling nodes.
   */
  repository: string;

  /**
   * Full repository URL.
   */
  repositoryUrl: string;

  /**
   * Progress callback invoked at each pipeline phase.
   * Receives progress updates throughout the ingestion process.
   */
  onProgress?: (progress: GraphIngestionProgress) => void;

  /**
   * Whether to force re-ingestion even if repository data exists.
   * When true, deletes existing graph data and re-ingests from scratch.
   * @default false
   */
  force?: boolean;
}

/**
 * Input file for graph ingestion.
 */
export interface FileInput {
  /**
   * File path relative to repository root.
   */
  path: string;

  /**
   * File content as string.
   */
  content: string;

  /**
   * Optional SHA256 content hash for change detection.
   */
  hash?: string;
}

// =============================================================================
// Progress Types
// =============================================================================

/**
 * Phases of the graph ingestion pipeline.
 */
export type GraphIngestionPhase =
  | "initializing" // Setting up ingestion
  | "extracting_entities" // Extracting entities from files
  | "extracting_relationships" // Extracting import/export relationships
  | "creating_repository_node" // Creating the Repository node
  | "creating_file_nodes" // Creating File nodes
  | "creating_entity_nodes" // Creating Function/Class nodes
  | "creating_module_nodes" // Creating Module nodes for imports
  | "creating_relationships" // Creating all relationships
  | "verifying" // Verifying graph integrity
  | "completed"; // Ingestion complete

/**
 * Progress information for an ongoing graph ingestion operation.
 *
 * @example
 * ```typescript
 * const progress: GraphIngestionProgress = {
 *   phase: "creating_entity_nodes",
 *   repository: "my-repo",
 *   percentage: 45,
 *   details: {
 *     filesProcessed: 23,
 *     totalFiles: 50,
 *     nodesCreated: 156,
 *   },
 *   timestamp: new Date(),
 * };
 * ```
 */
export interface GraphIngestionProgress {
  /**
   * Current phase of the ingestion process.
   */
  phase: GraphIngestionPhase;

  /**
   * Repository being ingested.
   */
  repository: string;

  /**
   * Overall progress percentage (0-100).
   */
  percentage: number;

  /**
   * Phase-specific details.
   */
  details: {
    /**
     * Number of files processed so far.
     */
    filesProcessed?: number;

    /**
     * Total number of files to process.
     */
    totalFiles?: number;

    /**
     * Number of nodes created.
     */
    nodesCreated?: number;

    /**
     * Number of relationships created.
     */
    relationshipsCreated?: number;

    /**
     * Current batch number being processed (1-based).
     */
    currentBatch?: number;

    /**
     * Total number of batches to process.
     */
    totalBatches?: number;

    /**
     * Number of entities extracted.
     */
    entitiesExtracted?: number;

    /**
     * Number of import relationships extracted.
     */
    importsExtracted?: number;
  };

  /**
   * Timestamp of this progress update.
   */
  timestamp: Date;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Final status of a graph ingestion operation.
 */
export type GraphIngestionStatus =
  | "success" // Fully ingested without errors
  | "partial" // Ingested with some file/node errors
  | "failed"; // Fatal error, ingestion incomplete

/**
 * Result of a graph ingestion operation.
 *
 * @example
 * ```typescript
 * const result: GraphIngestionResult = {
 *   status: "success",
 *   repository: "my-repo",
 *   stats: {
 *     filesProcessed: 50,
 *     filesFailed: 0,
 *     nodesCreated: 234,
 *     relationshipsCreated: 567,
 *     durationMs: 12500,
 *   },
 *   errors: [],
 *   completedAt: new Date(),
 * };
 * ```
 */
export interface GraphIngestionResult {
  /**
   * Final status of the ingestion operation.
   */
  status: GraphIngestionStatus;

  /**
   * Repository name.
   */
  repository: string;

  /**
   * Statistics from the ingestion process.
   */
  stats: GraphIngestionStats;

  /**
   * Errors encountered during ingestion.
   * Empty array means no errors.
   */
  errors: GraphIngestionError[];

  /**
   * Timestamp when ingestion completed.
   */
  completedAt: Date;
}

/**
 * Statistics from a graph ingestion operation.
 */
export interface GraphIngestionStats {
  /**
   * Number of files successfully processed.
   */
  filesProcessed: number;

  /**
   * Number of files that failed to process.
   */
  filesFailed: number;

  /**
   * Total number of nodes created (Repository, File, Function, Class, Module).
   */
  nodesCreated: number;

  /**
   * Total number of relationships created (CONTAINS, DEFINES, IMPORTS).
   */
  relationshipsCreated: number;

  /**
   * Total duration of ingestion operation in milliseconds.
   */
  durationMs: number;

  /**
   * Breakdown of nodes by type.
   */
  nodesByType?: {
    repository?: number;
    file?: number;
    function?: number;
    class?: number;
    module?: number;
  };

  /**
   * Breakdown of relationships by type.
   */
  relationshipsByType?: {
    contains?: number;
    defines?: number;
    imports?: number;
  };
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error type categories for graph ingestion.
 */
export type GraphIngestionErrorType =
  | "file_error" // Error processing a single file
  | "extraction_error" // Error extracting entities/relationships
  | "node_error" // Error creating a node
  | "relationship_error" // Error creating a relationship
  | "transaction_error" // Transaction rollback error
  | "fatal_error"; // Fatal error that stopped ingestion

/**
 * Error information from graph ingestion operation.
 *
 * @example
 * ```typescript
 * const error: GraphIngestionError = {
 *   type: "file_error",
 *   filePath: "src/broken-file.ts",
 *   message: "Failed to parse TypeScript syntax",
 *   originalError: syntaxError,
 * };
 * ```
 */
export interface GraphIngestionError {
  /**
   * Type of error.
   */
  type: GraphIngestionErrorType;

  /**
   * File path where error occurred (if applicable).
   */
  filePath?: string;

  /**
   * Node ID that caused the error (if applicable).
   */
  nodeId?: string;

  /**
   * Relationship type that caused the error (if applicable).
   */
  relationshipType?: string;

  /**
   * Error message.
   */
  message: string;

  /**
   * Original error object (for debugging).
   */
  originalError?: unknown;
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Result of processing a single file.
 */
export interface FileIngestionResult {
  /**
   * File path that was processed.
   */
  filePath: string;

  /**
   * Whether the file was successfully processed.
   */
  success: boolean;

  /**
   * Number of nodes created for this file.
   */
  nodesCreated: number;

  /**
   * Number of relationships created for this file.
   */
  relationshipsCreated: number;

  /**
   * Errors encountered while processing this file.
   */
  errors: GraphIngestionError[];
}

/**
 * Current operational status of the GraphIngestionService.
 */
export interface GraphIngestionServiceStatus {
  /**
   * Whether an ingestion operation is currently in progress.
   */
  isIngesting: boolean;

  /**
   * Current operation details (null if not ingesting).
   */
  currentOperation: {
    /**
     * Repository being ingested.
     */
    repository: string;

    /**
     * Current phase of ingestion.
     */
    phase: GraphIngestionPhase;

    /**
     * When ingestion started.
     */
    startedAt: Date;

    /**
     * Latest progress update.
     */
    progress: GraphIngestionProgress;
  } | null;
}

/**
 * Internal batch result for node/relationship creation.
 */
export interface BatchCreationResult {
  /**
   * Number of items successfully created in this batch.
   */
  created: number;

  /**
   * Number of items that failed in this batch.
   */
  failed: number;

  /**
   * Errors encountered in this batch.
   */
  errors: GraphIngestionError[];
}
