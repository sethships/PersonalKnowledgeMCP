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
DROP TABLE IF EXISTS document_chunks;

-- Drop documents table
DROP TABLE IF EXISTS documents;

-- ============================================================================
-- Remove Schema Version Entry
-- ============================================================================

DELETE FROM _schema_info WHERE schema_version = '0.6.1-documents';
