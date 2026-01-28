# Phase 4.0: FalkorDB Migration - GitHub Issues

**Date Created:** 2026-01-28
**Parent ADR:** [ADR-0004: Graph Database Migration](../architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
**Parent Roadmap:** [docker-containerization-roadmap.md](./docker-containerization-roadmap.md)

This document contains the GitHub issue specifications for the Phase 4.0 Graph Database Migration from Neo4j to FalkorDB. This work is a prerequisite for Phase 6 and addresses license compliance (Neo4j GPLv3 -> FalkorDB Apache 2.0).

---

## EPIC Issue

### [Epic] Phase 4.0: Graph Database Migration (Neo4j to FalkorDB)

**Labels:** `epic`, `phase-4`, `infrastructure`, `P0`

**Title:** `[Epic] Phase 4.0: Graph Database Migration (Neo4j to FalkorDB)`

**Description:**

```markdown
## Overview

This EPIC tracks the migration of the graph database from Neo4j Community Edition to FalkorDB for license compliance.

**Rationale:** Neo4j Community Edition uses GPLv3 (copyleft), which is incompatible with the project's MIT license goals for public release. FalkorDB uses Apache 2.0 license, which is fully compatible.

## Parent Documents

- ADR: [ADR-0004: Graph Database Migration](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Roadmap: [docker-containerization-roadmap.md](docs/pm/docker-containerization-roadmap.md)

## Why FalkorDB?

| Criteria | FalkorDB | Neo4j CE |
|----------|----------|----------|
| License | Apache 2.0 | GPLv3 |
| Cypher Support | 95%+ compatible | Native |
| Migration Effort | Small-Medium | N/A |
| Performance | Excellent (in-memory) | Good |
| Docker Deployment | Single container | Single container |

## Work Items

| Issue | Title | Size | Effort | Status |
|-------|-------|------|--------|--------|
| #TBD | Create GraphStorageAdapter Interface | M | 2-3 days | Planned |
| #TBD | Implement FalkorDBAdapter | M | 3-4 days | Planned |
| #TBD | Data Migration Tooling | S | 1-2 days | Planned |
| #TBD | Docker Compose FalkorDB Configuration | S | 1 day | Planned |
| #TBD | Graph Test Suite Migration | M | 3-5 days | Planned |
| #TBD | MCP Tool Verification | S | 1-2 days | Planned |
| #TBD | Graph Database Migration Documentation | S | 1 day | Planned |
| #TBD | Remove neo4j-driver Dependency | S | 0.5 days | Planned |

**Total Estimated Effort:** 12-18 days

## Success Criteria

- [ ] All 5 graph MCP tools functional with FalkorDB
- [ ] Existing indexed repositories queryable
- [ ] Incremental update pipeline working
- [ ] Performance within targets (<100ms graph traversal)
- [ ] Test coverage maintained at 90%+
- [ ] neo4j-driver removed from package.json
- [ ] Docker Compose uses FalkorDB container
- [ ] No references to Neo4j in codebase (except historical docs/ADRs)

## Priority

**FIRST** - This work must complete before other Phase 4 work and before Phase 6 begins.

## References

- [FalkorDB Documentation](https://docs.falkordb.com/)
- [FalkorDB GitHub](https://github.com/FalkorDB/FalkorDB)
- [Cypher Query Language](https://opencypher.org/)

---
*This EPIC will be updated as issues are created and progress is made.*
```

---

## Task Issues

### Issue 4.0.1: [Architecture] Create GraphStorageAdapter Interface

**Labels:** `phase-4`, `architecture`, `enhancement`, `size-M`, `P0`

**Title:** `[Architecture] Create GraphStorageAdapter Interface`

**Description:**

```markdown
## Summary

Create an abstract interface for graph storage operations to enable database-agnostic graph queries. This is the foundation for migrating from Neo4j to FalkorDB.

## Parent Documents

- ADR: [ADR-0004](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Roadmap: [docker-containerization-roadmap.md](docs/pm/docker-containerization-roadmap.md)
- Epic: #TBD (Phase 4.0 Epic)

## Current State

Graph operations are tightly coupled to Neo4j via `src/graph/Neo4jClient.ts`.

## Target State

Abstract interface allowing multiple graph database implementations.

## Acceptance Criteria

- [ ] `GraphStorageAdapter` interface defined in `src/graph/adapters/types.ts`
- [ ] Interface includes connection lifecycle: `connect()`, `disconnect()`, `healthCheck()`
- [ ] Interface includes query execution: `runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T>`
- [ ] Interface includes node operations: `upsertNode()`, `deleteNode()`
- [ ] Interface includes relationship operations: `createRelationship()`, `deleteRelationship()`
- [ ] Interface includes traversal operations: `traverse()`, `analyzeDependencies()`, `getContext()`
- [ ] `GraphStorageAdapterFactory` created for provider selection based on configuration
- [ ] Configuration schema supports `GRAPH_PROVIDER` environment variable (`neo4j` | `falkordb`)
- [ ] Existing `Neo4jClient` refactored to implement `GraphStorageAdapter` interface
- [ ] All existing graph tests continue to pass
- [ ] Unit tests for factory and type validation

## Technical Notes

Interface should be database-agnostic using generic types:

```typescript
interface GraphStorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;

  runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T>;

  upsertNode(label: string, properties: NodeProperties): Promise<string>;
  deleteNode(nodeId: string): Promise<void>;

  createRelationship(
    fromId: string,
    toId: string,
    type: RelationshipType,
    properties?: Record<string, unknown>
  ): Promise<void>;
  deleteRelationship(relationshipId: string): Promise<void>;

  traverse(startNodeId: string, depth: number, direction: 'in' | 'out' | 'both'): Promise<TraversalResult>;
  analyzeDependencies(nodeId: string): Promise<DependencyAnalysis>;
  getContext(nodeId: string, contextDepth: number): Promise<GraphContext>;
}
```

## Files to Create/Modify

**New Files:**
- `src/graph/adapters/types.ts` - Interface definitions
- `src/graph/adapters/index.ts` - Factory and exports
- `src/graph/adapters/Neo4jAdapter.ts` - Refactored from Neo4jClient

**Modified Files:**
- `src/graph/Neo4jClient.ts` - Refactor to use adapter pattern
- `src/services/graph-service.ts` - Use adapter interface instead of direct Neo4j
- `src/config/index.ts` - Add GRAPH_PROVIDER configuration

## Dependencies

- None (foundational issue)

## Blocks

- All other Phase 4.0 issues depend on this interface

## Size Estimate

Medium (M) - 2-3 days
```

