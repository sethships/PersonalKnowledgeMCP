# ADR-0002: Knowledge Graph Architecture

**Status:** Proposed

**Date:** 2026-01-01

**Deciders:** Architecture Team, Development Team

**Technical Story:** Phase 4 of Personal Knowledge MCP - Adding knowledge graph capabilities for code dependencies, knowledge relationships, and enhanced retrieval.

## Context and Problem Statement

The Personal Knowledge MCP currently provides semantic search via ChromaDB vector embeddings. While this enables finding similar code based on meaning, it lacks the ability to represent and traverse explicit relationships between code entities (e.g., "function A calls function B", "class C implements interface D", "file X imports module Y").

A knowledge graph database would complement the existing vector search by:
1. Enabling relationship-aware queries ("show me all functions that call this database service")
2. Supporting dependency analysis ("what would break if I modify this interface?")
3. Providing context expansion ("get related files for better RAG context assembly")
4. Enabling visualization of code structure and knowledge relationships

The user explicitly stated: "If it can be part of ChromaDB and doesn't need to be another instance, ok, but we shouldn't necessarily optimize for that. Instead we should consider what kind of graph storage medium would be best and how to best surface it in the tool."

## Decision Drivers

- **Query Performance**: Graph traversals must complete within 100ms target (per PRD)
- **Integration Simplicity**: Must work alongside existing ChromaDB without architectural conflicts
- **Deployment Consistency**: Should fit the existing Docker Compose and Kubernetes/Helm patterns
- **Licensing**: Must be open-source with non-copyleft license acceptable for commercial use
- **Resource Efficiency**: Must run on home lab hardware (reasonable CPU/memory footprint)
- **Developer Experience**: Native TypeScript/JavaScript client support preferred
- **Operational Maturity**: Production-ready with good documentation and community support
- **Query Expressiveness**: Rich graph query language for complex traversal patterns

## Considered Options

### Option 1: Neo4j Community Edition

**Description:** Neo4j is the most widely deployed graph database. Community Edition provides full graph functionality with ACID compliance, native graph storage, and the Cypher query language.

**Pros:**
- Industry-leading graph database with mature ecosystem
- Cypher query language is highly expressive and well-documented
- Excellent TypeScript/JavaScript driver (`neo4j-driver` npm package)
- Already configured in project's docker-compose.yml and Helm chart (disabled)
- Strong community support and extensive documentation
- ACID-compliant with CAUSAL consistency
- Built-in visualization via Neo4j Browser
- Scales well for medium-sized graphs (millions of nodes)
- Native graph storage optimized for traversals

**Cons:**
- Community Edition limits: No clustering, no hot backups, no RBAC
- Higher memory footprint compared to alternatives (512MB-2GB baseline)
- Learning curve for Cypher (though well-documented)
- Commercial features require Enterprise license
- Relatively heavy container image (~500MB)

**Licensing:** GPL v3 for Community Edition (concerns for proprietary integration, but acceptable for personal project)

### Option 2: Memgraph

**Description:** Memgraph is an in-memory graph database compatible with Cypher, focusing on high-performance real-time graph analytics.

**Pros:**
- Very fast query performance (in-memory)
- Cypher-compatible (reuse existing Cypher knowledge)
- Smaller memory footprint for small graphs
- Docker-ready with official images
- Open-source with permissive Memgraph license
- TypeScript client available
- Good for real-time streaming scenarios

**Cons:**
- Less mature ecosystem than Neo4j
- Smaller community and documentation
- In-memory by default (persistence requires configuration)
- Less proven at scale
- Fewer integrations and tooling options
- Not currently configured in project infrastructure

**Licensing:** Memgraph Community (BSL-based, free for non-commercial, time-limited for commercial)

### Option 3: ArangoDB (Multi-Model with Graph)

**Description:** ArangoDB is a multi-model database supporting document, key-value, and graph data models with a unified query language (AQL).

**Pros:**
- Multi-model: Could replace both document store and graph DB
- AQL supports graph traversals with document joins
- Single database for multiple use cases
- Good TypeScript support via `arangojs`
- Active open-source community
- Scales horizontally
- Smart graphs for distributed processing

