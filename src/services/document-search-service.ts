/**
 * DocumentSearchService implementation for semantic search across documents
 *
 * This module provides the core business logic for searching indexed documents
 * (PDFs, DOCX, Markdown, TXT) using vector similarity search via ChromaDB.
 * It parallels the SearchServiceImpl for code search but targets document
 * collections with document-specific metadata (page numbers, sections, titles).
 *
 * @module services/document-search-service
 */

import { z } from "zod";
import type { Logger } from "pino";
import type { EmbeddingProvider, EmbeddingProviderConfig } from "../providers/types.js";
import type { ChromaStorageClient, SimilarityResult, MetadataFilter } from "../storage/types.js";
import type { RepositoryMetadataService, RepositoryInfo } from "../repositories/types.js";
import type {
  DocumentSearchService,
  DocumentSearchQuery,
  DocumentSearchResponse,
  DocumentSearchResult,
} from "./document-search-types.js";
import type { DocumentType } from "../documents/types.js";
import {
  SearchValidationError,
  NoRepositoriesAvailableError,
  SearchOperationError,
  DimensionMismatchError,
  ProviderUnavailableError,
} from "./errors.js";
import { getComponentLogger } from "../logging/index.js";

/**
 * Valid document type values for filtering
 */
const VALID_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  "pdf",
  "docx",
  "markdown",
  "txt",
  "all",
]);

/**
 * Zod schema for DocumentSearchQuery validation
 */
const DocumentSearchQuerySchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1, "Query must not be empty")
      .max(1000, "Query must not exceed 1000 characters"),

    document_types: z
      .array(
        z.enum(["pdf", "docx", "markdown", "txt", "all"], {
          message: "document_types must be one of: pdf, docx, markdown, txt, all",
        })
      )
      .optional()
      .default(["all"]),

    folder: z.string().trim().min(1, "Folder name must not be empty").optional(),

    limit: z
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(50, "Limit must not exceed 50")
      .default(10),

    threshold: z
      .number()
      .min(0.0, "Threshold must be at least 0.0")
      .max(1.0, "Threshold must not exceed 1.0")
      .default(0.7),
  })
  .strict();

type ValidatedDocumentSearchQuery = z.infer<typeof DocumentSearchQuerySchema>;

/**
 * Interface for creating embedding providers on-demand
 */
interface EmbeddingProviderFactory {
  createProvider(config: EmbeddingProviderConfig): EmbeddingProvider;
}

/**
 * Implementation of DocumentSearchService using ChromaDB for vector similarity search
 *
 * Searches document collections in ChromaDB, filtering by document type and folder.
 * Document metadata (page numbers, section headings, titles) is extracted from
 * ChromaDB metadata fields populated during document ingestion.
 *
 * @example
 * ```typescript
 * const service = new DocumentSearchServiceImpl(
 *   defaultProvider,
 *   providerFactory,
 *   storageClient,
 *   repositoryService
 * );
 *
 * const response = await service.searchDocuments({
 *   query: "machine learning algorithms",
 *   document_types: ["pdf"],
 *   limit: 10,
 * });
 * ```
 */
