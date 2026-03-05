/**
 * Microsoft Word DOCX document extractor using mammoth.
 *
 * Extracts text content and metadata from DOCX files. Preserves document
 * structure including headings, lists, and paragraphs. Extracts Dublin Core
 * metadata from docProps/core.xml when available.
 *
 * NOTE: Several private methods (getFileStats, readFileBuffer, countWords,
 * computeContentHash, lazy logger pattern) are duplicated from PdfExtractor.
 * These should be extracted into a shared BaseExtractor or utility module
 * in a follow-up refactoring.
 *
 * @module documents/extractors/DocxExtractor
 */

import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import mammoth from "mammoth";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import {
  ExtractionError,
  ExtractionTimeoutError,
  FileAccessError,
  FileTooLargeError,
  UnsupportedFormatError,
} from "../errors.js";
import { getComponentLogger } from "../../logging/index.js";
import type {
  DocumentExtractor,
  DocumentMetadata,
  ExtractionResult,
  ExtractorConfig,
  SectionInfo,
} from "../types.js";

/**
 * DOCX-specific extractor configuration.
 *
 * @example
 * ```typescript
 * const config: DocxExtractorConfig = {
 *   maxFileSizeBytes: 52428800,
 *   timeoutMs: 30000,
 *   preserveFormatting: false
 * };
 * ```
 */
export interface DocxExtractorConfig extends ExtractorConfig {
  /**
   * Whether to preserve basic formatting (bold, italic) as markdown.
   *
   * NOTE: This option is accepted for forward compatibility but is not yet
   * applied during extraction. Tracked for future implementation.
   *
   * @default false
   */
  preserveFormatting?: boolean;
}

/** OLE2 Compound Document signature for legacy .doc files */
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Dublin Core Elements namespace URI */
const DC_NS = "http://purl.org/dc/elements/1.1/";

/** Dublin Core Terms namespace URI */
const DCTERMS_NS = "http://purl.org/dc/terms/";

/** Lazily-initialized logger for DOCX extractor operations */
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
      logger = getComponentLogger("documents:docx-extractor");
    } catch {
      return noopLogger;
    }
  }
  return logger;
}

/**
 * Extracts text content and metadata from DOCX documents.
 *
 * Uses mammoth library for text extraction. Converts DOCX structure to
 * plain text while optionally preserving basic formatting. Extracts
 * Dublin Core metadata from docProps/core.xml when present.
 *
 * @implements {DocumentExtractor<ExtractionResult>}
 *
 * @example
 * ```typescript
 * const extractor = new DocxExtractor();
 *
 * if (extractor.supports(".docx")) {
 *   const result = await extractor.extract("/path/to/document.docx");
 *   console.log(`Word count: ${result.metadata.wordCount}`);
 *   console.log(`Content: ${result.content.substring(0, 100)}...`);
 * }
 * ```
 */
export class DocxExtractor implements DocumentExtractor<ExtractionResult> {
  private readonly config: Required<DocxExtractorConfig>;

  /**
   * Creates a new DocxExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: DocxExtractorConfig) {
    this.config = {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      preserveFormatting: config?.preserveFormatting ?? false,
    };
  }

  /**
   * Extract text content and metadata from a DOCX file.
   *
   * @param filePath - Absolute path to the DOCX file
   * @returns Promise resolving to extraction result with content and metadata
   * @throws {FileAccessError} If file cannot be accessed
   * @throws {FileTooLargeError} If file exceeds maximum size
   * @throws {UnsupportedFormatError} If file is a legacy .doc format
   * @throws {ExtractionError} If DOCX parsing fails
   * @throws {ExtractionTimeoutError} If extraction times out
   *
   * @example
   * ```typescript
   * const result = await extractor.extract("/docs/report.docx");
   * console.log(result.content);
   * console.log(result.metadata.wordCount);
   * ```
   */
  async extract(filePath: string): Promise<ExtractionResult> {
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

    // 3. Read file buffer
    const buffer = await this.readFileBuffer(filePath);

    // 4. Check for legacy .doc format (OLE2 compound document)
    if (buffer.length >= OLE2_SIGNATURE.length && buffer.subarray(0, 8).equals(OLE2_SIGNATURE)) {
      throw new UnsupportedFormatError(
        "Legacy .doc format is not supported. Please convert to .docx",
        ".doc",
        { filePath }
      );
    }

    // 5. Extract content with timeout
    const { html, text } = await this.extractWithTimeout(buffer, filePath);

    // NOTE: preserveFormatting config is not yet applied.
    // Currently extraction always returns plain text from extractRawText.
    // When implemented, this would use HTML output with markdown conversion.

    // 6. Parse sections from HTML
    const sections = this.parseSections(html, text);

    // 7. Extract metadata from DOCX ZIP (docProps/core.xml)
    const docMetadata = await this.extractDocxMetadata(buffer, filePath);

    // 8. Build metadata
    const metadata = this.buildMetadata(text, filePath, stats, buffer, docMetadata);

    return {
      content: text,
      metadata,
      sections: sections.length > 0 ? sections : undefined,
    };
  }

