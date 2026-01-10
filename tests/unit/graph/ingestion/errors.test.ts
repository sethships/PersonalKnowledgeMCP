/**
 * Unit tests for graph ingestion error classes and helper functions.
 *
 * Tests all error classes from src/graph/ingestion/errors.ts and their properties,
 * as well as helper functions for error handling.
 */

import { describe, test, expect } from "bun:test";
import {
  GraphIngestionError,
  FileProcessingError,
  IngestionExtractionError,
  NodeCreationError,
  RelationshipCreationError,
  TransactionError,
  IngestionInProgressError,
  RepositoryExistsError,
  isRetryableIngestionError,
  toGraphIngestionError,
} from "../../../../src/graph/ingestion/errors.js";

describe("GraphIngestionError", () => {
  test("should create error with required properties", () => {
    const error = new GraphIngestionError("Test error", "file_error");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(GraphIngestionError);
    expect(error.name).toBe("GraphIngestionError");
    expect(error.message).toBe("Test error");
    expect(error.errorType).toBe("file_error");
    expect(error.retryable).toBe(false);
    expect(error.cause).toBeUndefined();
  });

  test("should create retryable error", () => {
    const error = new GraphIngestionError("Transient error", "transaction_error", {
      retryable: true,
    });

    expect(error.retryable).toBe(true);
  });

  test("should create error with cause", () => {
    const cause = new Error("Original error");
    const error = new GraphIngestionError("Wrapped error", "fatal_error", {
      cause,
    });

    expect(error.cause).toBe(cause);
  });

  test("should create error with all options", () => {
    const cause = new Error("Root cause");
    const error = new GraphIngestionError("Full error", "node_error", {
      retryable: true,
      cause,
    });

    expect(error.errorType).toBe("node_error");
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });
});

describe("FileProcessingError", () => {
  test("should create file processing error", () => {
    const error = new FileProcessingError("Parse failed", "src/broken.ts");

    expect(error).toBeInstanceOf(GraphIngestionError);
    expect(error.name).toBe("FileProcessingError");
    expect(error.errorType).toBe("file_error");
    expect(error.filePath).toBe("src/broken.ts");
    expect(error.retryable).toBe(false);
  });

  test("should create retryable file processing error", () => {
    const cause = new Error("Timeout");
    const error = new FileProcessingError("Read timeout", "src/large.ts", {
      retryable: true,
      cause,
    });

    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });
});

describe("IngestionExtractionError", () => {
  test("should create extraction error without file path", () => {
    const error = new IngestionExtractionError("Extraction failed");

    expect(error).toBeInstanceOf(GraphIngestionError);
    expect(error.name).toBe("IngestionExtractionError");
    expect(error.errorType).toBe("extraction_error");
    expect(error.filePath).toBeUndefined();
  });

  test("should create extraction error with file path", () => {
    const error = new IngestionExtractionError("Parser timeout", "src/complex.ts", {
      retryable: true,
    });

    expect(error.filePath).toBe("src/complex.ts");
    expect(error.retryable).toBe(true);
  });
});

