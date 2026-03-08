/**
 * Document-aware chunker extending FileChunker for document ingestion.
 *
 * Provides paragraph-aware, page-aware, and section-context chunking
 * for PDF, DOCX, Markdown, and plain text documents. Extends the
 * existing FileChunker to maintain compatibility with the embedding pipeline.
 *
 * @module documents/DocumentChunker
 */

import * as path from "node:path";
import type pino from "pino";
import { getComponentLogger } from "../logging/index.js";
import { FileChunker } from "../ingestion/file-chunker.js";
import type { FileInfo, FileChunk } from "../ingestion/types.js";
import { ChunkingError, ValidationError } from "../ingestion/errors.js";
import { detectLanguage } from "../ingestion/language-detector.js";
import { estimateTokens, computeContentHash, createChunkId } from "../ingestion/chunk-utils.js";
import type {
  ExtractionResult,
  SectionInfo,
  DocumentChunk,
  DocumentChunkMetadata,
  DocumentChunkerConfig,
} from "./types.js";

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
 * Position data associated with each chunk for metadata enrichment.
 *
 * Provides a type-safe side channel for passing page numbers and
 * character offsets from chunking strategies to the conversion step,
 * avoiding ad-hoc properties on FileChunk objects.
 */
interface ChunkPositionData {
  /** Page number (1-based) for page-boundary chunks */
  pageNumber?: number;
  /** Character offset in the full document content */
  charOffset?: number;
}

