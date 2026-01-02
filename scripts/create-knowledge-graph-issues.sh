#!/bin/bash
# Script to create GitHub issues for Knowledge Graph and Local Embeddings initiative
# Run from the root of the PersonalKnowledgeMCP repository

set -e

echo "Creating labels..."

# Phase labels
gh label create "phase-1" --description "Phase 1: Knowledge Graph Foundation" --color "0E8A16" 2>/dev/null || echo "Label phase-1 already exists"
gh label create "phase-2" --description "Phase 2: Core MCP Tools" --color "1D76DB" 2>/dev/null || echo "Label phase-2 already exists"
gh label create "phase-3" --description "Phase 3: Advanced Tools" --color "5319E7" 2>/dev/null || echo "Label phase-3 already exists"
gh label create "phase-4" --description "Phase 4: Local Embeddings" --color "D93F0B" 2>/dev/null || echo "Label phase-4 already exists"
gh label create "phase-5" --description "Phase 5: Integration & Polish" --color "FBCA04" 2>/dev/null || echo "Label phase-5 already exists"

# Component labels
gh label create "graph" --description "Knowledge Graph (Neo4j)" --color "C5DEF5" 2>/dev/null || echo "Label graph already exists"
gh label create "embeddings" --description "Embedding Providers" --color "F9D0C4" 2>/dev/null || echo "Label embeddings already exists"
gh label create "mcp-tools" --description "MCP Tool Handlers" --color "BFD4F2" 2>/dev/null || echo "Label mcp-tools already exists"
gh label create "infrastructure" --description "Infrastructure & DevOps" --color "D4C5F9" 2>/dev/null || echo "Label infrastructure already exists"
gh label create "testing" --description "Testing" --color "0052CC" 2>/dev/null || echo "Label testing already exists"

# Workflow labels
gh label create "epic" --description "Epic - parent issue" --color "3E4B9E" 2>/dev/null || echo "Label epic already exists"
gh label create "can-parallelize" --description "Can be worked on in parallel" --color "C2E0C6" 2>/dev/null || echo "Label can-parallelize already exists"

# Size labels
gh label create "size-S" --description "Small: 1 day or less" --color "E6E6E6" 2>/dev/null || echo "Label size-S already exists"
gh label create "size-M" --description "Medium: 2-3 days" --color "BDBDBD" 2>/dev/null || echo "Label size-M already exists"
gh label create "size-L" --description "Large: 4-5 days" --color "757575" 2>/dev/null || echo "Label size-L already exists"

echo "Labels created successfully!"
echo ""
echo "Creating Epic issues..."

