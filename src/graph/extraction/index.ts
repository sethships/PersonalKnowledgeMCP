/**
 * Extraction module for code analysis.
 *
 * Provides focused APIs for extracting code entities (functions, classes,
 * interfaces, etc.) and relationships (imports, exports) from TypeScript
 * and JavaScript source files.
 *
 * @module graph/extraction
 *
 * @example
 * ```typescript
 * import { EntityExtractor, RelationshipExtractor } from './graph/extraction';
 *
 * // Entity extraction
 * const entityExtractor = new EntityExtractor();
 * const entities = await entityExtractor.extractFromContent(code, 'file.ts');
 * const functions = await entityExtractor.extractFunctions(code, 'file.ts');
 *
 * // Relationship extraction
 * const relationshipExtractor = new RelationshipExtractor();
 * const relationships = await relationshipExtractor.extractFromContent(code, 'file.ts');
 * const imports = await relationshipExtractor.extractImports(code, 'file.ts');
 * ```
 */

// =============================================================================
// Entity Extraction
// =============================================================================

export { EntityExtractor } from "./EntityExtractor.js";

export type {
  EntityExtractorConfig,
  ExtractOptions,
  ExtractionResult,
  BatchExtractionSummary,
} from "./types.js";

export { DEFAULT_EXTRACTOR_CONFIG } from "./types.js";

// =============================================================================
// Relationship Extraction
// =============================================================================

export { RelationshipExtractor } from "./RelationshipExtractor.js";

export type {
  RelationshipExtractorConfig,
  RelationshipExtractOptions,
  ImportRelationship,
  ExportRelationship,
  RelationshipExtractionResult,
  BatchRelationshipExtractionSummary,
} from "./types.js";

export {
  DEFAULT_RELATIONSHIP_EXTRACTOR_CONFIG,
  DEFAULT_RELATIONSHIP_EXTRACT_OPTIONS,
} from "./types.js";

// =============================================================================
// Core Types (re-exported for convenience)
// =============================================================================

export type {
  SupportedLanguage,
  EntityType,
  ParameterInfo,
  EntityMetadata,
  CodeEntity,
  ParseError,
  ImportInfo,
  ExportInfo,
} from "./types.js";
