# CLI Commands Reference

Complete reference for all Personal Knowledge MCP command-line interface commands.

## Table of Contents

- [Installation](#installation)
- [Repository Commands](#repository-commands)
  - [index](#index---index-a-repository)
  - [search](#search---semantic-search)
  - [status](#status---list-repositories)
  - [remove](#remove---remove-repository)
  - [update](#update---update-repository)
  - [update-all](#update-all---update-all-repositories)
  - [history](#history---view-update-history)
  - [reset-update](#reset-update---reset-stuck-update)
- [Service Commands](#service-commands)
  - [health](#health---health-check)
- [Token Commands](#token-commands)
  - [token create](#token-create---create-token)
  - [token list](#token-list---list-tokens)
  - [token revoke](#token-revoke---revoke-token)
  - [token rotate](#token-rotate---rotate-token)
- [Graph Commands](#graph-commands)
  - [graph migrate](#graph-migrate---apply-schema-migrations)
  - [graph populate](#graph-populate---populate-graph-from-repository)
  - [graph populate-all](#graph-populate-all---populate-graph-for-all-repositories)
- [Provider Commands](#provider-commands)
  - [providers status](#providers-status---show-provider-status)
  - [providers setup](#providers-setup---download-local-models)
- [Model Commands](#model-commands)
  - [models list](#models-list---list-cached-models)
  - [models status](#models-status---show-cache-status)
  - [models validate](#models-validate---validate-model-integrity)
  - [models clear](#models-clear---clear-cached-models)
  - [models path](#models-path---show-model-path)
  - [models import](#models-import---import-model-from-files)

---

## Installation

After building the project, use the CLI directly or install globally:

```bash
# Build the CLI
bun run build

# Run directly
bun run cli --help

# Or via dist
bun run dist/cli.js --help

# Install globally (optional)
bun link
pk-mcp --help
```

---

## Repository Commands

### index - Index a Repository

Clone and index a repository for semantic search.

**Syntax**:
```bash
pk-mcp index <repository-url> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `repository-url` | Yes | Git repository URL to index |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--name <name>` | `-n` | Custom repository name (defaults to repo name from URL) |
| `--branch <branch>` | `-b` | Branch to clone (defaults to repository default) |
| `--force` | `-f` | Force reindexing if repository already exists |
| `--provider <provider>` | `-p` | Embedding provider: `openai`, `transformersjs`, `local`, `ollama` |

**Examples**:
```bash
# Index a public repository
pk-mcp index https://github.com/user/my-project.git

# Index with custom name and specific branch
pk-mcp index https://github.com/user/repo.git --name my-repo --branch develop

# Reindex an existing repository
pk-mcp index https://github.com/user/repo.git --force

# Index with specific embedding provider
pk-mcp index https://github.com/user/repo.git --provider transformersjs

# Index a private repository (requires GITHUB_PAT in .env)
pk-mcp index https://github.com/company/private-repo.git
```

**Output**: Real-time progress through cloning, scanning, chunking, embedding, and storing phases. Shows final statistics including files processed, chunks created, embeddings generated, and duration.

---

### search - Semantic Search

Search indexed repositories using natural language queries.

**Syntax**:
```bash
pk-mcp search <query> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `query` | Yes | Natural language search query |

**Options**:
| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--limit <number>` | `-l` | `10` | Maximum results (1-100) |
| `--threshold <number>` | `-t` | `0.7` | Similarity threshold (0.0-1.0) |
| `--repo <name>` | `-r` | - | Filter to specific repository |
| `--json` | `-j` | - | Output as JSON |

**Examples**:
```bash
# Basic search
pk-mcp search "authentication middleware"

# Search with custom limit and threshold
pk-mcp search "error handling" --limit 5 --threshold 0.8

# Search specific repository
pk-mcp search "database query" --repo my-api

# JSON output for programmatic use
pk-mcp search "API endpoints" --json
```

**Output**: Table showing rank, repository, file path, code snippet, and similarity score.

---

### status - List Repositories

List all indexed repositories with their status and statistics.

**Syntax**:
```bash
pk-mcp status [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--json` | `-j` | Output as JSON |
| `--check` | - | Check GitHub for available updates |
| `--metrics` | - | Display aggregate update metrics |

**Examples**:
```bash
# List repositories
pk-mcp status

# Check for updates available from GitHub
pk-mcp status --check

# Show update metrics
pk-mcp status --metrics

# JSON output
pk-mcp status --json
```

**Output**: Table showing repository name, URL, file count, chunk count, last indexed timestamp, and status.

**Status Icons**:
- `ready` - Repository indexed and ready for search
- `indexing` - Currently being indexed
- `error` - Indexing failed

---

### remove - Remove Repository

Remove a repository from the index.

**Syntax**:
```bash
pk-mcp remove <repository-name> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `repository-name` | Yes | Name of the repository to remove |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--force` | `-f` | Skip confirmation prompt |
| `--delete-files` | - | Also delete local repository files |

**Examples**:
```bash
# Remove with confirmation
pk-mcp remove my-repo

# Force remove without confirmation
pk-mcp remove my-repo --force

# Remove and delete local files
pk-mcp remove my-repo --force --delete-files
```

**Output**: Confirmation prompt (unless `--force`), progress spinner, success message.

---

### update - Update Repository

Incrementally update a repository's index with changes since last indexing.

**Syntax**:
```bash
pk-mcp update <repository-name> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `repository-name` | Yes | Name of the repository to update |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--force` | `-f` | Force full re-index instead of incremental update |
| `--json` | `-j` | Output as JSON |
| `--verbose` | `-v` | Show all errors with actionable guidance |

**Examples**:
```bash
# Incremental update after merging a PR
pk-mcp update my-api

# Force full re-index
pk-mcp update my-api --force

# Verbose output for debugging
pk-mcp update my-api --verbose
```

**Output**: Summary showing commit range, files changed (added/modified/deleted), chunks upserted/deleted, and duration.

**Automatic Full Re-index**:
- Force push detected (base commit no longer exists)
- More than 500 files changed

---

### update-all - Update All Repositories

Update all indexed repositories sequentially.

**Syntax**:
```bash
pk-mcp update-all [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
# Update all repositories
pk-mcp update-all

# JSON output for scripting
pk-mcp update-all --json
```

**Output**: Progress through each repository with individual results.

---

### history - View Update History

View the history of incremental updates for a repository.

**Syntax**:
```bash
pk-mcp history <repository-name> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `repository-name` | Yes | Repository name |

**Options**:
| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--limit <number>` | `-l` | `10` | Number of updates to show (1-100) |
| `--json` | `-j` | - | Output as JSON |

**Examples**:
```bash
# View last 10 updates
pk-mcp history my-api

# View last 5 updates
pk-mcp history my-api --limit 5

# JSON output
pk-mcp history my-api --json
```

**Output**: Table showing timestamp, commit range, files changed, chunks affected, duration, and status.

---

### reset-update - Reset Stuck Update

Reset stuck update state for a repository.

**Syntax**:
```bash
pk-mcp reset-update <repository-name> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `repository-name` | Yes | Repository name to reset |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--force` | `-f` | Skip confirmation prompt |
| `--recover` | `-r` | Attempt automatic recovery |
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
# Reset with confirmation
pk-mcp reset-update my-repo

# Force reset
pk-mcp reset-update my-repo --force

# Attempt automatic recovery
pk-mcp reset-update my-repo --recover
```

**Use Case**: When an update is interrupted and the repository is stuck in "updating" state.

---

## Service Commands

### health - Health Check

Check the health of all required services.

**Syntax**:
```bash
pk-mcp health
```

**Examples**:
```bash
pk-mcp health
```

**Output**: Status of ChromaDB, OpenAI API (if configured), Neo4j (if configured), and Metadata Store with response times.

**Exit Codes**:
- `0` - All services healthy
- `1` - One or more services unhealthy

> **Note**: The OpenAI API health check verifies authentication but cannot detect quota or billing issues.

---

## Token Commands

Manage authentication tokens for HTTP transport access.

### token create - Create Token

Create a new authentication token.

**Syntax**:
```bash
pk-mcp token create --name <name> [options]
```

**Options**:
| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--name <name>` | `-n` | Required | Token name (e.g., "Cursor IDE") |
| `--scopes <scopes>` | `-s` | `read` | Permission scopes: `read`, `write`, `admin` (comma-separated) |
| `--instances <instances>` | `-i` | `public` | Instance access: `private`, `work`, `public` (comma-separated) |
| `--expires <duration>` | `-e` | `never` | Expiration: `30d`, `1y`, `12h`, `2w`, `3m`, or `never` |

**Examples**:
```bash
# Create basic read-only token
pk-mcp token create --name "Cursor IDE"

# Create token with write access to work instance
pk-mcp token create --name "VS Code" --scopes read,write --instances work

# Create admin token expiring in 30 days
pk-mcp token create --name "Admin CLI" --scopes admin --expires 30d

# Create token with access to all instances
pk-mcp token create --name "Full Access" --scopes read,write --instances private,work,public
```

**Output**: The raw token (shown only once), token metadata, and usage instructions.

> **Important**: The raw token is displayed only once. Store it securely.

---

### token list - List Tokens

List all tokens with their metadata.

**Syntax**:
```bash
pk-mcp token list [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--json` | `-j` | Output as JSON |
| `--all` | - | Include expired and revoked tokens |

**Examples**:
```bash
# List active tokens
pk-mcp token list

# Include expired and revoked
pk-mcp token list --all

# JSON output
pk-mcp token list --json
```

**Output**: Table showing token name, hash prefix, scopes, instances, created date, expires date, and status.

---

### token revoke - Revoke Token

Revoke an authentication token.

**Syntax**:
```bash
pk-mcp token revoke [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--name <name>` | `-n` | Revoke by token name |
| `--id <prefix>` | - | Revoke by hash prefix (8+ characters) |
| `--force` | `-f` | Skip confirmation prompt |

**Examples**:
```bash
# Revoke by name
pk-mcp token revoke --name "Cursor IDE"

# Revoke by hash prefix
pk-mcp token revoke --id a1b2c3d4

# Force revoke without confirmation
pk-mcp token revoke --name "Old Token" --force
```

**Output**: Confirmation prompt, progress spinner, success message.

---

### token rotate - Rotate Token

Rotate a token by revoking the old one and creating a new one with the same metadata.

**Syntax**:
```bash
pk-mcp token rotate --name <name>
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--name <name>` | `-n` | Token name to rotate (required) |

**Examples**:
```bash
# Rotate a token
pk-mcp token rotate --name "Cursor IDE"
```

**Output**: The new raw token, confirmation of rotation, and updated metadata.

> **Note**: The original token's expiration duration is preserved.

---

## Graph Commands

Manage the Neo4j knowledge graph for code dependency analysis.

### graph migrate - Apply Schema Migrations

Apply schema migrations to the Neo4j knowledge graph.

**Syntax**:
```bash
pk-mcp graph migrate [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--dry-run` | - | Show what would be executed without applying |
| `--force` | `-f` | Re-apply all migrations even if already applied |
| `--status` | - | Show current schema version and pending migrations |
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
# Apply pending migrations
pk-mcp graph migrate

# Check migration status
pk-mcp graph migrate --status

# Preview migrations
pk-mcp graph migrate --dry-run

# Force re-apply all
pk-mcp graph migrate --force
```

**Output**: List of migrations applied, current schema version.

---

### graph populate - Populate Graph from Repository

Populate the knowledge graph from an indexed repository. Uses AST parsing to extract code entities (functions, classes, interfaces, imports, etc.) and their relationships.

**Syntax**:
```bash
pk-mcp graph populate <repository-name> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `repository-name` | Yes | Repository to populate |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--force` | `-f` | Delete existing graph data and repopulate |
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
# Populate graph for a repository
pk-mcp graph populate my-api

# Force repopulate
pk-mcp graph populate my-api --force
```

**Output**: Statistics showing nodes created, relationships created, and processing time.

**Supported Languages**: TypeScript, TSX, JavaScript, JSX, Python, Java, Go, Rust, C#, C, C++, Ruby, PHP. See [Graph Tools Guide](graph-tools.md#supported-languages-for-graph-population) for file extensions and parser details.

---

### graph populate-all - Populate Graph for All Repositories

Populate the knowledge graph for all indexed repositories.

**Syntax**:
```bash
pk-mcp graph populate-all [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--force` | `-f` | Delete existing graph data and repopulate |
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
# Populate all repositories
pk-mcp graph populate-all

# Force repopulate all
pk-mcp graph populate-all --force
```

---

## Provider Commands

Manage embedding providers and local models.

### providers status - Show Provider Status

Show available embedding providers and their status.

**Syntax**:
```bash
pk-mcp providers status [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
pk-mcp providers status
```

**Output**: Table showing provider name, availability status, configured model, and dimensions.

---

### providers setup - Download Local Models

Download and prepare local embedding models.

**Syntax**:
```bash
pk-mcp providers setup <provider> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `provider` | Yes | Provider to set up: `transformersjs`, `local`, `ollama` |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--model <model>` | `-m` | Model to download (provider-specific) |
| `--force` | `-f` | Re-download even if model exists |

**Examples**:
```bash
# Download default Transformers.js model
pk-mcp providers setup transformersjs

# Download specific model
pk-mcp providers setup transformersjs --model Xenova/bge-base-en-v1.5

# Force re-download
pk-mcp providers setup transformersjs --force
```

> **See Also**: [Embedding Provider Guide](embedding-providers.md) for model options.

---

## Model Commands

Manage the embedding model cache for offline/air-gapped deployments.

### models list - List Cached Models

List all cached embedding models.

**Syntax**:
```bash
pk-mcp models list [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--provider <provider>` | `-p` | Filter by provider: `transformersjs`, `ollama` |
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
# List all cached models
pk-mcp models list

# List only Transformers.js models
pk-mcp models list --provider transformersjs
```

---

### models status - Show Cache Status

Show cache status and disk usage.

**Syntax**:
```bash
pk-mcp models status [options]
```

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--provider <provider>` | `-p` | Filter by provider |
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
pk-mcp models status
```

**Output**: Cache location, total size, number of models, and breakdown by provider.

---

### models validate - Validate Model Integrity

Validate cached model integrity.

**Syntax**:
```bash
pk-mcp models validate [modelId] [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `modelId` | No | Model ID to validate (all models if not specified) |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--provider <provider>` | `-p` | Filter by provider |
| `--fix` | - | Attempt to fix invalid models by re-downloading |
| `--json` | `-j` | Output as JSON |

**Examples**:
```bash
# Validate all models
pk-mcp models validate

# Validate specific model
pk-mcp models validate Xenova/all-MiniLM-L6-v2

# Validate and fix
pk-mcp models validate --fix
```

---

### models clear - Clear Cached Models

Clear cached models to free disk space.

**Syntax**:
```bash
pk-mcp models clear [modelId] [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `modelId` | No | Model ID to clear (all models if not specified) |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--provider <provider>` | `-p` | Filter by provider |
| `--force` | `-f` | Skip confirmation prompt |
| `--dry-run` | - | Show what would be cleared |

**Examples**:
```bash
# Clear all models (with confirmation)
pk-mcp models clear

# Clear specific model
pk-mcp models clear Xenova/all-MiniLM-L6-v2 --force

# Preview what would be cleared
pk-mcp models clear --dry-run
```

---

### models path - Show Model Path

Show path for manual model placement (air-gapped installations).

**Syntax**:
```bash
pk-mcp models path <modelId> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `modelId` | Yes | Model ID to get path for |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--provider <provider>` | `-p` | Provider (default: `transformersjs`) |

**Examples**:
```bash
# Get path for Transformers.js model
pk-mcp models path Xenova/all-MiniLM-L6-v2

# Get path for Ollama model
pk-mcp models path nomic-embed-text --provider ollama
```

**Use Case**: Manually copying model files to air-gapped systems.

---

### models import - Import Model from Files

Import a model from local files for air-gapped installations.

**Syntax**:
```bash
pk-mcp models import <sourcePath> --provider <provider> --model-id <modelId> [options]
```

**Arguments**:
| Argument | Required | Description |
|----------|----------|-------------|
| `sourcePath` | Yes | Path to source model files |

**Options**:
| Option | Short | Description |
|--------|-------|-------------|
| `--provider <provider>` | `-p` | Provider (required): `transformersjs`, `ollama` |
| `--model-id <modelId>` | `-m` | Model identifier (required) |
| `--validate` | - | Validate after import |
| `--overwrite` | - | Overwrite existing cached model |

**Examples**:
```bash
# Import Transformers.js model
pk-mcp models import ./models/all-MiniLM-L6-v2 \
  --provider transformersjs \
  --model-id Xenova/all-MiniLM-L6-v2 \
  --validate

# Import with overwrite
pk-mcp models import ./models/bge-base \
  --provider transformersjs \
  --model-id Xenova/bge-base-en-v1.5 \
  --overwrite
```

---

## Environment Variables

The CLI uses the same environment variables as the MCP server. Key variables:

```bash
# Required for OpenAI provider
OPENAI_API_KEY=sk-...

# ChromaDB connection
CHROMADB_HOST=localhost
CHROMADB_PORT=8000

# Data paths
DATA_PATH=./data
REPO_CLONE_PATH=./data/repos

# Logging
LOG_LEVEL=info
```

> **See Also**: [Configuration Reference](configuration-reference.md) for complete environment variable documentation.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (see error message for details) |

---

## Troubleshooting

### ChromaDB Connection Failed

```bash
# Verify ChromaDB is running
docker-compose ps

# Start ChromaDB if needed
docker-compose up -d

# Check logs
docker-compose logs chromadb
```

### Repository Clone Failed

```bash
# For private repositories, set GitHub PAT
export GITHUB_PAT=ghp_...

# Verify URL is correct and Git is installed
git --version
```

### Enable Verbose Logging

```bash
LOG_LEVEL=debug pk-mcp <command>
```

> **See Also**: [Troubleshooting Guide](troubleshooting.md) for more solutions.

---

## Related Documentation

- [Configuration Reference](configuration-reference.md) - Environment variables
- [Embedding Provider Guide](embedding-providers.md) - Provider details
- [Graph Tools Guide](graph-tools.md) - Knowledge graph usage
- [MCP Tools Reference](mcp-tools-reference.md) - MCP tool API
- [Troubleshooting Guide](troubleshooting.md) - Common issues

---

**Last Updated**: 2026-01-16
