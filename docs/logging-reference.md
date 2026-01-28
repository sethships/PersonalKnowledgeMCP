# Logging Reference

This document provides a comprehensive reference for the structured logging system used throughout the Personal Knowledge MCP project.

## Overview

The project uses **Pino** for structured JSON logging with comprehensive tracing capabilities. All log entries include standardized fields for filtering, searching, and correlation across distributed operations.

## Log Structure

### Common Fields

Every log entry includes these base fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `timestamp` | ISO 8601 string | When the log entry was created | `"2025-12-16T10:30:45.123Z"` |
| `level` | string | Log level (see below) | `"info"` |
| `component` | string | Component identifier using colon notation | `"services:github-client"` |
| `msg` | string | Human-readable message | `"Retrieved HEAD commit"` |

### Enhanced Fields (Update Operations)

Update operations include additional structured fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `correlationId` | string | Unique ID for tracing an update across components | `"update-1734367200-a3c9f"` |
| `operation` | string | Specific operation identifier | `"github_get_head_commit"` |
| `durationMs` | number | Operation duration in milliseconds | `145` |
| `statusCode` | number | HTTP status code (GitHub operations) | `200` |
| `rateLimit` | object | GitHub rate limit info | `{"remaining": 4999, "limit": 5000, "resetAt": "..."}` |
| `errorType` | string | Error class name for structured error handling | `"GitHubNotFoundError"` |

### Log Levels

Pino supports six log levels (in order of severity):

- **fatal (60)**: Application crash, immediate attention required
- **error (50)**: Operation failed, requires investigation
- **warn (40)**: Potential issues, degraded functionality
- **info (30)**: General operational messages (default)
- **debug (20)**: Detailed diagnostic information
- **trace (10)**: Very verbose, rarely used

## Component-Level Logging

### GitHubClient Operations

**Component**: `services:github-client`

#### Operation: `github_get_head_commit`

Fetches the HEAD commit from GitHub API.

**Debug Log (Start)**:
```json
{
  "level": "debug",
  "component": "services:github-client",
  "operation": "github_get_head_commit",
  "correlationId": "update-1734367200-a3c9f",
  "owner": "sethships",
  "repo": "PersonalKnowledgeMCP",
  "ref": "main",
  "msg": "Fetching HEAD commit"
}
```

**Info Log (Success)**:
```json
{
  "level": "info",
  "component": "services:github-client",
  "operation": "github_get_head_commit",
  "correlationId": "update-1734367200-a3c9f",
  "owner": "sethships",
  "repo": "PersonalKnowledgeMCP",
  "ref": "main",
  "sha": "d70cf09",
  "statusCode": 200,
  "rateLimit": {
    "remaining": 4999,
    "limit": 5000,
    "resetAt": "2025-12-16T11:30:00.000Z"
  },
  "durationMs": 145,
  "msg": "Retrieved HEAD commit"
}
```

**Error Log (Failure)**:
```json
{
  "level": "error",
  "component": "services:github-client",
  "operation": "github_get_head_commit",
  "correlationId": "update-1734367200-a3c9f",
  "owner": "sethships",
  "repo": "NonExistentRepo",
  "ref": "main",
  "error": "Resource not found: https://api.github.com/repos/...",
  "errorType": "GitHubNotFoundError",
  "durationMs": 89,
  "msg": "Failed to fetch HEAD commit"
}
```

#### Operation: `github_compare_commits`

Compares two commits and retrieves file changes.

**Info Log (Success)**:
```json
{
  "level": "info",
  "component": "services:github-client",
  "operation": "github_compare_commits",
  "correlationId": "update-1734367200-a3c9f",
  "owner": "sethships",
  "repo": "PersonalKnowledgeMCP",
  "base": "abc1234",
  "head": "def5678",
  "totalCommits": 3,
  "filesChanged": 12,
  "statusCode": 200,
  "rateLimit": {
    "remaining": 4998,
    "limit": 5000,
    "resetAt": "2025-12-16T11:30:00.000Z"
  },
  "durationMs": 234,
  "msg": "Compared commits"
}
```

### IncrementalUpdateCoordinator Operations

**Component**: `services:incremental-update-coordinator`

#### Operation: `coordinator_update_repository`

Orchestrates the complete incremental update workflow.

