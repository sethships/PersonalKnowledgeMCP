/**
 * Test fixtures for DocumentChunker tests.
 *
 * Provides mock ExtractionResult builders and content samples for
 * testing document-aware chunking with various document types.
 *
 * @module tests/fixtures/documents/document-chunk-fixtures
 */

import type {
  ExtractionResult,
  DocumentMetadata,
  PageInfo,
  SectionInfo,
  DocumentType,
} from "../../../src/documents/types.js";

/**
 * Default document metadata for test fixtures.
 */
const DEFAULT_METADATA: DocumentMetadata = {
  documentType: "pdf",
  title: "Test Document",
  author: "Test Author",
  filePath: "/docs/test-document.pdf",
  fileSizeBytes: 4096,
  contentHash: "abc123def456",
  fileModifiedAt: new Date("2024-06-15T10:00:00Z"),
  pageCount: 1,
  wordCount: 100,
};

/**
 * Small document content that fits in a single chunk.
 *
 * ~50 characters, well under default 500 token limit.
 */
export const SMALL_DOCUMENT_CONTENT = "This is a small document with minimal content.";

/**
 * Medium document content with clear paragraph boundaries.
 *
 * Contains 4 paragraphs separated by double newlines.
 * Each paragraph is ~200 characters (~50 tokens).
 */
export const PARAGRAPH_DOCUMENT_CONTENT = `This is the first paragraph of the document. It contains introductory material about the topic being discussed. The introduction provides context and background information for the reader.

This is the second paragraph with more detailed information. It goes deeper into the subject matter and provides specific examples and data points. The paragraph explores the core concepts thoroughly.

This is the third paragraph which discusses implementation details. It covers the technical aspects of the solution including architecture decisions and trade-offs. Performance considerations are also addressed.

This is the fourth paragraph serving as a conclusion. It summarizes the key findings and recommendations. Future work and potential improvements are also briefly mentioned in this final section.`;

/**
 * Document content with Markdown-style section headings.
 *
 * Contains 3 sections with headings, suitable for testing
 * section heading context attachment.
 */
export const SECTIONED_DOCUMENT_CONTENT = `# Introduction

This is the introduction section. It provides an overview of the document and sets the stage for the detailed discussion that follows. The reader will find context about the problem domain here.

# Architecture

This section covers the system architecture. It describes the components, their interactions, and the design principles that guided the architecture decisions. Scalability and maintainability are key concerns.

The architecture follows a layered approach with clear separation of concerns. Each layer has well-defined responsibilities and interfaces.

# Conclusion

This is the conclusion section. It wraps up the discussion and provides actionable recommendations based on the analysis presented in the previous sections.`;

/**
 * Long prose paragraph with multiple sentences and no internal newlines.
 *
 * ~300 tokens (1200+ characters). Simulates dense prose from PDFs/DOCX
 * where paragraph boundaries don't contain `\n` characters.
 */
export const LONG_PROSE_PARAGRAPH =
  "The architecture of modern distributed systems requires careful consideration of multiple factors including consistency, availability, and partition tolerance. " +
  "When designing microservices, engineers must evaluate the trade-offs between synchronous and asynchronous communication patterns to ensure optimal performance. " +
  "Database selection plays a critical role in determining system behavior under load, with relational databases offering strong consistency guarantees while NoSQL alternatives provide horizontal scalability. " +
  "Caching strategies must be implemented at multiple levels of the stack, from application-level memoization to distributed caches like Redis and Memcached. " +
  "Monitoring and observability are essential concerns that should be addressed from the earliest stages of development rather than retrofitted after deployment. " +
  "Security considerations including authentication, authorization, and encryption must be woven into the fabric of the system rather than treated as an afterthought.";

/**
 * Long single sentence without sentence-ending punctuation boundaries.
 *
 * ~200 tokens (800+ characters). Forces word-level splitting when
 * sentence boundary detection finds no split points.
 */
export const LONG_SINGLE_SENTENCE =
  "The comprehensive analysis of distributed computing paradigms across " +
  "heterogeneous cloud environments with varying network topologies and " +
  "diverse workload characteristics including batch processing and " +
  "real-time streaming and interactive query execution and machine " +
  "learning inference and data transformation pipelines and event-driven " +
  "architectures and serverless functions and container orchestration " +
  "and service mesh configurations and API gateway routing and load " +
  "balancing algorithms and circuit breaker patterns and retry mechanisms " +
  "and timeout configurations and connection pooling strategies and " +
  "thread management approaches and memory allocation techniques and " +
  "garbage collection tuning and JIT compilation optimization and " +
  "native code generation and cross-compilation toolchains reveals " +
  "fundamental constraints on system performance";

