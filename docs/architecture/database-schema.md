# Personal Knowledge MCP - PostgreSQL Database Schema

This document describes the PostgreSQL database schema used by Personal Knowledge MCP for document storage and configuration management.

## Overview

PostgreSQL serves as the document store for:
- **Configuration Data**: Watched folder settings, ingestion preferences
- **Document Metadata**: File tracking, version history (future)
- **Schema Management**: Migration tracking and versioning

## Connection Details

| Parameter | Default Value | Environment Variable |
|-----------|---------------|---------------------|
| Host | localhost | - |
| Port | 5432 | - |
| Database | personal_knowledge | `POSTGRES_DB` |
| User | pk_mcp | `POSTGRES_USER` |
| Password | (required) | `POSTGRES_PASSWORD` |

## Tables

### `_schema_info`

**Purpose**: Tracks applied database migrations for version control and idempotent deployments.

**Migration**: `001-phase2-schema-placeholder.sql`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing identifier |
| `schema_version` | VARCHAR(50) | NOT NULL, UNIQUE | Version identifier (e.g., '0.6.0-watched-folders') |
| `applied_at` | TIMESTAMP WITH TIME ZONE | DEFAULT CURRENT_TIMESTAMP | When the migration was applied |
| `description` | TEXT | - | Human-readable description of the migration |

**Usage Patterns**:
```sql
-- Check current schema version
SELECT schema_version, applied_at, description
FROM _schema_info
ORDER BY applied_at DESC
LIMIT 1;

-- Verify specific migration was applied
SELECT EXISTS(
    SELECT 1 FROM _schema_info
    WHERE schema_version = '0.6.0-watched-folders'
);
```

---

### `watched_folders`

**Purpose**: Stores configuration for the folder watching feature. Each entry represents a local folder being monitored for document changes (PDFs, Word documents, etc.).

**Migration**: `002-phase6-watched-folders.sql`

**Related**: Issue #281, Epic #248 (M4: Folder Watching)

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `path` | VARCHAR(1024) | NOT NULL, UNIQUE | - | Absolute filesystem path to watched folder |
| `name` | VARCHAR(255) | NOT NULL | - | User-friendly display name |
| `enabled` | BOOLEAN | NOT NULL | `true` | Whether watching is active |
| `include_patterns` | TEXT[] | - | NULL | Glob patterns to include (e.g., `['*.pdf', '*.docx']`) |
| `exclude_patterns` | TEXT[] | - | NULL | Glob patterns to exclude (e.g., `['.git/*', '*.tmp']`) |
| `debounce_ms` | INTEGER | NOT NULL, CHECK (100-300000) | `2000` | Debounce delay in milliseconds (100ms-5min) |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL | `CURRENT_TIMESTAMP` | When folder was registered |
| `last_scan_at` | TIMESTAMP WITH TIME ZONE | - | NULL | Last full scan timestamp |
| `file_count` | INTEGER | CHECK (>= 0) | `0` | Cached count of tracked files |
| `updated_at` | TIMESTAMP WITH TIME ZONE | - | NULL | When configuration was last modified |

**Indexes**:

| Index Name | Columns | Type | Notes |
|------------|---------|------|-------|
| `watched_folders_pkey` | `id` | PRIMARY KEY | Implicit |
| `watched_folders_path_key` | `path` | UNIQUE | Implicit unique constraint |
| `idx_watched_folders_enabled` | `enabled` | PARTIAL (WHERE enabled = true) | Optimizes active watcher queries |

**Usage Patterns**:

```sql
-- Add a new watched folder
INSERT INTO watched_folders (path, name, include_patterns, exclude_patterns)
VALUES (
    '/home/user/documents',
    'My Documents',
    ARRAY['*.pdf', '*.docx', '*.md'],
    ARRAY['.git/*', '*.tmp', 'node_modules/*']
)
RETURNING *;

-- List all enabled watchers
SELECT id, name, path, file_count, last_scan_at
FROM watched_folders
WHERE enabled = true
ORDER BY name;

-- Update after a scan
UPDATE watched_folders
SET last_scan_at = CURRENT_TIMESTAMP,
    file_count = 42
WHERE id = 'uuid-here';

-- Disable a watcher
UPDATE watched_folders
SET enabled = false
WHERE path = '/some/path';

-- Find folders that haven't been scanned recently
SELECT * FROM watched_folders
WHERE enabled = true
  AND (last_scan_at IS NULL OR last_scan_at < NOW() - INTERVAL '1 day');
```

