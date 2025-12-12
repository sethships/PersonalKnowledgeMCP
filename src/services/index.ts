/**
 * Services module exports
 *
 * This module provides a clean public API for search and ingestion operations.
 */

// SearchService exports
export type { SearchService, SearchQuery, SearchResult, SearchResponse } from "./types.js";
export { SearchServiceImpl } from "./search-service.js";
export { SearchQuerySchema } from "./validation.js";
export type { ValidatedSearchQuery } from "./validation.js";
export {
  SearchError,
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
} from "./errors.js";

// IngestionService exports
export { IngestionService } from "./ingestion-service.js";
export type {
  IndexOptions,
  IndexProgress,
  IndexResult,
  IndexError,
  IndexStatus,
  IndexPhase,
  IngestionStatus,
  BatchResult,
} from "./ingestion-types.js";
export {
  IngestionError,
  RepositoryAlreadyExistsError,
  IndexingInProgressError,
  CloneError,
  CollectionCreationError,
} from "./ingestion-errors.js";
