/**
 * Entity extractor for code analysis.
 *
 * Provides a focused API for extracting code entities (functions, classes,
 * interfaces, etc.) from source files using AST parsing.
 *
 * Supports multiple languages through the unified CodeParser:
 * - TypeScript, JavaScript, TSX, JSX (via tree-sitter)
 * - Python, Java, Go, Rust (via tree-sitter)
 * - C# (via Roslyn - requires .NET SDK)
 *
 * This class serves as the bridge between the low-level CodeParser
 * and the knowledge graph storage layer, providing filtering and
 * convenience methods for entity extraction.
 *
 * @module graph/extraction/EntityExtractor
 *
 * @example
 * ```typescript
 * import { EntityExtractor } from './graph/extraction';
 *
 * const extractor = new EntityExtractor();
 *
 * // Extract all entities from content
 * const result = await extractor.extractFromContent(sourceCode, 'file.ts');
 *
 * // Extract only exported functions
 * const functions = await extractor.extractFunctions(sourceCode, 'file.ts');
 *
 * // Extract with filtering options
 * const exportedClasses = await extractor.extractFromContent(
 *   sourceCode,
 *   'file.ts',
 *   { entityTypes: ['class', 'interface'], exportedOnly: true }
 * );
 * ```
 */

import type pino from "pino";
import { getComponentLogger } from "../../logging/index.js";
import { CodeParser } from "../parsing/CodeParser.js";
import type { CodeEntity, SupportedLanguage } from "../parsing/types.js";
import type {
  EntityExtractorConfig,
  ExtractOptions,
  ExtractionResult,
  BatchExtractionSummary,
} from "./types.js";
import { DEFAULT_EXTRACTOR_CONFIG } from "./types.js";

/**
 * Entity extractor for code analysis.
 *
 * Wraps CodeParser to provide a focused API for extracting
 * code entities from source files with filtering and batch processing
 * capabilities.
 */
export class EntityExtractor {
  private readonly parser: CodeParser;
  private readonly config: Required<EntityExtractorConfig>;
  private _logger: pino.Logger | null = null;

