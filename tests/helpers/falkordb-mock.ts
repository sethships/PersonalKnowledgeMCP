/**
 * Mock FalkorDB driver for unit testing
 *
 * Provides mock implementations of FalkorDB, Graph, and query result structures
 * that can be used to test FalkorDBAdapter logic without a real FalkorDB instance.
 */

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * GraphReply type based on FalkorDB's actual response structure
 * FalkorDB returns data as array of objects with named properties
 */
export type GraphReply<T> = {
  metadata?: string[];
  data?: Array<T>;
};

/**
 * Mock FalkorDB Node structure
 */
export interface MockFalkorNode {
  id: number | string;
  labels: string[];
  properties: Record<string, unknown>;
}

/**
 * Mock FalkorDB Relationship structure
 */
export interface MockFalkorRelationship {
  id: number | string;
  type: string;
  properties: Record<string, unknown>;
  src_node: number | string;
  dest_node: number | string;
}

/**
 * Create a mock FalkorDB Node
 */
export function createMockFalkorNode(
  id: number,
  labels: string[],
  properties: Record<string, unknown>
): MockFalkorNode {
  return {
    id,
    labels,
    properties: { id: properties["id"] ?? String(id), ...properties },
  };
}

/**
 * Create a mock FalkorDB Relationship
 */
export function createMockFalkorRelationship(
  id: number,
  type: string,
  srcNode: number,
  destNode: number,
  properties: Record<string, unknown> = {}
): MockFalkorRelationship {
  return {
    id,
    type,
    properties,
    src_node: srcNode,
    dest_node: destNode,
  };
}

/**
 * Mock query result structure matching FalkorDB's actual format
 * FalkorDB returns data as array of objects with named properties
 */
export interface MockQueryResult<T = Record<string, unknown>> {
  metadata?: string[];
  data?: Array<T>;
}

/**
 * Create a mock query result
 * @param keys - Column names to use as object keys
 * @param data - Array of value arrays that will be converted to objects
 * @param metadata - Optional metadata strings
 */
export function createMockQueryResult<T = Record<string, unknown>>(
  keys: string[],
  data: Array<unknown[]>,
  metadata: string[] = []
): MockQueryResult<T> {
  // Convert array data to object format matching FalkorDB's actual response
  const objectData = data.map((row) => {
    const obj: Record<string, unknown> = {};
    keys.forEach((key, index) => {
      obj[key] = row[index];
    });
    return obj as T;
  });

  return {
    metadata,
    data: objectData,
  };
}

/**
 * Mock FalkorDB Graph implementation
 */
export class MockGraph {
  private mockResults: Map<string, MockQueryResult> = new Map();
  private shouldFail: boolean = false;
  private failError: Error = new Error("Mock graph error");
  public queryCount: number = 0;

  /**
   * Set the expected result for a query pattern
   */
  setQueryResult(cypherPattern: string, result: MockQueryResult): void {
    this.mockResults.set(cypherPattern, result);
  }

  /**
   * Set the graph to fail on next query
   */
  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    if (error) {
      this.failError = error;
    }
  }

  async query<T>(cypher: string, _options?: unknown): Promise<GraphReply<T>> {
    this.queryCount++;

    if (this.shouldFail) {
      throw this.failError;
    }

    // Find matching result by checking if cypher contains any of the patterns
    let result: MockQueryResult | undefined;
    for (const [pattern, mockResult] of this.mockResults.entries()) {
      if (cypher.includes(pattern)) {
        result = mockResult;
        break;
      }
    }

    if (!result) {
      result = { metadata: [], data: [] };
    }

    return {
      metadata: result.metadata ?? [],
      data: result.data as T[] | undefined,
    };
  }

  async roQuery<T>(cypher: string, options?: unknown): Promise<GraphReply<T>> {
    return this.query<T>(cypher, options);
  }

  async delete(): Promise<void> {}
}

/**
 * Mock FalkorDB client implementation
 */
export class MockFalkorDBClient {
  shouldFailConnect: boolean = false;
  connectError: Error = new Error("Connection failed");
  private currentGraph: MockGraph | null = null;
  private closed: boolean = false;
  public graphSelectionCount: number = 0;

  /**
   * Configure the mock to fail connection attempts
   */
  setShouldFailConnect(shouldFail: boolean, error?: Error): void {
    this.shouldFailConnect = shouldFail;
    if (error) {
      this.connectError = error;
    }
  }

  /**
   * Get the current graph for configuration
   */
  getCurrentGraph(): MockGraph | null {
    return this.currentGraph;
  }

  /**
   * Pre-configure a graph for the next selectGraph() call
   */
  setGraph(graph: MockGraph): void {
    this.currentGraph = graph;
  }

