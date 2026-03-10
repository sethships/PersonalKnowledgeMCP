# Incremental Pipeline Document Support

## Overview

As of PR #522, the `IncrementalUpdatePipeline` supports document file ingestion
alongside code files. When a PDF, DOCX, or Markdown file is added, modified, or
renamed in a repository, the pipeline routes it through the document extraction
and chunking pipeline instead of the code-oriented `FileChunker`.

## How It Works

### Document Routing

The pipeline checks each file change against `DocumentTypeDetector.isDocument()`.
If a file is a document type (PDF, DOCX, Markdown, TXT), it follows the document path:

1. `DocumentTypeDetector.getExtractor(path)` selects the appropriate extractor
2. The extractor reads and parses the document (PDF text extraction, DOCX XML parsing, etc.)
3. `DocumentChunker.chunkDocument()` splits the extracted content into chunks
4. Chunks are converted to `InternalChunk` format with document-specific metadata

### Metadata Preserved

Document chunks include additional metadata fields in ChromaDB:

- `document_type`: The detected type (pdf, docx, markdown, txt)
- `document_title`: Title extracted from document metadata
- `document_author`: Author from document metadata
- `page_number`: Page number for multi-page PDFs
- `section_heading`: Section heading for structured documents

### Backward Compatibility

The `DocumentTypeDetector` and `DocumentChunker` are optional constructor parameters.
When not provided, the pipeline falls back to `FileChunker` for all files.

## Architecture Decision

Document files skip graph ingestion because they are not AST-parseable.
The knowledge graph only tracks code entities and their relationships.
