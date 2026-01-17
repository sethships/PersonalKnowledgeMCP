/**
 * Type definitions for SearchService
 *
 * This module defines the interfaces for semantic search operations across
 * indexed repositories using vector similarity search.
 */

/**
 * Input parameters for semantic search queries
 */
export interface SearchQuery {
  /** Natural language query text (1-1000 characters) */
  query: string;

  /** Maximum number of results to return (1-50, default: 10) */
  limit?: number;

  /** Minimum similarity threshold (0.0-1.0, default: 0.7) */
  threshold?: number;

  /** Optional repository name filter. If omitted, searches all ready repositories */
  repository?: string;

  /**
   * Optional language filter. If provided, only returns results from files
   * of the specified programming language (e.g., "python", "typescript", "javascript").
   */
  language?: string;
}

/**
 * Individual search result with content and metadata
 */
export interface SearchResult {
  /** Full file path relative to repository root */
  file_path: string;

  /** Repository name */
  repository: string;

  /** Content snippet truncated to ~500 characters at word boundary */
  content_snippet: string;

  /** Similarity score between query and chunk (0.0 = no match, 1.0 = perfect match) */
  similarity_score: number;

  /** Zero-based index of this chunk within the file */
  chunk_index: number;

  /** Additional metadata about the file */
  metadata: {
    file_extension: string;
    file_size_bytes: number;
    indexed_at: string; // ISO 8601 timestamp
    /** Programming language of the source file (derived from extension) */
    language?: string;
  };
}

/**
 * Warning generated during provider-aware search operations
 */
export interface SearchWarning {
  /** Type of warning encountered */
  type: "provider_mismatch" | "dimension_mismatch" | "missing_metadata";

  /** Repository that triggered the warning */
  repository: string;

  /** Human-readable warning message */
  message: string;
}

/**
 * Search response with results and diagnostic metadata
 */
export interface SearchResponse {
  /** Ranked search results sorted by similarity descending */
  results: SearchResult[];

  /** Query execution metadata for performance tracking */
  metadata: {
    /** Total number of results (before any client-side filtering) */
    total_matches: number;

    /** Total end-to-end query time in milliseconds */
    query_time_ms: number;

    /** Time spent generating query embedding in milliseconds */
    embedding_time_ms: number;

    /** Time spent in vector similarity search in milliseconds */
    search_time_ms: number;

    /** List of repository names that were searched */
    repositories_searched: string[];

    /** Warnings generated during search (e.g., provider mismatches) */
    warnings?: SearchWarning[];
  };
}

/**
 * SearchService interface for semantic search operations
 */
export interface SearchService {
  /**
   * Execute a semantic search query across indexed repositories
   *
   * @param query - Search parameters including query text and filters
   * @returns Search results with ranked chunks and performance metadata
   * @throws {SearchValidationError} Invalid query parameters
   * @throws {RepositoryNotFoundError} Specified repository doesn't exist
   * @throws {RepositoryNotReadyError} Specified repository not in 'ready' status
   * @throws {NoRepositoriesAvailableError} No repositories available to search
   * @throws {SearchOperationError} Underlying search operation failed
   */
  search(query: SearchQuery): Promise<SearchResponse>;
}
