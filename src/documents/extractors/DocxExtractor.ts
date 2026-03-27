/**
 * Microsoft Word DOCX document extractor using JSZip and @xmldom/xmldom.
 *
 * Extracts text content and metadata from DOCX files by directly parsing
 * the OOXML structure. Preserves document structure including headings,
 * lists, and paragraphs. Extracts Dublin Core metadata from docProps/core.xml.
 *
 * @module documents/extractors/DocxExtractor
 */

import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { DOCUMENT_EXTENSIONS, DEFAULT_EXTRACTOR_CONFIG } from "../constants.js";
import { ExtractionError, ExtractionTimeoutError, UnsupportedFormatError } from "../errors.js";
import { BaseExtractor } from "./BaseExtractor.js";
import type { DocumentMetadata, ExtractionResult, ExtractorConfig, SectionInfo } from "../types.js";
import { getComponentLogger } from "../../logging/index.js";

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

/** OOXML Word Processing namespace URI */
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

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
 * Directly parses OOXML structure using JSZip and @xmldom/xmldom for
 * reliable cross-platform text extraction. Extracts Dublin Core metadata
 * from docProps/core.xml when present.
 *
 * @extends {BaseExtractor<Required<DocxExtractorConfig>, ExtractionResult>}
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
export class DocxExtractor extends BaseExtractor<Required<DocxExtractorConfig>, ExtractionResult> {
  /**
   * Creates a new DocxExtractor instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: DocxExtractorConfig) {
    super("documents:docx-extractor", {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? DEFAULT_EXTRACTOR_CONFIG.maxFileSizeBytes,
      timeoutMs: config?.timeoutMs ?? DEFAULT_EXTRACTOR_CONFIG.timeoutMs,
      preserveFormatting: config?.preserveFormatting ?? false,
    });
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
    this.validateFileSize(stats.size, filePath);

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
   * Extract content from DOCX with timeout protection.
   *
   * Directly parses word/document.xml from the DOCX ZIP using JSZip and @xmldom/xmldom.
   * Extracts plain text from w:t elements and builds HTML from heading styles.
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
    return new Promise((resolve, reject) => {
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new ExtractionTimeoutError(
            `DOCX extraction timed out after ${this.config.timeoutMs}ms`,
            this.config.timeoutMs,
            { filePath, retryable: true }
          )
        );
      }, this.config.timeoutMs);

      this.extractFromZip(buffer, filePath)
        .then((result) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          resolve(result);
        })
        .catch((error: Error) => {
          clearTimeout(timeoutId);
          if (settled) return;
          settled = true;
          reject(
            error instanceof ExtractionError
              ? error
              : new ExtractionError(`Failed to extract DOCX content: ${error.message}`, {
                  filePath,
                  cause: error,
                })
          );
        });
    });
  }

  /**
   * Extract text and HTML from the DOCX ZIP by parsing word/document.xml directly.
   *
   * Walks the OOXML DOM tree to extract text from w:t elements and detect
   * paragraph styles (headings) for section parsing.
   *
   * @param buffer - DOCX file buffer
   * @param filePath - Path to the file (for error context)
   * @returns Plain text and HTML representation
   */
  private async extractFromZip(
    buffer: Buffer,
    filePath: string
  ): Promise<{ html: string; text: string }> {
    const zip = await JSZip.loadAsync(buffer);
    const docXmlFile = zip.file("word/document.xml");

    if (!docXmlFile) {
      throw new ExtractionError("DOCX archive missing word/document.xml", { filePath });
    }

    const docXml = await docXmlFile.async("string");
    const parser = new DOMParser();
    const doc = parser.parseFromString(docXml, "text/xml");

    const textParts: string[] = [];
    const htmlParts: string[] = [];

    // Find w:body element
    const bodyElements = doc.getElementsByTagNameNS(W_NS, "body");
    if (bodyElements.length === 0) {
      return { html: "", text: "" };
    }

    const body = bodyElements[0]!;

    // Walk w:p (paragraph) elements inside body
    for (let i = 0; i < body.childNodes.length; i++) {
      const node = body.childNodes[i]! as Element;
      if (node.nodeType !== 1) continue; // Skip non-element nodes
      if (node.localName !== "p" || node.namespaceURI !== W_NS) continue;

      const paragraphText = this.extractParagraphText(node);
      if (paragraphText.length === 0) continue;

      // Detect heading style from w:pPr > w:pStyle
      const headingLevel = this.getHeadingLevel(node);

      textParts.push(paragraphText);

      if (headingLevel > 0) {
        htmlParts.push(`<h${headingLevel}>${this.escapeHtml(paragraphText)}</h${headingLevel}>`);
      } else {
        htmlParts.push(`<p>${this.escapeHtml(paragraphText)}</p>`);
      }
    }

    return {
      text: textParts.join("\n"),
      html: htmlParts.join(""),
    };
  }

  /**
   * Extract text content from a w:p (paragraph) element.
   *
   * Concatenates all w:t text elements within w:r runs.
   *
   * @param paragraph - The w:p DOM element
   * @returns Concatenated text content
   */
  private extractParagraphText(paragraph: Node): string {
    const texts: string[] = [];
    this.walkTextNodes(paragraph, texts);
    return texts.join("");
  }

  /**
   * Recursively walk DOM nodes to collect w:t text content.
   *
   * @param node - Current DOM node
   * @param texts - Accumulator for text content
   */
  private walkTextNodes(node: Node, texts: string[]): void {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i]!;
      if (child.nodeType === 1) {
        // Element node — cast to Element for namespace/localName access
        const el = child as Element;
        if (el.localName === "t" && el.namespaceURI === W_NS) {
          texts.push(el.textContent ?? "");
        } else {
          this.walkTextNodes(child, texts);
        }
      }
    }
  }

  /**
   * Detect heading level from paragraph style.
   *
   * Looks for w:pPr > w:pStyle with val matching "Heading1" through "Heading6".
   *
   * @param paragraph - The w:p DOM element
   * @returns Heading level (1-6) or 0 if not a heading
   */
  private getHeadingLevel(paragraph: Node): number {
    for (let i = 0; i < paragraph.childNodes.length; i++) {
      const child = paragraph.childNodes[i]! as Element;
      if (child.nodeType === 1 && child.localName === "pPr" && child.namespaceURI === W_NS) {
        for (let j = 0; j < child.childNodes.length; j++) {
          const pprChild = child.childNodes[j]! as Element;
          if (
            pprChild.nodeType === 1 &&
            pprChild.localName === "pStyle" &&
            pprChild.namespaceURI === W_NS
          ) {
            const styleVal = pprChild.getAttributeNS(W_NS, "val");
            const match = styleVal?.match(/^Heading(\d)$/i);
            if (match) {
              return parseInt(match[1]!, 10);
            }
          }
        }
      }
    }
    return 0;
  }

  /**
   * Escape HTML special characters.
   *
   * @param text - Raw text to escape
   * @returns HTML-safe string
   */
  private escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /**
   * Parse HTML output to extract section/heading information.
   *
   * Maps heading positions in HTML to their corresponding positions in plain text.
   *
   * @param html - HTML with heading tags from extractFromZip
   * @param text - Plain text content
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
      this.getLogger().warn(
        { filePath, error: error instanceof Error ? error.message : "unknown error" },
        "Failed to extract DOCX metadata, continuing without it"
      );
      return {};
    }
  }

  /**
   * Parse Dublin Core XML from docProps/core.xml using namespace-aware DOM parsing.
   *
   * Uses @xmldom/xmldom for proper namespace
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
}