---

### Issue 4.0.2: [Feature] Implement FalkorDBAdapter

**Labels:** `phase-4`, `feature`, `enhancement`, `size-M`, `P0`

**Title:** `[Feature] Implement FalkorDBAdapter`

**Description:**

```markdown
## Summary

Implement the `GraphStorageAdapter` interface for FalkorDB, enabling Cypher query execution against FalkorDB's graph database.

## Parent Documents

- ADR: [ADR-0004](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Epic: #TBD (Phase 4.0 Epic)

## Current State

No FalkorDB integration exists.

## Target State

Full FalkorDB adapter implementing `GraphStorageAdapter` interface.

## Acceptance Criteria

- [ ] `FalkorDBAdapter` class created in `src/graph/adapters/FalkorDBAdapter.ts`
- [ ] Implements all methods from `GraphStorageAdapter` interface
- [ ] Uses `@falkordb/falkordb` TypeScript client (or `falkordb` npm package)
- [ ] Connection pooling with configurable pool size (default: 5)
- [ ] Health check endpoint integration returning connection status
- [ ] All existing Cypher queries work (95%+ compatibility expected)
- [ ] Query parameter binding works correctly with FalkorDB syntax
- [ ] Error handling maps FalkorDB-specific errors to application error types
- [ ] Connection retry logic with exponential backoff
- [ ] Graceful shutdown handling
- [ ] Unit tests with >90% coverage
- [ ] Integration tests against real FalkorDB container

## Technical Notes

FalkorDB uses Redis protocol. Key differences from Neo4j:
- Connection via Redis client
- Graph name specified per query
- Some APOC equivalents may need custom implementation

```typescript
import { FalkorDB } from 'falkordb';

class FalkorDBAdapter implements GraphStorageAdapter {
  private client: FalkorDB;
  private graphName: string;

  async connect(): Promise<void> {
    this.client = await FalkorDB.connect({
      host: this.config.host,
      port: this.config.port,
    });
  }