export class DocumentSearchServiceImpl implements DocumentSearchService {
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
      this._logger = getComponentLogger("services:document-search");
    }
    return this._logger;
  }

  /**
   * Execute semantic search across indexed documents
   *
   * @param query - Search parameters including query text and filters
   * @returns Search results with ranked document chunks and performance metadata
   */
  async searchDocuments(query: DocumentSearchQuery): Promise<DocumentSearchResponse> {
    const startTime = performance.now();

    try {
      // 1. Validate input
      const validated = this.validateQuery(query);

      // 2. Determine target repositories (document folders are stored as repositories)
      const targetRepos = await this.getTargetRepositories(validated.folder);

      if (targetRepos.length === 0) {
        throw new NoRepositoriesAvailableError();
      }

      // 3. Resolve document type filter
      const documentTypes = this.resolveDocumentTypes(validated.document_types);

      this.logger.info(
        {
          query: validated.query,
          limit: validated.limit,
          threshold: validated.threshold,
          folder: validated.folder,
          document_types: documentTypes,
          target_repos: targetRepos.length,
        },
        "Executing document search"
      );

      // 4. Build metadata filter for ChromaDB
      const whereFilter = this.buildWhereFilter(documentTypes);

      // 5. Generate query embedding using default provider
      const embeddingStart = performance.now();
      const embedding = await this.getQueryEmbedding(validated.query, targetRepos);
      const embeddingTimeMs = performance.now() - embeddingStart;

      // 6. Execute vector similarity search
      const searchStart = performance.now();
      const collections = targetRepos.map((r) => r.collectionName);
      const rawResults = await this.storageClient.similaritySearch({
        embedding,
        collections,
        limit: validated.limit,
        threshold: validated.threshold,
        where: whereFilter,
      });
      const searchTimeMs = performance.now() - searchStart;

      this.logger.debug("Document vector search completed", {
        collections_searched: collections.length,
        raw_results: rawResults.length,
        embedding_ms: Math.round(embeddingTimeMs),
        search_ms: Math.round(searchTimeMs),
      });

      // 7. Format results with document-specific metadata
      const formattedResults = this.formatResults(rawResults);

      // 8. Assemble response
      const totalTime = performance.now() - startTime;
      const response: DocumentSearchResponse = {
        results: formattedResults,
        metadata: {
          totalResults: formattedResults.length,
          queryTimeMs: Math.round(totalTime),
          searchedFolders: targetRepos.map((r) => r.name),
          searchedDocumentTypes: documentTypes.length > 0 ? documentTypes : ["all"],
        },
      };

      this.logger.info("Document search completed successfully", {
        total_results: formattedResults.length,
        total_time_ms: response.metadata.queryTimeMs,
        searched_folders: response.metadata.searchedFolders,
      });

      return response;
    } catch (error) {
      const totalTime = performance.now() - startTime;

      // Rethrow known search errors
      if (
        error instanceof SearchValidationError ||
        error instanceof NoRepositoriesAvailableError ||
        error instanceof SearchOperationError ||
        error instanceof DimensionMismatchError ||
        error instanceof ProviderUnavailableError
      ) {
        this.logger.error("Document search failed with known error", {
          error_type: error.constructor.name,
          message: error.message,
          duration_ms: Math.round(totalTime),
        });
        throw error;
      }

      // Wrap unknown errors
      this.logger.error("Document search failed with unexpected error", {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Math.round(totalTime),
      });

      throw new SearchOperationError(
        "Document search operation failed due to unexpected error",
        false,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Validate query parameters using Zod schema
   */
  private validateQuery(query: DocumentSearchQuery): ValidatedDocumentSearchQuery {
    try {
      return DocumentSearchQuerySchema.parse(query);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationErrors = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        throw new SearchValidationError(
          `Invalid document search query: ${validationErrors.join("; ")}`,
          validationErrors
        );
      }
      throw error;
    }
  }

  /**
   * Get target repositories for document search
   *
   * Document folders are stored as repositories in the metadata service.
   * If folder is specified, filter to that specific repository name.
   */
  private async getTargetRepositories(folderFilter?: string): Promise<RepositoryInfo[]> {
    const allRepos = await this.repositoryService.listRepositories();
    const readyRepos = allRepos.filter((r) => r.status === "ready");

    if (folderFilter) {
      const filtered = readyRepos.filter((r) => r.name === folderFilter);

      this.logger.debug("Filtered repositories for folder", {
        folder: folderFilter,
        total_ready: readyRepos.length,
        matched: filtered.length,
      });

      return filtered;
    }

    this.logger.debug("Using all ready repositories for document search", {
      total_repos: allRepos.length,
      ready_repos: readyRepos.length,
    });

    return readyRepos;
  }

  /**
   * Resolve document type filter
   *
   * If "all" is present in the array, returns empty array (no filter).
   * Otherwise returns the specific document types to filter by.
   */
  private resolveDocumentTypes(types: (DocumentType | "all")[]): string[] {
    if (types.includes("all")) {
      return [];
    }
    return types.filter((t) => t !== "all" && VALID_DOCUMENT_TYPES.has(t));
  }

  /**
   * Build ChromaDB where filter for document type filtering
   *
   * @param documentTypes - Specific document types to filter by (empty = no filter)
   * @returns MetadataFilter for ChromaDB query, or undefined if no filtering needed
   */
  private buildWhereFilter(documentTypes: string[]): MetadataFilter | undefined {
    if (documentTypes.length === 0) {
      return undefined;
    }

    if (documentTypes.length === 1) {
      return { document_type: documentTypes[0] };
    }

    // Multiple document types: use $or
    return {
      $or: documentTypes.map((dt) => ({ document_type: dt })),
    };
  }

  /**
   * Generate query embedding using appropriate provider
   *
   * Uses the first target repository's embedding provider if configured,
   * otherwise falls back to the default provider. When searching across
   * multiple folders with different embedding providers, only the first
   * repository's provider is used, which may produce inconsistent
   * similarity scores across folders with different providers.
   */
  private async getQueryEmbedding(
    queryText: string,
    targetRepos: RepositoryInfo[]
  ): Promise<number[]> {
    try {
      // Warn if target repos use different embedding providers
      const providers = new Set(targetRepos.map((r) => r.embeddingProvider ?? "default"));
      if (providers.size > 1) {
        this.logger.warn(
          { providers: [...providers] },
          "Multiple embedding providers detected across target folders. " +
            "Results may have inconsistent similarity scores."
        );
      }

      // Use the repository's embedding provider if available, otherwise default
      const repo = targetRepos[0];
      const provider = this.getProviderForRepository(repo);

      const embedding = await provider.generateEmbedding(queryText);

      this.logger.debug("Generated query embedding for document search", {
        provider: provider.providerId,
        model: provider.modelId,
        embedding_dim: embedding.length,
      });

      return embedding;
    } catch (error) {
      if (error instanceof DimensionMismatchError || error instanceof ProviderUnavailableError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SearchOperationError(
        `Failed to generate query embedding: ${message}`,
        true,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get or create the embedding provider for a repository
   */
  private getProviderForRepository(repo?: RepositoryInfo): EmbeddingProvider {
    if (!repo?.embeddingProvider) {
      return this.defaultEmbeddingProvider;
    }

    const cacheKey = `${repo.embeddingProvider}:${repo.embeddingModel}:${repo.embeddingDimensions}`;
    const cached = this.providerCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Check if it matches default
    if (
      repo.embeddingProvider === this.defaultEmbeddingProvider.providerId &&
      repo.embeddingModel === this.defaultEmbeddingProvider.modelId
    ) {
      this.providerCache.set(cacheKey, this.defaultEmbeddingProvider);
      return this.defaultEmbeddingProvider;
    }

    // Create new provider
    try {
      const config: EmbeddingProviderConfig = {
        provider: repo.embeddingProvider,
        model: repo.embeddingModel ?? this.defaultEmbeddingProvider.modelId,
        dimensions: repo.embeddingDimensions ?? this.defaultEmbeddingProvider.dimensions,
        batchSize: 100,
        maxRetries: 3,
        timeoutMs: 30000,
      };

      const provider = this.embeddingProviderFactory.createProvider(config);
      this.providerCache.set(cacheKey, provider);
      return provider;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderUnavailableError(repo.embeddingProvider, message);
    }
  }

  /**
   * Format raw ChromaDB results into DocumentSearchResult objects
   *
   * Extracts document-specific metadata (page number, section heading, title)
   * from ChromaDB document metadata fields populated during ingestion.
   * Document metadata fields (document_type, page_number, section_heading,
   * document_title) are stored as additional ChromaDB metadata during document
   * ingestion and are not part of the base DocumentMetadata type.
   */
  private formatResults(rawResults: SimilarityResult[]): DocumentSearchResult[] {
    return rawResults.map((result) => {
      // Cast to Record via unknown to access document-specific metadata fields
      // that are stored in ChromaDB but not in the base DocumentMetadata type
      const meta = (result.metadata as unknown as Record<string, unknown>) ?? {};

      return {
        content: result.content,
        documentPath: typeof meta["file_path"] === "string" ? meta["file_path"] : "unknown",
        documentTitle:
          typeof meta["document_title"] === "string" ? meta["document_title"] : undefined,
        documentType: typeof meta["document_type"] === "string" ? meta["document_type"] : "unknown",
        pageNumber: typeof meta["page_number"] === "number" ? meta["page_number"] : undefined,
        sectionHeading:
          typeof meta["section_heading"] === "string" ? meta["section_heading"] : undefined,
        similarity: result.similarity,
        folder: typeof meta["repository"] === "string" ? meta["repository"] : "unknown",
      };
    });
  }
}