/**
 * Very long single word (~3000 characters).
 *
 * Forces the word-level fallback to emit an oversized chunk
 * since words are never broken mid-character.
 */
export const VERY_LONG_WORD = "supercalifragilisticexpialidocious".repeat(90);

/**
 * Large document content that will produce multiple chunks.
 *
 * Generates content with many paragraphs, each ~200 characters (~50 tokens).
 *
 * @param paragraphCount - Number of paragraphs to generate
 * @returns Generated document content
 */
export function generateLargeDocumentContent(paragraphCount: number = 20): string {
  const paragraphs: string[] = [];

  for (let i = 0; i < paragraphCount; i++) {
    const words = [];
    for (let w = 0; w < 40; w++) {
      words.push(`word${i}_${w}`);
    }
    paragraphs.push(`Paragraph ${i + 1}: ${words.join(" ")}.`);
  }

  return paragraphs.join("\n\n");
}

/**
 * Create a mock ExtractionResult for testing.
 *
 * Provides sensible defaults that can be overridden for specific test scenarios.
 *
 * @param overrides - Partial overrides for the ExtractionResult
 * @returns Complete ExtractionResult for testing
 */
export function createMockExtractionResult(
  overrides?: Partial<ExtractionResult> & {
    metadataOverrides?: Partial<DocumentMetadata>;
  }
): ExtractionResult {
  const { metadataOverrides, ...resultOverrides } = overrides ?? {};

  return {
    content: SMALL_DOCUMENT_CONTENT,
    metadata: {
      ...DEFAULT_METADATA,
      ...metadataOverrides,
    },
    ...resultOverrides,
  };
}

/**
 * Create a multi-page PDF ExtractionResult for testing page-boundary chunking.
 *
 * @param pageCount - Number of pages to generate
 * @param wordsPerPage - Approximate words per page
 * @returns ExtractionResult with pages array
 */
export function createMultiPageExtractionResult(
  pageCount: number = 3,
  wordsPerPage: number = 50
): ExtractionResult {
  const pages: PageInfo[] = [];
  const contentParts: string[] = [];

  for (let i = 0; i < pageCount; i++) {
    const words: string[] = [];
    for (let w = 0; w < wordsPerPage; w++) {
      words.push(`page${i + 1}_word${w + 1}`);
    }
    const pageContent = `Page ${i + 1} content: ${words.join(" ")}.`;

    pages.push({
      pageNumber: i + 1,
      content: pageContent,
      wordCount: wordsPerPage,
    });
    contentParts.push(pageContent);
  }

  return {
    content: contentParts.join("\n\n"),
    metadata: {
      ...DEFAULT_METADATA,
      pageCount,
      wordCount: pageCount * wordsPerPage,
    },
    pages,
  };
}

/**
 * Create an ExtractionResult with section headings for testing section context.
 *
 * @returns ExtractionResult with sections array
 */
export function createSectionedExtractionResult(): ExtractionResult {
  const content = SECTIONED_DOCUMENT_CONTENT;

  const sections: SectionInfo[] = [
    {
      title: "Introduction",
      level: 1,
      startOffset: 0,
      endOffset: content.indexOf("# Architecture"),
    },
    {
      title: "Architecture",
      level: 1,
      startOffset: content.indexOf("# Architecture"),
      endOffset: content.indexOf("# Conclusion"),
    },
    {
      title: "Conclusion",
      level: 1,
      startOffset: content.indexOf("# Conclusion"),
      endOffset: content.length,
    },
  ];

  return {
    content,
    metadata: {
      ...DEFAULT_METADATA,
      documentType: "markdown",
      filePath: "/docs/design.md",
    },
    sections,
  };
}

/**
 * Create an ExtractionResult for a specific document type.
 *
 * @param documentType - Document type to create
 * @param content - Optional content override
 * @returns ExtractionResult with appropriate metadata
 */
export function createTypedExtractionResult(
  documentType: DocumentType,
  content?: string
): ExtractionResult {
  const filePathMap: Record<DocumentType, string> = {
    pdf: "/docs/document.pdf",
    docx: "/docs/document.docx",
    markdown: "/docs/document.md",
    txt: "/docs/document.txt",
  };

  return createMockExtractionResult({
    content: content ?? SMALL_DOCUMENT_CONTENT,
    metadataOverrides: {
      documentType,
      filePath: filePathMap[documentType],
    },
  });
}
