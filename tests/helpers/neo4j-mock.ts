/**
 * Mock Neo4j driver for unit testing
 *
 * Provides mock implementations of Driver, Session, and Result classes
 * that can be used to test Neo4jClient logic without a real Neo4j instance.
 */

/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */

import type { QueryResult, ServerInfo, SessionConfig } from "neo4j-driver";

/**
 * Mock Neo4j Record implementation
 * Note: This is a simplified mock that doesn't fully implement Neo4jRecord interface
 * but provides enough functionality for testing purposes.
 */
export class MockRecord {
  private data: Map<string, unknown>;
  keys: string[];
  length: number;

  constructor(keys: string[], values: unknown[]) {
    this.keys = keys;
    this.length = keys.length;
    this.data = new Map();
    keys.forEach((key, index) => {
      this.data.set(key, values[index]);
    });
  }

  get(key: string | number): unknown {
    if (typeof key === "number") {
      return this.data.get(this.keys[key] ?? "");
    }
    return this.data.get(key);
  }

  has(key: string | number): boolean {
    if (typeof key === "number") {
      return key >= 0 && key < this.keys.length;
    }
    return this.data.has(key);
  }

  forEach(visitor: (value: unknown, key: string, record: MockRecord) => void): void {
    this.data.forEach((value, key) => visitor(value, key, this));
  }

  toObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    this.data.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  *values(): IterableIterator<unknown> {
    yield* this.data.values();
  }

  *entries(): IterableIterator<[string, unknown]> {
    yield* this.data.entries();
  }

  [Symbol.iterator](): IterableIterator<[string, unknown]> {
    return this.data.entries();
  }
}

/**
 * Mock Neo4j Node structure
 */
export interface MockNode {
  identity: { toNumber: () => number; toString: () => string };
  labels: string[];
  properties: Record<string, unknown>;
}

/**
 * Mock Neo4j Relationship structure
 */
export interface MockRelationship {
  identity: { toNumber: () => number; toString: () => string };
  type: string;
  properties: Record<string, unknown>;
  start: { toNumber: () => number; toString: () => string };
  end: { toNumber: () => number; toString: () => string };
}

/**
 * Create a mock Neo4j Node
 */
export function createMockNode(
  id: number,
  labels: string[],
  properties: Record<string, unknown>
): MockNode {
  return {
    identity: {
      toNumber: () => id,
      toString: () => id.toString(),
    },
    labels,
    properties: { id: properties["id"] ?? id.toString(), ...properties },
  };
}

/**
 * Create a mock Neo4j Relationship
 */
export function createMockRelationship(
  id: number,
  type: string,
  startId: number,
  endId: number,
  properties: Record<string, unknown> = {}
): MockRelationship {
  return {
    identity: {
      toNumber: () => id,
      toString: () => id.toString(),
    },
    type,
    properties,
    start: {
      toNumber: () => startId,
      toString: () => startId.toString(),
    },
    end: {
      toNumber: () => endId,
      toString: () => endId.toString(),
    },
  };
}

/**
 * Mock Neo4j Session implementation
 */
export class MockSession {
  private mockResults: Map<string, MockRecord[]> = new Map();
  private shouldFail: boolean = false;
  private failError: Error = new Error("Mock session error");
  private closed: boolean = false;
  public runCount: number = 0;

  /**
   * Set the expected result for a query pattern
   */
  setQueryResult(cypherPattern: string, records: MockRecord[]): void {
    this.mockResults.set(cypherPattern, records);
  }

  /**
   * Set the session to fail on next run
   */
  setShouldFail(shouldFail: boolean, error?: Error): void {
    this.shouldFail = shouldFail;
    if (error) {
      this.failError = error;
    }
  }

  async run(cypher: string, _params?: Record<string, unknown>): Promise<QueryResult> {
    if (this.closed) {
      throw new Error("Session is closed");
    }

    this.runCount++;

    if (this.shouldFail) {
      throw this.failError;
    }

    // Find matching result by checking if cypher contains any of the patterns
    let records: MockRecord[] = [];
    for (const [pattern, result] of this.mockResults.entries()) {
      if (cypher.includes(pattern)) {
        records = result;
        break;
      }
    }

    return {
      records,
      summary: {
        counters: {
          nodesCreated: () => 0,
          nodesDeleted: () => 0,
          relationshipsCreated: () => 0,
          relationshipsDeleted: () => 0,
          propertiesSet: () => 0,
          labelsAdded: () => 0,
          labelsRemoved: () => 0,
          indexesAdded: () => 0,
          indexesRemoved: () => 0,
          constraintsAdded: () => 0,
          constraintsRemoved: () => 0,
          containsUpdates: () => false,
          containsSystemUpdates: () => false,
          systemUpdates: () => 0,
          updates: () => ({
            nodesCreated: 0,
            nodesDeleted: 0,
            relationshipsCreated: 0,
            relationshipsDeleted: 0,
            propertiesSet: 0,
            labelsAdded: 0,
            labelsRemoved: 0,
            indexesAdded: 0,
            indexesRemoved: 0,
            constraintsAdded: 0,
            constraintsRemoved: 0,
          }),
        },
        query: { text: cypher, parameters: {} },
        queryType: "r" as const,
        resultAvailableAfter: { toNumber: () => 0 },
        resultConsumedAfter: { toNumber: () => 0 },
        database: { name: "neo4j" },
        server: { address: "localhost:7687", protocolVersion: 4 },
        notifications: [],
        plan: undefined,
        profile: undefined,
        hasPlan: () => false,
        hasProfile: () => false,
      },
    } as unknown as QueryResult;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }

