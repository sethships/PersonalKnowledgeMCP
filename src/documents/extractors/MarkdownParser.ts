/**
 * Markdown document parser using marked.
 *
 * Parses Markdown files including YAML frontmatter extraction and
 * heading-based section structure analysis. Supports CommonMark and
 * GitHub Flavored Markdown (GFM) via the marked library.
 *
 * NOTE: Several private methods (getFileStats, readFileContent, countWords,
 * computeContentHash, lazy logger pattern) are duplicated from DocxExtractor.
 * These should be extracted into a shared BaseExtractor or utility module
 * in a follow-up refactoring.
 *
 * @module documents/extractors/MarkdownParser
 */

import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { marked, type Token, type Tokens } from "marked";
import matter from "gray-matter";
import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import {
  ExtractionError,
  ExtractionTimeoutError,
  FileAccessError,
  FileTooLargeError,
} from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type {
  DocumentExtractor,
  DocumentMetadata,
  MarkdownExtractionResult,
  MarkdownFrontmatter,
  ExtractorConfig,
  SectionInfo,
} from "../types.js";

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

/** Lazily-initialized logger for Markdown parser operations */
let logger: ReturnType<typeof getComponentLogger> | null = null;

/** Shared no-op function for the silent logger */
const noop = (): void => {};

/** No-op logger for when logging system is not initialized */
const noopLogger = {
  warn: noop,
  info: noop,
  error: noop,
  debug: noop,
  trace: noop,
  fatal: noop,
  level: "silent" as const,
  silent: true,
} as unknown as ReturnType<typeof getComponentLogger>;

/**
 * Get the component logger, initializing if needed.
 * Lazy initialization avoids errors when module loads before logger is initialized.
 */
function getLogger(): ReturnType<typeof getComponentLogger> {
  if (!logger) {
    try {
      logger = getComponentLogger("documents:markdown-parser");
    } catch {
      return noopLogger;
    }
  }
  return logger;
}

