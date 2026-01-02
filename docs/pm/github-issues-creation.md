# GitHub Issues Creation Script

This document contains all GitHub issues to be created for the Knowledge Graph and Local Embeddings initiative.

## Prerequisites

Before creating issues, create the following labels:

```bash
# Phase labels
gh label create "phase-1" --description "Phase 1: Knowledge Graph Foundation" --color "0E8A16"
gh label create "phase-2" --description "Phase 2: Core MCP Tools" --color "1D76DB"
gh label create "phase-3" --description "Phase 3: Advanced Tools" --color "5319E7"
gh label create "phase-4" --description "Phase 4: Local Embeddings" --color "D93F0B"
gh label create "phase-5" --description "Phase 5: Integration & Polish" --color "FBCA04"

# Component labels
gh label create "graph" --description "Knowledge Graph (Neo4j)" --color "C5DEF5"
gh label create "embeddings" --description "Embedding Providers" --color "F9D0C4"
gh label create "mcp-tools" --description "MCP Tool Handlers" --color "BFD4F2"
gh label create "infrastructure" --description "Infrastructure & DevOps" --color "D4C5F9"
gh label create "testing" --description "Testing" --color "0052CC"

# Workflow labels
gh label create "epic" --description "Epic - parent issue" --color "3E4B9E"
gh label create "can-parallelize" --description "Can be worked on in parallel" --color "C2E0C6"

# Size labels
gh label create "size-S" --description "Small: 1 day or less" --color "E6E6E6"
gh label create "size-M" --description "Medium: 2-3 days" --color "BDBDBD"
gh label create "size-L" --description "Large: 4-5 days" --color "757575"
```

---

## Epic Issues

### Epic 1: Knowledge Graph Foundation

```bash
gh issue create \
  --title "[Epic] Knowledge Graph Foundation (Phase 1)" \
  --label "epic,phase-1,graph" \
  --body "## Overview

Establish Neo4j integration and core data model for knowledge graph capabilities.

## Goals
- Neo4j client with connection pooling
- Entity extraction for TypeScript/JavaScript files
- Relationship extraction for imports
- Basic graph population via CLI
- Health check integration

## Deliverables
- \`src/graph/\` module structure
- \`Neo4jClient\` with connection management
- \`EntityExtractor\` using tree-sitter
- \`RelationshipExtractor\` for imports
- \`GraphIngestionService\` for storing to Neo4j
- CLI command: \`pk-mcp graph populate <repo>\`
- Neo4j health in existing health checks
- Unit and integration tests (>90% coverage)

## Reference Documents
- [Knowledge Graph PRD](../docs/pm/knowledge-graph-PRD.md)
- [ADR-0002: Knowledge Graph Architecture](../docs/architecture/adr/0002-knowledge-graph-architecture.md)

## Success Criteria
- Neo4j container running in Docker Compose
- Can index a TypeScript repository and query relationships
- Performance within targets (<100ms for simple queries)

## Child Issues
See issues with label \`phase-1\`
"
```

### Epic 2: Knowledge Graph MCP Tools

```bash
gh issue create \
  --title "[Epic] Knowledge Graph MCP Tools (Phase 2-3)" \
  --label "epic,phase-2,phase-3,graph,mcp-tools" \
  --body "## Overview

Implement MCP tools for graph-based structural queries.

## Goals
- get_dependencies tool for forward dependencies
- get_dependents tool for impact analysis
- get_architecture tool for structure overview
- find_path tool for call chain tracing

## Deliverables
- GraphService interface and implementation
- Four new MCP tools registered in tool registry
- Cypher queries for complex traversals
- Tool documentation with examples

## Reference Documents
- [Knowledge Graph PRD - Section 6](../docs/pm/knowledge-graph-PRD.md#6-mcp-tool-design)
- [ADR-0002: MCP Tool Design](../docs/architecture/adr/0002-knowledge-graph-architecture.md#mcp-tool-design)

## Success Criteria
- Claude Code can execute all graph query tools
- Accurate results compared to manual analysis
- Performance within targets

## Child Issues
See issues with labels \`phase-2\` or \`phase-3\`
"
```

### Epic 3: Local Embeddings Provider

```bash
gh issue create \
  --title "[Epic] Local Embeddings Provider (Phase 4)" \
  --label "epic,phase-4,embeddings" \
  --body "## Overview

Enable local embedding generation without external API dependencies.

## Goals
- Pluggable embedding provider architecture
- Transformers.js provider for zero-dependency local embeddings
- Ollama provider for GPU acceleration
- Per-repository provider configuration

## Deliverables
- EmbeddingProvider interface updates
- TransformersJsEmbeddingProvider implementation
- OllamaEmbeddingProvider implementation
- Model download and caching logic
- CLI \`--provider\` flag for index command
- \`pk-mcp providers status\` and \`setup\` commands
- Provider-aware search service

## Reference Documents
- [Knowledge Graph PRD - Section 11](../docs/pm/knowledge-graph-PRD.md#11-local-embeddings-provider)
- [ADR-0003: Local Embeddings Architecture](../docs/architecture/adr/0003-local-embeddings-architecture.md)

## Success Criteria
- Index repository completely offline
- Search quality >80% overlap with OpenAI
- Indexing speed <2x OpenAI time
- Memory usage <1GB peak

## Child Issues
See issues with label \`phase-4\`
"
```

### Epic 4: Integration and Polish

```bash
gh issue create \
  --title "[Epic] Integration and Polish (Phase 5)" \
  --label "epic,phase-5,infrastructure" \
  --body "## Overview

Integrate new features into existing pipelines and finalize for production.

## Goals
- Graph updates during incremental indexing
- Migration tool for existing repositories
- Unified backup/restore including Neo4j
- Performance optimization and monitoring

## Deliverables
- Graph extraction in IncrementalUpdateCoordinator
- \`pk-mcp graph populate-all\` command
- Updated backup scripts for Neo4j
- Graph query timing in metrics
- Performance testing at scale (10K+ files)
- User documentation and guides

## Reference Documents
- [Roadmap](../docs/pm/knowledge-graph-embeddings-roadmap.md)

## Success Criteria
- Incremental updates maintain graph consistency
- Existing repositories can be migrated
- Performance meets all targets
- Documentation complete

## Child Issues
See issues with label \`phase-5\`
"
```

