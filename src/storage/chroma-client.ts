/**
 * ChromaDB Storage Client Implementation
 *
 * This module provides the concrete implementation of the ChromaStorageClient interface,
 * handling all interactions with the ChromaDB vector database including connection
 * management, collection operations, document storage, and similarity search.
 *
 * @module storage/chroma-client
 */

import { ChromaClient, type Collection } from "chromadb";
import type {
  ChromaConfig,
  ChromaStorageClient,
  ChromaCollection,
  CollectionInfo,
  CollectionStats,
  DocumentInput,
  DocumentMetadata,
  SimilarityQuery,
  SimilarityResult,
} from "./types.js";
import {
  StorageError,
  StorageConnectionError,
  CollectionNotFoundError,
  InvalidParametersError,
  DocumentOperationError,
  SearchOperationError,
} from "./errors.js";

/**
 * Implementation of the ChromaStorageClient interface
 *
 * Provides a high-level abstraction over the ChromaDB JavaScript client with:
 * - Connection management and health checking
 * - Collection caching for performance
 * - Automatic distance-to-similarity conversion
 * - Comprehensive error handling
 * - Type-safe operations
 *
 * @example
 * ```typescript
 * const config = {
 *   host: process.env.CHROMADB_HOST || 'localhost',
 *   port: parseInt(process.env.CHROMADB_PORT || '8000')
 * };
 *
 * const client = new ChromaStorageClientImpl(config);
 * await client.connect();
 * await client.healthCheck(); // Verify connection
 *
 * // Create collection for a repository
 * const collection = await client.getOrCreateCollection('repo_my-api');
 *
 * // Add documents with embeddings
 * await client.addDocuments('repo_my-api', documents);
 *
 * // Perform similarity search
 * const results = await client.similaritySearch({
 *   embedding: queryEmbedding,
 *   collections: ['repo_my-api'],
 *   limit: 10,
 *   threshold: 0.7
 * });
 * ```
 */
export class ChromaStorageClientImpl implements ChromaStorageClient {
  private client: ChromaClient | null = null;
  private config: ChromaConfig;

  /**
   * In-memory cache of collection handles
   *
   * Caching collection handles avoids repeated lookups and improves performance.
   * The cache is invalidated when collections are deleted.
   */
  private collections: Map<string, Collection> = new Map();

  /**
   * Create a new ChromaDB storage client
   *
   * @param config - Connection configuration
   */
  constructor(config: ChromaConfig) {
    this.config = config;
  }