/**
 * Parses Markdown files with frontmatter and structure extraction.
 *
 * Uses marked library for Markdown parsing. Supports YAML frontmatter
 * extraction and builds section hierarchy from headings. Handles both
 * CommonMark and GitHub Flavored Markdown (GFM).
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
   * @throws {FileAccessError} If file cannot be accessed
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {ExtractionError} If Markdown parsing fails
   * @throws {ExtractionTimeoutError} If extraction times out
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
    // 1. Get file stats and validate
    const stats = await this.getFileStats(filePath);

    // 2. Check file size
    if (stats.size > this.config.maxFileSizeBytes) {
      throw new FileTooLargeError(
        `File exceeds maximum size of ${this.config.maxFileSizeBytes} bytes (actual: ${stats.size} bytes)`,
        stats.size,
        this.config.maxFileSizeBytes,
        { filePath }
      );
    }

    // 3. Read file as UTF-8 string
    const rawContent = await this.readFileContent(filePath);

    // 4. Extract with timeout protection
    return this.extractWithTimeout(rawContent, filePath, stats);
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

  /**
   * Get file stats and handle errors.
   *
   * @param filePath - Path to the file
   * @returns File stats
   * @throws {FileAccessError} If file cannot be accessed
   */
  private async getFileStats(filePath: string): Promise<{ size: number; mtime: Date }> {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        throw new FileAccessError(`File not found: ${filePath}`, {
          filePath,
          cause: error instanceof Error ? error : undefined,
        });
      }
      if (nodeError.code === "EACCES") {
        throw new FileAccessError(`Permission denied: ${filePath}`, {
          filePath,
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new FileAccessError(`Cannot access file: ${filePath}`, {
        filePath,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Read file contents as UTF-8 string.
   *
   * @param filePath - Path to the file
   * @returns File contents as string
   * @throws {FileAccessError} If file cannot be read
   */
  private async readFileContent(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch (error) {
      throw new FileAccessError(`Cannot read file: ${filePath}`, {
        filePath,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Extract content from Markdown with timeout protection.
   *
   * Parses frontmatter, tokenizes Markdown, and extracts sections
   * within a configurable timeout window.
   *
   * @param rawContent - Raw file content as string
   * @param filePath - Path to the file (for error context)
   * @param stats - File stats for metadata
   * @returns Extraction result
   * @throws {ExtractionTimeoutError} If extraction times out
   * @throws {ExtractionError} If parsing fails
   */
  private async extractWithTimeout(
    rawContent: string,
    filePath: string,
    stats: { size: number; mtime: Date }
  ): Promise<MarkdownExtractionResult> {
    let settled = false;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new ExtractionTimeoutError(
            `Markdown extraction timed out after ${this.config.timeoutMs}ms`,
            this.config.timeoutMs,
            { filePath, retryable: true }
          )
        );
      }, this.config.timeoutMs);

      try {
        // 1. Parse frontmatter if configured
        let content: string;
        let frontmatter: MarkdownFrontmatter | undefined;

        if (this.config.parseFrontmatter) {
          const parsed = this.parseFrontmatter(rawContent);
          content = parsed.content;
          frontmatter = parsed.frontmatter;
        } else {
          content = rawContent;
        }

        // 2. Tokenize Markdown with GFM enabled
        const tokens = marked.lexer(content, { gfm: true });

        // 3. Extract sections from heading tokens
        let sections: SectionInfo[] | undefined;
        if (this.config.extractSections) {
          const extracted = this.extractSections(tokens, content);
          sections = extracted.length > 0 ? extracted : undefined;
        }

        // 4. Build metadata
        const metadata = this.buildMetadata(content, filePath, stats, rawContent, frontmatter);

        clearTimeout(timeoutId);
        if (settled) return;
        settled = true;

        resolve({
          content,
          metadata,
          frontmatter,
          sections,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (settled) return;
        settled = true;

        if (error instanceof ExtractionError) {
          reject(error);
        } else {
          reject(
            new ExtractionError(
              `Failed to extract Markdown content: ${error instanceof Error ? error.message : "unknown error"}`,
              {
                filePath,
                cause: error instanceof Error ? error : undefined,
              }
            )
          );
        }
      }
    });
  }

  /**
   * Parse YAML frontmatter from Markdown content.
   *
   * Uses gray-matter to extract and parse the YAML block between --- delimiters.
   *
   * @param rawContent - Raw Markdown content including frontmatter
   * @returns Object with body content and parsed frontmatter
   */
  private parseFrontmatter(rawContent: string): {
    content: string;
    frontmatter: MarkdownFrontmatter | undefined;
  } {
    try {
      const parsed = matter(rawContent);

      // Only return frontmatter if there was actual data
      const hasData = parsed.data && Object.keys(parsed.data).length > 0;

      return {
        content: parsed.content,
        frontmatter: hasData ? (parsed.data as MarkdownFrontmatter) : undefined,
      };
    } catch (error) {
      // If frontmatter parsing fails, return raw content without frontmatter
      getLogger().warn(
        { error: error instanceof Error ? error.message : "unknown error" },
        "Failed to parse frontmatter, continuing without it"
      );
      return {
        content: rawContent,
        frontmatter: undefined,
      };
    }
  }

  /**
   * Extract section structure from marked tokens.
   *
   * Walks the token list and builds SectionInfo entries from heading tokens,
   * tracking start and end offsets within the content string.
   *
   * @param tokens - Array of marked tokens from lexer
   * @param content - The Markdown content string (frontmatter stripped)
   * @returns Array of SectionInfo objects
   */
  private extractSections(tokens: Token[], content: string): SectionInfo[] {
    const sections: SectionInfo[] = [];
    let searchStart = 0;

    for (const token of tokens) {
      if (token.type === "heading") {
        const heading = token as Tokens.Heading;
        const title = heading.text;
        const level = heading.depth;

        // Find the heading position in the content string
        // Use the raw heading format to find the exact position
        const headingIndex = content.indexOf(title, searchStart);

        if (headingIndex !== -1) {
          // Close the previous section's endOffset
          if (sections.length > 0) {
            // Find the start of the heading line (including the # prefix)
            const lineStart = content.lastIndexOf("\n", headingIndex);
            const sectionEnd = lineStart !== -1 ? lineStart : headingIndex;
            sections[sections.length - 1]!.endOffset = sectionEnd;
          }

          sections.push({
            title,
            level,
            startOffset: headingIndex,
            endOffset: content.length,
          });

          searchStart = headingIndex + title.length;
        }
      }
    }

    return sections;
  }

  /**
   * Build document metadata from extracted data.
   *
   * Title is resolved with priority: frontmatter.title > first h1 heading.
   *
   * @param content - Extracted content (frontmatter stripped)
   * @param filePath - Path to the file
   * @param stats - File stats
   * @param rawContent - Original raw file content for hashing
   * @param frontmatter - Parsed frontmatter data
   * @returns Document metadata
   */
  private buildMetadata(
    content: string,
    filePath: string,
    stats: { size: number; mtime: Date },
    rawContent: string,
    frontmatter?: MarkdownFrontmatter
  ): DocumentMetadata {
    // Resolve title: frontmatter.title > first h1 heading
    let title = frontmatter?.title;
    if (!title) {
      title = this.findFirstH1(content);
    }

    // Resolve author from frontmatter
    const author = typeof frontmatter?.author === "string" ? frontmatter.author : undefined;

    return {
      documentType: "markdown",
      title,
      author,
      wordCount: this.countWords(content),
      filePath,
      fileSizeBytes: stats.size,
      contentHash: this.computeContentHash(rawContent),
      fileModifiedAt: stats.mtime,
    };
  }

  /**
   * Find the first h1 heading in Markdown content.
   *
   * @param content - Markdown content string
   * @returns The first h1 heading text, or undefined if none found
   */
  private findFirstH1(content: string): string | undefined {
    // Use marked.lexer to find the first h1 heading
    try {
      const tokens = marked.lexer(content, { gfm: true });
      for (const token of tokens) {
        if (token.type === "heading" && (token as Tokens.Heading).depth === 1) {
          return (token as Tokens.Heading).text;
        }
      }
    } catch {
      // Fallback: regex-based h1 detection
      const match = content.match(/^#\s+(.+)$/m);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return undefined;
  }

  /**
   * Count words in text.
   *
   * @param text - Text to count words in
   * @returns Word count
   */
  private countWords(text: string): number {
    if (!text || text.trim().length === 0) {
      return 0;
    }
    return text.split(/\s+/).filter((word) => word.length > 0).length;
  }

  /**
   * Compute SHA-256 hash of raw file content.
   *
   * Hashes the original file content (including frontmatter) for
   * consistent deduplication regardless of parsing options.
   *
   * @param rawContent - Original file content as string
   * @returns Hex-encoded SHA-256 hash with sha256: prefix
   */
  private computeContentHash(rawContent: string): string {
    const hash = crypto.createHash("sha256").update(rawContent, "utf-8").digest("hex");
    return `sha256:${hash}`;
  }
}
