# Phase 6: Unstructured Document Ingestion - GitHub Issues

**Created:** January 18, 2026
**Milestone:** Phase 6: Unstructured Document Ingestion
**Total Issues:** 8 Epics + 65 Tasks = 73 Issues

---

## Labels to Create

Before creating issues, ensure these labels exist:

- `phase-6` - Phase 6 specific issues
- `epic` - Epic/parent issues
- `enhancement` - New features
- `documentation` - Documentation updates
- `testing` - Test-related work
- `P0` - Critical priority
- `P1` - High priority
- `P2` - Medium priority
- `size:S` - Small (2-4 hours)
- `size:M` - Medium (4-8 hours)
- `size:L` - Large (8+ hours)

---

## Epic Issues

### Epic 1: M1 - Core Document Extractors

**Title:** `[Epic] M1: Core Document Extractors (Phase 6 - Weeks 1-2)`
**Labels:** `epic`, `enhancement`, `phase-6`

**Body:**
```markdown
## Epic: Core Document Extractors

**Phase:** 6 - Unstructured Document Ingestion
**Duration:** Weeks 1-2 (2 weeks)
**Priority:** P0

### Overview

Implement document content extraction for all supported formats (PDF, DOCX, Markdown, and image metadata). This is the foundational milestone that enables all subsequent document processing features.

### Goals

1. Extract text content and metadata from PDF documents
2. Extract text and structure from Microsoft Word (.docx) files
3. Parse Markdown files with structure preservation and frontmatter support
4. Extract image metadata (dimensions, format, EXIF data)
5. Establish robust error handling for corrupt or unreadable files

### Key Deliverables

- [ ] PDF extractor with text and metadata extraction (`PdfExtractor`)
- [ ] DOCX extractor with structure preservation (`DocxExtractor`)
- [ ] Markdown parser with frontmatter support (`MarkdownParser`)
- [ ] Image metadata extractor (`ImageMetadataExtractor`)
- [ ] Document type detector for format identification (`DocumentTypeDetector`)
- [ ] Unit tests for all extractors (>90% coverage)

### Dependencies (packages to install)

- `pdf-parse` ^1.1.1 - PDF text extraction (MIT)
- `mammoth` ^1.6.0 - DOCX to text/HTML conversion (BSD-2-Clause)
- `marked` ^12.0.0 - Markdown parsing (MIT)
- `sharp` ^0.33.0 - Image processing and metadata (Apache-2.0)
- `exif-parser` ^0.1.12 - EXIF metadata extraction (MIT)

### Acceptance Criteria

- PDF documents extracted with >95% text accuracy
- DOCX files converted preserving structure
- Markdown files retain heading hierarchy and code blocks
- Image dimensions and EXIF data captured
- Corrupt files handled gracefully with error logging
- All extractors have >90% test coverage

### PRD References

- FR-1: PDF Document Processing
- FR-2: Markdown File Processing
- FR-3: DOCX Document Processing
- FR-7: Image Processing (metadata)

### Task Issues

Task issues will be linked here as they are created.
```

---

### Epic 2: M2 - Document Chunking

**Title:** `[Epic] M2: Document Chunking (Phase 6 - Week 3)`
**Labels:** `epic`, `enhancement`, `phase-6`

**Body:**
```markdown
## Epic: Document Chunking

**Phase:** 6 - Unstructured Document Ingestion
**Duration:** Week 3 (1 week)
**Priority:** P0

### Overview

Adapt the chunking pipeline for document content, extending the existing `FileChunker` to handle document-specific requirements like paragraph boundaries, page tracking, and section headings.

### Goals

1. Create document-aware chunker that respects document structure
2. Integrate with existing embedding pipeline
3. Create PostgreSQL schema for document metadata storage
4. Enable document chunks to be stored in ChromaDB

### Key Deliverables

- [ ] Document-aware chunker extending FileChunker (`DocumentChunker`)
- [ ] Paragraph-boundary-aware chunking
- [ ] Section heading context preservation
- [ ] PostgreSQL migration for documents table
- [ ] Integration with existing `IngestionService`
- [ ] Document-specific metadata in ChromaDB storage
- [ ] Integration tests for chunking pipeline

### Dependencies

- M1: Core Document Extractors (completed)

### Acceptance Criteria

- Document chunks respect paragraph boundaries
- PDF chunks include page number metadata
- Section headings preserved in chunk metadata
- PostgreSQL documents table created via migration
- Chunks properly stored in ChromaDB with document metadata
- Integration tests pass with real document samples

### PRD References

- Section 5.4: Data Storage Requirements
- Section 6.2: Integration with Existing Components

### Task Issues

Task issues will be linked here as they are created.
```

---

### Epic 3: M3 - MCP Tools

**Title:** `[Epic] M3: MCP Tools for Document Search (Phase 6 - Week 4)`
**Labels:** `epic`, `enhancement`, `phase-6`

**Body:**
```markdown
## Epic: MCP Tools for Document Search

**Phase:** 6 - Unstructured Document Ingestion
**Duration:** Week 4 (1 week)
**Priority:** P0

### Overview

Expose document search capabilities via new MCP tools, enabling Claude Code and other MCP clients to search indexed documents, images, and manage watched folders.

### Goals

1. Implement `search_documents` MCP tool for semantic document search
2. Implement `search_images` MCP tool for metadata-based image search
3. Implement `list_watched_folders` MCP tool for folder management
4. Enhance existing `semantic_search` tool with document support

### Key Deliverables

- [ ] `search_documents` MCP tool implementation
- [ ] `search_images` MCP tool implementation
- [ ] `list_watched_folders` MCP tool implementation
- [ ] Updated `semantic_search` with `include_documents` option
- [ ] Tool registration in MCP tool registry
- [ ] Comprehensive tool documentation
- [ ] Integration tests for MCP tools

### Dependencies

- M1: Core Document Extractors (completed)
- M2: Document Chunking (completed)

### Acceptance Criteria

- `search_documents` returns relevant document passages with similarity scores
- `search_images` filters by metadata (date, dimensions, format)
- `list_watched_folders` shows folder status and document counts
- `semantic_search` optionally includes document results
- All tools registered and documented
- Integration tests cover tool responses

### PRD References

- Section 7: MCP Tool Design
- Section 7.1: New MCP Tools
- Section 7.2: Updated Existing Tools

### Task Issues

Task issues will be linked here as they are created.
```

---

### Epic 4: M4 - Folder Watching

**Title:** `[Epic] M4: Folder Watching (Phase 6 - Weeks 5-6)`
**Labels:** `epic`, `enhancement`, `phase-6`

**Body:**
```markdown
## Epic: Folder Watching

**Phase:** 6 - Unstructured Document Ingestion
**Duration:** Weeks 5-6 (2 weeks)
**Priority:** P0

### Overview

Implement real-time folder monitoring using chokidar to automatically detect and process file changes. This enables a "living documentation" workflow where indexed content stays synchronized with file system changes.

### Goals

1. Monitor configured directories for file changes
2. Detect file creation, modification, and deletion events
3. Support nested folder structures with arbitrary depth
4. Implement debouncing for rapid file changes
5. Provide incremental updates to avoid full re-indexing
6. Support .pkignore files for exclusion patterns

### Key Deliverables

- [ ] Folder watcher service using chokidar (`FolderWatcherService`)
- [ ] Debouncing for rapid file changes (configurable, default 2s)
- [ ] Change detection (add/modify/delete events)
- [ ] Processing queue for batched updates
- [ ] Incremental index updates (add, modify, delete)
- [ ] .pkignore file support
- [ ] PostgreSQL table for watch configurations
- [ ] Watcher lifecycle management (start/stop/restart)
- [ ] Integration tests for watcher scenarios

### Dependencies

- M2: Document Chunking (completed)

**Packages to install:**
- `chokidar` ^3.6.0 - File system watching (MIT)
- `ignore` ^5.3.0 - .gitignore-style pattern matching (MIT)

### Acceptance Criteria

- File watcher detects new, modified, and deleted files
- New files automatically processed and indexed
- Modified files trigger re-indexing
- Deleted files removed from index
- Debounce prevents excessive re-indexing
- .pkignore patterns respected
- Watcher survives temporary folder unavailability
- 24-hour stability test shows zero missed events

### PRD References

- FR-4: Folder Watching
- FR-5: Incremental Updates
- FR-6: Ignore Patterns

### Task Issues

Task issues will be linked here as they are created.
```

