/**
 * Type definitions for the IngestionService
 *
 * Defines interfaces and types for repository indexing operations,
 * including options, progress tracking, results, and status.
 *
 * @module services/ingestion-types
 */

/**
 * Options for indexing a repository
 */
export interface IndexOptions {
  /**
   * Branch to clone (defaults to repository's default branch)
   */
  branch?: string;

  /**
   * File extensions to include (e.g., ['.ts', '.js', '.md'])
   * If not provided, uses FileScanner defaults
   */
  includeExtensions?: string[];

  /**
   * Glob patterns to exclude (e.g., ['node_modules/**', 'dist/**'])
   * These are added to the FileScanner's default exclusions
   */
  excludePatterns?: string[];

  /**
   * Progress callback invoked at each pipeline phase
   * Receives progress updates throughout the indexing process
   */
  onProgress?: (progress: IndexProgress) => void;

  /**
   * Whether to force reindexing even if repository exists
   * When true, deletes existing collection and reindexes from scratch
   * @default false
   */
  force?: boolean;
}

/**
 * Phases of the indexing pipeline
 */
export type IndexPhase =
  | "cloning" // Cloning repository to local disk
  | "scanning" // Scanning files with extension filtering
  | "chunking" // Chunking files for embedding
  | "embedding" // Generating embeddings
  | "storing" // Storing documents in ChromaDB
  | "updating_metadata"; // Updating repository metadata

/**
 * Progress information for an ongoing indexing operation
 */
export interface IndexProgress {
  /**
   * Current phase of the indexing process
   */
  phase: IndexPhase;

  /**
   * Repository being indexed
   */
  repository: string;

  /**
   * Overall progress percentage (0-100)
   */
  percentage: number;

  /**
   * Phase-specific details
   */
  details: {
    /**
     * Number of files scanned (during scanning phase)
     */
    filesScanned?: number;

    /**
     * Number of files successfully processed (during chunking/embedding)
     */
    filesProcessed?: number;

    /**
     * Total number of files to process
     */
    totalFiles?: number;

    /**
     * Number of chunks created (during chunking phase)
     */
    chunksCreated?: number;

    /**
     * Number of embeddings generated (during embedding phase)
     */
    embeddingsGenerated?: number;

    /**
     * Number of documents stored in ChromaDB (during storing phase)
     */
    documentsStored?: number;

    /**
     * Current batch number being processed (1-based)
     */
    currentBatch?: number;

    /**
     * Total number of batches to process
     */
    totalBatches?: number;
  };

  /**
   * Timestamp of this progress update
   */
  timestamp: Date;
}

/**
 * Final status of an indexing operation
 */
export type IndexStatus =
  | "success" // Fully indexed without errors
  | "partial" // Indexed with some file/batch errors
  | "failed"; // Fatal error, indexing incomplete

/**
 * Result of an indexing operation
 */
export interface IndexResult {
  /**
   * Final status of the indexing operation
   */
  status: IndexStatus;

  /**
   * Repository name
   */
  repository: string;

  /**
   * Collection name in ChromaDB
   */
  collectionName: string;

  /**
   * Statistics from the indexing process
   */
  stats: {
    /**
     * Number of files scanned
     */
    filesScanned: number;

    /**
     * Number of files successfully processed
     */
    filesProcessed: number;

    /**
     * Number of files that failed to process
     */
    filesFailed: number;

    /**
     * Total number of chunks created
     */
    chunksCreated: number;

    /**
     * Total number of embeddings generated
     */
    embeddingsGenerated: number;

    /**
     * Total number of documents stored in ChromaDB
     */
    documentsStored: number;

    /**
     * Total duration of indexing operation in milliseconds
     */
    durationMs: number;
  };

  /**
   * Errors encountered during indexing
   * Empty array means no errors
   */
  errors: IndexError[];

  /**
   * Timestamp when indexing completed
   */
  completedAt: Date;
}

/**
 * Error information from indexing operation
 */
export interface IndexError {
  /**
   * Type of error
   * - file_error: Error processing a single file
   * - batch_error: Error processing a batch of files
   * - fatal_error: Fatal error that stopped indexing
   */
  type: "file_error" | "batch_error" | "fatal_error";

  /**
   * File path where error occurred (if applicable)
   */
  filePath?: string;

  /**
   * Batch number where error occurred (if applicable)
   */
  batchNumber?: number;

  /**
   * Error message
   */
  message: string;

  /**
   * Original error object (for debugging)
   */
  originalError?: unknown;
}

/**
 * Current status of the ingestion service
 */
export interface IngestionStatus {
  /**
   * Whether an indexing operation is currently in progress
   */
  isIndexing: boolean;

  /**
   * Current operation details (null if not indexing)
   */
  currentOperation: {
    /**
     * Repository being indexed
     */
    repository: string;

    /**
     * Current phase of indexing
     */
    phase: IndexPhase;

    /**
     * When indexing started
     */
    startedAt: Date;

    /**
     * Latest progress update
     */
    progress: IndexProgress;
  } | null;
}

/**
 * Internal type for batch processing results
 */
export interface BatchResult {
  /**
   * Number of files successfully processed in this batch
   */
  filesProcessed: number;

  /**
   * Number of files that failed in this batch
   */
  filesFailed: number;

  /**
   * Number of chunks created in this batch
   */
  chunksCreated: number;

  /**
   * Number of embeddings generated in this batch
   */
  embeddingsGenerated: number;

  /**
   * Number of documents stored in this batch
   */
  documentsStored: number;

  /**
   * Errors encountered in this batch
   */
  errors: IndexError[];
}
