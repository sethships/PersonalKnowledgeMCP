/**
 * Unit tests for graph error classes and helper functions.
 *
 * Tests all error classes from src/graph/errors.ts and their properties,
 * as well as helper functions for error handling.
 */

import { describe, test, expect } from "bun:test";
import {
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
  isRetryableGraphError,
  mapNeo4jError,
} from "../../../src/graph/errors.js";

describe("GraphError", () => {
  test("should create error with default values", () => {
    const error = new GraphError("Test error");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("GraphError");
    expect(error.message).toBe("Test error");
    expect(error.code).toBe("GRAPH_ERROR");
    expect(error.cause).toBeUndefined();
    expect(error.retryable).toBe(false);
  });

  test("should create error with custom code", () => {
    const error = new GraphError("Test error", "CUSTOM_CODE");

    expect(error.code).toBe("CUSTOM_CODE");
  });

  test("should create error with cause", () => {
    const cause = new Error("Original error");
    const error = new GraphError("Wrapped error", "GRAPH_ERROR", cause);

    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by:");
    expect(error.stack).toContain("Original error");
  });

  test("should create retryable error", () => {
    const error = new GraphError("Transient error", "GRAPH_ERROR", undefined, true);

    expect(error.retryable).toBe(true);
  });

  test("should create non-retryable error by default", () => {
    const error = new GraphError("Permanent error");

    expect(error.retryable).toBe(false);
  });
});

describe("GraphConnectionError", () => {
  test("should create connection error with default retryable true", () => {
    const error = new GraphConnectionError("Connection failed");

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("GraphConnectionError");
    expect(error.code).toBe("CONNECTION_ERROR");
    expect(error.retryable).toBe(true);
  });

  test("should create connection error with cause", () => {
    const cause = new Error("ECONNREFUSED");
    const error = new GraphConnectionError("Connection failed", cause);

    expect(error.cause).toBe(cause);
  });

  test("should allow overriding retryable", () => {
    const error = new GraphConnectionError("Permanent connection failure", undefined, false);

    expect(error.retryable).toBe(false);
  });
});

describe("GraphAuthenticationError", () => {
  test("should create authentication error", () => {
    const error = new GraphAuthenticationError("Invalid credentials");

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("GraphAuthenticationError");
    expect(error.code).toBe("AUTHENTICATION_ERROR");
    expect(error.retryable).toBe(false);
  });

  test("should create authentication error with cause", () => {
    const cause = new Error("Unauthorized");
    const error = new GraphAuthenticationError("Auth failed", cause);

    expect(error.cause).toBe(cause);
  });
});

describe("GraphQueryError", () => {
  test("should create query error with default values", () => {
    const error = new GraphQueryError("Query failed");

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("GraphQueryError");
    expect(error.code).toBe("QUERY_ERROR");
    expect(error.query).toBeUndefined();
    expect(error.retryable).toBe(false);
  });

  test("should create query error with query string", () => {
    const query = "MATCH (n) RETURN n";
    const error = new GraphQueryError("Query failed", query);

    expect(error.query).toBe(query);
  });

  test("should create retryable query error for deadlocks", () => {
    const cause = new Error("Deadlock detected");
    const error = new GraphQueryError("Deadlock", "MATCH (n) RETURN n", cause, true);

    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });
});

describe("GraphQueryTimeoutError", () => {
  test("should create timeout error", () => {
    const error = new GraphQueryTimeoutError("Query timed out", 30000);

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("GraphQueryTimeoutError");
    expect(error.code).toBe("QUERY_TIMEOUT");
    expect(error.timeoutMs).toBe(30000);
    expect(error.retryable).toBe(true);
  });

  test("should create timeout error with cause", () => {
    const cause = new Error("Timeout exceeded");
    const error = new GraphQueryTimeoutError("Query timed out", 5000, cause);

    expect(error.timeoutMs).toBe(5000);
    expect(error.cause).toBe(cause);
  });
});

describe("NodeNotFoundError", () => {
  test("should create node not found error with nodeId only", () => {
    const error = new NodeNotFoundError("node-123");

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("NodeNotFoundError");
    expect(error.code).toBe("NODE_NOT_FOUND");
    expect(error.nodeId).toBe("node-123");
    expect(error.nodeType).toBeUndefined();
    expect(error.message).toBe("Node with ID 'node-123' not found");
    expect(error.retryable).toBe(false);
  });

  test("should create node not found error with nodeType", () => {
    const error = new NodeNotFoundError("node-123", "Function");

    expect(error.nodeType).toBe("Function");
    expect(error.message).toBe("Node with ID 'node-123' of type 'Function' not found");
  });

  test("should create node not found error with custom message", () => {
    const error = new NodeNotFoundError("node-123", "File", "Custom not found message");

    expect(error.message).toBe("Custom not found message");
  });
});

