# Phase 6: Unstructured Document Ingestion - Project Plan

**Version:** 1.0
**Date:** January 18, 2026
**Status:** Planning
**Author:** Project Team
**PRD:** [Phase6-Document-Ingestion-PRD.md](./Phase6-Document-Ingestion-PRD.md)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Scope and Objectives](#2-scope-and-objectives)
3. [Resource Requirements](#3-resource-requirements)
4. [Timeline and Schedule](#4-timeline-and-schedule)
5. [Deliverables by Milestone](#5-deliverables-by-milestone)
6. [Quality Gates and Success Criteria](#6-quality-gates-and-success-criteria)
7. [Risk Register](#7-risk-register)
8. [Governance and Communication](#8-governance-and-communication)
9. [Definition of Done](#9-definition-of-done)

---

## 1. Executive Summary

### Purpose

Phase 6 extends Personal Knowledge MCP with unstructured document ingestion capabilities, enabling AI assistants to semantically search across PDFs, Microsoft Word documents, Markdown files, and images with metadata extraction. This fulfills the system's secondary use case of educational material organization and documentation management.

### Business Value

1. **Educational Material Integration**: Students and researchers can index college notes, textbooks, and academic papers
2. **Documentation Search**: Developers can make product documentation and reference materials semantically searchable
3. **Living Documentation**: Automatic re-indexing when files change in watched directories
4. **Visual Asset Discovery**: Find images by metadata (date, dimensions) and content descriptions

### Key Metrics

| Metric | Target |
|--------|--------|
| Document search latency (p95) | <500ms |
| PDF extraction accuracy | >95% |
| OCR accuracy (clean scans) | >90% |
| Test coverage | >=90% (core), >=85% (advanced) |

### Timeline Summary

- **Total Duration:** 12 weeks
- **Core Features (M1-M5):** Weeks 1-7
- **Advanced Features (M6-M8):** Weeks 8-12

---

## 2. Scope and Objectives

### In Scope

#### Core Document Processing (P0)
- PDF document ingestion with text and metadata extraction
- Microsoft Word (.docx) document support
- Markdown file processing with frontmatter support
- Image metadata extraction (dimensions, EXIF data)
- Document-aware chunking for semantic search
- MCP tools for document and image search
- Local folder watching with automatic re-indexing
- CLI commands for document management
- Configurable ignore patterns (.pkignore)

#### Advanced Content Processing (P1-P2)
- OCR for scanned documents and image-only PDFs (P1)
- Complex table extraction from PDFs and DOCX (P2)
- Image content analysis with AI-generated descriptions (P2)

### Out of Scope

- Document format conversion (e.g., DOCX to PDF)
- Cloud storage integration (OneDrive, Google Drive) - deferred to future
- Video/audio file processing
- PDF form field extraction
- Handwriting recognition
- Real-time collaborative editing

### Objectives

| Objective | Measurement | Target |
|-----------|-------------|--------|
| Enable document search | MCP tools deployed | search_documents, search_images |
| Support folder watching | Auto-reindex on file changes | <2s detection latency |
| Maintain performance | Query latency p95 | <500ms |
| Ensure quality | Test coverage | >=90% (core features) |
| Enable OCR | Scanned PDF searchability | >90% accuracy |
| Enable table search | Table data accessibility | >85% structure preserved |
| Enable image content search | AI descriptions | >80% accuracy |

---

## 3. Resource Requirements

### Team

| Role | Allocation | Responsibilities |
|------|------------|------------------|
| Developer | 1 FTE | Implementation, testing, documentation |
| Reviewer | 0.2 FTE | Code reviews, architecture guidance |

### Dependencies (New Packages)

#### Core Dependencies (M1-M5)

| Package | Version | Purpose | License | Bundle Impact |
|---------|---------|---------|---------|---------------|
| pdf-parse | ^1.1.1 | PDF text extraction | MIT | ~5MB |
| mammoth | ^1.6.0 | DOCX to text/HTML | BSD-2-Clause | ~1MB |
| marked | ^12.0.0 | Markdown parsing | MIT | ~300KB |
| sharp | ^0.33.0 | Image processing | Apache-2.0 | ~30MB |
| exif-parser | ^0.1.12 | EXIF extraction | MIT | ~50KB |
| chokidar | ^3.6.0 | File watching | MIT | ~500KB |
| ignore | ^5.3.0 | Pattern matching | MIT | ~50KB |

**Core Bundle Impact:** ~37MB

#### Advanced Dependencies (M6-M8)

| Package | Version | Purpose | License | Bundle Impact |
|---------|---------|---------|---------|---------------|
| tesseract.js | ^6.0.0 | OCR text extraction | Apache-2.0 | ~50MB + models |
| pdfjs-dist | ^4.0.0 | PDF page rendering | Apache-2.0 | ~10MB |
| pdfreader | ^3.0.0 | PDF table extraction | MIT | ~2MB |
| @xenova/transformers | ^2.17.0 | Local image analysis | Apache-2.0 | ~5MB + models |
| openai | ^4.0.0 | Cloud image analysis | MIT | ~1MB |

**Advanced Bundle Impact:** ~68MB + downloaded models (~500MB-1GB)

### Infrastructure

| Component | Requirement | Notes |
|-----------|-------------|-------|
| ChromaDB | Existing | Document chunk storage |
| PostgreSQL | Existing | Document metadata, table storage |
| Neo4j | Existing | Optional: document relationships |
| Disk Space | +1-2GB | Model downloads (OCR, image analysis) |
| Memory | +500MB-2GB | During OCR/image analysis operations |

### Embedding Provider Recommendation

Phase 6 is designed for **local-first embedding** to avoid API costs for document ingestion:

| Deployment | Provider | Configuration |
|------------|----------|---------------|
| Default | Transformers.js | Zero-config, works immediately |
| GPU available | Ollama | Best performance |
| Highest quality | OpenAI | Optional, requires API key |

---

## 4. Timeline and Schedule

### Phase 6 Timeline (12 Weeks)

```
Week 1-2:  [M1: Core Extractors          ]
Week 3:    [M2: Document Chunking        ]
Week 4:    [M3: MCP Tools                ]
Week 5-6:  [M4: Folder Watching          ]
Week 7:    [M5: CLI & Polish             ]
Week 8-9:  [M6: OCR Processing           ]
Week 10:   [M7: Table Extraction         ]
Week 11:   [M7: Table    ][M8: Image     ]
Week 12:   [M8: Image Content Analysis   ]
```

### Milestone Schedule

| Milestone | Start | End | Duration | Dependencies |
|-----------|-------|-----|----------|--------------|
| M1: Core Extractors | Week 1 | Week 2 | 2 weeks | None |
| M2: Document Chunking | Week 3 | Week 3 | 1 week | M1 |
| M3: MCP Tools | Week 4 | Week 4 | 1 week | M2 |
| M4: Folder Watching | Week 5 | Week 6 | 2 weeks | M2 |
| M5: CLI & Polish | Week 7 | Week 7 | 1 week | M1-M4 |
| M6: OCR Processing | Week 8 | Week 9 | 2 weeks | M5 |
| M7: Table Extraction | Week 10 | Week 11 | 1.5 weeks | M5 |
| M8: Image Content Analysis | Week 11 | Week 12 | 1.5 weeks | M5 |

### Critical Path

```
M1 -> M2 -> M4 -> M5 (Core Features Complete)
```

Core features (M1-M5) must complete before advanced features (M6-M8) can begin.

### Parallel Work Opportunities

After M5 completion:
- M6, M7, and M8 can be developed in parallel
- Week 11 has overlap between M7 and M8

---

## 5. Deliverables by Milestone

### M1: Core Extractors (Weeks 1-2)

| Deliverable | Type | Acceptance Criteria |
|-------------|------|---------------------|
| `src/documents/` module | Code | Module structure created |
| `PdfExtractor` class | Code | >95% extraction accuracy |
| `DocxExtractor` class | Code | Structure preservation |
| `MarkdownParser` class | Code | Frontmatter support |
| `ImageMetadataExtractor` class | Code | EXIF extraction |
| `DocumentTypeDetector` class | Code | All formats detected |
| Unit tests | Tests | >90% coverage |

### M2: Document Chunking (Week 3)

| Deliverable | Type | Acceptance Criteria |
|-------------|------|---------------------|
| `DocumentChunker` class | Code | Extends FileChunker |
| Paragraph chunking | Code | Boundary-aware |
| Section context | Code | Heading preservation |
| PostgreSQL migration | Migration | documents table |
| ChromaDB integration | Code | Metadata stored |
| Integration tests | Tests | Pipeline validated |

### M3: MCP Tools (Week 4)

| Deliverable | Type | Acceptance Criteria |
|-------------|------|---------------------|
| `search_documents` tool | Code | Schema per PRD |
| `search_images` tool | Code | Schema per PRD |
| `list_watched_folders` tool | Code | Schema per PRD |
| Updated `semantic_search` | Code | include_documents option |
| Tool documentation | Docs | All tools documented |
| Integration tests | Tests | Tools validated |

### M4: Folder Watching (Weeks 5-6)

| Deliverable | Type | Acceptance Criteria |
|-------------|------|---------------------|
| `FolderWatcherService` | Code | chokidar integration |
| Debouncing | Code | Configurable (default 2s) |
| Change detection | Code | Add/modify/delete events |
| Processing queue | Code | Batched updates |
| Incremental updates | Code | Correct index state |
| .pkignore support | Code | Pattern matching |
| PostgreSQL migration | Migration | watched_folders table |
| Watcher lifecycle | Code | Start/stop/restart |
| Integration tests | Tests | 24h stability |

### M5: CLI & Polish (Week 7)

| Deliverable | Type | Acceptance Criteria |
|-------------|------|---------------------|
| `documents index` command | CLI | Bulk indexing |
| `watch add/list/remove` commands | CLI | Folder management |
| `documents status` command | CLI | Status reporting |
| `documents errors/retry` commands | CLI | Error handling |
| Progress reporting | Code | Percentage + ETA |
| Performance validation | Test | Meets PRD targets |
| User documentation | Docs | Complete guide |
| README update | Docs | Document ingestion section |

### M6: OCR Processing (Weeks 8-9)

| Deliverable | Type | Acceptance Criteria |
|-------------|------|---------------------|
| `OcrService` class | Code | tesseract.js v6 |
| PDF page converter | Code | pdfjs-dist |
| Image-only PDF detection | Code | Automatic |
| Confidence tracking | Code | Per-page scores |
| Language configuration | Code | Configurable |
| Background queue | Code | Async processing |
| Progress reporting | Code | Long-running jobs |
| Timeout handling | Code | Per-page limits |
| OCR CLI commands | CLI | Status/triggers |
| MCP tool updates | Code | OCR content included |
| Unit tests | Tests | >85% coverage |
| Integration tests | Tests | Full pipeline |

### M7: Table Extraction (Weeks 10-11)

| Deliverable | Type | Acceptance Criteria |
|-------------|------|---------------------|
| `TableExtractor` interface | Code | Common operations |
| `PdfTableExtractor` | Code | pdfreader |
| `DocxTableExtractor` | Code | mammoth HTML |
| Table structure model | Code | Rows/columns/headers |
| Header detection | Code | Heuristics |
| Multi-page support | Code | PDF spanning |
| PostgreSQL storage | Schema | JSON format |
| ChromaDB indexing | Code | Table context |
| `tables list` command | CLI | List tables |
| `tables export` command | CLI | CSV/JSON export |
| MCP tool update | Code | Table filtering |
| Unit tests | Tests | >85% coverage |

### M8: Image Content Analysis (Weeks 11-12)

| Deliverable | Type | Acceptance Criteria |
|-------------|------|---------------------|
| `ImageAnalysisService` | Code | Provider abstraction |
| `LocalImageAnalyzer` | Code | Transformers.js BLIP |
| `OpenAIImageAnalyzer` | Code | OpenAI Vision |
| Provider configuration | Code | Local/cloud selection |
| Lazy model loading | Code | On-demand |
| Image type classification | Code | Diagram/screenshot/photo/chart |
| PostgreSQL storage | Code | Descriptions stored |
| Embeddings generation | Code | ChromaDB integration |
| `content_query` parameter | Code | search_images enhancement |
| `images analyze` command | CLI | Trigger analysis |
| `images reanalyze` command | CLI | Re-process |
| Progress reporting | Code | Batch operations |
| Unit tests | Tests | >85% coverage |
| Integration tests | Tests | Both providers |

---

## 6. Quality Gates and Success Criteria

### Quality Gates by Milestone

| Milestone | Gate | Criteria |
|-----------|------|----------|
| M1 | Unit Tests | >90% coverage for extractors |
| M1 | Extraction Accuracy | >95% PDF, >95% DOCX, 100% Markdown |
| M2 | Integration Tests | Pipeline validated end-to-end |
| M3 | Tool Tests | All MCP tools pass integration tests |
| M4 | Stability Test | 24h watcher with zero missed events |
| M5 | Performance | Meets PRD performance targets |
| M5 | Documentation | User guide complete |
| M6 | OCR Accuracy | >90% for clean scans |
| M7 | Table Accuracy | >85% structure preservation |
| M8 | Description Accuracy | >80% semantically accurate |

### Performance Targets

| Operation | Target | Gate |
|-----------|--------|------|
| PDF extraction (10 pages) | <2 seconds | M1 |
| PDF extraction (100 pages) | <10 seconds | M1 |
| DOCX extraction | <1 second | M1 |
| Markdown parsing | <100ms | M1 |
| Document search (p95) | <500ms | M3 |
| Image metadata search (p95) | <200ms | M3 |
| File watcher latency | <500ms | M4 |
| Bulk indexing (1000 docs) | <30 minutes | M5 |
| OCR per page | <15 seconds | M6 |
| Table extraction per doc | <5 seconds | M7 |
| Image analysis (local) | <10 seconds | M8 |

### Test Coverage Requirements

| Component | Minimum Coverage |
|-----------|------------------|
| Core extractors (M1) | 90% |
| Document chunking (M2) | 90% |
| MCP tools (M3) | 90% |
| Folder watcher (M4) | 90% |
| CLI commands (M5) | 90% |
| OCR service (M6) | 85% |
| Table extraction (M7) | 85% |
| Image analysis (M8) | 85% |

### Definition of Done Checklist

For each feature/issue:
- [ ] Code implemented and passes linting
- [ ] Unit tests written with required coverage
- [ ] Integration tests pass
- [ ] TypeScript types complete (no `any`)
- [ ] Error handling implemented
- [ ] Logging added for operations
- [ ] Documentation updated
- [ ] PR reviewed and approved
- [ ] Merged to main branch

---

## 7. Risk Register

### Technical Risks

| ID | Risk | Impact | Probability | Mitigation | Owner |
|----|------|--------|-------------|------------|-------|
| T1 | PDF extraction quality varies | High | Medium | Test early with diverse PDFs; document limitations; manual re-index option | Dev |
| T2 | Large PDF memory consumption | Medium | Medium | Implement streaming extraction; enforce 50MB size limit; test with 100+ page docs | Dev |
| T3 | File watcher platform differences | Medium | Low | Use chokidar (cross-platform); test on Windows, macOS, Linux | Dev |
| T4 | Sharp native binding issues | Medium | Low | Test in CI across platforms; fallback to image-size + exifr | Dev |
| T5 | OCR accuracy on low-quality scans | High | Medium | Confidence thresholds; quality warnings; suggest rescanning | Dev |
| T6 | OCR processing time for large docs | Medium | High | Background queue; per-page timeouts; progress reporting | Dev |
| T7 | tesseract.js model download failures | Medium | Low | Cache models locally; offline model installation option | Dev |
| T8 | PDF table detection false positives | Low | Medium | Confidence scoring; manual table exclusion option | Dev |
| T9 | Transformers.js model memory issues | High | Medium | Lazy loading; unload after batch; memory monitoring | Dev |
| T10 | BLIP model accuracy varies by image type | Medium | Medium | Test diverse images; document accuracy expectations; cloud fallback | Dev |
| T11 | OpenAI API rate limits | Medium | Low | Rate limiting; batch processing; exponential backoff | Dev |

### Product Risks

| ID | Risk | Impact | Probability | Mitigation | Owner |
|----|------|--------|-------------|------------|-------|
| P1 | OCR quality expectations too high | Medium | Medium | Clear documentation of limitations; show confidence scores | PM |
| P2 | Watched folder fills with irrelevant files | Low | Medium | Good default exclusion patterns; easy configuration | Dev |
| P3 | Index grows too large | Medium | Low | Document size limits; index management tools | Dev |
| P4 | Table extraction results confusing | Medium | Medium | Clear table preview; structured export; source references | Dev |
| P5 | Image descriptions not useful for search | Medium | Medium | Test with real queries; iterate on prompts; re-analysis option | Dev |
| P6 | Privacy concerns with cloud image analysis | High | Medium | Default to local; clear documentation; thumbnail-only mode | PM |

### Operational Risks

| ID | Risk | Impact | Probability | Mitigation | Owner |
|----|------|--------|-------------|------------|-------|
| O1 | Watcher consumes too many file handles | Medium | Low | Handle pooling; test with large folder trees | Dev |
| O2 | Disk space consumption | Low | Medium | Store extracted text, not full documents; PostgreSQL compression | Dev |
| O3 | Embedding API costs for documents | Low | Medium | Track token usage; default to local embeddings | Dev |
| O4 | CPU load during OCR/analysis | Medium | Medium | Concurrent processing limits; priority queuing | Dev |
| O5 | Image analysis model storage (~1GB) | Low | Medium | Download on demand; cache management; document requirements | Dev |

### Risk Response Actions

| Risk ID | Response | Trigger | Action |
|---------|----------|---------|--------|
| T1 | Accept | PDF errors >5% | Document known limitations |
| T2 | Mitigate | Memory >500MB | Implement streaming |
| T5 | Accept | OCR <80% | Display confidence; suggest rescan |
| T6 | Mitigate | >30s/page | Kill and retry with reduced resolution |
| T9 | Mitigate | OOM error | Implement model unloading |

---

## 8. Governance and Communication

### Decision Authority

| Decision Type | Authority | Escalation |
|---------------|-----------|------------|
| Technical implementation | Developer | Tech Lead |
| Scope changes | Product Team | Stakeholders |
| Schedule changes | Project Lead | Stakeholders |
| Budget/resource changes | Project Lead | Management |

### Communication Cadences

| Meeting | Frequency | Participants | Purpose |
|---------|-----------|--------------|---------|
| Stand-up | Daily | Dev team | Progress, blockers |
| Sprint Planning | Bi-weekly | Full team | Sprint scope |
| Sprint Review | Bi-weekly | Full team + stakeholders | Demo, feedback |
| Retrospective | Bi-weekly | Dev team | Process improvement |

### Status Reporting

| Report | Frequency | Audience | Content |
|--------|-----------|----------|---------|
| Weekly Status | Weekly | Stakeholders | Progress, risks, blockers |
| Sprint Report | Bi-weekly | Team | Velocity, burndown |
| Milestone Report | Per milestone | Stakeholders | Deliverables, quality |

### Artifacts Location

All project artifacts are stored in the repository:

```
docs/pm/
  Phase6-Document-Ingestion-PRD.md  # Product Requirements
  Phase6-Project-Plan.md            # This document
  Phase6-Roadmap.md                 # Implementation roadmap
  Phase6-GitHub-Issues.md           # Issue templates
  status/
    Phase6-YYYY-WW.md               # Weekly status reports
```

---

## 9. Definition of Done

### Phase 6 Complete Criteria

All items must be complete to declare Phase 6 done:

#### Core Features (P0) - Mandatory

- [ ] M1: Core Extractors completed and merged
- [ ] M2: Document Chunking completed and merged
- [ ] M3: MCP Tools completed and merged
- [ ] M4: Folder Watching completed and merged
- [ ] M5: CLI & Polish completed and merged
- [ ] Document search latency <500ms (p95)
- [ ] PDF extraction accuracy >95%
- [ ] File watcher reliability validated (24h test)
- [ ] Test coverage >=90% for core features
- [ ] User documentation complete
- [ ] No P0 bugs for 2 weeks post-launch

#### Advanced Features (P1-P2) - Target

- [ ] M6: OCR Processing completed and merged
- [ ] M7: Table Extraction completed and merged
- [ ] M8: Image Content Analysis completed and merged
- [ ] OCR accuracy >90% for clean scans
- [ ] Table structure preservation >85%
- [ ] Image description accuracy >80%
- [ ] Test coverage >=85% for advanced features

### Milestone Exit Criteria

Each milestone must pass these criteria before the next begins:

1. All deliverables completed per plan
2. Quality gates passed
3. Tests passing in CI
4. Code reviewed and merged
5. Documentation updated
6. No blocking bugs

### Release Readiness Checklist

Before Phase 6 release:

- [ ] All core milestones (M1-M5) complete
- [ ] Performance targets met
- [ ] Security review passed (no credential exposure)
- [ ] Documentation reviewed and published
- [ ] Migration path documented (if applicable)
- [ ] Rollback procedure documented
- [ ] Monitoring and alerting configured
- [ ] Team trained on new features

---

## Appendix A: PRD Reference Map

| PRD Section | Project Plan Section |
|-------------|---------------------|
| Section 4: Functional Requirements | Section 2: Scope |
| Section 5: Technical Requirements | Section 3: Resource Requirements |
| Section 10: Success Metrics | Section 6: Quality Gates |
| Section 11: Implementation Milestones | Section 4: Timeline |
| Section 12: Risks and Mitigations | Section 7: Risk Register |

## Appendix B: Related Documents

- [High-level Personal Knowledge MCP PRD](../High-level-Personal-Knowledge-MCP-PRD.md)
- [Phase 6 PRD](./Phase6-Document-Ingestion-PRD.md)
- [Phase 6 Roadmap](./Phase6-Roadmap.md)
- [Phase 6 GitHub Issues](./Phase6-GitHub-Issues.md)

---

*Document Version: 1.0*
*Created: January 18, 2026*
*Repository: sethb75/PersonalKnowledgeMCP*
