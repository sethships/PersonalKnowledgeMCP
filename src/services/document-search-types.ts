/**
 * Type definitions for DocumentSearchService
 *
 * This module defines the interfaces for semantic search operations across
 * indexed documents (PDFs, DOCX, Markdown, TXT) using vector similarity search.
 * This is the document counterpart to the code-focused SearchService.
 *
 * @module services/document-search-types
 */

import type { DocumentType } from "../documents/types.js";
import type { SearchWarning } from "./types.js";

/**
 * Input parameters for document search queries
 */
export interface DocumentSearchQuery {
  /** Natural language query text (1-1000 characters) */
  query: string;

  /** Document types to filter by. If omitted or includes "all", searches all types */
  document_types?: (DocumentType | "all")[];

  /** Folder name to limit search scope. If omitted, searches all folders */
  folder?: string;

  /** Maximum number of results to return (1-50, default: 10) */
  limit?: number;

  /** Minimum similarity threshold (0.0-1.0, default: 0.7) */
  threshold?: number;

  /**
   * Table content filtering mode:
   * - "include" (default): search both tables and text (no filter)
   * - "only": search only table chunks
   * - "exclude": exclude table chunks
   */
  include_tables?: "include" | "only" | "exclude";
}

/**
 * Individual document search result with content and metadata
 */
export interface DocumentSearchResult {
  /** Matched text passage */
  content: string;

  /** Relative path to the document within the source folder */
  documentPath: string;

  /** Document title from extraction metadata */
  documentTitle?: string;

  /** Type of the document (pdf, docx, markdown, txt) */
  documentType: string;

  /** Page number for multi-page documents (1-based) */
  pageNumber?: number;

  /** Nearest section heading for structural context */
  sectionHeading?: string;

  /** Similarity score between query and chunk (0.0-1.0) */
  similarity: number;

  /** Source folder name */
  folder: string;

  /** Whether this result is a table chunk */
  isTable?: boolean;

  /** Table caption if this is a table chunk */
  tableCaption?: string;

  /** Number of columns in the table */
  tableColumnCount?: number;

  /** Number of rows in the table */
  tableRowCount?: number;
}

/**
 * Document search response with results and diagnostic metadata
 */
export interface DocumentSearchResponse {
  /** Ranked search results sorted by similarity descending */
  results: DocumentSearchResult[];

  /** Query execution metadata for performance tracking */
  metadata: {
    /** Total number of results returned */
    totalResults: number;

    /** Total end-to-end query time in milliseconds */
    queryTimeMs: number;

    /** List of folder names that were searched */
    searchedFolders: string[];

    /** List of document types that were searched */
    searchedDocumentTypes: string[];

    /** Warnings generated during search (e.g., partial index) */
    warnings?: SearchWarning[];
  };
}

/**
 * DocumentSearchService interface for document semantic search operations
 */
export interface DocumentSearchService {
  /**
   * Execute a semantic search query across indexed documents
   *
   * @param query - Search parameters including query text and filters
   * @returns Search results with ranked document chunks and performance metadata
   * @throws {SearchValidationError} Invalid query parameters
   * @throws {NoRepositoriesAvailableError} No document folders available to search
   * @throws {SearchOperationError} Underlying search operation failed
   */
  searchDocuments(query: DocumentSearchQuery): Promise<DocumentSearchResponse>;
}