/**
 * Document-aware chunker for Phase 6 document ingestion.
 *
 * Extends FileChunker with document-specific chunking strategies:
 * - **Page-boundary chunking**: Chunks each PDF page independently
 * - **Paragraph-boundary chunking**: Splits at paragraph boundaries (double newlines)
 *   with whole-paragraph overlap between consecutive chunks for semantic continuity
 * - **Section heading context**: Attaches nearest section heading to each chunk
 * - **Document metadata**: Preserves document type, title, and author in chunk metadata
 *
 * When paragraphs exceed token limits, falls back through a hierarchy:
 * **Paragraph > Sentence > Word > (oversized word in own chunk)**.
 * Sentence boundaries use punctuation followed by whitespace; word boundaries
 * use whitespace splitting. Single words exceeding the token limit are emitted
 * as their own chunk (never broken mid-word).
 *
 * When `overlapTokens > 0`, paragraph-boundary chunking carries the last N whole
 * paragraphs (fitting within the overlap budget) from the flushed group into the
 * next group, analogous to how FileChunker's `getOverlapLines` carries lines.
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
  private readonly overlapTokens: number;

  /**
   * Create a new DocumentChunker instance.
   *
   * Configuration priority: defaults -> constructor params -> environment variables.
   * The CHUNK_MAX_TOKENS and CHUNK_OVERLAP_TOKENS env vars are respected for
   * consistency with FileChunker.
   *
   * @param config - Document chunker configuration
   */
  constructor(config?: DocumentChunkerConfig) {
    super({
      maxChunkTokens: config?.maxChunkTokens,
      overlapTokens: config?.overlapTokens,
    });

    this.docLogger = getComponentLogger("documents:chunker");

    // Apply CHUNK_MAX_TOKENS env var override, matching FileChunker behavior
    const envMaxTokens = process.env["CHUNK_MAX_TOKENS"];
    const parsedEnv = envMaxTokens ? parseInt(envMaxTokens, 10) : NaN;
    this.maxTokens =
      !isNaN(parsedEnv) && parsedEnv > 0 ? parsedEnv : (config?.maxChunkTokens ?? 500);

    // Apply CHUNK_OVERLAP_TOKENS env var override, matching FileChunker behavior
    const envOverlap = process.env["CHUNK_OVERLAP_TOKENS"];
    const parsedOverlap = envOverlap ? parseInt(envOverlap, 10) : NaN;
    this.overlapTokens =
      !isNaN(parsedOverlap) && parsedOverlap >= 0 ? parsedOverlap : (config?.overlapTokens ?? 50);

    this.respectParagraphs = config?.respectParagraphs ?? true;
    this.includeSectionContext = config?.includeSectionContext ?? true;
    this.respectPageBoundaries = config?.respectPageBoundaries ?? true;

    this.docLogger.debug(
      {
        respectParagraphs: this.respectParagraphs,
        includeSectionContext: this.includeSectionContext,
        respectPageBoundaries: this.respectPageBoundaries,
        maxTokens: this.maxTokens,
        overlapTokens: this.overlapTokens,
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
   * @throws {ValidationError} If source or filePath is invalid
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

    // Validate file path
    if (!filePath || filePath.trim().length === 0) {
      throw new ValidationError("File path cannot be empty", "filePath");
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
      let positions: ChunkPositionData[] | undefined;

      // Strategy 1: Page-boundary chunking for multi-page documents
      if (
        this.respectPageBoundaries &&
        extractionResult.pages &&
        extractionResult.pages.length > 0
      ) {
        const result = this.chunkByPages(extractionResult, filePath, source);
        fileChunks = result.chunks;
        positions = result.positions;
      }
      // Strategy 2: Paragraph-boundary chunking
      else if (this.respectParagraphs) {
        const result = this.chunkByParagraphs(
          extractionResult.content,
          filePath,
          source,
          extractionResult
        );
        fileChunks = result.chunks;
        positions = result.positions;
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
        source,
        positions
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

      if (error instanceof ChunkingError || error instanceof ValidationError) {
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
   * Page numbers and character offsets are tracked via a parallel
   * positions array for type-safe metadata enrichment.
   *
   * @param extractionResult - Extraction result with pages
   * @param filePath - File path
   * @param source - Source name
   * @returns Chunks and their position data
   */
  private chunkByPages(
    extractionResult: ExtractionResult,
    filePath: string,
    source: string
  ): { chunks: FileChunk[]; positions: ChunkPositionData[] } {
    const pages = extractionResult.pages!;
    const allChunks: FileChunk[] = [];
    const positions: ChunkPositionData[] = [];
    let globalChunkIndex = 0;

    // Find each page's position in the full document for section heading lookup
    const fullContent = extractionResult.content.replace(/\r\n?/g, "\n");
    let pageSearchOffset = 0;

    for (const page of pages) {
      if (!page.content || page.content.trim().length === 0) {
        continue;
      }

      // Find this page's position in the full document
      const normalizedPageContent = page.content.replace(/\r\n?/g, "\n").trim();
      const pageStart = fullContent.indexOf(normalizedPageContent, pageSearchOffset);
      const pageOffset = pageStart !== -1 ? pageStart : pageSearchOffset;

      const fileInfo = this.createDocumentFileInfo(extractionResult, filePath);
      const pageChunks = this.chunkFile(page.content, fileInfo, source);

      for (const chunk of pageChunks) {
        allChunks.push({
          ...chunk,
          id: createChunkId(source, filePath, globalChunkIndex),
          chunkIndex: globalChunkIndex,
        });
        positions.push({
          pageNumber: page.pageNumber,
          charOffset: pageOffset,
        });
        globalChunkIndex++;
      }

      // Advance search offset past this page
      if (pageStart !== -1) {
        pageSearchOffset = pageStart + normalizedPageContent.length;
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

    return { chunks: allChunks, positions };
  }

  /**
   * Chunk document by paragraph boundaries.
   *
   * Splits content at double-newline boundaries and groups paragraphs
   * into chunks respecting the token limit. When `overlapTokens > 0`,
   * the last N whole paragraphs fitting within the overlap budget are
   * carried from the flushed group into the next group for semantic
   * continuity across chunk boundaries. Falls back through sentence
   * and word boundaries for individual paragraphs that exceed the token limit.
   * Character offsets are tracked for section heading lookup.
   *
   * @param content - Full document content
   * @param filePath - File path
   * @param source - Source name
   * @param extractionResult - Full extraction result for fallback FileInfo
   * @returns Chunks and their position data
   */
  private chunkByParagraphs(
    content: string,
    filePath: string,
    source: string,
    extractionResult: ExtractionResult
  ): { chunks: FileChunk[]; positions: ChunkPositionData[] } {
    const normalizedContent = content.replace(/\r\n?/g, "\n");
    const paragraphs = this.splitIntoParagraphs(normalizedContent);

    if (paragraphs.length === 0) {
      return { chunks: [], positions: [] };
    }

    const allChunks: FileChunk[] = [];
    const positions: ChunkPositionData[] = [];
    let currentParagraphs: ParagraphBlock[] = [];
    let currentTokens = 0;
    let overlapCount = 0; // Track how many leading paragraphs are overlap from previous group
    const fileInfo = this.createDocumentFileInfo(extractionResult, filePath);

    for (const paragraph of paragraphs) {
      const paragraphTokens = estimateTokens(paragraph.content);

      // If single paragraph exceeds limit, chunk it with sentence/word fallbacks
      if (paragraphTokens > this.maxTokens && currentParagraphs.length === 0) {
        const subResult = this.chunkOversizedParagraph(paragraph, fileInfo, source, filePath);
        allChunks.push(...subResult.chunks);
        positions.push(...subResult.positions);
        overlapCount = 0;
        continue;
      }

      // If adding this paragraph would exceed limit, flush current group
      if (currentTokens + paragraphTokens > this.maxTokens && currentParagraphs.length > 0) {
        allChunks.push(
          this.createChunkFromParagraphs(currentParagraphs, filePath, source, fileInfo)
        );
        // Use the first non-overlap paragraph's offset for section heading lookup,
        // falling back to the first paragraph if the group is entirely overlap
        const posIndex = Math.min(overlapCount, currentParagraphs.length - 1);
        positions.push({ charOffset: currentParagraphs[posIndex]!.charOffset });

        // Seed next group with overlap paragraphs from the tail of the flushed group
        const overlapParas = this.getOverlapParagraphs(currentParagraphs, this.overlapTokens);
        currentParagraphs = [...overlapParas];
        currentTokens = overlapParas.reduce((sum, p) => sum + estimateTokens(p.content), 0);
        overlapCount = overlapParas.length;
      }

      currentParagraphs.push(paragraph);
      currentTokens += paragraphTokens;
    }

    // Flush remaining paragraphs
    if (currentParagraphs.length > 0) {
      allChunks.push(this.createChunkFromParagraphs(currentParagraphs, filePath, source, fileInfo));
      const posIndex = Math.min(overlapCount, currentParagraphs.length - 1);
      positions.push({ charOffset: currentParagraphs[posIndex]!.charOffset });
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

    return { chunks: allChunks, positions };
  }

  /**
   * Split content into paragraph blocks, tracking line numbers and offsets.
   *
   * Uses a delimiter-capturing split to accurately track line numbers
   * even when paragraphs are separated by 3+ consecutive newlines.
   * Empty paragraphs (whitespace-only) are skipped.
   *
   * @param content - Normalized content (LF line endings)
   * @returns Array of paragraph blocks with position tracking
   */
  private splitIntoParagraphs(content: string): ParagraphBlock[] {
    const paragraphs: ParagraphBlock[] = [];

    // Split with delimiter capture: parts alternate [content, delimiter, content, ...]
    const parts = content.split(/(\n\n+)/);

    let charOffset = 0;
    let lineNumber = 1;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;

      if (i % 2 === 1) {
        // Delimiter part - count actual newlines for accurate line tracking
        const newlineCount = part.split("\n").length - 1;
        lineNumber += newlineCount;
        charOffset += part.length;
        continue;
      }

      // Content part
      const trimmed = part.trim();
      if (trimmed.length === 0) {
        // Whitespace-only content - count any internal newlines
        const newlineCount = part.split("\n").length - 1;
        lineNumber += newlineCount;
        charOffset += part.length;
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

      // Advance past this content part's lines
      const partNewlineCount = part.split("\n").length - 1;
      lineNumber += partNewlineCount;
      charOffset += part.length;
    }

    return paragraphs;
  }

  /**
   * Extract overlap paragraphs from the end of a flushed paragraph group.
   *
   * Takes whole paragraphs from the tail of the group until the overlap
   * token budget is reached. Analogous to `getOverlapLines` in FileChunker,
   * but operates on whole paragraphs to maintain the paragraph-boundary
   * chunking contract.
   *
   * @param paragraphs - Paragraphs from the flushed group
   * @param overlapTokens - Token budget for overlap
   * @returns Paragraphs to carry into the next group
   */
  private getOverlapParagraphs(
    paragraphs: ParagraphBlock[],
    overlapTokens: number
  ): ParagraphBlock[] {
    if (paragraphs.length === 0 || overlapTokens <= 0) {
      return [];
    }

    const overlap: ParagraphBlock[] = [];
    let tokens = 0;

    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const pTokens = estimateTokens(paragraphs[i]!.content);

      // Stop if adding this paragraph would exceed the overlap budget
      // (but include at least one paragraph if possible)
      if (tokens + pTokens > overlapTokens && overlap.length > 0) {
        break;
      }

      overlap.unshift(paragraphs[i]!);
      tokens += pTokens;
    }

    return overlap;
  }

  /**
   * Split text into sentences at punctuation boundaries.
   *
   * Uses a lookbehind regex to split after sentence-ending punctuation
   * (`.`, `!`, `?`) followed by whitespace. Keeps punctuation attached
   * to the preceding sentence. Imperfect for abbreviations and decimals,
   * but acceptable for document chunking purposes.
   *
   * @param text - Text to split into sentences
   * @returns Array of sentences (at least one element)
   */
  private splitIntoSentences(text: string): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
    return sentences.length > 0 ? sentences : [text];
  }

  /**
   * Split text into words on whitespace boundaries.
   *
   * @param text - Text to split into words
   * @returns Array of words (empty strings filtered out)
   */
  private splitIntoWords(text: string): string[] {
    return text.split(/\s+/).filter((w) => w.length > 0);
  }

  /**
   * Chunk an oversized paragraph using sentence and word boundary fallbacks.
   *
   * Fallback hierarchy:
   * 1. If paragraph has internal newlines, try line-level splitting first
   * 2. Split into sentences and group into chunks respecting maxTokens
   * 3. For sentences exceeding maxTokens, split by words
   * 4. Single words exceeding maxTokens get their own chunk (never broken mid-word)
   *
   * @param paragraph - The oversized paragraph block
   * @param fileInfo - FileInfo for metadata
   * @param source - Repository or source name
   * @param filePath - Relative file path
   * @returns Chunks and their position data
   */
  private chunkOversizedParagraph(
    paragraph: ParagraphBlock,
    fileInfo: FileInfo,
    source: string,
    filePath: string
  ): { chunks: FileChunk[]; positions: ChunkPositionData[] } {
    // If paragraph has internal newlines, try line-level splitting first
    if (paragraph.content.includes("\n")) {
      const lineChunks = this.chunkFile(paragraph.content, fileInfo, source);
      // Check if line-level produced reasonable chunks (all within limit)
      const allWithinLimit = lineChunks.every(
        (chunk) => estimateTokens(chunk.content) <= this.maxTokens
      );
      if (allWithinLimit) {
        const chunks = lineChunks.map((chunk) => ({
          ...chunk,
          startLine: paragraph.startLine + chunk.startLine - 1,
          endLine: paragraph.startLine + chunk.endLine - 1,
        }));
        const positions = chunks.map(() => ({ charOffset: paragraph.charOffset }));
        return { chunks, positions };
      }
    }

    // Sentence-level splitting
    const sentences = this.splitIntoSentences(paragraph.content);
    const resultChunks: FileChunk[] = [];
    const resultPositions: ChunkPositionData[] = [];
    let currentParts: string[] = [];
    let currentTokens = 0;

    const flushCurrent = (): void => {
      if (currentParts.length === 0) return;
      const content = currentParts.join(" ");
      resultChunks.push({
        id: createChunkId(source, filePath, resultChunks.length),
        repository: source,
        filePath,
        content,
        chunkIndex: resultChunks.length,
        totalChunks: 0, // Updated later
        startLine: paragraph.startLine,
        endLine: paragraph.endLine,
        metadata: {
          extension: fileInfo.extension,
          language: detectLanguage(filePath),
          fileSizeBytes: fileInfo.sizeBytes,
          contentHash: computeContentHash(content),
          fileModifiedAt: fileInfo.modifiedAt,
        },
      });
      resultPositions.push({ charOffset: paragraph.charOffset });
      currentParts = [];
      currentTokens = 0;
    };

    for (const sentence of sentences) {
      const sentenceTokens = estimateTokens(sentence);

      // If sentence itself exceeds limit, split by words
      if (sentenceTokens > this.maxTokens) {
        flushCurrent();
        const wordChunks = this.chunkByWords(sentence, paragraph, fileInfo, source, filePath);
        resultChunks.push(...wordChunks.chunks);
        resultPositions.push(...wordChunks.positions);
        continue;
      }

      // If adding this sentence would exceed limit, flush first
      if (currentTokens + sentenceTokens > this.maxTokens && currentParts.length > 0) {
        flushCurrent();
      }

      currentParts.push(sentence);
      currentTokens += sentenceTokens;
    }

    flushCurrent();

    return { chunks: resultChunks, positions: resultPositions };
  }

  /**
   * Chunk text by word boundaries when sentence-level splitting is insufficient.
   *
   * Groups words into chunks respecting maxTokens. Single words exceeding
   * the limit are emitted as their own chunk (never broken mid-word).
   *
   * @param text - Text to chunk by words
   * @param paragraph - Source paragraph for position data
   * @param fileInfo - FileInfo for metadata
   * @param source - Repository or source name
   * @param filePath - Relative file path
   * @returns Chunks and their position data
   */
  private chunkByWords(
    text: string,
    paragraph: ParagraphBlock,
    fileInfo: FileInfo,
    source: string,
    filePath: string
  ): { chunks: FileChunk[]; positions: ChunkPositionData[] } {
    const words = this.splitIntoWords(text);
    const resultChunks: FileChunk[] = [];
    const resultPositions: ChunkPositionData[] = [];
    let currentWords: string[] = [];
    let currentTokens = 0;

    const flushWords = (): void => {
      if (currentWords.length === 0) return;
      const content = currentWords.join(" ");
      resultChunks.push({
        id: createChunkId(source, filePath, resultChunks.length),
        repository: source,
        filePath,
        content,
        chunkIndex: resultChunks.length,
        totalChunks: 0,
        startLine: paragraph.startLine,
        endLine: paragraph.endLine,
        metadata: {
          extension: fileInfo.extension,
          language: detectLanguage(filePath),
          fileSizeBytes: fileInfo.sizeBytes,
          contentHash: computeContentHash(content),
          fileModifiedAt: fileInfo.modifiedAt,
        },
      });
      resultPositions.push({ charOffset: paragraph.charOffset });
      currentWords = [];
      currentTokens = 0;
    };

    for (const word of words) {
      const wordTokens = estimateTokens(word);

      // Single word exceeds limit - emit as its own chunk
      if (wordTokens > this.maxTokens) {
        flushWords();
        const content = word;
        resultChunks.push({
          id: createChunkId(source, filePath, resultChunks.length),
          repository: source,
          filePath,
          content,
          chunkIndex: resultChunks.length,
          totalChunks: 0,
          startLine: paragraph.startLine,
          endLine: paragraph.endLine,
          metadata: {
            extension: fileInfo.extension,
            language: detectLanguage(filePath),
            fileSizeBytes: fileInfo.sizeBytes,
            contentHash: computeContentHash(content),
            fileModifiedAt: fileInfo.modifiedAt,
          },
        });
        resultPositions.push({ charOffset: paragraph.charOffset });
        continue;
      }

      if (currentTokens + wordTokens > this.maxTokens && currentWords.length > 0) {
        flushWords();
      }

      currentWords.push(word);
      currentTokens += wordTokens;
    }

    flushWords();

    return { chunks: resultChunks, positions: resultPositions };
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
   * Uses the optional positions array for type-safe page number and
   * character offset lookup instead of ad-hoc properties.
   *
   * @param fileChunks - Source FileChunks
   * @param extractionResult - Extraction result for document metadata
   * @param filePath - File path
   * @param source - Source name
   * @param positions - Optional parallel array of position data per chunk
   * @returns DocumentChunks with enriched metadata
   */
  private convertToDocumentChunks(
    fileChunks: FileChunk[],
    extractionResult: ExtractionResult,
    filePath: string,
    source: string,
    positions?: ChunkPositionData[]
  ): DocumentChunk[] {
    const normalizedContent = extractionResult.content.replace(/\r\n?/g, "\n");

    return fileChunks.map((chunk, index) => {
      const posData = positions?.[index];

      // Find section heading context
      let sectionHeading: string | undefined;
      if (this.includeSectionContext && extractionResult.sections) {
        sectionHeading = this.findSectionHeading(
          extractionResult.sections,
          chunk.content,
          normalizedContent,
          posData?.charOffset
        );
      }

      // Fallback to document title when no section heading found
      if (this.includeSectionContext && !sectionHeading && extractionResult.metadata.title) {
        sectionHeading = extractionResult.metadata.title;
      }

      const documentMetadata: DocumentChunkMetadata = {
        extension: chunk.metadata.extension,
        language: chunk.metadata.language,
        fileSizeBytes: chunk.metadata.fileSizeBytes,
        contentHash: chunk.metadata.contentHash,
        fileModifiedAt: chunk.metadata.fileModifiedAt,
        documentType: extractionResult.metadata.documentType,
        pageNumber: posData?.pageNumber,
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
   * Prefers using the provided character offset for accurate lookup.
   * Falls back to searching for the chunk content in the full document
   * when no offset is available (e.g., line-level fallback chunks).
   *
   * @param sections - Document sections with offsets
   * @param chunkContent - Content of the chunk to find heading for
   * @param fullContent - Full normalized document content
   * @param charOffset - Optional character offset for direct lookup
   * @returns Section heading title, or undefined if none found
   */
  protected findSectionHeading(
    sections: SectionInfo[],
    chunkContent: string,
    fullContent: string,
    charOffset?: number
  ): string | undefined {
    if (sections.length === 0) {
      return undefined;
    }

    // Use character offset when available (more reliable than content search)
    if (charOffset !== undefined) {
      return this.findNearestSection(sections, charOffset);
    }

    // Fall back to content search for line-level fallback chunks
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
   * Find the nearest section whose startOffset is at or before the given position,
   * returning the full heading hierarchy (e.g., "Chapter 1 > Section 1.1 > Details").
   *
   * Builds the hierarchy by finding the nearest preceding section at each heading
   * level, walking from the leaf (nearest) up to the root (lowest level number).
   *
   * @param sections - Document sections with offsets and levels
   * @param position - Character position in content
   * @returns Hierarchical section heading string joined with " > ", or undefined
   */
  private findNearestSection(sections: SectionInfo[], position: number): string | undefined {
    // Filter to sections that start at or before the chunk position
    const preceding = sections.filter((s) => s.startOffset <= position);
    if (preceding.length === 0) return undefined;

    // Sort by startOffset descending (nearest first)
    const sorted = [...preceding].sort((a, b) => b.startOffset - a.startOffset);

    // Build hierarchy from leaf to root
    const leaf = sorted[0]!;
    const hierarchy: string[] = [leaf.title];
    let currentLevel = leaf.level;

    for (let i = 1; i < sorted.length; i++) {
      const section = sorted[i]!;
      if (section.level < currentLevel) {
        hierarchy.unshift(section.title);
        currentLevel = section.level;
      }
      if (currentLevel <= 1) break;
    }

    return hierarchy.join(" > ");
  }

  /**
   * Build a FileInfo object from an ExtractionResult for use with FileChunker.
   *
   * @param extractionResult - Source extraction result
   * @param filePath - Relative file path
   * @returns FileInfo compatible with FileChunker.chunkFile()
   */
  private createDocumentFileInfo(extractionResult: ExtractionResult, filePath: string): FileInfo {
    const ext = path.extname(filePath).toLowerCase();

    return {
      relativePath: filePath,
      absolutePath: extractionResult.metadata.filePath,
      extension: ext,
      sizeBytes: extractionResult.metadata.fileSizeBytes,
      modifiedAt: extractionResult.metadata.fileModifiedAt,
    };
  }
}
