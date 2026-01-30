# Graph Database Migration Guide: Neo4j to FalkorDB

This guide helps existing users migrate from Neo4j to FalkorDB for the Personal Knowledge MCP knowledge graph features.

## Table of Contents

- [Why We Migrated](#why-we-migrated)
- [What Changed](#what-changed)
- [New Installations](#new-installations)
- [Existing Users](#existing-users)
- [Environment Variable Changes](#environment-variable-changes)
- [Breaking Changes](#breaking-changes)
- [Troubleshooting](#troubleshooting)

---

## Why We Migrated

Personal Knowledge MCP migrated from Neo4j Community Edition to FalkorDB for **licensing reasons**.

### The Problem

Neo4j Community Edition is licensed under **GPLv3**, which has copyleft implications that conflicted with the project's MIT license goals. As the project transitioned from private to public repository, we needed a permissive-licensed alternative.

### The Solution

FalkorDB uses the **Apache 2.0** license, which is fully compatible with MIT and has no copyleft requirements.

### Benefits

| Aspect | Neo4j | FalkorDB |
|--------|-------|----------|
| License | GPLv3 (copyleft) | Apache 2.0 (permissive) |
| Cypher Support | Full | ~95% compatible |
| Memory Footprint | Higher | Lower |
| Query Performance | Good | Similar/Better |
| Docker Image Size | ~800MB | ~150MB |

For complete decision rationale, see [ADR-0004: Graph Database Migration](architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md).

---

## What Changed

### Summary

| Component | Before | After |
|-----------|--------|-------|
| Database | Neo4j Community 5.x | FalkorDB 4.x |
| Protocol | Bolt (port 7687) | Redis (port 6380) |
| Browser UI | Neo4j Browser (port 7474) | None (use redis-cli) |
| Query Language | Cypher | Cypher (compatible) |
| Docker Profile | `default` | `default` |
| Env Prefix | `NEO4J_*` | `FALKORDB_*` |

### Files Changed

- `docker-compose.yml` - Neo4j service removed, FalkorDB promoted to default profile
- `.env.example` - Neo4j variables removed, FalkorDB variables updated
- All documentation updated to reference FalkorDB

---

## New Installations

If you are setting up Personal Knowledge MCP for the first time, **no migration is needed**.

Simply follow the [FalkorDB Setup Guide](graph-database-setup.md) to get started.

---

## Existing Users

If you have an existing installation with Neo4j and graph data, follow these steps:

### Step 1: Export Your Data (Optional)

If you want to preserve your graph data, export it first:

```bash
# Connect to Neo4j and export
docker compose exec neo4j cypher-shell -u neo4j -p YOUR_PASSWORD \
  "CALL apoc.export.json.all('backup.json')"

# Copy the export file
docker cp pk-mcp-neo4j:/var/lib/neo4j/backup.json ./neo4j-backup.json
```

> **Note**: Graph data can be regenerated from your indexed repositories, so export is optional.

### Step 2: Stop Neo4j

```bash
docker compose stop neo4j
```

### Step 3: Update Your Configuration

**Update `.env` file:**

```bash
# Remove these Neo4j variables:
# NEO4J_USER=neo4j
# NEO4J_PASSWORD=...
# NEO4J_HOST=localhost
# NEO4J_BOLT_PORT=7687
# NEO4J_HTTP_PORT=7474

# Add these FalkorDB variables:
FALKORDB_HOST=localhost
FALKORDB_PORT=6380
FALKORDB_PASSWORD=your-secure-password  # Generate with: openssl rand -base64 32
FALKORDB_DATABASE=knowledge_graph
```

### Step 4: Update Docker Compose

Pull the latest docker-compose.yml that includes FalkorDB:

```bash
git pull origin main
```

### Step 5: Start FalkorDB

```bash
# Remove old Neo4j volumes (optional, frees disk space)
docker compose down -v

# Start with new configuration
docker compose --profile default up -d
```

### Step 6: Apply Schema Migrations

```bash
pk-mcp graph migrate
# Or: bun run cli graph migrate
```

### Step 7: Repopulate the Graph

Since FalkorDB is a fresh database, repopulate from your indexed repositories:

```bash
# Populate all repositories
pk-mcp graph populate-all

# Or populate specific repository
pk-mcp graph populate my-api
```

### Step 8: Verify

```bash
# Check health
pk-mcp health

# Test a query (in Claude Code)
"What does src/services/auth.ts depend on?"
```

---

## Environment Variable Changes

### Removed Variables

| Variable | Status |
|----------|--------|
| `NEO4J_USER` | Removed |
| `NEO4J_PASSWORD` | Removed |
| `NEO4J_HOST` | Removed |
| `NEO4J_BOLT_PORT` | Removed |
| `NEO4J_HTTP_PORT` | Removed |
| `NEO4J_URI` | Removed |

### New Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FALKORDB_HOST` | `localhost` | FalkorDB hostname |
| `FALKORDB_PORT` | `6380` | Redis protocol port |
| `FALKORDB_PASSWORD` | (required) | Authentication password |
| `FALKORDB_DATABASE` | `knowledge_graph` | Graph database name |

### Claude Code Configuration Update

If you have Claude Code configured with Neo4j environment variables, update your MCP configuration:

**Before:**
```json
{
  "mcpServers": {
    "personal-knowledge": {
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "${NEO4J_PASSWORD}"
      }
    }
  }
}
```

**After:**
```json
{
  "mcpServers": {
    "personal-knowledge": {
      "env": {
        "FALKORDB_HOST": "localhost",
        "FALKORDB_PORT": "6380",
        "FALKORDB_PASSWORD": "${FALKORDB_PASSWORD}",
        "FALKORDB_DATABASE": "knowledge_graph"
      }
    }
  }
}
```

---

## Breaking Changes

### Port Change

| Service | Old Port | New Port |
|---------|----------|----------|
| Graph Database | 7687 (Bolt) | 6380 (Redis) |
| Browser UI | 7474 (HTTP) | N/A |

### No Browser UI

FalkorDB does not include a built-in browser UI like Neo4j Browser. To inspect the graph:

```bash
# Use redis-cli
docker compose exec falkordb redis-cli -a your-password

# Run a Cypher query
GRAPH.QUERY knowledge_graph "MATCH (n) RETURN labels(n)[0] AS type, count(*) AS count"
```

### API Compatibility

The MCP tools (`get_dependencies`, `get_dependents`, etc.) work identically. No changes to your Claude Code workflows are needed.

---

## Troubleshooting

### "Connection refused" on port 7687

**Cause**: Still trying to connect to Neo4j

**Solution**: Update environment variables to use FalkorDB (see above)

### "No graph data available"

**Cause**: FalkorDB is empty (new installation or after migration)

**Solution**:
```bash
pk-mcp graph migrate
pk-mcp graph populate-all
```

### Graph queries return empty results

**Cause**: Data not migrated/populated

**Solution**: Repopulate from indexed repositories:
```bash
pk-mcp graph populate-all --force
```

### Old Neo4j container still running

**Solution**:
```bash
# Stop and remove Neo4j container
docker compose stop neo4j
docker compose rm neo4j

# Remove Neo4j volumes
docker volume rm pk-mcp-neo4j-data pk-mcp-neo4j-logs
```

### Cypher query syntax error

**Cause**: FalkorDB has ~95% Cypher compatibility; some advanced features may differ

**Solution**: Most standard queries work. For APOC-equivalent functions, check [FalkorDB documentation](https://docs.falkordb.com/).

---

## Related Documentation

- [FalkorDB Setup Guide](graph-database-setup.md) - New installation guide
- [ADR-0004: Graph Database Migration](architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md) - Decision rationale
- [Graph Tools Guide](graph-tools.md) - Using dependency and architecture tools
- [Troubleshooting Guide](troubleshooting.md) - General troubleshooting

---

**Last Updated**: 2026-01-29