  async runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T> {
    const graph = this.client.selectGraph(this.graphName);
    const result = await graph.query(cypher, params);
    return this.transformResult<T>(result);
  }
}
```

## Focus Areas for Testing

- Variable-length path patterns: `MATCH path = (a)-[*1..3]->(b)`
- MERGE operations for upserts
- Batched operations with UNWIND
- Parameter binding syntax differences
- NULL handling
- Date/time type conversions

## Files to Create

- `src/graph/adapters/FalkorDBAdapter.ts`
- `tests/unit/graph/adapters/FalkorDBAdapter.test.ts`
- `tests/integration/graph/FalkorDBAdapter.integration.test.ts`

## Dependencies

- Issue 4.0.1: GraphStorageAdapter Interface must be complete

## Blocks

- Issue 4.0.3: Data Migration Tooling
- Issue 4.0.4: Docker Compose Update
- Issue 4.0.5: Test Suite Migration

## Size Estimate

Medium (M) - 3-4 days
```

---

### Issue 4.0.3: [Infrastructure] Data Migration Tooling

**Labels:** `phase-4`, `infrastructure`, `size-S`, `P1`

**Title:** `[Infrastructure] Data Migration Tooling`

**Description:**

```markdown
## Summary

Create tooling to migrate existing graph data from Neo4j to FalkorDB for users with existing indexed repositories.

## Parent Documents

- ADR: [ADR-0004](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Epic: #TBD (Phase 4.0 Epic)

## Acceptance Criteria

- [ ] Export script: `scripts/export-neo4j-graph.ts`
  - Exports all nodes and relationships to JSON format
  - Preserves all properties and labels
  - Handles large graphs with streaming/batching
  - Progress reporting during export
- [ ] Import script: `scripts/import-falkordb-graph.ts`
  - Imports JSON data into FalkorDB
  - Creates proper indexes
  - Handles large imports with batching
  - Progress reporting during import
- [ ] Validation script: `scripts/validate-graph-migration.ts`
  - Compares node counts
  - Compares relationship counts
  - Spot-checks random nodes for property equality
  - Reports discrepancies
- [ ] CLI command: `pk-mcp graph migrate-db`
  - Orchestrates export, import, and validation
  - Supports `--dry-run` flag
  - Supports `--source` and `--target` provider flags
  - Clear progress reporting
- [ ] Documentation for migration process in `docs/graph-database-migration.md`
- [ ] Handles edge cases:
  - Empty graphs
  - Graphs with special characters in properties
  - Large property values

## Technical Notes

Migration flow:
```
1. pk-mcp graph migrate-db --source neo4j --target falkordb
2. Export from Neo4j → JSON file
3. Import JSON → FalkorDB
4. Validate counts and sample data
5. Report success/failure
```

For most users, re-indexing repositories may be simpler than migration:
```bash
pk-mcp repo remove-all
pk-mcp graph migrate-db  # or just switch config
pk-mcp repo add <repos...>
```

## Files to Create

- `scripts/export-neo4j-graph.ts`
- `scripts/import-falkordb-graph.ts`
- `scripts/validate-graph-migration.ts`
- `src/cli/commands/graph/migrate-db.ts`
- `docs/graph-database-migration.md`

## Dependencies

- Issue 4.0.2: FalkorDBAdapter must be functional

## Size Estimate

Small (S) - 1-2 days
```

---

### Issue 4.0.4: [Infrastructure] Docker Compose FalkorDB Configuration

**Labels:** `phase-4`, `infrastructure`, `size-S`, `P0`

**Title:** `[Infrastructure] Docker Compose FalkorDB Configuration`

**Description:**

```markdown
## Summary

Update Docker Compose configuration to use FalkorDB instead of Neo4j as the graph database.

## Parent Documents

- ADR: [ADR-0004](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Epic: #TBD (Phase 4.0 Epic)

## Current State

Docker Compose includes Neo4j service configuration.

## Target State

Docker Compose uses FalkorDB with Neo4j removed.

## Acceptance Criteria

- [ ] FalkorDB service added to `docker-compose.yml`:
  - Image: `falkordb/falkordb:v4.4.1` (pin specific version)
  - Port: `127.0.0.1:6379:6379` (Redis protocol, localhost only)
  - Volume: `falkordb-data:/data`
  - Health check configured using Redis PING
  - Resource limits: CPU 2 cores, Memory 2GB
  - Restart policy: `unless-stopped`
- [ ] Neo4j service removed from `docker-compose.yml`
- [ ] Old Neo4j volumes documented for cleanup (not auto-deleted)
- [ ] `.env.example` updated:
  - Remove `NEO4J_*` variables
  - Add `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_GRAPH_NAME`
- [ ] All Docker Compose profiles updated:
  - `default` profile
  - `private` profile
  - `work` profile
  - `public` profile
  - `all` profile
- [ ] Health check verifies FalkorDB is accepting connections
- [ ] Container starts and accepts queries successfully
- [ ] Documentation updated for new container setup

## Technical Notes

FalkorDB Docker configuration:

```yaml
services:
  falkordb:
    image: falkordb/falkordb:v4.4.1
    container_name: pk-mcp-falkordb
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - falkordb-data:/data
    environment:
      - FALKORDB_ARGS=--save 60 1 --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    restart: unless-stopped
    networks:
      - pk-mcp-network

