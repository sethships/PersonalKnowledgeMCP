# Phase 6: Unstructured Document Ingestion - Implementation Roadmap

**Date:** January 18, 2026
**Last Updated:** February 3, 2026
**Status:** In Progress
**Timeline:** 12 weeks
**PRD:** [Phase6-Document-Ingestion-PRD.md](./Phase6-Document-Ingestion-PRD.md)

---

## Overview

Phase 6 extends Personal Knowledge MCP with unstructured document ingestion capabilities, enabling semantic search across PDFs, Word documents, Markdown files, and images. The implementation is divided into 8 milestones over 12 weeks.

> **Note:** The original planning issues (#245-#330) were superseded by implementation issues. This document reflects the current implementation state with updated issue references where applicable.

### Milestone Summary

| Milestone | Focus | Duration | Priority | Status | Epic |
|-----------|-------|----------|----------|--------|------|
| **M1** | Core Document Extractors | Weeks 1-2 | P0 | **In Progress** | ~~[#245](https://github.com/sethships/PersonalKnowledgeMCP/issues/245)~~ |
| **M2** | Document Chunking | Week 3 | P0 | Planned | ~~[#246](https://github.com/sethships/PersonalKnowledgeMCP/issues/246)~~ |
| **M3** | MCP Tools | Week 4 | P0 | Planned | ~~[#247](https://github.com/sethships/PersonalKnowledgeMCP/issues/247)~~ |
| **M4** | Folder Watching | Weeks 5-6 | P0 | Planned | ~~[#248](https://github.com/sethships/PersonalKnowledgeMCP/issues/248)~~ |
| **M5** | CLI & Polish | Week 7 | P0 | Planned | ~~[#249](https://github.com/sethships/PersonalKnowledgeMCP/issues/249)~~ |
| **M6** | OCR Processing | Weeks 8-9 | P1 | Planned | ~~[#250](https://github.com/sethships/PersonalKnowledgeMCP/issues/250)~~ |
| **M7** | Table Extraction | Weeks 10-11 | P2 | Planned | ~~[#251](https://github.com/sethships/PersonalKnowledgeMCP/issues/251)~~ |
| **M8** | Image Content Analysis | Weeks 11-12 | P2 | Planned | ~~[#252](https://github.com/sethships/PersonalKnowledgeMCP/issues/252)~~ |

---

## GitHub Issues Structure

### Epics (Original - Superseded)

| Issue # | Epic Title | Milestone | Status |
|---------|-----------|-----------|--------|
| ~~[#245](https://github.com/sethships/PersonalKnowledgeMCP/issues/245)~~ | ~~[Epic] M1: Core Document Extractors~~ | M1 | Closed |
| ~~[#246](https://github.com/sethships/PersonalKnowledgeMCP/issues/246)~~ | ~~[Epic] M2: Document Chunking~~ | M2 | Closed |
| ~~[#247](https://github.com/sethships/PersonalKnowledgeMCP/issues/247)~~ | ~~[Epic] M3: MCP Tools for Document Search~~ | M3 | Closed |
| ~~[#248](https://github.com/sethships/PersonalKnowledgeMCP/issues/248)~~ | ~~[Epic] M4: Folder Watching~~ | M4 | Closed |
| ~~[#249](https://github.com/sethships/PersonalKnowledgeMCP/issues/249)~~ | ~~[Epic] M5: CLI & Polish~~ | M5 | Closed |
| ~~[#250](https://github.com/sethships/PersonalKnowledgeMCP/issues/250)~~ | ~~[Epic] M6: OCR Processing~~ | M6 | Closed |
| ~~[#251](https://github.com/sethships/PersonalKnowledgeMCP/issues/251)~~ | ~~[Epic] M7: Table Extraction~~ | M7 | Closed |
| ~~[#252](https://github.com/sethships/PersonalKnowledgeMCP/issues/252)~~ | ~~[Epic] M8: Image Content Analysis~~ | M8 | Closed |

---

## Milestone 1: Core Document Extractors (Weeks 1-2)

**Goal:** Implement document content extraction for all supported formats.

**Status:** In Progress (2 of 8 tasks complete)

**Epic:** ~~[#245](https://github.com/sethships/PersonalKnowledgeMCP/issues/245)~~ - M1: Core Document Extractors (Closed)

### Task Issues

| Issue # | Title | Size | Priority | Status |
|---------|-------|------|----------|--------|
| ~~[#253](https://github.com/sethships/PersonalKnowledgeMCP/issues/253)~~ / [#357](https://github.com/sethships/PersonalKnowledgeMCP/issues/357) | ~~Create documents module structure~~ | S | P0 | **Done** |
| ~~[#254](https://github.com/sethships/PersonalKnowledgeMCP/issues/254)~~ / [#358](https://github.com/sethships/PersonalKnowledgeMCP/issues/358) | ~~Implement PDF Extractor with pdf-parse~~ | M | P0 | **Done** |
| ~~[#255](https://github.com/sethships/PersonalKnowledgeMCP/issues/255)~~ | Implement DOCX Extractor with mammoth | M | P0 | Planned |
| ~~[#256](https://github.com/sethships/PersonalKnowledgeMCP/issues/256)~~ | Implement Markdown Parser with marked | M | P0 | Planned |
| ~~[#257](https://github.com/sethships/PersonalKnowledgeMCP/issues/257)~~ | Implement Image Metadata Extractor | M | P0 | Planned |
| ~~[#258](https://github.com/sethships/PersonalKnowledgeMCP/issues/258)~~ | Create Document Type Detector | S | P0 | Planned |
| ~~[#259](https://github.com/sethships/PersonalKnowledgeMCP/issues/259)~~ | Add error handling for corrupt files | S | P0 | Planned |
| ~~[#260](https://github.com/sethships/PersonalKnowledgeMCP/issues/260)~~ | Unit tests for all extractors (90%+ coverage) | M | P0 | Planned |

### Related Open Issues

| Issue # | Title | Priority |
|---------|-------|----------|
| [#438](https://github.com/sethships/PersonalKnowledgeMCP/issues/438) | perf(documents): optimize PdfExtractor to use single parse pass | P2 |
| [#439](https://github.com/sethships/PersonalKnowledgeMCP/issues/439) | fix(documents): add timezone offset support to PDF date parsing | P2 |

### Key Deliverables

- ~~PDF extractor (`PdfExtractor`) with text and metadata extraction~~ **Done**
- DOCX extractor (`DocxExtractor`) with structure preservation
- Markdown parser (`MarkdownParser`) with frontmatter support
- Image metadata extractor (`ImageMetadataExtractor`) with EXIF support
- Document type detector (`DocumentTypeDetector`)
- >90% test coverage for all extractors

### Dependencies to Install

```bash
bun add pdf-parse mammoth marked sharp exif-parser gray-matter
bun add -d @types/pdf-parse
```

### PRD References

- FR-1: PDF Document Processing
- FR-2: Markdown File Processing
- FR-3: DOCX Document Processing
- FR-7: Image Processing (metadata)

---

## Milestone 2: Document Chunking (Week 3)

**Goal:** Adapt the chunking pipeline for document content.

**Status:** Planned

**Epic:** ~~[#246](https://github.com/sethships/PersonalKnowledgeMCP/issues/246)~~ - M2: Document Chunking (Closed)

### Task Issues

| Issue # | Title | Size | Priority | Dependencies | Status |
|---------|-------|------|----------|--------------|--------|
| ~~[#261](https://github.com/sethships/PersonalKnowledgeMCP/issues/261)~~ | Create DocumentChunker extending FileChunker | M | P0 | ~~#260~~ | Planned |
| ~~[#262](https://github.com/sethships/PersonalKnowledgeMCP/issues/262)~~ | Implement paragraph-boundary-aware chunking | M | P0 | ~~#261~~ | Planned |
| ~~[#263](https://github.com/sethships/PersonalKnowledgeMCP/issues/263)~~ | Add section heading context preservation | S | P0 | ~~#261~~ | Planned |
| ~~[#264](https://github.com/sethships/PersonalKnowledgeMCP/issues/264)~~ | Create PostgreSQL migration for documents table | M | P0 | None | Planned |
| ~~[#265](https://github.com/sethships/PersonalKnowledgeMCP/issues/265)~~ | Integrate with IngestionService | M | P0 | ~~#261~~, ~~#264~~ | Planned |
| ~~[#266](https://github.com/sethships/PersonalKnowledgeMCP/issues/266)~~ | Add document metadata to ChromaDB storage | S | P0 | ~~#261~~ | Planned |
| ~~[#267](https://github.com/sethships/PersonalKnowledgeMCP/issues/267)~~ | Integration tests for chunking pipeline | M | P0 | ~~#262~~, ~~#263~~, ~~#265~~, ~~#266~~ | Planned |

### Key Deliverables

- Document-aware chunker (`DocumentChunker`) extending existing chunking logic
- Paragraph and page boundary support
- PostgreSQL documents table migration
- ChromaDB integration with document metadata
- Integration tests for complete pipeline

### PRD References

- Section 5.4: Data Storage Requirements
- Section 6.2: Integration with Existing Components

---

## Milestone 3: MCP Tools (Week 4)

**Goal:** Expose document search capabilities via MCP.

**Status:** Planned

**Epic:** ~~[#247](https://github.com/sethships/PersonalKnowledgeMCP/issues/247)~~ - M3: MCP Tools for Document Search (Closed)

### Task Issues

| Issue # | Title | Size | Priority | Dependencies | Status |
|---------|-------|------|----------|--------------|--------|
| ~~[#268](https://github.com/sethships/PersonalKnowledgeMCP/issues/268)~~ | Implement search_documents MCP tool | M | P0 | ~~#267~~ | Planned |
| ~~[#269](https://github.com/sethships/PersonalKnowledgeMCP/issues/269)~~ | Implement search_images MCP tool | M | P0 | ~~#267~~ | Planned |
| ~~[#270](https://github.com/sethships/PersonalKnowledgeMCP/issues/270)~~ | Implement list_watched_folders MCP tool | S | P0 | None | Planned |
| ~~[#271](https://github.com/sethships/PersonalKnowledgeMCP/issues/271)~~ | Update semantic_search with include_documents option | S | P0 | ~~#268~~ | Planned |
| ~~[#272](https://github.com/sethships/PersonalKnowledgeMCP/issues/272)~~ | Register new tools in MCP tool registry | S | P0 | ~~#268~~-~~#270~~ | Planned |
| ~~[#273](https://github.com/sethships/PersonalKnowledgeMCP/issues/273)~~ | Add comprehensive tool documentation | S | P1 | ~~#268~~-~~#270~~ | Planned |
| ~~[#274](https://github.com/sethships/PersonalKnowledgeMCP/issues/274)~~ | Integration tests for MCP tools | M | P0 | ~~#271~~, ~~#272~~, ~~#273~~ | Planned |

### Key Deliverables

- `search_documents` MCP tool for semantic document search
- `search_images` MCP tool for metadata-based image search
- `list_watched_folders` MCP tool
- Enhanced `semantic_search` with document support
- Tool documentation and integration tests

### PRD References

- Section 7: MCP Tool Design
- Section 7.1: New MCP Tools
- Section 7.2: Updated Existing Tools

---

## Milestone 4: Folder Watching (Weeks 5-6)

**Goal:** Implement real-time folder monitoring and incremental updates.

**Status:** Planned

**Epic:** ~~[#248](https://github.com/sethships/PersonalKnowledgeMCP/issues/248)~~ - M4: Folder Watching (Closed)

### Task Issues

| Issue # | Title | Size | Priority | Dependencies | Status |
|---------|-------|------|----------|--------------|--------|
| ~~[#275](https://github.com/sethships/PersonalKnowledgeMCP/issues/275)~~ | Implement FolderWatcherService with chokidar | L | P0 | ~~#267~~ | Planned |
| ~~[#276](https://github.com/sethships/PersonalKnowledgeMCP/issues/276)~~ | Add debouncing for rapid file changes | S | P0 | ~~#275~~ | Planned |
| ~~[#277](https://github.com/sethships/PersonalKnowledgeMCP/issues/277)~~ | Implement change detection (add/modify/delete) | M | P0 | ~~#275~~ | Planned |
| ~~[#278](https://github.com/sethships/PersonalKnowledgeMCP/issues/278)~~ | Create processing queue for batched updates | M | P0 | ~~#277~~ | Planned |
| ~~[#279](https://github.com/sethships/PersonalKnowledgeMCP/issues/279)~~ | Implement incremental index updates | M | P0 | ~~#278~~ | Planned |
| ~~[#280](https://github.com/sethships/PersonalKnowledgeMCP/issues/280)~~ | Add .pkignore file support | S | P1 | ~~#275~~ | Planned |
| ~~[#281](https://github.com/sethships/PersonalKnowledgeMCP/issues/281)~~ | Create PostgreSQL watched_folders table | S | P0 | None | Planned |
| ~~[#282](https://github.com/sethships/PersonalKnowledgeMCP/issues/282)~~ | Handle watcher lifecycle (start/stop/restart) | M | P0 | ~~#275~~ | Planned |
| ~~[#283](https://github.com/sethships/PersonalKnowledgeMCP/issues/283)~~ | Integration tests for watcher scenarios | L | P0 | ~~#276~~, ~~#279~~, ~~#280~~, ~~#281~~, ~~#282~~ | Planned |

### Key Deliverables

- Folder watcher service (`FolderWatcherService`) using chokidar
- Debouncing (configurable, default 2s)
- Incremental updates (add, modify, delete)
- .pkignore pattern support
- PostgreSQL watched_folders table
- 24-hour stability validation

### Dependencies to Install

```bash
bun add chokidar ignore
```

### PRD References

- FR-4: Folder Watching
- FR-5: Incremental Updates
- FR-6: Ignore Patterns

---

## Milestone 5: CLI & Polish (Week 7)

**Goal:** Complete CLI commands and finalize documentation.

**Status:** Planned

**Epic:** ~~[#249](https://github.com/sethships/PersonalKnowledgeMCP/issues/249)~~ - M5: CLI & Polish (Closed)

### Task Issues

| Issue # | Title | Size | Priority | Dependencies | Status |
|---------|-------|------|----------|--------------|--------|
| ~~[#284](https://github.com/sethships/PersonalKnowledgeMCP/issues/284)~~ | Implement pk-mcp documents index command | M | P0 | ~~#283~~ | Planned |
| ~~[#285](https://github.com/sethships/PersonalKnowledgeMCP/issues/285)~~ | Implement pk-mcp watch commands (add/list/remove/pause/resume/rescan) | L | P0 | ~~#283~~ | Planned |
| ~~[#286](https://github.com/sethships/PersonalKnowledgeMCP/issues/286)~~ | Implement pk-mcp documents status command | S | P0 | ~~#283~~ | Planned |
| ~~[#287](https://github.com/sethships/PersonalKnowledgeMCP/issues/287)~~ | Implement pk-mcp documents errors and retry commands | S | P0 | ~~#286~~ | Planned |
| ~~[#288](https://github.com/sethships/PersonalKnowledgeMCP/issues/288)~~ | Add progress reporting for bulk operations | M | P0 | ~~#284~~ | Planned |
| ~~[#289](https://github.com/sethships/PersonalKnowledgeMCP/issues/289)~~ | Performance testing against PRD targets | M | P0 | ~~#285~~, ~~#287~~, ~~#288~~ | Planned |
| ~~[#290](https://github.com/sethships/PersonalKnowledgeMCP/issues/290)~~ | Write user documentation for document features | M | P1 | ~~#285~~, ~~#287~~, ~~#288~~ | Planned |
| ~~[#291](https://github.com/sethships/PersonalKnowledgeMCP/issues/291)~~ | Update README with document ingestion guide | S | P1 | ~~#290~~ | Planned |
| ~~[#292](https://github.com/sethships/PersonalKnowledgeMCP/issues/292)~~ | (Optional) Add embedding provider observability logging | S | P2 | ~~#289~~ | Planned |

### Key Deliverables

- All CLI commands implemented and documented
- Progress reporting for bulk operations
- Performance validated against targets
- User documentation complete
- README updated
- (Optional) Embedding observability per Issue #28

### CLI Commands

```bash
pk-mcp documents index <folder-path> [options]
pk-mcp documents status [options]
pk-mcp documents errors
pk-mcp documents retry [--all | --file <path>]

pk-mcp watch add <folder-path> [options]
pk-mcp watch list
pk-mcp watch remove <name-or-path>
pk-mcp watch pause <name-or-path>
pk-mcp watch resume <name-or-path>
pk-mcp watch rescan <name-or-path> [--full]
```

### PRD References

- Section 8: CLI Commands
- Section 10: Success Metrics

---

## Milestone 6: OCR Processing (Weeks 8-9)

**Goal:** Enable text extraction from scanned documents and image-only PDFs.

**Status:** Planned

**Epic:** ~~[#250](https://github.com/sethships/PersonalKnowledgeMCP/issues/250)~~ - M6: OCR Processing (Closed)

### Task Issues

| Issue # | Title | Size | Priority | Dependencies | Status |
|---------|-------|------|----------|--------------|--------|
| ~~[#293](https://github.com/sethships/PersonalKnowledgeMCP/issues/293)~~ | Implement OcrService with tesseract.js v6 | L | P1 | ~~#289~~ | Planned |
| ~~[#294](https://github.com/sethships/PersonalKnowledgeMCP/issues/294)~~ | Create PDF page-to-image converter using pdfjs-dist | M | P1 | ~~#293~~ | Planned |
| ~~[#295](https://github.com/sethships/PersonalKnowledgeMCP/issues/295)~~ | Implement image-only PDF detection | S | P1 | ~~#294~~ | Planned |
| ~~[#296](https://github.com/sethships/PersonalKnowledgeMCP/issues/296)~~ | Add OCR confidence score tracking | S | P1 | ~~#293~~ | Planned |
| ~~[#297](https://github.com/sethships/PersonalKnowledgeMCP/issues/297)~~ | Implement configurable OCR languages | S | P1 | ~~#293~~ | Planned |
| ~~[#298](https://github.com/sethships/PersonalKnowledgeMCP/issues/298)~~ | Create background processing queue for OCR | M | P1 | ~~#293~~ | Planned |
| ~~[#299](https://github.com/sethships/PersonalKnowledgeMCP/issues/299)~~ | Add progress reporting for OCR jobs | S | P1 | ~~#298~~ | Planned |
| ~~[#300](https://github.com/sethships/PersonalKnowledgeMCP/issues/300)~~ | Implement OCR timeout handling | S | P1 | ~~#293~~ | Planned |
| ~~[#301](https://github.com/sethships/PersonalKnowledgeMCP/issues/301)~~ | Add CLI commands for OCR status | S | P1 | ~~#298~~ | Planned |
| ~~[#302](https://github.com/sethships/PersonalKnowledgeMCP/issues/302)~~ | Update MCP tools to include OCR content | S | P1 | ~~#293~~ | Planned |
| ~~[#303](https://github.com/sethships/PersonalKnowledgeMCP/issues/303)~~ / [#407](https://github.com/sethships/PersonalKnowledgeMCP/issues/407) | Unit tests for OCR service (85%+ coverage) | M | P1 | ~~#295~~, ~~#296~~, ~~#297~~, ~~#299~~, ~~#300~~, ~~#301~~, ~~#302~~ | Open |
| ~~[#304](https://github.com/sethships/PersonalKnowledgeMCP/issues/304)~~ / [#408](https://github.com/sethships/PersonalKnowledgeMCP/issues/408) | Integration tests for OCR pipeline | M | P1 | ~~#303~~ | Open |

### Key Deliverables

- OCR service (`OcrService`) using tesseract.js v6
- PDF page-to-image conversion with pdfjs-dist
- Image-only PDF detection
- OCR confidence tracking
- Background processing queue
- CLI commands for OCR management
- >85% test coverage

### Dependencies to Install

```bash
bun add tesseract.js pdfjs-dist
```

### PRD References

- FR-9: OCR for Scanned Documents
- US-9: Search Scanned Document Content

---

## Milestone 7: Table Extraction (Weeks 10-11)

**Goal:** Extract structured table data from PDF and DOCX documents.

**Status:** Planned

**Epic:** ~~[#251](https://github.com/sethships/PersonalKnowledgeMCP/issues/251)~~ - M7: Table Extraction (Closed)

### Task Issues (Current Implementation Issues)

| Issue # | Title | Size | Priority | Status |
|---------|-------|------|----------|--------|
| [#409](https://github.com/sethships/PersonalKnowledgeMCP/issues/409) | Implement TableExtractor interface | S | P2 | Open |
| [#410](https://github.com/sethships/PersonalKnowledgeMCP/issues/410) | Implement PdfTableExtractor with pdfreader | M | P2 | Open |
| [#411](https://github.com/sethships/PersonalKnowledgeMCP/issues/411) | Implement DocxTableExtractor | M | P2 | Open |
| [#412](https://github.com/sethships/PersonalKnowledgeMCP/issues/412) | Create table structure model | S | P2 | Open |
| [#413](https://github.com/sethships/PersonalKnowledgeMCP/issues/413) | Implement table header detection | M | P2 | Open |
| [#414](https://github.com/sethships/PersonalKnowledgeMCP/issues/414) | Add multi-page table handling | M | P2 | Open |
| [#415](https://github.com/sethships/PersonalKnowledgeMCP/issues/415) | Store tables in PostgreSQL (JSON) | S | P2 | Open |
| [#416](https://github.com/sethships/PersonalKnowledgeMCP/issues/416) | Index table content in ChromaDB | S | P2 | Open |
| [#417](https://github.com/sethships/PersonalKnowledgeMCP/issues/417) | Implement pk-mcp tables list command | S | P2 | Open |
| [#418](https://github.com/sethships/PersonalKnowledgeMCP/issues/418) | Implement pk-mcp tables export command | M | P2 | Open |
| [#419](https://github.com/sethships/PersonalKnowledgeMCP/issues/419) | Add table filtering to search_documents | S | P2 | Open |
| [#420](https://github.com/sethships/PersonalKnowledgeMCP/issues/420) | Unit tests for table extraction (85%+ coverage) | M | P2 | Open |

### Original Issues (Superseded)

| Issue # | Title | Status |
|---------|-------|--------|
| ~~[#305](https://github.com/sethships/PersonalKnowledgeMCP/issues/305)~~ | ~~Implement TableExtractor interface~~ | Closed |
| ~~[#306](https://github.com/sethships/PersonalKnowledgeMCP/issues/306)~~ | ~~Implement PdfTableExtractor with pdfreader~~ | Closed |
| ~~[#307](https://github.com/sethships/PersonalKnowledgeMCP/issues/307)~~ | ~~Implement DocxTableExtractor~~ | Closed |
| ~~[#308](https://github.com/sethships/PersonalKnowledgeMCP/issues/308)~~ | ~~Create table structure model~~ | Closed |
| ~~[#309](https://github.com/sethships/PersonalKnowledgeMCP/issues/309)~~ | ~~Implement table header detection~~ | Closed |
| ~~[#310](https://github.com/sethships/PersonalKnowledgeMCP/issues/310)~~ | ~~Add multi-page table handling~~ | Closed |
| ~~[#311](https://github.com/sethships/PersonalKnowledgeMCP/issues/311)~~ | ~~Store tables in PostgreSQL (JSON)~~ | Closed |
| ~~[#312](https://github.com/sethships/PersonalKnowledgeMCP/issues/312)~~ | ~~Index table content in ChromaDB~~ | Closed |
| ~~[#313](https://github.com/sethships/PersonalKnowledgeMCP/issues/313)~~ | ~~Implement pk-mcp tables list command~~ | Closed |
| ~~[#314](https://github.com/sethships/PersonalKnowledgeMCP/issues/314)~~ | ~~Implement pk-mcp tables export command~~ | Closed |
| ~~[#315](https://github.com/sethships/PersonalKnowledgeMCP/issues/315)~~ | ~~Add table filtering to search_documents~~ | Closed |
| ~~[#316](https://github.com/sethships/PersonalKnowledgeMCP/issues/316)~~ | ~~Unit tests for table extraction (85%+ coverage)~~ | Closed |

### Key Deliverables

- Table extractor interface (`TableExtractor`)
- PDF table extractor (`PdfTableExtractor`) with pdfreader
- DOCX table extractor (`DocxTableExtractor`)
- Table header detection heuristics
- Multi-page table support
- PostgreSQL and ChromaDB storage
- CLI commands for table management
- CSV/JSON export

### Dependencies to Install

```bash
bun add pdfreader
```

### PRD References

- FR-10: Complex Table Extraction
- US-10: Extract and Search Table Data

---

## Milestone 8: Image Content Analysis (Weeks 11-12)

**Goal:** Generate and index AI-based descriptions of image content.

**Status:** Planned

**Epic:** ~~[#252](https://github.com/sethships/PersonalKnowledgeMCP/issues/252)~~ - M8: Image Content Analysis (Closed)

### Task Issues (Current Implementation Issues)

| Issue # | Title | Size | Priority | Status |
|---------|-------|------|----------|--------|
| [#421](https://github.com/sethships/PersonalKnowledgeMCP/issues/421) | Implement ImageAnalysisService with provider abstraction | M | P2 | Open |
| [#422](https://github.com/sethships/PersonalKnowledgeMCP/issues/422) | Implement LocalImageAnalyzer with Transformers.js | L | P2 | Open |
| [#423](https://github.com/sethships/PersonalKnowledgeMCP/issues/423) | Implement OpenAIImageAnalyzer | M | P2 | Open |
| [#424](https://github.com/sethships/PersonalKnowledgeMCP/issues/424) | Create image analysis provider configuration | S | P2 | Open |
| [#425](https://github.com/sethships/PersonalKnowledgeMCP/issues/425) | Implement lazy model loading for image analysis | S | P2 | Open |
| [#426](https://github.com/sethships/PersonalKnowledgeMCP/issues/426) | Add image type classification | M | P2 | Open |
| [#427](https://github.com/sethships/PersonalKnowledgeMCP/issues/427) | Store image descriptions in PostgreSQL | S | P2 | Open |
| [#428](https://github.com/sethships/PersonalKnowledgeMCP/issues/428) | Generate embeddings from image descriptions | S | P2 | Open |
| [#429](https://github.com/sethships/PersonalKnowledgeMCP/issues/429) | Add content_query to search_images MCP tool | S | P2 | Open |
| [#430](https://github.com/sethships/PersonalKnowledgeMCP/issues/430) | Implement pk-mcp images analyze command | S | P2 | Open |
| [#431](https://github.com/sethships/PersonalKnowledgeMCP/issues/431) | Implement pk-mcp images reanalyze command | S | P2 | Open |
| [#432](https://github.com/sethships/PersonalKnowledgeMCP/issues/432) | Add image analysis progress reporting | S | P2 | Open |
| [#433](https://github.com/sethships/PersonalKnowledgeMCP/issues/433) | Unit tests for image analysis (85%+ coverage) | M | P2 | Open |
| [#434](https://github.com/sethships/PersonalKnowledgeMCP/issues/434) | Integration tests for both image analysis providers | M | P2 | Open |

### Original Issues (Superseded)

| Issue # | Title | Status |
|---------|-------|--------|
| ~~[#317](https://github.com/sethships/PersonalKnowledgeMCP/issues/317)~~ | ~~Implement ImageAnalysisService with provider abstraction~~ | Closed |
| ~~[#318](https://github.com/sethships/PersonalKnowledgeMCP/issues/318)~~ | ~~Implement LocalImageAnalyzer with Transformers.js~~ | Closed |
| ~~[#319](https://github.com/sethships/PersonalKnowledgeMCP/issues/319)~~ | ~~Implement OpenAIImageAnalyzer~~ | Closed |
| ~~[#320](https://github.com/sethships/PersonalKnowledgeMCP/issues/320)~~ | ~~Create provider configuration~~ | Closed |
| ~~[#321](https://github.com/sethships/PersonalKnowledgeMCP/issues/321)~~ | ~~Implement lazy model loading~~ | Closed |
| ~~[#322](https://github.com/sethships/PersonalKnowledgeMCP/issues/322)~~ | ~~Add image type classification~~ | Closed |
| ~~[#323](https://github.com/sethships/PersonalKnowledgeMCP/issues/323)~~ | ~~Store descriptions in PostgreSQL~~ | Closed |
| ~~[#324](https://github.com/sethships/PersonalKnowledgeMCP/issues/324)~~ | ~~Generate embeddings from descriptions~~ | Closed |
| ~~[#325](https://github.com/sethships/PersonalKnowledgeMCP/issues/325)~~ | ~~Add content_query to search_images MCP tool~~ | Closed |
| ~~[#326](https://github.com/sethships/PersonalKnowledgeMCP/issues/326)~~ | ~~Implement pk-mcp images analyze command~~ | Closed |
| ~~[#327](https://github.com/sethships/PersonalKnowledgeMCP/issues/327)~~ | ~~Implement pk-mcp images reanalyze command~~ | Closed |
| ~~[#328](https://github.com/sethships/PersonalKnowledgeMCP/issues/328)~~ | ~~Add analysis progress reporting~~ | Closed |
| ~~[#329](https://github.com/sethships/PersonalKnowledgeMCP/issues/329)~~ | ~~Unit tests for image analysis (85%+ coverage)~~ | Closed |
| ~~[#330](https://github.com/sethships/PersonalKnowledgeMCP/issues/330)~~ | ~~Integration tests for both providers~~ | Closed |

### Key Deliverables

- Image analysis service (`ImageAnalysisService`) with provider abstraction
- Local analyzer (`LocalImageAnalyzer`) using Transformers.js BLIP model
- Cloud analyzer (`OpenAIImageAnalyzer`) using OpenAI Vision
- Image type classification
- PostgreSQL and ChromaDB storage
- CLI commands for image analysis
- >85% test coverage

### Dependencies to Install

```bash
bun add @xenova/transformers openai
```

### PRD References

- FR-11: Image Content Analysis
- US-11: Search Images by Content Description

---

## Dependency Graph

```
[M1: Core Extractors] -----> [M2: Document Chunking] -----> [M3: MCP Tools]
        |                            |                            |
        |                            |                            v
        |                            +----------> [M4: Folder Watching]
        |                                                  |
        |                                                  v
        +-----------------------------------------> [M5: CLI & Polish]
                                                          |
        +-------------------------------------------------+
        |                    |                            |
        v                    v                            v
[M6: OCR Processing]  [M7: Table Extraction]  [M8: Image Content Analysis]
```

**Critical Path:** M1 -> M2 -> M4 -> M5

**Parallel Work (after M5):**
- M6, M7, M8 can be developed in parallel
- M7 and M8 share Week 11

---

## Issue Summary

| Milestone | Original Epic | Original Tasks | Current Open Issues | Status |
|-----------|---------------|----------------|---------------------|--------|
| M1: Core Extractors | ~~#245~~ | ~~#253-#260~~ (8) | #438, #439 (2 enhancements) | **In Progress** |
| M2: Document Chunking | ~~#246~~ | ~~#261-#267~~ (7) | 0 | Planned |
| M3: MCP Tools | ~~#247~~ | ~~#268-#274~~ (7) | 0 | Planned |
| M4: Folder Watching | ~~#248~~ | ~~#275-#283~~ (9) | 0 | Planned |
| M5: CLI & Polish | ~~#249~~ | ~~#284-#292~~ (9) | 0 | Planned |
| M6: OCR Processing | ~~#250~~ | ~~#293-#304~~ (12) | #407, #408 (2 tests) | Planned |
| M7: Table Extraction | ~~#251~~ | ~~#305-#316~~ (12) | #409-#420 (12) | Planned |
| M8: Image Content Analysis | ~~#252~~ | ~~#317-#330~~ (14) | #421-#434 (14) | Planned |
| **Total** | **8 Epics (Closed)** | **78 Tasks (Closed)** | **30 Open** | |

### Recently Completed Issues

| Issue # | Title | Closed Date |
|---------|-------|-------------|
| [#357](https://github.com/sethships/PersonalKnowledgeMCP/issues/357) | Create documents module structure | 2026-01-31 |
| [#358](https://github.com/sethships/PersonalKnowledgeMCP/issues/358) | Implement PDF Extractor with pdf-parse | 2026-02-01 |

### Related Non-Phase-6 Issues (Recently Completed)

| Issue # | Title | Relevance |
|---------|-------|-----------|
| [#447](https://github.com/sethships/PersonalKnowledgeMCP/issues/447) | Enable MCP-based incremental update tools | Foundation for incremental document updates |
| [#444](https://github.com/sethships/PersonalKnowledgeMCP/issues/444) | Collection not found errors during incremental update | Bug fix supporting incremental updates |
| [#440](https://github.com/sethships/PersonalKnowledgeMCP/issues/440) | Remove Neo4j code and dependencies | Cleanup for FalkorDB migration |
| [#442](https://github.com/sethships/PersonalKnowledgeMCP/issues/442) | Update graph CLI commands for FalkorDB | CLI consistency |

---

## Success Metrics

### Functional Success Criteria

| Criterion | Target | Milestone |
|-----------|--------|-----------|
| PDF extraction accuracy | >95% | M1 |
| DOCX extraction accuracy | >95% | M1 |
| Markdown parsing accuracy | 100% | M1 |
| Image metadata extraction | >90% EXIF | M1 |
| File watcher reliability | Zero missed events (24h test) | M4 |
| Incremental update correctness | 100% | M4 |
| OCR extraction accuracy | >90% (clean scans) | M6 |
| Table structure preservation | >85% | M7 |
| Image description accuracy | >80% | M8 |
| Image type classification | >90% | M8 |

### Performance Success Criteria

| Metric | Target | Milestone |
|--------|--------|-----------|
| PDF extraction (10 pages) | <2 seconds | M1 |
| PDF extraction (100 pages) | <10 seconds | M1 |
| DOCX extraction | <1 second | M1 |
| Document search latency (p95) | <500ms | M3 |
| Image metadata search (p95) | <200ms | M3 |
| Bulk indexing (1000 docs) | <30 minutes | M5 |
| OCR per page | <15 seconds | M6 |
| Table extraction per document | <5 seconds | M7 |
| Image analysis (local) | <10 seconds | M8 |

### Quality Success Criteria

| Criterion | Target | Milestone |
|-----------|--------|-----------|
| Test coverage (document processing) | >=90% | M1-M5 |
| Test coverage (OCR) | >=85% | M6 |
| Test coverage (table extraction) | >=85% | M7 |
| Test coverage (image analysis) | >=85% | M8 |
| No P0 bugs | 0 for 2 weeks post-launch | All |

---

## Risk Summary

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| PDF extraction quality varies | High | Medium | Test early; document limitations |
| Large PDF memory consumption | Medium | Medium | Streaming extraction; size limits |
| File watcher platform differences | Medium | Low | Use chokidar; test cross-platform |
| OCR accuracy on low-quality scans | High | Medium | Confidence thresholds; quality warnings |
| OCR processing time | Medium | High | Background queue; timeouts |
| Table extraction fails on complex layouts | Medium | High | Document limitations; fallback to text |
| Transformers.js model memory | High | Medium | Lazy loading; unloading after batch |
| OpenAI API rate limits | Medium | Low | Rate limiting; batch processing |

---

## Quick Links

- **Milestone:** [Phase 6: Unstructured Document Ingestion](https://github.com/sethships/PersonalKnowledgeMCP/milestone/3)
- **PRD:** [Phase6-Document-Ingestion-PRD.md](./Phase6-Document-Ingestion-PRD.md)
- **Project Plan:** [Phase6-Project-Plan.md](./Phase6-Project-Plan.md)
- **All Phase 6 Issues:** [GitHub Issues](https://github.com/sethships/PersonalKnowledgeMCP/issues?q=is%3Aissue+label%3Aphase-6)
- **Open Phase 6 Issues:** [GitHub Issues (Open)](https://github.com/sethships/PersonalKnowledgeMCP/issues?q=is%3Aissue+is%3Aopen+label%3Aphase-6)

---

*Document generated: January 18, 2026*
*Last updated: February 3, 2026*
*Repository: sethships/PersonalKnowledgeMCP*