---

## Phase 1 Task Issues

### 1.1 Neo4j Module Structure

```bash
gh issue create \
  --title "[Phase 1] Create src/graph/ module structure [S]" \
  --label "phase-1,graph,infrastructure,size-S,can-parallelize" \
  --body "## Description

Create the directory structure and base files for the graph module.

## Acceptance Criteria
- [ ] Create \`src/graph/\` directory
- [ ] Create \`src/graph/index.ts\` with exports
- [ ] Create \`src/graph/types.ts\` for graph-related types
- [ ] Create \`src/graph/errors.ts\` for graph-specific errors
- [ ] Follow existing module patterns in codebase

## Technical Notes
- Reference existing module patterns (e.g., \`src/storage/\`, \`src/services/\`)
- Types should include node types, relationship types from ADR-0002

## Reference
- [ADR-0002: Data Model Design](../docs/architecture/adr/0002-knowledge-graph-architecture.md#data-model-design)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.2 Neo4j Client Implementation

```bash
gh issue create \
  --title "[Phase 1] Implement Neo4jClient with connection management [M]" \
  --label "phase-1,graph,infrastructure,size-M" \
  --body "## Description

Implement the Neo4j client wrapper with connection pooling and query execution.

## Acceptance Criteria
- [ ] Create \`src/graph/Neo4jClient.ts\`
- [ ] Implement connection using \`neo4j-driver\` package
- [ ] Configure connection pooling (max 50 connections)
- [ ] Implement query execution with proper session management
- [ ] Implement transaction support
- [ ] Handle connection errors gracefully
- [ ] Add reconnection logic
- [ ] Unit tests with >90% coverage

## Technical Notes
\`\`\`typescript
// Example interface
interface Neo4jClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
  runTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  healthCheck(): Promise<boolean>;
}
\`\`\`

## Dependencies
- npm package: \`neo4j-driver\`
- Neo4j container running (docker-compose)

## Reference
- [ADR-0002: Neo4j Driver Usage](../docs/architecture/adr/0002-knowledge-graph-architecture.md#implementation-notes)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.3 Neo4j Schema and Migration

```bash
gh issue create \
  --title "[Phase 1] Create Neo4j schema and migration tool [M]" \
  --label "phase-1,graph,infrastructure,size-M" \
  --body "## Description

Define the Neo4j schema with constraints and indexes, and create a migration tool.

## Acceptance Criteria
- [ ] Create \`src/graph/schema.ts\` with Cypher schema definitions
- [ ] Implement schema migration runner
- [ ] Create unique constraints for Repository, File, Function, Class nodes
- [ ] Create performance indexes for common query patterns
- [ ] Create CLI command for schema migration
- [ ] Idempotent migrations (safe to run multiple times)
- [ ] Schema version tracking

## Schema Requirements (from ADR-0002)
\`\`\`cypher
// Constraints
CREATE CONSTRAINT repo_name IF NOT EXISTS FOR (r:Repository) REQUIRE r.name IS UNIQUE;
CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE (f.repository, f.path) IS NODE KEY;
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.chromaId IS UNIQUE;

// Indexes
CREATE INDEX file_extension IF NOT EXISTS FOR (f:File) ON (f.extension);
CREATE INDEX function_name IF NOT EXISTS FOR (fn:Function) ON (fn.name);
CREATE INDEX class_name IF NOT EXISTS FOR (c:Class) ON (c.name);
\`\`\`

## Dependencies
- Neo4jClient (#1.2)

## Reference
- [ADR-0002: Schema Definition](../docs/architecture/adr/0002-knowledge-graph-architecture.md#schema-definition-cypher)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.4 Tree-sitter Integration

```bash
gh issue create \
  --title "[Phase 1] Integrate tree-sitter for AST parsing [M]" \
  --label "phase-1,graph,size-M,can-parallelize" \
  --body "## Description

Set up tree-sitter for parsing TypeScript and JavaScript files into ASTs.

## Acceptance Criteria
- [ ] Add tree-sitter dependencies for TypeScript/JavaScript
- [ ] Create \`src/graph/parsing/TreeSitterParser.ts\`
- [ ] Implement file parsing to AST
- [ ] Handle parsing errors gracefully
- [ ] Support TypeScript, JavaScript, TSX, JSX
- [ ] Verify Bun compatibility
- [ ] Unit tests for parsing edge cases

## Technical Notes
- Consider using \`tree-sitter\` npm package with language bindings
- May need to use \`web-tree-sitter\` for Bun compatibility
- Test with various file sizes and complexity levels

## Dependencies
- None (can parallelize with Neo4j work)

## Reference
- [PRD Section 4.4: Data Extraction Requirements](../docs/pm/knowledge-graph-PRD.md#44-data-extraction-requirements)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.5 Entity Extractor

```bash
gh issue create \
  --title "[Phase 1] Implement EntityExtractor for functions and classes [M]" \
  --label "phase-1,graph,size-M" \
  --body "## Description

Extract function and class definitions from parsed ASTs.

## Acceptance Criteria
- [ ] Create \`src/graph/extraction/EntityExtractor.ts\`
- [ ] Extract function definitions with metadata:
  - Name, qualified name, file path
  - Line start/end
  - Is exported, is async
  - Parameters and return type
- [ ] Extract class definitions with metadata:
  - Name, qualified name, file path
  - Line start/end
  - Is exported, is abstract
- [ ] Extract interface definitions
- [ ] Return structured entity objects
- [ ] Unit tests with sample TypeScript files

## Technical Notes
\`\`\`typescript
interface ExtractedFunction {
  name: string;
  qualifiedName: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  isExported: boolean;
  isAsync: boolean;
  parameters: string[];
  returnType?: string;
}

interface ExtractedClass {
  name: string;
  qualifiedName: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  isExported: boolean;
  isAbstract: boolean;
}
\`\`\`

## Dependencies
- Tree-sitter integration (#1.4)

## Reference
- [PRD Appendix B: Data Extraction Examples](../docs/pm/knowledge-graph-PRD.md#appendix-b-data-extraction-examples)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.6 Relationship Extractor (Imports)

```bash
gh issue create \
  --title "[Phase 1] Implement RelationshipExtractor for imports [M]" \
  --label "phase-1,graph,size-M" \
  --body "## Description