  /**
   * Initialize connection to ChromaDB server
   *
   * Creates the HTTP client connection to the ChromaDB instance.
   * This must be called before any other operations.
   *
   * @throws {StorageConnectionError} If connection initialization fails
   */
  async connect(): Promise<void> {
    try {
      const path = `http://${this.config.host}:${this.config.port}`;
      this.client = new ChromaClient({ path });

      // Verify connection by making a test call
      await this.healthCheck();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new StorageConnectionError(
        `Failed to connect to ChromaDB at ${this.config.host}:${this.config.port}: ${errorMessage}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if ChromaDB server is reachable and healthy
   *
   * Pings the ChromaDB /api/v2/heartbeat endpoint to verify connectivity.
   *
   * @returns True if ChromaDB is healthy, false if not reachable
   */
  async healthCheck(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      // ChromaDB heartbeat() returns timestamp if healthy
      await this.client.heartbeat();
      return true;
    } catch {
      // Heartbeat failed - server not healthy
      return false;
    }
  }

  /**
   * Get existing collection without creating it if it doesn't exist
   *
   * Checks cache first, then verifies collection exists in ChromaDB.
   * Returns null if collection doesn't exist rather than creating it.
   * Useful for search operations where we don't want side effects.
   *
   * @param name - Collection name
   * @returns ChromaDB collection handle or null if not found
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async getCollectionIfExists(name: string): Promise<ChromaCollection | null> {
    this.ensureConnected();

    // Check cache first
    if (this.collections.has(name)) {
      return this.collections.get(name)!;
    }

    try {
      // Check if collection exists by listing all collections
      const collections = await this.client!.listCollectionsAndMetadata();
      const exists = collections.some((col) => col.name === name);

      if (!exists) {
        return null;
      }

      // Collection exists, get it (will add to cache)
      return await this.getOrCreateCollection(name);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new StorageError(
        `Failed to check collection existence '${name}': ${errorMessage}`,
        "COLLECTION_OPERATION_ERROR",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get existing collection or create if it doesn't exist
   *
   * Collections use cosine similarity metric for vector search.
   * Collection handles are cached in-memory to avoid repeated API calls.
   *
   * @param name - Collection name (should follow repo_ naming convention)
   * @returns ChromaDB collection handle
   * @throws {StorageError} If collection operations fail
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async getOrCreateCollection(name: string): Promise<ChromaCollection> {
    this.ensureConnected();

    if (!name || name.trim() === "") {
      throw new InvalidParametersError("Collection name cannot be empty", "name");
    }

    // Check cache first
    if (this.collections.has(name)) {
      return this.collections.get(name)!;
    }

    try {
      // Get or create collection with cosine similarity metric
      const collection = await this.client!.getOrCreateCollection({
        name,
        metadata: { "hnsw:space": "cosine" },
      });

      // Cache the collection handle
      this.collections.set(name, collection);

      return collection;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new StorageError(
        `Failed to get or create collection '${name}': ${errorMessage}`,
        "COLLECTION_OPERATION_ERROR",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete a collection and all its documents
   *
   * Removes the collection from ChromaDB and clears it from the cache.
   * Use this when removing a repository from the index.
   *
   * @param name - Collection name to delete
   * @throws {StorageError} If deletion fails
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async deleteCollection(name: string): Promise<void> {
    this.ensureConnected();

    try {
      await this.client!.deleteCollection({ name });

      // Remove from cache
      this.collections.delete(name);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new StorageError(
        `Failed to delete collection '${name}': ${errorMessage}`,
        "COLLECTION_DELETE_ERROR",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * List all collections with their document counts
   *
   * @returns Array of collection information
   * @throws {StorageError} If listing fails
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async listCollections(): Promise<CollectionInfo[]> {
    this.ensureConnected();

    try {
      // Use listCollectionsAndMetadata() to get name, id, and metadata
      const collections = await this.client!.listCollectionsAndMetadata();

      return collections.map((collection) => {
        return {
          name: collection.name,
          count: 0, // ChromaDB doesn't return count in list, would need to query each
          metadata: (collection.metadata as Record<string, unknown>) ?? {},
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new StorageError(
        `Failed to list collections: ${errorMessage}`,
        "COLLECTION_LIST_ERROR",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Add documents with embeddings to a collection
   *
   * Documents are added in batch for efficiency. Each document must have:
   * - Unique ID in format {repo}:{file_path}:{chunk_index}
   * - Pre-computed embedding vector
   * - Complete metadata
   *
   * @param collectionName - Target collection name
   * @param documents - Array of documents to add
   * @throws {DocumentOperationError} If document addition fails
   * @throws {InvalidParametersError} If documents are invalid
   * @throws {CollectionNotFoundError} If collection doesn't exist
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async addDocuments(collectionName: string, documents: DocumentInput[]): Promise<void> {
    this.ensureConnected();

    if (!documents || documents.length === 0) {
      throw new InvalidParametersError("Documents array cannot be empty", "documents");
    }

    // Validate document format
    for (const doc of documents) {
      if (!doc.id || doc.id.trim() === "") {
        throw new InvalidParametersError("Document ID cannot be empty", "documents.id");
      }
      if (!doc.content) {
        throw new InvalidParametersError(
          `Document ${doc.id} is missing content`,
          "documents.content"
        );
      }
      if (!doc.embedding || !Array.isArray(doc.embedding) || doc.embedding.length === 0) {
        throw new InvalidParametersError(
          `Document ${doc.id} has invalid or empty embedding`,
          "documents.embedding"
        );
      }
      if (!doc.metadata) {
        throw new InvalidParametersError(
          `Document ${doc.id} is missing metadata`,
          "documents.metadata"
        );
      }
    }

    try {
      const collection = await this.getOrCreateCollection(collectionName);

      // Prepare batch add parameters
      const ids = documents.map((doc) => doc.id);
      const embeddings = documents.map((doc) => doc.embedding);
      const metadatas = documents.map((doc) => doc.metadata);
      const docsContent = documents.map((doc) => doc.content);

      // Add documents in batch
      // Convert DocumentMetadata to ChromaDB's Metadata type (string | number | boolean values)
      const chromaMetadatas = metadatas.map((meta) => {
        const chromaMeta: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(meta)) {
          if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
          ) {
            chromaMeta[key] = value;
          } else {
            chromaMeta[key] = String(value);
          }
        }
        return chromaMeta;
      });

      await collection.add({
        ids,
        embeddings,
        metadatas: chromaMetadatas,
        documents: docsContent,
      });
    } catch (error) {
      const documentIds = documents.map((doc) => doc.id);
      const errorMessage = error instanceof Error ? error.message : String(error);

      throw new DocumentOperationError(
        "add",
        `Failed to add ${documents.length} documents to collection '${collectionName}': ${errorMessage}`,
        documentIds,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Perform similarity search across one or more collections
   *
   * Searches for documents similar to the query embedding using cosine similarity.
   * Results are filtered by the threshold and sorted by similarity (descending).
   *
   * ChromaDB returns cosine distance (0 = identical, 2 = opposite).
   * This is converted to similarity score (0-1 scale) using: similarity = 1 - (distance / 2)
   *
   * @param query - Search parameters
   * @returns Array of matching documents sorted by similarity (descending)
   * @throws {SearchOperationError} If search fails
   * @throws {InvalidParametersError} If query parameters are invalid
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async similaritySearch(query: SimilarityQuery): Promise<SimilarityResult[]> {
    this.ensureConnected();

    // Validate query parameters
    if (!query.embedding || !Array.isArray(query.embedding) || query.embedding.length === 0) {
      throw new InvalidParametersError(
        "Query embedding is required and must be a non-empty array",
        "query.embedding"
      );
    }

    if (!query.collections || query.collections.length === 0) {
      throw new InvalidParametersError(
        "At least one collection must be specified",
        "query.collections"
      );
    }

    if (query.limit < 1) {
      throw new InvalidParametersError("Limit must be at least 1", "query.limit");
    }

    if (query.threshold < 0 || query.threshold > 1) {
      throw new InvalidParametersError("Threshold must be between 0 and 1", "query.threshold");
    }

    try {
      const allResults: SimilarityResult[] = [];

      // Query each collection
      for (const collectionName of query.collections) {
        try {
          // Use getCollectionIfExists() to avoid auto-creating during search
          const collection = await this.getCollectionIfExists(collectionName);
          if (!collection) {
            console.warn(`Collection ${collectionName} not found during search, skipping`);
            continue;
          }

          // Query the collection
          const queryResult = await collection.query({
            queryEmbeddings: [query.embedding],
            nResults: query.limit,
          });

          // Process results
          if (queryResult.ids && queryResult.ids[0] && queryResult.ids[0].length > 0) {
            const ids = queryResult.ids[0];
            const distances = queryResult.distances?.[0] || [];
            const documents = queryResult.documents?.[0] || [];
            const metadatas = queryResult.metadatas?.[0] || [];

            for (let i = 0; i < ids.length; i++) {
              const distance = distances[i] || 0;
              const similarity = this.convertDistanceToSimilarity(distance);

              // Filter by threshold
              if (similarity >= query.threshold && ids[i]) {
                allResults.push({
                  id: ids[i]!,
                  content: documents[i] || "",
                  metadata: metadatas[i] as unknown as DocumentMetadata,
                  distance,
                  similarity,
                });
              }
            }
          }
        } catch (error) {
          // Log collection-specific error but continue with other collections
          console.error(`Error querying collection ${collectionName}:`, error);
        }
      }

      // Sort by similarity (descending) and limit results
      allResults.sort((a, b) => b.similarity - a.similarity);
      return allResults.slice(0, query.limit);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new SearchOperationError(
        `Similarity search failed: ${errorMessage}`,
        query.collections,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get statistics for a specific collection
   *
   * Returns document count and creation timestamp for monitoring and debugging.
   *
   * @param name - Collection name
   * @returns Collection statistics
   * @throws {CollectionNotFoundError} If collection doesn't exist
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async getCollectionStats(name: string): Promise<CollectionStats> {
    this.ensureConnected();

    try {
      const collection = await this.getOrCreateCollection(name);

      // Get document count
      const count = await collection.count();

      return {
        name,
        documentCount: count,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a "collection not found" error
      if (errorMessage.includes("not found") || errorMessage.includes("does not exist")) {
        throw new CollectionNotFoundError(name);
      }

      throw new StorageError(
        `Failed to get stats for collection '${name}': ${errorMessage}`,
        "COLLECTION_STATS_ERROR",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Convert ChromaDB cosine distance to similarity score (0-1 scale)
   *
   * ChromaDB returns cosine distance where:
   * - 0 = identical vectors
   * - 2 = opposite vectors
   *
   * We convert this to a similarity score where:
   * - 1 = most similar (distance 0)
   * - 0 = least similar (distance 2)
   *
   * Formula: similarity = 1 - (distance / 2)
   *
   * @param distance - Cosine distance from ChromaDB
   * @returns Similarity score (0-1)
   */
  private convertDistanceToSimilarity(distance: number): number {
    const similarity = 1 - distance / 2;
    // Clamp to [0, 1] for defensive coding against floating-point errors
    return Math.max(0, Math.min(1, similarity));
  }

  /**
   * Ensure the client is connected to ChromaDB
   *
   * @throws {StorageConnectionError} If not connected
   */
  private ensureConnected(): void {
    if (!this.client) {
      throw new StorageConnectionError("Not connected to ChromaDB. Call connect() first.");
    }
  }
}
