-- Personal Knowledge MCP - PostgreSQL Schema
-- Phase 6: Document Metadata and Chunk Tracking
-- Migration: 003-phase6-documents
--
-- Stores metadata and processing state for ingested documents.
-- Source files remain on the filesystem as source of truth; this table
-- tracks metadata, processing status, and links to ChromaDB vector entries.
-- Related: Issue #368, Epic #248 (Phase 6: Unstructured Document Ingestion)

-- ============================================================================
-- Documents Table
-- ============================================================================
-- Stores metadata and processing state for each ingested document.
-- One row per unique (source_id, file_path) combination.
-- source_id references a watched folder identifier from watched_folders.

CREATE TABLE IF NOT EXISTS documents (
    -- Primary identifier (UUID for distributed-safe IDs)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Watched folder identifier linking to the source of this document
    source_id VARCHAR(255) NOT NULL,

    -- Relative path to the source file within the watched folder
    file_path VARCHAR(1024) NOT NULL,

    -- Full absolute path for direct filesystem access
    absolute_path VARCHAR(2048),

    -- Document type classifier (pdf, docx, markdown, image)
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('pdf', 'docx', 'markdown', 'image')),

    -- Title extracted from document metadata or content
    title VARCHAR(512),

    -- Author extracted from document metadata
    author VARCHAR(255),

    -- Document creation date from file/document metadata
    created_at TIMESTAMP WITH TIME ZONE,

    -- Number of pages (multi-page documents like PDFs)
    page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),

    -- Approximate word count of extracted text
    word_count INTEGER CHECK (word_count IS NULL OR word_count >= 0),

    -- Table of contents or heading hierarchy as structured JSON
    toc_structure JSONB,

    -- Number of logical sections in the document
    section_count INTEGER CHECK (section_count IS NULL OR section_count >= 0),

    -- Image-specific: width in pixels
    image_width INTEGER CHECK (image_width IS NULL OR image_width > 0),

    -- Image-specific: height in pixels
    image_height INTEGER CHECK (image_height IS NULL OR image_height > 0),

    -- Image-specific: format identifier (e.g., 'jpeg', 'png', 'webp')
    image_format VARCHAR(50),

    -- EXIF metadata from images as structured JSON
    exif_data JSONB,

    -- AI-generated description of image content
    content_description TEXT,

    -- File size in bytes for change detection
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),

    -- SHA-256 hash of file content for deduplication and change detection
    content_hash VARCHAR(64) NOT NULL,

    -- Last modified timestamp of the file on disk
    file_modified_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- When this document was indexed into the system
    indexed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Current processing status
    processing_status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (processing_status IN ('pending', 'processing', 'indexed', 'error')),

    -- Error message if processing_status = 'error'
    processing_error TEXT,

    -- Number of chunks stored in ChromaDB for this document
    chunk_count INTEGER DEFAULT 0 CHECK (chunk_count IS NULL OR chunk_count >= 0),

    -- Whether OCR was applied during text extraction
    ocr_processed BOOLEAN DEFAULT FALSE,

    -- Average OCR confidence score (0.00 to 100.00)
    ocr_confidence NUMERIC(5,2) CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 100)),

    -- Timestamp when this record was last modified
    -- Updated by application code on any metadata or status change
    updated_at TIMESTAMP WITH TIME ZONE,

    -- No duplicate file tracking within the same source
    UNIQUE (source_id, file_path)
);

-- ============================================================================
-- Document Chunks Table
-- ============================================================================
-- Links documents to their ChromaDB vector entries for efficient cleanup
-- and cross-referencing. One row per chunk extracted from a document.

CREATE TABLE IF NOT EXISTS document_chunks (
    -- Primary identifier (UUID for distributed-safe IDs)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Reference to the parent document
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

    -- Reference to the corresponding ChromaDB vector entry
    chromadb_id VARCHAR(255) NOT NULL,

    -- Ordinal position of this chunk within the document (0-based)
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),

    -- Character offset where this chunk starts in the extracted text
    start_offset INTEGER CHECK (start_offset IS NULL OR start_offset >= 0),

    -- Character offset where this chunk ends in the extracted text
    end_offset INTEGER CHECK (end_offset IS NULL OR end_offset >= 0),

    -- Page number this chunk originated from (for PDFs)
    page_number INTEGER CHECK (page_number IS NULL OR page_number >= 0),

    -- Nearest section heading for context when retrieving this chunk
    section_heading VARCHAR(512),

    -- No duplicate chunks for the same document
    UNIQUE (document_id, chunk_index)
);

-- ============================================================================
-- Indexes: Documents
-- ============================================================================

-- Filter documents by watched folder source
CREATE INDEX IF NOT EXISTS idx_documents_source
ON documents(source_id);

-- Filter documents by type (pdf, docx, markdown, image)
CREATE INDEX IF NOT EXISTS idx_documents_type
ON documents(document_type);

-- Deduplication lookups by content hash
CREATE INDEX IF NOT EXISTS idx_documents_hash
ON documents(content_hash);

-- Processing queue queries (find pending/error documents)
CREATE INDEX IF NOT EXISTS idx_documents_status
ON documents(processing_status);

-- Combined filter for source + status (common query pattern)
CREATE INDEX IF NOT EXISTS idx_documents_source_status
ON documents(source_id, processing_status);

-- ============================================================================
-- Indexes: Document Chunks
-- ============================================================================

-- Join from chunks back to documents
CREATE INDEX IF NOT EXISTS idx_chunks_document
ON document_chunks(document_id);

-- Lookup chunk by ChromaDB vector ID
CREATE INDEX IF NOT EXISTS idx_chunks_chromadb
ON document_chunks(chromadb_id);

-- ============================================================================
-- Schema Version Tracking
-- ============================================================================

-- Update schema version tracking (idempotent)
INSERT INTO _schema_info (schema_version, description)
VALUES ('0.6.1-documents', 'Phase 6: Add documents and document_chunks tables for document metadata and chunk tracking')
ON CONFLICT (schema_version) DO NOTHING;

-- ============================================================================
-- Usage Examples (for reference, not executed)
-- ============================================================================
--
-- Insert a new document:
-- INSERT INTO documents (source_id, file_path, absolute_path, document_type, file_size_bytes, content_hash, file_modified_at)
-- VALUES (
--     'watched-folder-uuid',
--     'notes/chapter1.pdf',
--     '/home/user/documents/notes/chapter1.pdf',
--     'pdf',
--     1048576,
--     'a1b2c3d4e5f6...',
--     '2026-01-15T10:30:00Z'
-- );
--
-- Insert a chunk reference:
-- INSERT INTO document_chunks (document_id, chromadb_id, chunk_index, start_offset, end_offset, page_number, section_heading)
-- VALUES (
--     'document-uuid',
--     'chromadb-vector-id',
--     0,
--     0,
--     1500,
--     1,
--     'Introduction'
-- );
--
-- Find all pending documents for a source:
-- SELECT * FROM documents WHERE source_id = 'uuid' AND processing_status = 'pending';
--
-- Get all chunks for a document in order:
-- SELECT * FROM document_chunks WHERE document_id = 'uuid' ORDER BY chunk_index;
--
-- Find documents by content hash (deduplication):
-- SELECT * FROM documents WHERE content_hash = 'sha256-hash';
