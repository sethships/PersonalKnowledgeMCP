# Graph Database Migration Guide

This guide explains how to migrate graph data from Neo4j to FalkorDB.

## Overview

The Personal Knowledge MCP supports two graph database backends:
- **Neo4j** (GPLv3 licensed) - Original implementation
- **FalkorDB** (Apache 2.0 licensed) - Recommended for commercial use

The migration tool provides a seamless way to transfer all graph data from Neo4j to FalkorDB while preserving the complete structure, including nodes, relationships, and properties.

## Quick Start

### Prerequisites

1. Both Neo4j and FalkorDB must be running:
   ```bash
   # Start both databases
   docker compose up neo4j falkordb -d
   ```

2. Configure environment variables for both databases in `.env`:
   ```bash
   # Neo4j configuration
   NEO4J_HOST=localhost
   NEO4J_BOLT_PORT=7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your-neo4j-password

   # FalkorDB configuration
   FALKORDB_HOST=localhost
   FALKORDB_PORT=6379
   FALKORDB_USER=default
   FALKORDB_PASSWORD=
   FALKORDB_GRAPH_NAME=knowledge_graph
   ```

### Dry Run (Recommended First Step)

Before performing the actual migration, run a dry run to see what would be migrated:

```bash
pk-mcp graph transfer --dry-run
```

This will:
- Connect to the source database (Neo4j)
- Export all nodes and relationships
- Report counts without writing to the target

### Perform Migration

Once you're satisfied with the dry run results, perform the actual migration:

```bash
pk-mcp graph transfer
```

The migration process:
1. Connects to both databases
2. Exports all nodes from Neo4j
3. Exports all relationships from Neo4j
4. Imports nodes into FalkorDB
5. Imports relationships into FalkorDB
6. Validates the migration by comparing counts

## CLI Reference

### Basic Usage

```bash
pk-mcp graph transfer [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --source <type>` | Source database type | `neo4j` |
| `-t, --target <type>` | Target database type | `falkordb` |
| `--dry-run` | Show what would be migrated without writing | `false` |
| `-b, --batch-size <number>` | Batch size for processing (1-10000) | `1000` |
| `--validation-samples <number>` | Number of nodes to sample for validation (0-100) | `10` |
| `-j, --json` | Output results as JSON | `false` |

### Examples

```bash
# Default migration (Neo4j to FalkorDB)
pk-mcp graph transfer

# Dry run to preview migration
pk-mcp graph transfer --dry-run

# Custom batch size for large graphs
pk-mcp graph transfer --batch-size 500

# Skip validation sampling
pk-mcp graph transfer --validation-samples 0

# Output as JSON for scripting
pk-mcp graph transfer --json

# Reverse migration (FalkorDB to Neo4j)
pk-mcp graph transfer --source falkordb --target neo4j
```

## Migration Process

### Phase 1: Export

The migration service exports all data from the source database:

1. **Nodes**: All nodes with their labels and properties are exported in batches
2. **Relationships**: All relationships with their types, endpoints, and properties are exported

Each node receives a `_source_id` property during import to enable validation and future reference.

### Phase 2: Import

Data is imported into the target database:

1. **Nodes**: Created with all original labels and properties plus `_source_id`
2. **Relationships**: Created using the `_source_id` mapping to connect nodes

### Phase 3: Validation

After import, the migration validates:

1. **Count Comparison**: Total nodes and relationships
2. **Label/Type Counts**: Counts per node label and relationship type
3. **Sample Verification**: Random nodes are checked for property equality

## Performance Considerations

### Batch Size

- Default batch size: 1000
- Reduce for memory-constrained environments: `--batch-size 100`
- Increase for faster migration on powerful systems: `--batch-size 5000`

### Large Graphs

For graphs with millions of nodes/relationships:

1. Ensure sufficient memory for both databases
2. Consider running during low-traffic periods
3. Use a smaller batch size to avoid memory issues
4. Monitor progress with the default (non-JSON) output

### Estimated Times

| Graph Size | Nodes | Relationships | Approximate Time |
|------------|-------|---------------|------------------|
| Small | <10K | <50K | < 1 minute |
| Medium | 10K-100K | 50K-500K | 1-10 minutes |
| Large | 100K-1M | 500K-5M | 10-60 minutes |
| Very Large | >1M | >5M | 1+ hours |

## Rollback Instructions

If the migration fails or needs to be reversed:

### Option 1: Clear Target and Re-run

```bash
# Clear FalkorDB graph
redis-cli -p 6379 GRAPH.DELETE knowledge_graph

# Re-run migration
pk-mcp graph transfer
```

### Option 2: Reverse Migration

```bash
# Migrate back from FalkorDB to Neo4j
pk-mcp graph transfer --source falkordb --target neo4j
```

### Option 3: Re-populate from Source Repositories

If both databases are corrupted, re-index from source:

```bash
# Clear all graph data
pk-mcp graph transfer --dry-run  # to verify source

# Remove and re-index repositories
pk-mcp update-all --force
pk-mcp graph populate-all --force
```

## Troubleshooting

### Connection Errors

**Neo4j connection failed:**
```
Error: Failed to connect to Neo4j
```
- Verify Neo4j is running: `docker compose ps neo4j`
- Check credentials in `.env`
- Verify port is accessible: `nc -zv localhost 7687`

**FalkorDB connection failed:**
```
Error: Failed to connect to FalkorDB
```
- Verify FalkorDB is running: `docker compose ps falkordb`
- Check port is accessible: `redis-cli -p 6379 ping`

### Validation Failures

**Node count mismatch:**
- Some nodes may have failed to import
- Check the import errors in the output
- Re-run with `--json` for detailed error information

**Property mismatch in samples:**
- Data transformation may have occurred
- Check for special characters in property values
- Verify date/time format handling

### Memory Issues

If you encounter memory errors:
1. Reduce batch size: `--batch-size 100`
2. Increase container memory limits in `docker-compose.yml`
3. Process in multiple sessions (pause between batches)

## Alternative: Re-indexing

For some users, re-indexing repositories may be simpler than migration:

```bash
# Switch to FalkorDB configuration
export GRAPH_PROVIDER=falkordb

# Start FalkorDB
docker compose up falkordb -d

# Apply schema to FalkorDB
pk-mcp graph migrate

# Re-populate all repositories
pk-mcp graph populate-all --force
```

This approach:
- Creates fresh, optimized graph structure
- Avoids any migration artifacts
- Requires repositories to still be indexed in ChromaDB

## Support

For issues or questions:
- Create an issue at: https://github.com/sethships/PersonalKnowledgeMCP/issues
- Include output from: `pk-mcp graph transfer --dry-run --json`
