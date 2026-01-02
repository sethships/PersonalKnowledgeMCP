/**
 * Test fixtures for Neo4j client tests
 *
 * Provides reusable test data for nodes, relationships, and configurations.
 */

import type {
  Neo4jConfig,
  RepositoryNode,
  FileNode,
  FunctionNode,
  ClassNode,
  ModuleNode,
  ChunkNode,
  ConceptNode,
  RelationshipType,
} from "../../src/graph/types.js";
import { createMockNode, createMockRelationship, type MockNode } from "../helpers/neo4j-mock.js";

/**
 * Default test configuration for Neo4j client
 */
export const testConfig: Neo4jConfig = {
  host: "localhost",
  port: 7687,
  username: "neo4j",
  password: "testpassword",
  maxConnectionPoolSize: 10,
  connectionAcquisitionTimeout: 5000,
  retry: {
    maxRetries: 2,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
  },
};

/**
 * Create a test Repository node
 */
export function createTestRepositoryNode(
  overrides: Partial<RepositoryNode> = {}
): Omit<RepositoryNode, "id"> & { id?: string } {
  return {
    labels: ["Repository"],
    name: "test-repo",
    url: "https://github.com/test/test-repo",
    lastIndexed: new Date().toISOString(),
    status: "ready",
    ...overrides,
  };
}

/**
 * Create a test File node
 */
export function createTestFileNode(
  overrides: Partial<FileNode> = {}
): Omit<FileNode, "id"> & { id?: string } {
  return {
    labels: ["File"],
    path: "src/index.ts",
    extension: "ts",
    hash: "abc123def456",
    repository: "test-repo",
    ...overrides,
  };
}

/**
 * Create a test Function node
 */
export function createTestFunctionNode(
  overrides: Partial<FunctionNode> = {}
): Omit<FunctionNode, "id"> & { id?: string } {
  return {
    labels: ["Function"],
    name: "testFunction",
    signature: "async testFunction(): Promise<void>",
    startLine: 10,
    endLine: 20,
    filePath: "src/index.ts",
    repository: "test-repo",
    ...overrides,
  };
}

/**
 * Create a test Class node
 */
export function createTestClassNode(
  overrides: Partial<ClassNode> = {}
): Omit<ClassNode, "id"> & { id?: string } {
  return {
    labels: ["Class"],
    name: "TestClass",
    type: "class",
    filePath: "src/TestClass.ts",
    startLine: 1,
    endLine: 50,
    repository: "test-repo",
    ...overrides,
  };
}

/**
 * Create a test Module node
 */
export function createTestModuleNode(
  overrides: Partial<ModuleNode> = {}
): Omit<ModuleNode, "id"> & { id?: string } {
  return {
    labels: ["Module"],
    name: "lodash",
    type: "npm",
    version: "4.17.21",
    ...overrides,
  };
}

/**
 * Create a test Chunk node
 */
export function createTestChunkNode(
  overrides: Partial<ChunkNode> = {}
): Omit<ChunkNode, "id"> & { id?: string } {
  return {
    labels: ["Chunk"],
    chromaId: "test-repo:src/index.ts:0",
    chunkIndex: 0,
    filePath: "src/index.ts",
    repository: "test-repo",
    ...overrides,
  };
}

/**
 * Create a test Concept node
 */
export function createTestConceptNode(
  overrides: Partial<ConceptNode> = {}
): Omit<ConceptNode, "id"> & { id?: string } {
  return {
    labels: ["Concept"],
    name: "authentication",
    description: "User authentication and authorization",
    confidence: 0.9,
    ...overrides,
  };
}

/**
 * Sample mock nodes for testing
 */