---

### Epic 5: M5 - CLI & Polish

**Title:** `[Epic] M5: CLI & Polish (Phase 6 - Week 7)`
**Labels:** `epic`, `enhancement`, `documentation`, `phase-6`

**Body:**
```markdown
## Epic: CLI & Polish

**Phase:** 6 - Unstructured Document Ingestion
**Duration:** Week 7 (1 week)
**Priority:** P0

### Overview

Complete CLI command implementation, user documentation, performance optimization, and overall polish for Phase 6 Core features (M1-M4).

### Goals

1. Implement all document-related CLI commands
2. Add progress reporting for bulk operations
3. Complete performance testing and optimization
4. Write comprehensive user documentation
5. Update README with document ingestion guide

### Key Deliverables

- [ ] `pk-mcp documents index` command
- [ ] `pk-mcp watch add/list/remove/pause/resume/rescan` commands
- [ ] `pk-mcp documents status` command
- [ ] `pk-mcp documents errors` command
- [ ] `pk-mcp documents retry` command
- [ ] Progress reporting for bulk operations
- [ ] Performance testing against targets
- [ ] User documentation for document features
- [ ] Updated README with document ingestion guide
- [ ] (Optional) Embedding provider observability logging (#28)

### Dependencies

- M1-M4 all completed

### Acceptance Criteria

- All CLI commands work as documented
- Progress reporting shows percentage and estimated time
- Performance meets PRD targets
- Documentation complete and accurate
- CLI help text accurate for all commands
- No P0 bugs in core functionality

### PRD References

- Section 8: CLI Commands
- Section 10: Success Metrics

### Task Issues

Task issues will be linked here as they are created.
```

---

### Epic 6: M6 - OCR Processing

**Title:** `[Epic] M6: OCR Processing (Phase 6 - Weeks 8-9)`
**Labels:** `epic`, `enhancement`, `phase-6`

**Body:**
```markdown
## Epic: OCR Processing

**Phase:** 6 - Unstructured Document Ingestion
**Duration:** Weeks 8-9 (2 weeks)
**Priority:** P1

### Overview

Enable text extraction from scanned documents and image-only PDFs using OCR. This extends document search capabilities to include scanned academic papers, historical documents, and other image-based content.

### Goals

1. Detect image-only PDFs during ingestion
2. Convert PDF pages to images for OCR processing
3. Extract text from page images using tesseract.js
4. Support configurable OCR languages
5. Track OCR confidence scores and quality metrics
6. Handle mixed PDFs (some pages text, some scanned)

### Key Deliverables

- [ ] OCR service using tesseract.js v6 (`OcrService`)
- [ ] PDF page-to-image converter using pdfjs-dist
- [ ] Image-only PDF detection
- [ ] OCR confidence score tracking per page
- [ ] Configurable OCR languages (default: English)
- [ ] Background processing queue for OCR operations
- [ ] Progress reporting for long-running OCR jobs
- [ ] OCR timeout handling (per-page limits)
- [ ] CLI commands for OCR status and manual triggers
- [ ] Updated MCP tools to include OCR-extracted content
- [ ] Unit tests (>85% coverage)
- [ ] Integration tests for full OCR pipeline

### Dependencies

- M5: CLI & Polish (completed)

**Packages to install:**
- `tesseract.js` ^6.0.0 - OCR text extraction (Apache-2.0)
- `pdfjs-dist` ^4.0.0 - PDF page-to-image conversion (Apache-2.0)

### Acceptance Criteria

- System detects image-only PDFs during ingestion
- OCR extracts text with >90% accuracy for clean scans
- OCR confidence scores captured as metadata
- Processing time warnings for large documents (>10 pages)
- Support for common scan qualities (150-600 DPI)
- Graceful handling of low-quality scans
- OCR per page completes in <15 seconds
- Full document (10 pages) processes in <3 minutes

### PRD References

- FR-9: OCR for Scanned Documents
- US-9: Search Scanned Document Content

### Task Issues

Task issues will be linked here as they are created.
```

---

### Epic 7: M7 - Table Extraction

**Title:** `[Epic] M7: Table Extraction (Phase 6 - Weeks 10-11)`
**Labels:** `epic`, `enhancement`, `phase-6`

**Body:**
```markdown
## Epic: Table Extraction

**Phase:** 6 - Unstructured Document Ingestion
**Duration:** Weeks 10-11 (1.5 weeks)
**Priority:** P2

### Overview

Extract structured table data from PDF and DOCX documents, preserving row/column relationships and enabling search and export of tabular data.

### Goals

1. Detect tables within PDF and DOCX documents
2. Extract table structure preserving rows, columns, and headers
3. Handle merged cells and multi-page tables
4. Store tables in structured format for export
5. Index table content for semantic search with table context

### Key Deliverables

- [ ] Table extractor interface (`TableExtractor`)
- [ ] PDF table extractor using pdfreader (`PdfTableExtractor`)
- [ ] DOCX table extractor parsing mammoth HTML (`DocxTableExtractor`)
- [ ] Table structure model (rows, columns, headers, merged cells)
- [ ] Table header detection heuristics
- [ ] Multi-page table handling for PDFs
- [ ] PostgreSQL storage for extracted tables as JSON
- [ ] ChromaDB indexing with table context metadata
- [ ] `pk-mcp tables list` CLI command
- [ ] `pk-mcp tables export` CLI command (CSV/JSON)
- [ ] Table filtering option in `search_documents` MCP tool
- [ ] Unit tests (>85% coverage)

### Dependencies

- M5: CLI & Polish (completed)

**Packages to install:**
- `pdfreader` ^3.0.0 - PDF table detection and extraction (MIT)

### Acceptance Criteria

- Tables detected within PDF and DOCX documents
- >85% table structure preserved on test documents
- >90% headers correctly identified
- Multi-page tables handled correctly
- Tables exportable to CSV and JSON formats
- Search results indicate table context
- Extraction completes in <5 seconds per document

### PRD References

- FR-10: Complex Table Extraction
- US-10: Extract and Search Table Data

### Task Issues

Task issues will be linked here as they are created.
```

---

### Epic 8: M8 - Image Content Analysis

**Title:** `[Epic] M8: Image Content Analysis (Phase 6 - Weeks 11-12)`
**Labels:** `epic`, `enhancement`, `phase-6`