**Info Log (Start)**:
```json
{
  "level": "info",
  "component": "services:incremental-update-coordinator",
  "operation": "coordinator_update_repository",
  "correlationId": "update-1734367200-a3c9f",
  "repository": "PersonalKnowledgeMCP",
  "msg": "Starting incremental update"
}
```

**Info Log (Completion)**:
```json
{
  "level": "info",
  "component": "services:incremental-update-coordinator",
  "correlationId": "update-1734367200-a3c9f",
  "metric": "incremental_update_duration_ms",
  "value": 5432,
  "repository": "PersonalKnowledgeMCP",
  "status": "updated",
  "msg": "Incremental update completed"
}
```

**Error Log (Failure)**:
```json
{
  "level": "error",
  "component": "services:incremental-update-coordinator",
  "correlationId": "update-1734367200-a3c9f",
  "error": "Force push detected - base commit no longer exists",
  "repository": "PersonalKnowledgeMCP",
  "durationMs": 1234,
  "msg": "Incremental update failed"
}
```

### IncrementalUpdatePipeline Operations

**Component**: `services:incremental-update-pipeline`

#### Operation: `pipeline_process_changes`

Processes file changes through the update pipeline.

**Info Log (Start)**:
```json
{
  "level": "info",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_process_changes",
  "correlationId": "update-1734367200-a3c9f",
  "repository": "PersonalKnowledgeMCP",
  "totalChanges": 12,
  "collection": "repo_personalknowledgemcp",
  "msg": "Starting incremental update"
}
```

**Info Log (Completion)**:
```json
{
  "level": "info",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_process_changes",
  "correlationId": "update-1734367200-a3c9f",
  "status": "completed",
  "stats": {
    "filesAdded": 3,
    "filesModified": 8,
    "filesDeleted": 1,
    "chunksUpserted": 47,
    "chunksDeleted": 12,
    "durationMs": 3456
  },
  "errorCount": 0,
  "msg": "Incremental update completed"
}
```

#### Operation: `pipeline_filter_changes`

Filters file changes by extension and exclusion patterns.

**Debug Log**:
```json
{
  "level": "debug",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_filter_changes",
  "correlationId": "update-1734367200-a3c9f",
  "totalChanges": 15,
  "filteredChanges": 12,
  "skipped": 3,
  "msg": "Filtered changes by extension and exclusion patterns"
}
```

#### Operation: `pipeline_embed_chunks`

Generates embeddings for file chunks.

**Info Log**:
```json
{
  "level": "info",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_embed_chunks",
  "correlationId": "update-1734367200-a3c9f",
  "chunkCount": 47,
  "msg": "Generating embeddings for chunks"
}
```

#### Operation: `pipeline_embed_batch`

Processes a single batch of embeddings.

**Debug Log**:
```json
{
  "level": "debug",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_embed_batch",
  "correlationId": "update-1734367200-a3c9f",
  "batchIndex": 1,
  "batchCount": 3,
  "batchSize": 20,
  "msg": "Generating embeddings for batch"
}
```

**Debug Log (Completion)**:
```json
{
  "level": "debug",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_embed_batch",
  "correlationId": "update-1734367200-a3c9f",
  "batchIndex": 1,
  "durationMs": 543,
  "msg": "Batch embedding completed"
}
```

#### Operation: `pipeline_upsert_documents`

Upserts documents to ChromaDB.

**Info Log (Start)**:
```json
{
  "level": "info",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_upsert_documents",
  "correlationId": "update-1734367200-a3c9f",
  "documentCount": 47,
  "collection": "repo_personalknowledgemcp",
  "msg": "Upserting documents to ChromaDB"
}
```

**Info Log (Completion)**:
```json
{
  "level": "info",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_upsert_documents",
  "correlationId": "update-1734367200-a3c9f",
  "upsertedCount": 47,
  "durationMs": 234,
  "totalDurationMs": 3456,
  "msg": "Successfully upserted chunks to ChromaDB"
}
```

#### Operation: `pipeline_file_error`

Logs errors for individual file processing failures.

**Warn Log**:
```json
{
  "level": "warn",
  "component": "services:incremental-update-pipeline",
  "operation": "pipeline_file_error",
  "correlationId": "update-1734367200-a3c9f",
  "path": "src/broken.ts",
  "status": "modified",
  "error": "Failed to read file: ENOENT",
  "errorType": "Error",
  "msg": "Failed to process file change"
}
```

## Correlation ID Format

