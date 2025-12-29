# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

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

[Unreleased]: https://github.com/sethb75/PersonalKnowledgeMCP/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sethb75/PersonalKnowledgeMCP/releases/tag/v0.1.0
