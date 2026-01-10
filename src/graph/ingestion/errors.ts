/**
 * Custom error classes for GraphIngestionService.
 *
 * Provides typed error classes for different failure scenarios
 * during graph ingestion operations.
 *
 * @module graph/ingestion/errors
 */

import type { GraphIngestionErrorType } from "./types.js";

/**
 * Base error class for graph ingestion errors.
 *
 * All graph ingestion errors extend this class to provide
 * consistent error handling and categorization.
 */
export class GraphIngestionError extends Error {
  /**
   * Error type category.
   */
  readonly errorType: GraphIngestionErrorType;

  /**
   * Whether this error is retryable.
   */
  readonly retryable: boolean;

  /**
   * Original error that caused this error.
   */
  override readonly cause?: Error;

  constructor(
    message: string,
    errorType: GraphIngestionErrorType,
    options?: {
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = "GraphIngestionError";
    this.errorType = errorType;
    this.retryable = options?.retryable ?? false;
    this.cause = options?.cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GraphIngestionError);
    }
  }
}

/**
 * Error thrown when file processing fails.
 *
 * @example
 * ```typescript
 * throw new FileProcessingError(
 *   "Failed to parse TypeScript syntax",
 *   "src/broken-file.ts",
 *   { cause: parseError }
 * );
 * ```
 */
export class FileProcessingError extends GraphIngestionError {
  /**
   * Path to the file that failed processing.
   */
  readonly filePath: string;

  constructor(
    message: string,
    filePath: string,
    options?: {
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, "file_error", options);
    this.name = "FileProcessingError";
    this.filePath = filePath;
  }
}

/**
 * Error thrown when entity/relationship extraction fails during ingestion.
 *
 * @example
 * ```typescript
 * throw new IngestionExtractionError(
 *   "TreeSitter parser timeout",
 *   "src/large-file.ts",
 *   { retryable: true }
 * );
 * ```
 */
export class IngestionExtractionError extends GraphIngestionError {
  /**
   * Path to the file where extraction failed.
   */
  readonly filePath?: string;

  constructor(
    message: string,
    filePath?: string,
    options?: {
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, "extraction_error", options);
    this.name = "IngestionExtractionError";
    this.filePath = filePath;
  }
}

/**
 * Error thrown when node creation fails.
 *
 * @example
 * ```typescript
 * throw new NodeCreationError(
 *   "Failed to create Function node",
 *   "Function:my-repo:src/utils.ts:helper:25",
 *   "Function",
 *   { cause: neo4jError }
 * );
 * ```
 */
export class NodeCreationError extends GraphIngestionError {
  /**
   * ID of the node that failed to create.
   */
  readonly nodeId: string;

  /**
   * Type of node that failed to create.
   */
  readonly nodeType: string;

  constructor(
    message: string,
    nodeId: string,
    nodeType: string,
    options?: {
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, "node_error", options);
    this.name = "NodeCreationError";
    this.nodeId = nodeId;
    this.nodeType = nodeType;
  }
}

/**
 * Error thrown when relationship creation fails.
 *
 * @example
 * ```typescript
 * throw new RelationshipCreationError(
 *   "Target node not found",
 *   "IMPORTS",
 *   "File:my-repo:src/index.ts",
 *   "Module:npm:lodash"
 * );
 * ```
 */
export class RelationshipCreationError extends GraphIngestionError {
  /**
   * Type of relationship that failed to create.
   */
  readonly relationshipType: string;

  /**
   * ID of the source node.
   */
  readonly fromNodeId: string;

  /**
   * ID of the target node.
   */
  readonly toNodeId: string;

  constructor(
    message: string,
    relationshipType: string,
    fromNodeId: string,
    toNodeId: string,
    options?: {
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, "relationship_error", options);
    this.name = "RelationshipCreationError";
    this.relationshipType = relationshipType;
    this.fromNodeId = fromNodeId;
    this.toNodeId = toNodeId;
  }
}

/**
 * Error thrown when a database transaction fails.
 *
 * @example
 * ```typescript
 * throw new TransactionError(
 *   "Transaction timed out after 30s",
 *   { retryable: true, cause: timeoutError }
 * );
 * ```
 */
export class TransactionError extends GraphIngestionError {
  constructor(
    message: string,
    options?: {
      retryable?: boolean;
      cause?: Error;
    }
  ) {
    super(message, "transaction_error", options);
    this.name = "TransactionError";
  }
}

/**
 * Error thrown when another ingestion operation is already in progress.
 *
 * @example
 * ```typescript
 * throw new IngestionInProgressError("my-repo");
 * ```
 */
export class IngestionInProgressError extends GraphIngestionError {
  /**
   * Repository currently being ingested.
   */
  readonly currentRepository: string;

  constructor(currentRepository: string) {
    super(`Ingestion already in progress for repository: ${currentRepository}`, "fatal_error", {
      retryable: false,
    });
    this.name = "IngestionInProgressError";
    this.currentRepository = currentRepository;
  }
}

/**
 * Error thrown when repository data already exists and force is not set.
 *
 * @example
 * ```typescript
 * throw new RepositoryExistsError("my-repo");
 * ```
 */
export class RepositoryExistsError extends GraphIngestionError {
  /**
   * Repository name that already exists.
   */
  readonly repositoryName: string;

  constructor(repositoryName: string) {
    super(
      `Repository "${repositoryName}" already exists in graph. Use force: true to re-ingest.`,
      "fatal_error",
      { retryable: false }
    );
    this.name = "RepositoryExistsError";
    this.repositoryName = repositoryName;
  }
}

/**
 * Check if an error is a retryable graph ingestion error.
 *
 * @param error - Error to check
 * @returns true if the error is retryable
 */
export function isRetryableIngestionError(error: unknown): boolean {
  if (error instanceof GraphIngestionError) {
    return error.retryable;
  }
  return false;
}

/**
 * Convert an unknown error to a GraphIngestionError.
 *
 * @param error - Error to convert
 * @param context - Optional context information
 * @returns GraphIngestionError instance
 */
export function toGraphIngestionError(
  error: unknown,
  context?: {
    filePath?: string;
    nodeId?: string;
    relationshipType?: string;
  }
): GraphIngestionError {
  if (error instanceof GraphIngestionError) {
    return error;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  // Determine error type based on context
  if (context?.nodeId) {
    return new NodeCreationError(errorMessage, context.nodeId, "unknown", { cause });
  }

  if (context?.relationshipType) {
    return new RelationshipCreationError(
      errorMessage,
      context.relationshipType,
      "unknown",
      "unknown",
      { cause }
    );
  }

  if (context?.filePath) {
    return new FileProcessingError(errorMessage, context.filePath, { cause });
  }

  return new GraphIngestionError(errorMessage, "fatal_error", { cause });
}
