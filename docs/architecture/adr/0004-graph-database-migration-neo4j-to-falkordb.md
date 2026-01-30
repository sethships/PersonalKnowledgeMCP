# ADR-0004: Graph Database Migration from Neo4j to FalkorDB

## Status

Implemented

## Date

2026-01-26

## Implementation Date

2026-01-29

## Context

Personal Knowledge MCP uses Neo4j Community Edition for its knowledge graph features (Phase 5). However, Neo4j Community Edition is licensed under **GPLv3**, which has copyleft implications that conflict with the project's MIT license goals.

The project is transitioning from private to public repository. To maintain a fully permissive license stack, we need to replace Neo4j with a permissive-licensed alternative.

### Current Neo4j Usage

- **Graph Storage**: Code dependency graph with functions, classes, imports, relationships
- **MCP Tools**: get_dependencies, get_dependents, get_architecture, find_path, get_graph_metrics
- **Query Language**: Cypher
- **Integration**: AST parsing for 13 languages, incremental updates

### Alternatives Evaluated

| Database | License | Cypher Compatible | Migration Effort |
|----------|---------|-------------------|------------------|
| FalkorDB | Apache 2.0 | Yes (95%+) | Small-Medium |
| Apache AGE | Apache 2.0 | OpenCypher | Medium |
| Memgraph | BSL (not permissive) | Yes (100%) | Small |
| ArangoDB | Apache 2.0 | No (AQL) | Large |
| SurrealDB | Apache 2.0 | No | Large |
| Dgraph | Apache 2.0 | No (GraphQL) | Very Large |

## Decision

**Migrate from Neo4j Community Edition to FalkorDB.**

### Rationale

1. **License Compliance**: FalkorDB uses Apache 2.0 license, fully compatible with MIT
2. **Cypher Compatibility**: 95%+ of existing Cypher queries work unchanged
3. **Minimal Migration Effort**: Query translation not required for most operations
4. **Performance**: In-memory architecture provides excellent performance for code graphs
5. **Simple Deployment**: Single Docker container, similar to current Neo4j setup
6. **Active Development**: Fork of RedisGraph with active community

### Implementation Approach

1. **Create GraphStorageAdapter Interface**: Abstract graph operations behind an interface
2. **Implement FalkorDBAdapter**: New adapter implementing the interface
3. **Refactor Neo4jClient to Neo4jAdapter**: Keep as deprecated fallback
4. **Migrate Data**: Export/import existing graph data
5. **Update Infrastructure**: Docker Compose, Helm charts, CI/CD
6. **Remove Neo4j Dependency**: After successful migration

## Consequences

### Positive

- Project fully uses permissive licenses (MIT, Apache 2.0)
- Future database migrations simplified via adapter pattern
- Reduced container memory footprint (FalkorDB is lighter than Neo4j)
- No licensing concerns for public repository

### Negative

- Migration effort required (estimated 10-14 days core, 2-3 weeks total)
- Some advanced Cypher features may need adjustment (APOC equivalents)
- Smaller community than Neo4j (but growing)
- Team needs to learn FalkorDB-specific tooling

### Neutral

- Query performance expected to be similar or better
- Docker deployment complexity unchanged

## Implementation Plan

This work will be done at the START of Phase 4, before other Phase 4 items.

### Phase 4.0: Graph Database Migration

1. Create GraphStorageAdapter interface
2. Implement FalkorDBAdapter
3. Create data migration tooling
4. Update Docker Compose configuration
5. Migrate test suite
6. Update documentation
7. Remove neo4j-driver dependency

## References

- [FalkorDB Documentation](https://docs.falkordb.com/)
- [FalkorDB GitHub](https://github.com/FalkorDB/FalkorDB)
- [Cypher Query Language](https://opencypher.org/)
- ADR-0002: Knowledge Graph Architecture (superseded for database choice)