  /**
   * Check if this extractor supports a given file extension.
   *
   * @param extension - File extension including dot (e.g., ".docx")
   * @returns true if this extractor can handle the extension
   *
   * @example
   * ```typescript
   * extractor.supports(".docx"); // true
   * extractor.supports(".doc"); // false (legacy format not supported)
   * ```
   */
  supports(extension: string): boolean {
    const normalizedExt = extension.toLowerCase();
    return DOCUMENT_EXTENSIONS.docx.includes(
      normalizedExt as (typeof DOCUMENT_EXTENSIONS.docx)[number]
    );
  }

  /**
   * Get the current configuration.
   *
   * @returns The extractor configuration
   */
  getConfig(): Readonly<Required<DocxExtractorConfig>> {
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
   * Read file contents as buffer.
   *
   * @param filePath - Path to the file
   * @returns File contents as buffer
   * @throws {FileAccessError} If file cannot be read
   */
  private async readFileBuffer(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new FileAccessError(`Cannot read file: ${filePath}`, {
        filePath,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  /**
   * Extract content from DOCX with timeout protection.
   *
   * Uses mammoth.convertToHtml for structured HTML and mammoth.extractRawText for plain text.
   *
   * @param buffer - DOCX file buffer
   * @param filePath - Path to the file (for error context)
   * @returns Extracted HTML and plain text content
   * @throws {ExtractionTimeoutError} If extraction times out
   * @throws {ExtractionError} If extraction fails
   */
  private async extractWithTimeout(
    buffer: Buffer,
    filePath: string
  ): Promise<{ html: string; text: string }> {
    let settled = false;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        // NOTE: In-flight mammoth operations continue in background after timeout.
        // Neither mammoth nor the JS runtime provides a cancellation mechanism.
        // Consider worker threads for isolation if this becomes a production issue.
        reject(
          new ExtractionTimeoutError(
            `DOCX extraction timed out after ${this.config.timeoutMs}ms`,
            this.config.timeoutMs,
            { filePath, retryable: true }
          )
        );
      }, this.config.timeoutMs);

      const input = { buffer };

      // NOTE: Both calls independently parse the DOCX ZIP. For large documents,
      // this doubles CPU/memory usage. If profiling reveals this as a bottleneck,
      // consider using only convertToHtml and stripping HTML tags for plain text.
      Promise.all([mammoth.convertToHtml(input), mammoth.extractRawText(input)])
        .then(([htmlResult, textResult]) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;

          // Log any warnings from mammoth
          const allMessages = [...htmlResult.messages, ...textResult.messages];
          const warnings = allMessages.filter(
            (m): m is { type: "warning"; message: string } => m.type === "warning"
          );
          if (warnings.length > 0) {
            getLogger().warn(
              { filePath, warnings: warnings.map((w) => w.message) },
              "Mammoth extraction produced warnings"
            );
          }

          resolve({
            html: htmlResult.value,
            text: textResult.value,
          });
        })
        .catch((error: Error) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;

          reject(
            new ExtractionError(`Failed to extract DOCX content: ${error.message}`, {
              filePath,
              cause: error,
            })
          );
        });
    });
  }

  /**
   * Parse HTML output from mammoth to extract section/heading information.
   *
   * Maps heading positions in HTML to their corresponding positions in plain text.
   *
   * @param html - HTML output from mammoth.convertToHtml
   * @param text - Plain text output from mammoth.extractRawText
   * @returns Array of SectionInfo objects
   */
  private parseSections(html: string, text: string): SectionInfo[] {
    const sections: SectionInfo[] = [];

    // Match heading tags (h1-h6) in the HTML
    const headingRegex = /<h(\d)>(.*?)<\/h\1>/gis;
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(html)) !== null) {
      const level = parseInt(match[1]!, 10);
      // Strip any remaining HTML tags from the heading text
      const title = match[2]!.replace(/<[^>]*>/g, "").trim();

      if (title.length === 0) continue;

      // NOTE: indexOf may match body text with the same content as a heading.
      // A more robust approach would walk mammoth's document AST directly.
      // Find the heading position in the plain text
      const searchStart = sections.length > 0 ? sections[sections.length - 1]!.startOffset : 0;
      const headingIndex = text.indexOf(title, searchStart);

      if (headingIndex !== -1) {
        // If there's a previous section, set its endOffset
        if (sections.length > 0) {
          sections[sections.length - 1]!.endOffset = headingIndex;
        }

        sections.push({
          title,
          level,
          startOffset: headingIndex,
          endOffset: text.length, // Will be updated by next section or remain as text length
        });
      }
    }

    return sections;
  }

  /**
   * Extract Dublin Core metadata from DOCX ZIP archive.
   *
   * Reads docProps/core.xml from the DOCX ZIP and parses Dublin Core fields.
   *
   * @param buffer - DOCX file buffer
   * @param filePath - Path to the file (for error context)
   * @returns Extracted metadata or empty object if unavailable
   */
  private async extractDocxMetadata(
    buffer: Buffer,
    filePath: string
  ): Promise<{ title?: string; creator?: string; created?: Date }> {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const coreXmlFile = zip.file("docProps/core.xml");

      if (!coreXmlFile) {
        return {};
      }

      const coreXml = await coreXmlFile.async("string");
      return this.parseCoreXml(coreXml);
    } catch (error) {
      // Gracefully handle missing or unparseable metadata
      getLogger().warn(
        { filePath, error: error instanceof Error ? error.message : "unknown error" },
        "Failed to extract DOCX metadata, continuing without it"
      );
      return {};
    }
  }

  /**
   * Parse Dublin Core XML from docProps/core.xml using namespace-aware DOM parsing.
   *
   * Uses @xmldom/xmldom (transitive dependency via mammoth) for proper namespace
   * handling. Supports any namespace prefix for Dublin Core elements, not just
   * the conventional dc:/dcterms: prefixes.
   *
   * @param xml - Core XML content
   * @returns Parsed metadata fields
   */
  private parseCoreXml(xml: string): { title?: string; creator?: string; created?: Date } {
    try {
      const doc = new DOMParser().parseFromString(xml, "text/xml");

      const result: { title?: string; creator?: string; created?: Date } = {};

      // Extract dc:title (namespace-aware, works with any prefix)
      const titleElements = doc.getElementsByTagNameNS(DC_NS, "title");
      if (titleElements.length > 0) {
        const text = titleElements[0]!.textContent?.trim();
        if (text) {
          result.title = text;
        }
      }

      // Extract dc:creator (namespace-aware, works with any prefix)
      const creatorElements = doc.getElementsByTagNameNS(DC_NS, "creator");
      if (creatorElements.length > 0) {
        const text = creatorElements[0]!.textContent?.trim();
        if (text) {
          result.creator = text;
        }
      }

      // Extract dcterms:created (namespace-aware, works with any prefix)
      const createdElements = doc.getElementsByTagNameNS(DCTERMS_NS, "created");
      if (createdElements.length > 0) {
        const text = createdElements[0]!.textContent?.trim();
        if (text) {
          const date = new Date(text);
          if (!isNaN(date.getTime())) {
            result.created = date;
          }
        }
      }

      return result;
    } catch (error) {
      // Guard against unexpected runtime errors (e.g., null input).
      // Note: @xmldom/xmldom does not throw on malformed XML — it returns
      // a best-effort document. Parse errors result in empty element queries above.
      getLogger().warn(
        { error: error instanceof Error ? error.message : "unknown error" },
        "Failed to parse core.xml with DOMParser, returning empty metadata"
      );
      return {};
    }
  }

  /**
   * Build document metadata from extracted data.
   *
   * @param text - Extracted plain text content
   * @param filePath - Path to the file
   * @param stats - File stats
   * @param buffer - File buffer for hashing
   * @param docMetadata - Metadata extracted from docProps/core.xml
   * @returns Document metadata
   */
  private buildMetadata(
    text: string,
    filePath: string,
    stats: { size: number; mtime: Date },
    buffer: Buffer,
    docMetadata: { title?: string; creator?: string; created?: Date }
  ): DocumentMetadata {
    return {
      documentType: "docx",
      title: docMetadata.title,
      author: docMetadata.creator,
      createdAt: docMetadata.created,
      wordCount: this.countWords(text),
      filePath,
      fileSizeBytes: stats.size,
      contentHash: this.computeContentHash(buffer),
      fileModifiedAt: stats.mtime,
    };
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
   * Compute SHA-256 hash of content.
   *
   * @param buffer - Content buffer
   * @returns Hex-encoded SHA-256 hash with sha256: prefix
   */
  private computeContentHash(buffer: Buffer): string {
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    return `sha256:${hash}`;
  }
}
