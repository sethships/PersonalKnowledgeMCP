# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

## [1.0.0] - 2026-01-18 (V1.0 Release: Phases 1-5 Complete)

V1.0 marks the completion of the core platform with comprehensive semantic search, knowledge graph analysis, multi-provider embeddings, and production-ready deployment infrastructure. All five phases are complete, with Phase 4 (Enterprise Features) providing framework support for OIDC integration.

### Added

#### Knowledge Graph (Phase 5)
- Neo4j Community Edition integration for code dependency analysis
- `get_dependencies` MCP tool - query what code depends on
- `get_dependents` MCP tool - impact analysis for refactoring
- `get_architecture` MCP tool - module structure visualization
- `find_path` MCP tool - trace code connections
- `get_graph_metrics` MCP tool - repository health statistics
- Graph schema migrations via CLI (`graph migrate`)
- Graph population via CLI (`graph populate`, `graph populate-all`)

#### AST Parsing (Phase 5)
- Tree-sitter integration for code-aware indexing
- Support for 12 languages via tree-sitter:
  - TypeScript (.ts, .mts, .cts), TSX (.tsx)
  - JavaScript (.js, .mjs, .cjs), JSX (.jsx)
  - Python (.py, .pyw, .pyi)
  - Java (.java)
  - Go (.go)
  - Rust (.rs)
  - C (.c, .h), C++ (.cpp, .cc, .cxx, .hpp, .hxx)
  - Ruby (.rb, .rake, .gemspec)
  - PHP (.php, .phtml, .php5, .php7, .inc)
- Roslyn integration for C# (.cs) parsing
- Entity extraction (functions, classes, interfaces, imports)
- Relationship extraction (imports, calls, extends, implements)

#### Multi-Provider Embeddings (Phase 2)
- Transformers.js provider for zero-config local embeddings
- Ollama provider for GPU-accelerated local embeddings
- Automatic provider detection and fallback
- CLI commands for provider management (`providers status`, `providers setup`)
- Model cache management (`models list`, `models status`, `models validate`, `models clear`)

#### HTTP/SSE Transport (Phase 3)
- Express 5.x HTTP server with SSE support
- Cross-client compatibility (Cursor, VS Code Continue)
- Streamable HTTP transport (MCP 2025-03-26 specification)
- Session management with configurable TTL
- Graceful shutdown handling

#### Bearer Token Authentication (Phase 3)
- Secure token generation and validation
- Scoped access control (read, write, admin)
- Multi-instance access control (private, work, public)
- Token lifecycle management via CLI
- Usage tracking and audit logging

#### Multi-Instance Architecture (Phase 3)
- Instance isolation (Private, Work, Public tiers)
- Docker Compose profiles for flexible deployment
- Per-instance ChromaDB and Neo4j configuration
- Configurable default instance routing

#### Security Features (Phase 3)
- Rate limiting with configurable per-minute/per-hour limits
- CORS support for browser clients
- Audit logging with file rotation
- Secure session management

#### Infrastructure
- Docker Compose hardening with health checks
- PostgreSQL configured for document store (Phase 4)
- OIDC framework ready (Microsoft Entra ID, Auth0, Okta)
- User mapping framework for claim-based access control

### Changed
- Semantic search now supports language filtering
- Improved error messages with actionable guidance
- Enhanced CLI output with progress indicators

### Documentation
- Comprehensive embedding provider guide
- Graph tools documentation
- Neo4j setup guide
- Client configuration guide for Cursor and VS Code
- Performance tuning guide
- Troubleshooting guide updates

---

## [0.1.0] - 2025-12-28 (Phase 1: Core MCP + Vector Search)

Phase 1 establishes the core foundation for semantic code search via the Model Context Protocol.

### Added

#### MCP Server
- MCP server implementation with stdio transport for Claude Code integration
- `semantic_search` tool for natural language code search across indexed repositories
- `list_indexed_repositories` tool for repository discovery
- `trigger_incremental_update` tool for updating repository indexes (admin)
- `get_update_status` tool for async update job tracking (admin)
- Rate limiting (5-minute cooldown per repository)
- Async job tracking with 1-hour retention

#### CLI Commands
- `index <url>` - Index a GitHub repository with semantic embeddings
- `search <query>` - Search indexed repositories with natural language
- `status` - List indexed repositories and their status
- `remove <name>` - Remove a repository from the index
- `update <repository>` - Incrementally update a repository after changes
- `update-all` - Update all indexed repositories
- `history <repository>` - View update history for a repository
- `reset-update <repository>` - Reset stuck update state
- `health` - Check service health (ChromaDB, OpenAI)
- `token create|list|revoke|rotate` - Manage authentication tokens

#### Storage & Embeddings
- ChromaDB integration for vector storage and similarity search
- OpenAI text-embedding-3-small for semantic embeddings (1536 dimensions)
- Configurable chunking strategy (512 tokens default, 64 token overlap)
- Metadata storage for repository state and update history

#### Incremental Updates
- GitHub Compare API integration for change detection
- Smart file change detection (added, modified, deleted)
- Chunk-level updates (upsert/delete)
- Update history tracking with full audit trail
- Recovery mechanisms for interrupted updates

#### Authentication Framework
- Token-based authentication with scopes (read, write, admin)
- Multi-instance access control (private, work, public)
- Token lifecycle management (create, revoke, rotate)
- Configurable expiration (hours, days, weeks, months, years, never)

#### Multi-Instance Support
- Configuration for multiple isolated instances
- Per-instance ChromaDB and data path settings
- Default instance configuration

#### Documentation
- Comprehensive README with quick start guide
- Claude Code integration guide
- CLI command reference
- Environment variable reference
- Troubleshooting guide
- Architecture documentation
- Phase 1 System Design Document

### Performance Targets Met
- MCP query response: <500ms (95th percentile)
- Semantic search: <200ms for vector similarity
- Small repository indexing (<1K files): <5 minutes
- Incremental updates: <1 minute for typical changes

### Dependencies
- Bun 1.0+ runtime
- Docker for ChromaDB containerization
- OpenAI API for embeddings
- GitHub PAT for private repository access (optional)

---

[Unreleased]: https://github.com/sethb75/PersonalKnowledgeMCP/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/sethb75/PersonalKnowledgeMCP/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/sethb75/PersonalKnowledgeMCP/releases/tag/v0.1.0
