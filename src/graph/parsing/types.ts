/**
 * Type definitions for AST parsing.
 *
 * Defines types for code entity extraction from parsed syntax trees.
 * These types are used throughout the graph parsing module.
 *
 * @module graph/parsing/types
 */

/**
 * Supported languages for AST parsing.
 *
 * Currently supports TypeScript ecosystem languages.
 * JavaScript is handled by both TypeScript and JavaScript grammars
 * depending on the file extension.
 */
export type SupportedLanguage = "typescript" | "tsx" | "javascript" | "jsx";

/**
 * Types of code entities that can be extracted from source files.
 */
export type EntityType =
  | "function"
  | "class"
  | "interface"
  | "type_alias"
  | "enum"
  | "variable"
  | "method"
  | "property";

/**
 * Information about a function or method parameter.
 */
export interface ParameterInfo {
  /** Parameter name */
  name: string;
  /** TypeScript type annotation, if present */
  type?: string;
  /** Whether the parameter has a default value */
  hasDefault: boolean;
  /** Whether the parameter is optional (has ?) */
  isOptional: boolean;
  /** Whether this is a rest parameter (...args) */
  isRest: boolean;
}

/**
 * Additional metadata for code entities.
 *
 * Contains language-specific information about the entity
 * that may be useful for code intelligence features.
 */
export interface EntityMetadata {
  /** Whether the function/method is async */
  isAsync?: boolean;
  /** Whether the class is abstract */
  isAbstract?: boolean;
  /** Whether the function is a generator */
  isGenerator?: boolean;
  /** Whether the property/method is static */
  isStatic?: boolean;
  /** Function/method parameters */
  parameters?: ParameterInfo[];
  /** Return type annotation, if present */
  returnType?: string;
  /** Parent class (for extends clause) */
  extends?: string;
  /** Implemented interfaces (for implements clause) */
  implements?: string[];
  /** Generic type parameters */
  typeParameters?: string[];
  /** JSDoc comment, if present */
  documentation?: string;
}

/**
 * A code entity extracted from source file AST.
 *
 * Represents a function, class, interface, type alias, enum,
 * variable, method, or property found in the source code.
 *
 * @example
 * ```typescript
 * const entity: CodeEntity = {
 *   type: 'function',
 *   name: 'calculateTotal',
 *   filePath: 'src/utils/math.ts',
 *   lineStart: 10,
 *   lineEnd: 25,
 *   isExported: true,
 *   metadata: {
 *     isAsync: false,
 *     parameters: [
 *       { name: 'items', type: 'Item[]', hasDefault: false, isOptional: false, isRest: false }
 *     ],
 *     returnType: 'number'
 *   }
 * };
 * ```
 */
export interface CodeEntity {
  /** Type of code entity */
  type: EntityType;
  /** Name of the entity (function name, class name, etc.) */
  name: string;
  /** File path relative to repository root */
  filePath: string;
  /** Starting line number (1-based) */
  lineStart: number;
  /** Ending line number (1-based, inclusive) */
  lineEnd: number;
  /** Starting column (0-based), if available */
  columnStart?: number;
  /** Ending column (0-based), if available */
  columnEnd?: number;
  /** Whether the entity is exported (export keyword) */
  isExported: boolean;
  /** Whether this is the default export */
  isDefault?: boolean;
  /** Additional entity-specific metadata */
  metadata?: EntityMetadata;
}

/**
 * Information about an import statement.
 *
 * Captures both the module being imported and what is being imported
 * from it (named imports, default import, namespace import).
 *
 * @example
 * ```typescript
 * // import { foo, bar as baz } from './utils';
 * const importInfo: ImportInfo = {
 *   source: './utils',
 *   isRelative: true,
 *   importedNames: ['foo', 'bar'],
 *   aliases: { 'bar': 'baz' },
 *   isTypeOnly: false,
 *   line: 1
 * };
 * ```
 */
export interface ImportInfo {
  /** Module specifier (e.g., './utils', 'lodash', '@org/package') */
  source: string;
  /** Whether this is a relative import (starts with . or ..) */
  isRelative: boolean;
  /** Names being imported (for named imports) */
  importedNames: string[];
  /** Alias mappings: original name -> alias name */
  aliases?: Record<string, string>;
  /** Default import name, if present */
  defaultImport?: string;
  /** Namespace import name (for import * as foo), if present */
  namespaceImport?: string;
  /** Whether this is a type-only import (import type { ... }) */
  isTypeOnly: boolean;
  /** Whether this is a side-effect import (import './styles.css') */
  isSideEffect: boolean;
  /** Line number where the import appears (1-based) */
  line: number;
}

/**
 * Information about an export statement.
 *
 * Captures what is being exported from a module, including
 * re-exports from other modules.
 */
