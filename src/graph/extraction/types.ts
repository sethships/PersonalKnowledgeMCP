/**
 * Type definitions for entity extraction.
 *
 * Defines types for the EntityExtractor service which provides
 * a focused API for extracting code entities from source files.
 *
 * @module graph/extraction/types
 */

// Re-export core types from parsing module
export type {
  SupportedLanguage,
  EntityType,
  ParameterInfo,
  EntityMetadata,
  CodeEntity,
  ParseError,
} from "../parsing/types.js";

/**
 * Configuration options for the EntityExtractor.
 *
 * These options control the behavior of the extraction process.
 */
export interface EntityExtractorConfig {
  /**
   * Whether to extract documentation comments (JSDoc).
   * @default true
   */
  extractDocumentation?: boolean;

  /**
   * Whether to include anonymous functions in extraction results.
   * @default false
   */
  includeAnonymous?: boolean;

  /**
   * Maximum file size in bytes to process.
   * Files larger than this will throw FileTooLargeError.
   * @default 1048576 (1MB)
   */
  maxFileSizeBytes?: number;

  /**
   * Timeout for parsing a single file in milliseconds.
   * @default 5000
   */
  parseTimeoutMs?: number;
}

/**
 * Default configuration values for EntityExtractor.
 */
export const DEFAULT_EXTRACTOR_CONFIG: Required<EntityExtractorConfig> = {
  extractDocumentation: true,
  includeAnonymous: false,
  maxFileSizeBytes: 1048576, // 1MB
  parseTimeoutMs: 5000,
};

/**
 * Options for filtering extraction results.
 *
 * @example
 * ```typescript
 * // Extract only exported functions
 * const options: ExtractOptions = {
 *   entityTypes: ['function'],
 *   exportedOnly: true
 * };
 * ```
 */
export interface ExtractOptions {
  /**
   * Filter to specific entity types.
   * If not provided, all entity types are included.
   */
  entityTypes?: readonly (
    | "function"
    | "class"
    | "interface"
    | "type_alias"
    | "enum"
    | "variable"
    | "method"
    | "property"
  )[];

  /**
   * If true, only include entities that are exported.
   * @default false
   */
  exportedOnly?: boolean;
}

/**
 * Result of an entity extraction operation.
 *
 * Contains the extracted entities along with metadata about
 * the extraction process.
 *
 * @example
 * ```typescript
 * const result = await extractor.extractFromContent(content, 'file.ts');
 * console.log(`Found ${result.entities.length} entities in ${result.parseTimeMs}ms`);
 * if (result.errors.length > 0) {
 *   console.warn('Extraction had errors:', result.errors);
 * }
 * ```
 */
export interface ExtractionResult {
  /** Extracted code entities */
  entities: import("../parsing/types.js").CodeEntity[];

  /** File path that was processed */
  filePath: string;

  /** Detected language of the file */
  language: import("../parsing/types.js").SupportedLanguage;

  /** Time taken for parsing and extraction in milliseconds */
  parseTimeMs: number;

  /** Any errors encountered during extraction */
  errors: import("../parsing/types.js").ParseError[];

  /** Whether the extraction was successful (no fatal errors) */
  success: boolean;
}

/**
 * Summary statistics for a batch extraction operation.
 */
export interface BatchExtractionSummary {
  /** Total number of files processed */
  totalFiles: number;

  /** Number of files successfully processed */
  successfulFiles: number;

  /** Number of files that failed to process */
  failedFiles: number;

  /** Total number of entities extracted across all files */
  totalEntities: number;

  /** Total time for the batch operation in milliseconds */
  totalTimeMs: number;
}