volumes:
  falkordb-data:
```

## Files to Modify

- `docker-compose.yml`
- `.env.example`
- `charts/personal-knowledge-mcp/values.yaml` (if Helm charts exist)

## Dependencies

- Issue 4.0.2: FalkorDBAdapter must be functional for testing

## Size Estimate

Small (S) - 1 day
```

---

### Issue 4.0.5: [Testing] Graph Test Suite Migration

**Labels:** `phase-4`, `testing`, `size-M`, `P0`

**Title:** `[Testing] Graph Test Suite Migration`

**Description:**

```markdown
## Summary

Migrate all graph-related tests to work with FalkorDB and ensure test coverage remains at 90%+.

## Parent Documents

- ADR: [ADR-0004](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Epic: #TBD (Phase 4.0 Epic)

## Acceptance Criteria

- [ ] All unit tests in `tests/unit/graph/` pass with FalkorDB adapter
- [ ] All integration tests in `tests/integration/graph/` pass
- [ ] Test fixtures updated for FalkorDB if needed
- [ ] Mock/stub utilities updated for new adapter interface
- [ ] CI/CD pipeline configuration updated:
  - GitHub Actions uses FalkorDB container
  - Test container starts before tests run
  - Container properly cleaned up after tests
- [ ] Benchmark tests updated and run against FalkorDB:
  - Query latency benchmarks
  - Traversal performance benchmarks
  - Bulk insert benchmarks
- [ ] Test coverage report shows 90%+ on graph modules
- [ ] Flaky tests identified and fixed
- [ ] Test documentation updated

## Tests to Verify

### Unit Tests
- `Neo4jClient.test.ts` -> Refactor for adapter pattern
- `graph-service.test.ts` -> Use adapter mocks
- All graph query builders

### Integration Tests
- Graph population from AST parsing
- Dependency traversal queries
- Architecture analysis queries
- Incremental update pipeline
- MCP tool integration

### Performance Tests
- Single node lookup: <10ms
- Relationship query (depth 1): <50ms
- Traversal (depth 3): <100ms
- Bulk insert (1000 nodes): <5s

## Technical Notes

Update test setup to use FalkorDB test container:

```typescript
// tests/setup/graph-test-setup.ts
import { GenericContainer, StartedTestContainer } from 'testcontainers';

let falkordbContainer: StartedTestContainer;

beforeAll(async () => {
  falkordbContainer = await new GenericContainer('falkordb/falkordb:v4.4.1')
    .withExposedPorts(6379)
    .start();

  process.env.FALKORDB_HOST = falkordbContainer.getHost();
  process.env.FALKORDB_PORT = falkordbContainer.getMappedPort(6379).toString();
});

afterAll(async () => {
  await falkordbContainer.stop();
});
```

## Files to Modify

- `tests/unit/graph/**/*.test.ts` - All graph unit tests
- `tests/integration/graph/**/*.test.ts` - All graph integration tests
- `tests/setup/` - Test setup files
- `.github/workflows/ci.yml` - CI pipeline
- `bunfig.toml` - Test configuration if needed

## Dependencies

- Issue 4.0.2: FalkorDBAdapter must be functional
- Issue 4.0.4: Docker Compose must be updated

## Size Estimate

Medium (M) - 3-5 days
```

---

### Issue 4.0.6: [Testing] MCP Tool Verification

**Labels:** `phase-4`, `testing`, `size-S`, `P0`

**Title:** `[Testing] MCP Tool Verification`

**Description:**