Correlation IDs follow the format: `update-{timestamp}-{shortHash}`

- **timestamp**: Unix epoch seconds (10 digits)
- **shortHash**: 5-character random hexadecimal string

**Example**: `update-1734367200-a3c9f`

This format ensures:
- Sortability by time
- Uniqueness within a reasonable timeframe
- Human readability
- Consistent length (24 characters)

## Secret Redaction

The logging system automatically redacts sensitive information using Pino's built-in redaction:

### Redacted Patterns

- OpenAI API keys: `sk-proj-...` or `sk-...`
- GitHub tokens:
  - Personal Access Tokens: `ghp_...`
  - OAuth tokens: `gho_...`
  - User-to-server: `ghu_...`
  - Server-to-server: `ghs_...`
  - Refresh tokens: `ghr_...`
  - Fine-grained: `github_pat_...`
- JWT tokens in Authorization headers
- Generic API keys (32+ characters)
- Password fields
- Secret fields

### Redaction Paths

Automatic redaction applies to these JSON paths:
- `env.OPENAI_API_KEY`
- `env.GITHUB_PAT`
- `headers.authorization`
- `*.apiKey`
- `*.token`
- `*.password`
- `*.secret`

All redacted values are replaced with `[REDACTED]`.

## Querying Logs

### Filter by Correlation ID

To trace a single update operation:

```bash
# Using jq
cat logs.json | jq 'select(.correlationId == "update-1734367200-a3c9f")'

# Using grep
grep "update-1734367200-a3c9f" logs.json
```

### Filter by Operation

To find all GitHub API calls:

```bash
cat logs.json | jq 'select(.operation | startswith("github_"))'
```

### Filter by Component

To see all pipeline operations:

```bash
cat logs.json | jq 'select(.component == "services:incremental-update-pipeline")'
```

### Find Errors by Type

To find all rate limit errors:

```bash
cat logs.json | jq 'select(.errorType == "GitHubRateLimitError")'
```

### Analyze Performance

To find slow operations (>1 second):

```bash
cat logs.json | jq 'select(.durationMs > 1000) | {operation, durationMs, correlationId}'
```

## Performance Metrics

### Metric Logs

Special log entries with `metric` field track performance:

```json
{
  "level": "info",
  "component": "services:incremental-update-coordinator",
  "correlationId": "update-1734367200-a3c9f",
  "metric": "incremental_update_duration_ms",
  "value": 5432,
  "repository": "PersonalKnowledgeMCP",
  "status": "updated",
  "msg": "Incremental update completed"
}
```

### Key Metrics

- `incremental_update_duration_ms`: Total update workflow duration
- `chromadb.connection_ms`: ChromaDB connection time
- `metadata.list_ms`: Repository metadata list operation

### Graph Query Metrics

Graph query performance is tracked in memory and exposed via the `get_graph_metrics` MCP tool. Metrics are collected for each graph query execution at the GraphService level.

#### Logged Fields for Graph Queries

**Component**: `services:graph`

**Info Log (Success)**:
```json
{
  "level": "info",
  "component": "services:graph",
  "entity_type": "file",
  "entity_path": "src/services/auth.ts",
  "repository": "my-project",
  "dependencies_count": 12,
  "query_time_ms": 145,
  "msg": "getDependencies completed"
}
```

#### Neo4j Client Metrics

**Component**: `graph:neo4j` (debug level)

| Metric | Description |
|--------|-------------|
| `neo4j.query_ms` | Raw Cypher query execution time |
| `neo4j.traverse_ms` | Graph traversal duration |
| `neo4j.analyze_dependencies_ms` | Dependency analysis duration |
| `neo4j.upsert_node_ms` | Node creation/update duration |
| `neo4j.create_relationship_ms` | Relationship creation duration |

#### Aggregated Graph Metrics

Use the `get_graph_metrics` MCP tool to retrieve aggregated statistics:

```json
{
  "success": true,
  "metrics": {
    "totalQueries": 450,
    "averageDurationMs": 135.8,
    "cacheHitRate": 0.38,
    "byQueryType": [
      {
        "queryType": "getDependencies",
        "totalQueries": 150,
        "averageDurationMs": 125.5,
        "maxDurationMs": 890,
        "minDurationMs": 15,
        "cacheHitRate": 0.42,
        "averageResultCount": 8.3,
        "errorCount": 2
      }
    ],
    "last7DaysTrend": {
      "queryCount": 85,
      "averageDurationMs": 118.2,
      "cacheHitRate": 0.45
    }
  }
}
```

