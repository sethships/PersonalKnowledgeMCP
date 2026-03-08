/**
 * Table content indexer for ChromaDB.
 *
 * Converts structured {@link TableExtractionResult} arrays into
 * {@link DocumentChunk} arrays suitable for embedding and storage
 * in ChromaDB. Uses Markdown formatting for table content and
 * handles large-table splitting with header repetition.
 *
 * This is a standalone utility with no dependencies on services,
 * storage, or embedding providers. Callers (e.g., the future
 * document ingestion pipeline) are responsible for embedding
 * and storing the returned chunks.
 *
 * @module documents/TableContentIndexer
 */

import type pino from "pino";
import { getComponentLogger } from "../logging/index.js";
import { estimateTokens, computeContentHash } from "../ingestion/chunk-utils.js";
import { TableFormatter } from "./TableFormatter.js";
import type {
  TableExtractionResult,
  DocumentChunk,
  DocumentChunkMetadata,
  DocumentType,
} from "./types.js";

/**
 * Configuration options for {@link TableContentIndexer}.
 *
 * @example
 * ```typescript
 * const config: TableIndexerConfig = {
 *   maxChunkTokens: 800,
 * };
 * ```
 */
export interface TableIndexerConfig {
  /**
   * Maximum tokens per table chunk.
   *
   * Tables exceeding this limit are split by row groups,
   * with the header row(s) repeated in each sub-chunk.
   *
   * @default 500
   */
  maxChunkTokens?: number;
}

/**
 * Contextual information about the source document.
 *
 * Provides the metadata needed to build {@link DocumentChunk} objects
 * with proper IDs, file paths, and document-level metadata.
 *
 * @example
 * ```typescript
 * const context: TableIndexerContext = {
 *   repository: "my-docs",
 *   filePath: "reports/quarterly.pdf",
 *   extension: ".pdf",
 *   fileSizeBytes: 1048576,
 *   fileModifiedAt: new Date("2025-01-15"),
 *   documentType: "pdf",
 *   documentTitle: "Q4 Report",
 * };
 * ```
 */
export interface TableIndexerContext {
  /** Repository or source name (must not contain ':'). */
  repository: string;

  /** File path relative to repository root. */
  filePath: string;

  /** File extension including leading dot (e.g., ".pdf"). */
  extension: string;

  /** Original file size in bytes. */
  fileSizeBytes: number;

  /** File modification timestamp. */
  fileModifiedAt: Date;

  /** Document type of the source file. */
  documentType: DocumentType;

  /** Document title from extraction metadata. */
  documentTitle?: string;

  /** Document author from extraction metadata. */
  documentAuthor?: string;
}

/** Default maximum tokens per table chunk. */
const DEFAULT_MAX_CHUNK_TOKENS = 500;

/**
 * Converts extracted tables into ChromaDB-ready document chunks.
 *
 * For each table in the input array:
 * 1. Formats the table to Markdown via {@link TableFormatter.toMarkdown}
 * 2. Optionally prepends the table caption
 * 3. If the result fits within `maxChunkTokens`, produces a single chunk
 * 4. If it exceeds the limit, splits by row groups with header repetition
 *
 * Chunk IDs follow the format: `{repository}:{filePath}:table-{tableIndex}:{subChunkIndex}`
 *
 * @example
 * ```typescript
 * const indexer = new TableContentIndexer({ maxChunkTokens: 500 });
 * const chunks = indexer.indexTables(tables, context);
 * // chunks are ready for embedding and ChromaDB storage
 * ```
 */
export class TableContentIndexer {
  private readonly logger: pino.Logger;
  private readonly maxChunkTokens: number;

  /**
   * Create a new TableContentIndexer instance.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: TableIndexerConfig) {
    this.logger = getComponentLogger("documents:table-indexer");
    this.maxChunkTokens = config?.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS;

    this.logger.debug({ maxChunkTokens: this.maxChunkTokens }, "TableContentIndexer initialized");
  }

  /**
   * Convert extracted tables into document chunks for ChromaDB indexing.
   *
   * @param tables - Table extraction results from PDF or DOCX extractors
   * @param context - Source document context for metadata
   * @returns Array of document chunks ready for embedding
   */
  indexTables(tables: TableExtractionResult[], context: TableIndexerContext): DocumentChunk[] {
    if (tables.length === 0) {
      this.logger.debug({ filePath: context.filePath }, "No tables to index");
      return [];
    }

    const startTime = Date.now();
    const allChunks: DocumentChunk[] = [];

    for (const tableResult of tables) {
      const tableChunks = this.indexSingleTable(tableResult, context);
      allChunks.push(...tableChunks);
    }

    const duration = Date.now() - startTime;
    this.logger.info(
      {
        metric: "table_indexer.duration_ms",
        value: duration,
        filePath: context.filePath,
        tableCount: tables.length,
        chunkCount: allChunks.length,
      },
      "Table indexing complete"
    );

    return allChunks;
  }

