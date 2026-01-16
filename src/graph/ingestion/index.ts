/**
 * Graph Ingestion Module
 *
 * Exports services, types, and errors for ingesting entities and relationships
 * into the Neo4j knowledge graph.
 *
 * @module graph/ingestion
 */

// Service
export { GraphIngestionService } from "./GraphIngestionService.js";

// Types
export type {
  GraphIngestionConfig,
  GraphIngestionOptions,
  GraphIngestionProgress,
  GraphIngestionResult,
  GraphIngestionStats,
  GraphIngestionError,
  GraphIngestionErrorType,
  GraphIngestionPhase,
  GraphIngestionStatus,
  FileInput,
  FileIngestionResult,
  GraphIngestionServiceStatus,
  BatchCreationResult,
  GraphFileDeletionResult,
} from "./types.js";

export { DEFAULT_GRAPH_INGESTION_CONFIG } from "./types.js";

// Errors
export {
  GraphIngestionError as GraphIngestionErrorClass,
  FileProcessingError,
  IngestionExtractionError,
  NodeCreationError,
  RelationshipCreationError,
  TransactionError,
  IngestionInProgressError,
  RepositoryExistsError,
  isRetryableIngestionError,
  toGraphIngestionError,
} from "./errors.js";