#### Query Types Tracked

- `getDependencies`: Forward dependency queries
- `getDependents`: Reverse dependency (impact) queries
- `getPath`: Path finding between entities
- `getArchitecture`: Repository structure queries

## Log Output Formats

### Development (Pretty Print)

In development, logs use `pino-pretty` for readable output:

```
[10:30:45.123] INFO (services:github-client): Retrieved HEAD commit
    correlationId: "update-1734367200-a3c9f"
    operation: "github_get_head_commit"
    owner: "sethships"
    repo: "PersonalKnowledgeMCP"
    sha: "d70cf09"
    statusCode: 200
    durationMs: 145
```

### Production (JSON)

In production, logs output as newline-delimited JSON for machine processing:

```json
{"level":"info","time":"2025-12-16T10:30:45.123Z","component":"services:github-client","correlationId":"update-1734367200-a3c9f","operation":"github_get_head_commit","owner":"sethships","repo":"PersonalKnowledgeMCP","sha":"d70cf09","statusCode":200,"durationMs":145,"msg":"Retrieved HEAD commit"}
```

## Best Practices

1. **Always include correlationId** when available to enable tracing
2. **Use structured fields** instead of interpolating values into messages
3. **Include durationMs** for any operation >100ms
4. **Log at appropriate levels**:
   - Use `debug` for detailed diagnostic info
   - Use `info` for significant operational events
   - Use `warn` for recoverable issues
   - Use `error` for operation failures
5. **Include errorType** for all error logs to enable categorization
6. **Add operation identifiers** for all major operations
7. **Never log secrets** - rely on automatic redaction but be defensive

## Example: Tracing a Complete Update

Here's what a complete update operation looks like in logs:

```json
// 1. Coordinator starts
{"level":"info","component":"services:incremental-update-coordinator","operation":"coordinator_update_repository","correlationId":"update-1734367200-a3c9f","repository":"PersonalKnowledgeMCP","msg":"Starting incremental update"}

// 2. Fetch HEAD commit
{"level":"info","component":"services:github-client","operation":"github_get_head_commit","correlationId":"update-1734367200-a3c9f","owner":"sethships","repo":"PersonalKnowledgeMCP","sha":"d70cf09","statusCode":200,"rateLimit":{"remaining":4999,"limit":5000},"durationMs":145,"msg":"Retrieved HEAD commit"}

// 3. Compare commits
{"level":"info","component":"services:github-client","operation":"github_compare_commits","correlationId":"update-1734367200-a3c9f","owner":"sethships","repo":"PersonalKnowledgeMCP","totalCommits":3,"filesChanged":12,"statusCode":200,"durationMs":234,"msg":"Compared commits"}

// 4. Pipeline starts
{"level":"info","component":"services:incremental-update-pipeline","operation":"pipeline_process_changes","correlationId":"update-1734367200-a3c9f","repository":"PersonalKnowledgeMCP","totalChanges":12,"msg":"Starting incremental update"}

// 5. Generate embeddings
{"level":"info","component":"services:incremental-update-pipeline","operation":"pipeline_embed_chunks","correlationId":"update-1734367200-a3c9f","chunkCount":47,"msg":"Generating embeddings for chunks"}

// 6. Upsert to ChromaDB
{"level":"info","component":"services:incremental-update-pipeline","operation":"pipeline_upsert_documents","correlationId":"update-1734367200-a3c9f","documentCount":47,"durationMs":234,"msg":"Successfully upserted chunks to ChromaDB"}

// 7. Pipeline completes
{"level":"info","component":"services:incremental-update-pipeline","operation":"pipeline_process_changes","correlationId":"update-1734367200-a3c9f","status":"completed","stats":{"filesAdded":3,"filesModified":8,"filesDeleted":1,"chunksUpserted":47,"chunksDeleted":12},"msg":"Incremental update completed"}

// 8. Coordinator completes
{"level":"info","component":"services:incremental-update-coordinator","correlationId":"update-1734367200-a3c9f","metric":"incremental_update_duration_ms","value":5432,"repository":"PersonalKnowledgeMCP","status":"updated","msg":"Incremental update completed"}
```

All these entries share the same `correlationId`, making it easy to trace the complete operation from start to finish.