**Body:**
```markdown
## Epic: Image Content Analysis

**Phase:** 6 - Unstructured Document Ingestion
**Duration:** Weeks 11-12 (1.5 weeks)
**Priority:** P2

### Overview

Generate and index AI-based descriptions of image content for semantic search. This enables finding images by describing what they contain rather than just filename or metadata.

### Goals

1. Generate natural language descriptions of image content
2. Support local processing via Transformers.js (privacy-first default)
3. Support cloud API processing (OpenAI Vision) as alternative
4. Classify image types (diagram, screenshot, photo, chart)
5. Enable semantic search of images by content

### Key Deliverables

- [ ] Image analysis service with provider abstraction (`ImageAnalysisService`)
- [ ] Local image analyzer using Transformers.js BLIP model (`LocalImageAnalyzer`)
- [ ] Cloud image analyzer using OpenAI Vision API (`OpenAIImageAnalyzer`)
- [ ] Configuration for analysis provider selection
- [ ] Lazy model loading for local analysis
- [ ] Image type classification (diagram, screenshot, photo, chart)
- [ ] PostgreSQL storage for content descriptions
- [ ] Embeddings from descriptions in ChromaDB
- [ ] `content_query` parameter in `search_images` MCP tool
- [ ] `pk-mcp images analyze` CLI command
- [ ] `pk-mcp images reanalyze` CLI command
- [ ] Analysis progress reporting
- [ ] Unit tests (>85% coverage)
- [ ] Integration tests for both providers

### Dependencies

- M5: CLI & Polish (completed)

**Packages to install:**
- `@xenova/transformers` ^2.17.0 - Local image captioning (Apache-2.0)
- `openai` ^4.0.0 - Cloud image analysis (MIT, optional)

### Acceptance Criteria

- Images analyzed with natural language descriptions
- >80% descriptions semantically accurate (manual review)
- >90% image type classification accuracy
- Local processing completes in <10 seconds per image
- Cloud processing completes in <3 seconds per image
- Search queries match image content
- Privacy-preserving local processing is default
- Model downloaded on demand and cached locally

### PRD References

- FR-11: Image Content Analysis
- US-11: Search Images by Content Description

### Task Issues

Task issues will be linked here as they are created.
```

---

## Task Issues by Milestone

### M1: Core Document Extractors - Tasks

---

#### M1-T1: Create documents module structure

**Title:** `Create src/documents/ module structure`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:**
```markdown
## Task: Create documents module structure

**Epic:** M1: Core Document Extractors
**Priority:** P0
**Effort:** 2-3 hours
**Dependencies:** None

### Description

Create the module structure for document processing under `src/documents/`. This establishes the foundation for all document extractors.

### Tasks

- [ ] Create `src/documents/` directory
- [ ] Create `src/documents/index.ts` with exports
- [ ] Create `src/documents/types.ts` for shared interfaces
- [ ] Define `ExtractedDocument` interface
- [ ] Define `DocumentMetadata` interface
- [ ] Define `DocumentExtractor` interface (base contract)
- [ ] Create `src/documents/extractors/` subdirectory

### Acceptance Criteria

- [ ] Module structure created and compiles
- [ ] All interfaces exported from index.ts
- [ ] TypeScript strict mode passes
- [ ] Consistent with existing project patterns

### Technical Notes

```typescript
interface ExtractedDocument {
  content: string;
  metadata: DocumentMetadata;
  pages?: ExtractedPage[];
  sections?: ExtractedSection[];
}

interface DocumentMetadata {
  title?: string;
  author?: string;
  createdAt?: Date;
  pageCount?: number;
  wordCount?: number;
  fileSizeBytes: number;
  contentHash: string;
}

interface DocumentExtractor {
  extract(filePath: string): Promise<ExtractedDocument>;
  supports(extension: string): boolean;
}
```
```

---

#### M1-T2: Implement PDF Extractor

**Title:** `Implement PDF Extractor with pdf-parse`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Implement PDF Extractor

**Epic:** M1: Core Document Extractors
**Priority:** P0
**Effort:** 6-8 hours
**Dependencies:** M1-T1 (module structure)

### Description

Implement `PdfExtractor` class using pdf-parse library for text and metadata extraction from PDF documents.

### Tasks

- [ ] Install `pdf-parse` dependency
- [ ] Create `src/documents/extractors/PdfExtractor.ts`
- [ ] Implement `extract()` method for text extraction
- [ ] Extract document metadata (title, author, creation date)
- [ ] Extract page count and track page boundaries
- [ ] Detect heading structure where possible
- [ ] Handle password-protected PDFs (skip with warning)
- [ ] Handle corrupt PDFs gracefully (return error state)
- [ ] Handle large PDFs (>50MB) with warning
- [ ] Write unit tests (>90% coverage)

### Acceptance Criteria

- [ ] Text extracted from text-based PDFs with >95% accuracy
- [ ] Metadata (title, author, creation date, page count) extracted
- [ ] Page boundaries tracked for later use
- [ ] Corrupt PDFs handled without crashing
- [ ] Password-protected PDFs logged and skipped
- [ ] Performance: <2s for 10-page PDF, <10s for 100-page PDF
- [ ] Unit tests pass with >90% coverage

### PRD References

- FR-1.1: Extract text content from text-based PDF documents
- FR-1.2: Preserve paragraph and heading structure
- FR-1.3: Extract document metadata
- FR-1.4: Handle multi-page documents with page number tracking
- FR-1.6: Gracefully handle corrupt or unreadable PDFs

### Technical Notes

```typescript
import pdfParse from 'pdf-parse';

class PdfExtractor implements DocumentExtractor {
  async extract(filePath: string): Promise<ExtractedDocument> {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    // Extract text, metadata, page info
  }

  supports(extension: string): boolean {
    return extension === '.pdf';
  }
}
```
```

---

#### M1-T3: Implement DOCX Extractor

**Title:** `Implement DOCX Extractor with mammoth`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Implement DOCX Extractor

**Epic:** M1: Core Document Extractors
**Priority:** P0
**Effort:** 5-6 hours
**Dependencies:** M1-T1 (module structure)

### Description

Implement `DocxExtractor` class using mammoth library for text and structure extraction from Microsoft Word documents.

### Tasks

- [ ] Install `mammoth` dependency
- [ ] Create `src/documents/extractors/DocxExtractor.ts`
- [ ] Implement `extract()` method using mammoth.extractRawText
- [ ] Extract document structure using mammoth.convertToHtml
- [ ] Parse HTML to identify heading hierarchy
- [ ] Preserve list structure (numbered, bulleted)
- [ ] Extract document metadata from DOCX properties
- [ ] Handle corrupt DOCX files gracefully
- [ ] Write unit tests (>90% coverage)

### Acceptance Criteria

- [ ] Text extracted preserving paragraph structure
- [ ] Heading hierarchy detected and preserved
- [ ] List structure maintained
- [ ] Metadata (author, title, creation date) extracted
- [ ] Corrupt files handled without crashing
- [ ] Performance: <1 second for typical document
- [ ] Unit tests pass with >90% coverage

### PRD References

- FR-3.1: Extract text content preserving paragraph structure
- FR-3.2: Convert heading styles to structured hierarchy
- FR-3.3: Extract document metadata
- FR-3.5: Preserve list structure
- FR-3.6: Handle .docx files only

### Technical Notes

```typescript
import mammoth from 'mammoth';

class DocxExtractor implements DocumentExtractor {
  async extract(filePath: string): Promise<ExtractedDocument> {
    const result = await mammoth.convertToHtml({ path: filePath });
    // Parse HTML for structure
    const text = await mammoth.extractRawText({ path: filePath });
    // Combine text and structure
  }

  supports(extension: string): boolean {
    return extension === '.docx';
  }
}
```
```

---

#### M1-T4: Implement Markdown Parser

**Title:** `Implement Markdown Parser with marked`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Implement Markdown Parser

