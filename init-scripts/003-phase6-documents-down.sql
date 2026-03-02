-- Personal Knowledge MCP - PostgreSQL Schema
-- Phase 6: Document Metadata and Chunk Tracking (DOWN)
-- Migration: 003-phase6-documents-down
--
-- Reverses the 003-phase6-documents migration.
-- Drops document_chunks first (FK dependency on documents), then documents.
-- Related: Issue #368, Epic #248 (Phase 6: Unstructured Document Ingestion)

-- ============================================================================
-- Drop Tables (dependency order: chunks first, then documents)
-- ============================================================================

-- Drop document_chunks first (has FK reference to documents)
-- Note: Associated indexes (idx_chunks_document, idx_chunks_chromadb) are automatically dropped with the table.
DROP TABLE IF EXISTS document_chunks;

-- Note: Associated indexes (idx_documents_source, idx_documents_type, idx_documents_hash, idx_documents_status, idx_documents_source_status) are automatically dropped with the table.
-- Drop documents table
DROP TABLE IF EXISTS documents;

-- ============================================================================
-- Remove Schema Version Entry
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_schema_info') THEN
        DELETE FROM _schema_info WHERE schema_version = '0.6.1-documents';
    END IF;
END $$;