```markdown
## Summary

Verify all 5 graph-related MCP tools work correctly with FalkorDB backend.

## Parent Documents

- ADR: [ADR-0004](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Epic: #TBD (Phase 4.0 Epic)

## MCP Tools to Verify

1. **get_dependencies** - Get what a code entity depends on
2. **get_dependents** - Get what depends on a code entity
3. **get_architecture** - Get architectural overview of a repository
4. **find_path** - Find relationship path between two entities
5. **get_graph_metrics** - Get graph statistics and metrics

## Acceptance Criteria

- [ ] `get_dependencies` tool:
  - Returns correct dependencies for functions, classes, modules
  - Handles missing entities gracefully
  - Performance within target (<200ms)
- [ ] `get_dependents` tool:
  - Returns correct reverse dependencies
  - Handles entities with many dependents
  - Performance within target (<200ms)
- [ ] `get_architecture` tool:
  - Returns correct module/package structure
  - Includes relationship counts
  - Performance within target (<500ms for large repos)
- [ ] `find_path` tool:
  - Finds shortest path between entities
  - Returns empty result for unconnected entities
  - Performance within target (<100ms)
- [ ] `get_graph_metrics` tool:
  - Returns accurate node counts by type
  - Returns accurate relationship counts
  - Returns graph density metrics
  - Performance within target (<100ms)
- [ ] All tools return consistent JSON schema
- [ ] Error messages are clear and actionable
- [ ] Integration tests for each tool with FalkorDB

## Test Scenarios

```typescript
// Example test cases for each tool
describe('MCP Graph Tools with FalkorDB', () => {
  it('get_dependencies returns function dependencies', async () => {
    const result = await mcpClient.callTool('get_dependencies', {
      entity: 'src/services/search-service.ts:searchByQuery',
      depth: 2
    });
    expect(result.dependencies).toContainEqual(
      expect.objectContaining({ name: 'ChromaDBClient' })
    );
  });

  it('get_architecture returns module structure', async () => {
    const result = await mcpClient.callTool('get_architecture', {
      repository: 'PersonalKnowledgeMCP'
    });
    expect(result.modules).toContain('src/mcp');
    expect(result.modules).toContain('src/services');
  });
});
```

## Dependencies

- Issue 4.0.5: Test suite must be migrated

## Size Estimate

Small (S) - 1-2 days
```

---

### Issue 4.0.7: [Documentation] Graph Database Migration Documentation

**Labels:** `phase-4`, `documentation`, `size-S`, `P1`

**Title:** `[Documentation] Graph Database Migration Documentation`

**Description:**

```markdown
## Summary

Update all documentation to reflect the migration from Neo4j to FalkorDB.

## Parent Documents

- ADR: [ADR-0004](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Epic: #TBD (Phase 4.0 Epic)

## Acceptance Criteria

- [ ] `README.md` technology stack updated:
  - Change "Neo4j Community" to "FalkorDB"
  - Update license section to note Apache 2.0 for graph DB
- [ ] `docs/neo4j-setup.md` renamed to `docs/graph-database-setup.md`:
  - Complete rewrite for FalkorDB setup
  - Include Docker setup instructions
  - Include manual installation instructions (if applicable)
  - Troubleshooting section
- [ ] Configuration documentation updated:
  - New environment variables documented
  - Example configurations provided
- [ ] `.claude/CLAUDE.md` project instructions updated:
  - Technology stack section
  - Any Neo4j-specific instructions removed
- [ ] ADR-0004 finalized:
  - Status changed from "Accepted" to "Implemented"
  - Implementation notes added
- [ ] CHANGELOG.md updated:
  - Breaking change noted
  - Migration instructions referenced
- [ ] Helm chart documentation updated (if applicable)
- [ ] API/MCP tool documentation verified accurate

## Files to Modify

- `README.md`
- `docs/neo4j-setup.md` -> `docs/graph-database-setup.md`
- `.claude/CLAUDE.md`
- `docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md`
- `CHANGELOG.md`
- `charts/personal-knowledge-mcp/README.md` (if exists)

## Dependencies

- All other Phase 4.0 issues should be complete

## Size Estimate

Small (S) - 1 day
```

---

### Issue 4.0.8: [Cleanup] Remove neo4j-driver Dependency

**Labels:** `phase-4`, `cleanup`, `size-S`, `P1`

**Title:** `[Cleanup] Remove neo4j-driver Dependency`

**Description:**

