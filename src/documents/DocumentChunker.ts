/**
 * Document-aware chunker extending FileChunker for document ingestion.
 *
 * Provides paragraph-aware, page-aware, and section-context chunking
 * for PDF, DOCX, Markdown, and plain text documents. Extends the
 * existing FileChunker to maintain compatibility with the embedding pipeline.
 *
 * @module documents/DocumentChunker
 */

import crypto from "crypto";
import type pino from "pino";
import { getComponentLogger } from "../logging/index.js";
import { FileChunker } from "../ingestion/file-chunker.js";
import type { FileInfo, FileChunk } from "../ingestion/types.js";
import { ChunkingError, ValidationError } from "../ingestion/errors.js";
import { detectLanguage } from "../ingestion/language-detector.js";
import type {
  ExtractionResult,
  SectionInfo,
  DocumentChunk,
  DocumentChunkMetadata,
  DocumentChunkerConfig,
} from "./types.js";

/**
 * Estimate token count using the same 4:1 character-to-token heuristic
 * as FileChunker for consistency.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
function estimateTokens(text: string): number {
  const charCount = [...text].length;
  return Math.ceil(charCount / 4);
}

/**
 * Compute SHA-256 hash of content for deduplication.
 *
 * @param content - Content to hash
 * @returns Hex-encoded SHA-256 hash
 */
function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Create unique chunk identifier.
 *
 * @param source - Repository or source name
 * @param filePath - File path
 * @param chunkIndex - Zero-based chunk index
 * @returns Unique chunk ID
 */
function createChunkId(source: string, filePath: string, chunkIndex: number): string {
  return `${source}:${filePath}:${chunkIndex}`;
}

/**
 * Internal representation of a paragraph block with position tracking.
 */
interface ParagraphBlock {
  /** Paragraph text content */
  content: string;
  /** Starting line number (1-based) in the original content */
  startLine: number;
  /** Ending line number (1-based, inclusive) in the original content */
  endLine: number;
  /** Character offset in the original content */
  charOffset: number;
}

/**
 * Document-aware chunker for Phase 6 document ingestion.
 *
 * Extends FileChunker with document-specific chunking strategies:
 * - **Page-boundary chunking**: Chunks each PDF page independently
 * - **Paragraph-boundary chunking**: Splits at paragraph boundaries (double newlines)
 * - **Section heading context**: Attaches nearest section heading to each chunk
 * - **Document metadata**: Preserves document type, title, and author in chunk metadata
 *
 * Falls back to FileChunker's line-level splitting when paragraphs exceed token limits.
 *
 * @example
 * ```typescript
 * const chunker = new DocumentChunker({
 *   maxChunkTokens: 500,
 *   respectParagraphs: true,
 *   respectPageBoundaries: true,
 *   includeSectionContext: true
 * });
 *
 * const result = await pdfExtractor.extract("/path/to/doc.pdf");
 * const chunks = chunker.chunkDocument(result, "docs/report.pdf", "my-docs");
 * ```
 */
export class DocumentChunker extends FileChunker {
  private readonly docLogger: pino.Logger;
  private readonly respectParagraphs: boolean;
  private readonly includeSectionContext: boolean;
  private readonly respectPageBoundaries: boolean;
  private readonly maxTokens: number;

  /**
   * Create a new DocumentChunker instance.
   *
   * @param config - Document chunker configuration
   */
  constructor(config?: DocumentChunkerConfig) {
    super({
      maxChunkTokens: config?.maxChunkTokens,
      overlapTokens: config?.overlapTokens,
    });

    this.docLogger = getComponentLogger("documents:chunker");
    this.maxTokens = config?.maxChunkTokens ?? 500;
    this.respectParagraphs = config?.respectParagraphs ?? true;
    this.includeSectionContext = config?.includeSectionContext ?? true;
    this.respectPageBoundaries = config?.respectPageBoundaries ?? true;

    this.docLogger.debug(
      {
        respectParagraphs: this.respectParagraphs,
        includeSectionContext: this.includeSectionContext,
        respectPageBoundaries: this.respectPageBoundaries,
        maxTokens: this.maxTokens,
      },
      "DocumentChunker initialized"
    );
  }