**Epic:** M1: Core Document Extractors
**Priority:** P0
**Effort:** 4-5 hours
**Dependencies:** M1-T1 (module structure)

### Description

Implement `MarkdownParser` class using marked library for parsing Markdown files with structure preservation and frontmatter support.

### Tasks

- [ ] Install `marked` and `gray-matter` dependencies
- [ ] Create `src/documents/extractors/MarkdownParser.ts`
- [ ] Implement `extract()` method for text extraction
- [ ] Parse frontmatter (YAML header) using gray-matter
- [ ] Preserve heading hierarchy
- [ ] Preserve code blocks with language annotation
- [ ] Handle GFM (GitHub Flavored Markdown) extensions
- [ ] Extract internal links and references as metadata
- [ ] Write unit tests (>90% coverage)

### Acceptance Criteria

- [ ] Markdown parsed with heading hierarchy preserved
- [ ] Frontmatter extracted as metadata
- [ ] Code blocks preserved with language
- [ ] GFM extensions supported (tables, task lists)
- [ ] 100% structure preserved in output
- [ ] Performance: <100ms for typical document
- [ ] Unit tests pass with >90% coverage

### PRD References

- FR-2.1: Parse Markdown syntax preserving heading hierarchy
- FR-2.2: Extract frontmatter metadata
- FR-2.3: Preserve code blocks with language annotation
- FR-2.4: Handle GitHub Flavored Markdown extensions
- FR-2.5: Extract internal links and references
- FR-2.6: Support CommonMark and GFM specifications

### Technical Notes

```typescript
import { marked } from 'marked';
import matter from 'gray-matter';

class MarkdownParser implements DocumentExtractor {
  async extract(filePath: string): Promise<ExtractedDocument> {
    const content = await fs.readFile(filePath, 'utf-8');
    const { data: frontmatter, content: markdown } = matter(content);
    const tokens = marked.lexer(markdown);
    // Process tokens to extract structure
  }

  supports(extension: string): boolean {
    return ['.md', '.markdown'].includes(extension);
  }
}
```
```

---

#### M1-T5: Implement Image Metadata Extractor

**Title:** `Implement Image Metadata Extractor with sharp and exif-parser`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Implement Image Metadata Extractor

**Epic:** M1: Core Document Extractors
**Priority:** P0
**Effort:** 4-5 hours
**Dependencies:** M1-T1 (module structure)

### Description

Implement `ImageMetadataExtractor` class using sharp for image dimensions and exif-parser for EXIF metadata extraction.

### Tasks

- [ ] Install `sharp` and `exif-parser` dependencies
- [ ] Create `src/documents/extractors/ImageMetadataExtractor.ts`
- [ ] Implement `extract()` method for metadata extraction
- [ ] Extract dimensions (width, height) using sharp
- [ ] Detect image format (PNG, JPEG, GIF, WebP, TIFF)
- [ ] Extract EXIF data (date taken, camera, orientation)
- [ ] Extract GPS coordinates if present (with privacy note)
- [ ] Handle images without EXIF data gracefully
- [ ] Store file-level metadata (size, modification date)
- [ ] Write unit tests (>90% coverage)

### Acceptance Criteria

- [ ] Dimensions extracted for all supported formats
- [ ] Format correctly detected
- [ ] EXIF data extracted from JPEG/TIFF files
- [ ] GPS coordinates extracted when present
- [ ] Images without EXIF handled gracefully
- [ ] Performance: <200ms per image
- [ ] Unit tests pass with >90% coverage

### PRD References

- FR-7.1: Extract dimensions (width, height)
- FR-7.2: Detect image format
- FR-7.3: Extract EXIF metadata
- FR-7.4: Extract GPS coordinates if present
- FR-7.5: Store file-level metadata
- FR-7.6: Support common formats
- FR-7.7: Handle images without EXIF gracefully

### Technical Notes

```typescript
import sharp from 'sharp';
import ExifParser from 'exif-parser';

class ImageMetadataExtractor implements DocumentExtractor {
  async extract(filePath: string): Promise<ExtractedDocument> {
    const metadata = await sharp(filePath).metadata();
    const buffer = await fs.readFile(filePath);
    let exif = {};
    try {
      exif = ExifParser.create(buffer).parse().tags;
    } catch {
      // No EXIF data, continue
    }
    // Combine metadata
  }

  supports(extension: string): boolean {
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff'].includes(extension);
  }
}
```
```

---

#### M1-T6: Create Document Type Detector

**Title:** `Create Document Type Detector for format identification`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:**
```markdown
## Task: Create Document Type Detector

**Epic:** M1: Core Document Extractors
**Priority:** P0
**Effort:** 2-3 hours
**Dependencies:** M1-T2, M1-T3, M1-T4, M1-T5

### Description

Create `DocumentTypeDetector` class to identify document types and route to the appropriate extractor.

### Tasks

- [ ] Create `src/documents/DocumentTypeDetector.ts`
- [ ] Implement extension-based detection
- [ ] Add MIME type validation as fallback
- [ ] Create extractor factory method
- [ ] Handle unsupported formats gracefully
- [ ] Log warnings for legacy formats (.doc)
- [ ] Write unit tests

### Acceptance Criteria

- [ ] All supported extensions detected correctly
- [ ] MIME type validation works as fallback
- [ ] Correct extractor returned for each type
- [ ] Unsupported formats return null with logging
- [ ] Legacy .doc format logged as unsupported
- [ ] Unit tests pass with >90% coverage

### Technical Notes

```typescript
class DocumentTypeDetector {
  private extractors: Map<string, DocumentExtractor>;

  getExtractor(filePath: string): DocumentExtractor | null {
    const ext = path.extname(filePath).toLowerCase();
    return this.extractors.get(ext) ?? null;
  }

  getDocumentType(filePath: string): 'pdf' | 'docx' | 'markdown' | 'image' | 'unknown' {
    // Extension-based detection with MIME fallback
  }
}
```
```

---

#### M1-T7: Add error handling for corrupt files

**Title:** `Add error handling for corrupt/unreadable files`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:**
```markdown
## Task: Add error handling for corrupt files

**Epic:** M1: Core Document Extractors
**Priority:** P0
**Effort:** 2-3 hours
**Dependencies:** M1-T2, M1-T3, M1-T4, M1-T5

### Description

Implement comprehensive error handling across all extractors for corrupt, unreadable, and edge case files.

### Tasks

- [ ] Define `DocumentExtractionError` class with error codes
- [ ] Add try-catch wrappers in all extractors
- [ ] Handle file not found errors
- [ ] Handle permission denied errors
- [ ] Handle corrupt file content errors
- [ ] Handle file too large errors (>50MB)
- [ ] Log errors with context (file path, error type)
- [ ] Return structured error results (not thrown exceptions)
- [ ] Write unit tests for error scenarios

### Acceptance Criteria

- [ ] All extractors handle errors gracefully
- [ ] Errors logged with file path and type
- [ ] Corrupt files don't crash the system
- [ ] Structured error results returned
- [ ] Unit tests cover all error scenarios

### Technical Notes

```typescript
enum DocumentErrorCode {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  CORRUPT_FILE = 'CORRUPT_FILE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
  PASSWORD_PROTECTED = 'PASSWORD_PROTECTED',
}

interface ExtractionResult {
  success: boolean;
  document?: ExtractedDocument;
  error?: {
    code: DocumentErrorCode;
    message: string;
    filePath: string;
  };
}
```
```

---

#### M1-T8: Unit tests for all extractors

**Title:** `Unit tests for all document extractors (90%+ coverage)`
**Labels:** `testing`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Unit tests for all extractors