export const sampleMockNodes = {
  repository: createMockNode(1, ["Repository"], {
    id: "Repository:test-repo",
    name: "test-repo",
    url: "https://github.com/test/test-repo",
    lastIndexed: "2025-01-01T00:00:00Z",
    status: "ready",
  }),

  file: createMockNode(2, ["File"], {
    id: "File:test-repo:src/index.ts",
    path: "src/index.ts",
    extension: "ts",
    hash: "abc123",
    repository: "test-repo",
  }),

  function: createMockNode(3, ["Function"], {
    id: "Function:test-repo:src/index.ts:main",
    name: "main",
    signature: "async main(): Promise<void>",
    startLine: 10,
    endLine: 20,
    filePath: "src/index.ts",
    repository: "test-repo",
  }),

  class: createMockNode(4, ["Class"], {
    id: "Class:test-repo:src/TestClass.ts:TestClass",
    name: "TestClass",
    type: "class",
    filePath: "src/TestClass.ts",
    startLine: 1,
    endLine: 50,
    repository: "test-repo",
  }),

  module: createMockNode(5, ["Module"], {
    id: "Module:lodash",
    name: "lodash",
    type: "npm",
    version: "4.17.21",
  }),

  chunk: createMockNode(6, ["Chunk"], {
    id: "Chunk:test-repo:src/index.ts:0",
    chromaId: "test-repo:src/index.ts:0",
    chunkIndex: 0,
    filePath: "src/index.ts",
    repository: "test-repo",
  }),

  concept: createMockNode(7, ["Concept"], {
    id: "Concept:authentication",
    name: "authentication",
    description: "User authentication",
    confidence: 0.9,
  }),
};

/**
 * Sample mock relationships for testing
 */
export const sampleMockRelationships = {
  contains: createMockRelationship(100, "CONTAINS", 1, 2, {}),
  defines: createMockRelationship(101, "DEFINES", 2, 3, { startLine: 10, endLine: 20 }),
  imports: createMockRelationship(102, "IMPORTS", 2, 5, {
    importType: "named",
    importedSymbols: ["map"],
  }),
  calls: createMockRelationship(103, "CALLS", 3, 3, { callCount: 5, isAsync: true }),
  implements: createMockRelationship(104, "IMPLEMENTS", 4, 4, {}),
  hasChunk: createMockRelationship(105, "HAS_CHUNK", 2, 6, { chunkIndex: 0 }),
  taggedWith: createMockRelationship(106, "TAGGED_WITH", 3, 7, { confidence: 0.8 }),
};

/**
 * Create a batch of test file nodes
 */
export function createTestFileBatch(
  count: number,
  repository: string = "test-repo"
): Array<Omit<FileNode, "id"> & { id?: string }> {
  return Array.from({ length: count }, (_, i) =>
    createTestFileNode({
      path: `src/file${i}.ts`,
      hash: `hash${i}`,
      repository,
    })
  );
}

/**
 * Create a batch of mock nodes for testing
 */
export function createMockNodeBatch(count: number, label: string = "File"): MockNode[] {
  return Array.from({ length: count }, (_, i) =>
    createMockNode(i + 100, [label], {
      id: `${label}:test-repo:src/file${i}.ts`,
      path: `src/file${i}.ts`,
      name: `file${i}`,
      repository: "test-repo",
    })
  );
}

/**
 * Sample relationship types for testing traversals
 */
export const testRelationshipTypes: RelationshipType[] = [
  "CONTAINS" as RelationshipType,
  "DEFINES" as RelationshipType,
  "IMPORTS" as RelationshipType,
  "CALLS" as RelationshipType,
];

/**
 * Error messages for testing error scenarios
 */
export const testErrorMessages = {
  connectionRefused: "ECONNREFUSED: Connection refused to localhost:7687",
  authenticationFailed:
    "Neo.ClientError.Security.Unauthorized: The client is unauthorized due to authentication failure",
  queryTimeout: "Query execution timed out after 30000 milliseconds",
  constraintViolation:
    "Neo.ClientError.Schema.ConstraintValidationFailed: Node already exists with label",
  syntaxError: "Neo.ClientError.Statement.SyntaxError: Invalid Cypher syntax",
  deadlock:
    "Neo.TransientError.Transaction.DeadlockDetected: ForsetiClient[0] can't acquire ExclusiveLock",
};