Extract import relationships between files from parsed ASTs.

## Acceptance Criteria
- [ ] Create \`src/graph/extraction/RelationshipExtractor.ts\`
- [ ] Extract ES6 import statements:
  - Named imports
  - Default imports
  - Namespace imports
  - Type-only imports (TypeScript)
- [ ] Extract CommonJS require statements
- [ ] Resolve relative import paths to absolute
- [ ] Identify external package imports
- [ ] Include line number for each import
- [ ] Unit tests with various import patterns

## Technical Notes
\`\`\`typescript
interface ExtractedImport {
  sourceFile: string;
  targetPath: string;
  importType: 'named' | 'default' | 'namespace' | 'type-only';
  line: number;
  isExternal: boolean;
  importedNames?: string[];
}
\`\`\`

## Dependencies
- Tree-sitter integration (#1.4)
- Entity extractor (#1.5)

## Reference
- [PRD Appendix B: TypeScript Import Extraction](../docs/pm/knowledge-graph-PRD.md#b1-typescriptjavascript-import-extraction)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.7 Graph Ingestion Service

```bash
gh issue create \
  --title "[Phase 1] Create GraphIngestionService for storing to Neo4j [L]" \
  --label "phase-1,graph,size-L" \
  --body "## Description

Service to store extracted entities and relationships in Neo4j.

## Acceptance Criteria
- [ ] Create \`src/graph/GraphIngestionService.ts\`
- [ ] Create Repository nodes
- [ ] Create File nodes with BELONGS_TO relationships
- [ ] Create Function and Class nodes with DEFINED_IN relationships
- [ ] Create IMPORTS relationships between files
- [ ] Create IMPORTS_EXTERNAL for package dependencies
- [ ] Batch operations for performance
- [ ] Transactional file processing (all or nothing per file)
- [ ] Handle updates (delete old data, insert new)
- [ ] Integration tests with real Neo4j

## Technical Notes
\`\`\`typescript
interface GraphIngestionService {
  ingestRepository(repo: RepositoryInfo): Promise<void>;
  ingestFile(file: FileInfo, entities: ExtractedEntities): Promise<void>;
  ingestRelationships(relationships: ExtractedImport[]): Promise<void>;
  deleteFile(filePath: string, repository: string): Promise<void>;
  deleteRepository(repository: string): Promise<void>;
}
\`\`\`

## Dependencies
- Neo4jClient (#1.2)
- Entity extractor (#1.5)
- Relationship extractor (#1.6)

## Reference
- [ADR-0002: Integration Strategy](../docs/architecture/adr/0002-knowledge-graph-architecture.md#integration-strategy)

## Estimate
Large (L) - 4-5 days

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.8 Graph Populate CLI Command

```bash
gh issue create \
  --title "[Phase 1] Add CLI command: pk-mcp graph populate [M]" \
  --label "phase-1,graph,size-M" \
  --body "## Description

Create CLI command to populate the knowledge graph from an indexed repository.

## Acceptance Criteria
- [ ] Add \`graph populate <repository>\` subcommand
- [ ] Read files from cloned repository
- [ ] Parse files using tree-sitter
- [ ] Extract entities and relationships
- [ ] Store in Neo4j
- [ ] Show progress during population
- [ ] Report statistics on completion
- [ ] Handle errors gracefully
- [ ] Support \`--force\` flag to repopulate

## CLI Examples
\`\`\`bash
# Populate graph for a specific repository
pk-mcp graph populate PersonalKnowledgeMCP

# Force repopulate (delete existing data first)
pk-mcp graph populate PersonalKnowledgeMCP --force

# Show current graph status
pk-mcp graph status
\`\`\`

## Dependencies
- Graph ingestion service (#1.7)

## Reference
- [PRD Section 8.4: Migration Path](../docs/pm/knowledge-graph-PRD.md#84-migration-path)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.9 Neo4j Health Check Integration

```bash
gh issue create \
  --title "[Phase 1] Integrate Neo4j health into health checks [S]" \
  --label "phase-1,graph,infrastructure,size-S" \
  --body "## Description

Add Neo4j connectivity check to the existing health check system.

## Acceptance Criteria
- [ ] Add Neo4j to health check endpoint
- [ ] Check connection and basic query execution
- [ ] Report Neo4j status in health response
- [ ] Include graph database statistics (node count, relationship count)
- [ ] Handle Neo4j unavailable gracefully
- [ ] Update health check documentation

## Technical Notes
\`\`\`typescript
interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    chromadb: ServiceHealth;
    neo4j: ServiceHealth;  // New
    // ...
  };
}
\`\`\`

## Dependencies
- Neo4jClient (#1.2)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

### 1.10 Phase 1 Testing

```bash
gh issue create \
  --title "[Phase 1] Write unit and integration tests for graph module [M]" \
  --label "phase-1,graph,testing,size-M" \
  --body "## Description

Comprehensive test coverage for all Phase 1 graph components.

## Acceptance Criteria
- [ ] Unit tests for Neo4jClient
- [ ] Unit tests for tree-sitter parser
- [ ] Unit tests for entity extractor
- [ ] Unit tests for relationship extractor
- [ ] Integration tests for graph ingestion
- [ ] Integration tests with real Neo4j container
- [ ] Test coverage >90% for all graph modules
- [ ] Test data for various TypeScript patterns

## Test Categories
1. **Unit Tests**
   - Parser handles various TypeScript syntax
   - Entity extraction is accurate
   - Relationship extraction handles all import types

2. **Integration Tests**
   - End-to-end graph population
   - Query results are correct
   - Error handling works properly

## Dependencies
- All Phase 1 implementation issues

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph Foundation (Phase 1)
"
```

---

## Phase 2 Task Issues

### 2.1 GraphService Interface and Implementation

```bash
gh issue create \
  --title "[Phase 2] Implement GraphService interface and implementation [M]" \
  --label "phase-2,graph,mcp-tools,size-M" \
  --body "## Description

Create the GraphService that provides high-level graph query operations.

