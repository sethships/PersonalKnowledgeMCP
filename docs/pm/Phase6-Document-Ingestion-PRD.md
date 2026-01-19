# Phase 6: Unstructured Document Ingestion PRD - Personal Knowledge MCP

**Version:** 1.3
**Date:** January 18, 2026
**Status:** Draft
**Author:** Product Team
**Parent Document:** [High-level Personal Knowledge MCP PRD](../High-level-Personal-Knowledge-MCP-PRD.md)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals and Non-Goals](#2-goals-and-non-goals)
3. [User Stories and Use Cases](#3-user-stories-and-use-cases)
4. [Functional Requirements](#4-functional-requirements)
5. [Technical Requirements](#5-technical-requirements)
6. [Architecture and Design Considerations](#6-architecture-and-design-considerations)
7. [MCP Tool Design](#7-mcp-tool-design)
8. [CLI Commands](#8-cli-commands)
9. [Dependencies and Libraries](#9-dependencies-and-libraries)
10. [Success Metrics](#10-success-metrics)
11. [Implementation Milestones](#11-implementation-milestones)
12. [Risks and Mitigations](#12-risks-and-mitigations)
13. [Future Considerations](#13-future-considerations)

---

## 1. Executive Summary

This PRD defines the implementation of unstructured document ingestion capabilities for the Personal Knowledge MCP system. Building upon the existing code repository ingestion pipeline, Phase 6 extends the system to support educational materials, documentation, and other non-code content types including PDF documents, Microsoft Word files, Markdown, and images with metadata extraction.

### The Core Value Proposition

The Personal Knowledge MCP currently excels at indexing and searching code repositories. However, the system's secondary use case - educational material organization and documentation management - requires robust support for unstructured document formats that are common in academic and professional settings.

**Phase 6 enables:**
1. **Educational Material Integration**: Index college notes, textbooks, and academic papers in PDF, DOCX, and Markdown formats
2. **Documentation Search**: Make product documentation, design docs, and reference materials semantically searchable
3. **Local Folder Monitoring**: Automatically update the knowledge base when files change in watched directories
4. **Image Context Capture**: Extract and index metadata from images to enable discovery of visual assets

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PDF Parser | pdf-parse (pdf.js-based) | Pure JavaScript, well-maintained, good text extraction quality |
| DOCX Parser | mammoth | Clean API, preserves document structure, converts to HTML/text |
| Image Metadata | sharp + exif-parser | sharp for dimensions/format, exif-parser for EXIF data |
| File Watcher | chokidar | Industry standard, cross-platform, handles edge cases well |
| OCR for Images | Stretch Goal (tesseract.js) | Significant complexity; defer to future phase |
| Document Chunking | Extend existing FileChunker | Leverage existing infrastructure, maintain consistency |

---

## 2. Goals and Non-Goals

### Goals

**Primary Goals:**
1. **PDF Document Ingestion**: Extract text content, structure (headings, paragraphs), and metadata from PDF files
2. **Markdown File Processing**: Process Markdown files with proper structure preservation (headings, lists, code blocks)
3. **DOCX Document Support**: Extract text and structure from Microsoft Word documents
4. **Local Folder Watching**: Monitor configured directories for file changes and trigger incremental indexing
5. **Image Metadata Extraction**: Capture dimensions, format, EXIF data, and creation dates from image files
6. **Incremental Updates**: Efficiently update index when files are added, modified, or deleted

**Secondary Goals:**
7. **Configurable Ignore Patterns**: Support .gitignore-style patterns for excluding files from watched folders
8. **Nested Folder Structure Support**: Preserve folder hierarchy as metadata for organization context
9. **Document Metadata Indexing**: Capture and index document properties (author, creation date, title)
10. **Progress Reporting**: Provide visibility into document processing status
11. **Embedding Provider Observability**: Basic operational logging for embedding operations during document ingestion (see [GitHub Issue #28](https://github.com/sethb75/PersonalKnowledgeMCP/issues/28))

**Advanced Content Processing Goals (P1/P2):**
12. **OCR for Scanned Documents**: Extract text from image-based PDFs and scanned documents using optical character recognition (P1)
13. **Complex Table Extraction**: Extract structured table data from PDFs and DOCX documents, preserving row/column relationships (P2)
14. **Image Content Analysis**: Generate AI-based descriptions of image content for semantic searchability (P2)

### Non-Goals

1. **Document format conversion**: Converting between formats (e.g., DOCX to PDF) is not in scope
2. **Real-time collaborative document editing**: No concurrent editing support
3. **Cloud storage integration**: OneDrive, Google Drive, Dropbox sync is deferred to future phases
4. **Video/audio file processing**: Multimedia content (video transcription, audio analysis) is out of scope for this phase
5. **Advanced PDF form extraction**: Extracting interactive form field data and form logic is not supported
6. **Handwriting recognition**: Recognition of handwritten text in scanned documents is not supported (OCR covers printed text only)
7. **Multi-language OCR optimization**: While basic multi-language OCR is supported, optimization for non-Latin scripts (CJK, Arabic, etc.) is deferred
8. **Real-time image content analysis**: Streaming or real-time video frame analysis is out of scope; only static images are analyzed

---

## 3. User Stories and Use Cases

### 3.1 Primary User Stories

#### US-1: Index College Notes
**As a** student using Claude Code for research
**I want to** index my college course notes stored in various formats (PDF, DOCX, Markdown)
**So that** I can semantically search across all my academic materials

**Acceptance Criteria:**
- PDF documents are extracted with text content preserved
- DOCX files are converted to searchable text
- Markdown files retain structure (headings become navigable)
- Folder structure (e.g., Course > Semester > Topic) is captured as metadata
- Search returns relevant sections with file path and location context

#### US-2: Watch Documentation Folder
**As a** developer working on multiple projects
**I want to** set up a watched folder for project documentation
**So that** new or updated documents are automatically indexed

**Acceptance Criteria:**
- File watcher detects new, modified, and deleted files
- New files are automatically processed and indexed
- Modified files trigger re-indexing of changed content
- Deleted files are removed from the index
- Configurable debounce to avoid excessive re-indexing during active editing

#### US-3: Search Image Assets by Metadata
**As a** developer maintaining documentation with screenshots
**I want to** find images by their metadata (date taken, dimensions, camera info)
**So that** I can locate specific visual assets without manual browsing

**Acceptance Criteria:**
- Image dimensions (width, height) are extracted and indexed
- EXIF data (date taken, camera model, GPS coordinates if present) is captured
- File creation/modification dates are stored
- Search can filter by image properties (e.g., "screenshots from last week")

#### US-4: Exclude Specific Files and Folders
**As a** user organizing my knowledge library
**I want to** configure patterns to exclude certain files from indexing
**So that** private notes, draft documents, or irrelevant files are not indexed

**Acceptance Criteria:**
- Support .gitignore-style pattern syntax
- Per-folder .pkignore files are respected
- Global exclusion patterns configurable in system settings
- Exclusions work for both initial indexing and watched folders

### 3.2 Secondary User Stories

#### US-5: Re-process Failed Documents
**As a** user troubleshooting indexing issues
**I want to** see which documents failed to process and retry them
**So that** I can ensure complete coverage of my knowledge base

#### US-6: Preserve Document Structure
**As a** user searching through long documents
**I want to** find specific sections within documents (chapters, headings)
**So that** I can navigate directly to relevant content

#### US-7: Monitor Indexing Progress
**As a** user importing a large document collection
**I want to** see progress during bulk indexing operations
**So that** I know how long the process will take and can verify completion

#### US-8: Diagnose Embedding Failures
**As a** user troubleshooting why documents are not being indexed
**I want to** see operational metrics for embedding operations (errors, latency warnings)
**So that** I can identify if the embedding provider is causing issues

**Acceptance Criteria:**
- Embedding errors are logged with context (provider, model, error type)
- Slow embedding operations (>5s) generate latency warnings
- Errors are visible through CLI status commands
- Follows existing logging framework patterns

*Reference: [GitHub Issue #28](https://github.com/sethb75/PersonalKnowledgeMCP/issues/28)*

### 3.3 Advanced Content Processing User Stories

#### US-9: Search Scanned Document Content
**As a** researcher with a collection of scanned academic papers
**I want to** search the text content within scanned PDFs
**So that** I can find relevant information even in documents that are image-based rather than text-based

**Acceptance Criteria:**
- System detects image-only PDFs during ingestion
- OCR processing extracts text from each page image
- Extracted text is chunked and embedded for semantic search
- OCR confidence scores are captured as metadata
- Processing time warnings for large scanned documents (>10 pages)
- Support for common scan qualities (150-600 DPI)
- Graceful handling of low-quality scans with partial text extraction

#### US-10: Extract and Search Table Data
**As a** analyst reviewing financial reports and data-heavy documents
**I want to** search for specific data within tables in my PDFs and Word documents
**So that** I can find numerical data and structured information without manually opening each document

**Acceptance Criteria:**
- Tables are detected within PDF and DOCX documents
- Table structure (rows, columns, headers) is preserved in extraction
- Table data is indexed separately from prose content
- Search results indicate when matches are within table context
- Tables can be exported in structured formats (CSV, JSON) via CLI
- Column headers are used to enhance semantic understanding
- Multi-page tables spanning page breaks are handled correctly

#### US-11: Search Images by Content Description
**As a** developer maintaining a large collection of diagrams and screenshots
**I want to** find images based on what they contain (e.g., "architecture diagram with database")
**So that** I can locate visual assets by their content rather than just filename or date

**Acceptance Criteria:**
- Images are analyzed to generate content descriptions
- Descriptions are embedded for semantic search
- Search queries can match image content (e.g., "flowchart", "error message screenshot")
- Analysis supports common image types: diagrams, screenshots, photos, charts
- Processing can run locally or via cloud API (configurable)
- Content descriptions are human-readable and stored as metadata
- Option to re-analyze images with updated models

### 3.4 Use Case Scenarios

**Scenario 1: Graduate Student Research**
```
Student: "I need to review what my coursework covered about machine learning regularization."

Action:
1. User has indexed their MS program notes folder containing:
   - CS500-Machine-Learning/Week5-Regularization.pdf (lecture slides)
   - CS500-Machine-Learning/Homework3.docx (assignment with notes)
   - CS500-Machine-Learning/notes/regularization-summary.md (personal notes)
2. Claude Code queries: semantic_search("machine learning regularization techniques")
3. Returns relevant chunks from all three documents with:
   - File paths showing course context
   - Page/section numbers for navigation
   - Similarity scores for relevance ranking
```

**Scenario 2: Living Documentation**
```
Developer: "I update our API documentation frequently and want it always searchable."

Action:
1. User configures folder watch: pk-mcp watch add ./docs/api --patterns "*.md,*.pdf"
2. Developer edits ./docs/api/authentication.md
3. File watcher detects change after 2-second debounce
4. System re-indexes only authentication.md (incremental update)
5. Claude Code immediately has access to updated content
6. Deletion of deprecated.md removes it from search results
```

**Scenario 3: Visual Asset Discovery**
```
Developer: "Find the architecture diagram I took a photo of at the whiteboard session last Tuesday."

Action:
1. User has image folder watched: ~/work/diagrams
2. Query: search_images(date_range="2026-01-14 to 2026-01-14", type="photo")
3. Returns images with matching EXIF date
4. User can narrow by dimensions or other metadata
```

**Scenario 4: Scanned Academic Paper Research**
```
Researcher: "Find information about gradient descent optimization in my scanned textbook chapters."

Action:
1. User has indexed ~/Documents/Textbooks containing scanned PDFs from older textbooks
2. System detected these as image-only PDFs during ingestion
3. OCR processing extracted text from each page (with ~95% accuracy for clean scans)
4. Claude Code queries: semantic_search("gradient descent optimization convergence")
5. Returns relevant passages from scanned textbook with:
   - Source file and page number
   - OCR confidence indicator
   - Extracted text content
6. User can access the original scanned page for verification
```

**Scenario 5: Financial Report Table Search**
```
Analyst: "Find the quarterly revenue figures from last year's annual reports."

Action:
1. User has indexed ~/Documents/FinancialReports containing annual report PDFs
2. System extracted tables during ingestion, identifying revenue tables by headers
3. Query: search_documents("quarterly revenue 2025", include_tables=true)
4. Returns:
   - Table context showing "Q1-Q4 Revenue" headers
   - Structured data: {"Q1": "$2.3M", "Q2": "$2.8M", ...}
   - Source document and page reference
5. User can export table data: pk-mcp tables export "annual-report-2025.pdf" --format csv
```

**Scenario 6: Diagram Content Search**
```
Developer: "Find all diagrams showing database architecture."

Action:
1. User has image folder watched: ~/work/documentation/images
2. System analyzed images and generated content descriptions:
   - "architecture-v2.png": "System architecture diagram showing three-tier application with PostgreSQL database, Redis cache, and microservices"
   - "db-schema.png": "Database schema diagram with users, orders, and products tables with foreign key relationships"
3. Query: search_images(content_query="database architecture")
4. Returns images with matching content descriptions, ranked by semantic relevance
5. User can refine: search_images(content_query="PostgreSQL schema diagram")
```

---

## 4. Functional Requirements

### 4.1 Document Extraction

#### FR-1: PDF Document Processing

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-1.1 | Extract text content from text-based PDF documents | P0 |
| FR-1.2 | Preserve paragraph and heading structure where detectable | P0 |
| FR-1.3 | Extract document metadata (title, author, creation date, page count) | P1 |
| FR-1.4 | Handle multi-page documents with page number tracking | P0 |
| FR-1.5 | Support password-protected PDFs with user-provided password | P2 |
| FR-1.6 | Gracefully handle corrupt or unreadable PDFs with error reporting | P0 |
| FR-1.7 | Detect image-only PDFs and flag for potential OCR (stretch goal) | P2 |

#### FR-2: Markdown File Processing

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-2.1 | Parse Markdown syntax preserving heading hierarchy | P0 |
| FR-2.2 | Extract frontmatter metadata (YAML header) if present | P1 |
| FR-2.3 | Preserve code blocks with language annotation | P0 |
| FR-2.4 | Handle GitHub Flavored Markdown (GFM) extensions | P1 |
| FR-2.5 | Extract internal links and references as metadata | P2 |
| FR-2.6 | Support CommonMark and GFM specifications | P0 |

#### FR-3: DOCX Document Processing

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-3.1 | Extract text content preserving paragraph structure | P0 |
| FR-3.2 | Convert heading styles to structured hierarchy | P0 |
| FR-3.3 | Extract document metadata (author, title, creation date) | P1 |
| FR-3.4 | Handle embedded images (extract metadata, not content) | P2 |
| FR-3.5 | Preserve list structure (numbered, bulleted) | P1 |
| FR-3.6 | Handle .docx files only (legacy .doc format not supported) | P0 |

### 4.2 Local Folder Ingestion

#### FR-4: Folder Watching

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-4.1 | Monitor configured directories for file changes | P0 |
| FR-4.2 | Detect file creation, modification, and deletion events | P0 |
| FR-4.3 | Support nested folder structures with arbitrary depth | P0 |
| FR-4.4 | Configurable file extension filters per watched folder | P0 |
| FR-4.5 | Debounce rapid changes (configurable, default 2 seconds) | P0 |
| FR-4.6 | Persist watch configurations across service restarts | P1 |
| FR-4.7 | Handle renamed files as delete + create | P1 |
| FR-4.8 | Support multiple watched folders simultaneously | P0 |
| FR-4.9 | Survive temporary folder unavailability (network drives, USB) | P2 |

#### FR-5: Incremental Updates

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-5.1 | Only re-index files that have changed (based on modification time + hash) | P0 |
| FR-5.2 | Remove deleted files from ChromaDB and PostgreSQL | P0 |
| FR-5.3 | Batch changes to avoid overwhelming storage backends | P1 |
| FR-5.4 | Provide statistics on incremental update (added, modified, deleted counts) | P1 |
| FR-5.5 | Support forced full re-index via CLI command | P0 |

#### FR-6: Ignore Patterns

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-6.1 | Support .gitignore-style glob patterns | P0 |
| FR-6.2 | Respect per-folder .pkignore files | P1 |
| FR-6.3 | Global exclusion patterns in configuration | P0 |
| FR-6.4 | Default exclusions for common unwanted files (.DS_Store, Thumbs.db, etc.) | P0 |
| FR-6.5 | Pattern debugging via CLI (test which files would be excluded) | P2 |

### 4.3 Image Metadata Extraction

#### FR-7: Image Processing

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-7.1 | Extract dimensions (width, height) from images | P0 |
| FR-7.2 | Detect image format (PNG, JPEG, GIF, WebP) | P0 |
| FR-7.3 | Extract EXIF metadata (date taken, camera model, orientation) | P0 |
| FR-7.4 | Extract GPS coordinates if present (with privacy warning) | P2 |
| FR-7.5 | Store file-level metadata (size, modification date) | P0 |
| FR-7.6 | Support common formats: JPEG, PNG, GIF, WebP, TIFF | P0 |
| FR-7.7 | Handle images without EXIF data gracefully | P0 |
| FR-7.8 | (Stretch) OCR text extraction from images via tesseract.js | P3 |

#### FR-8: Embedding Provider Observability (GitHub Issue #28)

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-8.1 | Log embedding errors with context (provider name, model, error type, affected document) | P2 |
| FR-8.2 | Generate latency warnings for embedding operations exceeding 5 seconds | P2 |
| FR-8.3 | Track simple success/failure counters per indexing session | P3 |
| FR-8.4 | Integrate with existing logging framework (`src/logging/`) | P2 |
| FR-8.5 | Surface embedding operation status through CLI status commands | P2 |

*Note: These requirements implement the reduced scope from [GitHub Issue #28](https://github.com/sethb75/PersonalKnowledgeMCP/issues/28). Advanced metrics (token usage, cost estimation, histograms) are explicitly out of scope.*

### 4.4 Advanced Content Processing

#### FR-9: OCR for Scanned Documents

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-9.1 | Detect image-only PDFs during ingestion (no extractable text layer) | P1 |
| FR-9.2 | Convert PDF pages to images for OCR processing | P1 |
| FR-9.3 | Extract text from page images using tesseract.js | P1 |
| FR-9.4 | Support configurable OCR languages (default: English) | P1 |
| FR-9.5 | Capture OCR confidence scores per page/region | P1 |
| FR-9.6 | Handle mixed PDFs (some pages text, some scanned) | P1 |
| FR-9.7 | Provide OCR quality thresholds (skip low-confidence extractions) | P2 |
| FR-9.8 | Support OCR for standalone images (PNG, JPEG, TIFF) | P2 |
| FR-9.9 | Progress reporting for long-running OCR operations | P1 |
| FR-9.10 | Configurable OCR timeout per page (default: 30 seconds) | P2 |
| FR-9.11 | Option to skip OCR processing via configuration flag | P1 |
| FR-9.12 | Store original scan quality metrics (DPI detection if available) | P2 |

**Performance Considerations:**
- OCR processing is CPU-intensive and significantly slower than text extraction
- Expected processing time: 5-15 seconds per page depending on complexity
- Memory usage: ~200-500MB during active OCR processing
- Recommendation: Process OCR documents in background queue with lower priority

#### FR-10: Complex Table Extraction

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-10.1 | Detect tables within PDF documents | P2 |
| FR-10.2 | Detect tables within DOCX documents | P2 |
| FR-10.3 | Extract table structure preserving rows, columns, and headers | P2 |
| FR-10.4 | Handle merged cells and spanning headers | P2 |
| FR-10.5 | Extract tables spanning multiple pages in PDFs | P2 |
| FR-10.6 | Store tables in structured format (JSON) with source reference | P2 |
| FR-10.7 | Index table content for semantic search with table context metadata | P2 |
| FR-10.8 | Export individual tables to CSV format via CLI | P2 |
| FR-10.9 | Export individual tables to JSON format via CLI | P2 |
| FR-10.10 | Handle nested tables (tables within tables) gracefully | P3 |
| FR-10.11 | Detect table headers vs data rows heuristically | P2 |
| FR-10.12 | Support table search filtering in MCP tools | P2 |

**Implementation Notes:**
- PDF table extraction relies on layout analysis, which may not be 100% accurate
- DOCX tables are structurally defined and easier to extract accurately
- Tables with complex formatting (rotated text, nested structures) may require fallback to text extraction

#### FR-11: Image Content Analysis

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-11.1 | Generate natural language descriptions of image content | P2 |
| FR-11.2 | Support local processing via Transformers.js (BLIP/ViT models) | P2 |
| FR-11.3 | Support cloud API processing (OpenAI Vision, Azure AI Vision) as alternative | P2 |
| FR-11.4 | Configurable processing backend (local vs cloud) | P2 |
| FR-11.5 | Store content descriptions as searchable metadata | P2 |
| FR-11.6 | Generate embeddings from content descriptions for semantic search | P2 |
| FR-11.7 | Detect image type/category (diagram, screenshot, photo, chart, etc.) | P2 |
| FR-11.8 | Extract text visible in images (signage, labels, UI elements) | P3 |
| FR-11.9 | Support batch processing for large image collections | P2 |
| FR-11.10 | Configurable analysis detail level (brief vs detailed descriptions) | P3 |
| FR-11.11 | Option to skip image analysis via configuration flag | P2 |
| FR-11.12 | Re-analyze images on demand (model updates, corrections) | P2 |

**Processing Options:**

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Local (Transformers.js)** | Privacy, no API costs, offline capable | Slower, requires model download (~500MB-1GB), lower accuracy | Default for privacy-sensitive deployments |
| **Cloud (OpenAI Vision)** | High accuracy, fast, no local resources | API costs, requires internet, data leaves local system | Recommended for quality when acceptable |
| **Cloud (Azure AI Vision)** | Enterprise features, good accuracy | API costs, Azure subscription required | Alternative for Azure-heavy environments |

**Performance Considerations:**
- Local processing: 2-10 seconds per image depending on model and hardware
- Cloud processing: 1-3 seconds per image (network dependent)
- Memory for local: ~1-2GB additional when model is loaded
- Recommendation: Lazy-load model on first image, keep loaded during batch operations

---

## 5. Technical Requirements

### 5.1 Document Parser Evaluation

#### PDF Parsing Options

| Library | Pros | Cons | Recommendation |
|---------|------|------|----------------|
| **pdf-parse** | Pure JS, based on pdf.js, good extraction quality, maintained | Large dependency tree | **Recommended** |
| **pdfjs-dist** | Mozilla's official library, excellent parsing | Complex API, more low-level | Alternative for complex cases |
| **pdf2json** | Preserves layout information | Less maintained, heavier | Not recommended |
| **unpdf** | Modern, uses pdf.js under the hood | Newer, less battle-tested | Watch for maturity |

**Recommendation:** Start with `pdf-parse` for simplicity. It wraps pdf.js with a clean API suitable for text extraction. If advanced layout preservation is needed later, evaluate migrating to raw `pdfjs-dist`.

#### DOCX Parsing Options

| Library | Pros | Cons | Recommendation |
|---------|------|------|----------------|
| **mammoth** | Clean API, preserves structure, converts to HTML/text | Limited styling preservation | **Recommended** |
| **docx** | Full read/write, detailed document model | More complex for read-only use | Overkill for extraction |
| **officegen** | Creates documents, not for reading | Wrong tool for this job | Not suitable |
| **docx4js** | Cross-platform, browser support | Less maintained | Not recommended |

**Recommendation:** Use `mammoth` for DOCX extraction. Its `extractRawText` and `convertToHtml` methods provide exactly what we need with minimal complexity.

#### Image Metadata Options

| Library | Pros | Cons | Recommendation |
|---------|------|------|----------------|
| **sharp** | Fast, comprehensive, dimensions + basic metadata | Native bindings (larger install) | **Recommended** |
| **image-size** | Lightweight, dimensions only | No EXIF support | Combine with exif-parser |
| **exif-parser** | Lightweight EXIF extraction | JPEG only for EXIF | **Recommended** for EXIF |
| **exifr** | Modern, supports many formats | Larger than exif-parser | Alternative |

**Recommendation:** Use `sharp` for dimensions and format detection (it handles all image types well), combined with `exif-parser` or `exifr` for EXIF metadata extraction from JPEG/TIFF files.

#### File Watching Options

| Library | Pros | Cons | Recommendation |
|---------|------|------|----------------|
| **chokidar** | Industry standard, cross-platform, handles edge cases | Larger dependency | **Recommended** |
| **fs.watch** | Built-in, no dependencies | Inconsistent across platforms | Not recommended |
| **node-watch** | Simpler API than chokidar | Less robust edge case handling | Alternative |
| **watchman** | Facebook's solution, very robust | External dependency, complex setup | Overkill |

**Recommendation:** Use `chokidar`. It is the de facto standard for Node.js file watching, handles cross-platform quirks, and provides a clean event-based API.

#### OCR Library Options

| Library | Pros | Cons | Recommendation |
|---------|------|------|----------------|
| **tesseract.js** | Pure JS, 100+ languages, well-maintained, v6 performance improvements | Large model files (~50MB+), CPU-intensive | **Recommended** |
| **Scribe.js** | Improved accuracy over tesseract.js, native PDF support | Newer, less community support | Alternative for higher accuracy |
| **PaddleOCR (via node wrapper)** | Excellent accuracy, good for complex layouts | Requires Python backend or native bindings | Consider for CJK languages |
| **Cloud OCR (Azure/Google)** | Best accuracy, handles complex documents | API costs, data leaves system, requires internet | Enterprise alternative |

**Recommendation:** Use `tesseract.js` v6+ for local OCR. It provides good accuracy for printed English text with no external dependencies. For scanned PDFs, use `pdfjs-dist` to convert pages to images first. Consider Scribe.js if accuracy requirements are higher than tesseract.js can deliver.

**Note:** Tesseract.js does not directly support PDF input. The workflow requires:
1. Detect image-only PDF (no text layer)
2. Convert each PDF page to PNG using `pdfjs-dist`
3. Process each page image through tesseract.js
4. Aggregate results with page number metadata

#### Table Extraction Options

| Library | Pros | Cons | Recommendation |
|---------|------|------|----------------|
| **pdfreader** | Automatic column detection, rule-based parsing | PDF only, learning curve for rules | **Recommended** for PDF |
| **pdf-table-extractor** | Simple API, focused on tables | Less maintained, limited features | Alternative |
| **pdf.js-extract** | Preserves coordinates for layout analysis | Requires manual table detection logic | Low-level option |
| **mammoth** (DOCX) | Native table support in HTML output | Already recommended for DOCX | **Use existing** for DOCX |
| **Tabula (via tabula-js)** | Excellent accuracy, Java-based | Requires JRE, heavier deployment | Consider for high accuracy needs |

**Recommendation:** For PDF tables, use `pdfreader` with its rule-based parsing system to detect and extract tabular data. For DOCX tables, extend existing `mammoth` integration to parse table elements from HTML output. If PDF table accuracy is critical, evaluate `tabula-js` (Java dependency) for complex documents.

**Implementation Strategy:**
1. **DOCX Tables**: Parse `mammoth` HTML output for `<table>` elements, preserve structure
2. **PDF Tables**: Use `pdfreader` to identify tabular regions, apply heuristics for header detection
3. **Storage**: Store tables as JSON in PostgreSQL with source reference, index table text in ChromaDB

#### Image Content Analysis Options

| Library | Pros | Cons | Recommendation |
|---------|------|------|----------------|
| **@xenova/transformers** | Local inference, BLIP/ViT models, no API costs | Large models (500MB-1GB), slower than cloud | **Recommended** for local |
| **OpenAI Vision API** | Excellent accuracy, fast, GPT-4V quality | API costs (~$0.01-0.03/image), data sent to cloud | **Recommended** for cloud |
| **Azure AI Vision** | Enterprise features, image captioning, dense captions | API costs, requires Azure subscription | Enterprise alternative |
| **Google Gemini API** | Multimodal, good accuracy | API costs, newer service | Alternative |
| **Custom CLIP embeddings** | Direct image-to-embedding, no caption needed | Less semantic searchability | Specialized use cases |

**Recommendation:** Support both local and cloud options with configuration:
- **Default (Local)**: Use `@xenova/transformers` with BLIP-base model for privacy-first deployments
- **Cloud Option**: Use OpenAI Vision API when accuracy is paramount and API costs are acceptable

**Local Model Considerations:**
- `Xenova/vit-gpt2-image-captioning` - Smaller, faster, lower accuracy
- `Xenova/blip-image-captioning-base` - Good balance of size and accuracy (**Recommended**)
- `Xenova/blip-image-captioning-large` - Best accuracy, larger memory footprint

### 5.2 Performance Requirements

| Metric | Target | Rationale |
|--------|--------|-----------|
| PDF extraction (10 pages) | < 2 seconds | Typical lecture notes size |
| PDF extraction (100 pages) | < 10 seconds | Textbook chapter |
| DOCX extraction | < 1 second | Documents are typically smaller |
| Markdown parsing | < 100ms | Text-only, fast |
| Image metadata extraction | < 200ms | No content processing |
| File watcher latency | < 500ms event detection | Near-real-time updates |
| Debounce period | Configurable, default 2s | Avoid rapid re-indexing |
| Incremental index update | < 30 seconds for 100 files | Batch processing efficiency |
| **OCR per page** | < 15 seconds | Scanned document processing |
| **OCR full document (10 pages)** | < 3 minutes | Background queue processing acceptable |
| **Table extraction per document** | < 5 seconds | Layout analysis overhead |
| **Image analysis (local)** | < 10 seconds per image | Model inference time |
| **Image analysis (cloud)** | < 3 seconds per image | Network round-trip included |

### 5.3 Resource Requirements

| Resource | Limit | Notes |
|----------|-------|-------|
| Memory per document | < 100MB peak | PDF extraction can be memory-intensive |
| Concurrent document processing | 4 parallel | Prevent memory exhaustion |
| File watcher handles | < 10,000 files per folder | OS limits vary by platform |
| Maximum document size | 50MB | Prevent processing extremely large files |
| ChromaDB chunk storage | ~2KB per chunk average | Embeddings + metadata |
| **OCR processing memory** | < 500MB peak | tesseract.js model + image buffers |
| **OCR concurrent pages** | 1 (sequential) | Memory and CPU constraints |
| **Image analysis model memory** | ~1-2GB | BLIP model loaded in memory |
| **Image analysis concurrent** | 2 parallel | GPU/CPU resource management |
| **Table extraction memory** | < 200MB peak | Layout analysis buffers |

### 5.4 Data Storage Requirements

#### Storage Architecture Overview

**Critical Design Decision: What Each Storage Layer Holds**

The Personal Knowledge MCP uses a polyglot storage architecture where each storage layer serves a specific purpose. Source documents remain on the local filesystem and are NOT duplicated in any database.

| Storage Layer | What It Stores | Why |
|--------------|----------------|-----|
| **Local Filesystem** | Original source documents (PDF, DOCX, MD, images) | Source of truth; always available to working agents; no duplication needed |
| **ChromaDB (Vector Store)** | Text chunks with embeddings for semantic search | Fast similarity search; supports semantic queries |
| **PostgreSQL (Metadata Store)** | Document metadata, structure, processing state, file references | Structured queries; relational data; processing coordination |

**Why NOT Store Full Documents in PostgreSQL:**
- Source documents are always available on the local filesystem
- Duplicating files wastes storage (especially for large PDFs and images)
- The local filesystem is the source of truth for content
- Agents can read files directly when needed
- Our system only needs to track what has been indexed and how to find it

**What PostgreSQL Actually Stores:**
1. **File References**: Paths to source files on disk (not the files themselves)
2. **Document Metadata**: Title, author, page count, creation date extracted during processing
3. **Structural Information**: Table of contents, heading hierarchy, table schemas extracted during analysis
4. **Processing State**: Indexing status, errors, last processed timestamp, content hash for change detection
5. **Chunk References**: Links between documents and their ChromaDB vector entries
6. **Configuration**: Watched folder settings, ignore patterns, processing options

#### ChromaDB (Vector Store)

Document chunks stored with embeddings for semantic search:

```typescript
interface DocumentChunk {
  id: string;                    // {source}:{filePath}:{chunkIndex}
  repository: string;            // "local-folder" or folder identifier
  filePath: string;              // Relative path within watched folder
  content: string;               // Extracted text content (chunk only, not full document)
  chunkIndex: number;
  totalChunks: number;
  startOffset: number;           // Character offset in document
  endOffset: number;
  metadata: {
    documentType: "pdf" | "docx" | "markdown" | "txt";
    extension: string;
    language: string;            // For markdown code blocks
    pageNumber?: number;         // For PDFs
    sectionHeading?: string;     // Nearest heading
    documentTitle?: string;
    documentAuthor?: string;
    fileSizeBytes: number;
    contentHash: string;
    fileModifiedAt: Date;
  };
}
```

#### PostgreSQL (Metadata Store)

Document metadata, structure, and processing state (NOT full document content):

```sql
-- Document metadata table
-- NOTE: This table stores METADATA and REFERENCES, not actual document content.
-- Source documents remain on the local filesystem as the source of truth.
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(255) NOT NULL,        -- Watched folder identifier
  file_path VARCHAR(1024) NOT NULL,       -- Path to source file on disk (relative to source root)
  absolute_path VARCHAR(2048),            -- Full path for direct file access
  document_type VARCHAR(50) NOT NULL,     -- pdf, docx, markdown, image

  -- Extracted metadata (parsed from document during processing)
  title VARCHAR(512),                     -- Document title from metadata
  author VARCHAR(255),                    -- Document author from metadata
  created_at TIMESTAMP,                   -- Document creation date from metadata
  page_count INTEGER,                     -- Number of pages (for multi-page docs)
  word_count INTEGER,                     -- Approximate word count

  -- Structural information (extracted during analysis)
  toc_structure JSONB,                    -- Table of contents / heading hierarchy
  section_count INTEGER,                  -- Number of sections/headings

  -- Image-specific metadata
  image_width INTEGER,
  image_height INTEGER,
  image_format VARCHAR(50),
  exif_data JSONB,                        -- EXIF metadata extracted from image
  content_description TEXT,               -- AI-generated description (for image content analysis)

  -- File reference metadata (for change detection)
  file_size_bytes BIGINT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,      -- Hash of file content for change detection
  file_modified_at TIMESTAMP NOT NULL,    -- Last modified time on disk

  -- Processing state (coordination metadata)
  indexed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processing_status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, processing, indexed, error
  processing_error TEXT,                  -- Error message if processing failed
  chunk_count INTEGER DEFAULT 0,          -- Number of chunks in ChromaDB
  ocr_processed BOOLEAN DEFAULT FALSE,    -- Whether OCR was applied
  ocr_confidence NUMERIC(5,2),            -- Average OCR confidence score

  -- Constraints
  UNIQUE(source_id, file_path),
  INDEX idx_documents_source (source_id),
  INDEX idx_documents_type (document_type),
  INDEX idx_documents_hash (content_hash),
  INDEX idx_documents_status (processing_status)
);

-- Watched folders configuration
CREATE TABLE watched_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path VARCHAR(1024) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  include_patterns TEXT[],                -- Glob patterns to include
  exclude_patterns TEXT[],                -- Glob patterns to exclude
  debounce_ms INTEGER NOT NULL DEFAULT 2000,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_scan_at TIMESTAMP,
  file_count INTEGER DEFAULT 0
);

-- Extracted tables from documents (for table extraction feature)
-- Stores structural information about tables, not duplicating source document content
CREATE TABLE extracted_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER,                    -- Page where table appears (for PDFs)
  table_index INTEGER NOT NULL,           -- Order within document

  -- Table structure (extracted during processing)
  headers JSONB,                          -- Column headers as JSON array
  row_count INTEGER NOT NULL,
  column_count INTEGER NOT NULL,
  has_header_row BOOLEAN DEFAULT TRUE,
  has_merged_cells BOOLEAN DEFAULT FALSE,
  spans_multiple_pages BOOLEAN DEFAULT FALSE,

  -- Flattened text for search (indexed in ChromaDB, stored here for reference)
  raw_text TEXT,                          -- Flattened table text
  extraction_confidence NUMERIC(3,2),     -- 0.00-1.00 confidence score

  -- Chunk reference
  chromadb_chunk_id VARCHAR(255),         -- Reference to ChromaDB vector entry

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_tables_document (document_id),
  INDEX idx_tables_confidence (extraction_confidence)
);

-- Chunk references (links documents to their ChromaDB entries)
-- Enables efficient cleanup when documents are deleted or re-indexed
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chromadb_id VARCHAR(255) NOT NULL,      -- Reference to ChromaDB vector entry
  chunk_index INTEGER NOT NULL,
  start_offset INTEGER,                   -- Character offset in source document
  end_offset INTEGER,
  page_number INTEGER,                    -- For PDFs
  section_heading VARCHAR(512),           -- Nearest heading for context

  UNIQUE(document_id, chunk_index),
  INDEX idx_chunks_document (document_id),
  INDEX idx_chunks_chromadb (chromadb_id)
);
```

---

## 6. Architecture and Design Considerations

### 6.1 System Architecture

**Storage Layer Responsibilities:**

| Layer | Purpose | Data Stored |
|-------|---------|-------------|
| **Local Filesystem** | Source of truth | Original documents (PDF, DOCX, MD, images) |
| **ChromaDB** | Semantic search | Text chunks + embeddings |
| **PostgreSQL** | Coordination & queries | Metadata, structure, processing state, references |

```mermaid
flowchart TB
    subgraph "Input Sources"
        FS[("Local Filesystem<br/>(Source Documents)")]
        WF[Watched Folders]
        CLI[CLI Index Command]
    end

    subgraph "Document Processing Pipeline"
        FW[File Watcher<br/>chokidar]
        DET[Document Detector<br/>Extension + MIME]

        subgraph "Extractors"
            PDF[PDF Extractor<br/>pdf-parse]
            DOCX[DOCX Extractor<br/>mammoth]
            MD[Markdown Parser<br/>marked/remark]
            IMG[Image Metadata<br/>sharp + exif-parser]
        end

        subgraph "Advanced Processing"
            OCR[OCR Service<br/>tesseract.js]
            TBL[Table Extractor<br/>pdfreader]
            ICA[Image Analysis<br/>Transformers.js/OpenAI]
        end

        CHK[Document Chunker<br/>Extends FileChunker]
        EMB[Embedding Generator<br/>OpenAI/Local]
    end

    subgraph "Storage (Derived Data Only)"
        CDB[(ChromaDB<br/>Chunks + Embeddings)]
        PG[(PostgreSQL<br/>Metadata + References)]
    end

    subgraph "MCP Interface"
        SS[semantic_search]
        SD[search_documents]
        SI[search_images]
    end

    FS -.->|"Source files remain here"| WF
    FS -.->|"Source files remain here"| CLI
    WF --> FW
    CLI --> DET
    FW --> DET

    DET --> PDF
    DET --> DOCX
    DET --> MD
    DET --> IMG

    PDF --> OCR
    PDF --> TBL
    DOCX --> TBL
    IMG --> ICA

    PDF --> CHK
    DOCX --> CHK
    MD --> CHK
    OCR --> CHK
    TBL --> CHK
    ICA --> CHK

    CHK --> EMB
    EMB -->|"Text chunks + embeddings"| CDB

    DET -->|"File references"| PG
    PDF -->|"Metadata"| PG
    DOCX -->|"Metadata"| PG
    IMG -->|"Metadata + EXIF"| PG
    TBL -->|"Table structure"| PG
    ICA -->|"Content descriptions"| PG
    CHK -->|"Chunk references"| PG

    CDB --> SS
    CDB --> SD
    PG --> SD
    PG --> SI
```

**Key Data Flow Principles:**
1. **Source documents stay on disk** - never copied to databases
2. **ChromaDB receives chunks** - extracted text with embeddings for semantic search
3. **PostgreSQL receives references** - file paths, metadata, structure, processing state
4. **MCP tools query both** - ChromaDB for content similarity, PostgreSQL for filtering/metadata

### 6.2 Integration with Existing Components

#### Extending FileChunker

The existing `FileChunker` class handles code file chunking. For documents, we extend this with document-aware chunking:

```typescript
/**
 * Document-aware chunking that respects document structure.
 *
 * Key differences from code chunking:
 * - Respects page boundaries in PDFs
 * - Prefers breaking at paragraph boundaries
 * - Tracks section headings for context
 * - Handles longer natural language content appropriately
 */
interface DocumentChunkerConfig extends ChunkerConfig {
  /**
   * Prefer breaking at paragraph boundaries.
   * @default true
   */
  respectParagraphs?: boolean;

  /**
   * Include section heading in each chunk for context.
   * @default true
   */
  includeSectionContext?: boolean;

  /**
   * For PDFs: try to keep page content together when possible.
   * @default true
   */
  respectPageBoundaries?: boolean;
}
```

#### Extending FileScanner

The existing `FileScanner` supports code file extensions. Document support requires:

1. Adding document extensions to DEFAULT_EXTENSIONS:
   - `.pdf`, `.docx`, `.doc` (flagged as unsupported), `.md`, `.txt`, `.rtf`
   - Image extensions: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.tiff`

2. Extending `FileInfo` with document-specific metadata:
   ```typescript
   interface ExtendedFileInfo extends FileInfo {
     documentType?: "code" | "document" | "image";
     mimeType?: string;
   }
   ```

### 6.3 Folder Watcher Architecture

```mermaid
sequenceDiagram
    participant FS as File System
    participant CK as Chokidar Watcher
    participant DB as Debouncer
    participant Q as Processing Queue
    participant DP as Document Processor
    participant ST as Storage

    FS->>CK: File change event
    CK->>DB: Debounce event
    DB->>DB: Wait 2 seconds

    alt More changes within debounce
        FS->>CK: Another change
        CK->>DB: Reset debounce timer
    end

    DB->>Q: Enqueue file for processing
    Q->>DP: Process next file
    DP->>DP: Extract content
    DP->>DP: Generate chunks
    DP->>DP: Generate embeddings
    DP->>ST: Store in ChromaDB + PostgreSQL
    ST-->>Q: Confirm complete
    Q->>Q: Process next file
```

### 6.4 Error Handling Strategy

| Error Type | Handling | User Notification |
|------------|----------|-------------------|
| Corrupt PDF | Skip file, log error, store in PostgreSQL with error status | Visible in `pk-mcp status --documents` |
| Password-protected PDF | Skip unless password provided via config | Log warning |
| Unsupported format | Skip file, log debug | None unless verbose mode |
| File too large | Skip file, log warning | Visible in scan summary |
| Watcher disconnected | Attempt reconnect with backoff | Log error, continue monitoring other folders |
| Embedding API failure | Retry with exponential backoff | Log error, queue for retry |
| Storage write failure | Retry, then fail with error | Log error |

---

## 7. MCP Tool Design

### 7.1 New MCP Tools

#### Tool 1: search_documents

**Purpose:** Search across indexed documents (PDFs, DOCX, Markdown) with semantic similarity.

```json
{
  "name": "search_documents",
  "description": "Search indexed documents (PDFs, Word docs, Markdown) using semantic similarity. Returns relevant passages with document context. Use this to find information in educational materials, documentation, or notes.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural language search query describing the information you're looking for"
      },
      "document_types": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["pdf", "docx", "markdown", "txt", "all"]
        },
        "description": "Filter by document type. Defaults to all types.",
        "default": ["all"]
      },
      "folder": {
        "type": "string",
        "description": "Limit search to a specific watched folder by name or path"
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of results to return",
        "default": 10,
        "minimum": 1,
        "maximum": 50
      },
      "threshold": {
        "type": "number",
        "description": "Minimum similarity score (0.0-1.0). Higher values return more relevant results.",
        "default": 0.7,
        "minimum": 0,
        "maximum": 1
      }
    },
    "required": ["query"]
  }
}
```

**Response Schema:**
```typescript
interface SearchDocumentsResponse {
  results: Array<{
    content: string;              // Matched text passage
    documentPath: string;         // Relative path to document
    documentTitle?: string;       // Extracted title if available
    documentType: string;         // pdf, docx, markdown
    pageNumber?: number;          // For PDFs
    sectionHeading?: string;      // Nearest heading
    similarity: number;           // 0.0-1.0 similarity score
    folder: string;               // Source folder name
  }>;
  metadata: {
    totalResults: number;
    queryTimeMs: number;
    searchedFolders: string[];
    searchedDocumentTypes: string[];
  };
}
```

#### Tool 2: search_images

**Purpose:** Search for images by metadata (date, dimensions, format, EXIF data).

```json
{
  "name": "search_images",
  "description": "Search indexed images by metadata including date, dimensions, format, and EXIF data. Use this to find screenshots, photos, diagrams, or other visual assets.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "folder": {
        "type": "string",
        "description": "Limit search to a specific watched folder"
      },
      "format": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["jpeg", "png", "gif", "webp", "tiff", "all"]
        },
        "description": "Filter by image format",
        "default": ["all"]
      },
      "date_from": {
        "type": "string",
        "format": "date",
        "description": "Filter images taken/modified on or after this date (YYYY-MM-DD)"
      },
      "date_to": {
        "type": "string",
        "format": "date",
        "description": "Filter images taken/modified on or before this date (YYYY-MM-DD)"
      },
      "min_width": {
        "type": "integer",
        "description": "Minimum image width in pixels"
      },
      "min_height": {
        "type": "integer",
        "description": "Minimum image height in pixels"
      },
      "filename_pattern": {
        "type": "string",
        "description": "Glob pattern to match filenames (e.g., 'screenshot*', '*.diagram.*')"
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of results",
        "default": 20,
        "minimum": 1,
        "maximum": 100
      }
    }
  }
}
```

**Response Schema:**
```typescript
interface SearchImagesResponse {
  results: Array<{
    path: string;                 // Relative path to image
    filename: string;             // Just the filename
    format: string;               // jpeg, png, etc.
    width: number;
    height: number;
    sizeBytes: number;
    dateTaken?: Date;             // From EXIF if available
    dateModified: Date;           // File modification date
    exif?: {
      camera?: string;
      orientation?: number;
      gpsLatitude?: number;       // If present and not stripped
      gpsLongitude?: number;
    };
    folder: string;               // Source folder name
  }>;
  metadata: {
    totalResults: number;
    queryTimeMs: number;
  };
}
```

#### Tool 3: list_watched_folders

**Purpose:** List configured watched folders and their status.

```json
{
  "name": "list_watched_folders",
  "description": "List all configured watched folders and their indexing status. Use this to understand what document sources are available for search.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**Response Schema:**
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

### 7.2 Updated Existing Tools

#### Enhanced semantic_search

The existing `semantic_search` tool should be enhanced to optionally include document results:

```typescript
// Add to existing semantic_search input schema
{
  "include_documents": {
    "type": "boolean",
    "description": "Include results from indexed documents (PDFs, DOCX, Markdown) in addition to code",
    "default": false
  }
}
```

---

## 8. CLI Commands

### 8.1 Document Indexing Commands

```bash
# Index a folder of documents (one-time, no watching)
pk-mcp documents index <folder-path> [options]

Options:
  --name <name>           Friendly name for this document source
  --include <patterns>    Glob patterns to include (comma-separated)
  --exclude <patterns>    Glob patterns to exclude (comma-separated)
  --recursive             Include nested folders (default: true)
  --dry-run               Show what would be indexed without actually indexing

Examples:
  pk-mcp documents index ~/Documents/College --name "college-notes"
  pk-mcp documents index ./docs --include "*.md,*.pdf" --exclude "drafts/**"
```

### 8.2 Folder Watch Commands

```bash
# Add a watched folder
pk-mcp watch add <folder-path> [options]

Options:
  --name <name>           Friendly name for this folder
  --include <patterns>    File patterns to include (default: *.pdf,*.docx,*.md)
  --exclude <patterns>    File patterns to exclude
  --debounce <ms>         Debounce delay in milliseconds (default: 2000)
  --no-initial-scan       Skip initial indexing, only watch for changes

Examples:
  pk-mcp watch add ~/Documents/API-Docs --name "api-docs" --include "*.md"
  pk-mcp watch add ./notes --exclude "*.draft.md,private/**"

# List watched folders
pk-mcp watch list

Output:
  NAME          PATH                      STATUS   DOCUMENTS   IMAGES
  college-notes ~/Documents/College       active   347         52
  api-docs      ~/Documents/API-Docs      active   23          0
  diagrams      ~/work/diagrams           paused   0           128

# Remove a watched folder
pk-mcp watch remove <name-or-path>

# Pause/resume watching
pk-mcp watch pause <name-or-path>
pk-mcp watch resume <name-or-path>

# Force re-scan a watched folder
pk-mcp watch rescan <name-or-path> [--full]
```

### 8.3 Document Status Commands

```bash
# Show document indexing status
pk-mcp documents status [options]

Options:
  --folder <name>         Filter by folder name
  --type <type>           Filter by document type (pdf, docx, markdown, image)
  --errors                Show only documents with processing errors

Output:
  DOCUMENT INDEXING STATUS

  Total Documents: 370
  By Type:
    PDF:      156  (42%)
    DOCX:      34  (9%)
    Markdown: 180  (49%)

  Total Images: 180
  By Format:
    JPEG:     120  (67%)
    PNG:       58  (32%)
    GIF:        2  (1%)

  Processing Errors: 3
    ~/Documents/corrupt.pdf - Invalid PDF structure
    ~/Documents/protected.pdf - Password protected
    ~/Documents/huge.pdf - Exceeds 50MB size limit

# Show processing errors in detail
pk-mcp documents errors

# Retry failed documents
pk-mcp documents retry [--all | --file <path>]
```

### 8.4 Configuration Commands

```bash
# Set global document processing options
pk-mcp config set documents.maxSizeMb 50
pk-mcp config set documents.defaultDebounceMs 2000
pk-mcp config set documents.includePatterns "*.pdf,*.docx,*.md"

# Set default exclusion patterns
pk-mcp config set documents.globalExclusions "*.draft.*,~*,._*,.DS_Store"
```

---

## 9. Dependencies and Libraries

### 9.1 Core Dependencies

| Package | Version | Purpose | License |
|---------|---------|---------|---------|
| `pdf-parse` | ^1.1.1 | PDF text extraction | MIT |
| `mammoth` | ^1.6.0 | DOCX to text/HTML conversion | BSD-2-Clause |
| `marked` | ^12.0.0 | Markdown parsing | MIT |
| `sharp` | ^0.33.0 | Image processing and metadata | Apache-2.0 |
| `exif-parser` | ^0.1.12 | EXIF metadata extraction | MIT |
| `chokidar` | ^3.6.0 | File system watching | MIT |
| `ignore` | ^5.3.0 | .gitignore-style pattern matching | MIT |

### 9.2 Advanced Content Processing Dependencies

| Package | Version | Purpose | License | Priority |
|---------|---------|---------|---------|----------|
| `tesseract.js` | ^6.0.0 | OCR text extraction from images/scanned PDFs | Apache-2.0 | P1 |
| `pdfjs-dist` | ^4.0.0 | PDF page-to-image conversion for OCR, advanced PDF parsing | Apache-2.0 | P1 |
| `pdfreader` | ^3.0.0 | PDF table detection and extraction | MIT | P2 |
| `@xenova/transformers` | ^2.17.0 | Local image captioning (BLIP model) | Apache-2.0 | P2 |
| `openai` | ^4.0.0 | Cloud image analysis via OpenAI Vision API | MIT | P2 (optional) |

### 9.3 Optional/Enhancement Dependencies

| Package | Version | Purpose | License | Notes |
|---------|---------|---------|---------|-------|
| `gray-matter` | ^4.0.3 | Markdown frontmatter parsing | MIT | Optional enhancement |
| `exifr` | ^7.1.3 | Alternative EXIF extraction (more formats) | MIT | Alternative to exif-parser |
| `tabula-js` | ^1.0.0 | High-accuracy PDF table extraction | MIT | Requires JRE, optional |
| `@azure/ai-vision-image-analysis` | ^1.0.0 | Azure AI Vision for image analysis | MIT | Enterprise alternative |

### 9.4 Dependency Risk Assessment

| Dependency | Maintenance Status | Risk | Mitigation |
|------------|-------------------|------|------------|
| pdf-parse | Moderate (based on pdf.js) | Low | pdfjs-dist as fallback |
| mammoth | Active, stable | Low | Well-maintained |
| marked | Very active | Low | Industry standard |
| sharp | Very active | Low | Most popular image library |
| chokidar | Active, stable | Low | Industry standard |
| exif-parser | Stable but less active | Medium | exifr as alternative |
| **tesseract.js** | Active, v6 released 2025 | Low | Scribe.js as alternative |
| **pdfjs-dist** | Very active (Mozilla) | Low | Industry standard |
| **pdfreader** | Moderate | Medium | Custom implementation fallback |
| **@xenova/transformers** | Active, growing adoption | Low | Cloud API fallback |

### 9.5 Bundle Size Considerations

| Package | Size Impact | Notes |
|---------|-------------|-------|
| sharp | ~30MB | Native bindings, platform-specific |
| pdf-parse | ~5MB | Includes pdf.js worker |
| mammoth | ~1MB | Pure JavaScript |
| marked | ~300KB | Lightweight |
| chokidar | ~500KB | Includes fsevents on macOS |
| **tesseract.js** | ~50MB+ | OCR models downloaded on first use |
| **pdfjs-dist** | ~10MB | PDF rendering and parsing |
| **pdfreader** | ~2MB | Based on pdf2json |
| **@xenova/transformers** | ~5MB (core) | Models downloaded separately (~500MB-1GB) |

**Total estimated addition:**
- Base Phase 6: ~37MB
- With OCR (tesseract.js + pdfjs-dist): ~97MB + models
- With Image Analysis (local): Additional ~5MB + models (~500MB-1GB)
- With Image Analysis (cloud): Additional ~1MB (openai SDK only)

**Model Download Considerations:**
- tesseract.js English model: ~15MB (downloaded on first OCR operation)
- tesseract.js additional languages: ~5-20MB each
- BLIP image captioning model: ~500MB-1GB (downloaded on first analysis)
- Models are cached locally after initial download

---

## 10. Success Metrics

### 10.1 Functional Success Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| PDF extraction accuracy | Manual sampling of 50 documents | >95% text correctly extracted |
| DOCX extraction accuracy | Manual sampling of 20 documents | >95% text correctly extracted |
| Markdown parsing accuracy | Automated tests against known content | 100% structure preserved |
| Image metadata extraction | Automated tests against test images | 100% dimensions, >90% EXIF |
| File watcher reliability | 24-hour stability test | Zero missed events |
| Incremental update correctness | Add/modify/delete 100 files | 100% correct index state |
| **OCR extraction accuracy** | Manual sampling of 20 scanned documents | >90% text correctly extracted (clean scans) |
| **OCR language support** | Automated tests with English documents | 100% successful processing |
| **Table extraction accuracy** | Manual sampling of 30 documents with tables | >85% table structure preserved |
| **Table header detection** | Automated tests against known tables | >90% headers correctly identified |
| **Image content analysis accuracy** | Manual review of 50 image descriptions | >80% descriptions semantically accurate |
| **Image type classification** | Automated tests with labeled images | >90% correct classification (diagram/photo/screenshot) |

### 10.2 Performance Success Criteria

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| PDF extraction (10 pages) | < 2 seconds | Automated benchmark |
| PDF extraction (100 pages) | < 10 seconds | Automated benchmark |
| DOCX extraction | < 1 second | Automated benchmark |
| Document search latency (p95) | < 500ms | MCP query timing |
| Image metadata search (p95) | < 200ms | MCP query timing |
| File watcher event latency | < 1 second | Event timestamp comparison |
| Bulk indexing (1000 docs) | < 30 minutes | End-to-end timing |
| **OCR per page** | < 15 seconds | Automated benchmark |
| **OCR document (10 pages)** | < 3 minutes | End-to-end timing |
| **Table extraction per document** | < 5 seconds | Automated benchmark |
| **Image analysis (local)** | < 10 seconds per image | Automated benchmark |
| **Image analysis (cloud)** | < 3 seconds per image | API timing |
| **Image content search latency (p95)** | < 500ms | MCP query timing |

### 10.3 Quality Success Criteria

| Criterion | Target |
|-----------|--------|
| Test coverage for document processing | >= 90% |
| No P0 bugs in document extraction | 0 for 2 weeks post-launch |
| Documentation completeness | All new tools and commands documented |
| CLI help text accuracy | All commands have accurate help |
| **Test coverage for OCR processing** | >= 85% |
| **Test coverage for table extraction** | >= 85% |
| **Test coverage for image analysis** | >= 85% |
| **OCR error handling coverage** | 100% of error scenarios have graceful handling |

### 10.4 User Value Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Document findability | User can locate specific content in indexed documents |
| Search relevance | Top-3 results contain relevant content >80% of queries |
| Folder sync reliability | Watched folders stay synchronized without manual intervention |
| Error transparency | Users can identify and resolve indexing failures |
| **Scanned document searchability** | User can find content in scanned PDFs via semantic search |
| **Table data accessibility** | User can search for and export table data from indexed documents |
| **Image content discoverability** | User can find images by describing their content |
| **Processing transparency** | User can see OCR/analysis progress and quality indicators |

---

## 11. Implementation Milestones

### 11.1 Phase Overview

| Milestone | Focus | Duration | Key Deliverables |
|-----------|-------|----------|------------------|
| **M1** | Core Extractors | 2 weeks | PDF, DOCX, Markdown extractors |
| **M2** | Document Chunking | 1 week | Document-aware chunking, integration with embedding pipeline |
| **M3** | MCP Tools | 1 week | search_documents, search_images tools |
| **M4** | Folder Watching | 2 weeks | chokidar integration, incremental updates |
| **M5** | CLI & Polish | 1 week | CLI commands, documentation, testing |
| **M6** | OCR Processing (P1) | 2 weeks | tesseract.js integration, scanned PDF support |
| **M7** | Table Extraction (P2) | 1.5 weeks | PDF/DOCX table extraction, structured output |
| **M8** | Image Content Analysis (P2) | 1.5 weeks | Local and cloud image analysis, semantic search |

**Total Phase 6 Duration:** 12 weeks (extended from 7 weeks to accommodate advanced content processing)

### 11.2 Milestone 1: Core Extractors (Weeks 1-2)

**Goal:** Implement document content extraction for all supported formats.

**Deliverables:**
1. PDF extractor with text and metadata extraction
2. DOCX extractor with structure preservation
3. Markdown parser with frontmatter support
4. Image metadata extractor

**Tasks:**
- [ ] Create `src/documents/` module structure
- [ ] Implement `PdfExtractor` class with pdf-parse
- [ ] Implement `DocxExtractor` class with mammoth
- [ ] Implement `MarkdownParser` class with marked
- [ ] Implement `ImageMetadataExtractor` class with sharp + exif-parser
- [ ] Create `DocumentTypeDetector` for format identification
- [ ] Add error handling for corrupt/unreadable files
- [ ] Write unit tests for all extractors (>90% coverage)

### 11.3 Milestone 2: Document Chunking (Week 3)

**Goal:** Adapt chunking pipeline for document content.

**Deliverables:**
1. Document-aware chunker extending FileChunker
2. Integration with existing embedding pipeline
3. PostgreSQL schema for document metadata

**Tasks:**
- [ ] Create `DocumentChunker` extending chunking logic
- [ ] Implement paragraph-boundary-aware chunking
- [ ] Add section heading context preservation
- [ ] Create PostgreSQL migration for documents table
- [ ] Integrate with existing `IngestionService`
- [ ] Add document-specific metadata to ChromaDB storage
- [ ] Write integration tests for chunking pipeline

### 11.4 Milestone 3: MCP Tools (Week 4)

**Goal:** Expose document search capabilities via MCP.

**Deliverables:**
1. `search_documents` MCP tool
2. `search_images` MCP tool
3. `list_watched_folders` MCP tool

**Tasks:**
- [ ] Implement `search_documents` tool handler
- [ ] Implement `search_images` tool handler
- [ ] Implement `list_watched_folders` tool handler
- [ ] Update `semantic_search` with `include_documents` option
- [ ] Register new tools in MCP tool registry
- [ ] Add comprehensive tool documentation
- [ ] Write integration tests for MCP tools

### 11.5 Milestone 4: Folder Watching (Weeks 5-6)

**Goal:** Implement real-time folder monitoring and incremental updates.

**Deliverables:**
1. Folder watcher service using chokidar
2. Incremental update processing
3. Ignore pattern support

**Tasks:**
- [ ] Implement `FolderWatcherService` with chokidar
- [ ] Add debouncing for rapid file changes
- [ ] Implement change detection (add/modify/delete)
- [ ] Create processing queue for batched updates
- [ ] Implement incremental index updates
- [ ] Add .pkignore file support
- [ ] Create PostgreSQL table for watch configurations
- [ ] Handle watcher lifecycle (start/stop/restart)
- [ ] Write integration tests for watcher scenarios

### 11.6 Milestone 5: CLI & Polish (Week 7)

**Goal:** Complete CLI commands and finalize documentation.

**Deliverables:**
1. All CLI commands implemented
2. User documentation
3. Performance optimization

**Tasks:**
- [ ] Implement `pk-mcp documents index` command
- [ ] Implement `pk-mcp watch add/list/remove` commands
- [ ] Implement `pk-mcp documents status` command
- [ ] Add progress reporting for bulk operations
- [ ] Performance testing and optimization
- [ ] Write user documentation for document features
- [ ] Update README with document ingestion guide
- [ ] Final polish and bug fixes
- [ ] (Optional/P2) Add embedding provider observability logging ([GitHub Issue #28](https://github.com/sethb75/PersonalKnowledgeMCP/issues/28)):
  - [ ] Add error logging with context to embedding provider
  - [ ] Add latency warning logs for operations >5s
  - [ ] Surface embedding status in CLI status commands

### 11.7 Milestone 6: OCR Processing (Weeks 8-9)

**Goal:** Enable text extraction from scanned documents and image-only PDFs.

**Deliverables:**
1. OCR service using tesseract.js
2. Image-only PDF detection
3. PDF page-to-image conversion pipeline
4. OCR configuration and language support

**Tasks:**
- [ ] Implement `OcrService` class with tesseract.js v6
- [ ] Create PDF page-to-image converter using pdfjs-dist
- [ ] Implement image-only PDF detection (no text layer check)
- [ ] Add OCR confidence score tracking per page
- [ ] Implement configurable OCR languages (default: English)
- [ ] Create background processing queue for OCR operations
- [ ] Add progress reporting for long-running OCR jobs
- [ ] Implement OCR timeout handling (per-page limits)
- [ ] Add CLI commands for OCR status and manual triggers
- [ ] Update MCP tools to include OCR-extracted content in search
- [ ] Write unit tests for OCR service (>85% coverage)
- [ ] Write integration tests for full OCR pipeline

**Configuration Options:**
```typescript
interface OcrConfig {
  enabled: boolean;                    // Enable/disable OCR processing
  languages: string[];                 // ['eng'] by default
  confidenceThreshold: number;         // Minimum confidence (0-100), default 60
  pageTimeoutMs: number;               // Per-page timeout, default 30000
  maxPagesPerDocument: number;         // Limit for very long documents, default 100
  processingPriority: 'normal' | 'low'; // Background queue priority
}
```

### 11.8 Milestone 7: Table Extraction (Weeks 10-11, partial)

**Goal:** Extract structured table data from PDF and DOCX documents.

**Deliverables:**
1. PDF table detection and extraction
2. DOCX table extraction via mammoth HTML parsing
3. Structured table storage format
4. Table export capabilities

**Tasks:**
- [ ] Implement `TableExtractor` interface for common table operations
- [ ] Implement `PdfTableExtractor` using pdfreader
- [ ] Implement `DocxTableExtractor` parsing mammoth HTML output
- [ ] Create table structure model (rows, columns, headers, merged cells)
- [ ] Implement table header detection heuristics
- [ ] Add multi-page table handling for PDFs
- [ ] Store extracted tables in PostgreSQL as JSON
- [ ] Index table text content in ChromaDB with table context metadata
- [ ] Implement `pk-mcp tables list` CLI command
- [ ] Implement `pk-mcp tables export` CLI command (CSV/JSON formats)
- [ ] Add table filtering option to `search_documents` MCP tool
- [ ] Write unit tests for table extraction (>85% coverage)

**Table Data Model:**
```typescript
interface ExtractedTable {
  id: string;
  documentId: string;
  documentPath: string;
  pageNumber?: number;           // For PDFs
  tableIndex: number;            // Table order within document
  headers: string[];             // Detected header row
  rows: string[][];              // Data rows
  columnCount: number;
  rowCount: number;
  hasHeaderRow: boolean;
  rawText: string;               // Flattened text for search
  extractionConfidence: number;  // 0-1 confidence score
  metadata: {
    hasMergedCells: boolean;
    spansMultiplePages: boolean;
  };
}
```

### 11.9 Milestone 8: Image Content Analysis (Weeks 11-12, partial)

**Goal:** Generate and index AI-based descriptions of image content for semantic search.

**Deliverables:**
1. Local image analysis using Transformers.js
2. Cloud image analysis via OpenAI Vision API
3. Image content descriptions stored and searchable
4. Image type classification

**Tasks:**
- [ ] Implement `ImageAnalysisService` with provider abstraction
- [ ] Implement `LocalImageAnalyzer` using @xenova/transformers (BLIP model)
- [ ] Implement `OpenAIImageAnalyzer` using OpenAI Vision API
- [ ] Create configuration for analysis provider selection
- [ ] Implement lazy model loading for local analysis
- [ ] Add image type classification (diagram, screenshot, photo, chart)
- [ ] Store content descriptions in PostgreSQL
- [ ] Generate embeddings from descriptions for ChromaDB
- [ ] Add `content_query` parameter to `search_images` MCP tool
- [ ] Implement `pk-mcp images analyze` CLI command
- [ ] Implement `pk-mcp images reanalyze` CLI command for model updates
- [ ] Add analysis progress reporting for batch operations
- [ ] Write unit tests for image analysis (>85% coverage)
- [ ] Write integration tests for both local and cloud providers

**Configuration Options:**
```typescript
interface ImageAnalysisConfig {
  enabled: boolean;                    // Enable/disable image analysis
  provider: 'local' | 'openai' | 'azure';  // Analysis provider
  localModel: string;                  // 'blip-base' | 'blip-large' | 'vit-gpt2'
  detailLevel: 'brief' | 'detailed';   // Description verbosity
  classifyImageType: boolean;          // Enable type classification
  batchSize: number;                   // Images per batch, default 10
  openai?: {
    model: string;                     // 'gpt-4-vision-preview'
    maxTokens: number;                 // Response length limit
  };
}
```

**Privacy Considerations:**
- Local processing (Transformers.js) keeps all data on-device
- Cloud processing (OpenAI/Azure) sends image data to external servers
- Configuration should clearly indicate data privacy implications
- Consider offering thumbnail-only mode for cloud analysis to reduce data exposure

---

## 12. Risks and Mitigations

### 12.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **PDF extraction quality varies** | High | Medium | Test against diverse PDFs early; document limitations; provide manual re-index option |
| **Large PDF memory consumption** | Medium | Medium | Implement streaming extraction; enforce size limits; test with 100+ page documents |
| **File watcher platform differences** | Medium | Low | Use chokidar (handles cross-platform); test on Windows, macOS, Linux |
| **Image metadata extraction inconsistency** | Low | Medium | Handle missing EXIF gracefully; document which metadata is reliable |
| **DOCX format variations** | Low | Medium | mammoth handles most cases; document unsupported features |
| **Sharp native binding issues** | Medium | Low | Test in CI across platforms; have fallback to image-size + exifr |
| **OCR accuracy on low-quality scans** | High | Medium | Implement confidence thresholds; provide quality warnings; suggest rescanning |
| **OCR processing time for large documents** | Medium | High | Background queue processing; per-page timeouts; progress reporting |
| **tesseract.js model download failures** | Medium | Low | Cache models locally; provide offline model installation option |
| **Table extraction fails on complex layouts** | Medium | High | Document limitations clearly; provide fallback to text-only extraction |
| **PDF table detection false positives** | Low | Medium | Implement confidence scoring; allow manual table exclusion |
| **Transformers.js model memory issues** | High | Medium | Lazy loading; model unloading after batch; memory monitoring |
| **BLIP model accuracy varies by image type** | Medium | Medium | Train on diverse test set; document accuracy expectations; offer cloud fallback |
| **OpenAI API rate limits** | Medium | Low | Implement rate limiting; batch processing; exponential backoff |

### 12.2 Product Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **OCR quality expectations too high** | Medium | Medium | Clear documentation of OCR limitations; show confidence scores to users |
| **Watched folder fills with irrelevant files** | Low | Medium | Good default exclusion patterns; easy pattern configuration |
| **Index grows too large** | Medium | Low | Document size limits; provide index management tools |
| **Table extraction results confusing** | Medium | Medium | Clear table preview in CLI; structured export formats; source references |
| **Image descriptions not useful for search** | Medium | Medium | Test with real user queries; iterate on prompts; offer re-analysis option |
| **Privacy concerns with cloud image analysis** | High | Medium | Default to local processing; clear privacy documentation; thumbnail-only option |

### 12.3 Operational Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Watcher consumes too many file handles** | Medium | Low | Implement handle pooling; test with large folder trees |
| **Disk space consumption** | Low | Medium | Store extracted text, not full documents; compression in PostgreSQL |
| **Embedding API costs for documents** | Low | Medium | Track embedding token usage; support local embeddings |
| **OCR increases indexing time significantly** | Medium | High | Background processing; skip OCR option; prioritize text PDFs |
| **Image analysis model storage (~1GB)** | Low | Medium | Download on demand; clear cache management; document requirements |
| **Cloud API costs for image analysis** | Medium | Medium | Local processing default; cost tracking; batch size limits |
| **CPU load during OCR/analysis operations** | Medium | Medium | Concurrent processing limits; priority queuing; CPU monitoring |

---

## 13. Future Considerations

### 13.1 Near-Term Enhancements (Post-Phase 6)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Presentation files** | PowerPoint (.pptx) support | P2 |
| **Rich text format** | RTF document support | P3 |
| **ePub support** | E-book format for reference materials | P3 |
| **Multi-language OCR optimization** | Enhanced support for non-Latin scripts (CJK, Arabic, etc.) | P3 |
| **Video thumbnail extraction** | Extract keyframes from video files for indexing | P3 |

*Note: OCR for scanned documents, table extraction, and image content analysis are now included in Phase 6 scope.*

### 13.2 Medium-Term Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| **Cloud storage sync** | OneDrive, Google Drive, Dropbox integration | P2 |
| **Document versioning** | Track document changes over time | P2 |
| **Document relationships** | Link related documents via knowledge graph | P2 |
| **Citation extraction** | Extract bibliographic references from academic papers | P3 |
| **Handwriting recognition** | Recognition of handwritten text in scanned documents (beyond printed OCR) | P3 |

### 13.3 Long-Term Vision

| Feature | Description |
|---------|-------------|
| **Collaborative document annotation** | Share notes and highlights across team |
| **Document summarization** | AI-generated summaries for long documents |
| **Cross-document knowledge graph** | Connect concepts across all indexed content |
| **Document recommendation** | Suggest related documents based on current context |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-18 | Product Team | Initial Phase 6 Document Ingestion PRD |
| 1.1 | 2026-01-18 | Product Team | Added embedding provider observability (GitHub Issue #28) as optional P2 scope in M5 |
| 1.2 | 2026-01-18 | Product Team | Moved OCR, table extraction, and image content analysis from Non-Goals to in-scope; added user stories US-9, US-10, US-11; added functional requirements FR-9, FR-10, FR-11; added milestones M6, M7, M8; updated dependencies |
| 1.3 | 2026-01-18 | Product Team | **CRITICAL**: Clarified PostgreSQL storage purpose - stores metadata/references/structure, NOT full document content. Added Storage Architecture Overview section. Updated schema with structural tables (extracted_tables, document_chunks). Clarified data flow in architecture diagram. |

---

**Next Steps:**

1. Review and approve this PRD with stakeholders
2. Create GitHub issues for Milestone 1 implementation tasks
3. Set up development environment with new dependencies
4. Begin PDF extractor implementation
5. Establish test fixture library for document testing
6. Benchmark memory usage with large PDFs
