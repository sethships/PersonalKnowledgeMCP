/**
 * Markdown document parser using marked.
 *
 * Parses Markdown files including YAML frontmatter extraction and
 * heading-based section structure analysis.
 *
 * @module documents/extractors/MarkdownParser
 */

import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { NotImplementedError } from "../errors.js";
import type { DocumentExtractor, MarkdownExtractionResult, ExtractorConfig } from "../types.js";

/**
 * Markdown-specific extractor configuration.
 *
 * @example
 * ```typescript
 * const config: MarkdownParserConfig = {
 *   maxFileSizeBytes: 52428800,
 *   timeoutMs: 30000,
 *   parseFrontmatter: true,
 *   extractSections: true
 * };
 * ```
 */
export interface MarkdownParserConfig extends ExtractorConfig {
  /**
   * Whether to parse YAML frontmatter.
   *
   * @default true
   */
  parseFrontmatter?: boolean;

  /**
   * Whether to extract section structure from headings.
   *
   * @default true
   */
  extractSections?: boolean;
}

/**
 * Parses Markdown files with frontmatter and structure extraction.
 *
 * Uses marked library for Markdown parsing. Supports YAML frontmatter
 * extraction and builds section hierarchy from headings.
 *
 * @implements {DocumentExtractor<MarkdownExtractionResult>}
 *
 * @example
 * ```typescript
 * const parser = new MarkdownParser();
 *
 * if (parser.supports(".md")) {
 *   const result = await parser.extract("/docs/README.md");
 *   console.log(`Title: ${result.frontmatter?.title}`);
 *   console.log(`Sections: ${result.sections?.length}`);
 * }
 * ```
 */
export class MarkdownParser implements DocumentExtractor<MarkdownExtractionResult> {
  private readonly config: Required<MarkdownParserConfig>;

  /**
   * Creates a new MarkdownParser instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: MarkdownParserConfig) {
    this.config = {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      parseFrontmatter: config?.parseFrontmatter ?? true,
      extractSections: config?.extractSections ?? true,
    };
  }

  /**
   * Parse a Markdown file and extract content, frontmatter, and structure.
   *
   * @param filePath - Absolute path to the Markdown file
   * @returns Promise resolving to extraction result with content, metadata, and frontmatter
   * @throws {NotImplementedError} This method is not yet implemented
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {ExtractionError} If Markdown parsing fails
   *
   * @example
   * ```typescript
   * const result = await parser.extract("/docs/guide.md");
   * console.log(result.content);
   * console.log(result.frontmatter?.title);
   * console.log(result.sections);
   * ```
   */
  async extract(filePath: string): Promise<MarkdownExtractionResult> {
    // Stub implementation - to be implemented in #360
    await Promise.resolve();
    throw new NotImplementedError(
      `MarkdownParser.extract is not yet implemented. File: ${filePath}`,
      "MarkdownParser.extract",
      { filePath }
    );
  }

  /**
   * Check if this parser supports a given file extension.
   *
   * @param extension - File extension including dot (e.g., ".md")
   * @returns true if this parser can handle the extension
   *
   * @example
   * ```typescript
   * parser.supports(".md"); // true
   * parser.supports(".markdown"); // true
   * parser.supports(".txt"); // false
   * ```
   */
  supports(extension: string): boolean {
    const normalizedExt = extension.toLowerCase();
    return DOCUMENT_EXTENSIONS.markdown.includes(
      normalizedExt as (typeof DOCUMENT_EXTENSIONS.markdown)[number]
    );
  }

  /**
   * Get the current configuration.
   *
   * @returns The parser configuration
   */
  getConfig(): Readonly<Required<MarkdownParserConfig>> {
    return this.config;
  }
}
