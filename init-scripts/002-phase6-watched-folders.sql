-- Personal Knowledge MCP - PostgreSQL Schema
-- Phase 6: Watched Folders Configuration
-- Migration: 002-phase6-watched-folders
--
-- This table stores configuration for the folder watching feature.
-- Each entry represents a folder being monitored for document changes.
-- Related: Issue #281, Epic #248 (M4: Folder Watching)

-- ============================================================================
-- Watched Folders Configuration Table
-- ============================================================================
-- Stores configuration for folders being watched for document changes.
-- Used by the FolderWatcherService to monitor local directories and
-- automatically ingest new/changed documents (PDFs, Word docs, etc.)

CREATE TABLE IF NOT EXISTS watched_folders (
    -- Primary identifier (UUID for distributed-safe IDs)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Absolute path to the watched folder (unique constraint ensures no duplicates)
    path VARCHAR(1024) NOT NULL UNIQUE,

    -- User-friendly display name for the folder
    name VARCHAR(255) NOT NULL,

    -- Whether watching is currently active for this folder
    enabled BOOLEAN NOT NULL DEFAULT true,

    -- Glob patterns for files to include (e.g., '*.pdf', '*.docx')
    -- NULL or empty array means include all supported file types
    include_patterns TEXT[],

    -- Glob patterns for files/directories to exclude (e.g., '.git/*', '*.tmp')
    -- NULL or empty array means no exclusions
    exclude_patterns TEXT[],

    -- Debounce delay in milliseconds before processing file changes
    -- Prevents rapid re-processing when files are being actively modified
    -- Valid range: 100ms minimum (practical debounce) to 300000ms (5 minutes max)
    debounce_ms INTEGER NOT NULL DEFAULT 2000 CHECK (debounce_ms >= 100 AND debounce_ms <= 300000),

    -- Timestamp when this folder configuration was created
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Timestamp of the last full scan of this folder
    -- NULL if folder has never been scanned
    last_scan_at TIMESTAMP WITH TIME ZONE,

    -- Cached count of files currently tracked in this folder
    -- Updated during scans, not a live count
    file_count INTEGER DEFAULT 0 CHECK (file_count >= 0),

    -- Timestamp when this configuration was last modified
    -- Updated by application code on any configuration change (name, patterns, enabled, etc.)
    updated_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Index for efficiently filtering enabled watchers (partial index)
-- Most queries will filter on enabled=true, so partial index is optimal
CREATE INDEX IF NOT EXISTS idx_watched_folders_enabled
ON watched_folders(enabled) WHERE enabled = true;

-- Note: path column already has implicit index via UNIQUE constraint

-- ============================================================================
-- Schema Version Tracking
-- ============================================================================

-- Update schema version tracking (idempotent)
INSERT INTO _schema_info (schema_version, description)
VALUES ('0.6.0-watched-folders', 'Phase 6: Add watched_folders table for folder watching configuration')
ON CONFLICT (schema_version) DO NOTHING;

-- ============================================================================
-- Usage Examples (for reference, not executed)
-- ============================================================================
--
-- Insert a new watched folder:
-- INSERT INTO watched_folders (path, name, include_patterns, exclude_patterns)
-- VALUES (
--     '/home/user/documents',
--     'My Documents',
--     ARRAY['*.pdf', '*.docx', '*.md'],
--     ARRAY['.git/*', '*.tmp', 'node_modules/*']
-- );
--
-- Query all enabled watchers:
-- SELECT * FROM watched_folders WHERE enabled = true;
--
-- Update last scan timestamp:
-- UPDATE watched_folders
-- SET last_scan_at = CURRENT_TIMESTAMP, file_count = 42
-- WHERE id = 'uuid-here';
--
-- Disable a watcher:
-- UPDATE watched_folders SET enabled = false WHERE path = '/some/path';
