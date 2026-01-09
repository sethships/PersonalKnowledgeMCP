/**
 * Relationship extractor for code analysis.
 *
 * Provides a focused API for extracting import and export relationships
 * from TypeScript and JavaScript source files using tree-sitter AST parsing.
 *
 * This class serves as the bridge between the low-level TreeSitterParser
 * and the knowledge graph storage layer, providing filtering and
 * convenience methods for relationship extraction.
 *
 * @module graph/extraction/RelationshipExtractor
 *
 * @example
 * ```typescript
 * import { RelationshipExtractor } from './graph/extraction';
 *
 * const extractor = new RelationshipExtractor();
 *
 * // Extract all relationships from content
 * const result = await extractor.extractFromContent(sourceCode, 'file.ts');
 *
 * // Extract only internal imports (exclude external packages)
 * const internalOnly = await extractor.extractFromContent(
 *   sourceCode,
 *   'file.ts',
 *   { includeExternalPackages: false }
 * );
 *
 * // Extract just imports
 * const imports = await extractor.extractImports(sourceCode, 'file.ts');
 * ```
 */

import path from "node:path";
import type pino from "pino";
import { getComponentLogger } from "../../logging/index.js";
import { TreeSitterParser } from "../parsing/TreeSitterParser.js";
import type { LanguageLoader } from "../parsing/LanguageLoader.js";
import type { SupportedLanguage, ImportInfo, ExportInfo } from "../parsing/types.js";
import type {
  RelationshipExtractorConfig,
  RelationshipExtractOptions,
  ImportRelationship,
  ExportRelationship,
  RelationshipExtractionResult,
  BatchRelationshipExtractionSummary,
} from "./types.js";
import {
  DEFAULT_RELATIONSHIP_EXTRACTOR_CONFIG,
  DEFAULT_RELATIONSHIP_EXTRACT_OPTIONS,
} from "./types.js";

/**
 * Relationship extractor for code analysis.
 *
 * Wraps TreeSitterParser to provide a focused API for extracting
 * import and export relationships from source files with filtering
 * and batch processing capabilities.
 */
export class RelationshipExtractor {
  private readonly parser: TreeSitterParser;
  private readonly config: Required<RelationshipExtractorConfig>;
  private _logger: pino.Logger | null = null;

  /**
   * Create a new RelationshipExtractor instance.
   *
   * @param config - Optional configuration options
   * @param languageLoader - Optional custom language loader for testing
   */
  constructor(config?: RelationshipExtractorConfig, languageLoader?: LanguageLoader) {
    this.config = {
      ...DEFAULT_RELATIONSHIP_EXTRACTOR_CONFIG,
      ...config,
    };

    this.parser = new TreeSitterParser(languageLoader, {
      extractDocumentation: false, // Not needed for relationships
      includeAnonymous: false,
      maxFileSizeBytes: this.config.maxFileSizeBytes,
      parseTimeoutMs: this.config.parseTimeoutMs,
    });
  }