  /**
   * Index a single table into one or more chunks.
   *
   * @param tableResult - Single table extraction result
   * @param context - Source document context
   * @returns Array of chunks for this table
   */
  private indexSingleTable(
    tableResult: TableExtractionResult,
    context: TableIndexerContext
  ): DocumentChunk[] {
    const { table } = tableResult;

    // Format to markdown
    const markdown = TableFormatter.toMarkdown(table);
    if (markdown.length === 0) {
      this.logger.debug(
        { tableIndex: tableResult.tableIndex, filePath: context.filePath },
        "Skipping empty table"
      );
      return [];
    }

    // Prepend caption if available
    const fullContent = table.caption ? `**Table: ${table.caption}**\n\n${markdown}` : markdown;

    // Count data rows (non-header rows)
    const dataRowCount = table.rows.filter((r) => !r.isHeader).length;

    // Check if it fits in a single chunk
    const tokens = estimateTokens(fullContent);
    if (tokens <= this.maxChunkTokens) {
      const chunk = this.buildChunk(
        fullContent,
        tableResult,
        context,
        dataRowCount,
        0, // subChunkIndex
        1 // totalSubChunks
      );
      return [chunk];
    }

    // Split large table by row groups
    return this.splitLargeTable(tableResult, context, dataRowCount);
  }

  /**
   * Split a large table into multiple chunks with header repetition.
   *
   * Extracts header rows from the table, then groups data rows
   * until the token budget is reached. Each sub-chunk includes
   * the header rows for independent comprehension.
   *
   * @param tableResult - Table extraction result
   * @param context - Source document context
   * @param dataRowCount - Total number of data rows
   * @returns Array of sub-chunks
   */
  private splitLargeTable(
    tableResult: TableExtractionResult,
    context: TableIndexerContext,
    dataRowCount: number
  ): DocumentChunk[] {
    const { table } = tableResult;
    const headerRows = table.rows.filter((r) => r.isHeader);
    const dataRows = table.rows.filter((r) => !r.isHeader);

    // Build header markdown (used as prefix for each sub-chunk)
    const headerTable = {
      rows: headerRows,
      columnCount: table.columnCount,
    };
    const headerMarkdown = headerRows.length > 0 ? TableFormatter.toMarkdown(headerTable) : "";

    // Build caption prefix
    const captionPrefix = table.caption ? `**Table: ${table.caption}**\n\n` : "";

    // Calculate token budget for data rows in each chunk
    const headerTokens = estimateTokens(captionPrefix + headerMarkdown);
    // Reserve at least 1 token for a separator line between header and data
    const separatorTokens = headerMarkdown.length > 0 ? estimateTokens("\n") : 0;
    const dataTokenBudget = Math.max(1, this.maxChunkTokens - headerTokens - separatorTokens);

    // Group data rows into sub-chunks
    const subChunks: DocumentChunk[] = [];
    let currentDataRows: typeof dataRows = [];
    let currentTokens = 0;

    for (const row of dataRows) {
      // Build a temporary single-row table to estimate tokens
      const rowTable = {
        rows: [row],
        columnCount: table.columnCount,
      };
      const rowMarkdown = TableFormatter.toMarkdown(rowTable);
      const rowTokens = estimateTokens(rowMarkdown);

      // Flush current group if adding this row would exceed budget
      if (currentDataRows.length > 0 && currentTokens + rowTokens > dataTokenBudget) {
        subChunks.push(
          this.buildSubChunk(
            headerRows,
            currentDataRows,
            table.columnCount,
            table.caption,
            tableResult,
            context,
            dataRowCount,
            subChunks.length
          )
        );
        currentDataRows = [];
        currentTokens = 0;
      }

      currentDataRows.push(row);
      currentTokens += rowTokens;
    }

    // Flush remaining rows
    if (currentDataRows.length > 0) {
      subChunks.push(
        this.buildSubChunk(
          headerRows,
          currentDataRows,
          table.columnCount,
          table.caption,
          tableResult,
          context,
          dataRowCount,
          subChunks.length
        )
      );
    }

    // Fix totalChunks in all sub-chunks
    const totalSubChunks = subChunks.length;
    return subChunks.map((chunk, index) => ({
      ...chunk,
      id: this.buildChunkId(context.repository, context.filePath, tableResult.tableIndex, index),
      chunkIndex: index,
      totalChunks: totalSubChunks,
    }));
  }

