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
  ImportInfo,
  ExportInfo,
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

// =============================================================================
// RelationshipExtractor Types
// =============================================================================

/**
 * Configuration options for the RelationshipExtractor.
 *
 * These options control the behavior of relationship extraction.
 */
export interface RelationshipExtractorConfig {
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
 * Default configuration values for RelationshipExtractor.
 */
export const DEFAULT_RELATIONSHIP_EXTRACTOR_CONFIG: Required<RelationshipExtractorConfig> = {
  maxFileSizeBytes: 1048576, // 1MB
  parseTimeoutMs: 5000,
};

/**
 * Options for filtering relationship extraction results.
 *
 * @example
 * ```typescript
 * // Extract only internal (relative) imports
 * const options: RelationshipExtractOptions = {
 *   includeExternalPackages: false,
 *   includeTypeOnlyImports: true
 * };
 * ```
 */
export interface RelationshipExtractOptions {
  /**
   * Include imports from external packages (e.g., 'react', 'lodash').
   * @default true
   */
  includeExternalPackages?: boolean;

  /**
   * Include type-only imports (import type { ... }).
   * @default true
   */
  includeTypeOnlyImports?: boolean;

  /**
   * Include side-effect imports (import './styles.css').
   * @default true
   */
  includeSideEffectImports?: boolean;

  /**
   * Include re-exports (export { ... } from './module').
   * @default true
   */
  includeReExports?: boolean;
}

/**
 * Default options for relationship extraction filtering.
 */
export const DEFAULT_RELATIONSHIP_EXTRACT_OPTIONS: Required<RelationshipExtractOptions> = {
  includeExternalPackages: true,
  includeTypeOnlyImports: true,
  includeSideEffectImports: true,
  includeReExports: true,
};

/**
 * An import relationship extracted from source code.
 *
 * Represents a dependency from one file to another module,
 * including both internal (relative) and external (package) imports.
 *
 * @example
 * ```typescript
 * const relationship: ImportRelationship = {
 *   sourceFile: 'src/services/auth.ts',
 *   targetModule: 'react',
 *   importInfo: { source: 'react', importedNames: ['useState'], ... },
 *   isExternal: true
 * };
 * ```
 */
export interface ImportRelationship {
  /** File path containing the import statement */
  sourceFile: string;

  /** Target module (package name or resolved file path) */
  targetModule: string;

  /** Detailed import information from the parser */
  importInfo: import("../parsing/types.js").ImportInfo;

  /** Whether this imports from an external package */
  isExternal: boolean;

  /** For relative imports, the resolved absolute path (if resolvable) */
  resolvedPath?: string;
}

/**
 * An export relationship extracted from source code.
 *
 * Represents exports from a file, including re-exports from other modules.
 *
 * @example
 * ```typescript
 * const relationship: ExportRelationship = {
 *   sourceFile: 'src/index.ts',
 *   exportInfo: { exportedNames: ['helper'], source: './utils', ... },
 *   isReExport: true,
 *   targetModule: './utils'
 * };
 * ```
 */
export interface ExportRelationship {
  /** File path containing the export statement */
  sourceFile: string;

  /** Detailed export information from the parser */
  exportInfo: import("../parsing/types.js").ExportInfo;

  /** Whether this is a re-export (export { ... } from './module') */
  isReExport: boolean;

  /** For re-exports, the source module being re-exported from */
  targetModule?: string;

  /** For re-exports of relative paths, the resolved absolute path */
  resolvedPath?: string;
}

/**
 * Result of a relationship extraction operation.
 *
 * Contains extracted import and export relationships along with
 * metadata about the extraction process.
 *
 * @example
 * ```typescript
 * const result = await extractor.extractFromContent(content, 'file.ts');
 * console.log(`Found ${result.imports.length} imports and ${result.exports.length} exports`);
 * ```
 */
export interface RelationshipExtractionResult {
  /** Extracted import relationships */
  imports: ImportRelationship[];

  /** Extracted export relationships */
  exports: ExportRelationship[];

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
 * Summary statistics for a batch relationship extraction operation.
 */
export interface BatchRelationshipExtractionSummary {
  /** Total number of files processed */
  totalFiles: number;

  /** Number of files successfully processed */
  successfulFiles: number;

  /** Number of files that failed to process */
  failedFiles: number;

  /** Total number of import relationships extracted */
  totalImports: number;

  /** Total number of export relationships extracted */
  totalExports: number;

  /** Total time for the batch operation in milliseconds */
  totalTimeMs: number;
}
