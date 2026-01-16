# MCP Tools API Reference

Complete API reference for all Model Context Protocol (MCP) tools provided by Personal Knowledge MCP.

## Table of Contents

- [Overview](#overview)
- [Core Tools](#core-tools)
  - [semantic_search](#semantic_search)
  - [list_indexed_repositories](#list_indexed_repositories)
- [Graph Tools](#graph-tools)
  - [get_dependencies](#get_dependencies)
  - [get_dependents](#get_dependents)
  - [get_architecture](#get_architecture)
  - [find_path](#find_path)
  - [get_graph_metrics](#get_graph_metrics)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)

---

## Overview

Personal Knowledge MCP exposes tools via the Model Context Protocol that enable AI assistants like Claude Code to search code semantically and analyze code dependencies.

### Tool Categories

| Category | Tools | Requires |
|----------|-------|----------|
| **Core** | `semantic_search`, `list_indexed_repositories` | ChromaDB |
| **Graph** | `get_dependencies`, `get_dependents`, `get_architecture`, `find_path`, `get_graph_metrics` | Neo4j |

### Common Response Format

All tools return JSON-formatted text content:

```json
{
  "results": [...],
  "metadata": {
    "query_time_ms": 45,
    ...
  }
}
```

Errors return:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Error: <message>" }]
}
```

---

## Core Tools

### semantic_search

Performs semantic search across indexed code repositories using vector similarity.

#### Description

Search indexed repositories using natural language queries. Returns relevant code chunks with metadata including file paths, similarity scores, and repository information.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Natural language search query (1-1000 characters) |
| `limit` | number | No | `10` | Maximum results to return (1-50) |
| `threshold` | number | No | `0.7` | Minimum similarity score (0.0-1.0) |
| `repository` | string | No | - | Filter to specific repository name |

#### Example Requests

**Basic search:**
```json
{
  "query": "JWT authentication middleware"
}
```

**Search with parameters:**
```json
{
  "query": "error handling in API routes",
  "limit": 5,
  "threshold": 0.8,
  "repository": "my-api"
}
```

#### Response Schema

```json
{
  "results": [
    {
      "content": "<code snippet>",
      "similarity_score": 0.89,
      "metadata": {
        "file_path": "src/auth/middleware.ts",
        "repository": "my-api",
        "chunk_index": 3,
        "file_extension": ".ts",
        "file_size_bytes": 4523,
        "indexed_at": "2026-01-15T10:30:00Z"
      }
    }
  ],
  "metadata": {
    "total_matches": 1,
    "query_time_ms": 145,
    "embedding_time_ms": 45,
    "search_time_ms": 100,
    "repositories_searched": ["my-api"]
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `results[].content` | string | Code snippet matching the query |
| `results[].similarity_score` | number | Similarity score (0.0-1.0) |
| `results[].metadata.file_path` | string | Relative path from repository root |
| `results[].metadata.repository` | string | Repository name |
| `results[].metadata.chunk_index` | number | Chunk position within file |
| `results[].metadata.file_extension` | string | File extension (e.g., ".ts") |
| `results[].metadata.file_size_bytes` | number | Original file size |
| `results[].metadata.indexed_at` | string | ISO 8601 indexing timestamp |
| `metadata.total_matches` | number | Number of results returned |
| `metadata.query_time_ms` | number | Total query time |
| `metadata.embedding_time_ms` | number | Time to generate query embedding |
| `metadata.search_time_ms` | number | Time for vector search |
| `metadata.repositories_searched` | array | Repositories included in search |

#### Performance

- Target: < 500ms (p95)
- Typical: 100-300ms

---

### list_indexed_repositories

Lists all repositories currently indexed in the knowledge base.

#### Description

Returns repository names, URLs, indexing status, file and chunk counts, last indexed timestamps, and summary statistics.

#### Parameters

None required.

#### Example Request

```json
{}
```

#### Response Schema

```json
{
  "repositories": [
    {
      "name": "my-api",
      "url": "https://github.com/user/my-api.git",
      "collection_name": "repo_my-api",
      "file_count": 156,
      "chunk_count": 1234,
      "last_indexed": "2026-01-15T10:30:00Z",
      "status": "ready",
      "index_duration_ms": 45000
    }
  ],
  "summary": {
    "total_repositories": 1,
    "total_files_indexed": 156,
    "total_chunks": 1234
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `repositories[].name` | string | Repository identifier |
| `repositories[].url` | string | Git clone URL |
| `repositories[].collection_name` | string | ChromaDB collection name |
| `repositories[].file_count` | number | Number of files indexed |
| `repositories[].chunk_count` | number | Total chunks created |
| `repositories[].last_indexed` | string | ISO 8601 timestamp |
| `repositories[].status` | string | `"ready"`, `"indexing"`, or `"error"` |
| `repositories[].index_duration_ms` | number | Last indexing duration |
| `repositories[].error_message` | string | Error details (if status is "error") |
| `summary.total_repositories` | number | Repository count |
| `summary.total_files_indexed` | number | Sum of all files |
| `summary.total_chunks` | number | Sum of all chunks |

#### Performance

- Target: < 100ms
- Typical: 20-50ms

---

## Graph Tools

Graph tools require Neo4j to be running and populated with repository data.

> **Prerequisites**: See [Neo4j Setup Guide](neo4j-setup.md) and [Graph Tools Guide](graph-tools.md).

### get_dependencies

Get all dependencies of a file, function, or class.

#### Description

Returns what the entity imports, calls, or extends. Use this to understand what code relies on before making changes or to explore codebase structure.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entity_type` | string | Yes | - | `"file"`, `"function"`, or `"class"` |
| `entity_path` | string | Yes | - | Entity identifier (see below) |
| `repository` | string | Yes | - | Repository name |
| `depth` | integer | No | `1` | Transitive dependency depth (1-5) |
| `relationship_types` | array | No | all | Filter: `["imports", "calls", "extends", "implements", "references"]` |

**Entity Path Format:**
- Files: `"src/auth/middleware.ts"`
- Functions: `"validateToken"` or `"src/auth/middleware.ts::validateToken"`
- Classes: `"AuthService"` or `"src/auth/service.ts::AuthService"`

#### Example Requests

**Get file imports:**
```json
{
  "entity_type": "file",
  "entity_path": "src/services/auth.ts",
  "repository": "my-api"
}
```

**Get transitive dependencies:**
```json
{
  "entity_type": "file",
  "entity_path": "src/services/auth.ts",
  "repository": "my-api",
  "depth": 2,
  "relationship_types": ["imports"]
}
```

**Get class inheritance:**
```json
{
  "entity_type": "class",
  "entity_path": "AuthService",
  "repository": "my-api",
  "relationship_types": ["extends", "implements"]
}
```

#### Response Schema

```json
{
  "entity": {
    "type": "file",
    "path": "src/services/auth.ts",
    "repository": "my-api"
  },
  "dependencies": [
    {
      "type": "file",
      "path": "src/utils/jwt.ts",
      "relationship": "imports",
      "depth": 1,
      "metadata": {
        "line_number": 3
      }
    },
    {
      "type": "package",
      "path": "jsonwebtoken",
      "relationship": "imports",
      "depth": 1,
      "metadata": {
        "external": true
      }
    }
  ],
  "metadata": {
    "total_count": 2,
    "query_time_ms": 45,
    "max_depth_reached": 1
  }
}
```

#### Performance

- Direct (depth=1): < 100ms
- Transitive (depth=2-3): < 300ms

---

### get_dependents

Get all code that depends on a file, function, or class.

#### Description

Returns what imports, calls, or extends the entity. Use this for impact analysis before refactoring.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entity_type` | string | Yes | - | `"file"`, `"function"`, `"class"`, or `"package"` |
| `entity_path` | string | Yes | - | Entity identifier |
| `repository` | string | No | all | Repository name (omit to search all) |
| `depth` | integer | No | `1` | Transitive dependent depth (1-5) |
| `include_cross_repo` | boolean | No | `false` | Include dependents from other repositories |

#### Example Requests

**Find files importing a utility:**
```json
{
  "entity_type": "file",
  "entity_path": "src/utils/validation.ts",
  "repository": "my-api"
}
```

**Cross-repository impact analysis:**
```json
{
  "entity_type": "function",
  "entity_path": "validateToken",
  "include_cross_repo": true,
  "depth": 2
}
```

#### Response Schema

```json
{
  "entity": {
    "type": "function",
    "path": "validateToken",
    "repository": "my-api"
  },
  "dependents": [
    {
      "type": "file",
      "path": "src/middleware/auth.ts",
      "repository": "my-api",
      "relationship": "calls",
      "depth": 1,
      "metadata": {
        "line_number": 42
      }
    }
  ],
  "impact_analysis": {
    "direct_impact_count": 1,
    "transitive_impact_count": 3,
    "impact_score": 0.35
  },
  "metadata": {
    "total_count": 4,
    "query_time_ms": 67,
    "repositories_searched": ["my-api"]
  }
}
```

#### Impact Score Interpretation

| Score Range | Risk Level | Recommendation |
|-------------|------------|----------------|
| 0.0 - 0.2 | Low | Safe to refactor |
| 0.2 - 0.5 | Moderate | Plan carefully |
| 0.5 - 0.8 | High | Comprehensive testing needed |
| 0.8 - 1.0 | Critical | Consider incremental changes |

#### Performance

- Single repository: < 200ms
- Cross-repository: < 500ms

---

### get_architecture

Get the architectural structure of a repository.

#### Description

Returns hierarchical organization and inter-module dependencies. Use this to understand codebase organization, module boundaries, and high-level structure.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `repository` | string | Yes | - | Repository name |
| `detail_level` | string | Yes | - | `"packages"`, `"modules"`, `"files"`, or `"entities"` |
| `scope` | string | No | - | Focus on specific package/directory |
| `include_external` | boolean | No | `false` | Include external dependencies |

**Detail Levels:**
- `packages`: High-level package structure
- `modules`: Packages with internal modules
- `files`: Full file listing
- `entities`: Individual functions and classes

#### Example Requests

**High-level architecture:**
```json
{
  "repository": "my-api",
  "detail_level": "packages"
}
```

**Focus on specific directory:**
```json
{
  "repository": "my-api",
  "detail_level": "modules",
  "scope": "src/services"
}
```

#### Response Schema

```json
{
  "repository": "my-api",
  "root": {
    "name": "src",
    "type": "directory",
    "children": [
      {
        "name": "services",
        "type": "package",
        "file_count": 12,
        "children": [...]
      }
    ]
  },
  "module_dependencies": [
    {
      "from": "src/services",
      "to": "src/utils",
      "relationship_count": 15
    }
  ],
  "metadata": {
    "total_packages": 5,
    "total_files": 156,
    "query_time_ms": 120
  }
}
```

#### Performance

- Packages: < 200ms
- Full files: < 1000ms

---

### find_path

Find the connection path between two code entities.

#### Description

Returns the chain of relationships linking two entities. Use this to trace execution flow or understand how components are connected.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `from_entity` | string | Yes | - | Starting entity (e.g., `"src/routes/api.ts::handleLogin"`) |
| `to_entity` | string | Yes | - | Target entity (e.g., `"src/db/users.ts::findUser"`) |
| `repository` | string | Yes | - | Repository name |
| `max_hops` | integer | No | `10` | Maximum path length (1-20) |
| `relationship_types` | array | No | all | Limit to specific relationship types |

#### Example Request

```json
{
  "from_entity": "src/routes/api.ts::handleLogin",
  "to_entity": "src/db/users.ts::findUser",
  "repository": "my-api",
  "max_hops": 5
}
```

#### Response Schema

```json
{
  "path_exists": true,
  "path": [
    {
      "type": "function",
      "identifier": "src/routes/api.ts::handleLogin",
      "repository": "my-api",
      "relationship_to_next": "CALLS"
    },
    {
      "type": "function",
      "identifier": "src/services/auth.ts::authenticate",
      "repository": "my-api",
      "relationship_to_next": "CALLS"
    },
    {
      "type": "function",
      "identifier": "src/db/users.ts::findUser",
      "repository": "my-api",
      "relationship_to_next": null
    }
  ],
  "metadata": {
    "hops": 2,
    "query_time_ms": 85
  }
}
```

#### Response When No Path Found

```json
{
  "path_exists": false,
  "path": null,
  "metadata": {
    "hops": 0,
    "query_time_ms": 42
  }
}
```

#### Performance

- Short paths (< 5 hops): < 200ms
- Long paths (5-20 hops): < 500ms

---

### get_graph_metrics

Retrieve performance metrics for graph queries.

#### Description

Returns timing, cache hit rates, and query statistics. Use this to monitor Neo4j query performance and identify slow queries.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query_type` | string | No | `"all"` | `"all"`, `"getDependencies"`, `"getDependents"`, `"getPath"`, or `"getArchitecture"` |

#### Example Requests

**All metrics:**
```json
{}
```

**Specific query type:**
```json
{
  "query_type": "getDependencies"
}
```

#### Response Schema (All Metrics)

When `query_type` is `"all"` or omitted:

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
      },
      {
        "queryType": "getDependents",
        "totalQueries": 120,
        "averageDurationMs": 145.2,
        "maxDurationMs": 720,
        "minDurationMs": 25,
        "cacheHitRate": 0.35,
        "averageResultCount": 12.1,
        "errorCount": 1
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

#### Response Schema (Filtered by Query Type)

When `query_type` is a specific query type (e.g., `"getDependencies"`):

```json
{
  "success": true,
  "queryType": "getDependencies",
  "stats": {
    "queryType": "getDependencies",
    "totalQueries": 150,
    "averageDurationMs": 125.5,
    "maxDurationMs": 890,
    "minDurationMs": 15,
    "cacheHitRate": 0.42,
    "averageResultCount": 8.3,
    "errorCount": 2
  }
}
```

---

## Error Handling

### Error Response Format

All tools return errors in a consistent format:

```json
{
  "isError": true,
  "content": [{
    "type": "text",
    "text": "Error: <error_message>"
  }]
}
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Repository not found" | Repository name doesn't exist | Check `list_indexed_repositories` for valid names |
| "Entity not found" | Entity path doesn't match indexed data | Verify path is relative to repository root |
| "No graph data available" | Neo4j not running or not configured | Start Neo4j and run `pk-mcp graph migrate` |
| "ChromaDB connection failed" | Vector database unavailable | Verify ChromaDB is running via `docker-compose ps` |
| "Invalid arguments" | Parameter validation failed | Check parameter types and required fields |

### Error Codes

| Code | Type | Description |
|------|------|-------------|
| `-32602` | InvalidParams | Invalid or missing parameters |
| `-32603` | InternalError | Server-side error |
| `-32600` | InvalidRequest | Malformed request |

---

## Rate Limiting

When HTTP transport is enabled, rate limits apply:

| Operation | Per Minute | Per Hour |
|-----------|------------|----------|
| Read (GET, search) | 60 | 1000 |
| Write (index, update) | 30 | 500 |

Admin tokens can bypass rate limits (configurable via `RATE_LIMIT_ADMIN_BYPASS`).

Rate limit headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1736963400
```

---

## Related Documentation

- [Graph Tools Guide](graph-tools.md) - Detailed usage examples
- [Neo4j Setup Guide](neo4j-setup.md) - Graph database setup
- [Configuration Reference](configuration-reference.md) - Environment variables
- [Claude Code Setup Guide](claude-code-setup.md) - MCP integration
- [Troubleshooting Guide](troubleshooting.md) - Common issues

---

**Last Updated**: 2026-01-16