  /**
   * Chunk a document extraction result into embedding-appropriate chunks.
   *
   * Selects the chunking strategy based on document characteristics and config:
   * 1. Page-boundary chunking for PDFs with pages (when respectPageBoundaries=true)
   * 2. Paragraph-boundary chunking for prose content (when respectParagraphs=true)
   * 3. Line-level chunking via FileChunker as fallback
   *
   * @param extractionResult - Result from document extraction
   * @param filePath - Relative file path for the document
   * @param source - Repository or source name
   * @returns Array of document chunks ready for embedding
   * @throws {ChunkingError} If chunking fails
   */
  chunkDocument(
    extractionResult: ExtractionResult,
    filePath: string,
    source: string
  ): DocumentChunk[] {
    const startTime = Date.now();

    // Validate source name (same rule as FileChunker)
    if (!source || source.includes(":")) {
      throw new ValidationError(
        `Source name cannot be empty or contain ':' character, got: "${source}"`,
        "source"
      );
    }

    try {
      this.docLogger.debug(
        {
          source,
          filePath,
          documentType: extractionResult.metadata.documentType,
          hasPages: !!extractionResult.pages?.length,
          hasSections: !!extractionResult.sections?.length,
        },
        "Starting document chunking"
      );

      // Handle empty content
      if (!extractionResult.content || extractionResult.content.trim().length === 0) {
        this.docLogger.debug({ filePath }, "Empty document, returning no chunks");
        return [];
      }

      let fileChunks: FileChunk[];

      // Strategy 1: Page-boundary chunking for multi-page documents
      if (
        this.respectPageBoundaries &&
        extractionResult.pages &&
        extractionResult.pages.length > 0
      ) {
        fileChunks = this.chunkByPages(extractionResult, filePath, source);
      }
      // Strategy 2: Paragraph-boundary chunking
      else if (this.respectParagraphs) {
        fileChunks = this.chunkByParagraphs(
          extractionResult.content,
          filePath,
          source,
          extractionResult
        );
      }
      // Strategy 3: Fallback to line-level chunking
      else {
        const fileInfo = this.createDocumentFileInfo(extractionResult, filePath);
        fileChunks = this.chunkFile(extractionResult.content, fileInfo, source);
      }

      // Convert FileChunks to DocumentChunks with document metadata
      const documentChunks = this.convertToDocumentChunks(
        fileChunks,
        extractionResult,
        filePath,
        source
      );

      const duration = Date.now() - startTime;
      this.docLogger.info(
        {
          metric: "document_chunker.duration_ms",
          value: duration,
          source,
          filePath,
          chunkCount: documentChunks.length,
          documentType: extractionResult.metadata.documentType,
        },
        "Document chunking complete"
      );

      return documentChunks;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.docLogger.error(
        {
          metric: "document_chunker.error",
          duration_ms: duration,
          source,
          filePath,
          err: error,
        },
        "Document chunking failed"
      );

      if (error instanceof ChunkingError) {
        throw error;
      }

      throw new ChunkingError(
        `Failed to chunk document ${filePath}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        filePath,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Chunk document by page boundaries.
   *
   * Each page is chunked independently using FileChunker, with chunk
   * indices adjusted to form a continuous sequence across all pages.
   *
   * @param extractionResult - Extraction result with pages
   * @param filePath - File path
   * @param source - Source name
   * @returns Combined FileChunks from all pages with page metadata
   */
  private chunkByPages(
    extractionResult: ExtractionResult,
    filePath: string,
    source: string
  ): FileChunk[] {
    const pages = extractionResult.pages!;
    const allChunks: FileChunk[] = [];
    let globalChunkIndex = 0;

    for (const page of pages) {
      if (!page.content || page.content.trim().length === 0) {
        continue;
      }

      const fileInfo = this.createDocumentFileInfo(extractionResult, filePath);
      const pageChunks = this.chunkFile(page.content, fileInfo, source);

      // Adjust chunk indices and add page number to metadata
      for (const chunk of pageChunks) {
        allChunks.push({
          ...chunk,
          id: createChunkId(source, filePath, globalChunkIndex),
          chunkIndex: globalChunkIndex,
          metadata: {
            ...chunk.metadata,
            // Store page number as a custom property via type assertion
            // This will be picked up during DocumentChunk conversion
          },
        });
        // Tag the chunk with page number for later conversion
        (chunk as FileChunk & { _pageNumber?: number })._pageNumber = page.pageNumber;
        allChunks[allChunks.length - 1] = {
          ...allChunks[allChunks.length - 1]!,
        };
        (allChunks[allChunks.length - 1] as FileChunk & { _pageNumber?: number })._pageNumber =
          page.pageNumber;
        globalChunkIndex++;
      }
    }

    // Fix totalChunks for all chunks
    const totalChunks = allChunks.length;
    for (let i = 0; i < allChunks.length; i++) {
      allChunks[i] = {
        ...allChunks[i]!,
        totalChunks,
      };
    }

    return allChunks;
  }

  /**
   * Chunk document by paragraph boundaries.
   *
   * Splits content at double-newline boundaries and groups paragraphs
   * into chunks respecting the token limit. Falls back to line-level
   * splitting for individual paragraphs that exceed the token limit.
   *
   * @param content - Full document content
   * @param filePath - File path
   * @param source - Source name
   * @param extractionResult - Full extraction result for fallback FileInfo
   * @returns FileChunks grouped by paragraph boundaries
   */
  private chunkByParagraphs(
    content: string,
    filePath: string,
    source: string,
    extractionResult: ExtractionResult
  ): FileChunk[] {
    const normalizedContent = content.replace(/\r\n?/g, "\n");
    const paragraphs = this.splitIntoParagraphs(normalizedContent);

    if (paragraphs.length === 0) {
      return [];
    }

    const allChunks: FileChunk[] = [];
    let currentParagraphs: ParagraphBlock[] = [];
    let currentTokens = 0;
    const fileInfo = this.createDocumentFileInfo(extractionResult, filePath);

    for (const paragraph of paragraphs) {
      const paragraphTokens = estimateTokens(paragraph.content);

      // If single paragraph exceeds limit, chunk it with line-level splitting
      if (paragraphTokens > this.maxTokens && currentParagraphs.length === 0) {
        const lineChunks = this.chunkFile(paragraph.content, fileInfo, source);
        for (const chunk of lineChunks) {
          allChunks.push({
            ...chunk,
            startLine: paragraph.startLine + chunk.startLine - 1,
            endLine: paragraph.startLine + chunk.endLine - 1,
          });
        }
        continue;
      }

      // If adding this paragraph would exceed limit, flush current group
      if (currentTokens + paragraphTokens > this.maxTokens && currentParagraphs.length > 0) {
        allChunks.push(
          this.createChunkFromParagraphs(currentParagraphs, filePath, source, fileInfo)
        );
        currentParagraphs = [];
        currentTokens = 0;
      }

      currentParagraphs.push(paragraph);
      currentTokens += paragraphTokens;
    }

    // Flush remaining paragraphs
    if (currentParagraphs.length > 0) {
      allChunks.push(this.createChunkFromParagraphs(currentParagraphs, filePath, source, fileInfo));
    }

    // Fix chunk indices and totalChunks
    const totalChunks = allChunks.length;
    for (let i = 0; i < allChunks.length; i++) {
      allChunks[i] = {
        ...allChunks[i]!,
        id: createChunkId(source, filePath, i),
        chunkIndex: i,
        totalChunks,
      };
    }

    return allChunks;
  }

  /**
   * Split content into paragraph blocks, tracking line numbers and offsets.
   *
   * Paragraphs are delimited by one or more blank lines (double newlines).
   * Empty paragraphs (whitespace-only) are skipped.
   *
   * @param content - Normalized content (LF line endings)
   * @returns Array of paragraph blocks with position tracking
   */
  private splitIntoParagraphs(content: string): ParagraphBlock[] {
    const paragraphs: ParagraphBlock[] = [];
    const rawParagraphs = content.split(/\n\n+/);

    let charOffset = 0;
    let lineNumber = 1;

    for (const rawParagraph of rawParagraphs) {
      const trimmed = rawParagraph.trim();
      if (trimmed.length === 0) {
        // Track the blank lines we're skipping
        const blankLines = rawParagraph.split("\n").length;
        charOffset += rawParagraph.length + 2; // +2 for the \n\n delimiter
        lineNumber += blankLines;
        continue;
      }

      const paragraphLines = trimmed.split("\n");
      const startLine = lineNumber;
      const endLine = startLine + paragraphLines.length - 1;

      paragraphs.push({
        content: trimmed,
        startLine,
        endLine,
        charOffset,
      });

      // Advance past this paragraph + delimiter
      const rawLines = rawParagraph.split("\n");
      lineNumber += rawLines.length + 1; // +1 for one of the delimiter newlines
      charOffset += rawParagraph.length + 2;
    }

    return paragraphs;
  }

  /**
   * Create a FileChunk from a group of paragraphs.
   *
   * @param paragraphs - Paragraphs to combine into a chunk
   * @param filePath - File path
   * @param source - Source name
   * @param fileInfo - FileInfo for metadata
   * @returns FileChunk from combined paragraphs
   */
  private createChunkFromParagraphs(
    paragraphs: ParagraphBlock[],
    filePath: string,
    source: string,
    fileInfo: FileInfo
  ): FileChunk {
    const content = paragraphs.map((p) => p.content).join("\n\n");
    const firstParagraph = paragraphs[0]!;
    const lastParagraph = paragraphs[paragraphs.length - 1]!;

    return {
      id: createChunkId(source, filePath, 0), // Will be updated later
      repository: source,
      filePath,
      content,
      chunkIndex: 0, // Will be updated later
      totalChunks: 0, // Will be updated later
      startLine: firstParagraph.startLine,
      endLine: lastParagraph.endLine,
      metadata: {
        extension: fileInfo.extension,
        language: detectLanguage(filePath),
        fileSizeBytes: fileInfo.sizeBytes,
        contentHash: computeContentHash(content),
        fileModifiedAt: fileInfo.modifiedAt,
      },
    };
  }

  /**
   * Convert FileChunks to DocumentChunks with document-specific metadata.
   *
   * Adds document type, title, author, page numbers, and section headings.
   *
   * @param fileChunks - Source FileChunks
   * @param extractionResult - Extraction result for document metadata
   * @param filePath - File path
   * @param source - Source name
   * @returns DocumentChunks with enriched metadata
   */
  private convertToDocumentChunks(
    fileChunks: FileChunk[],
    extractionResult: ExtractionResult,
    filePath: string,
    source: string
  ): DocumentChunk[] {
    const normalizedContent = extractionResult.content.replace(/\r\n?/g, "\n");

    return fileChunks.map((chunk, index) => {
      const pageNumber = (chunk as FileChunk & { _pageNumber?: number })._pageNumber;

      // Find section heading context
      let sectionHeading: string | undefined;
      if (this.includeSectionContext && extractionResult.sections) {
        sectionHeading = this.findSectionHeading(
          extractionResult.sections,
          chunk.content,
          normalizedContent
        );
      }

      const documentMetadata: DocumentChunkMetadata = {
        extension: chunk.metadata.extension,
        language: chunk.metadata.language,
        fileSizeBytes: chunk.metadata.fileSizeBytes,
        contentHash: chunk.metadata.contentHash,
        fileModifiedAt: chunk.metadata.fileModifiedAt,
        documentType: extractionResult.metadata.documentType,
        pageNumber,
        sectionHeading,
        documentTitle: extractionResult.metadata.title,
        documentAuthor: extractionResult.metadata.author,
      };

      return {
        id: createChunkId(source, filePath, index),
        repository: source,
        filePath,
        content: chunk.content,
        chunkIndex: index,
        totalChunks: fileChunks.length,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        metadata: documentMetadata,
      };
    });
  }

  /**
   * Find the nearest preceding section heading for a chunk's content.
   *
   * Searches for the chunk content's position in the full document,
   * then finds the section whose start offset is closest to (but not after)
   * that position.
   *
   * @param sections - Document sections with offsets
   * @param chunkContent - Content of the chunk to find heading for
   * @param fullContent - Full normalized document content
   * @returns Section heading title, or undefined if none found
   */
  private findSectionHeading(
    sections: SectionInfo[],
    chunkContent: string,
    fullContent: string
  ): string | undefined {
    if (sections.length === 0) {
      return undefined;
    }

    // Find approximate position of chunk content in full document
    const chunkStart = fullContent.indexOf(
      chunkContent.substring(0, Math.min(100, chunkContent.length))
    );
    if (chunkStart === -1) {
      // Chunk content not found in full content - try first line
      const firstLine = chunkContent.split("\n")[0] ?? "";
      const lineStart = fullContent.indexOf(firstLine.substring(0, Math.min(80, firstLine.length)));
      if (lineStart === -1) {
        return undefined;
      }
      return this.findNearestSection(sections, lineStart);
    }

    return this.findNearestSection(sections, chunkStart);
  }

  /**
   * Find the nearest section whose startOffset is at or before the given position.
   *
   * @param sections - Sorted sections
   * @param position - Character position in content
   * @returns Section title or undefined
   */
  private findNearestSection(sections: SectionInfo[], position: number): string | undefined {
    let nearest: SectionInfo | undefined;

    for (const section of sections) {
      if (section.startOffset <= position) {
        if (!nearest || section.startOffset > nearest.startOffset) {
          nearest = section;
        }
      }
    }

    return nearest?.title;
  }

  /**
   * Build a FileInfo object from an ExtractionResult for use with FileChunker.
   *
   * @param extractionResult - Source extraction result
   * @param filePath - Relative file path
   * @returns FileInfo compatible with FileChunker.chunkFile()
   */
  private createDocumentFileInfo(extractionResult: ExtractionResult, filePath: string): FileInfo {
    const ext = filePath.includes(".") ? `.${filePath.split(".").pop()!.toLowerCase()}` : "";

    return {
      relativePath: filePath,
      absolutePath: extractionResult.metadata.filePath,
      extension: ext,
      sizeBytes: extractionResult.metadata.fileSizeBytes,
      modifiedAt: extractionResult.metadata.fileModifiedAt,
    };
  }
}