describe("NodeCreationError", () => {
  test("should create node creation error", () => {
    const error = new NodeCreationError(
      "Failed to create node",
      "Function:my-repo:src/utils.ts:helper:25",
      "Function"
    );

    expect(error).toBeInstanceOf(GraphIngestionError);
    expect(error.name).toBe("NodeCreationError");
    expect(error.errorType).toBe("node_error");
    expect(error.nodeId).toBe("Function:my-repo:src/utils.ts:helper:25");
    expect(error.nodeType).toBe("Function");
    expect(error.retryable).toBe(false);
  });

  test("should create node creation error with cause", () => {
    const cause = new Error("Constraint violation");
    const error = new NodeCreationError("Duplicate node", "File:repo:path", "File", {
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe("RelationshipCreationError", () => {
  test("should create relationship creation error", () => {
    const error = new RelationshipCreationError(
      "Target node not found",
      "IMPORTS",
      "File:my-repo:src/index.ts",
      "Module:npm:lodash"
    );

    expect(error).toBeInstanceOf(GraphIngestionError);
    expect(error.name).toBe("RelationshipCreationError");
    expect(error.errorType).toBe("relationship_error");
    expect(error.relationshipType).toBe("IMPORTS");
    expect(error.fromNodeId).toBe("File:my-repo:src/index.ts");
    expect(error.toNodeId).toBe("Module:npm:lodash");
    expect(error.retryable).toBe(false);
  });

  test("should create relationship creation error with options", () => {
    const cause = new Error("Transaction failed");
    const error = new RelationshipCreationError(
      "Relationship failed",
      "DEFINES",
      "file-1",
      "func-1",
      { retryable: true, cause }
    );

    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });
});

describe("TransactionError", () => {
  test("should create transaction error", () => {
    const error = new TransactionError("Transaction timed out");

    expect(error).toBeInstanceOf(GraphIngestionError);
    expect(error.name).toBe("TransactionError");
    expect(error.errorType).toBe("transaction_error");
    expect(error.retryable).toBe(false);
  });

  test("should create retryable transaction error", () => {
    const cause = new Error("Deadlock");
    const error = new TransactionError("Deadlock detected", {
      retryable: true,
      cause,
    });

    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });
});

describe("IngestionInProgressError", () => {
  test("should create ingestion in progress error", () => {
    const error = new IngestionInProgressError("my-repo");

    expect(error).toBeInstanceOf(GraphIngestionError);
    expect(error.name).toBe("IngestionInProgressError");
    expect(error.errorType).toBe("fatal_error");
    expect(error.currentRepository).toBe("my-repo");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("Ingestion already in progress for repository: my-repo");
  });
});

describe("RepositoryExistsError", () => {
  test("should create repository exists error", () => {
    const error = new RepositoryExistsError("my-repo");

    expect(error).toBeInstanceOf(GraphIngestionError);
    expect(error.name).toBe("RepositoryExistsError");
    expect(error.errorType).toBe("fatal_error");
    expect(error.repositoryName).toBe("my-repo");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(
      'Repository "my-repo" already exists in graph. Use force: true to re-ingest.'
    );
  });
});

describe("isRetryableIngestionError", () => {
  test("should return true for retryable GraphIngestionError", () => {
    const error = new GraphIngestionError("Transient", "transaction_error", {
      retryable: true,
    });

    expect(isRetryableIngestionError(error)).toBe(true);
  });

  test("should return false for non-retryable GraphIngestionError", () => {
    const error = new GraphIngestionError("Permanent", "fatal_error");

    expect(isRetryableIngestionError(error)).toBe(false);
  });

  test("should return true for retryable TransactionError", () => {
    const error = new TransactionError("Deadlock", { retryable: true });

    expect(isRetryableIngestionError(error)).toBe(true);
  });

  test("should return false for IngestionInProgressError", () => {
    const error = new IngestionInProgressError("repo");

    expect(isRetryableIngestionError(error)).toBe(false);
  });

  test("should return false for RepositoryExistsError", () => {
    const error = new RepositoryExistsError("repo");

    expect(isRetryableIngestionError(error)).toBe(false);
  });

  test("should return false for non-GraphIngestionError", () => {
    expect(isRetryableIngestionError(new Error("Generic error"))).toBe(false);
    expect(isRetryableIngestionError(null)).toBe(false);
    expect(isRetryableIngestionError(undefined)).toBe(false);
    expect(isRetryableIngestionError("error string")).toBe(false);
  });
});

describe("toGraphIngestionError", () => {
  test("should return existing GraphIngestionError unchanged", () => {
    const original = new FileProcessingError("Parse failed", "file.ts");
    const result = toGraphIngestionError(original);

    expect(result).toBe(original);
  });

  test("should convert Error to GraphIngestionError", () => {
    const original = new Error("Something went wrong");
    const result = toGraphIngestionError(original);

    expect(result).toBeInstanceOf(GraphIngestionError);
    expect(result.message).toBe("Something went wrong");
    expect(result.errorType).toBe("fatal_error");
    expect(result.cause).toBe(original);
  });

  test("should convert string to GraphIngestionError", () => {
    const result = toGraphIngestionError("String error");

    expect(result).toBeInstanceOf(GraphIngestionError);
    expect(result.message).toBe("String error");
    expect(result.cause).toBeUndefined();
  });

  test("should convert with nodeId context to NodeCreationError", () => {
    const original = new Error("Node failed");
    const result = toGraphIngestionError(original, {
      nodeId: "Function:repo:file.ts:foo:10",
    });

    expect(result).toBeInstanceOf(NodeCreationError);
    expect((result as NodeCreationError).nodeId).toBe("Function:repo:file.ts:foo:10");
    expect((result as NodeCreationError).nodeType).toBe("unknown");
  });

  test("should convert with relationshipType context to RelationshipCreationError", () => {
    const original = new Error("Relationship failed");
    const result = toGraphIngestionError(original, {
      relationshipType: "IMPORTS",
    });

    expect(result).toBeInstanceOf(RelationshipCreationError);
    expect((result as RelationshipCreationError).relationshipType).toBe("IMPORTS");
    expect((result as RelationshipCreationError).fromNodeId).toBe("unknown");
    expect((result as RelationshipCreationError).toNodeId).toBe("unknown");
  });

  test("should convert with filePath context to FileProcessingError", () => {
    const original = new Error("File failed");
    const result = toGraphIngestionError(original, {
      filePath: "src/index.ts",
    });

    expect(result).toBeInstanceOf(FileProcessingError);
    expect((result as FileProcessingError).filePath).toBe("src/index.ts");
  });

  test("should prioritize nodeId over other context", () => {
    const original = new Error("Error");
    const result = toGraphIngestionError(original, {
      nodeId: "node-1",
      relationshipType: "DEFINES",
      filePath: "file.ts",
    });

    expect(result).toBeInstanceOf(NodeCreationError);
  });

  test("should prioritize relationshipType over filePath", () => {
    const original = new Error("Error");
    const result = toGraphIngestionError(original, {
      relationshipType: "DEFINES",
      filePath: "file.ts",
    });

    expect(result).toBeInstanceOf(RelationshipCreationError);
  });
});