  /**
   * Create a new EntityExtractor instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config?: EntityExtractorConfig) {
    this.config = {
      ...DEFAULT_EXTRACTOR_CONFIG,
      ...config,
    };

    this.parser = new CodeParser({
      extractDocumentation: this.config.extractDocumentation,
      includeAnonymous: this.config.includeAnonymous,
      maxFileSizeBytes: this.config.maxFileSizeBytes,
      parseTimeoutMs: this.config.parseTimeoutMs,
    });
  }

  /**
   * Get the component logger (lazy initialization).
   */
  private get logger(): pino.Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("graph:extraction:extractor");
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
    return CodeParser.isSupported(extension);
  }

  /**
   * Extract entities from source code content.
   *
   * @param content - Source code content to parse
   * @param filePath - File path (used for extension detection and in results)
   * @param options - Optional filtering options
   * @returns Extraction result with entities and metadata
   * @throws {LanguageNotSupportedError} If file extension is not supported
   * @throws {FileTooLargeError} If file exceeds max size
   * @throws {ParseTimeoutError} If parsing exceeds timeout
   */
  async extractFromContent(
    content: string,
    filePath: string,
    options?: ExtractOptions
  ): Promise<ExtractionResult> {
    const startTime = performance.now();

    this.logger.debug({ filePath, options }, "Extracting entities from content");

    const parseResult = await this.parser.parseFile(content, filePath);

    // Apply filtering if options provided
    let entities = parseResult.entities;
    if (options) {
      entities = this.filterEntities(entities, options);
    }

    const result: ExtractionResult = {
      entities,
      filePath: parseResult.filePath,
      language: parseResult.language,
      parseTimeMs: parseResult.parseTimeMs,
      errors: parseResult.errors,
      success: parseResult.success,
    };

    this.logger.info(
      {
        metric: "extractor.extract_from_content_ms",
        value: Math.round(performance.now() - startTime),
        filePath,
        entityCount: entities.length,
        filteredCount: parseResult.entities.length - entities.length,
      },
      "Entity extraction completed"
    );

    return result;
  }

  /**
   * Extract entities from a file on disk.
   *
   * @param filePath - Path to the file to extract from
   * @param options - Optional filtering options
   * @returns Extraction result with entities and metadata
   * @throws {Error} If file cannot be read
   * @throws {LanguageNotSupportedError} If file extension is not supported
   * @throws {FileTooLargeError} If file exceeds max size
   * @throws {ParseTimeoutError} If parsing exceeds timeout
   */
  async extractFromFile(filePath: string, options?: ExtractOptions): Promise<ExtractionResult> {
    this.logger.debug({ filePath }, "Reading file for extraction");

    const file = Bun.file(filePath);
    const content = await file.text();

    return this.extractFromContent(content, filePath, options);
  }

  /**
   * Extract entities from multiple files.
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
    options?: ExtractOptions
  ): Promise<{ results: ExtractionResult[]; summary: BatchExtractionSummary }> {
    const startTime = performance.now();
    const results: ExtractionResult[] = [];
    let successfulFiles = 0;
    let failedFiles = 0;
    let totalEntities = 0;

    this.logger.info({ fileCount: filePaths.length }, "Starting batch extraction");

    for (const filePath of filePaths) {
      try {
        const result = await this.extractFromFile(filePath, options);
        results.push(result);

        if (result.success) {
          successfulFiles++;
          totalEntities += result.entities.length;
        } else {
          failedFiles++;
        }
      } catch (error) {
        failedFiles++;
        const err = error instanceof Error ? error : new Error(String(error));

        this.logger.warn({ err, filePath }, "Failed to extract from file");

        // Add a failed result entry
        results.push({
          entities: [],
          filePath,
          language: "typescript" as SupportedLanguage, // Default, actual language unknown
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

    const summary: BatchExtractionSummary = {
      totalFiles: filePaths.length,
      successfulFiles,
      failedFiles,
      totalEntities,
      totalTimeMs,
    };

    this.logger.info(
      {
        metric: "extractor.batch_extract_ms",
        value: Math.round(totalTimeMs),
        ...summary,
      },
      "Batch extraction completed"
    );

    return { results, summary };
  }

  /**
   * Extract only function entities from source code.
   *
   * Convenience method that filters for functions and methods.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @returns Array of function entities
   */
  async extractFunctions(content: string, filePath: string): Promise<CodeEntity[]> {
    const result = await this.extractFromContent(content, filePath, {
      entityTypes: ["function", "method"],
    });
    return result.entities;
  }

  /**
   * Extract only class entities from source code.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @returns Array of class entities
   */
  async extractClasses(content: string, filePath: string): Promise<CodeEntity[]> {
    const result = await this.extractFromContent(content, filePath, {
      entityTypes: ["class"],
    });
    return result.entities;
  }

  /**
   * Extract only interface entities from source code.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @returns Array of interface entities
   */
  async extractInterfaces(content: string, filePath: string): Promise<CodeEntity[]> {
    const result = await this.extractFromContent(content, filePath, {
      entityTypes: ["interface"],
    });
    return result.entities;
  }

  /**
   * Extract type aliases and enums from source code.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @returns Array of type alias and enum entities
   */
  async extractTypes(content: string, filePath: string): Promise<CodeEntity[]> {
    const result = await this.extractFromContent(content, filePath, {
      entityTypes: ["type_alias", "enum"],
    });
    return result.entities;
  }

  /**
   * Extract all exportable entities from source code.
   *
   * Returns only entities that are exported from the module.
   *
   * @param content - Source code content
   * @param filePath - File path (for extension detection)
   * @returns Array of exported entities
   */
  async extractExported(content: string, filePath: string): Promise<CodeEntity[]> {
    const result = await this.extractFromContent(content, filePath, {
      exportedOnly: true,
    });
    return result.entities;
  }

  /**
   * Filter entities based on extraction options.
   *
   * @param entities - Entities to filter
   * @param options - Filtering options
   * @returns Filtered entities
   */
  private filterEntities(entities: CodeEntity[], options: ExtractOptions): CodeEntity[] {
    let filtered = entities;

    // Filter by entity types
    if (options.entityTypes && options.entityTypes.length > 0) {
      const typeSet = new Set(options.entityTypes);
      filtered = filtered.filter((entity) => typeSet.has(entity.type));
    }

    // Filter by export status
    if (options.exportedOnly) {
      filtered = filtered.filter((entity) => entity.isExported);
    }

    return filtered;
  }
}