**Epic:** M1: Core Document Extractors
**Priority:** P0
**Effort:** 6-8 hours
**Dependencies:** M1-T2, M1-T3, M1-T4, M1-T5, M1-T6, M1-T7

### Description

Write comprehensive unit tests for all document extractors to achieve >90% test coverage.

### Tasks

- [ ] Create test fixtures directory `tests/fixtures/documents/`
- [ ] Add sample PDF files (text, multi-page, corrupt, password)
- [ ] Add sample DOCX files (simple, complex, corrupt)
- [ ] Add sample Markdown files (basic, frontmatter, GFM)
- [ ] Add sample images (JPEG with EXIF, PNG, GIF, TIFF)
- [ ] Write tests for PdfExtractor
- [ ] Write tests for DocxExtractor
- [ ] Write tests for MarkdownParser
- [ ] Write tests for ImageMetadataExtractor
- [ ] Write tests for DocumentTypeDetector
- [ ] Write tests for error handling scenarios
- [ ] Verify coverage >= 90%

### Acceptance Criteria

- [ ] Test fixtures cover all document types
- [ ] All extractors have comprehensive tests
- [ ] Error scenarios tested
- [ ] Test coverage >= 90%
- [ ] Tests run in CI pipeline

### Test Scenarios

**PDF:**
- Text extraction from single-page PDF
- Text extraction from multi-page PDF
- Metadata extraction
- Corrupt PDF handling
- Password-protected PDF handling

**DOCX:**
- Text extraction with structure
- Heading hierarchy preservation
- List structure preservation
- Metadata extraction
- Corrupt DOCX handling

**Markdown:**
- Basic parsing
- Frontmatter extraction
- Code block preservation
- GFM extensions

**Image:**
- Dimensions extraction
- EXIF data extraction
- Format detection
- Missing EXIF handling
```

---

### M2: Document Chunking - Tasks

---

#### M2-T1: Create DocumentChunker

**Title:** `Create DocumentChunker extending FileChunker`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Create DocumentChunker

**Epic:** M2: Document Chunking
**Priority:** P0
**Effort:** 6-8 hours
**Dependencies:** M1 complete

### Description

Create `DocumentChunker` class that extends the existing `FileChunker` with document-specific chunking logic.

### Tasks

- [ ] Create `src/documents/DocumentChunker.ts`
- [ ] Extend or compose with existing `FileChunker`
- [ ] Add configuration interface `DocumentChunkerConfig`
- [ ] Implement document-aware chunk boundary detection
- [ ] Support different chunk strategies per document type
- [ ] Maintain chunk-to-page mapping for PDFs
- [ ] Write unit tests

### Acceptance Criteria

- [ ] DocumentChunker creates valid chunks
- [ ] Chunks respect document structure
- [ ] Page numbers tracked for PDF chunks
- [ ] Configuration options work correctly
- [ ] Unit tests pass with >90% coverage

### Technical Notes

```typescript
interface DocumentChunkerConfig extends ChunkerConfig {
  respectParagraphs?: boolean;      // default: true
  includeSectionContext?: boolean;  // default: true
  respectPageBoundaries?: boolean;  // default: true
}

class DocumentChunker {
  constructor(config: DocumentChunkerConfig) {}

  chunk(document: ExtractedDocument): DocumentChunk[] {}
}
```
```

---

#### M2-T2: Implement paragraph-boundary-aware chunking

**Title:** `Implement paragraph-boundary-aware chunking`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Implement paragraph-boundary-aware chunking

**Epic:** M2: Document Chunking
**Priority:** P0
**Effort:** 4-5 hours
**Dependencies:** M2-T1

### Description

Implement logic to prefer chunk boundaries at paragraph breaks rather than mid-sentence.

### Tasks

- [ ] Detect paragraph boundaries in extracted text
- [ ] Implement chunking algorithm that prefers paragraph breaks
- [ ] Handle paragraphs longer than chunk size
- [ ] Handle very short paragraphs (combine when appropriate)
- [ ] Maintain minimum/maximum chunk size constraints
- [ ] Write unit tests

### Acceptance Criteria

- [ ] Chunks preferentially break at paragraphs
- [ ] Long paragraphs split at sentence boundaries
- [ ] Short paragraphs combined appropriately
- [ ] Chunk sizes stay within configured limits
- [ ] Unit tests pass

### Technical Notes

- Paragraph detection: double newlines, or structural markers
- Fallback to sentence boundary if paragraph too long
- Sentence detection: period/question/exclamation + space + capital
```

---

#### M2-T3: Add section heading context preservation

**Title:** `Add section heading context preservation`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:**
```markdown
## Task: Add section heading context preservation

**Epic:** M2: Document Chunking
**Priority:** P0
**Effort:** 3-4 hours
**Dependencies:** M2-T1

### Description

Add the nearest section heading to each chunk's metadata for context when returning search results.

### Tasks

- [ ] Track current section heading during chunking
- [ ] Add `sectionHeading` field to chunk metadata
- [ ] Handle nested headings (use most recent)
- [ ] Handle documents without headings
- [ ] Write unit tests

### Acceptance Criteria

- [ ] Chunks include nearest section heading
- [ ] Nested headings handled correctly
- [ ] Documents without headings work correctly
- [ ] Unit tests pass

### Technical Notes

```typescript
interface DocumentChunk {
  // ... existing fields
  sectionHeading?: string;
}
```
```

---

#### M2-T4: Create PostgreSQL migration for documents table

**Title:** `Create PostgreSQL migration for documents table`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Create PostgreSQL migration for documents table

**Epic:** M2: Document Chunking
**Priority:** P0
**Effort:** 4-5 hours
**Dependencies:** None

### Description

Create PostgreSQL migration to add the documents metadata table and related schemas.

### Tasks

- [ ] Create migration file
- [ ] Define `documents` table schema
- [ ] Define `watched_folders` table schema
- [ ] Define `document_chunks` reference table
- [ ] Add appropriate indexes
- [ ] Test migration up and down
- [ ] Document schema in code comments

### Acceptance Criteria

- [ ] Migration runs successfully
- [ ] Rollback works correctly
- [ ] Indexes created for common queries
- [ ] Schema matches PRD specification

### Schema (from PRD)

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(255) NOT NULL,
  file_path VARCHAR(1024) NOT NULL,
  absolute_path VARCHAR(2048),
  document_type VARCHAR(50) NOT NULL,
  title VARCHAR(512),
  author VARCHAR(255),
  created_at TIMESTAMP,
  page_count INTEGER,
  word_count INTEGER,
  toc_structure JSONB,
  section_count INTEGER,
  image_width INTEGER,
  image_height INTEGER,
  image_format VARCHAR(50),
  exif_data JSONB,
  content_description TEXT,
  file_size_bytes BIGINT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  file_modified_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processing_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  processing_error TEXT,
  chunk_count INTEGER DEFAULT 0,
  ocr_processed BOOLEAN DEFAULT FALSE,
  ocr_confidence NUMERIC(5,2),
  UNIQUE(source_id, file_path)
);
```
```

---

#### M2-T5: Integrate with IngestionService

**Title:** `Integrate DocumentChunker with IngestionService`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Integrate with IngestionService

**Epic:** M2: Document Chunking
**Priority:** P0
**Effort:** 5-6 hours
**Dependencies:** M2-T1, M2-T4

### Description

Integrate the new document chunking pipeline with the existing `IngestionService` to enable document indexing.

### Tasks

- [ ] Extend IngestionService to handle documents
- [ ] Add document type detection in ingestion flow
- [ ] Route to appropriate extractor based on type
- [ ] Use DocumentChunker for document content
- [ ] Store document metadata in PostgreSQL
- [ ] Store chunks in ChromaDB
- [ ] Handle mixed repositories (code + docs)
- [ ] Write integration tests

### Acceptance Criteria

- [ ] Documents can be ingested alongside code
- [ ] Document metadata stored in PostgreSQL
- [ ] Document chunks stored in ChromaDB
- [ ] Integration tests pass

### Technical Notes

- May need to refactor IngestionService for extensibility
- Consider separate document ingestion path if simpler
```

