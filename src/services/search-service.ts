/**
 * SearchService implementation for semantic search operations
 *
 * This module provides the core business logic for searching indexed repositories
 * using vector similarity search via ChromaDB.
 */

import { z } from "zod";
import type { Logger } from "pino";
import type { EmbeddingProvider } from "../providers/types.js";
import type { ChromaStorageClient, SimilarityResult } from "../storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";
import type { SearchService, SearchQuery, SearchResponse, SearchResult } from "./types.js";
import { SearchQuerySchema, type ValidatedSearchQuery } from "./validation.js";
import {
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
} from "./errors.js";
import { getComponentLogger } from "../logging/index.js";

/**
 * Implementation of SearchService using ChromaDB for vector similarity search
 */
export class SearchServiceImpl implements SearchService {
  private _logger: Logger | null = null;

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly storageClient: ChromaStorageClient,
    private readonly repositoryService: RepositoryMetadataService
  ) {}

  /**
   * Lazy-initialized logger
   */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:search");
    }
    return this._logger;
  }

  /**
   * Execute semantic search query across indexed repositories
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const startTime = performance.now();

    try {
      // 1. Validate input
      const validated = this.validateQuery(query);

      // 2. Determine target repositories
      const targetRepos = await this.getTargetRepositories(validated.repository);

      if (targetRepos.length === 0) {
        throw new NoRepositoriesAvailableError();
      }

      // 3. Generate query embedding
      const embeddingStart = performance.now();
      const embedding = await this.embeddingProvider.generateEmbedding(validated.query);
      const embeddingTime = performance.now() - embeddingStart;

      this.logger.info("Generated query embedding", {
        query_length: validated.query.length,
        embedding_dim: embedding.length,
        duration_ms: Math.round(embeddingTime),
      });

      // 4. Execute vector similarity search
      const searchStart = performance.now();
      const collections = targetRepos.map((r) => r.collectionName);
      const rawResults = await this.storageClient.similaritySearch({
        embedding,
        collections,
        limit: validated.limit ?? 10,
        threshold: validated.threshold ?? 0.7,
      });
      const searchTime = performance.now() - searchStart;

      this.logger.info("Completed vector search", {
        collections_searched: collections.length,
        raw_results: rawResults.length,
        duration_ms: Math.round(searchTime),
      });

      // 5. Format results
      const results = this.formatResults(rawResults);

      // 6. Assemble response with metadata
      const totalTime = performance.now() - startTime;
      const response: SearchResponse = {
        results,
        metadata: {
          total_matches: results.length,
          query_time_ms: Math.round(totalTime),
          embedding_time_ms: Math.round(embeddingTime),
          search_time_ms: Math.round(searchTime),
          repositories_searched: targetRepos.map((r) => r.name),
        },
      };

      this.logger.info("Search completed successfully", {
        total_results: results.length,
        total_time_ms: response.metadata.query_time_ms,
        repositories: response.metadata.repositories_searched,
      });

      return response;
    } catch (error) {
      const totalTime = performance.now() - startTime;

      // Rethrow known search errors
      if (
        error instanceof SearchValidationError ||
        error instanceof RepositoryNotFoundError ||
        error instanceof RepositoryNotReadyError ||
        error instanceof NoRepositoriesAvailableError ||
        error instanceof SearchOperationError
      ) {
        this.logger.error("Search failed with known error", {
          error_type: error.constructor.name,
          message: error.message,
          retryable: error.retryable,
          duration_ms: Math.round(totalTime),
        });
        throw error;
      }

      // Wrap unknown errors
      this.logger.error("Search failed with unexpected error", {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Math.round(totalTime),
      });

      throw new SearchOperationError(
        "Search operation failed due to unexpected error",
        false, // Unknown errors are not retryable by default
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Validate query parameters using Zod schema
   */
  private validateQuery(query: SearchQuery): ValidatedSearchQuery {
    try {
      return SearchQuerySchema.parse(query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationErrors = error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new SearchValidationError(
          `Invalid search query: ${validationErrors.join("; ")}`,
          validationErrors
        );
      }
      throw error;
    }
  }

  /**
   * Get list of repositories to search based on query filter
   *
   * - If repository specified: Validate it exists and is ready
   * - If no repository specified: Return all repositories with status 'ready'
   */
  private async getTargetRepositories(repositoryFilter?: string): Promise<RepositoryInfo[]> {
    if (repositoryFilter) {
      // Single repository mode
      const repo = await this.repositoryService.getRepository(repositoryFilter);

      if (!repo) {
        throw new RepositoryNotFoundError(repositoryFilter);
      }

      if (repo.status !== "ready") {
        throw new RepositoryNotReadyError(repositoryFilter, repo.status);
      }

      return [repo];
    } else {
      // Multi-repository mode - search all ready repos
      const allRepos = await this.repositoryService.listRepositories();
      const readyRepos = allRepos.filter((r) => r.status === "ready");

      this.logger.debug("Filtered repositories for search", {
        total_repos: allRepos.length,
        ready_repos: readyRepos.length,
        statuses: allRepos.reduce(
          (acc, r) => {
            acc[r.status] = (acc[r.status] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ),
      });

      return readyRepos;
    }
  }

  /**
   * Format raw ChromaDB results into SearchResult objects
   *
   * - Truncate content snippets to ~500 chars at word boundaries
   * - Extract metadata from ChromaDB document metadata
   * - Results are already sorted by similarity descending from ChromaDB
   */
  private formatResults(rawResults: SimilarityResult[]): SearchResult[] {
    return rawResults.map((result) => {
      const metadata = result.metadata || {};

      return {
        file_path: metadata.file_path || "unknown",
        repository: metadata.repository || "unknown",
        content_snippet: this.truncateSnippet(result.content, 500),
        similarity_score: result.similarity,
        chunk_index: metadata.chunk_index ?? 0,
        metadata: {
          file_extension: metadata.file_extension || "",
          file_size_bytes: metadata.file_size_bytes ?? 0,
          indexed_at: metadata.indexed_at || new Date().toISOString(),
        },
      };
    });
  }

  /**
   * Truncate text to approximately maxChars at word boundary
   *
   * Ensures snippets don't cut words mid-character for better readability
   */
  private truncateSnippet(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }

    // Truncate to maxChars and find last word boundary
    const truncated = text.substring(0, maxChars);
    const lastSpace = truncated.lastIndexOf(" ");

    // Only truncate at word boundary if it's reasonably close to max
    if (lastSpace > maxChars - 50) {
      return truncated.substring(0, lastSpace) + "...";
    }

    // No good word boundary found - hard truncate
    return truncated + "...";
  }
}