**Cons:**
- Not a native graph database (performance trade-offs for pure graph workloads)
- Different query language (AQL instead of Cypher)
- More complex than dedicated graph DB
- Not currently configured in project infrastructure
- Would require significant refactoring to replace existing storage
- Overkill for focused graph use case

**Licensing:** Apache 2.0 (very permissive)

### Option 4: TypeDB

**Description:** TypeDB (formerly Grakn) is a strongly-typed database with a schema language and reasoning engine.

**Pros:**
- Built-in reasoning and inference capabilities
- Strong schema enforcement
- TypeScript client available
- Good for complex ontologies and knowledge representation
- Pattern-based query language (TypeQL)

**Cons:**
- Steeper learning curve (new paradigm)
- Smaller community than Neo4j
- Heavier resource requirements
- Not Cypher-compatible
- Less battle-tested in production
- Not currently configured in project infrastructure

**Licensing:** AGPL v3 (copyleft concerns)

### Option 5: Native Graph Extension for ChromaDB (Future)

**Description:** Wait for or contribute to native graph capabilities in ChromaDB.

**Pros:**
- Single storage system to manage
- No additional operational complexity
- Seamless integration with existing vector search

**Cons:**
- ChromaDB has no current graph support and no roadmap for it
- Unlikely to happen in near term
- Would delay graph functionality indefinitely
- Vector DBs and graph DBs have fundamentally different optimization goals

## Decision Outcome

**Chosen option:** "Neo4j Community Edition", because:

1. **Already Integrated**: Neo4j is already configured in docker-compose.yml and Helm chart values.yaml, just disabled. Minimal infrastructure work required.

2. **Mature Ecosystem**: Neo4j's Cypher language, tooling (Neo4j Browser), and documentation are industry-leading. This reduces implementation risk and learning curve.

3. **Proven at Scale**: Neo4j handles millions of nodes and relationships efficiently, which covers the project's scale (multiple repositories with 100K+ files).

4. **Excellent TypeScript Support**: The `neo4j-driver` package is well-maintained and follows modern TypeScript patterns consistent with the existing codebase.

5. **Complementary Architecture**: Neo4j excels at relationship traversal while ChromaDB excels at semantic similarity. Using both provides best-of-breed capabilities without compromise.

6. **Community Edition Sufficient**: For a personal knowledge management system, Community Edition limitations (no clustering, no hot backups) are acceptable. Single-instance deployment is the target.

7. **Graph Query Expressiveness**: Cypher provides powerful pattern matching for complex queries like multi-hop relationships, path finding, and subgraph extraction.

### Positive Consequences

- Enables rich relationship queries not possible with vector search alone
- Supports dependency analysis for impact assessment during refactoring
- Provides foundation for knowledge graph visualization (future feature)
- Complements semantic search with structural/relational context
- Fits existing deployment patterns and infrastructure definitions
- Well-documented path for team knowledge sharing

### Negative Consequences

- Increases operational complexity (additional container to manage)
- Higher memory footprint (additional 512MB-2GB for Neo4j)
- Community Edition GPL license requires careful consideration for any commercial use
- Two query languages to maintain (SQL-like for vector search, Cypher for graph)
- Data synchronization between vector and graph stores adds complexity

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Performance degradation with large graphs | Implement pagination, use indexed properties, benchmark regularly |
| Data inconsistency between ChromaDB and Neo4j | Design idempotent sync operations, use transaction patterns where possible |
| GPL licensing concerns for future commercial use | Keep graph layer decoupled; could swap to Memgraph if commercialization becomes priority |
| Increased memory pressure on home lab | Configure Neo4j memory limits appropriately; add to resource monitoring |
| Query complexity with Cypher learning curve | Start with simple patterns, document common queries, build query helpers |

## Architecture Design

### High-Level Integration

```
+------------------+     +-------------------+     +------------------+
|   Claude Code    |     |   MCP Service     |     |    Storage       |
|   (MCP Client)   |<--->|   (Node.js/TS)    |<--->|    Layer         |
+------------------+     +-------------------+     +------------------+
                                  |                        |
                                  v                        v
                         +----------------+       +------------------+
                         |  Query Router  |       |  ChromaDB        |
                         +----------------+       |  (Vector Search) |
                               |    |             +------------------+
                               |    |                     ^
                               |    |                     |
                               |    +-------------------- | ----+
                               |                          |     |
                               v                          v     v
                         +------------------+     +------------------+
                         |   Neo4j Graph    |<--->|  Sync Service    |
                         |   (Relationships)|     |  (Consistency)   |
                         +------------------+     +------------------+
```