## Acceptance Criteria
- [ ] Create \`src/services/GraphService.ts\`
- [ ] Implement getDependencies method
- [ ] Implement getDependents method
- [ ] Implement getPath method
- [ ] Implement getArchitecture method
- [ ] Implement health check method
- [ ] Query result caching
- [ ] Query timeout handling
- [ ] Unit tests

## Interface Design
\`\`\`typescript
interface GraphService {
  getDependencies(query: DependencyQuery): Promise<DependencyResult>;
  getDependents(query: DependentQuery): Promise<DependentResult>;
  getPath(query: PathQuery): Promise<PathResult>;
  getArchitecture(query: ArchitectureQuery): Promise<ArchitectureResult>;
  healthCheck(): Promise<boolean>;
}
\`\`\`

## Dependencies
- Neo4jClient (Phase 1)
- Graph populated with data (Phase 1)

## Reference
- [PRD Section 5.2: Service Layer Design](../docs/pm/knowledge-graph-PRD.md#52-service-layer-design)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph MCP Tools (Phase 2-3)
"
```

### 2.2 get_dependencies MCP Tool

```bash
gh issue create \
  --title "[Phase 2] Create get_dependencies MCP tool handler [M]" \
  --label "phase-2,mcp-tools,graph,size-M,can-parallelize" \
  --body "## Description

Implement the get_dependencies MCP tool for querying forward dependencies.

## Acceptance Criteria
- [ ] Create tool handler in \`src/mcp/tools/\`
- [ ] Implement input validation per schema
- [ ] Support entity_type: file, function, class
- [ ] Support configurable depth (1-5)
- [ ] Support relationship type filtering
- [ ] Return structured response with metadata
- [ ] Register in MCP tool registry
- [ ] Performance within 100ms for depth 1
- [ ] Unit and integration tests

## Tool Schema
\`\`\`json
{
  \"name\": \"get_dependencies\",
  \"inputSchema\": {
    \"properties\": {
      \"entity_type\": { \"enum\": [\"file\", \"function\", \"class\"] },
      \"entity_path\": { \"type\": \"string\" },
      \"repository\": { \"type\": \"string\" },
      \"depth\": { \"type\": \"integer\", \"default\": 1, \"maximum\": 5 },
      \"relationship_types\": { \"type\": \"array\" }
    },
    \"required\": [\"entity_type\", \"entity_path\", \"repository\"]
  }
}
\`\`\`

## Dependencies
- GraphService (#2.1)

## Reference
- [PRD Section 6.1: Tool 1 - get_dependencies](../docs/pm/knowledge-graph-PRD.md#tool-1-get_dependencies)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph MCP Tools (Phase 2-3)
"
```

### 2.3 get_dependents MCP Tool

```bash
gh issue create \
  --title "[Phase 2] Create get_dependents MCP tool handler [M]" \
  --label "phase-2,mcp-tools,graph,size-M,can-parallelize" \
  --body "## Description

Implement the get_dependents MCP tool for impact analysis (reverse dependencies).

## Acceptance Criteria
- [ ] Create tool handler in \`src/mcp/tools/\`
- [ ] Implement input validation per schema
- [ ] Support entity_type: file, function, class, package
- [ ] Support configurable depth (1-5)
- [ ] Support cross-repository option
- [ ] Return structured response with metadata
- [ ] Register in MCP tool registry
- [ ] Performance within 100ms for depth 1
- [ ] Unit and integration tests

## Tool Schema
\`\`\`json
{
  \"name\": \"get_dependents\",
  \"inputSchema\": {
    \"properties\": {
      \"entity_type\": { \"enum\": [\"file\", \"function\", \"class\", \"package\"] },
      \"entity_path\": { \"type\": \"string\" },
      \"repository\": { \"type\": \"string\" },
      \"depth\": { \"type\": \"integer\", \"default\": 1, \"maximum\": 5 },
      \"include_cross_repo\": { \"type\": \"boolean\", \"default\": false }
    },
    \"required\": [\"entity_type\", \"entity_path\"]
  }
}
\`\`\`

## Dependencies
- GraphService (#2.1)

## Reference
- [PRD Section 6.1: Tool 2 - get_dependents](../docs/pm/knowledge-graph-PRD.md#tool-2-get_dependents)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph MCP Tools (Phase 2-3)
"
```

### 2.4 MCP Tool Registration and Documentation

```bash
gh issue create \
  --title "[Phase 2] Register graph tools in MCP registry and document [S]" \
  --label "phase-2,mcp-tools,documentation,size-S" \
  --body "## Description

Register new graph tools in the MCP tool registry and create documentation.

## Acceptance Criteria
- [ ] Add tools to MCP tool registry
- [ ] Tools appear in tool listing
- [ ] Create documentation for each tool
- [ ] Include usage examples
- [ ] Include sample queries and responses
- [ ] Update README with graph capabilities

## Documentation Requirements
- Clear description of what each tool does
- When to use each tool
- Input parameter explanations
- Example use cases with Claude Code
- Performance expectations

## Dependencies
- get_dependencies tool (#2.2)
- get_dependents tool (#2.3)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Knowledge Graph MCP Tools (Phase 2-3)
"
```

---

## Phase 3 Task Issues

### 3.1 Function Call Relationship Extractor

```bash
gh issue create \
  --title "[Phase 3] Enhance extraction for function call relationships [M]" \
  --label "phase-3,graph,size-M" \
  --body "## Description

Extend relationship extraction to capture function call relationships.

## Acceptance Criteria
- [ ] Extract function calls from AST
- [ ] Link caller function to callee function
- [ ] Handle method calls on objects
- [ ] Handle async/await call patterns
- [ ] Include line number for each call
- [ ] Store CALLS relationships in Neo4j
- [ ] Update graph ingestion service
- [ ] Unit tests for call extraction

## Technical Notes
Function call extraction is more complex than imports:
- Need to resolve function references
- Handle aliased imports
- Distinguish between local and imported functions
- May need type information for accurate resolution

## Limitations (Acceptable for MVP)
- May not resolve all dynamic calls
- May not handle complex metaprogramming patterns
- Focus on direct, static function calls

## Dependencies
- Entity extractor (Phase 1)
- Relationship extractor (Phase 1)

## Reference
- [PRD Section 7: Data Model - CALLS relationship](../docs/pm/knowledge-graph-PRD.md#72-relationship-types)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph MCP Tools (Phase 2-3)
"
```