**CLI Commands** (planned):

| Command | Description |
|---------|-------------|
| `pk-mcp watch add <path>` | Add a folder to watch |
| `pk-mcp watch remove <path>` | Remove a watched folder |
| `pk-mcp watch list` | List all watched folders |
| `pk-mcp watch enable <path>` | Enable watching for a folder |
| `pk-mcp watch disable <path>` | Disable watching for a folder |
| `pk-mcp watch scan <path>` | Trigger manual scan of a folder |

---

## Future Tables (Planned)

The following tables are planned for future phases:

### Phase 6: Document Ingestion

- **`documents`**: Full document content storage with metadata
- **`document_versions`**: Version history for tracked files
- **`ingestion_logs`**: Detailed ingestion history per file

### Phase 4 Enterprise (Framework Ready)

- **`users`**: OIDC user mapping for multi-tenant access
- **`user_instance_access`**: User-to-instance permissions

---

## Migration Strategy

### Naming Convention

Migration files follow the pattern: `NNN-phaseN-description.sql`

- `001-phase2-schema-placeholder.sql` - Initial schema setup
- `002-phase6-watched-folders.sql` - Folder watching configuration

### Idempotency

All migrations are idempotent and safe to run multiple times:

- `CREATE TABLE IF NOT EXISTS` for table creation
- `CREATE INDEX IF NOT EXISTS` for index creation
- `ON CONFLICT DO NOTHING` for seed data

### Version Tracking

Each migration inserts a record into `_schema_info`:

```sql
INSERT INTO _schema_info (schema_version, description)
VALUES ('0.6.0-watched-folders', 'Description here')
ON CONFLICT (schema_version) DO NOTHING;
```

### Running Migrations

Migrations run automatically when the PostgreSQL container starts:

```bash
# Start PostgreSQL (migrations auto-apply)
docker compose --profile default up -d postgres

# Verify migrations
docker exec pk-mcp-postgres psql -U pk_mcp -d personal_knowledge -c \
    "SELECT * FROM _schema_info ORDER BY applied_at;"
```

### Manual Migration

To apply migrations manually:

```bash
docker exec pk-mcp-postgres psql -U pk_mcp -d personal_knowledge \
    -f /docker-entrypoint-initdb.d/002-phase6-watched-folders.sql
```

---

## Data Types Reference

### PostgreSQL Array Types

The `include_patterns` and `exclude_patterns` columns use PostgreSQL's native array type:

```sql
-- Insert with array
INSERT INTO watched_folders (path, name, include_patterns)
VALUES ('/path', 'Name', ARRAY['*.pdf', '*.docx']);

-- Query array contains
SELECT * FROM watched_folders
WHERE '*.pdf' = ANY(include_patterns);

-- Expand array in query
SELECT path, UNNEST(include_patterns) as pattern
FROM watched_folders;
```

### UUID Generation

PostgreSQL 13+ includes `gen_random_uuid()` natively:

```sql
-- Generate UUID
SELECT gen_random_uuid();
-- Result: 550e8400-e29b-41d4-a716-446655440000
```

### Timestamp with Time Zone

All timestamps use `TIMESTAMP WITH TIME ZONE` for:
- Consistent handling across time zones
- Proper sorting and comparison
- Compatibility with JavaScript Date objects

```sql
-- Current timestamp
SELECT CURRENT_TIMESTAMP;
-- Result: 2026-01-27 10:30:00.123456+00

-- Compare timestamps
SELECT * FROM watched_folders
WHERE last_scan_at > NOW() - INTERVAL '1 hour';
```
