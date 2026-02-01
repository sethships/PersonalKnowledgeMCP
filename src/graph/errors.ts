/**
 * @module graph/errors
 *
 * Custom error classes for graph database operations.
 *
 * These error classes provide structured error handling for graph operations,
 * making it easier to diagnose issues and handle different failure scenarios.
 * The error hierarchy follows the pattern established in storage/errors.ts
 * and providers/errors.ts.
 *
 * The errors are database-agnostic and work with any graph storage adapter
 * (Neo4j, FalkorDB, etc.).
 *
 * @see {@link file://./../../docs/architecture/adr/0002-knowledge-graph-architecture.md} ADR-0002
 */

import type { GraphAdapterType } from "./adapters/types.js";

// =============================================================================
// Base Error Class
// =============================================================================

/**
 * Base error class for all graph-related errors
 *
 * Extends the native Error class with additional context and error codes
 * for integration with the MCP error handling system.
 *
 * @example
 * ```typescript
 * throw new GraphError("Failed to execute query", "QUERY_FAILED", cause, true);
 * ```
 */
export class GraphError extends Error {
  /**
   * Error code for categorization and handling
   */
  public readonly code: string;

  /**
   * Original error that caused this error (if any)
   *
   * NOTE: Uses 'override' to explicitly shadow ES2022 Error.cause property.
   * This provides type safety by restricting cause to Error instances only.
   */
  public override readonly cause?: Error;