  /**
   * Get the component logger (lazy initialization).
   */
  private get logger(): pino.Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("graph:extraction:relationships");
    }
    return this._logger;
  }

  /**
   * Check if a file extension is supported for extraction.
   *
   * @param filePath - File path to check (uses extension)
   * @returns true if the file type is supported
   */
  static isSupported(filePath: string): boolean {
    const lastDot = filePath.lastIndexOf(".");
    // Files without extensions or starting with dot (hidden files) are not supported
    if (lastDot === -1 || lastDot === 0) return false;
    const extension = filePath.substring(lastDot).toLowerCase();
    return TreeSitterParser.isSupported(extension);
  }

  /**
   * Extract relationships from source code content.
   *
   * @param content - Source code content to parse
   * @param filePath - File path (used for extension detection and in results)
   * @param options - Optional filtering options
   * @returns Extraction result with relationships and metadata
   * @throws {LanguageNotSupportedError} If file extension is not supported
   * @throws {FileTooLargeError} If file exceeds max size
   * @throws {ParseTimeoutError} If parsing exceeds timeout
   */
  async extractFromContent(
    content: string,
    filePath: string,
    options?: RelationshipExtractOptions
  ): Promise<RelationshipExtractionResult> {
    const startTime = performance.now();
    const mergedOptions = { ...DEFAULT_RELATIONSHIP_EXTRACT_OPTIONS, ...options };

    this.logger.debug(
      { filePath, options: mergedOptions },
      "Extracting relationships from content"
    );

    const parseResult = await this.parser.parseFile(content, filePath);

    // Transform imports to ImportRelationship objects
    let imports = this.transformImports(parseResult.imports, filePath);

    // Transform exports to ExportRelationship objects
    let exports = this.transformExports(parseResult.exports, filePath);

    // Apply filtering
    imports = this.filterImports(imports, mergedOptions);
    exports = this.filterExports(exports, mergedOptions);

    const result: RelationshipExtractionResult = {
      imports,
      exports,
      filePath: parseResult.filePath,
      language: parseResult.language,
      parseTimeMs: parseResult.parseTimeMs,
      errors: parseResult.errors,
      success: parseResult.success,
    };

    this.logger.info(
      {
        metric: "extractor.extract_relationships_ms",
        value: Math.round(performance.now() - startTime),
        filePath,
        importCount: imports.length,
        exportCount: exports.length,
      },
      "Relationship extraction completed"
    );

    return result;
  }

  /**
   * Extract relationships from a file on disk.
   *
   * @param filePath - Path to the file to extract from
   * @param options - Optional filtering options
   * @returns Extraction result with relationships and metadata
   * @throws {Error} If file cannot be read
   * @throws {LanguageNotSupportedError} If file extension is not supported
   * @throws {FileTooLargeError} If file exceeds max size
   * @throws {ParseTimeoutError} If parsing exceeds timeout
   */
  async extractFromFile(
    filePath: string,
    options?: RelationshipExtractOptions
  ): Promise<RelationshipExtractionResult> {
    this.logger.debug({ filePath }, "Reading file for relationship extraction");

    const file = Bun.file(filePath);
    const content = await file.text();

    return this.extractFromContent(content, filePath, options);
  }

  /**
   * Extract relationships from multiple files.
   *
   * Files are processed sequentially. If a file fails, it's logged
   * but processing continues with the next file.
   *
   * @param filePaths - Array of file paths to extract from
   * @param options - Optional filtering options (applied to all files)
   * @returns Array of extraction results (includes failed files)
   */
  async extractFromFiles(
    filePaths: string[],
    options?: RelationshipExtractOptions
  ): Promise<{
    results: RelationshipExtractionResult[];
    summary: BatchRelationshipExtractionSummary;
  }> {
    const startTime = performance.now();
    const results: RelationshipExtractionResult[] = [];
    let successfulFiles = 0;
    let failedFiles = 0;
    let totalImports = 0;
    let totalExports = 0;

    this.logger.info({ fileCount: filePaths.length }, "Starting batch relationship extraction");

    for (const filePath of filePaths) {
      try {
        const result = await this.extractFromFile(filePath, options);
        results.push(result);

        if (result.success) {
          successfulFiles++;
          totalImports += result.imports.length;
          totalExports += result.exports.length;
        } else {
          failedFiles++;
        }
      } catch (error) {
        failedFiles++;
        const err = error instanceof Error ? error : new Error(String(error));

        this.logger.warn({ err, filePath }, "Failed to extract relationships from file");

        // Add a failed result entry, inferring language from file extension
        const inferredLanguage = this.inferLanguageFromPath(filePath);
        results.push({
          imports: [],
          exports: [],
          filePath,
          language: inferredLanguage,
          parseTimeMs: 0,
          errors: [
            {
              message: err.message,
              recoverable: false,
            },
          ],
          success: false,
        });
      }
    }

    const totalTimeMs = performance.now() - startTime;

    const summary: BatchRelationshipExtractionSummary = {
      totalFiles: filePaths.length,
      successfulFiles,
      failedFiles,
      totalImports,
      totalExports,
      totalTimeMs,
    };

    this.logger.info(
      {
        metric: "extractor.batch_relationship_extract_ms",
        value: Math.round(totalTimeMs),
        ...summary,
      },
      "Batch relationship extraction completed"
    );

    return { results, summary };
  }

  /**
   * Extract only import relationships from source code.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @param options - Optional filtering options
   * @returns Array of import relationships
   */
  async extractImports(
    content: string,
    filePath: string,
    options?: RelationshipExtractOptions
  ): Promise<ImportRelationship[]> {
    const result = await this.extractFromContent(content, filePath, options);
    return result.imports;
  }

  /**
   * Extract only export relationships from source code.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @param options - Optional filtering options
   * @returns Array of export relationships
   */
  async extractExports(
    content: string,
    filePath: string,
    options?: RelationshipExtractOptions
  ): Promise<ExportRelationship[]> {
    const result = await this.extractFromContent(content, filePath, options);
    return result.exports;
  }

  /**
   * Extract only internal (relative) imports from source code.
   *
   * Convenience method that excludes external package imports.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @returns Array of internal import relationships
   */
  async extractInternalImports(content: string, filePath: string): Promise<ImportRelationship[]> {
    return this.extractImports(content, filePath, { includeExternalPackages: false });
  }

  /**
   * Extract only external package imports from source code.
   *
   * Convenience method that excludes relative imports.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @returns Array of external import relationships
   */
  async extractExternalImports(content: string, filePath: string): Promise<ImportRelationship[]> {
    const result = await this.extractFromContent(content, filePath);
    return result.imports.filter((imp) => imp.isExternal);
  }

  /**
   * Transform ImportInfo objects to ImportRelationship objects.
   *
   * @param imports - Raw import info from parser
   * @param sourceFile - Source file path
   * @returns Transformed import relationships
   */
  private transformImports(imports: ImportInfo[], sourceFile: string): ImportRelationship[] {
    return imports.map((importInfo) => {
      const isExternal = this.isExternalPackage(importInfo.source);
      const relationship: ImportRelationship = {
        sourceFile,
        targetModule: importInfo.source,
        importInfo,
        isExternal,
      };

      // Resolve relative paths
      if (!isExternal && importInfo.isRelative) {
        relationship.resolvedPath = this.resolveRelativePath(sourceFile, importInfo.source);
      }

      return relationship;
    });
  }

  /**
   * Transform ExportInfo objects to ExportRelationship objects.
   *
   * @param exports - Raw export info from parser
   * @param sourceFile - Source file path
   * @returns Transformed export relationships
   */
  private transformExports(exports: ExportInfo[], sourceFile: string): ExportRelationship[] {
    return exports.map((exportInfo) => {
      const isReExport = exportInfo.source !== undefined;
      const relationship: ExportRelationship = {
        sourceFile,
        exportInfo,
        isReExport,
      };

      if (isReExport && exportInfo.source) {
        relationship.targetModule = exportInfo.source;

        // Resolve relative re-export paths
        if (this.isLocalPath(exportInfo.source)) {
          relationship.resolvedPath = this.resolveRelativePath(sourceFile, exportInfo.source);
        }
      }

      return relationship;
    });
  }

  /**
   * Filter import relationships based on options.
   *
   * @param imports - Import relationships to filter
   * @param options - Filtering options
   * @returns Filtered import relationships
   */
  private filterImports(
    imports: ImportRelationship[],
    options: Required<RelationshipExtractOptions>
  ): ImportRelationship[] {
    let filtered = imports;

    if (!options.includeExternalPackages) {
      filtered = filtered.filter((r) => !r.isExternal);
    }

    if (!options.includeTypeOnlyImports) {
      filtered = filtered.filter((r) => !r.importInfo.isTypeOnly);
    }

    if (!options.includeSideEffectImports) {
      filtered = filtered.filter((r) => !r.importInfo.isSideEffect);
    }

    return filtered;
  }

  /**
   * Filter export relationships based on options.
   *
   * @param exports - Export relationships to filter
   * @param options - Filtering options
   * @returns Filtered export relationships
   */
  private filterExports(
    exports: ExportRelationship[],
    options: Required<RelationshipExtractOptions>
  ): ExportRelationship[] {
    let filtered = exports;

    if (!options.includeReExports) {
      filtered = filtered.filter((r) => !r.isReExport);
    }

    return filtered;
  }

  /**
   * Check if a module source is an external package.
   *
   * External packages are those that don't start with '.' or '/'.
   * Node built-ins (e.g., 'node:path') are considered external.
   *
   * @param source - Module source/specifier
   * @returns true if external package
   */
  private isExternalPackage(source: string): boolean {
    // Relative imports start with . or /
    if (source.startsWith(".") || source.startsWith("/")) {
      return false;
    }
    // Everything else (including node: builtins, bare specifiers) is external
    return true;
  }

  /**
   * Check if a path is a local (non-package) path.
   *
   * Local paths include:
   * - Relative paths starting with . or ..
   * - Absolute paths starting with /
   *
   * This distinguishes local file imports from external package imports.
   *
   * @param source - Path to check
   * @returns true if local path (not an external package)
   */
  private isLocalPath(source: string): boolean {
    return source.startsWith(".") || source.startsWith("/");
  }

  /**
   * Resolve a relative import path to an absolute path.
   *
   * @param sourceFilePath - Path of the file containing the import
   * @param importSource - The import source/specifier
   * @returns Resolved absolute path (normalized with forward slashes)
   */
  private resolveRelativePath(sourceFilePath: string, importSource: string): string {
    const sourceDir = path.dirname(sourceFilePath);
    const resolved = path.resolve(sourceDir, importSource);
    // Normalize path separators for consistency across platforms
    return resolved.replace(/\\/g, "/");
  }

  /**
   * Infer language from file path extension.
   *
   * @param filePath - File path to infer language from
   * @returns Inferred language, defaults to "typescript" if unknown
   */
  private inferLanguageFromPath(filePath: string): SupportedLanguage {
    const extension = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
    const extensionMap: Record<string, SupportedLanguage> = {
      ".ts": "typescript",
      ".mts": "typescript",
      ".tsx": "tsx",
      ".js": "javascript",
      ".mjs": "javascript",
      ".jsx": "jsx",
    };
    return extensionMap[extension] ?? "typescript";
  }
}
