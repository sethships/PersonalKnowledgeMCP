/**
 * SearchService implementation for semantic search operations
 *
 * This module provides the core business logic for searching indexed repositories
 * using vector similarity search via ChromaDB. It supports multi-provider search
 * where repositories indexed with different embedding providers are searched
 * using their respective providers for accurate similarity matching.
 */

import { z } from "zod";
import type { Logger } from "pino";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../providers/types.js";
import type { ChromaStorageClient, SimilarityResult } from "../storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";
import type {
  SearchService,
  SearchQuery,
  SearchResponse,
  SearchResult,
  SearchWarning,
} from "./types.js";
import { SearchQuerySchema, type ValidatedSearchQuery } from "./validation.js";
import {
  SearchValidationError,
  RepositoryNotFoundError,
  RepositoryNotReadyError,
  NoRepositoriesAvailableError,
  SearchOperationError,
  DimensionMismatchError,
  ProviderUnavailableError,
} from "./errors.js";
import { getComponentLogger } from "../logging/index.js";

/**
 * Map of language names to their file extensions.
 * Used for language filtering in semantic search.
 */
const LANGUAGE_TO_EXTENSIONS: Record<string, string[]> = {
  python: [".py", ".pyw", ".pyi"],
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  java: [".java"],
  csharp: [".cs"],
  go: [".go"],
  rust: [".rs"],
  ruby: [".rb"],
  php: [".php"],
  swift: [".swift"],
  kotlin: [".kt", ".kts"],
  scala: [".scala"],
  c: [".c", ".h"],
  cpp: [".cpp", ".hpp", ".cc", ".hh", ".cxx", ".hxx"],
  markdown: [".md", ".mdx"],
  json: [".json"],
  yaml: [".yaml", ".yml"],
  html: [".html", ".htm"],
  css: [".css", ".scss", ".sass", ".less"],
};

/**
 * Interface for creating embedding providers on-demand
 * Used for multi-provider search to create providers dynamically
 */
interface EmbeddingProviderFactory {
  createProvider(config: EmbeddingProviderConfig): EmbeddingProvider;
}

/**
 * Group of repositories that share the same embedding provider
 */
interface ProviderGroup {
  /** Provider identifier (e.g., "openai", "transformersjs") */
  providerId: string;

  /** Embedding model ID */
  modelId: string;

  /** Expected embedding dimensions */
  dimensions: number;

  /** Repositories in this group */
  repositories: RepositoryInfo[];
}

/**
 * Search results from a single provider group
 */
interface ProviderSearchResult {
  /** Provider group that produced these results */
  group: ProviderGroup;

  /** Raw similarity results */
  results: SimilarityResult[];

  /** Time spent generating embedding in ms */
  embeddingTimeMs: number;

  /** Time spent in vector search in ms */
  searchTimeMs: number;
}

/**
 * Implementation of SearchService using ChromaDB for vector similarity search
 *
 * This implementation supports multi-provider search, where repositories indexed
 * with different embedding providers (e.g., OpenAI, Transformers.js, Ollama)
 * are queried using their respective providers for accurate similarity matching.
 *
 * @example
 * ```typescript
 * const searchService = new SearchServiceImpl(
 *   defaultProvider,
 *   embeddingProviderFactory,
 *   storageClient,
 *   repositoryService
 * );
 *
 * const response = await searchService.search({
 *   query: "authentication middleware",
 *   limit: 10,
 *   threshold: 0.7,
 * });
 * ```
 */
export class SearchServiceImpl implements SearchService {
  /**
   * Maximum distance (in chars) from maxChars to search for word boundary
   * when truncating snippets. If no word boundary found within this range,
   * will hard truncate at maxChars.
   */
  private static readonly WORD_BOUNDARY_TOLERANCE = 50;

  private _logger: Logger | null = null;

  /**
   * Cache of created providers to avoid recreating for same provider/model combo
   * Key format: "{providerId}:{modelId}:{dimensions}"
   */
  private readonly providerCache = new Map<string, EmbeddingProvider>();

