/**
 * Type definitions for ChromaDB storage client
 *
 * This module defines the interfaces and types for interacting with ChromaDB vector storage.
 * Based on Phase 1 System Design Document Section 4.2 and 5.1.
 */

import type { Collection } from "chromadb";

/**
 * Configuration for ChromaDB client connection
 */
export interface ChromaConfig {
  /** ChromaDB server host (default: 'localhost') */
  host: string;
  /** ChromaDB server port (default: 8000) */
  port: number;
}

/**
 * Document metadata schema for indexed code chunks
 *
 * This metadata is stored alongside each embedded document chunk in ChromaDB
 * to enable filtering, provenance tracking, and result enrichment.
 *
 * NOTE: Properties use snake_case to match ChromaDB metadata storage requirements.
 * ChromaDB metadata keys are stored as-is and snake_case maintains consistency
 * with Python ecosystem conventions commonly used with vector databases.
 */
export interface DocumentMetadata {
  // File identification
  /** Relative path to the file within the repository (e.g., "src/auth/middleware.ts") */
  file_path: string;
  /** Repository name (e.g., "my-api") */
  repository: string;

  // Chunk information
  /** Zero-based index of this chunk within the file */
  chunk_index: number;
  /** Total number of chunks for this file */
  total_chunks: number;
  /** Starting line number in the original file */
  chunk_start_line: number;
  /** Ending line number in the original file */
  chunk_end_line: number;

  // File metadata
  /** File extension including the dot (e.g., ".ts", ".md") */
  file_extension: string;
  /** File size in bytes */
  file_size_bytes: number;

  // Deduplication
  /** SHA-256 hash of the chunk content for deduplication */
  content_hash: string;

  // Timestamps
  /** ISO 8601 timestamp when the chunk was indexed */
  indexed_at: string;
  /** ISO 8601 timestamp of the file's last modification */
  file_modified_at: string;
}

/**
 * Input document for adding to ChromaDB collection
 *
 * Represents a document with pre-computed embedding vector ready to be stored.
 */
export interface DocumentInput {
  /** Unique document ID in format: {repo}:{file_path}:{chunk_index} */
  id: string;
  /** Text content of the document chunk */
  content: string;
  /** Pre-computed embedding vector (typically 1536 dimensions for OpenAI text-embedding-3-small) */
  embedding: number[];
  /** Document metadata for filtering and provenance */
  metadata: DocumentMetadata;
}

/**
 * Query parameters for similarity search
 *
 * Defines the search criteria including the query embedding, target collections,
 * result limits, and similarity thresholds.
 */
export interface SimilarityQuery {
  /** Query embedding vector to search for similar documents */
  embedding: number[];
  /** Collection names to search across (e.g., ["repo_my-api", "repo_frontend"]) */
  collections: string[];
  /** Maximum number of results to return */
  limit: number;
  /** Minimum similarity score (0-1 scale) - results below this threshold are filtered out */
  threshold: number;
}

/**
 * Result from similarity search operation
 *
 * Contains the matched document with both distance (ChromaDB native) and
 * converted similarity score (0-1 scale for easier interpretation).
 */
export interface SimilarityResult {
  /** Document ID in format: {repo}:{file_path}:{chunk_index} */
  id: string;
  /** Text content of the matched chunk */
  content: string;
  /** Document metadata */
  metadata: DocumentMetadata;
  /** Raw cosine distance from ChromaDB (0 = identical, 2 = opposite) */
  distance: number;
  /** Converted similarity score (0-1 scale, 1 = most similar) */
  similarity: number;
}

/**
 * Information about a ChromaDB collection
 *
 * Returned by listCollections() to provide an overview of all indexed repositories.
 */
export interface CollectionInfo {
  /** Collection name (e.g., "repo_my-api") */
  name: string;
  /** Number of documents in the collection */
  count: number;
  /** Collection metadata (if any) */
  metadata?: Record<string, unknown>;
}

/**
 * Statistics about a specific collection
 *
 * Provides detailed information about a collection for monitoring and debugging.
 */
export interface CollectionStats {
  /** Collection name */
  name: string;
  /** Number of documents in the collection */
  documentCount: number;
  /** ISO 8601 timestamp when stats were retrieved (ChromaDB doesn't track creation time) */
  retrievedAt: string;
}

/**
 * ChromaDB collection type alias
 *
 * Re-export of the chromadb Collection type for convenience.
 */
export type ChromaCollection = Collection;

/**
 * Client interface for interacting with ChromaDB vector storage
 *
 * This is the primary interface for all vector storage operations. It provides
 * methods for connection management, collection operations, document operations,
 * and similarity search.
 *
 * @example
 * ```typescript
 * const client: ChromaStorageClient = new ChromaStorageClientImpl(config);
 * await client.connect();
 *
 * const collection = await client.getOrCreateCollection("repo_my-api");
 * await client.addDocuments("repo_my-api", documents);
 *
 * const results = await client.similaritySearch({
 *   embedding: queryEmbedding,
 *   collections: ["repo_my-api"],
 *   limit: 10,
 *   threshold: 0.7
 * });
 * ```
 */
export interface ChromaStorageClient {
  /**
   * Initialize connection to ChromaDB server
   *
   * Establishes the HTTP client connection to the ChromaDB instance.
   * Must be called before any other operations.
   *
   * @throws {StorageConnectionError} If connection fails
   */
  connect(): Promise<void>;

  /**
   * Check if ChromaDB server is reachable and healthy
   *
   * Pings the ChromaDB /api/v2/heartbeat endpoint to verify connectivity.
   *
   * @returns True if ChromaDB is healthy, false otherwise
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get existing collection or create if it doesn't exist
   *
   * Collections use cosine similarity metric by default.
   * Collection handles are cached in-memory for performance.
   *
   * @param name - Collection name (should follow repo_ convention)
   * @returns ChromaDB collection handle
   * @throws {StorageError} If collection operations fail
   */
  getOrCreateCollection(name: string): Promise<ChromaCollection>;

  /**
   * Delete a collection and all its documents
   *
   * Use this when removing a repository from the index.
   * Also removes the collection from the in-memory cache.
   *
   * @param name - Collection name to delete
   * @throws {StorageError} If deletion fails
   */
  deleteCollection(name: string): Promise<void>;

  /**
   * List all collections with their document counts
   *
   * @returns Array of collection information
   * @throws {StorageError} If listing fails
   */
  listCollections(): Promise<CollectionInfo[]>;

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
   * @throws {StorageError} If document addition fails
   * @throws {CollectionNotFoundError} If collection doesn't exist
   */
  addDocuments(collectionName: string, documents: DocumentInput[]): Promise<void>;

  /**
   * Perform similarity search across one or more collections
   *
   * Searches for documents similar to the query embedding, filters by threshold,
   * and returns results sorted by similarity (descending).
   *
   * Cosine distance is converted to similarity score (0-1) where 1 is most similar.
   *
   * @param query - Search parameters
   * @returns Array of matching documents sorted by similarity (descending)
   * @throws {StorageError} If search fails
   */
  similaritySearch(query: SimilarityQuery): Promise<SimilarityResult[]>;

  /**
   * Get statistics for a specific collection
   *
   * Returns document count and creation timestamp for monitoring.
   *
   * @param name - Collection name
   * @returns Collection statistics
   * @throws {CollectionNotFoundError} If collection doesn't exist
   */
  getCollectionStats(name: string): Promise<CollectionStats>;
}