### Container Architecture (Docker Compose)

```yaml
# Existing services:
# - chromadb (vector search, semantic similarity)
# - postgres (document store, metadata)

# New service (already defined, needs implementation):
neo4j:
  image: neo4j:5.25.1-community
  container_name: pk-mcp-neo4j
  ports:
    - "127.0.0.1:7474:7474"  # HTTP (Browser)
    - "127.0.0.1:7687:7687"  # Bolt (Driver)
  volumes:
    - neo4j-data:/data
    - neo4j-logs:/logs
  environment:
    - NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}
    - NEO4J_server_memory_heap_initial__size=512m
    - NEO4J_server_memory_heap_max__size=1g
    - NEO4J_server_memory_pagecache_size=512m
```

### Kubernetes/Helm Integration

The existing Helm chart already has Neo4j configuration (disabled by default). To enable:

```yaml
# values.yaml override
neo4j:
  enabled: true
  resources:
    requests:
      memory: "512Mi"
      cpu: "500m"
    limits:
      memory: "2Gi"
      cpu: "2"
  persistence:
    enabled: true
    size: 10Gi
```

Additional manifests needed:
- Network policy: allow MCP service to Neo4j (Bolt port 7687)
- Service account annotations if using cloud-native features
- Init container for schema migration

## Data Model Design

### Node Types (Labels)

| Label | Description | Key Properties |
|-------|-------------|----------------|
| `Repository` | Indexed code repository | `name`, `url`, `lastIndexed`, `status` |
| `File` | Source code or documentation file | `path`, `extension`, `hash`, `repository` |
| `Function` | Function or method definition | `name`, `signature`, `startLine`, `endLine`, `filePath` |
| `Class` | Class or interface definition | `name`, `type` (class/interface/enum), `filePath` |
| `Module` | ES module or package | `name`, `type` (npm/local), `version` |
| `Chunk` | Vector store chunk reference | `chromaId`, `chunkIndex`, `filePath` |
| `Concept` | Semantic concept or topic | `name`, `description`, `confidence` |

### Relationship Types

| Relationship | From -> To | Description | Properties |
|--------------|------------|-------------|------------|
| `CONTAINS` | Repository -> File | Repo contains file | - |
| `DEFINES` | File -> Function/Class | File defines code entity | `startLine`, `endLine` |
| `IMPORTS` | File -> Module | Import/require statement | `importType` (named/default/namespace) |
| `CALLS` | Function -> Function | Function call relationship | `callCount`, `isAsync` |
| `IMPLEMENTS` | Class -> Class | Interface implementation | - |
| `EXTENDS` | Class -> Class | Class inheritance | - |
| `REFERENCES` | File -> File | Documentation reference | `linkText`, `context` |
| `HAS_CHUNK` | File -> Chunk | Link to vector store | `chunkIndex` |
| `RELATED_TO` | Concept -> Concept | Semantic relationship | `similarity`, `relationshipType` |
| `TAGGED_WITH` | File/Function/Class -> Concept | Semantic tagging | `confidence` |

### Schema Definition (Cypher)

```cypher
// Constraints for uniqueness and performance
CREATE CONSTRAINT repo_name IF NOT EXISTS FOR (r:Repository) REQUIRE r.name IS UNIQUE;
CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE (f.repository, f.path) IS NODE KEY;
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.chromaId IS UNIQUE;
CREATE CONSTRAINT concept_name IF NOT EXISTS FOR (co:Concept) REQUIRE co.name IS UNIQUE;

// Indexes for common query patterns
CREATE INDEX file_extension IF NOT EXISTS FOR (f:File) ON (f.extension);
CREATE INDEX function_name IF NOT EXISTS FOR (fn:Function) ON (fn.name);
CREATE INDEX class_name IF NOT EXISTS FOR (c:Class) ON (c.name);
CREATE INDEX module_name IF NOT EXISTS FOR (m:Module) ON (m.name);

// Full-text index for searching code entity names
CREATE FULLTEXT INDEX entity_names IF NOT EXISTS
FOR (n:Function|Class|Module) ON EACH [n.name];
```