export interface ExportInfo {
  /** Names being exported */
  exportedNames: string[];
  /** Alias mappings: local name -> exported name */
  aliases?: Record<string, string>;
  /** For re-exports: the source module */
  source?: string;
  /** Whether this is a type-only export */
  isTypeOnly: boolean;
  /** Whether this is 'export *' */
  isNamespaceExport: boolean;
  /** Line number where the export appears (1-based) */
  line: number;
}

/**
 * Information about a function call.
 *
 * Captures details about function/method calls for building
 * CALLS relationships in the knowledge graph.
 *
 * @example
 * ```typescript
 * // await fetchData(url);
 * const callInfo: CallInfo = {
 *   calledName: 'fetchData',
 *   calledExpression: 'fetchData',
 *   isAsync: true,
 *   line: 15,
 *   callerName: 'processRequest'
 * };
 *
 * // obj.method();
 * const methodCall: CallInfo = {
 *   calledName: 'method',
 *   calledExpression: 'obj.method',
 *   isAsync: false,
 *   line: 20,
 *   callerName: 'handleEvent'
 * };
 * ```
 */
export interface CallInfo {
  /** Name of the function/method being called (rightmost identifier) */
  calledName: string;
  /** Full expression for the call target (e.g., "obj.method" for method calls) */
  calledExpression: string;
  /** Whether this call is awaited */
  isAsync: boolean;
  /** Line number where the call appears (1-based) */
  line: number;
  /** Column where the call appears (0-based) */
  column?: number;
  /** Name of the containing function/method (caller context), if available */
  callerName?: string;
}

/**
 * A parsing error that occurred during AST parsing.
 *
 * Tree-sitter is error-tolerant, so parsing can continue
 * even when errors are encountered. This captures those errors.
 */
export interface ParseError {
  /** Error message describing the issue */
  message: string;
  /** Line number where the error occurred (1-based) */
  line?: number;
  /** Column where the error occurred (0-based) */
  column?: number;
  /** Whether parsing can continue despite this error */
  recoverable: boolean;
}

/**
 * Result of parsing a single source file.
 *
 * Contains all extracted entities, imports, exports, calls, and any
 * errors encountered during parsing. Also includes timing
 * information for performance monitoring.
 *
 * @example
 * ```typescript
 * const result = await parser.parseFile(content, 'src/utils.ts');
 * console.log(`Found ${result.entities.length} entities`);
 * console.log(`Parse time: ${result.parseTimeMs}ms`);
 * if (result.errors.length > 0) {
 *   console.warn('Parsing had errors:', result.errors);
 * }
 * ```
 */
export interface ParseResult {
  /** File path that was parsed */
  filePath: string;
  /** Language detected and used for parsing */
  language: SupportedLanguage;
  /** Code entities extracted from the file */
  entities: CodeEntity[];
  /** Import statements found in the file */
  imports: ImportInfo[];
  /** Export statements found in the file */
  exports: ExportInfo[];
  /** Function calls found in the file */
  calls: CallInfo[];
  /** Time taken to parse the file in milliseconds */
  parseTimeMs: number;
  /** Any errors encountered during parsing */
  errors: ParseError[];
  /** Whether the parse was successful (no fatal errors) */
  success: boolean;
}

/**
 * Configuration options for the TreeSitterParser.
 */
export interface ParserConfig {
  /**
   * Whether to extract documentation comments (JSDoc).
   * @default true
   */
  extractDocumentation?: boolean;

  /**
   * Whether to include anonymous functions in entity extraction.
   * @default false
   */
  includeAnonymous?: boolean;

  /**
   * Maximum file size in bytes to parse.
   * Files larger than this will be skipped.
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
 * Default parser configuration values.
 */
export const DEFAULT_PARSER_CONFIG: Required<ParserConfig> = {
  extractDocumentation: true,
  includeAnonymous: false,
  maxFileSizeBytes: 1048576, // 1MB
  parseTimeoutMs: 5000,
};

/**
 * Map of file extensions to supported languages.
 */
export const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
};

/**
 * Check if a file extension is supported for parsing.
 *
 * @param extension - File extension including the dot (e.g., '.ts')
 * @returns true if the extension is supported
 */
export function isSupportedExtension(extension: string): boolean {
  return extension.toLowerCase() in EXTENSION_TO_LANGUAGE;
}

/**
 * Get the language for a file extension.
 *
 * @param extension - File extension including the dot (e.g., '.ts')
 * @returns The supported language, or null if not supported
 */
export function getLanguageFromExtension(extension: string): SupportedLanguage | null {
  return EXTENSION_TO_LANGUAGE[extension.toLowerCase()] ?? null;
}
