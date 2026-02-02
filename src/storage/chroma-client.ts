/**
 * ChromaDB Storage Client Implementation
 *
 * This module provides the concrete implementation of the ChromaStorageClient interface,
 * handling all interactions with the ChromaDB vector database including connection
 * management, collection operations, document storage, and similarity search.
 *
 * Features:
 * - Automatic retry with exponential backoff for transient failures
 * - Connection management and health checking
 * - Collection caching for performance
 * - Comprehensive error handling
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
  MetadataFilter,
  DocumentQueryResult,
  CollectionEmbeddingMetadata,
  ParsedEmbeddingMetadata,
} from "./types.js";
import {
  StorageError,
  StorageConnectionError,
  CollectionNotFoundError,
  InvalidParametersError,
  DocumentOperationError,
  SearchOperationError,
  isRetryableStorageError,
} from "./errors.js";
import { getComponentLogger } from "../logging/index.js";
import {
  withRetry,
  createRetryOptions,
  createRetryLogger,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from "../utils/retry.js";

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
  private retryConfig: RetryConfig;
  private logger = getComponentLogger("storage:chromadb");

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
   * @param config - Connection configuration (including optional retry settings)
   */
  constructor(config: ChromaConfig) {
    this.config = config;
    this.retryConfig = config.retry ?? DEFAULT_RETRY_CONFIG;
  }

  /**
   * Execute an operation with retry logic for transient failures
   *
   * Wraps the operation with exponential backoff retry for network and server errors.
   *
   * @param operation - Async operation to execute
   * @param operationName - Human-readable name for logging
   * @returns Promise resolving to the operation result
   */
  private async withRetryWrapper<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const options = createRetryOptions(this.retryConfig, {
      shouldRetry: (error) => isRetryableStorageError(error),
      onRetry: createRetryLogger(this.logger, operationName, this.retryConfig.maxRetries),
    });

    return withRetry(operation, options);
  }

  /**
   * Initialize connection to ChromaDB server
   *
   * Creates the HTTP client connection to the ChromaDB instance.
   * Uses retry logic with exponential backoff for transient connection failures.
   * This must be called before any other operations.
   *
   * @throws {StorageConnectionError} If connection initialization fails after all retries
   */
  async connect(): Promise<void> {
    const startTime = Date.now();
    this.logger.info({ host: this.config.host, port: this.config.port }, "Connecting to ChromaDB");

    try {
      const path = `http://${this.config.host}:${this.config.port}`;

      // Build client options with optional authentication
      // When authToken is provided, use Bearer token authentication via Authorization header
      type ChromaClientOptions = {
        path: string;
        auth?: {
          provider: "token";
          credentials: string;
          tokenHeaderType: "AUTHORIZATION";
        };
      };

      const clientOptions: ChromaClientOptions = { path };

      if (this.config.authToken) {
        clientOptions.auth = {
          provider: "token",
          credentials: this.config.authToken,
          tokenHeaderType: "AUTHORIZATION",
        };
        this.logger.info("ChromaDB authentication enabled");
      }

      this.client = new ChromaClient(clientOptions);

      // Verify connection by making a test call with retry
      await this.withRetryWrapper(async () => {
        const healthy = await this.performHealthCheck();
        if (!healthy) {
          throw new StorageConnectionError("ChromaDB health check failed - server not responding");
        }
      }, "ChromaDB connection");

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "chromadb.connection_ms",
          value: durationMs,
          host: this.config.host,
          port: this.config.port,
        },
        "Connected to ChromaDB"
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        {
          metric: "chromadb.connection_ms",
          value: durationMs,
          host: this.config.host,
          port: this.config.port,
          err: error,
        },
        "Failed to connect to ChromaDB"
      );

      // Re-throw StorageConnectionError directly, wrap other errors
      if (error instanceof StorageConnectionError) {
        throw error;
      }
      throw new StorageConnectionError(
        `Failed to connect to ChromaDB at ${this.config.host}:${this.config.port}: ${errorMessage}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Internal health check implementation (used by retry wrapper)
   *
   * @returns true if healthy, false otherwise
   */
  private async performHealthCheck(): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      await this.client.heartbeat();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if ChromaDB server is reachable and healthy
   *
   * Pings the ChromaDB /api/v2/heartbeat endpoint to verify connectivity.
   * This method does NOT use retry - it's a simple health check.
   *
   * @returns True if ChromaDB is healthy, false if not reachable
   */
  async healthCheck(): Promise<boolean> {
    if (!this.client) {
      this.logger.warn("Health check failed: Client not connected");
      return false;
    }

    const healthy = await this.performHealthCheck();
    if (healthy) {
      this.logger.debug("ChromaDB health check passed");
    } else {
      this.logger.warn("ChromaDB health check failed");
    }
    return healthy;
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
      // Use retry wrapper for transient network failures
      const collections = await this.withRetryWrapper(
        () => this.client!.listCollectionsAndMetadata(),
        "ChromaDB list collections"
      );
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
   * When creating a new collection, embedding metadata should be provided
   * to enable provider-aware query embedding during search operations.
   *
   * @param name - Collection name (should follow repo_ naming convention)
   * @param embeddingMetadata - Optional embedding provider metadata to store with collection
   * @returns ChromaDB collection handle
   * @throws {StorageError} If collection operations fail
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async getOrCreateCollection(
    name: string,
    embeddingMetadata?: CollectionEmbeddingMetadata
  ): Promise<ChromaCollection> {
    this.ensureConnected();

    if (!name || name.trim() === "") {
      throw new InvalidParametersError("Collection name cannot be empty", "name");
    }

    // Check cache first
    if (this.collections.has(name)) {
      return this.collections.get(name)!;
    }

    try {
      // Build metadata with HNSW cosine space and optional embedding provider info
      const metadata: Record<string, string | number | boolean> = {
        "hnsw:space": "cosine",
      };

      // Add embedding metadata if provided (for provider-aware search)
      if (embeddingMetadata) {
        if (embeddingMetadata["app:embedding_provider"]) {
          metadata["app:embedding_provider"] = embeddingMetadata["app:embedding_provider"];
        }
        if (embeddingMetadata["app:embedding_model"]) {
          metadata["app:embedding_model"] = embeddingMetadata["app:embedding_model"];
        }
        if (embeddingMetadata["app:embedding_dimensions"] !== undefined) {
          metadata["app:embedding_dimensions"] = embeddingMetadata["app:embedding_dimensions"];
        }
      }

      // Get or create collection with cosine similarity metric and embedding metadata
      // Use retry wrapper for transient network failures
      const collection = await this.withRetryWrapper(
        () =>
          this.client!.getOrCreateCollection({
            name,
            metadata,
          }),
        "ChromaDB get or create collection"
      );

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
      // Use retry wrapper for transient network failures
      await this.withRetryWrapper(
        () => this.client!.deleteCollection({ name }),
        "ChromaDB delete collection"
      );

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
      // Use retry wrapper for transient network failures
      const collections = await this.withRetryWrapper(
        () => this.client!.listCollectionsAndMetadata(),
        "ChromaDB list collections"
      );

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

    const startTime = Date.now();
    this.logger.info(
      {
        collection: collectionName,
        batchSize: documents.length,
      },
      "Adding documents to collection"
    );

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

      // Add documents with retry for transient failures
      await this.withRetryWrapper(
        () =>
          collection.add({
            ids,
            embeddings,
            metadatas: chromaMetadatas,
            documents: docsContent,
          }),
        "ChromaDB add documents"
      );

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "chromadb.add_documents_ms",
          value: durationMs,
          collection: collectionName,
          batchSize: documents.length,
        },
        "Documents added successfully"
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const documentIds = documents.map((doc) => doc.id);
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        {
          metric: "chromadb.add_documents_ms",
          value: durationMs,
          collection: collectionName,
          batchSize: documents.length,
          err: error,
        },
        "Failed to add documents"
      );

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

    const startTime = Date.now();
    this.logger.info(
      {
        collections: query.collections,
        limit: query.limit,
        threshold: query.threshold,
        embeddingDim: query.embedding.length,
      },
      "Performing similarity search"
    );

    try {
      const allResults: SimilarityResult[] = [];

      // Query each collection
      for (const collectionName of query.collections) {
        try {
          // Use getCollectionIfExists() to avoid auto-creating during search
          const collection = await this.getCollectionIfExists(collectionName);
          if (!collection) {
            this.logger.warn(
              { collection: collectionName },
              "Collection not found during search, skipping"
            );
            continue;
          }

          // Query the collection with retry for transient failures
          const queryResult = await this.withRetryWrapper(
            () =>
              collection.query({
                queryEmbeddings: [query.embedding],
                nResults: query.limit,
                where: query.where as Record<string, unknown> | undefined,
              }),
            `ChromaDB query ${collectionName}`
          );

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
          this.logger.error(
            { collection: collectionName, err: error },
            "Error querying collection"
          );
        }
      }

      // Sort by similarity (descending) and limit results
      allResults.sort((a, b) => b.similarity - a.similarity);
      const finalResults = allResults.slice(0, query.limit);

      const durationMs = Date.now() - startTime;
      this.logger.info(
        {
          metric: "search.duration_ms",
          value: durationMs,
          collections: query.collections,
          resultsCount: finalResults.length,
          limit: query.limit,
          threshold: query.threshold,
        },
        "Search completed"
      );

      return finalResults;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        {
          metric: "search.duration_ms",
          value: durationMs,
          collections: query.collections,
          err: error,
        },
        "Search failed"
      );

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
   * Upsert documents with embeddings to a collection
   *
   * Adds new documents or updates existing ones (idempotent operation).
   * Documents with existing IDs will be updated, new IDs will be added.
   *
   * Uses the same validation as addDocuments() to ensure consistency.
   *
   * @param collectionName - Target collection name
   * @param documents - Array of documents to upsert
   * @throws {InvalidParametersError} If validation fails
   * @throws {DocumentOperationError} If upsert operation fails
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async upsertDocuments(collectionName: string, documents: DocumentInput[]): Promise<void> {
    this.ensureConnected();

    const startTime = Date.now();

    try {
      // Validate inputs (reuse addDocuments validation logic)
      if (!documents || documents.length === 0) {
        throw new InvalidParametersError("Documents array cannot be empty", "documents");
      }

      // Validate each document
      const documentIds: string[] = [];
      for (const doc of documents) {
        if (!doc.id || doc.id.trim() === "") {
          throw new InvalidParametersError("Document ID cannot be empty", "documents.id");
        }
        if (!doc.content || doc.content.trim() === "") {
          throw new InvalidParametersError(
            `Document content cannot be empty for ID: ${doc.id}`,
            "documents.content"
          );
        }
        if (!doc.embedding || !Array.isArray(doc.embedding) || doc.embedding.length === 0) {
          throw new InvalidParametersError(
            `Document embedding must be a non-empty array for ID: ${doc.id}`,
            "documents.embedding"
          );
        }
        if (!doc.metadata) {
          throw new InvalidParametersError(
            `Document metadata cannot be null for ID: ${doc.id}`,
            "documents.metadata"
          );
        }

        documentIds.push(doc.id);
      }

      // Get or create the collection
      const collection = await this.getOrCreateCollection(collectionName);

      // Prepare data for ChromaDB (same as addDocuments)
      const ids = documents.map((d) => d.id);
      const embeddings = documents.map((d) => d.embedding);
      const chromaDocuments = documents.map((d) => d.content);
      const metadatas = documents.map((d) => d.metadata);

      // Convert metadata to ChromaDB-compatible format (primitives only)
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
            // Convert complex types to strings
            chromaMeta[key] = String(value);
          }
        }
        return chromaMeta;
      });

      // Upsert to ChromaDB with retry for transient failures (idempotent - updates existing, adds new)
      await this.withRetryWrapper(
        () =>
          collection.upsert({
            ids,
            embeddings,
            metadatas: chromaMetadatas,
            documents: chromaDocuments,
          }),
        "ChromaDB upsert documents"
      );

      const durationMs = Date.now() - startTime;

      this.logger.info(
        {
          metric: "chromadb.upsert_documents_ms",
          value: durationMs,
          collection: collectionName,
          documentCount: documents.length,
        },
        `Upserted ${documents.length} documents to collection '${collectionName}'`
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Re-throw our own errors
      if (error instanceof StorageError) {
        this.logger.error(
          {
            metric: "chromadb.upsert_documents_ms",
            value: durationMs,
            collection: collectionName,
            documentCount: documents.length,
            err: error,
          },
          "Upsert failed (validation or operation error)"
        );
        throw error;
      }

      // Wrap ChromaDB errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        {
          metric: "chromadb.upsert_documents_ms",
          value: durationMs,
          collection: collectionName,
          documentCount: documents.length,
          err: error,
        },
        "Upsert failed (ChromaDB error)"
      );

      const documentIds = documents.map((d) => d.id);
      throw new DocumentOperationError(
        "update",
        `Failed to upsert ${documents.length} documents to collection '${collectionName}': ${errorMessage}`,
        documentIds,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete documents by ID from a collection
   *
   * Idempotent operation - deleting non-existent IDs is silently ignored by ChromaDB.
   * Empty ID array is treated as a no-op.
   *
   * @param collectionName - Target collection name
   * @param ids - Array of document IDs to delete
   * @throws {InvalidParametersError} If validation fails
   * @throws {CollectionNotFoundError} If collection doesn't exist
   * @throws {DocumentOperationError} If delete operation fails
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async deleteDocuments(collectionName: string, ids: string[]): Promise<void> {
    this.ensureConnected();

    const startTime = Date.now();

    try {
      // Empty array is a no-op
      if (!ids || ids.length === 0) {
        this.logger.debug(
          {
            collection: collectionName,
          },
          "Delete called with empty ID array, skipping"
        );
        return;
      }

      // Validate each ID
      for (const id of ids) {
        if (!id || id.trim() === "") {
          throw new InvalidParametersError("Document ID cannot be empty", "ids");
        }
      }

      // Use getCollectionIfExists to avoid auto-creating during deletion
      const collection = await this.getCollectionIfExists(collectionName);

      if (!collection) {
        throw new CollectionNotFoundError(collectionName);
      }

      // Delete from ChromaDB with retry for transient failures (idempotent - non-existent IDs are silently ignored)
      await this.withRetryWrapper(() => collection.delete({ ids }), "ChromaDB delete documents");

      const durationMs = Date.now() - startTime;

      this.logger.info(
        {
          metric: "chromadb.delete_documents_ms",
          value: durationMs,
          collection: collectionName,
          documentCount: ids.length,
        },
        `Deleted ${ids.length} documents from collection '${collectionName}'`
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Re-throw our own errors
      if (error instanceof StorageError) {
        this.logger.error(
          {
            metric: "chromadb.delete_documents_ms",
            value: durationMs,
            collection: collectionName,
            documentCount: ids.length,
            err: error,
          },
          "Delete failed (validation or collection not found)"
        );
        throw error;
      }

      // Wrap ChromaDB errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        {
          metric: "chromadb.delete_documents_ms",
          value: durationMs,
          collection: collectionName,
          documentCount: ids.length,
          err: error,
        },
        "Delete failed (ChromaDB error)"
      );

      throw new DocumentOperationError(
        "delete",
        `Failed to delete ${ids.length} documents from collection '${collectionName}': ${errorMessage}`,
        ids,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Query documents by metadata filters
   *
   * Retrieves documents matching the provided metadata filter criteria.
   * Embeddings are not included by default to reduce bandwidth (they're large: 1536 floats).
   *
   * @param collectionName - Target collection name
   * @param where - Metadata filter criteria
   * @param includeEmbeddings - Whether to include embedding vectors (default: false)
   * @returns Array of matching documents
   * @throws {InvalidParametersError} If validation fails
   * @throws {CollectionNotFoundError} If collection doesn't exist
   * @throws {SearchOperationError} If query operation fails
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async getDocumentsByMetadata(
    collectionName: string,
    where: MetadataFilter,
    includeEmbeddings = false
  ): Promise<DocumentQueryResult[]> {
    this.ensureConnected();

    const startTime = Date.now();

    try {
      // Validate where clause
      if (!where || Object.keys(where).length === 0) {
        throw new InvalidParametersError(
          "Where clause cannot be empty - provide at least one filter criterion",
          "where"
        );
      }

      // Use getCollectionIfExists to avoid auto-creating during query
      const collection = await this.getCollectionIfExists(collectionName);

      if (!collection) {
        throw new CollectionNotFoundError(collectionName);
      }

      // Determine what to include in response
      const include: Array<"documents" | "metadatas" | "embeddings"> = ["documents", "metadatas"];
      if (includeEmbeddings) {
        include.push("embeddings");
      }

      // Query ChromaDB with retry for transient failures
      const result = await this.withRetryWrapper(
        () =>
          collection.get({
            where: where as Record<string, unknown>,
            // @ts-expect-error - String literals are compatible with IncludeEnum
            include: include,
          }),
        "ChromaDB get by metadata"
      );

      // Map ChromaDB response to DocumentQueryResult
      const documents: DocumentQueryResult[] = [];

      for (let i = 0; i < result.ids.length; i++) {
        const id = result.ids[i];
        if (!id) continue;

        const doc: DocumentQueryResult = {
          id,
          content: result.documents?.[i] || "",
          metadata: result.metadatas?.[i] as unknown as DocumentMetadata,
        };

        // Add embedding if requested and available
        if (includeEmbeddings && result.embeddings?.[i]) {
          doc.embedding = result.embeddings[i];
        }

        documents.push(doc);
      }

      const durationMs = Date.now() - startTime;

      this.logger.info(
        {
          metric: "chromadb.get_by_metadata_ms",
          value: durationMs,
          collection: collectionName,
          resultCount: documents.length,
          includeEmbeddings,
        },
        `Retrieved ${documents.length} documents from collection '${collectionName}' by metadata filter`
      );

      return documents;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Re-throw our own errors
      if (error instanceof StorageError) {
        this.logger.error(
          {
            metric: "chromadb.get_by_metadata_ms",
            value: durationMs,
            collection: collectionName,
            err: error,
          },
          "Metadata query failed (validation or collection not found)"
        );
        throw error;
      }

      // Wrap ChromaDB errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        {
          metric: "chromadb.get_by_metadata_ms",
          value: durationMs,
          collection: collectionName,
          err: error,
        },
        "Metadata query failed (ChromaDB error)"
      );

      throw new SearchOperationError(
        `Failed to query documents by metadata in collection '${collectionName}': ${errorMessage}`,
        [collectionName],
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Delete all document chunks for a specific file
   *
   * Helper method that queries for all chunks matching the repository and file path,
   * then deletes them. Useful for re-indexing updated files.
   *
   * @param collectionName - Target collection name
   * @param repository - Repository name
   * @param filePath - File path within the repository
   * @returns Number of chunks deleted
   * @throws {CollectionNotFoundError} If collection doesn't exist
   * @throws {SearchOperationError} If query operation fails
   * @throws {DocumentOperationError} If delete operation fails
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async deleteDocumentsByFilePrefix(
    collectionName: string,
    repository: string,
    filePath: string
  ): Promise<number> {
    this.ensureConnected();

    // Query for all chunks matching the file
    // Use $and operator for multiple conditions (ChromaDB requirement)
    const chunks = await this.getDocumentsByMetadata(collectionName, {
      $and: [{ repository }, { file_path: filePath }],
    });

    // If no chunks found, return 0
    if (chunks.length === 0) {
      this.logger.debug(
        {
          collection: collectionName,
          repository,
          filePath,
        },
        "No chunks found for file, skipping deletion"
      );
      return 0;
    }

    // Extract IDs and delete
    const ids = chunks.map((chunk) => chunk.id);
    await this.deleteDocuments(collectionName, ids);

    this.logger.info(
      {
        collection: collectionName,
        repository,
        filePath,
        deletedCount: ids.length,
      },
      `Deleted ${ids.length} chunks for file '${filePath}' in repository '${repository}'`
    );

    return ids.length;
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
  /**
   * Get embedding provider metadata for a collection
   *
   * Retrieves the embedding provider, model, and dimensions that were used
   * when the collection was created. Returns null if the collection doesn't
   * exist or has no embedding metadata.
   *
   * Used by the search service to determine which embedding provider to use
   * for query embedding when searching a specific collection.
   *
   * @param name - Collection name
   * @returns Parsed embedding metadata, or null if not found
   * @throws {StorageConnectionError} If not connected to ChromaDB
   */
  async getCollectionEmbeddingMetadata(name: string): Promise<ParsedEmbeddingMetadata | null> {
    this.ensureConnected();

    try {
      // List all collections to check if the target exists and get its metadata
      // Use retry wrapper for transient network failures
      const collections = await this.withRetryWrapper(
        () => this.client!.listCollectionsAndMetadata(),
        "ChromaDB list collections for metadata"
      );
      const collectionInfo = collections.find((col) => col.name === name);

      if (!collectionInfo) {
        this.logger.debug(
          { collection: name },
          "Collection not found when getting embedding metadata"
        );
        return null;
      }

      const metadata = collectionInfo.metadata as Record<string, unknown> | undefined;
      if (!metadata) {
        this.logger.debug({ collection: name }, "Collection has no metadata");
        return null;
      }

      // Parse the app: prefixed metadata keys
      const result: ParsedEmbeddingMetadata = {};

      if (typeof metadata["app:embedding_provider"] === "string") {
        result.provider = metadata["app:embedding_provider"];
      }
      if (typeof metadata["app:embedding_model"] === "string") {
        result.model = metadata["app:embedding_model"];
      }
      if (typeof metadata["app:embedding_dimensions"] === "number") {
        result.dimensions = metadata["app:embedding_dimensions"];
      }

      // Return null if no embedding metadata was found
      if (!result.provider && !result.model && !result.dimensions) {
        this.logger.debug({ collection: name }, "Collection has no embedding metadata");
        return null;
      }

      this.logger.debug(
        { collection: name, embeddingMetadata: result },
        "Retrieved embedding metadata for collection"
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { collection: name, err: error },
        "Failed to get embedding metadata for collection"
      );
      throw new StorageError(
        `Failed to get embedding metadata for collection '${name}': ${errorMessage}`,
        "COLLECTION_OPERATION_ERROR",
        error instanceof Error ? error : undefined
      );
    }
  }
}