### 3.2 get_architecture MCP Tool

```bash
gh issue create \
  --title "[Phase 3] Implement get_architecture MCP tool [M]" \
  --label "phase-3,mcp-tools,graph,size-M,can-parallelize" \
  --body "## Description

Implement the get_architecture MCP tool for structural overview queries.

## Acceptance Criteria
- [ ] Create tool handler in \`src/mcp/tools/\`
- [ ] Implement input validation per schema
- [ ] Support detail levels: packages, modules, files, entities
- [ ] Support scope filtering (specific package/directory)
- [ ] Support external dependency inclusion
- [ ] Return hierarchical structure
- [ ] Include inter-module dependencies
- [ ] Performance within 1000ms
- [ ] Unit and integration tests

## Tool Schema
\`\`\`json
{
  \"name\": \"get_architecture\",
  \"inputSchema\": {
    \"properties\": {
      \"repository\": { \"type\": \"string\" },
      \"scope\": { \"type\": \"string\" },
      \"detail_level\": { \"enum\": [\"packages\", \"modules\", \"files\", \"entities\"] },
      \"include_external\": { \"type\": \"boolean\", \"default\": false }
    },
    \"required\": [\"repository\"]
  }
}
\`\`\`

## Dependencies
- GraphService (#2.1)

## Reference
- [PRD Section 6.1: Tool 3 - get_architecture](../docs/pm/knowledge-graph-PRD.md#tool-3-get_architecture)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph MCP Tools (Phase 2-3)
"
```

### 3.3 find_path MCP Tool

```bash
gh issue create \
  --title "[Phase 3] Implement find_path MCP tool [M]" \
  --label "phase-3,mcp-tools,graph,size-M,can-parallelize" \
  --body "## Description

Implement the find_path MCP tool for tracing paths between entities.

## Acceptance Criteria
- [ ] Create tool handler in \`src/mcp/tools/\`
- [ ] Implement input validation per schema
- [ ] Use Cypher shortestPath algorithm
- [ ] Support configurable max_hops (1-20)
- [ ] Support relationship type filtering
- [ ] Return path with all intermediate nodes
- [ ] Handle no path found gracefully
- [ ] Performance within 500ms for typical queries
- [ ] Unit and integration tests

## Tool Schema
\`\`\`json
{
  \"name\": \"find_path\",
  \"inputSchema\": {
    \"properties\": {
      \"from_entity\": { \"type\": \"string\" },
      \"to_entity\": { \"type\": \"string\" },
      \"repository\": { \"type\": \"string\" },
      \"max_hops\": { \"type\": \"integer\", \"default\": 10, \"maximum\": 20 },
      \"relationship_types\": { \"type\": \"array\" }
    },
    \"required\": [\"from_entity\", \"to_entity\", \"repository\"]
  }
}
\`\`\`

## Dependencies
- GraphService (#2.1)
- Function call extractor (#3.1) for CALLS-based paths

## Reference
- [PRD Section 6.1: Tool 4 - find_path](../docs/pm/knowledge-graph-PRD.md#tool-4-find_path)
- [PRD Appendix A: Path Query Example](../docs/pm/knowledge-graph-PRD.md#a4-function-call-chain)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph MCP Tools (Phase 2-3)
"
```

### 3.4 Phase 3 Testing and Documentation

```bash
gh issue create \
  --title "[Phase 3] Comprehensive testing with complex repositories [M]" \
  --label "phase-3,testing,size-M" \
  --body "## Description

Test all graph features with realistic, complex repositories.

## Acceptance Criteria
- [ ] Test with PersonalKnowledgeMCP repository itself
- [ ] Test with medium-sized TypeScript project (1K-5K files)
- [ ] Verify dependency queries are accurate
- [ ] Verify architecture queries provide useful information
- [ ] Verify path finding works across file boundaries
- [ ] Performance testing against targets
- [ ] Document any edge cases or limitations
- [ ] Update documentation based on findings

## Test Scenarios
1. Query dependencies for a core service file
2. Find all dependents of a shared utility
3. Explore architecture of src/ directory
4. Trace call path from API route to database

## Dependencies
- All Phase 2-3 tools implemented

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Knowledge Graph MCP Tools (Phase 2-3)
"
```

---

## Phase 4 Task Issues

### 4.1 EmbeddingProvider Interface Updates

```bash
gh issue create \
  --title "[Phase 4] Define updated EmbeddingProvider interface [S]" \
  --label "phase-4,embeddings,size-S,can-parallelize" \
  --body "## Description

Update the EmbeddingProvider interface to support multiple provider types.

## Acceptance Criteria
- [ ] Review existing EmbeddingProvider interface
- [ ] Add \`providerId\` and \`modelId\` properties
- [ ] Add \`dimensions\` property
- [ ] Add \`healthCheck()\` method if not present
- [ ] Add \`getCapabilities()\` method
- [ ] Define ProviderCapabilities type
- [ ] Update type definitions
- [ ] No breaking changes to existing code

## Interface Design
\`\`\`typescript
interface EmbeddingProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly dimensions: number;

  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  healthCheck(): Promise<boolean>;
  getCapabilities(): ProviderCapabilities;
}

interface ProviderCapabilities {
  maxBatchSize: number;
  maxTokensPerText: number;
  supportsGPU: boolean;
  requiresNetwork: boolean;
  estimatedLatencyMs: number;
}
\`\`\`

## Dependencies
- None (can parallelize)

## Reference
- [ADR-0003: Provider Interface Consistency](../docs/architecture/adr/0003-local-embeddings-architecture.md#provider-interface-consistency)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.2 Refactor OpenAI Provider

```bash
gh issue create \
  --title "[Phase 4] Refactor OpenAIEmbeddingProvider to updated interface [S]" \
  --label "phase-4,embeddings,size-S" \
  --body "## Description

Update the existing OpenAI provider to implement the updated interface.

## Acceptance Criteria
- [ ] Add providerId, modelId, dimensions properties
- [ ] Implement getCapabilities method
- [ ] Ensure healthCheck works correctly
- [ ] No functional changes to existing behavior
- [ ] Update tests
- [ ] Verify existing functionality still works