  selectGraph(_graphId: string): MockGraph {
    if (this.closed) {
      throw new Error("Client is closed");
    }

    this.graphSelectionCount++;

    if (this.currentGraph) {
      return this.currentGraph;
    }

    return new MockGraph();
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async list(): Promise<string[]> {
    return ["knowledge_graph"];
  }
}

/**
 * Mock FalkorDB module
 *
 * Use this to replace the falkordb import in tests
 */
export const mockFalkorDB = {
  connect: async (_options?: unknown): Promise<MockFalkorDBClient> => {
    return new MockFalkorDBClient();
  },
};

/**
 * Helper to create mock records for common query patterns
 */
export const mockFalkorRecordFactories = {
  /**
   * Create a result for a node return
   */
  nodeReturn: (node: MockFalkorNode): MockQueryResult => {
    return createMockQueryResult(["n"], [[node]]);
  },

  /**
   * Create a result for a delete count return
   */
  deleteCount: (count: number): MockQueryResult => {
    return createMockQueryResult(["deleted"], [[count]]);
  },

  /**
   * Create a result for a relationship return
   */
  relationshipReturn: (rel: MockFalkorRelationship, relId: number): MockQueryResult => {
    return createMockQueryResult(["r", "relId"], [[rel, relId]]);
  },

  /**
   * Create a result for node existence check
   */
  nodeExistence: (fromExists: boolean, toExists: boolean): MockQueryResult => {
    return createMockQueryResult(["fromExists", "toExists"], [[fromExists, toExists]]);
  },

  /**
   * Create a result for traversal results
   */
  traversalResult: (
    startNode: MockFalkorNode,
    connectedNodes: MockFalkorNode[],
    allRels: MockFalkorRelationship[][]
  ): MockQueryResult => {
    return createMockQueryResult(
      ["start", "connectedNodes", "allRels"],
      [[startNode, connectedNodes, allRels]]
    );
  },

  /**
   * Create a result for dependency analysis
   */
  dependencyResult: (depNode: MockFalkorNode, relType: string, depth: number): MockQueryResult => {
    return createMockQueryResult(["dep", "relType", "depth"], [[depNode, relType, depth]]);
  },

  /**
   * Create a result for context retrieval
   */
  contextResult: (contextNode: MockFalkorNode, reason: string): MockQueryResult => {
    return createMockQueryResult(["context", "reason"], [[contextNode, reason]]);
  },

  /**
   * Create an empty result
   */
  emptyResult: (): MockQueryResult => {
    return createMockQueryResult([], []);
  },
};

/**
 * Sample mock nodes for testing
 */
export const sampleMockFalkorNodes = {
  repository: createMockFalkorNode(1, ["Repository"], {
    id: "Repository:test-repo",
    name: "test-repo",
    url: "https://github.com/test/test-repo",
    lastIndexed: "2025-01-01T00:00:00Z",
    status: "ready",
  }),

  file: createMockFalkorNode(2, ["File"], {
    id: "File:test-repo:src/index.ts",
    path: "src/index.ts",
    extension: "ts",
    hash: "abc123",
    repository: "test-repo",
  }),

  function: createMockFalkorNode(3, ["Function"], {
    id: "Function:test-repo:src/index.ts:main",
    name: "main",
    signature: "async main(): Promise<void>",
    startLine: 10,
    endLine: 20,
    filePath: "src/index.ts",
    repository: "test-repo",
  }),

  class: createMockFalkorNode(4, ["Class"], {
    id: "Class:test-repo:src/TestClass.ts:TestClass",
    name: "TestClass",
    type: "class",
    filePath: "src/TestClass.ts",
    startLine: 1,
    endLine: 50,
    repository: "test-repo",
  }),

  module: createMockFalkorNode(5, ["Module"], {
    id: "Module:lodash",
    name: "lodash",
    type: "npm",
    version: "4.17.21",
  }),

  chunk: createMockFalkorNode(6, ["Chunk"], {
    id: "Chunk:test-repo:src/index.ts:0",
    chromaId: "test-repo:src/index.ts:0",
    chunkIndex: 0,
    filePath: "src/index.ts",
    repository: "test-repo",
  }),

  concept: createMockFalkorNode(7, ["Concept"], {
    id: "Concept:authentication",
    name: "authentication",
    description: "User authentication",
    confidence: 0.9,
  }),
};

/**
 * Sample mock relationships for testing
 */
export const sampleMockFalkorRelationships = {
  contains: createMockFalkorRelationship(100, "CONTAINS", 1, 2, {}),
  defines: createMockFalkorRelationship(101, "DEFINES", 2, 3, { startLine: 10, endLine: 20 }),
  imports: createMockFalkorRelationship(102, "IMPORTS", 2, 5, {
    importType: "named",
    importedSymbols: ["map"],
  }),
  calls: createMockFalkorRelationship(103, "CALLS", 3, 3, { callCount: 5, isAsync: true }),
  implements: createMockFalkorRelationship(104, "IMPLEMENTS", 4, 4, {}),
  hasChunk: createMockFalkorRelationship(105, "HAS_CHUNK", 2, 6, { chunkIndex: 0 }),
  taggedWith: createMockFalkorRelationship(106, "TAGGED_WITH", 3, 7, { confidence: 0.8 }),
};

/**
 * Test configuration for FalkorDB adapter
 */
export const testFalkorConfig = {
  host: "localhost",
  port: 6379,
  username: "default",
  password: "testpassword",
  database: "knowledge_graph",
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
 * Error messages for testing error scenarios
 */
export const testFalkorErrorMessages = {
  connectionRefused: "ECONNREFUSED: Connection refused to localhost:6379",
  authenticationFailed: "NOAUTH Authentication required",
  wrongPassword: "WRONGPASS invalid username-password pair",
  queryTimeout: "Query execution timed out after 30000 milliseconds",
  syntaxError: "Cypher syntax error: Invalid query syntax",
  graphNotFound: "ERR Graph 'unknown_graph' does not exist",
};

/**
 * Reset all mock state - useful between tests
 */
export function resetFalkorMocks(): void {
  // This function can be extended to reset any global mock state
}
