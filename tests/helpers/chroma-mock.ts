/**
 * Mock ChromaDB client for unit testing
 *
 * Provides mock implementations of ChromaClient and Collection classes
 * that can be used to test storage client logic without a real ChromaDB instance.
 */

/* eslint-disable @typescript-eslint/require-await */

/**
 * Mock ChromaDB Collection implementation
 *
 * Simulates a ChromaDB collection with in-memory storage for testing.
 */
export class MockCollection {
  public name: string;
  public metadata: Record<string, unknown>;
  private documents: Map<
    string,
    {
      id: string;
      embedding: number[];
      metadata: Record<string, unknown>;
      document: string;
    }
  > = new Map();
  private shouldFailAdd: boolean = false;
  private shouldFailQuery: boolean = false;

  constructor(name: string, metadata: Record<string, unknown> = {}) {
    this.name = name;
    this.metadata = metadata;
  }

  /**
   * Configure the mock to fail add operations
   */
  setShouldFailAdd(shouldFail: boolean): void {
    this.shouldFailAdd = shouldFail;
  }

  /**
   * Configure the mock to fail query operations
   */
  setShouldFailQuery(shouldFail: boolean): void {
    this.shouldFailQuery = shouldFail;
  }

  async add(params: {
    ids: string[];
    embeddings: number[][];
    metadatas: Record<string, unknown>[];
    documents: string[];
  }): Promise<void> {
    if (this.shouldFailAdd) {
      throw new Error("Mock collection add operation failed");
    }

    for (let i = 0; i < params.ids.length; i++) {
      this.documents.set(params.ids[i]!, {
        id: params.ids[i]!,
        embedding: params.embeddings[i]!,
        metadata: params.metadatas[i]!,
        document: params.documents[i]!,
      });
    }
  }

  async query(params: { queryEmbeddings: number[][]; nResults: number }): Promise<{
    ids: string[][];
    distances: number[][];
    documents: string[][];
    metadatas: Record<string, unknown>[][];
  }> {
    if (this.shouldFailQuery) {
      throw new Error("Mock collection query operation failed");
    }

    // Simple mock: return documents with calculated cosine distance
    const queryEmbedding = params.queryEmbeddings[0]!;
    const results = Array.from(this.documents.values())
      .map((doc) => ({
        ...doc,
        distance: this.calculateCosineDistance(queryEmbedding, doc.embedding),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, params.nResults);

    return {
      ids: [results.map((r) => r.id)],
      distances: [results.map((r) => r.distance)],
      documents: [results.map((r) => r.document)],
      metadatas: [results.map((r) => r.metadata)],
    };
  }

  async count(): Promise<number> {
    return this.documents.size;
  }

  async get(params?: { ids?: string[] }): Promise<{
    ids: string[];
    embeddings: number[][];
    metadatas: Record<string, unknown>[];
    documents: string[];
  }> {
    const docs = params?.ids
      ? params.ids.map((id) => this.documents.get(id)).filter((doc) => doc !== undefined)
      : Array.from(this.documents.values());

    return {
      ids: docs.map((doc) => doc.id),
      embeddings: docs.map((doc) => doc.embedding),
      metadatas: docs.map((doc) => doc.metadata),
      documents: docs.map((doc) => doc.document),
    };
  }

  async delete(params?: { ids?: string[] }): Promise<void> {
    if (params?.ids) {
      params.ids.forEach((id) => this.documents.delete(id));
    } else {
      this.documents.clear();
    }
  }

  /**
   * Calculate cosine distance between two vectors
   * Returns value between 0 (identical) and 2 (opposite)
   */
  private calculateCosineDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have same dimension");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 2; // Maximum distance for zero vectors
    }

    const cosineSimilarity = dotProduct / (normA * normB);
    // Convert similarity [-1, 1] to distance [0, 2]
    return 1 - cosineSimilarity;
  }
}

/**
 * Mock ChromaDB Client implementation
 *
 * Simulates the ChromaClient for testing without a real ChromaDB server.
 */
export class MockChromaClient {
  private collections: Map<string, MockCollection> = new Map();
  private shouldFailHeartbeat: boolean = false;

  /**
   * Configure the mock to fail health checks
   */
  setShouldFailHeartbeat(shouldFail: boolean): void {
    this.shouldFailHeartbeat = shouldFail;
  }

  async heartbeat(): Promise<number> {
    if (this.shouldFailHeartbeat) {
      throw new Error("ChromaDB not reachable");
    }
    return Date.now();
  }

  async getOrCreateCollection(params: {
    name: string;
    metadata?: Record<string, unknown>;
  }): Promise<MockCollection> {
    if (!this.collections.has(params.name)) {
      this.collections.set(params.name, new MockCollection(params.name, params.metadata || {}));
    }
    return this.collections.get(params.name)!;
  }

  async deleteCollection(params: { name: string }): Promise<void> {
    this.collections.delete(params.name);
  }

  /**
   * List collection names only (matching ChromaDB API)
   * Returns array of collection name strings
   */
  async listCollections(): Promise<string[]> {
    return Array.from(this.collections.keys());
  }

  async listCollectionsAndMetadata(): Promise<
    Array<{ name: string; id: string; metadata?: Record<string, unknown> }>
  > {
    return Array.from(this.collections.values()).map((collection) => ({
      name: collection.name,
      id: collection.name, // Mock uses name as id
      metadata: collection.metadata,
    }));
  }

  /**
   * Get an existing collection (matching ChromaDB API)
   */
  async getCollection(params: { name: string }): Promise<MockCollection> {
    const collection = this.collections.get(params.name);
    if (!collection) {
      throw new Error(`Collection ${params.name} not found`);
    }
    return collection;
  }

  /**
   * Get a collection synchronously (for internal test helper use)
   */
  getCollectionSync(name: string): MockCollection | undefined {
    return this.collections.get(name);
  }

  /**
   * Clear all collections (for test cleanup)
   */
  clear(): void {
    this.collections.clear();
  }
}
