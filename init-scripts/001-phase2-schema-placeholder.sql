-- Personal Knowledge MCP - PostgreSQL Schema Placeholder
-- Phase 2: Document Store
--
-- This file is a placeholder for the Phase 2 document store schema.
-- The actual schema will be implemented when Phase 2 development begins.
--
-- Planned tables (Phase 2):
-- - documents: Full file content storage with metadata
-- - document_versions: Version history for tracked files
-- - ingestion_logs: Detailed ingestion history per file
--
-- For now, just create a simple initialization marker.

-- Initialization marker table
CREATE TABLE IF NOT EXISTS _schema_info (
    id SERIAL PRIMARY KEY,
    schema_version VARCHAR(50) NOT NULL UNIQUE,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- Insert initialization record (idempotent - safe to run multiple times)
INSERT INTO _schema_info (schema_version, description)
VALUES ('0.0.1-placeholder', 'Initial schema placeholder for Phase 2 document store')
ON CONFLICT (schema_version) DO NOTHING;

-- Grant permissions (if needed for future app user)
-- Note: Actual role setup will be done in Phase 2