---

#### M2-T6: Add document metadata to ChromaDB storage

**Title:** `Add document-specific metadata to ChromaDB storage`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:**
```markdown
## Task: Add document metadata to ChromaDB

**Epic:** M2: Document Chunking
**Priority:** P0
**Effort:** 2-3 hours
**Dependencies:** M2-T1

### Description

Ensure document chunks stored in ChromaDB include all necessary metadata for filtering and display.

### Tasks

- [ ] Define ChromaDB metadata schema for documents
- [ ] Add documentType field
- [ ] Add pageNumber field (for PDFs)
- [ ] Add sectionHeading field
- [ ] Add documentTitle field
- [ ] Add documentAuthor field
- [ ] Update ChromaStorageClient if needed
- [ ] Write unit tests

### Acceptance Criteria

- [ ] Document chunks stored with full metadata
- [ ] Metadata queryable via ChromaDB filters
- [ ] Backward compatible with code chunks

### Technical Notes

```typescript
interface DocumentChunkMetadata {
  documentType: 'pdf' | 'docx' | 'markdown' | 'txt';
  extension: string;
  language?: string;      // For markdown code blocks
  pageNumber?: number;    // For PDFs
  sectionHeading?: string;
  documentTitle?: string;
  documentAuthor?: string;
  fileSizeBytes: number;
  contentHash: string;
  fileModifiedAt: string;
}
```
```

---

#### M2-T7: Integration tests for chunking pipeline

**Title:** `Integration tests for document chunking pipeline`
**Labels:** `testing`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Integration tests for chunking pipeline

**Epic:** M2: Document Chunking
**Priority:** P0
**Effort:** 4-5 hours
**Dependencies:** M2-T1 through M2-T6

### Description

Write integration tests validating the complete document chunking and storage pipeline.

### Tasks

- [ ] Set up test environment with ChromaDB and PostgreSQL
- [ ] Write test for PDF extraction -> chunking -> storage
- [ ] Write test for DOCX extraction -> chunking -> storage
- [ ] Write test for Markdown extraction -> chunking -> storage
- [ ] Verify metadata stored correctly in PostgreSQL
- [ ] Verify chunks stored correctly in ChromaDB
- [ ] Verify chunk-document references maintained
- [ ] Test retrieval and search

### Acceptance Criteria

- [ ] Integration tests cover all document types
- [ ] Tests validate storage in both databases
- [ ] Tests run successfully in CI
- [ ] Pipeline handles real documents correctly
```

---

### M3: MCP Tools - Tasks

---

#### M3-T1: Implement search_documents MCP tool

**Title:** `Implement search_documents MCP tool`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Implement search_documents MCP tool

**Epic:** M3: MCP Tools
**Priority:** P0
**Effort:** 6-8 hours
**Dependencies:** M2 complete

### Description

Implement the `search_documents` MCP tool for semantic search across indexed documents.

### Tasks

- [ ] Create tool handler in `src/mcp/tools/`
- [ ] Implement input schema validation
- [ ] Query ChromaDB for document chunks
- [ ] Filter by document_types if specified
- [ ] Filter by folder if specified
- [ ] Apply similarity threshold
- [ ] Return structured response per PRD
- [ ] Add tool documentation
- [ ] Write unit tests

### Acceptance Criteria

- [ ] Tool returns relevant document passages
- [ ] Filtering by type and folder works
- [ ] Similarity threshold respected
- [ ] Response matches PRD schema
- [ ] Unit tests pass

### Input Schema (from PRD)

```json
{
  "query": "string (required)",
  "document_types": ["pdf", "docx", "markdown", "txt", "all"],
  "folder": "string (optional)",
  "limit": "integer (1-50, default 10)",
  "threshold": "number (0-1, default 0.7)"
}
```

### Response Schema (from PRD)

```typescript
interface SearchDocumentsResponse {
  results: Array<{
    content: string;
    documentPath: string;
    documentTitle?: string;
    documentType: string;
    pageNumber?: number;
    sectionHeading?: string;
    similarity: number;
    folder: string;
  }>;
  metadata: {
    totalResults: number;
    queryTimeMs: number;
    searchedFolders: string[];
    searchedDocumentTypes: string[];
  };
}
```
```

---

#### M3-T2: Implement search_images MCP tool

**Title:** `Implement search_images MCP tool`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Implement search_images MCP tool

**Epic:** M3: MCP Tools
**Priority:** P0
**Effort:** 5-6 hours
**Dependencies:** M2 complete

### Description

Implement the `search_images` MCP tool for metadata-based image search.

### Tasks

- [ ] Create tool handler in `src/mcp/tools/`
- [ ] Implement input schema validation
- [ ] Query PostgreSQL for image metadata
- [ ] Filter by format if specified
- [ ] Filter by date range if specified
- [ ] Filter by dimensions if specified
- [ ] Support filename pattern matching
- [ ] Return structured response per PRD
- [ ] Write unit tests

### Acceptance Criteria

- [ ] Tool returns matching images
- [ ] All filters work correctly
- [ ] Date range filtering works
- [ ] Filename patterns work
- [ ] Response matches PRD schema
- [ ] Unit tests pass

### Input Schema (from PRD)

```json
{
  "folder": "string (optional)",
  "format": ["jpeg", "png", "gif", "webp", "tiff", "all"],
  "date_from": "date (YYYY-MM-DD)",
  "date_to": "date (YYYY-MM-DD)",
  "min_width": "integer",
  "min_height": "integer",
  "filename_pattern": "string (glob)",
  "limit": "integer (1-100, default 20)"
}
```
```

---

#### M3-T3: Implement list_watched_folders MCP tool

**Title:** `Implement list_watched_folders MCP tool`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:**
```markdown
## Task: Implement list_watched_folders MCP tool

**Epic:** M3: MCP Tools
**Priority:** P0
**Effort:** 2-3 hours
**Dependencies:** PostgreSQL watched_folders table

### Description

Implement the `list_watched_folders` MCP tool for viewing configured watched folders and their status.

### Tasks

- [ ] Create tool handler in `src/mcp/tools/`
- [ ] Query PostgreSQL watched_folders table
- [ ] Include document and image counts
- [ ] Include watcher status
- [ ] Include configuration (patterns)
- [ ] Return structured response per PRD
- [ ] Write unit tests

### Acceptance Criteria

- [ ] Tool returns all watched folders
- [ ] Counts are accurate
- [ ] Status reflects actual watcher state
- [ ] Response matches PRD schema
- [ ] Unit tests pass

### Response Schema (from PRD)

```typescript
interface ListWatchedFoldersResponse {
  folders: Array<{
    id: string;
    name: string;
    path: string;
    enabled: boolean;
    documentCount: number;
    imageCount: number;
    lastScanAt?: Date;
    watcherStatus: "active" | "paused" | "error";
    includePatterns: string[];
    excludePatterns: string[];
  }>;
}
```
```

---

#### M3-T4: Update semantic_search with include_documents option

**Title:** `Update semantic_search with include_documents option`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:**
```markdown
## Task: Update semantic_search tool