```markdown
## Summary

Remove the `neo4j-driver` npm package and all Neo4j-specific code after successful migration to FalkorDB.

## Parent Documents

- ADR: [ADR-0004](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Epic: #TBD (Phase 4.0 Epic)

## Pre-conditions

Before starting this issue:
- [ ] FalkorDB has been in production use for at least 1 week
- [ ] All graph MCP tools verified working
- [ ] No reported issues with FalkorDB integration
- [ ] Team agreement to proceed with removal

## Acceptance Criteria

- [ ] `neo4j-driver` removed from `package.json`
- [ ] `@types/neo4j-driver` removed (if exists)
- [ ] Run `bun install` to update lockfile
- [ ] `Neo4jAdapter` code removed or moved to archive:
  - Option A: Delete `src/graph/adapters/Neo4jAdapter.ts`
  - Option B: Move to `src/graph/adapters/archived/Neo4jAdapter.ts` with deprecation notice
- [ ] Neo4j-specific error types removed from `src/graph/errors.ts`
- [ ] All Neo4j imports removed from codebase
- [ ] No runtime references to "neo4j" in code (grep verification)
- [ ] Configuration schema no longer allows `neo4j` as provider
- [ ] Bundle size verified to be reduced
- [ ] All tests pass without neo4j-driver
- [ ] Build succeeds without neo4j-driver

## Verification Commands

```bash
# Verify no neo4j references in source
grep -r "neo4j" src/ --include="*.ts" | grep -v "// neo4j" | grep -v "archived"

# Verify package removed
! bun pm ls | grep neo4j

# Verify build works
bun run build

# Verify tests pass
bun test

# Check bundle size reduction
bun run build && du -sh dist/
```

## Files to Modify/Delete

**Delete:**
- `src/graph/adapters/Neo4jAdapter.ts` (or archive)
- Any Neo4j-specific utility files

**Modify:**
- `package.json` - Remove neo4j-driver
- `bun.lockb` - Updated via bun install
- `src/graph/adapters/index.ts` - Remove Neo4j export
- `src/graph/errors.ts` - Remove Neo4j-specific errors
- `src/config/index.ts` - Remove neo4j from allowed providers

## Dependencies

- All other Phase 4.0 issues must be complete
- FalkorDB must be proven stable in production

## Size Estimate

Small (S) - 0.5 days
```

---

## Issue Creation Order

Create issues in this order to establish proper dependency links:

1. **EPIC Issue** - Phase 4.0: Graph Database Migration
2. **Issue 4.0.1** - GraphStorageAdapter Interface (blocks all others)
3. **Issue 4.0.2** - FalkorDBAdapter (blocks 4.0.3, 4.0.4, 4.0.5)
4. **Issue 4.0.4** - Docker Compose Update (can parallel with 4.0.3)
5. **Issue 4.0.3** - Data Migration Tooling
6. **Issue 4.0.5** - Test Suite Migration
7. **Issue 4.0.6** - MCP Tool Verification
8. **Issue 4.0.7** - Documentation
9. **Issue 4.0.8** - Neo4j Removal (final cleanup)

## Labels Required

Ensure these labels exist in the repository:
- `epic`
- `phase-4`
- `architecture`
- `feature`
- `infrastructure`
- `testing`
- `documentation`
- `cleanup`
- `enhancement`
- `size-S`
- `size-M`
- `size-L`
- `P0`
- `P1`

---

## Summary Table

| Issue | Title | Labels | Size | Effort | Dependencies |
|-------|-------|--------|------|--------|--------------|
| Epic | Phase 4.0: Graph Database Migration | epic, phase-4, infrastructure, P0 | - | 12-18 days | None |
| 4.0.1 | Create GraphStorageAdapter Interface | phase-4, architecture, enhancement, size-M, P0 | M | 2-3 days | None |
| 4.0.2 | Implement FalkorDBAdapter | phase-4, feature, enhancement, size-M, P0 | M | 3-4 days | 4.0.1 |
| 4.0.3 | Data Migration Tooling | phase-4, infrastructure, size-S, P1 | S | 1-2 days | 4.0.2 |
| 4.0.4 | Docker Compose FalkorDB Configuration | phase-4, infrastructure, size-S, P0 | S | 1 day | 4.0.2 |
| 4.0.5 | Graph Test Suite Migration | phase-4, testing, size-M, P0 | M | 3-5 days | 4.0.2, 4.0.4 |
| 4.0.6 | MCP Tool Verification | phase-4, testing, size-S, P0 | S | 1-2 days | 4.0.5 |
| 4.0.7 | Graph Database Migration Documentation | phase-4, documentation, size-S, P1 | S | 1 day | All above |
| 4.0.8 | Remove neo4j-driver Dependency | phase-4, cleanup, size-S, P1 | S | 0.5 days | All above |

---

*Document generated: 2026-01-28*
*Repository: sethships/PersonalKnowledgeMCP*