  // Additional methods for compatibility
  beginTransaction(): unknown {
    return {
      run: this.run.bind(this),
      commit: async () => {},
      rollback: async () => {},
      close: async () => {},
    };
  }

  lastBookmarks(): string[] {
    return [];
  }
}

/**
 * Mock Neo4j Driver implementation
 */
export class MockDriver {
  private shouldFailConnect: boolean = false;
  private shouldFailHealthCheck: boolean = false;
  private connectError: Error = new Error("Connection failed");
  private currentSession: MockSession | null = null;
  private closed: boolean = false;
  public sessionCreationCount: number = 0;

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
   * Configure the mock to fail health checks
   */
  setShouldFailHealthCheck(shouldFail: boolean): void {
    this.shouldFailHealthCheck = shouldFail;
  }

  /**
   * Get the current session for configuration
   */
  getCurrentSession(): MockSession | null {
    return this.currentSession;
  }

  /**
   * Pre-configure a session for the next session() call
   */
  setSession(session: MockSession): void {
    this.currentSession = session;
  }

  session(_config?: SessionConfig): MockSession {
    if (this.closed) {
      throw new Error("Driver is closed");
    }

    this.sessionCreationCount++;

    if (this.currentSession) {
      return this.currentSession;
    }

    return new MockSession();
  }

  async getServerInfo(): Promise<ServerInfo> {
    if (this.shouldFailConnect) {
      throw this.connectError;
    }

    if (this.shouldFailHealthCheck) {
      throw new Error("Server not responding");
    }

    return {
      address: "localhost:7687",
      protocolVersion: 4 as unknown,
    } as ServerInfo;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async verifyConnectivity(): Promise<void> {
    if (this.shouldFailConnect) {
      throw this.connectError;
    }
  }

  supportsMultiDb(): boolean {
    return true;
  }

  supportsTransactionConfig(): boolean {
    return true;
  }
}

/**
 * Mock neo4j module
 *
 * Use this to replace the neo4j-driver import in tests
 */
export const mockNeo4j = {
  driver: (_uri: string, _auth: unknown, _config?: unknown): MockDriver => {
    return new MockDriver();
  },

  auth: {
    basic: (username: string, password: string) => ({
      scheme: "basic",
      principal: username,
      credentials: password,
    }),
  },

  isInt: (value: unknown): boolean => {
    return (
      typeof value === "object" &&
      value !== null &&
      "toNumber" in value &&
      typeof (value as { toNumber: unknown }).toNumber === "function"
    );
  },

  int: (value: number) => ({
    toNumber: () => value,
    toString: () => value.toString(),
    low: value,
    high: 0,
  }),
};

/**
 * Helper to create mock records for common query patterns
 */
export const mockRecordFactories = {
  /**
   * Create a record for a node return
   */
  nodeReturn: (node: MockNode): MockRecord => {
    return new MockRecord(["n"], [node]);
  },

  /**
   * Create a record for a delete count return
   */
  deleteCount: (count: number): MockRecord => {
    return new MockRecord(["deleted"], [mockNeo4j.int(count)]);
  },

  /**
   * Create a record for a relationship return
   */
  relationshipReturn: (rel: MockRelationship, relId: string): MockRecord => {
    return new MockRecord(["r", "relId"], [rel, relId]);
  },

  /**
   * Create a record for node existence check
   */
  nodeExistence: (fromExists: boolean, toExists: boolean): MockRecord => {
    return new MockRecord(["fromExists", "toExists"], [fromExists, toExists]);
  },

  /**
   * Create a record for traversal results (APOC style)
   */
  traversalResult: (nodes: MockNode[], relationships: MockRelationship[]): MockRecord => {
    return new MockRecord(["nodes", "relationships"], [nodes, relationships]);
  },

  /**
   * Create a record for dependency analysis
   */
  dependencyResult: (depNode: MockNode, relType: string, depth: number): MockRecord => {
    return new MockRecord(["dep", "relType", "depth"], [depNode, relType, mockNeo4j.int(depth)]);
  },

  /**
   * Create a record for context retrieval
   */
  contextResult: (
    contextNode: MockNode,
    reason: string,
    seedId: string = "default-seed",
    seedRepo: string | null = null
  ): MockRecord => {
    return new MockRecord(
      ["seedId", "seedRepo", "context", "reason"],
      [seedId, seedRepo, contextNode, reason]
    );
  },
};

/**
 * Reset all mock state - useful between tests
 */
export function resetMocks(): void {
  // This function can be extended to reset any global mock state
}