**Epic:** M3: MCP Tools
**Priority:** P0
**Effort:** 2-3 hours
**Dependencies:** M3-T1

### Description

Enhance the existing `semantic_search` MCP tool to optionally include document results alongside code.

### Tasks

- [ ] Add `include_documents` parameter to schema
- [ ] Update tool handler to query both code and documents
- [ ] Merge and sort results by similarity
- [ ] Distinguish document vs code results in response
- [ ] Update tool documentation
- [ ] Write unit tests

### Acceptance Criteria

- [ ] `include_documents: false` (default) behaves as before
- [ ] `include_documents: true` includes document results
- [ ] Results properly merged and sorted
- [ ] Response indicates result type
- [ ] Backward compatible
- [ ] Unit tests pass
```

---

#### M3-T5: Register new tools in MCP registry

**Title:** `Register new tools in MCP tool registry`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:**
```markdown
## Task: Register new tools in MCP registry

**Epic:** M3: MCP Tools
**Priority:** P0
**Effort:** 1-2 hours
**Dependencies:** M3-T1, M3-T2, M3-T3

### Description

Register all new document-related MCP tools in the tool registry.

### Tasks

- [ ] Register `search_documents` tool
- [ ] Register `search_images` tool
- [ ] Register `list_watched_folders` tool
- [ ] Verify tools appear in tool listing
- [ ] Test tool invocation through MCP

### Acceptance Criteria

- [ ] All tools registered and callable
- [ ] Tools appear in tools/list response
- [ ] Tool schemas correct in registry
```

---

#### M3-T6: Add comprehensive tool documentation

**Title:** `Add comprehensive MCP tool documentation`
**Labels:** `documentation`, `phase-6`, `P1`, `size:S`

**Body:**
```markdown
## Task: Add tool documentation

**Epic:** M3: MCP Tools
**Priority:** P1
**Effort:** 2-3 hours
**Dependencies:** M3-T1, M3-T2, M3-T3

### Description

Write comprehensive documentation for all new MCP tools.

### Tasks

- [ ] Document `search_documents` with examples
- [ ] Document `search_images` with examples
- [ ] Document `list_watched_folders` with examples
- [ ] Document updated `semantic_search`
- [ ] Add to API documentation
- [ ] Include in user guide

### Acceptance Criteria

- [ ] All tools documented with usage examples
- [ ] Input/output schemas explained
- [ ] Common use cases covered
```

---

#### M3-T7: Integration tests for MCP tools

**Title:** `Integration tests for MCP tools`
**Labels:** `testing`, `phase-6`, `P0`, `size:M`

**Body:**
```markdown
## Task: Integration tests for MCP tools

**Epic:** M3: MCP Tools
**Priority:** P0
**Effort:** 4-5 hours
**Dependencies:** M3-T1 through M3-T5

### Description

Write integration tests for all new MCP tools.

### Tasks

- [ ] Set up test environment with indexed documents
- [ ] Test search_documents with various queries
- [ ] Test search_documents with filters
- [ ] Test search_images with metadata filters
- [ ] Test list_watched_folders
- [ ] Test semantic_search with include_documents
- [ ] Test error handling

### Acceptance Criteria

- [ ] All tools tested with real data
- [ ] Filter combinations tested
- [ ] Error scenarios covered
- [ ] Tests pass in CI
```

---

### M4: Folder Watching - Tasks

I'll continue with the remaining milestones in a condensed format due to the length:

---

#### M4-T1: Implement FolderWatcherService

**Title:** `Implement FolderWatcherService with chokidar`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:L`

**Body:** Implement the core folder watcher service using chokidar. Handle file events (add, change, unlink), support multiple watched folders, implement debouncing.

---

#### M4-T2: Add debouncing

**Title:** `Add debouncing for rapid file changes`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:** Implement configurable debounce (default 2s) to prevent excessive re-indexing during active editing.

---

#### M4-T3: Implement change detection

**Title:** `Implement change detection (add/modify/delete)`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:** Detect and categorize file changes. Handle renamed files as delete + create.

---

#### M4-T4: Create processing queue

**Title:** `Create processing queue for batched updates`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:** Implement async processing queue to batch file changes and prevent overwhelming storage backends.

---

#### M4-T5: Implement incremental updates

**Title:** `Implement incremental index updates`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:** Update ChromaDB and PostgreSQL incrementally based on file changes. Add new files, update modified, remove deleted.

---

#### M4-T6: Add .pkignore support

**Title:** `Add .pkignore file support`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:S`

**Body:** Implement .pkignore files using `ignore` package for .gitignore-style pattern matching.

---

#### M4-T7: Create watched_folders table

**Title:** `Create PostgreSQL watched_folders table migration`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:** Create migration for watched_folders configuration table.

---

#### M4-T8: Handle watcher lifecycle

**Title:** `Handle watcher lifecycle (start/stop/restart)`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:** Implement watcher lifecycle management. Start on service boot, stop cleanly, restart on configuration change.

---

#### M4-T9: Integration tests

**Title:** `Integration tests for folder watcher scenarios`
**Labels:** `testing`, `phase-6`, `P0`, `size:L`

**Body:** Write integration tests covering add/modify/delete scenarios, debouncing, and 24-hour stability.

---

### M5: CLI & Polish - Tasks

---

#### M5-T1: documents index command

**Title:** `Implement pk-mcp documents index command`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:** Implement CLI command for one-time document folder indexing with options for name, include/exclude patterns, dry-run.

---

#### M5-T2: watch commands

**Title:** `Implement pk-mcp watch commands (add/list/remove/pause/resume/rescan)`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:L`

**Body:** Implement all watch management CLI commands as specified in PRD Section 8.2.

---

#### M5-T3: documents status command

**Title:** `Implement pk-mcp documents status command`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:** Show document indexing status by type, folder, and error state.

---

#### M5-T4: documents errors and retry

**Title:** `Implement pk-mcp documents errors and retry commands`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:S`

**Body:** Commands to view and retry failed document processing.

---

#### M5-T5: Progress reporting

**Title:** `Add progress reporting for bulk operations`
**Labels:** `enhancement`, `phase-6`, `P0`, `size:M`

**Body:** Show progress percentage and estimated time for bulk indexing operations.

---

#### M5-T6: Performance testing

**Title:** `Performance testing against PRD targets`
**Labels:** `testing`, `phase-6`, `P0`, `size:M`

**Body:** Validate performance against all PRD targets (PDF <2s, search <500ms, etc.)

---

#### M5-T7: User documentation

**Title:** `Write user documentation for document features`
**Labels:** `documentation`, `phase-6`, `P1`, `size:M`

**Body:** Complete user guide for document ingestion features.

---

#### M5-T8: README update

**Title:** `Update README with document ingestion guide`
**Labels:** `documentation`, `phase-6`, `P1`, `size:S`

**Body:** Add document ingestion section to main README.

---

#### M5-T9: Embedding observability (Optional)

**Title:** `(Optional) Add embedding provider observability logging`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Add error logging and latency warnings per Issue #28.

---

### M6: OCR Processing - Tasks

---

#### M6-T1: OcrService

**Title:** `Implement OcrService with tesseract.js v6`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:L`

**Body:** Core OCR service implementation with tesseract.js. Handle text extraction, confidence scores, language configuration.

---

#### M6-T2: PDF page converter

**Title:** `Create PDF page-to-image converter using pdfjs-dist`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:M`

**Body:** Convert PDF pages to images for OCR processing.

---

#### M6-T3: Image-only PDF detection

**Title:** `Implement image-only PDF detection`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:S`

