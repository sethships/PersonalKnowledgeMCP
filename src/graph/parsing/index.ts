/**
 * AST parsing module for tree-sitter based code analysis.
 *
 * Provides TypeScript/JavaScript AST parsing and entity extraction
 * for knowledge graph population.
 *
 * @module graph/parsing
 *
 * @example
 * ```typescript
 * import { TreeSitterParser, LanguageLoader } from './graph/parsing';
 *
 * // Parse a TypeScript file
 * const parser = new TreeSitterParser();
 * const result = await parser.parseFile(sourceCode, 'src/utils.ts');
 *
 * console.log(`Found ${result.entities.length} entities`);
 * for (const entity of result.entities) {
 *   console.log(`${entity.type}: ${entity.name} at line ${entity.lineStart}`);
 * }
 * ```
 */

// Re-export types
export type {
  SupportedLanguage,
  EntityType,
  ParameterInfo,
  EntityMetadata,
  CodeEntity,
  ImportInfo,
  ExportInfo,
  ParseError,
  ParseResult,
  ParserConfig,
} from "./types.js";

// Re-export type utilities
export {
  DEFAULT_PARSER_CONFIG,
  EXTENSION_TO_LANGUAGE,
  isSupportedExtension,
  getLanguageFromExtension,
} from "./types.js";

// Re-export error classes
export {
  ParsingError,
  LanguageNotSupportedError,
  LanguageLoadError,
  ParserInitializationError,
  ParseTimeoutError,
  FileTooLargeError,
  ExtractionError,
  isRetryableParsingError,
} from "./errors.js";

// Re-export main classes
export { LanguageLoader } from "./LanguageLoader.js";
export { TreeSitterParser } from "./TreeSitterParser.js";
