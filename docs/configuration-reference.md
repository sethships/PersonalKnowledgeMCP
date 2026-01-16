# Configuration Reference

This document provides a comprehensive reference for all environment variables and configuration options in Personal Knowledge MCP.

## Table of Contents

- [Quick Start Configuration](#quick-start-configuration)
- [Required Configuration](#required-configuration)
- [Storage Configuration](#storage-configuration)
- [Embedding Configuration](#embedding-configuration)
- [Graph Database Configuration](#graph-database-configuration)
- [HTTP Transport Configuration](#http-transport-configuration)
- [Authentication Configuration](#authentication-configuration)
- [Rate Limiting Configuration](#rate-limiting-configuration)
- [Multi-Instance Configuration](#multi-instance-configuration)
- [Logging Configuration](#logging-configuration)
- [Performance Tuning](#performance-tuning)
- [Enterprise Features](#enterprise-features)

---

## Quick Start Configuration

For basic local development, create a `.env` file with:

```bash
# Minimum configuration for local development
OPENAI_API_KEY=sk-your-api-key-here

# ChromaDB (defaults work with docker-compose)
CHROMADB_HOST=localhost
CHROMADB_PORT=8000
```

> **Tip**: Copy `.env.example` to `.env` for a complete template with all options documented.

---

## Required Configuration

### OpenAI API Key

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Conditional | - | OpenAI API key for embedding generation. Required unless using local embedding provider. |

**Getting an API Key**:
1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Add to `.env`: `OPENAI_API_KEY=sk-...`

> **Note**: If you want fully local/offline operation, you can omit this key and use Transformers.js instead. See [Embedding Provider Guide](embedding-providers.md).

---

## Storage Configuration

### ChromaDB (Vector Database)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CHROMADB_HOST` | No | `localhost` | ChromaDB server hostname |
| `CHROMADB_PORT` | No | `8000` | ChromaDB server port |
| `CHROMADB_AUTH_TOKEN` | No | - | Authentication token for ChromaDB (production security) |
| `CHROMADB_ALLOW_RESET` | No | `FALSE` | Enable ChromaDB reset endpoint (development only) |

**Example**:
```bash
CHROMADB_HOST=localhost
CHROMADB_PORT=8000
CHROMADB_AUTH_TOKEN=your-secure-token-here  # Optional, for production
```

**Generating a Secure Token**:
```bash
openssl rand -hex 32
```

### PostgreSQL (Document Store - Phase 2)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_USER` | Yes* | `pk_mcp` | PostgreSQL username |
| `POSTGRES_PASSWORD` | Yes* | - | PostgreSQL password (container won't start without it) |
| `POSTGRES_DB` | No | `personal_knowledge` | Database name |
| `POSTGRES_HOST` | No | `localhost` | PostgreSQL hostname |
| `POSTGRES_PORT` | No | `5432` | PostgreSQL port |

*Required when using PostgreSQL features.

**Example**:
```bash
POSTGRES_USER=pk_mcp
POSTGRES_PASSWORD=your-secure-password  # Use: openssl rand -base64 32
POSTGRES_DB=personal_knowledge
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
```

### Data Paths

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATA_PATH` | No | `./data` | Base directory for all persistent data |
| `REPO_CLONE_PATH` | No | `./data/repos` | Directory for cloned repositories |

---

## Embedding Configuration

### Provider Selection

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | No | Auto-detect | Force provider: `openai`, `transformersjs`, `ollama` |
| `EMBEDDING_MODEL` | No | Provider-specific | Model to use for embeddings |
| `EMBEDDING_DIMENSIONS` | No | Model-specific | Embedding vector dimensions |

**Auto-Detection Logic**:
1. If `OPENAI_API_KEY` is set → Use OpenAI
2. Otherwise → Use Transformers.js (zero-config local)

### OpenAI Provider

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | OpenAI API key |
| `OPENAI_ORGANIZATION` | No | - | OpenAI organization ID |
| `OPENAI_BASE_URL` | No | `api.openai.com` | API base URL (for Azure/proxies) |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` | OpenAI embedding model |
| `EMBEDDING_DIMENSIONS` | No | `1536` | Vector dimensions |

### Transformers.js Provider

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRANSFORMERS_CACHE` | No | `~/.cache/huggingface/transformers` | Model cache directory |

### Ollama Provider

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_HOST` | No | `localhost` | Ollama host (alternative) |
| `OLLAMA_PORT` | No | `11434` | Ollama port (alternative) |

> **See Also**: [Embedding Provider Guide](embedding-providers.md) for detailed provider configuration.

---

## Graph Database Configuration

### Neo4j (Knowledge Graph)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEO4J_USER` | Yes* | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | Yes* | - | Neo4j password (container won't start without it) |
| `NEO4J_HOST` | No | `localhost` | Neo4j hostname |
| `NEO4J_BOLT_PORT` | No | `7687` | Neo4j Bolt protocol port |
| `NEO4J_HTTP_PORT` | No | `7474` | Neo4j HTTP/Browser port |

*Required when using graph features.

**Example**:
```bash
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-secure-password  # Use: openssl rand -base64 32
NEO4J_HOST=localhost
NEO4J_BOLT_PORT=7687
NEO4J_HTTP_PORT=7474
```

> **See Also**: [Neo4j Setup Guide](neo4j-setup.md) and [Graph Tools Guide](graph-tools.md)

---

## HTTP Transport Configuration

Enable HTTP/SSE transport for clients like Cursor and VS Code Continue extension.

### Basic HTTP Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HTTP_TRANSPORT_ENABLED` | No | `false` | Enable HTTP/SSE transport |
| `HTTP_PORT` | No | `3001` | HTTP server port |
| `HTTP_HOST` | No | `127.0.0.1` | HTTP server bind address |

### SSE (Server-Sent Events) Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HTTP_MAX_SSE_SESSIONS` | No | `100` | Maximum concurrent SSE sessions |
| `HTTP_SSE_SESSION_TTL_MS` | No | `1800000` | Session TTL in ms (30 minutes) |
| `HTTP_SSE_CLEANUP_INTERVAL_MS` | No | `300000` | Cleanup interval in ms (5 minutes) |

### Streamable HTTP (MCP 2025-03-26 Specification)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HTTP_MAX_STREAMABLE_SESSIONS` | No | `100` | Maximum concurrent Streamable HTTP sessions |
| `HTTP_STREAMABLE_SESSION_TTL_MS` | No | `1800000` | Session TTL in ms (30 minutes) |
| `HTTP_STREAMABLE_CLEANUP_INTERVAL_MS` | No | `300000` | Cleanup interval in ms (5 minutes) |

**Example (Enable HTTP Transport)**:
```bash
HTTP_TRANSPORT_ENABLED=true
HTTP_PORT=3001
HTTP_HOST=127.0.0.1
```

### CORS Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORS_ENABLED` | No | `true` | Enable CORS when HTTP transport is enabled |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Allowed origins (comma-separated) |
| `CORS_CREDENTIALS` | No | `true` | Allow credentials in CORS requests |
| `CORS_MAX_AGE` | No | `86400` | Preflight cache duration in seconds (24 hours) |

**Example (Multiple Origins)**:
```bash
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,https://myapp.com
```

---

## Authentication Configuration

### Bearer Token Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_TOKEN_PATH` | No | `$DATA_PATH` | Directory for token storage |
| `AUTH_TRACK_TOKEN_USAGE` | No | `true` | Track token usage (lastUsedAt, useCount) |

### Token Generation

Tokens are managed via CLI:
```bash
pk-mcp token create --name "Cursor IDE" --scopes read,write
```

> **See Also**: [CLI Commands Reference](cli-commands-reference.md#token-commands)

---

## Rate Limiting Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | No | `true` | Enable rate limiting |
| `RATE_LIMIT_READ_PER_MINUTE` | No | `60` | Read operations per minute |
| `RATE_LIMIT_READ_PER_HOUR` | No | `1000` | Read operations per hour |
| `RATE_LIMIT_WRITE_PER_MINUTE` | No | `30` | Write operations per minute |
| `RATE_LIMIT_WRITE_PER_HOUR` | No | `500` | Write operations per hour |
| `RATE_LIMIT_ADMIN_BYPASS` | No | `true` | Allow admin tokens to bypass limits |

---

## Multi-Instance Configuration

The Personal Knowledge MCP supports multiple isolated instances for different security tiers.

### Instance Selection

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEFAULT_INSTANCE` | No | `public` | Default instance for unauthenticated requests |
| `REQUIRE_AUTH_FOR_DEFAULT_INSTANCE` | No | `false` | Require authentication for default instance |

### Private Instance (Port 8000)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INSTANCE_PRIVATE_ENABLED` | No | `true` | Enable private instance |
| `INSTANCE_PRIVATE_CHROMADB_HOST` | No | `localhost` | ChromaDB host for private instance |
| `INSTANCE_PRIVATE_CHROMADB_PORT` | No | `8000` | ChromaDB port for private instance |
| `INSTANCE_PRIVATE_DATA_PATH` | No | `./data/private` | Data directory for private instance |
| `INSTANCE_PRIVATE_CHROMADB_AUTH_TOKEN` | No | - | ChromaDB auth token for private instance |

### Work Instance (Port 8001)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INSTANCE_WORK_ENABLED` | No | `true` | Enable work instance |
| `INSTANCE_WORK_CHROMADB_HOST` | No | `localhost` | ChromaDB host for work instance |
| `INSTANCE_WORK_CHROMADB_PORT` | No | `8001` | ChromaDB port for work instance |
| `INSTANCE_WORK_DATA_PATH` | No | `./data/work` | Data directory for work instance |
| `INSTANCE_WORK_CHROMADB_AUTH_TOKEN` | No | - | ChromaDB auth token for work instance |

### Public Instance (Port 8002)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INSTANCE_PUBLIC_ENABLED` | No | `true` | Enable public instance |
| `INSTANCE_PUBLIC_CHROMADB_HOST` | No | `localhost` | ChromaDB host for public instance |
| `INSTANCE_PUBLIC_CHROMADB_PORT` | No | `8002` | ChromaDB port for public instance |
| `INSTANCE_PUBLIC_DATA_PATH` | No | `./data/public` | Data directory for public instance |
| `INSTANCE_PUBLIC_CHROMADB_AUTH_TOKEN` | No | - | ChromaDB auth token for public instance |

**Docker Compose Profiles**:
```bash
docker compose --profile all up -d         # All instances
docker compose --profile private up -d     # Private only
docker compose --profile work up -d        # Work only
docker compose --profile public up -d      # Public only
docker compose --profile default up -d     # Single instance (backwards compatible)
```

---

## Logging Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `LOG_FORMAT` | No | `pretty` | Log format: `json` or `pretty` |
| `DEBUG` | No | `false` | Enable debug mode |
| `NODE_ENV` | No | `development` | Environment: `development`, `production`, `test` |

### Audit Logging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUDIT_LOG_ENABLED` | No | `true` | Enable audit logging |
| `AUDIT_LOG_PATH` | No | `./data/audit/audit.log` | Audit log file path |
| `AUDIT_LOG_MAX_FILE_SIZE` | No | `10485760` | Max file size before rotation (10MB) |
| `AUDIT_LOG_MAX_FILES` | No | `10` | Number of rotated files to keep |
| `AUDIT_LOG_RETENTION_DAYS` | No | `90` | Days to retain log files |

---

## Performance Tuning

### Chunking Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CHUNK_MAX_TOKENS` | No | `500` | Maximum tokens per chunk |
| `CHUNK_OVERLAP_TOKENS` | No | `50` | Token overlap between chunks |

### File Scanning Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SUPPORTED_EXTENSIONS` | No | See below | File extensions to index (comma-separated) |
| `MAX_FILE_SIZE_BYTES` | No | `1048576` | Maximum file size to process (1MB) |

**Default Supported Extensions**:
```
.js,.ts,.jsx,.tsx,.cs,.py,.java,.go,.rs,.cpp,.c,.h,.md,.txt,.rst,.json,.yaml,.yml,.toml
```

### Search Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEFAULT_SEARCH_LIMIT` | No | `10` | Default search results |
| `MAX_SEARCH_LIMIT` | No | `50` | Maximum search results |
| `DEFAULT_SIMILARITY_THRESHOLD` | No | `0.7` | Default similarity threshold (0.0-1.0) |
| `SNIPPET_MAX_LENGTH` | No | `500` | Maximum snippet length in results |

### API Performance

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMBEDDING_BATCH_SIZE` | No | `100` | Batch size for embedding API calls |
| `MAX_RETRIES` | No | `3` | Maximum retries for API failures |
| `REQUEST_TIMEOUT_MS` | No | `30000` | Request timeout in milliseconds |
| `RETRY_INITIAL_DELAY_MS` | No | `1000` | Initial retry delay |
| `RETRY_MAX_DELAY_MS` | No | `60000` | Maximum retry delay |
| `RETRY_BACKOFF_MULTIPLIER` | No | `2` | Exponential backoff multiplier |

### Update Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `UPDATE_HISTORY_LIMIT` | No | `20` | Maximum update history entries per repository |

---

## Enterprise Features

### OIDC Configuration (Phase 4)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OIDC_ENABLED` | No | `false` | Enable OIDC authentication |
| `OIDC_ISSUER` | Yes* | - | OIDC issuer URL |
| `OIDC_CLIENT_ID` | Yes* | - | OAuth2 client ID |
| `OIDC_CLIENT_SECRET` | Yes* | - | OAuth2 client secret |
| `OIDC_REDIRECT_URI` | Yes* | - | Callback URL for authentication |
| `OIDC_DEFAULT_SCOPES` | No | `read` | Default scopes for OIDC users |
| `OIDC_DEFAULT_INSTANCE_ACCESS` | No | `public` | Default instance access for OIDC users |
| `OIDC_SESSION_TTL_SECONDS` | No | `3600` | Session lifetime (1 hour) |
| `OIDC_REFRESH_BEFORE_EXPIRY_SECONDS` | No | `300` | Refresh tokens before expiry |
| `OIDC_COOKIE_SECURE` | No | Auto-detect | Secure cookie flag |

*Required when `OIDC_ENABLED=true`.

**Supported Identity Providers**:
- Microsoft Entra ID (Azure AD)
- Auth0
- Okta
- Google Workspace
- Keycloak

### User Mapping Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `USER_MAPPING_ENABLED` | No | `true` | Enable user-to-instance mapping |
| `OIDC_IDP_TYPE` | No | `generic` | IdP type: `azure-ad`, `auth0`, `generic` |
| `OIDC_GROUP_CLAIM_NAME` | No | `groups` | Group claim name |
| `OIDC_ROLE_CLAIM_NAME` | No | `roles` | Role claim name |
| `USER_MAPPING_FILE_WATCHER` | No | `true` | Watch for config file changes |
| `USER_MAPPING_DEBOUNCE_MS` | No | `500` | File watcher debounce delay |

---

## GitHub Integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_PAT` | No | - | GitHub Personal Access Token for private repositories |

**Required Scopes for GITHUB_PAT**:
- `repo` - For private repository access

**Creating a PAT**:
1. Visit [GitHub Token Settings](https://github.com/settings/tokens)
2. Generate new token (classic)
3. Select `repo` scope
4. Add to `.env`: `GITHUB_PAT=ghp_...`

---

## Related Documentation

- [Embedding Provider Guide](embedding-providers.md) - Detailed provider configuration
- [Graph Tools Guide](graph-tools.md) - Neo4j and knowledge graph usage
- [Neo4j Setup Guide](neo4j-setup.md) - Neo4j installation and configuration
- [CLI Commands Reference](cli-commands-reference.md) - Complete CLI documentation
- [Troubleshooting Guide](troubleshooting.md) - Common issues and solutions
- [Claude Code Setup Guide](claude-code-setup.md) - MCP integration

---

**Last Updated**: 2026-01-16