**Body:** Detect PDFs without extractable text layer.

---

#### M6-T4: Confidence tracking

**Title:** `Add OCR confidence score tracking`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:S`

**Body:** Track and store OCR confidence scores per page.

---

#### M6-T5: Language configuration

**Title:** `Implement configurable OCR languages`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:S`

**Body:** Support configurable OCR languages (default: English).

---

#### M6-T6: Background queue

**Title:** `Create background processing queue for OCR`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:M`

**Body:** Async background queue for long-running OCR operations.

---

#### M6-T7: Progress reporting

**Title:** `Add progress reporting for OCR jobs`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:S`

**Body:** Show progress for long-running OCR operations.

---

#### M6-T8: Timeout handling

**Title:** `Implement OCR timeout handling`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:S`

**Body:** Per-page timeout limits (default 30s).

---

#### M6-T9: CLI commands

**Title:** `Add CLI commands for OCR status`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:S`

**Body:** CLI commands for OCR status and manual triggers.

---

#### M6-T10: MCP tool updates

**Title:** `Update MCP tools to include OCR content`
**Labels:** `enhancement`, `phase-6`, `P1`, `size:S`

**Body:** Include OCR-extracted content in search results.

---

#### M6-T11: Unit tests

**Title:** `Unit tests for OCR service (85%+ coverage)`
**Labels:** `testing`, `phase-6`, `P1`, `size:M`

**Body:** Unit tests for OcrService.

---

#### M6-T12: Integration tests

**Title:** `Integration tests for OCR pipeline`
**Labels:** `testing`, `phase-6`, `P1`, `size:M`

**Body:** End-to-end OCR pipeline tests.

---

### M7: Table Extraction - Tasks

---

#### M7-T1: TableExtractor interface

**Title:** `Implement TableExtractor interface`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Define common interface for table extraction.

---

#### M7-T2: PdfTableExtractor

**Title:** `Implement PdfTableExtractor with pdfreader`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** PDF table detection and extraction using pdfreader.

---

#### M7-T3: DocxTableExtractor

**Title:** `Implement DocxTableExtractor`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** DOCX table extraction from mammoth HTML output.

---

#### M7-T4: Table structure model

**Title:** `Create table structure model`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Define ExtractedTable interface with rows, columns, headers.

---

#### M7-T5: Header detection

**Title:** `Implement table header detection`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** Heuristic-based header row detection.

---

#### M7-T6: Multi-page tables

**Title:** `Add multi-page table handling`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** Handle tables spanning multiple PDF pages.

---

#### M7-T7: PostgreSQL storage

**Title:** `Store tables in PostgreSQL (JSON)`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Store extracted tables in extracted_tables table.

---

#### M7-T8: ChromaDB indexing

**Title:** `Index table content in ChromaDB`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Index flattened table text with table context metadata.

---

#### M7-T9: tables list command

**Title:** `Implement pk-mcp tables list command`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** CLI command to list extracted tables.

---

#### M7-T10: tables export command

**Title:** `Implement pk-mcp tables export command`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** Export tables to CSV/JSON formats.

---

#### M7-T11: MCP tool update

**Title:** `Add table filtering to search_documents`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Add include_tables option to search_documents.

---

#### M7-T12: Unit tests

**Title:** `Unit tests for table extraction (85%+ coverage)`
**Labels:** `testing`, `phase-6`, `P2`, `size:M`

**Body:** Unit tests for table extractors.

---

### M8: Image Content Analysis - Tasks

---

#### M8-T1: ImageAnalysisService

**Title:** `Implement ImageAnalysisService with provider abstraction`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** Core service with provider abstraction for local/cloud analysis.

---

#### M8-T2: LocalImageAnalyzer

**Title:** `Implement LocalImageAnalyzer with Transformers.js`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:L`

**Body:** Local image analysis using BLIP model via @xenova/transformers.

---

#### M8-T3: OpenAIImageAnalyzer

**Title:** `Implement OpenAIImageAnalyzer`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** Cloud image analysis using OpenAI Vision API.

---

#### M8-T4: Provider configuration

**Title:** `Create provider configuration`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Configuration for selecting local vs cloud provider.

---

#### M8-T5: Lazy model loading

**Title:** `Implement lazy model loading`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Load models on-demand, unload after batch.

---

#### M8-T6: Image type classification

**Title:** `Add image type classification`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** Classify images as diagram, screenshot, photo, chart.

---

#### M8-T7: PostgreSQL storage

**Title:** `Store descriptions in PostgreSQL`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Store content descriptions in documents table.

---

#### M8-T8: Embeddings generation

**Title:** `Generate embeddings from descriptions`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Create embeddings from descriptions for ChromaDB.

---

#### M8-T9: MCP tool update

**Title:** `Add content_query to search_images MCP tool`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Enable semantic search of images by content description.

---

#### M8-T10: images analyze command

**Title:** `Implement pk-mcp images analyze command`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** CLI command to trigger image analysis.

---

#### M8-T11: images reanalyze command

**Title:** `Implement pk-mcp images reanalyze command`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** CLI command to re-analyze images with updated models.

---

#### M8-T12: Progress reporting

**Title:** `Add analysis progress reporting`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:S`

**Body:** Show progress for batch image analysis operations.

---

#### M8-T13: Unit tests

**Title:** `Unit tests for image analysis (85%+ coverage)`
**Labels:** `enhancement`, `phase-6`, `P2`, `size:M`

**Body:** Unit tests for ImageAnalysisService.

---

#### M8-T14: Integration tests

**Title:** `Integration tests for both providers`
**Labels:** `testing`, `phase-6`, `P2`, `size:M`

**Body:** Integration tests for local and cloud image analysis.

---

## Issue Creation Summary

| Milestone | Epic | Tasks | Total |
|-----------|------|-------|-------|
| M1: Core Extractors | 1 | 8 | 9 |
| M2: Document Chunking | 1 | 7 | 8 |
| M3: MCP Tools | 1 | 7 | 8 |
| M4: Folder Watching | 1 | 9 | 10 |
| M5: CLI & Polish | 1 | 9 | 10 |
| M6: OCR Processing | 1 | 12 | 13 |
| M7: Table Extraction | 1 | 12 | 13 |
| M8: Image Content Analysis | 1 | 14 | 15 |
| **Total** | **8** | **78** | **86** |

---

## Issue Creation Commands

Use the GitHub CLI to create issues:

```bash
# Create labels first
gh label create "phase-6" --description "Phase 6 - Document Ingestion" --color "0E8A16"
gh label create "epic" --description "Epic/parent issues" --color "7057FF"
gh label create "size:S" --description "Small (2-4 hours)" --color "C2E0C6"
gh label create "size:M" --description "Medium (4-8 hours)" --color "FEF2C0"
gh label create "size:L" --description "Large (8+ hours)" --color "F9D0C4"

# Create milestone
gh api repos/{owner}/{repo}/milestones -f title="Phase 6: Unstructured Document Ingestion" -f description="Enable document ingestion with semantic search" -f due_on="2026-04-15T00:00:00Z"

# Create epic issues (example)
gh issue create --title "[Epic] M1: Core Document Extractors (Phase 6 - Weeks 1-2)" --body-file epic-m1.md --label "epic" --label "enhancement" --label "phase-6"

# Create task issues (example)
gh issue create --title "Create src/documents/ module structure" --body-file m1-t1.md --label "enhancement" --label "phase-6" --label "P0" --label "size:S"
```

---

*Document generated: January 18, 2026*
*Repository: sethb75/PersonalKnowledgeMCP*
