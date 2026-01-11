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

// GitHubClient exports
export type {
  GitHubClient,
  GitHubClientConfig,
  FileChange,
  CommitInfo,
  CommitComparison,
} from "./github-client-types.js";
export { GitHubClientImpl } from "./github-client.js";
export {
  GitHubOwnerSchema,
  GitHubRepoSchema,
  GitRefSchema,
  OwnerRepoSchema,
  GetHeadCommitSchema,
  CompareCommitsSchema,
  GitHubClientConfigSchema,
} from "./github-client-validation.js";
export type {
  ValidatedOwnerRepo,
  ValidatedGetHeadCommit,
  ValidatedCompareCommits,
  ValidatedGitHubClientConfig,
} from "./github-client-validation.js";
export {
  GitHubClientError,
  GitHubAuthenticationError,
  GitHubRateLimitError,
  GitHubNotFoundError,
  GitHubNetworkError,
  GitHubAPIError,
  GitHubValidationError,
  isRetryableGitHubError,
  isRetryableStatusCode,
} from "./github-client-errors.js";

// IncrementalUpdatePipeline exports
export { IncrementalUpdatePipeline } from "./incremental-update-pipeline.js";
export type {
  FileChange as IncrementalFileChange,
  UpdateOptions,
  UpdateStats,
  UpdateResult,
  FileProcessingError,
} from "./incremental-update-types.js";

// IncrementalUpdateCoordinator exports
export { IncrementalUpdateCoordinator } from "./incremental-update-coordinator.js";
export type {
  CoordinatorConfig,
  CoordinatorResult,
  CoordinatorStatus,
  GitHubRepoInfo,
} from "./incremental-update-coordinator-types.js";
export {
  CoordinatorError,
  RepositoryNotFoundError as CoordinatorRepositoryNotFoundError,
  ForcePushDetectedError,
  ChangeThresholdExceededError,
  GitPullError,
  MissingCommitShaError,
  ConcurrentUpdateError,
} from "./incremental-update-coordinator-errors.js";

// Metrics exports
export type { AggregateMetrics, TrendMetrics, RepositoryMetrics } from "./metrics-types.js";
export {
  calculateAggregateMetrics,
  calculateRepositoryMetrics,
  calculateTrendMetrics,
} from "./metrics-calculator.js";

// GraphService exports
export type {
  GraphService,
  DependencyQuery,
  DependencyResult,
  DependentQuery,
  DependentResult,
  PathQuery,
  PathResult,
  ArchitectureQuery,
  ArchitectureResult,
  EntityInfo,
  DependencyItem,
  DependentItem,
  PathNode,
  ArchitectureNode,
  ModuleDependency,
  ArchitectureMetrics,
  ImpactAnalysis,
  QueryMetadata,
  EntityType,
  ExtendedEntityType,
  DetailLevel,
  ArchitectureNodeType,
  EntityReference,
} from "./graph-service-types.js";

export { GraphServiceImpl, DEFAULT_GRAPH_SERVICE_CONFIG } from "./graph-service.js";
export type { GraphServiceConfig } from "./graph-service.js";

export {
  DependencyQuerySchema,
  DependentQuerySchema,
  PathQuerySchema,
  ArchitectureQuerySchema,
  EntityTypeSchema,
  DetailLevelSchema,
  EntityReferenceSchema,
} from "./graph-service-validation.js";
export type {
  ValidatedDependencyQuery,
  ValidatedDependentQuery,
  ValidatedPathQuery,
  ValidatedArchitectureQuery,
  ValidatedEntityReference,
} from "./graph-service-validation.js";

export {
  GraphServiceError,
  GraphServiceValidationError,
  GraphServiceOperationError,
  EntityNotFoundError,
  GraphServiceTimeoutError,
  CacheError,
  RepositoryNotIndexedError,
  NoPathFoundError,
  isGraphServiceError,
  isRetryableServiceError,
} from "./graph-service-errors.js";

export { QueryCache, DEFAULT_CACHE_CONFIG } from "./graph-service-cache.js";
export type { CacheConfig, CacheStats } from "./graph-service-cache.js";