## Dependencies
- Updated interface (#4.1)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.3 Transformers.js Provider Implementation

```bash
gh issue create \
  --title "[Phase 4] Implement TransformersJsEmbeddingProvider [M]" \
  --label "phase-4,embeddings,size-M" \
  --body "## Description

Implement the local embedding provider using Transformers.js.

## Acceptance Criteria
- [ ] Add \`@xenova/transformers\` dependency
- [ ] Create \`src/providers/TransformersJsEmbeddingProvider.ts\`
- [ ] Implement lazy model loading
- [ ] Implement \`generateEmbedding\` with mean pooling
- [ ] Implement \`generateEmbeddings\` for batch processing
- [ ] Handle model download with progress reporting
- [ ] Support configurable model selection
- [ ] Support configurable cache directory
- [ ] Verify Bun compatibility
- [ ] Unit tests with mocked pipeline
- [ ] Integration tests with actual model

## Configuration
- Default model: \`Xenova/all-MiniLM-L6-v2\`
- Cache directory: \`~/.cache/transformers.js\`

## Performance Targets
- Single text: <100ms (warm)
- Model load: <10s (first use)
- Memory: <500MB

## Dependencies
- Updated interface (#4.1)

## Reference
- [ADR-0003: TransformersJsEmbeddingProvider](../docs/architecture/adr/0003-local-embeddings-architecture.md#transformersjsembeddingprovider)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.4 Ollama Provider Implementation

```bash
gh issue create \
  --title "[Phase 4] Implement OllamaEmbeddingProvider [M]" \
  --label "phase-4,embeddings,size-M,can-parallelize" \
  --body "## Description

Implement the local embedding provider using Ollama API.

## Acceptance Criteria
- [ ] Create \`src/providers/OllamaEmbeddingProvider.ts\`
- [ ] Implement REST API calls to Ollama
- [ ] Implement \`generateEmbedding\` via /api/embeddings
- [ ] Implement \`generateEmbeddings\` with sequential calls
- [ ] Support configurable base URL
- [ ] Support configurable keep_alive
- [ ] Implement health check (verify model available)
- [ ] Handle connection errors gracefully
- [ ] Unit tests with mocked fetch
- [ ] Integration tests with running Ollama

## Configuration
- Default base URL: \`http://localhost:11434\`
- Default model: \`nomic-embed-text\`
- Default keep_alive: \`5m\`

## Performance Targets (with GPU)
- Single text: <30ms
- Batch of 10: <100ms

## Dependencies
- Updated interface (#4.1)

## Reference
- [ADR-0003: OllamaEmbeddingProvider](../docs/architecture/adr/0003-local-embeddings-architecture.md#ollamaembeddingprovider)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.5 Provider Factory and Selection

```bash
gh issue create \
  --title "[Phase 4] Create EmbeddingProviderFactory with provider selection [M]" \
  --label "phase-4,embeddings,size-M" \
  --body "## Description

Create factory for instantiating embedding providers based on configuration.

## Acceptance Criteria
- [ ] Create \`src/providers/EmbeddingProviderFactory.ts\`
- [ ] Support provider types: openai, transformersjs, ollama
- [ ] Support aliases: local -> transformersjs
- [ ] Create provider based on environment variables
- [ ] Create provider based on explicit config
- [ ] Validate configuration on creation
- [ ] Provide helpful error messages for misconfiguration
- [ ] Unit tests for factory

## Environment Variables
\`\`\`bash
EMBEDDING_PROVIDER=transformersjs
TRANSFORMERS_MODEL=Xenova/all-MiniLM-L6-v2
OLLAMA_BASE_URL=http://localhost:11434
\`\`\`

## Dependencies
- All provider implementations (#4.2, #4.3, #4.4)

## Reference
- [ADR-0003: Updated Factory Pattern](../docs/architecture/adr/0003-local-embeddings-architecture.md#updated-factory-pattern)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.6 Model Download and Caching

```bash
gh issue create \
  --title "[Phase 4] Add model download and caching logic [S]" \
  --label "phase-4,embeddings,size-S" \
  --body "## Description

Implement model download with progress reporting and caching.

## Acceptance Criteria
- [ ] Show download progress during model fetch
- [ ] Cache models to configured directory
- [ ] Validate cached model integrity
- [ ] Support manual model placement (air-gapped)
- [ ] Clear instructions for first-time use
- [ ] Handle download failures gracefully

## UX Requirements
\`\`\`
Downloading model: Xenova/all-MiniLM-L6-v2
[################................] 45% - model.onnx (10.3 MB / 23 MB)
\`\`\`

## Dependencies
- Transformers.js provider (#4.3)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.7 CLI Provider Flag

```bash
gh issue create \
  --title "[Phase 4] Update CLI with --provider flag for index command [S]" \
  --label "phase-4,embeddings,size-S" \
  --body "## Description

Add --provider flag to the index CLI command.

## Acceptance Criteria
- [ ] Add \`--provider\` option to index command
- [ ] Accept values: openai, transformersjs, local, ollama
- [ ] Default to environment variable if not specified
- [ ] Validate provider is available before indexing
- [ ] Store provider info in repository metadata
- [ ] Update help text

## CLI Examples
\`\`\`bash
# Use default (from env or config)
pk-mcp index https://github.com/user/repo

# Explicitly use local
pk-mcp index --provider local https://github.com/user/repo

# Use Ollama
pk-mcp index --provider ollama https://github.com/user/repo
\`\`\`

## Dependencies
- Provider factory (#4.5)

## Reference
- [ADR-0003: CLI Provider Selection](../docs/architecture/adr/0003-local-embeddings-architecture.md#cli-provider-selection)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.8 Provider Status Command

```bash
gh issue create \
  --title "[Phase 4] Add pk-mcp providers status and setup commands [S]" \
  --label "phase-4,embeddings,size-S" \
  --body "## Description

Add CLI commands for managing embedding providers.

## Acceptance Criteria
- [ ] Add \`providers status\` command
- [ ] Show available providers and their status
- [ ] Show which repositories use which provider
- [ ] Add \`providers setup\` command
- [ ] Download/prepare local models via setup

## CLI Examples
\`\`\`bash
# Check provider status
pk-mcp providers status
# Output:
# Provider             Status    Model                    Dimension
# openai               ready     text-embedding-3-small   1536
# transformersjs       ready     all-MiniLM-L6-v2         384
# ollama               not-found

# Download a model
pk-mcp providers setup transformersjs
pk-mcp providers setup transformersjs --model all-mpnet-base-v2
\`\`\`

## Dependencies
- Provider factory (#4.5)

## Reference
- [PRD Section 11.5: CLI Integration](../docs/pm/knowledge-graph-PRD.md#115-cli-integration)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.9 Provider-Aware Search Service

```bash
gh issue create \
  --title "[Phase 4] Update search service for provider-aware query embedding [M]" \
  --label "phase-4,embeddings,size-M" \
  --body "## Description

Update search service to use the correct provider for query embedding.

## Acceptance Criteria
- [ ] Store embedding provider in collection/repository metadata
- [ ] On search, determine which provider(s) are needed
- [ ] Embed query with appropriate provider(s)
- [ ] Handle multi-provider searches (group by provider)
- [ ] Warn if querying collection with different provider
- [ ] Validate dimension compatibility
- [ ] Update search response with provider info

## Technical Notes
\`\`\`typescript
// Query routing logic
async function search(request: SearchRequest): Promise<SearchResult[]> {
  // Group repositories by provider
  const reposByProvider = groupByProvider(request.repositories);

  const results: SearchResult[] = [];
  for (const [provider, repos] of reposByProvider) {
    const queryEmbedding = await provider.generateEmbeddings([request.query]);
    const providerResults = await searchWithEmbedding(queryEmbedding[0], repos);
    results.push(...providerResults);
  }

  return mergeResults(results);
}
\`\`\`

## Dependencies
- Provider factory (#4.5)
- Collection metadata updated

## Reference
- [PRD Section 11.6: Query-Time Considerations](../docs/pm/knowledge-graph-PRD.md#116-query-time-considerations)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.10 Local Embeddings Testing

```bash
gh issue create \
  --title "[Phase 4] Integration tests and quality benchmarks for local providers [M]" \
  --label "phase-4,embeddings,testing,size-M" \
  --body "## Description

Comprehensive testing and quality benchmarking for local embedding providers.

## Acceptance Criteria
- [ ] Integration tests for Transformers.js provider
- [ ] Integration tests for Ollama provider
- [ ] Offline test (network disabled)
- [ ] Quality benchmark: compare top-10 results vs OpenAI
- [ ] Performance benchmark: measure indexing speed
- [ ] Memory usage profiling
- [ ] Test cross-platform (Windows primary)
- [ ] Test coverage >90%

## Quality Targets
- Search quality: >80% overlap with OpenAI in top-10 results
- Indexing speed: <2x OpenAI time
- Memory usage: <1GB peak

## Dependencies
- All Phase 4 provider implementations

## Reference
- [PRD Section 9.5: Local Embeddings Success Criteria](../docs/pm/knowledge-graph-PRD.md#95-local-embeddings-success-criteria)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

### 4.11 Provider Documentation

```bash
gh issue create \
  --title "[Phase 4] Document provider selection and trade-offs [S]" \
  --label "phase-4,embeddings,documentation,size-S" \
  --body "## Description

Create comprehensive documentation for embedding provider selection.

## Acceptance Criteria
- [ ] Document each provider (OpenAI, Transformers.js, Ollama)
- [ ] Document quality/speed/cost trade-offs
- [ ] Document model options and dimensions
- [ ] Document per-repository configuration
- [ ] Document offline usage
- [ ] Document CI/CD integration patterns
- [ ] Add troubleshooting guide
- [ ] Update README

## Documentation Structure
1. Provider Overview
2. Quick Start Guide
3. Configuration Reference
4. Model Selection Guide
5. Performance Expectations
6. Troubleshooting

## Dependencies
- All Phase 4 implementation complete

## Reference
- [ADR-0003: Appendix A - Model Quality Comparison](../docs/architecture/adr/0003-local-embeddings-architecture.md#appendix-a-model-quality-comparison)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Local Embeddings Provider (Phase 4)
"
```

---

## Phase 5 Task Issues

### 5.1 Integrate Graph into Incremental Updates

```bash
gh issue create \
  --title "[Phase 5] Integrate graph extraction into IncrementalUpdateCoordinator [M]" \
  --label "phase-5,graph,size-M" \
  --body "## Description

Integrate graph updates into the existing incremental update pipeline.

## Acceptance Criteria
- [ ] On file change: update graph data alongside vector data
- [ ] Delete old graph nodes/relationships for changed files
- [ ] Re-extract entities and relationships
- [ ] Store new graph data
- [ ] Handle failures gracefully (don't block vector updates)
- [ ] Log graph update timing
- [ ] Integration tests

## Update Flow
1. File change detected
2. Delete existing graph data for file
3. Re-parse file with tree-sitter
4. Extract entities and relationships
5. Store in Neo4j
6. Continue with vector embedding (parallel or sequential)

## Dependencies
- Graph ingestion service (Phase 1)
- Incremental update coordinator (existing)

## Reference
- [PRD Section 8.2: Incremental Update Strategy](../docs/pm/knowledge-graph-PRD.md#82-incremental-update-strategy)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Integration and Polish (Phase 5)
"
```

### 5.2 Graph Populate-All Command

```bash
gh issue create \
  --title "[Phase 5] Create pk-mcp graph populate-all command [S]" \
  --label "phase-5,graph,size-S" \
  --body "## Description

Create CLI command to populate graph for all indexed repositories.

## Acceptance Criteria
- [ ] Add \`graph populate-all\` subcommand
- [ ] Iterate through all indexed repositories
- [ ] Populate graph for each
- [ ] Show progress and status
- [ ] Handle failures per-repository (continue with others)
- [ ] Summary report on completion

## CLI Examples
\`\`\`bash
# Populate graph for all repositories
pk-mcp graph populate-all

# Output:
# Populating graph for 5 repositories...
# [1/5] PersonalKnowledgeMCP: 234 entities, 567 relationships (2.3s)
# [2/5] other-repo: 156 entities, 312 relationships (1.5s)
# ...
# Complete: 5/5 repositories processed
\`\`\`

## Dependencies
- Graph populate command (Phase 1)

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Integration and Polish (Phase 5)
"
```

### 5.3 Neo4j Backup Scripts

```bash
gh issue create \
  --title "[Phase 5] Update backup scripts to include Neo4j [S]" \
  --label "phase-5,infrastructure,size-S" \
  --body "## Description

Update backup and restore scripts to include Neo4j data.

## Acceptance Criteria
- [ ] Document Neo4j backup procedure
- [ ] Create backup script for Neo4j data volume
- [ ] Create restore script for Neo4j data
- [ ] Integrate with existing backup workflow
- [ ] Test backup and restore cycle
- [ ] Document recovery procedures

## Backup Strategy
- Use \`neo4j-admin dump\` for consistent backup
- Or backup Docker volume directly
- Coordinate with ChromaDB backup timing

## Dependencies
- Neo4j running in Docker

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Integration and Polish (Phase 5)
"
```

### 5.4 Graph Query Metrics

```bash
gh issue create \
  --title "[Phase 5] Add graph query timing to metrics [S]" \
  --label "phase-5,graph,infrastructure,size-S" \
  --body "## Description

Add performance metrics for graph queries.

## Acceptance Criteria
- [ ] Log query execution time for all graph queries
- [ ] Track query types (dependencies, dependents, architecture, path)
- [ ] Track query depth
- [ ] Track result count
- [ ] Add to existing metrics/observability system
- [ ] Create performance dashboard or report

## Metrics to Track
- Query latency (p50, p95, p99)
- Query count by type
- Cache hit rate (if caching implemented)
- Error rate

## Dependencies
- GraphService (Phase 2)
- Existing metrics infrastructure

## Estimate
Small (S) - 1 day or less

## Parent Epic
[Epic] Integration and Polish (Phase 5)
"
```

### 5.5 Performance Testing at Scale

```bash
gh issue create \
  --title "[Phase 5] Performance testing at scale (10K+ files) [M]" \
  --label "phase-5,testing,size-M" \
  --body "## Description

Comprehensive performance testing with large repositories.

## Acceptance Criteria
- [ ] Test with repository containing 10K+ files
- [ ] Measure graph population time
- [ ] Measure query performance at scale
- [ ] Measure memory usage during indexing
- [ ] Measure memory usage during queries
- [ ] Document performance characteristics
- [ ] Identify and address bottlenecks
- [ ] Create performance tuning guide

## Performance Targets
| Operation | Target |
|-----------|--------|
| Simple query (1 hop) | <100ms |
| Complex query (3 hops) | <300ms |
| Architecture overview | <1000ms |
| Full repo graph population | <30 min for 10K files |

## Dependencies
- All graph functionality implemented

## Reference
- [PRD Section 4.3: Performance Requirements](../docs/pm/knowledge-graph-PRD.md#43-performance-requirements)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Integration and Polish (Phase 5)
"
```

### 5.6 Optional ONNX Runtime Provider

```bash
gh issue create \
  --title "[Phase 5] Optional: Implement LocalONNXProvider for better performance [M]" \
  --label "phase-5,embeddings,size-M" \
  --body "## Description

(Optional) Implement ONNX Runtime-based provider for improved performance over Transformers.js.

## Acceptance Criteria
- [ ] Evaluate ONNX Runtime performance vs Transformers.js
- [ ] If significant improvement, implement provider
- [ ] Use onnxruntime-node package
- [ ] Handle tokenization separately
- [ ] Support GPU acceleration if available
- [ ] Performance benchmarks

## Decision Criteria
Only implement if:
- ONNX Runtime provides >30% performance improvement
- Bun compatibility is confirmed
- GPU acceleration works on Windows

## Dependencies
- Transformers.js provider working (Phase 4)
- Performance data from benchmarks

## Reference
- [ADR-0003: Option 4 - ONNX Runtime](../docs/architecture/adr/0003-local-embeddings-architecture.md#option-4-onnx-runtime-nodejs-direct-bindings)

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Integration and Polish (Phase 5)
"
```

### 5.7 Final Documentation and User Guide

```bash
gh issue create \
  --title "[Phase 5] Final documentation and user guides [M]" \
  --label "phase-5,documentation,size-M" \
  --body "## Description

Create comprehensive documentation for all new features.

## Acceptance Criteria
- [ ] Update README with new capabilities
- [ ] Create Knowledge Graph user guide
- [ ] Create Local Embeddings user guide
- [ ] Document all new CLI commands
- [ ] Document configuration options
- [ ] Create troubleshooting guide
- [ ] Update API documentation
- [ ] Create quick start guide for new users

## Documentation Structure
\`\`\`
docs/
  guides/
    knowledge-graph.md
    local-embeddings.md
    troubleshooting.md
  api/
    mcp-tools.md
    cli-reference.md
\`\`\`

## Dependencies
- All features implemented and tested

## Estimate
Medium (M) - 2-3 days

## Parent Epic
[Epic] Integration and Polish (Phase 5)
"
```

---

## Execution Instructions

To create all issues, run the bash commands above in sequence. Alternatively, use the GitHub web interface to create issues manually using the content provided.

### Issue Dependencies

After creating all issues, update the following cross-references:

1. Each task issue should reference its parent epic
2. Issues with dependencies should link to their dependency issues
3. Use GitHub Projects to organize issues by phase

### Labels Summary

| Label | Count | Purpose |
|-------|-------|---------|
| phase-1 | 10 | Foundation work |
| phase-2 | 4 | Core MCP tools |
| phase-3 | 4 | Advanced tools |
| phase-4 | 11 | Local embeddings |
| phase-5 | 7 | Integration |
| graph | 20 | Knowledge graph work |
| embeddings | 11 | Embedding provider work |
| mcp-tools | 6 | MCP tool handlers |
| can-parallelize | 8 | Items that can run in parallel |
| epic | 4 | Parent epic issues |

### Recommended Execution Order

1. Create labels first
2. Create epic issues
3. Create Phase 1 issues
4. Create Phase 2-3 issues
5. Create Phase 4 issues
6. Create Phase 5 issues
7. Link child issues to parent epics