  /**
   * Whether this error is transient and the operation should be retried
   */
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: string = "GRAPH_ERROR",
    cause?: Error,
    retryable: boolean = false
  ) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    this.cause = cause;
    this.retryable = retryable;

    // Maintain proper stack trace for where our error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Include cause stack trace if available
    if (cause && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

// =============================================================================
// Connection Errors
// =============================================================================

/**
 * Error thrown when connection to Neo4j fails
 *
 * This error indicates that the Neo4j server is unreachable,
 * not responding, or refusing connections.
 *
 * This error is RETRYABLE by default, as connection issues are often transient.
 *
 * @example
 * ```typescript
 * try {
 *   await client.connect();
 * } catch (error) {
 *   throw new GraphConnectionError("Failed to connect to Neo4j", error);
 * }
 * ```
 */
export class GraphConnectionError extends GraphError {
  constructor(message: string, cause?: Error, retryable: boolean = true) {
    super(message, "CONNECTION_ERROR", cause, retryable);
    this.name = "GraphConnectionError";
  }
}

/**
 * Error thrown when authentication with Neo4j fails
 *
 * This indicates invalid credentials or insufficient permissions.
 * This is NOT retryable as the credentials need to be corrected.
 */
export class GraphAuthenticationError extends GraphError {
  constructor(message: string, cause?: Error) {
    super(message, "AUTHENTICATION_ERROR", cause, false);
    this.name = "GraphAuthenticationError";
  }
}

// =============================================================================
// Query Errors
// =============================================================================

/**
 * Error thrown when a Cypher query execution fails
 *
 * This may be due to syntax errors, constraint violations,
 * or runtime errors during query execution.
 *
 * By default NOT retryable, but transient errors (e.g., deadlocks)
 * may be marked as retryable.
 */
export class GraphQueryError extends GraphError {
  /**
   * The Cypher query that failed (sanitized of sensitive data)
   */
  public readonly query?: string;

  constructor(message: string, query?: string, cause?: Error, retryable: boolean = false) {
    super(message, "QUERY_ERROR", cause, retryable);
    this.name = "GraphQueryError";
    this.query = query;
  }
}

/**
 * Error thrown when a Cypher query times out
 *
 * This is RETRYABLE by default, as timeouts are often transient.
 */
export class GraphQueryTimeoutError extends GraphError {
  /**
   * Timeout duration in milliseconds
   */
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, cause?: Error) {
    super(message, "QUERY_TIMEOUT", cause, true);
    this.name = "GraphQueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// =============================================================================
// Node Errors
// =============================================================================

/**
 * Error thrown when a requested node is not found
 *
 * This error is NOT retryable as the node doesn't exist.
 */
export class NodeNotFoundError extends GraphError {
  /**
   * The node identifier that was not found
   */
  public readonly nodeId: string;

  /**
   * The node type/label that was searched
   */
  public readonly nodeType?: string;

  constructor(nodeId: string, nodeType?: string, message?: string) {
    const defaultMessage = nodeType
      ? `Node with ID '${nodeId}' of type '${nodeType}' not found`
      : `Node with ID '${nodeId}' not found`;
    super(message || defaultMessage, "NODE_NOT_FOUND");
    this.name = "NodeNotFoundError";
    this.nodeId = nodeId;
    this.nodeType = nodeType;
  }
}

/**
 * Error thrown when node creation or update fails due to constraint violation
 *
 * This typically occurs when trying to create a node with a duplicate
 * unique property value.
 */
export class NodeConstraintError extends GraphError {
  /**
   * The constraint that was violated
   */
  public readonly constraintName?: string;

  /**
   * The property that caused the violation
   */
  public readonly propertyName?: string;

  constructor(message: string, constraintName?: string, propertyName?: string, cause?: Error) {
    super(message, "NODE_CONSTRAINT_ERROR", cause, false);
    this.name = "NodeConstraintError";
    this.constraintName = constraintName;
    this.propertyName = propertyName;
  }
}

// =============================================================================
// Relationship Errors
// =============================================================================

/**
 * Error thrown when a relationship operation fails
 *
 * This may occur when creating, updating, or deleting relationships.
 */
export class RelationshipError extends GraphError {
  /**
   * The relationship type involved
   */
  public readonly relationshipType?: string;

  /**
   * Source node ID
   */
  public readonly fromNodeId?: string;

  /**
   * Target node ID
   */
  public readonly toNodeId?: string;

  constructor(
    message: string,
    relationshipType?: string,
    fromNodeId?: string,
    toNodeId?: string,
    cause?: Error
  ) {
    super(message, "RELATIONSHIP_ERROR", cause, false);
    this.name = "RelationshipError";
    this.relationshipType = relationshipType;
    this.fromNodeId = fromNodeId;
    this.toNodeId = toNodeId;
  }
}

/**
 * Error thrown when a relationship is not found
 */
export class RelationshipNotFoundError extends GraphError {
  /**
   * The relationship ID that was not found
   */
  public readonly relationshipId: string;

  constructor(relationshipId: string, message?: string) {
    super(
      message || `Relationship with ID '${relationshipId}' not found`,
      "RELATIONSHIP_NOT_FOUND"
    );
    this.name = "RelationshipNotFoundError";
    this.relationshipId = relationshipId;
  }
}

// =============================================================================
// Schema Errors
// =============================================================================

/**
 * Error thrown when a schema operation fails
 *
 * This includes constraint creation, index creation, and schema migrations.
 */
export class GraphSchemaError extends GraphError {
  /**
   * The schema element that caused the error (e.g., constraint name, index name)
   */
  public readonly schemaElement?: string;

  constructor(message: string, schemaElement?: string, cause?: Error) {
    super(message, "SCHEMA_ERROR", cause, false);
    this.name = "GraphSchemaError";
    this.schemaElement = schemaElement;
  }
}

// =============================================================================
// Traversal Errors
// =============================================================================

/**
 * Error thrown when graph traversal exceeds limits
 *
 * This occurs when a traversal would return too many results
 * or exceed the maximum allowed depth.
 */
export class TraversalLimitError extends GraphError {
  /**
   * The limit that was exceeded
   */
  public readonly limit: number;

  /**
   * The actual count that exceeded the limit
   */
  public readonly actualCount: number;

  /**
   * Type of limit exceeded (e.g., 'depth', 'nodes', 'relationships')
   */
  public readonly limitType: "depth" | "nodes" | "relationships";

  constructor(limitType: "depth" | "nodes" | "relationships", limit: number, actualCount: number) {
    super(
      `Traversal exceeded ${limitType} limit: ${actualCount} > ${limit}`,
      "TRAVERSAL_LIMIT_ERROR",
      undefined,
      false
    );
    this.name = "TraversalLimitError";
    this.limitType = limitType;
    this.limit = limit;
    this.actualCount = actualCount;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Determine if an error is retryable based on its type and characteristics
 *
 * Used to decide whether to retry an operation after a failure.
 * This handles both our custom error classes and native errors.
 *
 * @param error - The error to check
 * @returns true if the error is retryable
 *
 * @example
 * ```typescript
 * try {
 *   await client.runQuery(cypher);
 * } catch (error) {
 *   if (isRetryableGraphError(error)) {
 *     await retry(() => client.runQuery(cypher));
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 */
export function isRetryableGraphError(error: unknown): boolean {
  // Check our custom error classes
  if (error instanceof GraphError) {
    return error.retryable;
  }

  // Check native errors for common transient patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const retryablePatterns = [
      // Connection errors
      "econnrefused",
      "econnreset",
      "etimedout",
      "enotfound",
      "socket hang up",
      "network error",
      "connection refused",
      "connection reset",
      // Neo4j transient errors
      "deadlock",
      "transaction terminated",
      "database unavailable",
      "leader changed",
      // General transient patterns
      "temporarily unavailable",
      "service unavailable",
      "too many requests",
    ];
    return retryablePatterns.some((pattern) => message.includes(pattern));
  }

  return false;
}

/**
 * Map FalkorDB/Redis errors to typed GraphError classes
 *
 * FalkorDB uses Redis protocol and has different error patterns than Neo4j.
 *
 * @param error - The original FalkorDB/Redis driver error
 * @returns A typed GraphError subclass
 */
function mapFalkorDbError(error: Error): GraphError {
  const message = error.message.toLowerCase();

  // Authentication errors
  if (
    message.includes("noauth") ||
    message.includes("authentication") ||
    message.includes("wrongpass") ||
    message.includes("invalid password")
  ) {
    return new GraphAuthenticationError(error.message, error);
  }

  // Connection errors
  if (
    message.includes("connection") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket") ||
    message.includes("redis")
  ) {
    return new GraphConnectionError(error.message, error);
  }

  // Timeout errors
  if (message.includes("timeout") || message.includes("timed out")) {
    const timeoutMatch = message.match(/(\d+)\s*(ms|milliseconds|seconds)/i);
    let timeoutMs = 30000;
    if (timeoutMatch && timeoutMatch[1] && timeoutMatch[2]) {
      const value = parseInt(timeoutMatch[1], 10);
      const unit = timeoutMatch[2].toLowerCase();
      timeoutMs = value * (unit.startsWith("s") ? 1000 : 1);
    }
    return new GraphQueryTimeoutError(error.message, timeoutMs, error);
  }

  // Graph/Cypher errors
  if (message.includes("syntax") || message.includes("cypher") || message.includes("graph.query")) {
    return new GraphQueryError(error.message, undefined, error, false);
  }

  // Constraint/uniqueness errors
  if (message.includes("constraint") || message.includes("already exists")) {
    return new NodeConstraintError(error.message, undefined, undefined, error);
  }

  // Default to base GraphError
  return new GraphError(error.message, "UNKNOWN_ERROR", error, false);
}

/**
 * Create a typed error from a graph database driver error
 *
 * This helper maps FalkorDB driver errors to our typed error classes
 * for consistent error handling throughout the application.
 *
 * @param error - The original driver error
 * @param adapterType - The graph adapter type (only 'falkordb' is supported)
 * @returns A typed GraphError subclass
 *
 * @example
 * ```typescript
 * try {
 *   await adapter.runQuery(cypher);
 * } catch (error) {
 *   throw mapGraphError(error instanceof Error ? error : new Error(String(error)), 'falkordb');
 * }
 * ```
 */
export function mapGraphError(
  error: Error,
  adapterType: GraphAdapterType = "falkordb"
): GraphError {
  switch (adapterType) {
    case "falkordb":
      return mapFalkorDbError(error);

    default: {
      // TypeScript exhaustiveness check
      const _exhaustiveCheck: never = adapterType;
      return new GraphError(
        `Unknown adapter type: ${String(_exhaustiveCheck)}`,
        "UNKNOWN_ADAPTER",
        error,
        false
      );
    }
  }
}
