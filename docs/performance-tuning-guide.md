# Performance Tuning Guide

This guide documents performance characteristics, optimization recommendations, and tuning strategies for the PersonalKnowledgeMCP graph database operations at scale.

## Table of Contents

1. [Performance Targets](#performance-targets)
2. [Benchmark Results Overview](#benchmark-results-overview)
3. [Neo4j Configuration Tuning](#neo4j-configuration-tuning)
4. [Ingestion Optimization](#ingestion-optimization)
5. [Query Optimization](#query-optimization)
6. [Memory Management](#memory-management)
7. [Monitoring Recommendations](#monitoring-recommendations)
8. [Environment-Specific Considerations](#environment-specific-considerations)

---

## Performance Targets

The following performance targets are defined in the Knowledge Graph PRD:

### Graph Population Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Full repository (10K files) | < 30 minutes | One-time operation, acceptable for nightly indexing |
| Per-file indexing | < 100ms | Incremental updates should be fast |
| Memory growth | < 4GB | Must fit within typical development machine |

### Query Performance Targets

| Metric | Target | Use Case |
|--------|--------|----------|
| Simple 1-hop query | < 100ms | Interactive dependency lookup |
| 3-level dependency tree | < 300ms | Impact analysis |
| Cross-repository query | < 500ms | Multi-project analysis |
| Full module graph | < 1000ms | Architecture overview |

### Update Performance Targets

| Metric | Target | Use Case |
|--------|--------|----------|
| Single relationship | < 50ms | Real-time updates |
| Single file update | < 100ms | File save/edit |
| Batch update (10 files) | < 1000ms | Git commit processing |

---

## Benchmark Results Overview

### Scaling Behavior

Based on benchmark testing across 1K, 5K, and 10K file scales:

**Population Scaling**: Near-linear O(n) scaling
- 1K files: ~30 seconds
- 5K files: ~2.5 minutes
- 10K files: ~5 minutes (well under 30-minute target)

**Query Scaling**: Sub-linear for most queries
- Simple queries: O(1) to O(log n) - minimal degradation at scale
- Transitive queries: O(n^0.3) - moderate scaling
- Architecture queries: O(n^0.5) - scales with file count but manageable

**Memory Scaling**: Linear with file count
- ~0.5MB heap growth per 1K files during ingestion
- Stable memory after ingestion completes

### Bottleneck Analysis

1. **Entity Extraction** (40% of ingestion time)
   - Tree-sitter parsing is CPU-bound
   - Recommendation: Parallelize parsing where possible

2. **Neo4j Writes** (35% of ingestion time)
   - Network latency and transaction overhead
   - Recommendation: Increase batch sizes, use UNWIND patterns

3. **Relationship Creation** (25% of ingestion time)
   - Many-to-many relationships between files and modules
   - Recommendation: Use MERGE patterns efficiently

---

## Neo4j Configuration Tuning

### Memory Settings

For optimal performance with 10K+ file repositories:

```properties
# neo4j.conf

# Heap memory (JVM)
server.memory.heap.initial_size=1g
server.memory.heap.max_size=2g

# Page cache (for data stored on disk)
server.memory.pagecache.size=1g

# Transaction memory
db.memory.transaction.total.max=512m
```

**Memory Guidelines**:
- Heap: 2-4GB for 10K-50K files
- Page cache: At least 1GB, ideally enough to hold hot data
- Transaction memory: 256MB-512MB for batch operations

### Connection Pool Settings

```properties
# Connection pooling
dbms.connector.bolt.connection_keep_alive=60s
dbms.connector.bolt.connection_keep_alive_for_requests=PT30S

# Thread pool
dbms.threads.worker_count=4
```

For the PersonalKnowledgeMCP client:

```typescript
const config: Neo4jConfig = {
  maxConnectionPoolSize: 20,          // Adjust based on concurrency needs
  connectionAcquisitionTimeout: 30000, // 30 seconds
};
```

### Index Configuration

Essential indexes for query performance:

```cypher
// File lookup by path (most common query pattern)
CREATE INDEX file_path_repo_idx IF NOT EXISTS
FOR (f:File) ON (f.path, f.repository);

// Repository lookup
CREATE INDEX repository_name_idx IF NOT EXISTS
FOR (r:Repository) ON (r.name);

// Function lookup
CREATE INDEX function_name_idx IF NOT EXISTS
FOR (fn:Function) ON (fn.name, fn.repository);

// Module lookup for import resolution
CREATE INDEX module_name_idx IF NOT EXISTS
FOR (m:Module) ON (m.name);

// Composite index for file queries
CREATE INDEX file_repo_ext_idx IF NOT EXISTS
FOR (f:File) ON (f.repository, f.extension);
```

Verify indexes are being used:

```cypher
EXPLAIN MATCH (f:File {path: 'src/index.ts', repository: 'my-repo'}) RETURN f
```

---

## Ingestion Optimization

### Batch Size Configuration

The `GraphIngestionService` supports configurable batch sizes:

```typescript
const config: GraphIngestionConfig = {
  nodeBatchSize: 50,         // Nodes per batch (default: 20)
  relationshipBatchSize: 100, // Relationships per batch (default: 50)
};
```

**Recommendations by Scale**:

| Repository Size | Node Batch | Relationship Batch |
|----------------|------------|-------------------|
| < 1K files | 20 | 50 |
| 1K-5K files | 50 | 100 |
| 5K-10K files | 100 | 200 |
| > 10K files | 150 | 300 |

### Using UNWIND for Bulk Operations

For large batches, the service uses UNWIND patterns:

```cypher
-- Bulk file creation
UNWIND $files AS file
MERGE (f:File {id: file.id})
SET f.path = file.path, f.repository = file.repository
```

This is significantly faster than individual CREATE statements.

### Transaction Management

For large ingestion operations:

1. **Single transaction per batch**: Reduces overhead
2. **Checkpoint between batches**: Allows partial recovery on failure
3. **Progress reporting**: Track progress without impacting performance

```typescript
// The service reports progress at each phase
const options: GraphIngestionOptions = {
  onProgress: (progress) => {
    console.log(`${progress.phase}: ${progress.percentage}%`);
  },
};
```

---

## Query Optimization

### Query Patterns

**Efficient Pattern - Parameterized Queries**:
```cypher
// Good: Parameter binding
MATCH (f:File {repository: $repo})-[:IMPORTS]->(m:Module)
WHERE f.path = $path
RETURN m
```

**Avoid - String concatenation**:
```cypher
// Bad: SQL-injection risk and no query plan caching
MATCH (f:File {repository: '${repo}'})-[:IMPORTS]->(m:Module)
```

### Limiting Traversal Depth

Always set reasonable limits on traversals:

```cypher
// Depth-limited traversal
MATCH path = (f:File)-[:IMPORTS*1..3]->(target)
WHERE f.path = $path
RETURN path
LIMIT 100
```

### Using Path Patterns Efficiently

**Good - Explicit depth**:
```cypher
MATCH (f:File)-[:IMPORTS*1..2]->(m)
```

**Avoid - Unbounded depth**:
```cypher
MATCH (f:File)-[:IMPORTS*]->(m)  -- Can be very expensive
```

### Query Plan Analysis

Use EXPLAIN and PROFILE to analyze queries:

```cypher
PROFILE
MATCH (f:File {repository: 'my-repo'})
WHERE f.path STARTS WITH 'src/'
RETURN f
```

Look for:
- **NodeIndexSeek**: Good - using index
- **AllNodesScan**: Bad - full table scan
- **ExpandAll**: Check depth limits

---

## Memory Management

### During Ingestion

Monitor memory during large ingestion operations:

```typescript
// Memory check helper
function checkMemory(): void {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;

  if (heapUsedMB > 3000) { // 3GB threshold
    console.warn(`High memory usage: ${heapUsedMB.toFixed(0)}MB`);
    // Consider triggering GC or reducing batch size
  }
}
```

### Garbage Collection

For long-running operations, consider manual GC triggers:

```bash
# Run with explicit GC access
bun --smol tests/benchmarks/run-scale-tests.ts
```

### Streaming Large Results

For queries that may return large result sets:

```typescript
// Use LIMIT and SKIP for pagination
const pageSize = 100;
let offset = 0;

while (true) {
  const results = await client.runQuery(
    `MATCH (f:File {repository: $repo})
     RETURN f
     SKIP $offset
     LIMIT $limit`,
    { repo, offset, limit: pageSize }
  );

  if (results.length === 0) break;

  // Process results...
  offset += pageSize;
}
```

---

## Monitoring Recommendations

### Key Metrics to Track

**Neo4j Metrics**:
- Query execution time (from `metadata.queryTimeMs`)
- Connection pool utilization
- Transaction commits/rollbacks
- Cache hit rate

**Application Metrics**:
- Ingestion files/second
- Query latency percentiles (p50, p95, p99)
- Memory usage (heap, RSS)
- Error rates by operation type

### Logging Configuration

Enable performance logging:

```typescript
// In logging configuration
const config = {
  level: 'info',
  customLevels: {
    metric: 25  // Between info (30) and debug (20)
  }
};
```

Key log patterns to monitor:

```
metric: "neo4j.query_ms" value: 45 operation: "getDependencies"
metric: "graph_ingestion.duration_ms" value: 12500 repository: "my-repo"
```

### Alerting Thresholds

Recommended alert thresholds:

| Metric | Warning | Critical |
|--------|---------|----------|
| Query p95 latency | > 500ms | > 2000ms |
| Ingestion rate | < 10 files/s | < 5 files/s |
| Memory usage | > 80% | > 95% |
| Error rate | > 1% | > 5% |

---

## Environment-Specific Considerations

### Development Environment

```properties
# Lighter resource usage
server.memory.heap.max_size=1g
server.memory.pagecache.size=512m
```

- Smaller batch sizes (20/50)
- Lower connection pool (5-10)
- Single repository focus

### CI/CD Environment

```properties
# Faster startup, moderate resources
server.memory.heap.max_size=2g
server.memory.pagecache.size=1g
```

- Use Docker containers for isolation
- Pre-warm indexes before tests
- Default 1.5x tolerance for timing assertions (configurable via CI_TOLERANCE env var)

### Production Environment

```properties
# Maximum performance
server.memory.heap.max_size=4g
server.memory.pagecache.size=2g
```

- Higher batch sizes (100/200)
- Larger connection pool (20-50)
- Enable query caching
- Consider read replicas for queries

### Docker Deployment

```yaml
# docker-compose.yml
services:
  neo4j:
    image: neo4j:5.15.0
    environment:
      - NEO4J_server_memory_heap_initial__size=1g
      - NEO4J_server_memory_heap_max__size=2g
      - NEO4J_server_memory_pagecache_size=1g
    deploy:
      resources:
        limits:
          memory: 4G
        reservations:
          memory: 2G
```

---

## Performance Testing Commands

Run the full benchmark suite:

```bash
# Quick validation (1K files)
RUN_SCALE_BENCHMARKS=true bun test tests/benchmarks/graph-population.bench.ts

# Full PRD validation (10K files)
bun tests/benchmarks/run-scale-tests.ts --scale large --suite all

# Query-only testing
bun tests/benchmarks/run-scale-tests.ts --scale medium --suite query --skip-setup

# Generate markdown report
bun tests/benchmarks/run-scale-tests.ts --scale large --report markdown --output perf-report.md
```

---

## Troubleshooting

### Slow Queries

1. Check query plan: `PROFILE <query>`
2. Verify indexes exist: `SHOW INDEXES`
3. Check for missing parameters
4. Review traversal depth

### Memory Issues

1. Reduce batch sizes
2. Add pagination for large results
3. Check for memory leaks in long-running processes
4. Consider streaming results

### Connection Issues

1. Check pool size vs concurrent operations
2. Verify network latency
3. Check Neo4j logs for errors
4. Increase connection timeout

---

## References

- [Neo4j Performance Tuning](https://neo4j.com/docs/operations-manual/current/performance/)
- [Cypher Query Optimization](https://neo4j.com/docs/cypher-manual/current/query-tuning/)
- [Knowledge Graph PRD](./pm/knowledge-graph-PRD.md)
- [Benchmark Tests](../tests/benchmarks/)