  /**
   * Build a sub-chunk from header rows and a group of data rows.
   *
   * @param headerRows - Header rows to prepend
   * @param dataRows - Data rows for this sub-chunk
   * @param columnCount - Number of columns
   * @param caption - Optional table caption
   * @param tableResult - Original table extraction result
   * @param context - Source document context
   * @param dataRowCount - Total data rows across all sub-chunks
   * @param subChunkIndex - Index of this sub-chunk
   * @returns Document chunk
   */
  private buildSubChunk(
    headerRows: typeof tableResult.table.rows,
    dataRows: typeof tableResult.table.rows,
    columnCount: number,
    caption: string | undefined,
    tableResult: TableExtractionResult,
    context: TableIndexerContext,
    dataRowCount: number,
    subChunkIndex: number
  ): DocumentChunk {
    const subTable = {
      rows: [...headerRows, ...dataRows],
      columnCount,
      caption,
    };
    const markdown = TableFormatter.toMarkdown(subTable);
    const fullContent = caption ? `**Table: ${caption}**\n\n${markdown}` : markdown;

    return this.buildChunk(
      fullContent,
      tableResult,
      context,
      dataRowCount,
      subChunkIndex,
      0 // placeholder - will be corrected in splitLargeTable
    );
  }

  /**
   * Build a single document chunk with table metadata.
   *
   * @param content - Markdown content for the chunk
   * @param tableResult - Source table extraction result
   * @param context - Source document context
   * @param dataRowCount - Number of data rows in the source table
   * @param subChunkIndex - Sub-chunk index within this table
   * @param totalSubChunks - Total sub-chunks for this table
   * @returns Complete document chunk
   */
  private buildChunk(
    content: string,
    tableResult: TableExtractionResult,
    context: TableIndexerContext,
    dataRowCount: number,
    subChunkIndex: number,
    totalSubChunks: number
  ): DocumentChunk {
    const contentLines = content.split("\n");

    const metadata: DocumentChunkMetadata = {
      extension: context.extension,
      language: "unknown",
      fileSizeBytes: context.fileSizeBytes,
      contentHash: computeContentHash(content),
      fileModifiedAt: context.fileModifiedAt,
      documentType: context.documentType,
      pageNumber: tableResult.pageNumber,
      documentTitle: context.documentTitle,
      documentAuthor: context.documentAuthor,
      isTable: true,
      tableIndex: tableResult.tableIndex,
      tableCaption: tableResult.table.caption,
      tableColumnCount: tableResult.table.columnCount,
      tableRowCount: dataRowCount,
      tableSourceType: tableResult.sourceType,
      tableConfidence: tableResult.confidence,
    };

    return {
      id: this.buildChunkId(
        context.repository,
        context.filePath,
        tableResult.tableIndex,
        subChunkIndex
      ),
      repository: context.repository,
      filePath: context.filePath,
      content,
      chunkIndex: subChunkIndex,
      totalChunks: totalSubChunks,
      startLine: 1,
      endLine: contentLines.length,
      metadata,
    };
  }

  /**
   * Build a chunk ID for table content.
   *
   * Format: `{repository}:{filePath}:table-{tableIndex}:{subChunkIndex}`
   *
   * @param repository - Repository name
   * @param filePath - File path
   * @param tableIndex - Zero-based table index
   * @param subChunkIndex - Zero-based sub-chunk index
   * @returns Unique chunk ID
   */
  private buildChunkId(
    repository: string,
    filePath: string,
    tableIndex: number,
    subChunkIndex: number
  ): string {
    return `${repository}:${filePath}:table-${tableIndex}:${subChunkIndex}`;
  }
}
