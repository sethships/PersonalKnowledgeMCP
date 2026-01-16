# Neo4j Setup Guide

This guide covers Neo4j installation, configuration, and usage for the Personal Knowledge MCP knowledge graph features.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Docker Compose (Recommended)](#docker-compose-recommended)
  - [Native Installation](#native-installation)
- [Configuration](#configuration)
- [Schema Setup](#schema-setup)
- [Populating the Graph](#populating-the-graph)
- [Verification](#verification)
- [Maintenance](#maintenance)
- [Troubleshooting](#troubleshooting)

---

## Overview

Neo4j is the graph database that powers the knowledge graph features in Personal Knowledge MCP, enabling:

- **Dependency analysis** - What does this code depend on?
- **Impact analysis** - What will break if I change this?
- **Architecture visualization** - How is the codebase structured?
- **Path tracing** - How are these components connected?

### When You Need Neo4j

| Feature | Requires Neo4j |
|---------|---------------|
| `semantic_search` | No |
| `list_indexed_repositories` | No |
| `get_dependencies` | **Yes** |
| `get_dependents` | **Yes** |
| `get_architecture` | **Yes** |
| `find_path` | **Yes** |
| `get_graph_metrics` | **Yes** |

If you only need semantic search, you can skip Neo4j setup.

---

## Prerequisites

- **Docker Desktop**: For running Neo4j container
- **At least 2GB RAM**: Neo4j requires significant memory
- **Disk space**: 500MB minimum for Neo4j + data

---

## Installation

### Docker Compose (Recommended)

Personal Knowledge MCP includes Neo4j in `docker-compose.yml`.

**1. Configure environment variables**

Add to your `.env` file:

```bash
# Required - Neo4j authentication
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-secure-password  # Generate with: openssl rand -base64 32

# Optional - Customize ports (defaults shown)
NEO4J_HOST=localhost
NEO4J_BOLT_PORT=7687
NEO4J_HTTP_PORT=7474
```

> **Important**: `NEO4J_PASSWORD` is required. Docker Compose will fail without it.

**2. Start Neo4j**

```bash
# Start Neo4j with the default profile
docker compose --profile default up -d neo4j

# Or start all services
docker compose --profile default up -d
```

**3. Verify Neo4j is running**

```bash
# Check container status
docker compose ps neo4j

# View logs
docker compose logs neo4j

# Test connection
curl http://localhost:7474
```

**Expected output**: Neo4j container running with healthy status.

### Native Installation

If you prefer running Neo4j natively (without Docker):

**1. Download Neo4j Community**

Visit [Neo4j Download Center](https://neo4j.com/download-center/#community) and download Neo4j Community Edition 5.x.

**2. Install and start**

Follow the platform-specific instructions:
- **Windows**: Run the installer, start via Neo4j Desktop or service
- **macOS**: `brew install neo4j` then `neo4j start`
- **Linux**: Extract tarball, run `./bin/neo4j start`

**3. Set initial password**

```bash
# Via cypher-shell
./bin/cypher-shell -u neo4j -p neo4j
# You'll be prompted to change the password
```

**4. Configure environment**

```bash
NEO4J_HOST=localhost
NEO4J_BOLT_PORT=7687
NEO4J_HTTP_PORT=7474
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-new-password
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEO4J_USER` | Yes | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | Yes | - | Neo4j password |
| `NEO4J_HOST` | No | `localhost` | Neo4j hostname |
| `NEO4J_BOLT_PORT` | No | `7687` | Bolt protocol port |
| `NEO4J_HTTP_PORT` | No | `7474` | HTTP/Browser port |

### Docker Compose Resource Limits

The default configuration allocates:

```yaml
deploy:
  resources:
    limits:
      cpus: "2"
      memory: 2G
    reservations:
      cpus: "0.5"
      memory: 512M
```

Neo4j memory settings:
- **Heap**: 512MB initial, 1GB max
- **Page cache**: 512MB

To modify for larger codebases, update `docker-compose.yml`:

```yaml
environment:
  - NEO4J_server_memory_heap_initial__size=1g
  - NEO4J_server_memory_heap_max__size=2g
  - NEO4J_server_memory_pagecache_size=1g
```

### Data Persistence

Graph data is stored in Docker volumes:
- `neo4j-data`: Graph database files
- `neo4j-logs`: Neo4j logs

Data persists across container restarts. To reset:

```bash
# WARNING: Deletes all graph data
docker compose down -v
docker compose --profile default up -d
```

---

## Schema Setup

Before using graph tools, apply the database schema:

```bash
# Apply schema migrations
pk-mcp graph migrate

# Or check current status first
pk-mcp graph migrate --status
```

**Expected output**:
```
Applying schema migrations...
- Migration 001: Create node constraints (applied)
- Migration 002: Create relationship indexes (applied)
Schema version: 2
```

### What the Schema Creates

- **Node labels**: `File`, `Function`, `Class`, `Package`, `Repository`
- **Relationship types**: `IMPORTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, `REFERENCES`
- **Indexes**: On file paths, entity names, repository names
- **Constraints**: Unique constraints for entity identification

---

## Populating the Graph

After indexing a repository with ChromaDB, populate the knowledge graph:

**1. Ensure repository is indexed**

```bash
pk-mcp status
# Should show repository with status "ready"
```

**2. Populate graph for a repository**

```bash
pk-mcp graph populate my-api
```

**Expected output**:
```
Populating knowledge graph for my-api...
- Files analyzed: 156
- Functions extracted: 423
- Classes extracted: 45
- Relationships created: 1,234
- Duration: 45.2s
Graph population complete.
```

**3. Populate all repositories**

```bash
pk-mcp graph populate-all
```

### When to Repopulate

- After adding many new files
- After major refactoring
- If graph queries return unexpected results

Use `--force` to clear and rebuild:

```bash
pk-mcp graph populate my-api --force
```

---

## Verification

### Check Graph Health

```bash
pk-mcp health
# Should show "Neo4j: OK"
```

### Test Graph Queries

**Via CLI (using MCP tools):**
```bash
# In Claude Code, ask:
"What does src/services/auth.ts depend on?"
```

**Via Neo4j Browser:**

1. Open http://localhost:7474
2. Log in with your credentials
3. Run a test query:

```cypher
// Count nodes by type
MATCH (n)
RETURN labels(n)[0] AS type, count(*) AS count
ORDER BY count DESC
```

```cypher
// Sample file dependencies
MATCH (f:File)-[r:IMPORTS]->(dep)
RETURN f.path AS file, dep.path AS imports
LIMIT 10
```

### Verify Graph Metrics

```bash
# Via MCP tool in Claude Code
"Show me graph metrics"
```

---

## Maintenance

### Regular Tasks

**Check disk usage:**
```bash
docker compose exec neo4j du -sh /data
```

**View logs:**
```bash
docker compose logs neo4j --tail 100
```

**Backup data:**
```bash
# Stop Neo4j first
docker compose stop neo4j

# Copy data volume
docker run --rm -v pk-mcp-neo4j-data:/data -v $(pwd):/backup alpine \
  tar cvf /backup/neo4j-backup.tar /data

# Restart
docker compose start neo4j
```

### Performance Tuning

For large codebases (>10K files):

1. **Increase heap memory** in docker-compose.yml:
   ```yaml
   - NEO4J_server_memory_heap_max__size=4g
   ```

2. **Increase page cache** for faster queries:
   ```yaml
   - NEO4J_server_memory_pagecache_size=2g
   ```

3. **Ensure adequate Docker memory** in Docker Desktop settings

### Updating Neo4j

```bash
# Pull latest image
docker compose pull neo4j

# Recreate container
docker compose up -d neo4j
```

> **Note**: Major version upgrades may require data migration. Check Neo4j release notes.

---

## Troubleshooting

### Neo4j Won't Start

**Check password is set:**
```bash
# .env must contain:
NEO4J_PASSWORD=your-password
```

**Check Docker resources:**
- Docker Desktop → Settings → Resources
- Ensure at least 4GB memory allocated

**View startup logs:**
```bash
docker compose logs neo4j
```

### "No graph data available" Error

**Cause**: Neo4j not running or not configured.

**Solution:**
1. Start Neo4j: `docker compose --profile default up -d neo4j`
2. Apply migrations: `pk-mcp graph migrate`
3. Populate graph: `pk-mcp graph populate my-api`

### Connection Refused

**Check Neo4j is running:**
```bash
docker compose ps neo4j
```

**Check ports are accessible:**
```bash
# Bolt port
curl http://localhost:7687 2>&1 | head -1

# HTTP port
curl http://localhost:7474
```

**Verify environment variables:**
```bash
echo $NEO4J_HOST
echo $NEO4J_BOLT_PORT
```

### Authentication Failed

**Check credentials match:**
```bash
# Test with cypher-shell
docker compose exec neo4j cypher-shell -u neo4j -p your-password "RETURN 1"
```

**Reset password (if needed):**
```bash
# Stop Neo4j
docker compose stop neo4j

# Remove auth file
docker compose run --rm neo4j bash -c "rm /data/dbms/auth"

# Restart and set new password
docker compose up -d neo4j
```

### Slow Queries

**Check query metrics:**
```bash
# Via MCP tool in Claude Code
"Show graph metrics for getDependencies"
```

**Common causes:**
- Large depth parameter (use depth=1 or 2)
- Missing indexes (re-run migrations)
- Insufficient memory (increase heap)

**Add custom indexes if needed:**
```cypher
// Example: Index on file paths
CREATE INDEX file_path_index IF NOT EXISTS FOR (f:File) ON (f.path)
```

### Data Corruption

**Symptoms**: Queries return errors, container crashes repeatedly

**Solution - Reset and rebuild:**
```bash
# WARNING: Deletes all graph data
docker compose down -v
docker compose --profile default up -d neo4j
pk-mcp graph migrate
pk-mcp graph populate-all
```

---

## Related Documentation

- [Graph Tools Guide](graph-tools.md) - Using dependency and architecture tools
- [MCP Tools Reference](mcp-tools-reference.md) - Complete API documentation
- [Configuration Reference](configuration-reference.md) - All environment variables
- [Docker Operations Guide](docker-operations.md) - General Docker guidance
- [Troubleshooting Guide](troubleshooting.md) - General troubleshooting

---

**Last Updated**: 2026-01-16
