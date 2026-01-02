/**
 * Entity extraction module for code analysis.
 *
 * Provides a focused API for extracting code entities (functions, classes,
 * interfaces, etc.) from TypeScript and JavaScript source files.
 *
 * @module graph/extraction
 *
 * @example
 * ```typescript
 * import { EntityExtractor } from './graph/extraction';
 *
 * const extractor = new EntityExtractor();
 *
 * // Extract all entities
 * const result = await extractor.extractFromContent(code, 'file.ts');
 *
 * // Extract specific types
 * const functions = await extractor.extractFunctions(code, 'file.ts');
 * const classes = await extractor.extractClasses(code, 'file.ts');
 * const interfaces = await extractor.extractInterfaces(code, 'file.ts');
 * ```
 */

// Main extractor class
export { EntityExtractor } from "./EntityExtractor.js";

// Types
export type {
  EntityExtractorConfig,
  ExtractOptions,
  ExtractionResult,
  BatchExtractionSummary,
} from "./types.js";

// Re-export core types for convenience
export type {
  SupportedLanguage,
  EntityType,
  ParameterInfo,
  EntityMetadata,
  CodeEntity,
  ParseError,
} from "./types.js";

// Constants
export { DEFAULT_EXTRACTOR_CONFIG } from "./types.js";
