/**
 * ChromaDB Storage Module
 *
 * This module provides the public API for ChromaDB vector storage operations.
 * It exports the storage client implementation, types, and error classes.
 *
 * @module storage
 *
 * @example
 * ```typescript
 * import {
 *   ChromaStorageClientImpl,
 *   type ChromaStorageClient,
 *   type DocumentInput,
 *   StorageConnectionError
 * } from './storage';
 *
 * const config = {
 *   host: 'localhost',
 *   port: 8000
 * };
 *
 * const client = new ChromaStorageClientImpl(config);
 * await client.connect();
 * ```
 */

// Export the implementation class
export { ChromaStorageClientImpl } from "./chroma-client.js";

// Export all type interfaces and type aliases
export type {
  ChromaStorageClient,
  ChromaConfig,
  ChromaCollection,
  DocumentInput,
  DocumentMetadata,
  SimilarityQuery,
  SimilarityResult,
  CollectionInfo,
  CollectionStats,
  MetadataFilter,
  DocumentQueryResult,
} from "./types.js";

// Export all error classes
export {
  StorageError,
  StorageConnectionError,
  CollectionNotFoundError,
  InvalidParametersError,
  DocumentOperationError,
  SearchOperationError,
} from "./errors.js";