# Epic 1: Knowledge Graph Foundation
EPIC1=$(gh issue create \
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
- [Knowledge Graph PRD](docs/pm/knowledge-graph-PRD.md)
- [ADR-0002: Knowledge Graph Architecture](docs/architecture/adr/0002-knowledge-graph-architecture.md)

## Success Criteria
- Neo4j container running in Docker Compose
- Can index a TypeScript repository and query relationships
- Performance within targets (<100ms for simple queries)")
echo "Created Epic 1: $EPIC1"

# Epic 2: Knowledge Graph MCP Tools
EPIC2=$(gh issue create \
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
- [Knowledge Graph PRD - Section 6](docs/pm/knowledge-graph-PRD.md#6-mcp-tool-design)
- [ADR-0002: MCP Tool Design](docs/architecture/adr/0002-knowledge-graph-architecture.md#mcp-tool-design)

## Success Criteria
- Claude Code can execute all graph query tools
- Accurate results compared to manual analysis
- Performance within targets")
echo "Created Epic 2: $EPIC2"

# Epic 3: Local Embeddings Provider
EPIC3=$(gh issue create \
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
- [Knowledge Graph PRD - Section 11](docs/pm/knowledge-graph-PRD.md#11-local-embeddings-provider)
- [ADR-0003: Local Embeddings Architecture](docs/architecture/adr/0003-local-embeddings-architecture.md)

## Success Criteria
- Index repository completely offline
- Search quality >80% overlap with OpenAI
- Indexing speed <2x OpenAI time
- Memory usage <1GB peak")
echo "Created Epic 3: $EPIC3"

# Epic 4: Integration and Polish
EPIC4=$(gh issue create \
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
- [Roadmap](docs/pm/knowledge-graph-embeddings-roadmap.md)

## Success Criteria
- Incremental updates maintain graph consistency
- Existing repositories can be migrated
- Performance meets all targets
- Documentation complete")
echo "Created Epic 4: $EPIC4"

echo ""
echo "Creating Phase 1 task issues..."

# Phase 1 Issues
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

## Reference
- [ADR-0002: Data Model Design](docs/architecture/adr/0002-knowledge-graph-architecture.md#data-model-design)

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC1"

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

## Dependencies
- npm package: \`neo4j-driver\`
- Neo4j container running (docker-compose)

## Reference
- [ADR-0002: Neo4j Driver Usage](docs/architecture/adr/0002-knowledge-graph-architecture.md#implementation-notes)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC1"

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

## Reference
- [ADR-0002: Schema Definition](docs/architecture/adr/0002-knowledge-graph-architecture.md#schema-definition-cypher)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC1"

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

## Reference
- [PRD Section 4.4: Data Extraction Requirements](docs/pm/knowledge-graph-PRD.md#44-data-extraction-requirements)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC1"

gh issue create \
  --title "[Phase 1] Implement EntityExtractor for functions and classes [M]" \
  --label "phase-1,graph,size-M" \
  --body "## Description

Extract function and class definitions from parsed ASTs.

## Acceptance Criteria
- [ ] Create \`src/graph/extraction/EntityExtractor.ts\`
- [ ] Extract function definitions with metadata
- [ ] Extract class definitions with metadata
- [ ] Extract interface definitions
- [ ] Return structured entity objects
- [ ] Unit tests with sample TypeScript files

## Reference
- [PRD Appendix B: Data Extraction Examples](docs/pm/knowledge-graph-PRD.md#appendix-b-data-extraction-examples)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC1"

gh issue create \
  --title "[Phase 1] Implement RelationshipExtractor for imports [M]" \
  --label "phase-1,graph,size-M" \
  --body "## Description

Extract import relationships between files from parsed ASTs.

## Acceptance Criteria
- [ ] Create \`src/graph/extraction/RelationshipExtractor.ts\`
- [ ] Extract ES6 import statements (named, default, namespace, type-only)
- [ ] Extract CommonJS require statements
- [ ] Resolve relative import paths to absolute
- [ ] Identify external package imports
- [ ] Include line number for each import
- [ ] Unit tests with various import patterns

## Reference
- [PRD Appendix B: TypeScript Import Extraction](docs/pm/knowledge-graph-PRD.md#b1-typescriptjavascript-import-extraction)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC1"

gh issue create \
  --title "[Phase 1] Create GraphIngestionService for storing to Neo4j [L]" \
  --label "phase-1,graph,size-L" \
  --body "## Description

Service to store extracted entities and relationships in Neo4j.

## Acceptance Criteria
- [ ] Create \`src/graph/GraphIngestionService.ts\`
- [ ] Create Repository, File, Function, Class nodes
- [ ] Create BELONGS_TO, DEFINED_IN, IMPORTS relationships
- [ ] Batch operations for performance
- [ ] Transactional file processing
- [ ] Handle updates (delete old data, insert new)
- [ ] Integration tests with real Neo4j

## Reference
- [ADR-0002: Integration Strategy](docs/architecture/adr/0002-knowledge-graph-architecture.md#integration-strategy)

## Estimate: Large (L) - 4-5 days
## Parent Epic: $EPIC1"

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
- [ ] Support \`--force\` flag to repopulate

## Reference
- [PRD Section 8.4: Migration Path](docs/pm/knowledge-graph-PRD.md#84-migration-path)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC1"

gh issue create \
  --title "[Phase 1] Integrate Neo4j health into health checks [S]" \
  --label "phase-1,graph,infrastructure,size-S" \
  --body "## Description

Add Neo4j connectivity check to the existing health check system.

## Acceptance Criteria
- [ ] Add Neo4j to health check endpoint
- [ ] Check connection and basic query execution
- [ ] Report Neo4j status in health response
- [ ] Handle Neo4j unavailable gracefully
- [ ] Update health check documentation

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC1"

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

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC1"

echo ""
echo "Creating Phase 2 task issues..."

# Phase 2 Issues
gh issue create \
  --title "[Phase 2] Implement GraphService interface and implementation [M]" \
  --label "phase-2,graph,mcp-tools,size-M" \
  --body "## Description

Create the GraphService that provides high-level graph query operations.

## Acceptance Criteria
- [ ] Create \`src/services/GraphService.ts\`
- [ ] Implement getDependencies, getDependents, getPath, getArchitecture methods
- [ ] Query result caching
- [ ] Query timeout handling
- [ ] Unit tests

## Reference
- [PRD Section 5.2: Service Layer Design](docs/pm/knowledge-graph-PRD.md#52-service-layer-design)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC2"

gh issue create \
  --title "[Phase 2] Create get_dependencies MCP tool handler [M]" \
  --label "phase-2,mcp-tools,graph,size-M,can-parallelize" \
  --body "## Description

Implement the get_dependencies MCP tool for querying forward dependencies.

## Acceptance Criteria
- [ ] Create tool handler in \`src/mcp/tools/\`
- [ ] Support entity_type: file, function, class
- [ ] Support configurable depth (1-5)
- [ ] Support relationship type filtering
- [ ] Register in MCP tool registry
- [ ] Performance within 100ms for depth 1
- [ ] Unit and integration tests

## Reference
- [PRD Section 6.1: Tool 1 - get_dependencies](docs/pm/knowledge-graph-PRD.md#tool-1-get_dependencies)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC2"

gh issue create \
  --title "[Phase 2] Create get_dependents MCP tool handler [M]" \
  --label "phase-2,mcp-tools,graph,size-M,can-parallelize" \
  --body "## Description

Implement the get_dependents MCP tool for impact analysis (reverse dependencies).

## Acceptance Criteria
- [ ] Create tool handler in \`src/mcp/tools/\`
- [ ] Support entity_type: file, function, class, package
- [ ] Support configurable depth (1-5)
- [ ] Support cross-repository option
- [ ] Register in MCP tool registry
- [ ] Performance within 100ms for depth 1
- [ ] Unit and integration tests

## Reference
- [PRD Section 6.1: Tool 2 - get_dependents](docs/pm/knowledge-graph-PRD.md#tool-2-get_dependents)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC2"

gh issue create \
  --title "[Phase 2] Register graph tools in MCP registry and document [S]" \
  --label "phase-2,mcp-tools,documentation,size-S" \
  --body "## Description

Register new graph tools in the MCP tool registry and create documentation.

## Acceptance Criteria
- [ ] Add tools to MCP tool registry
- [ ] Create documentation for each tool
- [ ] Include usage examples
- [ ] Update README with graph capabilities

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC2"

echo ""
echo "Creating Phase 3 task issues..."

# Phase 3 Issues
gh issue create \
  --title "[Phase 3] Enhance extraction for function call relationships [M]" \
  --label "phase-3,graph,size-M" \
  --body "## Description

Extend relationship extraction to capture function call relationships.

## Acceptance Criteria
- [ ] Extract function calls from AST
- [ ] Link caller function to callee function
- [ ] Handle method calls on objects
- [ ] Include line number for each call
- [ ] Store CALLS relationships in Neo4j
- [ ] Unit tests for call extraction

## Reference
- [PRD Section 7: Data Model - CALLS relationship](docs/pm/knowledge-graph-PRD.md#72-relationship-types)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC2"

gh issue create \
  --title "[Phase 3] Implement get_architecture MCP tool [M]" \
  --label "phase-3,mcp-tools,graph,size-M,can-parallelize" \
  --body "## Description

Implement the get_architecture MCP tool for structural overview queries.

## Acceptance Criteria
- [ ] Create tool handler in \`src/mcp/tools/\`
- [ ] Support detail levels: packages, modules, files, entities
- [ ] Support scope filtering
- [ ] Return hierarchical structure
- [ ] Include inter-module dependencies
- [ ] Performance within 1000ms
- [ ] Unit and integration tests

## Reference
- [PRD Section 6.1: Tool 3 - get_architecture](docs/pm/knowledge-graph-PRD.md#tool-3-get_architecture)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC2"

gh issue create \
  --title "[Phase 3] Implement find_path MCP tool [M]" \
  --label "phase-3,mcp-tools,graph,size-M,can-parallelize" \
  --body "## Description

Implement the find_path MCP tool for tracing paths between entities.

## Acceptance Criteria
- [ ] Create tool handler in \`src/mcp/tools/\`
- [ ] Use Cypher shortestPath algorithm
- [ ] Support configurable max_hops (1-20)
- [ ] Support relationship type filtering
- [ ] Return path with all intermediate nodes
- [ ] Handle no path found gracefully
- [ ] Performance within 500ms
- [ ] Unit and integration tests

## Reference
- [PRD Section 6.1: Tool 4 - find_path](docs/pm/knowledge-graph-PRD.md#tool-4-find_path)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC2"

gh issue create \
  --title "[Phase 3] Comprehensive testing with complex repositories [M]" \
  --label "phase-3,testing,size-M" \
  --body "## Description

Test all graph features with realistic, complex repositories.

## Acceptance Criteria
- [ ] Test with PersonalKnowledgeMCP repository itself
- [ ] Test with medium-sized TypeScript project
- [ ] Verify dependency queries are accurate
- [ ] Verify architecture queries provide useful information
- [ ] Performance testing against targets
- [ ] Document any edge cases or limitations

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC2"

echo ""
echo "Creating Phase 4 task issues..."

# Phase 4 Issues
gh issue create \
  --title "[Phase 4] Define updated EmbeddingProvider interface [S]" \
  --label "phase-4,embeddings,size-S,can-parallelize" \
  --body "## Description

Update the EmbeddingProvider interface to support multiple provider types.

## Acceptance Criteria
- [ ] Add providerId, modelId, dimensions properties
- [ ] Add healthCheck() and getCapabilities() methods
- [ ] Define ProviderCapabilities type
- [ ] No breaking changes to existing code

## Reference
- [ADR-0003: Provider Interface Consistency](docs/architecture/adr/0003-local-embeddings-architecture.md#provider-interface-consistency)

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC3"

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

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC3"

gh issue create \
  --title "[Phase 4] Implement TransformersJsEmbeddingProvider [M]" \
  --label "phase-4,embeddings,size-M" \
  --body "## Description

Implement the local embedding provider using Transformers.js.

## Acceptance Criteria
- [ ] Add \`@xenova/transformers\` dependency
- [ ] Create \`src/providers/TransformersJsEmbeddingProvider.ts\`
- [ ] Implement lazy model loading
- [ ] Implement generateEmbedding and generateEmbeddings
- [ ] Handle model download with progress reporting
- [ ] Verify Bun compatibility
- [ ] Unit and integration tests

## Reference
- [ADR-0003: TransformersJsEmbeddingProvider](docs/architecture/adr/0003-local-embeddings-architecture.md#transformersjsembeddingprovider)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC3"

gh issue create \
  --title "[Phase 4] Implement OllamaEmbeddingProvider [M]" \
  --label "phase-4,embeddings,size-M,can-parallelize" \
  --body "## Description

Implement the local embedding provider using Ollama API.

## Acceptance Criteria
- [ ] Create \`src/providers/OllamaEmbeddingProvider.ts\`
- [ ] Implement REST API calls to Ollama
- [ ] Support configurable base URL and keep_alive
- [ ] Implement health check
- [ ] Handle connection errors gracefully
- [ ] Unit and integration tests

## Reference
- [ADR-0003: OllamaEmbeddingProvider](docs/architecture/adr/0003-local-embeddings-architecture.md#ollamaembeddingprovider)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC3"

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
- [ ] Validate configuration on creation
- [ ] Provide helpful error messages
- [ ] Unit tests

## Reference
- [ADR-0003: Updated Factory Pattern](docs/architecture/adr/0003-local-embeddings-architecture.md#updated-factory-pattern)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC3"

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
- [ ] Handle download failures gracefully

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC3"

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

## Reference
- [ADR-0003: CLI Provider Selection](docs/architecture/adr/0003-local-embeddings-architecture.md#cli-provider-selection)

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC3"

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

## Reference
- [PRD Section 11.5: CLI Integration](docs/pm/knowledge-graph-PRD.md#115-cli-integration)

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC3"

gh issue create \
  --title "[Phase 4] Update search service for provider-aware query embedding [M]" \
  --label "phase-4,embeddings,size-M" \
  --body "## Description

Update search service to use the correct provider for query embedding.

## Acceptance Criteria
- [ ] Store embedding provider in collection metadata
- [ ] On search, determine which provider(s) are needed
- [ ] Embed query with appropriate provider(s)
- [ ] Handle multi-provider searches
- [ ] Warn if querying with different provider
- [ ] Validate dimension compatibility

## Reference
- [PRD Section 11.6: Query-Time Considerations](docs/pm/knowledge-graph-PRD.md#116-query-time-considerations)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC3"

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
- [ ] Test coverage >90%

## Reference
- [PRD Section 9.5: Local Embeddings Success Criteria](docs/pm/knowledge-graph-PRD.md#95-local-embeddings-success-criteria)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC3"

gh issue create \
  --title "[Phase 4] Document provider selection and trade-offs [S]" \
  --label "phase-4,embeddings,documentation,size-S" \
  --body "## Description

Create comprehensive documentation for embedding provider selection.

## Acceptance Criteria
- [ ] Document each provider
- [ ] Document quality/speed/cost trade-offs
- [ ] Document model options and dimensions
- [ ] Document per-repository configuration
- [ ] Document offline usage
- [ ] Add troubleshooting guide
- [ ] Update README

## Reference
- [ADR-0003: Appendix A - Model Quality Comparison](docs/architecture/adr/0003-local-embeddings-architecture.md#appendix-a-model-quality-comparison)

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC3"

echo ""
echo "Creating Phase 5 task issues..."

# Phase 5 Issues
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
- [ ] Handle failures gracefully
- [ ] Integration tests

## Reference
- [PRD Section 8.2: Incremental Update Strategy](docs/pm/knowledge-graph-PRD.md#82-incremental-update-strategy)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC4"

gh issue create \
  --title "[Phase 5] Create pk-mcp graph populate-all command [S]" \
  --label "phase-5,graph,size-S" \
  --body "## Description

Create CLI command to populate graph for all indexed repositories.

## Acceptance Criteria
- [ ] Add \`graph populate-all\` subcommand
- [ ] Iterate through all indexed repositories
- [ ] Show progress and status
- [ ] Handle failures per-repository
- [ ] Summary report on completion

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC4"

gh issue create \
  --title "[Phase 5] Update backup scripts to include Neo4j [S]" \
  --label "phase-5,infrastructure,size-S" \
  --body "## Description

Update backup and restore scripts to include Neo4j data.

## Acceptance Criteria
- [ ] Document Neo4j backup procedure
- [ ] Create backup script for Neo4j data volume
- [ ] Create restore script
- [ ] Test backup and restore cycle
- [ ] Document recovery procedures

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC4"

gh issue create \
  --title "[Phase 5] Add graph query timing to metrics [S]" \
  --label "phase-5,graph,infrastructure,size-S" \
  --body "## Description

Add performance metrics for graph queries.

## Acceptance Criteria
- [ ] Log query execution time for all graph queries
- [ ] Track query types and depth
- [ ] Track result count
- [ ] Add to existing metrics system

## Estimate: Small (S) - 1 day or less
## Parent Epic: $EPIC4"

gh issue create \
  --title "[Phase 5] Performance testing at scale (10K+ files) [M]" \
  --label "phase-5,testing,size-M" \
  --body "## Description

Comprehensive performance testing with large repositories.

## Acceptance Criteria
- [ ] Test with repository containing 10K+ files
- [ ] Measure graph population time
- [ ] Measure query performance at scale
- [ ] Document performance characteristics
- [ ] Identify and address bottlenecks
- [ ] Create performance tuning guide

## Reference
- [PRD Section 4.3: Performance Requirements](docs/pm/knowledge-graph-PRD.md#43-performance-requirements)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC4"

gh issue create \
  --title "[Phase 5] Optional: Implement LocalONNXProvider for better performance [M]" \
  --label "phase-5,embeddings,size-M" \
  --body "## Description

(Optional) Implement ONNX Runtime-based provider for improved performance.

## Decision Criteria
Only implement if:
- ONNX Runtime provides >30% performance improvement
- Bun compatibility is confirmed
- GPU acceleration works on Windows

## Acceptance Criteria
- [ ] Evaluate ONNX Runtime performance vs Transformers.js
- [ ] If significant improvement, implement provider
- [ ] Support GPU acceleration if available
- [ ] Performance benchmarks

## Reference
- [ADR-0003: Option 4 - ONNX Runtime](docs/architecture/adr/0003-local-embeddings-architecture.md#option-4-onnx-runtime-nodejs-direct-bindings)

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC4"

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

## Estimate: Medium (M) - 2-3 days
## Parent Epic: $EPIC4"

echo ""
echo "========================================"
echo "All issues created successfully!"
echo "========================================"
echo ""
echo "Epics created:"
echo "  - $EPIC1"
echo "  - $EPIC2"
echo "  - $EPIC3"
echo "  - $EPIC4"
echo ""
echo "Summary:"
echo "  Phase 1: 10 issues (Knowledge Graph Foundation)"
echo "  Phase 2: 4 issues (Core MCP Tools)"
echo "  Phase 3: 4 issues (Advanced Tools)"
echo "  Phase 4: 11 issues (Local Embeddings)"
echo "  Phase 5: 7 issues (Integration & Polish)"
echo "  Epics: 4 issues"
echo "  Total: 40 issues"
echo ""
echo "Next steps:"
echo "  1. Review created issues at https://github.com/sethb75/PersonalKnowledgeMCP/issues"
echo "  2. Set up GitHub Project board for tracking"
echo "  3. Assign team members to issues"
echo "  4. Begin Phase 1 implementation"