  constructor(
    private readonly defaultEmbeddingProvider: EmbeddingProvider,
    private readonly embeddingProviderFactory: EmbeddingProviderFactory,
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
   *
   * For multi-provider search:
   * 1. Groups repositories by their embedding provider
   * 2. Generates query embeddings with each provider
   * 3. Searches each group's collections
   * 4. Merges and sorts results by similarity
   *
   * @param query - Search parameters including query text and filters
   * @returns Search results with ranked chunks and performance metadata
   */
  async search(query: SearchQuery): Promise<SearchResponse> {
    const startTime = performance.now();
    const warnings: SearchWarning[] = [];

    try {
      // 1. Validate input
      const validated = this.validateQuery(query);

      // 2. Determine target repositories
      const targetRepos = await this.getTargetRepositories(validated.repository);

      if (targetRepos.length === 0) {
        throw new NoRepositoriesAvailableError();
      }

      // 3. Group repositories by embedding provider
      const providerGroups = this.groupRepositoriesByProvider(targetRepos, warnings);

      this.logger.info("Grouped repositories by provider", {
        total_repos: targetRepos.length,
        provider_groups: providerGroups.length,
        groups: providerGroups.map((g) => ({
          provider: g.providerId,
          model: g.modelId,
          dimensions: g.dimensions,
          repo_count: g.repositories.length,
        })),
      });

      // 4. Search each provider group
      const allResults: ProviderSearchResult[] = [];
      let totalEmbeddingTime = 0;
      let totalSearchTime = 0;

      for (const group of providerGroups) {
        const result = await this.searchProviderGroup(
          group,
          validated.query,
          validated.limit ?? 10,
          validated.threshold ?? 0.7,
          warnings,
          validated.language
        );

        if (result) {
          allResults.push(result);
          totalEmbeddingTime += result.embeddingTimeMs;
          totalSearchTime += result.searchTimeMs;
        }
      }

      // 5. Merge and sort results from all providers
      // Request more results than needed if language filtering will reduce the set
      const requestedLimit = validated.limit ?? 10;
      const fetchLimit = validated.language ? Math.min(requestedLimit * 3, 50) : requestedLimit; // Fetch more if filtering
      let mergedResults = this.mergeResults(allResults, fetchLimit);

      // 5.5 Apply language filter if specified
      if (validated.language) {
        mergedResults = this.filterByLanguage(mergedResults, validated.language);
        // Re-apply limit after filtering
        mergedResults = mergedResults.slice(0, requestedLimit);
      }

      // 6. Format results
      const formattedResults = this.formatResults(mergedResults, validated.language);

      // 7. Assemble response with metadata
      const totalTime = performance.now() - startTime;
      const response: SearchResponse = {
        results: formattedResults,
        metadata: {
          total_matches: formattedResults.length,
          query_time_ms: Math.round(totalTime),
          embedding_time_ms: Math.round(totalEmbeddingTime),
          search_time_ms: Math.round(totalSearchTime),
          repositories_searched: targetRepos.map((r) => r.name),
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };

      this.logger.info("Search completed successfully", {
        total_results: formattedResults.length,
        total_time_ms: response.metadata.query_time_ms,
        provider_groups_searched: providerGroups.length,
        warnings_count: warnings.length,
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
        error instanceof SearchOperationError ||
        error instanceof DimensionMismatchError ||
        error instanceof ProviderUnavailableError
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
        const validationErrors = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
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
   * Group repositories by their embedding provider
   *
   * Repositories are grouped by provider ID, model ID, and dimensions.
   * Repositories without embedding provider metadata use the default provider.
   *
   * @param repos - Repositories to group
   * @param warnings - Array to collect warnings about missing metadata
   * @returns Array of provider groups
   */
  private groupRepositoriesByProvider(
    repos: RepositoryInfo[],
    warnings: SearchWarning[]
  ): ProviderGroup[] {
    const groups = new Map<string, ProviderGroup>();

    for (const repo of repos) {
      // Use repository's embedding provider or fall back to default
      const providerId = repo.embeddingProvider ?? this.defaultEmbeddingProvider.providerId;
      const modelId = repo.embeddingModel ?? this.defaultEmbeddingProvider.modelId;
      const dimensions = repo.embeddingDimensions ?? this.defaultEmbeddingProvider.dimensions;

      // Generate warning if using default provider due to missing metadata
      if (!repo.embeddingProvider) {
        warnings.push({
          type: "missing_metadata",
          repository: repo.name,
          message: `Repository '${repo.name}' has no embedding provider metadata. Using default provider '${providerId}'.`,
        });
      }

      // Group key includes provider, model, and dimensions for uniqueness
      const groupKey = `${providerId}:${modelId}:${dimensions}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          providerId,
          modelId,
          dimensions,
          repositories: [],
        });
      }

      groups.get(groupKey)!.repositories.push(repo);
    }

    return Array.from(groups.values());
  }

  /**
   * Get or create an embedding provider for a provider group
   *
   * Uses caching to avoid creating duplicate providers for the same
   * provider/model/dimensions combination.
   *
   * @param group - Provider group to get provider for
   * @returns Embedding provider instance
   * @throws {ProviderUnavailableError} If provider cannot be created
   */
  private getOrCreateProvider(group: ProviderGroup): EmbeddingProvider {
    const cacheKey = `${group.providerId}:${group.modelId}:${group.dimensions}`;

    // Check cache first
    const cached = this.providerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Check if this matches the default provider
    if (
      group.providerId === this.defaultEmbeddingProvider.providerId &&
      group.modelId === this.defaultEmbeddingProvider.modelId &&
      group.dimensions === this.defaultEmbeddingProvider.dimensions
    ) {
      this.providerCache.set(cacheKey, this.defaultEmbeddingProvider);
      return this.defaultEmbeddingProvider;
    }

    // Create new provider via factory
    try {
      const config: EmbeddingProviderConfig = {
        provider: group.providerId,
        model: group.modelId,
        dimensions: group.dimensions,
        batchSize: 100, // Default batch size
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = this.embeddingProviderFactory.createProvider(config);
      this.providerCache.set(cacheKey, provider);

      this.logger.debug("Created new embedding provider", {
        provider: group.providerId,
        model: group.modelId,
        dimensions: group.dimensions,
      });

      return provider;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderUnavailableError(group.providerId, message);
    }
  }

  /**
   * Search a single provider group
   *
   * Generates query embedding with the group's provider and searches
   * all repositories in the group.
   *
   * @param group - Provider group to search
   * @param queryText - Query text to embed
   * @param limit - Maximum results per search
   * @param threshold - Minimum similarity threshold
   * @param warnings - Array to collect warnings
   * @param language - Optional language filter
   * @returns Search results or null if provider unavailable
   */
  private async searchProviderGroup(
    group: ProviderGroup,
    queryText: string,
    limit: number,
    threshold: number,
    warnings: SearchWarning[],
    language?: string
  ): Promise<ProviderSearchResult | null> {
    try {
      // Get or create provider for this group
      const provider = this.getOrCreateProvider(group);

      // Generate query embedding
      const embeddingStart = performance.now();
      const embedding = await provider.generateEmbedding(queryText);
      const embeddingTime = performance.now() - embeddingStart;

      // Validate embedding dimensions
      if (embedding.length !== group.dimensions) {
        throw new DimensionMismatchError(
          group.repositories.map((r) => r.name).join(", "),
          group.dimensions,
          embedding.length
        );
      }

      this.logger.debug("Generated query embedding for provider group", {
        provider: group.providerId,
        model: group.modelId,
        embedding_dim: embedding.length,
        duration_ms: Math.round(embeddingTime),
        repo_count: group.repositories.length,
      });

      // Execute vector similarity search
      const searchStart = performance.now();
      const collections = group.repositories.map((r) => r.collectionName);
      const where = language ? { language } : undefined;
      const results = await this.storageClient.similaritySearch({
        embedding,
        collections,
        limit,
        threshold,
        where,
      });
      const searchTime = performance.now() - searchStart;

      this.logger.debug("Completed vector search for provider group", {
        provider: group.providerId,
        collections_searched: collections.length,
        raw_results: results.length,
        duration_ms: Math.round(searchTime),
      });

      return {
        group,
        results,
        embeddingTimeMs: embeddingTime,
        searchTimeMs: searchTime,
      };
    } catch (error) {
      // If it's a dimension mismatch or provider unavailable, rethrow
      if (error instanceof DimensionMismatchError || error instanceof ProviderUnavailableError) {
        throw error;
      }

      // For other errors, log warning and continue with other groups
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("Failed to search provider group", {
        provider: group.providerId,
        error: message,
      });

      // Add warning for each repository in the failed group
      for (const repo of group.repositories) {
        warnings.push({
          type: "provider_mismatch",
          repository: repo.name,
          message: `Failed to search repository '${repo.name}' with provider '${group.providerId}': ${message}`,
        });
      }

      return null;
    }
  }

  /**
   * Merge and sort results from multiple provider groups
   *
   * Combines results from all provider groups and sorts by similarity
   * score in descending order, then limits to the requested number.
   *
   * @param providerResults - Results from each provider group
   * @param limit - Maximum results to return
   * @returns Merged and sorted similarity results
   */
  private mergeResults(providerResults: ProviderSearchResult[], limit: number): SimilarityResult[] {
    // Flatten all results
    const allResults: SimilarityResult[] = [];
    for (const pr of providerResults) {
      allResults.push(...pr.results);
    }

    // Sort by similarity descending
    allResults.sort((a, b) => b.similarity - a.similarity);

    // Limit results
    return allResults.slice(0, limit);
  }

  /**
   * Filter results by programming language
   *
   * Filters the similarity results to only include files of the specified language.
   * Language is determined by file extension.
   *
   * @param results - Raw similarity results to filter
   * @param language - Language to filter by (e.g., "python", "typescript")
   * @returns Filtered results
   */
  private filterByLanguage(results: SimilarityResult[], language: string): SimilarityResult[] {
    const normalizedLanguage = language.toLowerCase();
    const extensions = LANGUAGE_TO_EXTENSIONS[normalizedLanguage];

    if (!extensions) {
      this.logger.warn({ language }, "Unknown language for filtering, returning all results");
      return results;
    }

    return results.filter((result) => {
      const fileExtension = result.metadata?.file_extension ?? "";
      return extensions.includes(fileExtension.toLowerCase());
    });
  }

  /**
   * Derive language from file extension
   *
   * @param extension - File extension (e.g., ".py", ".ts")
   * @returns Language name or undefined if unknown
   */
  private deriveLanguageFromExtension(extension: string): string | undefined {
    const normalizedExt = extension.toLowerCase();
    for (const [language, extensions] of Object.entries(LANGUAGE_TO_EXTENSIONS)) {
      if (extensions.includes(normalizedExt)) {
        return language;
      }
    }
    return undefined;
  }

  /**
   * Format raw ChromaDB results into SearchResult objects
   *
   * - Truncate content snippets to ~500 chars at word boundaries
   * - Extract metadata from ChromaDB document metadata
   * - Results are already sorted by similarity descending from ChromaDB
   * - Optionally derive language from file extension
   */
  private formatResults(rawResults: SimilarityResult[], language?: string): SearchResult[] {
    return rawResults.map((result) => {
      const metadata = result.metadata ?? {};
      const fileExtension = metadata.file_extension ?? "";

      // Derive language from extension if not already provided in filter
      const derivedLanguage = language ?? this.deriveLanguageFromExtension(fileExtension);

      return {
        file_path: metadata.file_path ?? "unknown",
        repository: metadata.repository ?? "unknown",
        content_snippet: this.truncateSnippet(result.content, 500),
        similarity_score: result.similarity,
        chunk_index: metadata.chunk_index ?? 0,
        metadata: {
          file_extension: fileExtension,
          file_size_bytes: metadata.file_size_bytes ?? 0,
          indexed_at: metadata.indexed_at ?? new Date().toISOString(),
          language: derivedLanguage,
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
    if (lastSpace > maxChars - SearchServiceImpl.WORD_BOUNDARY_TOLERANCE) {
      return truncated.substring(0, lastSpace) + "...";
    }

    // No good word boundary found - hard truncate
    return truncated + "...";
  }
}
