/**
 * SearchService module exports
 *
 * This module provides a clean public API for semantic search operations.
 */

// Types and interfaces
export type { SearchService, SearchQuery, SearchResult, SearchResponse } from "./types.js";

// Implementation
export { SearchServiceImpl } from "./search-service.js";

// Validation
export { SearchQuerySchema } from "./validation.js";
export type { ValidatedSearchQuery } from "./validation.js";

// Errors
export {
  SearchError,
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
} from "./errors.js";