describe("NodeConstraintError", () => {
  test("should create constraint error with default values", () => {
    const error = new NodeConstraintError("Constraint violated");

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("NodeConstraintError");
    expect(error.code).toBe("NODE_CONSTRAINT_ERROR");
    expect(error.constraintName).toBeUndefined();
    expect(error.propertyName).toBeUndefined();
    expect(error.retryable).toBe(false);
  });

  test("should create constraint error with details", () => {
    const cause = new Error("Duplicate key");
    const error = new NodeConstraintError("Duplicate ID", "unique_file_id", "id", cause);

    expect(error.constraintName).toBe("unique_file_id");
    expect(error.propertyName).toBe("id");
    expect(error.cause).toBe(cause);
  });
});

describe("RelationshipError", () => {
  test("should create relationship error with default values", () => {
    const error = new RelationshipError("Relationship failed");

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("RelationshipError");
    expect(error.code).toBe("RELATIONSHIP_ERROR");
    expect(error.relationshipType).toBeUndefined();
    expect(error.fromNodeId).toBeUndefined();
    expect(error.toNodeId).toBeUndefined();
    expect(error.retryable).toBe(false);
  });

  test("should create relationship error with all details", () => {
    const cause = new Error("Node not found");
    const error = new RelationshipError(
      "Failed to create relationship",
      "IMPORTS",
      "file-1",
      "module-1",
      cause
    );

    expect(error.relationshipType).toBe("IMPORTS");
    expect(error.fromNodeId).toBe("file-1");
    expect(error.toNodeId).toBe("module-1");
    expect(error.cause).toBe(cause);
  });
});

describe("RelationshipNotFoundError", () => {
  test("should create relationship not found error with default message", () => {
    const error = new RelationshipNotFoundError("rel-123");

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("RelationshipNotFoundError");
    expect(error.code).toBe("RELATIONSHIP_NOT_FOUND");
    expect(error.relationshipId).toBe("rel-123");
    expect(error.message).toBe("Relationship with ID 'rel-123' not found");
    expect(error.retryable).toBe(false);
  });

  test("should create relationship not found error with custom message", () => {
    const error = new RelationshipNotFoundError("rel-456", "Custom message");

    expect(error.message).toBe("Custom message");
    expect(error.relationshipId).toBe("rel-456");
  });
});

describe("GraphSchemaError", () => {
  test("should create schema error with default values", () => {
    const error = new GraphSchemaError("Schema operation failed");

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("GraphSchemaError");
    expect(error.code).toBe("SCHEMA_ERROR");
    expect(error.schemaElement).toBeUndefined();
    expect(error.retryable).toBe(false);
  });

  test("should create schema error with schema element", () => {
    const cause = new Error("Constraint already exists");
    const error = new GraphSchemaError("Failed to create constraint", "unique_file_path", cause);

    expect(error.schemaElement).toBe("unique_file_path");
    expect(error.cause).toBe(cause);
  });
});

describe("TraversalLimitError", () => {
  test("should create depth limit error", () => {
    const error = new TraversalLimitError("depth", 5, 10);

    expect(error).toBeInstanceOf(GraphError);
    expect(error.name).toBe("TraversalLimitError");
    expect(error.code).toBe("TRAVERSAL_LIMIT_ERROR");
    expect(error.limitType).toBe("depth");
    expect(error.limit).toBe(5);
    expect(error.actualCount).toBe(10);
    expect(error.message).toBe("Traversal exceeded depth limit: 10 > 5");
    expect(error.retryable).toBe(false);
  });

  test("should create nodes limit error", () => {
    const error = new TraversalLimitError("nodes", 100, 150);

    expect(error.limitType).toBe("nodes");
    expect(error.message).toBe("Traversal exceeded nodes limit: 150 > 100");
  });

  test("should create relationships limit error", () => {
    const error = new TraversalLimitError("relationships", 500, 750);

    expect(error.limitType).toBe("relationships");
    expect(error.message).toBe("Traversal exceeded relationships limit: 750 > 500");
  });
});