### Linking Vector and Graph Stores

The `Chunk` node creates a bridge between Neo4j and ChromaDB:

```
ChromaDB Document                    Neo4j Graph
+------------------+                 +------------------+
| id: "repo:path:0"|<--------------->| (c:Chunk)        |
| embedding: [...]  |                 |  chromaId: "..."  |
| metadata: {...}   |                 |  chunkIndex: 0   |
+------------------+                 +------------------+
                                            |
                                            | HAS_CHUNK
                                            v
                                     +------------------+
                                     | (f:File)         |
                                     |  path: "..."     |
                                     +------------------+
                                            |
                                            | DEFINES
                                            v
                                     +------------------+
                                     | (fn:Function)    |
                                     |  name: "..."     |
                                     +------------------+
```

This enables queries like:
- "Find similar code, then show what functions reference the matches"
- "Find all callers of functions in semantically similar files"

## MCP Tool Design

### New MCP Tools for Graph Capabilities

#### 1. `graph_traverse`

**Purpose:** Traverse relationships from a starting point

```typescript
interface GraphTraverseInput {
  // Starting point (file path, function name, or concept)
  startNode: {
    type: "file" | "function" | "class" | "concept";
    identifier: string;  // path for files, name for others
    repository?: string; // optional repo filter
  };
  // Relationship types to follow
  relationships: Array<"CALLS" | "IMPORTS" | "DEFINES" | "REFERENCES" | "EXTENDS" | "IMPLEMENTS">;
  // Traversal depth (1-5, default 2)
  depth?: number;
  // Maximum results
  limit?: number;
}

interface GraphTraverseResult {
  nodes: Array<{
    id: string;
    type: string;
    properties: Record<string, unknown>;
  }>;
  relationships: Array<{
    from: string;
    to: string;
    type: string;
    properties: Record<string, unknown>;
  }>;
  metadata: {
    nodesCount: number;
    relationshipsCount: number;
    queryTimeMs: number;
  };
}
```

#### 2. `graph_dependencies`

**Purpose:** Analyze dependencies for impact assessment

```typescript
interface GraphDependenciesInput {
  // Target file or function
  target: {
    type: "file" | "function" | "class";
    identifier: string;
    repository: string;
  };
  // Direction of analysis
  direction: "dependsOn" | "dependedOnBy" | "both";
  // Include transitive dependencies
  transitive?: boolean;
  // Maximum depth for transitive
  maxDepth?: number;
}

interface GraphDependenciesResult {
  direct: Array<DependencyInfo>;
  transitive?: Array<DependencyInfo>;
  impactScore: number; // 0-1, how many things depend on this
  metadata: {
    directCount: number;
    transitiveCount: number;
    queryTimeMs: number;
  };
}
```

#### 3. `graph_context`

**Purpose:** Get related context for RAG enhancement

```typescript
interface GraphContextInput {
  // Seed from semantic search results or explicit files
  seeds: Array<{
    type: "file" | "chunk" | "function";
    identifier: string;
    repository?: string;
  }>;
  // Types of context to include
  includeContext: Array<"imports" | "callers" | "callees" | "siblings" | "documentation">;
  // Maximum context items
  limit?: number;
}

interface GraphContextResult {
  context: Array<{
    type: string;
    path: string;
    repository: string;
    relevance: number;
    reason: string; // why this is included
  }>;
  metadata: {
    seedsProcessed: number;
    contextItemsFound: number;
    queryTimeMs: number;
  };
}
```

#### 4. `graph_search`

**Purpose:** Search graph by patterns (power user tool)

```typescript
interface GraphSearchInput {
  // Natural language query (translated to Cypher)
  query?: string;
  // Or explicit Cypher pattern (advanced)
  cypherPattern?: string;
  // Repository filter
  repository?: string;
  // Maximum results
  limit?: number;
}
```

### Combined Search: Vector + Graph

The most powerful capability is combining semantic search with graph traversal:

```typescript
// Example: "Find authentication code and show what calls it"

// Step 1: Semantic search in ChromaDB
const semanticResults = await searchService.search({
  query: "JWT authentication middleware",
  limit: 5,
  threshold: 0.8
});

// Step 2: Expand with graph context
const expandedContext = await graphService.getContext({
  seeds: semanticResults.results.map(r => ({
    type: "chunk",
    identifier: r.chromaId,
    repository: r.repository
  })),
  includeContext: ["callers", "imports"],
  limit: 20
});

// Step 3: Return combined results
// Semantic matches + their callers + their imports
```

This could be exposed as a single MCP tool: `enhanced_search`

```typescript
interface EnhancedSearchInput {
  query: string;
  limit?: number;
  threshold?: number;
  repository?: string;
  // Graph expansion options
  expandWith?: {
    relationships: string[];
    depth: number;
  };
}
```

## Integration Strategy

### Phase 1: Graph Infrastructure (Week 1-2)

1. **Enable Neo4j in docker-compose.yml** (already defined)
2. **Create Neo4j storage adapter** following ChromaDB pattern:
   - `src/storage/neo4j-client.ts` - Connection and query handling
   - `src/storage/neo4j-types.ts` - Type definitions
   - `src/storage/neo4j-errors.ts` - Error classes
3. **Add Neo4j to MCP server initialization**
4. **Create schema migration tool**

### Phase 2: Data Population (Week 3-4)

1. **Extend AST parsing** (tree-sitter integration):
   - Extract function definitions and calls
   - Extract class hierarchies
   - Extract import statements
2. **Create graph population service**:
   - `src/services/graph-population-service.ts`
   - Batch processing for initial indexing
   - Incremental updates for changed files
3. **Sync service** for maintaining consistency:
   - Listen for ChromaDB indexing events
   - Populate graph nodes and relationships
   - Handle file deletions and updates

### Phase 3: MCP Tools (Week 5-6)

1. **Implement graph MCP tools**:
   - `graph_traverse`
   - `graph_dependencies`
   - `graph_context`
   - `graph_search`
2. **Implement enhanced_search** combining vector and graph
3. **Add to tool registry**

### Phase 4: Testing and Optimization (Week 7-8)

1. **Performance testing** against 100ms target
2. **Integration tests** with real repositories
3. **Query optimization** based on benchmarks
4. **Documentation** and examples

## Consistency Between Stores

### Write Path (During Indexing)

```
Repository Change Detected
         |
         v
+------------------+
| Ingestion        |
| Service          |
+------------------+
         |
    +----+----+
    |         |
    v         v
+-------+  +-------+
|ChromaDB|  | Neo4j |
|Vectors |  | Graph |
+-------+  +-------+
         |
         v
+------------------+
| Metadata Store   |
| (PostgreSQL)     |
+------------------+
```

Key principle: **Dual-write with ChromaDB as primary**

1. ChromaDB receives chunks first (existing flow)
2. On successful ChromaDB write, trigger graph population
3. Store sync status in PostgreSQL metadata
4. If graph write fails, mark for retry (don't block indexing)

### Read Path (During Query)

1. **Vector-only queries**: Go directly to ChromaDB (existing behavior)
2. **Graph-only queries**: Go directly to Neo4j
3. **Combined queries**: Orchestrated by query router service

### Handling Inconsistencies

- **Stale graph data**: Include `lastSynced` timestamp; allow queries with freshness tolerance
- **Missing graph nodes**: Gracefully degrade to vector-only results
- **Orphaned relationships**: Periodic cleanup job (weekly)

## Performance Considerations

### Query Optimization

1. **Indexed Properties**: All frequently-filtered properties are indexed
2. **Relationship Limits**: Default traversal depth of 2, max of 5
3. **Pagination**: All graph queries support offset/limit
4. **Query Caching**: Common patterns cached (e.g., module dependency trees)

### Memory Management

```yaml
# Neo4j memory configuration
NEO4J_server_memory_heap_initial__size: 512m
NEO4J_server_memory_heap_max__size: 1g      # For home lab
NEO4J_server_memory_pagecache_size: 512m    # For disk-based storage
```

For graphs up to 1M nodes + 5M relationships, this configuration is adequate.

### Benchmark Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Simple traversal (depth 1) | <20ms | Direct relationship lookup |
| Complex traversal (depth 3) | <100ms | Multi-hop with filtering |
| Dependency analysis | <100ms | Impact assessment |
| Graph context expansion | <50ms | For RAG enhancement |
| Combined vector+graph | <300ms | End-to-end enhanced search |

## Implementation Notes

### Neo4j Driver Usage

```typescript
// src/storage/neo4j-client.ts
import neo4j, { Driver, Session, Result } from "neo4j-driver";

export class Neo4jStorageClientImpl implements Neo4jStorageClient {
  private driver: Driver | null = null;

  async connect(config: Neo4jConfig): Promise<void> {
    this.driver = neo4j.driver(
      `bolt://${config.host}:${config.port}`,
      neo4j.auth.basic(config.username, config.password),
      {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 30000,
      }
    );

    // Verify connectivity
    await this.driver.verifyConnectivity();
  }

  async runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    const session = this.driver!.session();
    try {
      const result = await session.run(cypher, params);
      return result.records.map(record => record.toObject() as T);
    } finally {
      await session.close();
    }
  }
}
```

### Example Cypher Queries

```cypher
// Find all functions that call a specific function
MATCH (caller:Function)-[:CALLS]->(target:Function {name: $functionName})
WHERE target.repository = $repository
RETURN caller.name, caller.filePath, caller.signature
ORDER BY caller.name
LIMIT $limit

