# FalkorDB Setup Guide

This guide covers FalkorDB installation, configuration, and usage for the Personal Knowledge MCP knowledge graph features.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Docker Compose (Recommended)](#docker-compose-recommended)
- [Configuration](#configuration)
- [Schema Setup](#schema-setup)
- [Populating the Graph](#populating-the-graph)
- [Verification](#verification)
- [Maintenance](#maintenance)
- [Troubleshooting](#troubleshooting)

---

## Overview

FalkorDB is the graph database that powers the knowledge graph features in Personal Knowledge MCP, enabling:

- **Dependency analysis** - What does this code depend on?
- **Impact analysis** - What will break if I change this?
- **Architecture visualization** - How is the codebase structured?
- **Path tracing** - How are these components connected?

FalkorDB is an Apache 2.0 licensed graph database with Cypher support, chosen for its permissive licensing and compatibility. See [ADR-0004](architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md) for the decision rationale.

### When You Need FalkorDB

| Feature | Requires FalkorDB |
|---------|-------------------|
| `semantic_search` | No |
| `list_indexed_repositories` | No |
| `get_dependencies` | **Yes** |
| `get_dependents` | **Yes** |
| `get_architecture` | **Yes** |
| `find_path` | **Yes** |
| `get_graph_metrics` | **Yes** |

If you only need semantic search, you can skip FalkorDB setup.

---

## Prerequisites

- **Docker Desktop**: For running FalkorDB container
- **At least 2GB RAM**: FalkorDB requires memory for graph operations
- **Disk space**: 500MB minimum for FalkorDB + data

---

## Installation

### Docker Compose (Recommended)

Personal Knowledge MCP includes FalkorDB in `docker-compose.yml`.

**1. Configure environment variables**

Add to your `.env` file:

```bash
# Required - FalkorDB authentication
FALKORDB_PASSWORD=your-secure-password  # Generate with: openssl rand -base64 32

# Optional - Customize settings (defaults shown)
FALKORDB_HOST=localhost
FALKORDB_PORT=6380
FALKORDB_DATABASE=knowledge_graph
```

> **Important**: `FALKORDB_PASSWORD` is required for authentication.

**2. Start FalkorDB**

```bash
# Start FalkorDB with the default profile
docker compose --profile default up -d falkordb

# Or start all services
docker compose --profile default up -d
```

**3. Verify FalkorDB is running**

```bash
# Check container status
docker compose ps falkordb

# View logs
docker compose logs falkordb

# Test connection with redis-cli
docker compose exec falkordb redis-cli -a your-password ping
```

**Expected output**: FalkorDB container running with healthy status, `PONG` response from ping.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FALKORDB_HOST` | No | `localhost` | FalkorDB hostname |
| `FALKORDB_PORT` | No | `6380` | Redis protocol port |
| `FALKORDB_PASSWORD` | Yes | - | Authentication password |
| `FALKORDB_DATABASE` | No | `knowledge_graph` | Graph database name |

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

To modify for larger codebases, update `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 4G
```

### Data Persistence

Graph data is stored in Docker volumes:
- `falkordb-data`: Graph database files

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

# Or via bun
bun run cli graph migrate
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
# Should show "FalkorDB: OK"
```

### Test Connection

```bash
# Test with redis-cli
docker compose exec falkordb redis-cli -a your-password ping
# Should return: PONG

# Test graph query
docker compose exec falkordb redis-cli -a your-password GRAPH.QUERY knowledge_graph "MATCH (n) RETURN count(n)"
```

### Test Graph Queries

**Via CLI (using MCP tools):**
```bash
# In Claude Code, ask:
"What does src/services/auth.ts depend on?"
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
docker compose exec falkordb du -sh /data
```

**View logs:**
```bash
docker compose logs falkordb --tail 100
```

**Backup data:**
```bash
# Stop FalkorDB first
docker compose stop falkordb

# Copy data volume
docker run --rm -v pk-mcp-falkordb-data:/data -v $(pwd):/backup alpine \
  tar cvf /backup/falkordb-backup.tar /data

# Restart
docker compose start falkordb
```

### Performance Tuning

For large codebases (>10K files):

1. **Increase memory** in docker-compose.yml:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 4G
   ```

2. **Ensure adequate Docker memory** in Docker Desktop settings

### Updating FalkorDB

```bash
# Pull latest image
docker compose pull falkordb

# Recreate container
docker compose up -d falkordb
```

---

## Troubleshooting

### FalkorDB Won't Start

**Check password is set:**
```bash
# .env must contain:
FALKORDB_PASSWORD=your-password
```

**Check Docker resources:**
- Docker Desktop → Settings → Resources
- Ensure at least 4GB memory allocated

**View startup logs:**
```bash
docker compose logs falkordb
```

### "No graph data available" Error

**Cause**: FalkorDB not running or not configured.

**Solution:**
1. Start FalkorDB: `docker compose --profile default up -d falkordb`
2. Apply migrations: `pk-mcp graph migrate`
3. Populate graph: `pk-mcp graph populate my-api`

### Connection Refused

**Check FalkorDB is running:**
```bash
docker compose ps falkordb
```

**Check port is accessible:**
```bash
# Test connection
docker compose exec falkordb redis-cli -a your-password ping
```

**Verify environment variables:**
```bash
echo $FALKORDB_HOST
echo $FALKORDB_PORT
```

### Authentication Failed

**Check credentials match:**
```bash
# Test with redis-cli
docker compose exec falkordb redis-cli -a your-password ping
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
- Insufficient memory (increase limit)

### Data Corruption

**Symptoms**: Queries return errors, container crashes repeatedly

**Solution - Reset and rebuild:**
```bash
# WARNING: Deletes all graph data
docker compose down -v
docker compose --profile default up -d falkordb
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
- [Migration Guide](graph-database-migration.md) - Migrating from Neo4j

---

**Last Updated**: 2026-01-29