describe("isRetryableGraphError", () => {
  test("should return true for retryable GraphError", () => {
    const error = new GraphError("Transient", "CODE", undefined, true);

    expect(isRetryableGraphError(error)).toBe(true);
  });

  test("should return false for non-retryable GraphError", () => {
    const error = new GraphError("Permanent");

    expect(isRetryableGraphError(error)).toBe(false);
  });

  test("should return true for GraphConnectionError", () => {
    const error = new GraphConnectionError("Connection failed");

    expect(isRetryableGraphError(error)).toBe(true);
  });

  test("should return false for GraphAuthenticationError", () => {
    const error = new GraphAuthenticationError("Invalid credentials");

    expect(isRetryableGraphError(error)).toBe(false);
  });

  test("should return true for GraphQueryTimeoutError", () => {
    const error = new GraphQueryTimeoutError("Timed out", 30000);

    expect(isRetryableGraphError(error)).toBe(true);
  });

  test("should return true for native error with retryable patterns", () => {
    const patterns = [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "socket hang up",
      "network error",
      "connection refused",
      "deadlock",
      "database unavailable",
      "temporarily unavailable",
      "service unavailable",
      "too many requests",
    ];

    for (const pattern of patterns) {
      const error = new Error(`Error: ${pattern} occurred`);
      expect(isRetryableGraphError(error)).toBe(true);
    }
  });

  test("should return false for non-retryable native error", () => {
    const error = new Error("Syntax error in query");

    expect(isRetryableGraphError(error)).toBe(false);
  });

  test("should return false for non-error values", () => {
    expect(isRetryableGraphError(null)).toBe(false);
    expect(isRetryableGraphError(undefined)).toBe(false);
    expect(isRetryableGraphError("error string")).toBe(false);
    expect(isRetryableGraphError(123)).toBe(false);
  });
});

describe("mapNeo4jError", () => {
  test("should map authentication errors", () => {
    const patterns = ["authentication failed", "Unauthorized access", "invalid credentials"];

    for (const pattern of patterns) {
      const error = new Error(pattern);
      const mapped = mapNeo4jError(error);

      expect(mapped).toBeInstanceOf(GraphAuthenticationError);
      expect(mapped.cause).toBe(error);
    }
  });

  test("should map connection errors", () => {
    const patterns = [
      "connection refused",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "socket error",
    ];

    for (const pattern of patterns) {
      const error = new Error(pattern);
      const mapped = mapNeo4jError(error);

      expect(mapped).toBeInstanceOf(GraphConnectionError);
      expect(mapped.cause).toBe(error);
    }
  });

  test("should map timeout errors", () => {
    const error = new Error("Query timeout after 30000 ms");
    const mapped = mapNeo4jError(error);

    expect(mapped).toBeInstanceOf(GraphQueryTimeoutError);
    expect((mapped as GraphQueryTimeoutError).timeoutMs).toBe(30000);
  });

  test("should map timeout errors with seconds", () => {
    const error = new Error("Operation timed out after 5 seconds");
    const mapped = mapNeo4jError(error);

    expect(mapped).toBeInstanceOf(GraphQueryTimeoutError);
    expect((mapped as GraphQueryTimeoutError).timeoutMs).toBe(5000);
  });

  test("should map timeout errors without explicit time", () => {
    const error = new Error("Query timeout occurred");
    const mapped = mapNeo4jError(error);

    expect(mapped).toBeInstanceOf(GraphQueryTimeoutError);
    expect((mapped as GraphQueryTimeoutError).timeoutMs).toBe(30000); // default
  });

  test("should map constraint errors", () => {
    const patterns = ["constraint violation", "Node already exists"];

    for (const pattern of patterns) {
      const error = new Error(pattern);
      const mapped = mapNeo4jError(error);

      expect(mapped).toBeInstanceOf(NodeConstraintError);
    }
  });

  test("should map schema errors", () => {
    const patterns = ["schema error", "Index creation failed"];

    for (const pattern of patterns) {
      const error = new Error(pattern);
      const mapped = mapNeo4jError(error);

      expect(mapped).toBeInstanceOf(GraphSchemaError);
    }
  });

  test("should map query syntax errors", () => {
    const patterns = ["Cypher syntax error", "Invalid syntax at position"];

    for (const pattern of patterns) {
      const error = new Error(pattern);
      const mapped = mapNeo4jError(error);

      expect(mapped).toBeInstanceOf(GraphQueryError);
      expect(mapped.retryable).toBe(false);
    }
  });

  test("should map deadlock errors as retryable query errors", () => {
    const patterns = ["Deadlock detected", "Transaction terminated"];

    for (const pattern of patterns) {
      const error = new Error(pattern);
      const mapped = mapNeo4jError(error);

      expect(mapped).toBeInstanceOf(GraphQueryError);
      expect(mapped.retryable).toBe(true);
    }
  });

  test("should map unknown errors to base GraphError", () => {
    const error = new Error("Unknown error occurred");
    const mapped = mapNeo4jError(error);

    expect(mapped).toBeInstanceOf(GraphError);
    expect(mapped.code).toBe("UNKNOWN_ERROR");
    expect(mapped.retryable).toBe(false);
    expect(mapped.cause).toBe(error);
  });
});