// Get import dependency tree
MATCH path = (f:File {path: $filePath, repository: $repo})-[:IMPORTS*1..3]->(m:Module)
RETURN path

// Find related concepts for RAG context
MATCH (seed:Chunk {chromaId: $chromaId})<-[:HAS_CHUNK]-(f:File)
MATCH (f)-[:DEFINES]->(entity)-[:TAGGED_WITH]->(c:Concept)
WITH c, COUNT(entity) as relevance
ORDER BY relevance DESC
LIMIT 10
RETURN c.name, c.description, relevance
```

## Validation Criteria

This decision will be validated as successful if:

1. **Performance**: Graph traversals complete within 100ms p95
2. **Integration**: MCP tools work seamlessly with Claude Code
3. **Value**: Users can answer dependency questions not possible with vector search alone
4. **Reliability**: No increase in system instability or failures
5. **Resource**: Neo4j runs within 2GB memory limit on home lab
6. **Sync**: Vector and graph stores remain consistent within 5-minute tolerance

## Links

- [Phase 1 System Design Document](../Phase1-System-Design-Document.md)
- [High-level PRD](../../High-level-Personal-Knowledge-MCP-PRD.md) - Phase 4 planning
- [Docker Compose Configuration](../../../docker-compose.yml) - Neo4j already defined
- [Helm Chart Values](../../../charts/personal-knowledge-mcp/values.yaml) - Neo4j configuration
- [Neo4j TypeScript Driver Documentation](https://neo4j.com/docs/javascript-manual/current/)
- [Cypher Query Language Reference](https://neo4j.com/docs/cypher-manual/current/)

## Appendix A: Alternative Consideration - ChromaDB-Only Approach

While ChromaDB does not have native graph support, some graph-like queries can be simulated:

```typescript
// Pseudo-graph: Store relationships as metadata
{
  id: "repo:path:chunk",
  metadata: {
    imports: ["module-a", "module-b"],  // Stored as array
    exports: ["functionX", "classY"],
    calls: ["otherModule.functionZ"]
  }
}

// Query with metadata filtering
collection.query({
  where: { imports: { $contains: "module-a" } }
});
```

**Why this was rejected:**
- Limited query expressiveness (no multi-hop traversal)
- No relationship properties
- Poor performance for complex patterns
- Metadata explosion for densely connected code
- No path-finding or graph algorithms

ChromaDB should remain focused on what it does best: vector similarity search.

## Appendix B: Future Enhancements

Once the basic graph integration is established, consider:

1. **Graph Algorithms**: PageRank for code importance, community detection for module boundaries
2. **Inference**: Automatic relationship discovery from code patterns
3. **Visualization**: Neo4j Browser integration or custom visualization component
4. **Cross-Repository Analysis**: Finding patterns and relationships across multiple codebases
5. **Time-based Analysis**: Tracking how relationships evolve over commits

These are explicitly out of scope for the initial implementation but represent the value a graph database unlocks.

---

**Document History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-01 | Architecture Team | Initial ADR for knowledge graph integration |
