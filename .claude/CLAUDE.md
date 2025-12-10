# Claude Code Project Configuration

This file contains project-specific instructions for Claude Code when working on the Personal Knowledge MCP project.

## Project Context

This is a personal RAG (Retrieval-Augmented Generation) knowledgebase system built on the Model Context Protocol (MCP). The project enables Claude Code and other AI assistants to efficiently access, retrieve, and utilize knowledge from software development projects and educational materials.

**Primary Use Cases:**
1. **Software Project Knowledge Management**: Managing knowledge for multiple active coding projects with intelligent semantic indexing of code, documentation, ADRs, and reference materials
2. **Educational Material Organization**: Semantic search and cross-referencing of structured college notes and educational content

**Technology Stack:**
- **Language**: Python (primary for MCP service implementation)
- **Framework**: FastAPI for core service
- **MCP SDK**: Official Anthropic MCP Python SDK
- **Containers**: Docker for containerization
- **Orchestration**: Kubernetes for production deployment, Docker Compose for MVP
- **Storage Backends**:
  - Vector DB (Qdrant) for semantic search
  - Graph DB (Neo4j Community) for relationships
  - Document Store (PostgreSQL with JSON) for artifacts
- **Platform**: Cross-platform with Windows development environment (PowerShell 7)

## Development Guidelines

### Branch and PR Strategy
- **MANDATORY**: Always work in feature branches (feature/, fix/, docs/, refactor/)
- Never commit directly to main branch
- Create PRs for all changes, no matter how small
- Follow conventional commit messages format
- Keep PRs focused and relatively small (target <400 lines of changes)

### Architecture Principles
- **MCP-Native**: Model Context Protocol as first-class interface, not an afterthought
- **Container-First**: All components must be containerizable
- **Local-First with Cloud Flexibility**: Default to local deployment, support cloud migration path
- **Multi-Instance by Design**: Support isolated instances for different security tiers (Private, Work, Public)
- **Polyglot Storage**: Multiple storage backends working in concert
- **Pipeline-Driven**: Knowledge updates via automated pipelines

### Code Organization
- Keep MCP server implementations modular and testable
- Strict separation of concerns:
  - Storage adapters (vector, graph, document)
  - Retrieval logic (semantic search, graph traversal, context assembly)
  - API layers (MCP interface, admin endpoints)
  - Ingestion pipelines (repository cloners, file analyzers, metadata extractors)
- Document architectural decisions in `docs/architecture/` as ADRs
- Use type hints throughout Python codebase (strict typing preferred)

### Storage Backend Guidelines
- Each storage backend must have a clean adapter interface
- Support intelligent routing based on query type:
  - Vector DB: Semantic search, document similarity
  - Graph DB: Code dependencies, knowledge relationships
  - Document Store: Raw artifacts, documentation, binary blobs
- All storage operations must be async where possible
- Implement connection pooling and proper resource cleanup

### Documentation Standards
- Maintain the PRD in `docs/High-level-Personal-Knowledge-MCP-PRD.md`
- Update README.md as features are implemented
- Create ADRs (Architecture Decision Records) in `docs/architecture/adr/` for:
  - Storage technology selections
  - MCP interface design decisions
  - Security architecture choices
  - Deployment strategy changes
- Document all MCP tools/functions with clear examples
- Include code-level docstrings for all public APIs

### Testing Requirements
- **Minimum 90% test coverage** (per global standards)
- Write tests for all MCP server endpoints
- Include integration tests for storage adapters
- Test multi-instance isolation thoroughly
- Performance tests for query latency targets (<500ms p95)
- Test containerized deployments locally before pushing
- Run full test suite before declaring any task complete

### Performance Targets (MVP)
- MCP query response: <500ms for 95th percentile
- Semantic search: <200ms for vector similarity lookup
- Graph traversal: <100ms for relationship queries
- Small repository (<1K files): <5 minutes to full indexing
- Medium repository (1K-10K files): <30 minutes to full indexing
- Incremental updates: <1 minute for typical PR changes

### Security Requirements
- **Instance Isolation**: Separate deployments for Private, Work, Public knowledge tiers
- All secrets in .env files (NEVER in code or version control)
- Authentication required for MCP endpoints
- No direct internet exposure by default (VPN/Tailscale for remote access)
- Validate all external inputs (repository URLs, file paths)

### Development Workflow
1. Create feature branch from main
2. Implement feature with tests
3. Run full test suite locally
4. Create PR with descriptive title and detailed description
5. Ensure CI/CD checks pass
6. Get at least one reviewer approval
7. Merge to main
8. Automated deployment to test environment

## Phased Implementation Plan

### Phase 1: Core MCP + Vector Search (Current Phase)
**Goal**: Get Claude Code querying indexed code semantically
- Basic MCP service implementation (read-only queries)
- Single vector database (Qdrant)
- GitHub repository cloner and basic file ingestion
- Simple code text extraction
- OpenAI embeddings API integration

### Phase 2: Code Intelligence + Local Files
**Goal**: Add code-aware indexing and educational material support
- AST parsing with tree-sitter (functions, classes, imports)
- Document store (PostgreSQL) for full file artifacts
- Local folder ingestion with file watcher
- Markdown/PDF extraction for college notes

### Phase 3: Multi-Instance + Azure DevOps
**Goal**: Security model and work integration
- Multi-instance configuration and deployment templates
- Authentication layer (token-based initially)
- Azure DevOps repository integration
- Instance-specific routing in MCP service

### Phase 4: Graph Relationships + Automation
**Goal**: Deeper insights and operational automation
- Graph database (Neo4j) for relationships
- Code dependency extraction and graph population
- GitHub webhook handler (or polling alternative)
- Automated update pipelines

## Key Files and Directories

### Documentation
- `docs/High-level-Personal-Knowledge-MCP-PRD.md`: Product requirements and vision
- `docs/architecture/`: Architecture diagrams and technical designs
- `docs/architecture/adr/`: Architecture Decision Records
- `README.md`: Project overview and getting started guide

### Configuration
- `.gitignore`: Excludes secrets, data, and build artifacts
- `.env.example`: Template for environment variables
- `docker-compose.yml`: Local deployment configuration
- `kubernetes/`: K8s manifests for production deployment

### Source Code
- `src/`: Main source code directory
- `src/mcp_service/`: MCP server implementation
- `src/storage/`: Storage adapter implementations
- `src/ingestion/`: Repository and file ingestion pipelines
- `src/retrieval/`: Semantic search and retrieval logic
- `tests/`: Test suite (unit, integration, performance)

## Language and Framework Specifics

### Python Standards
- Use Python 3.11+ features
- Type hints required for all function signatures
- Async/await for I/O operations
- Follow PEP 8 style guide (enforced by Black formatter)
- Use dataclasses or Pydantic models for structured data
- Prefer composition over inheritance

### FastAPI Patterns
- Use dependency injection for database connections
- Implement proper error handling with custom exception handlers
- Use background tasks for long-running operations
- Expose OpenAPI documentation for admin endpoints
- Implement health check and readiness endpoints

### Docker Best Practices
- Multi-stage builds for smaller images
- Non-root user execution
- Proper signal handling for graceful shutdown
- Health checks in Dockerfile
- Pin all dependency versions

## Common Pitfalls to Avoid

1. **Over-Engineering**: This is MVP-focused. Don't add features not in current phase.
2. **Token Waste**: The whole point is efficient retrieval. Don't implement anything that defeats this.
3. **Security Shortcuts**: Multi-instance isolation is critical. Never compromise on this.
4. **Performance Regression**: Always benchmark against targets before declaring complete.
5. **Documentation Debt**: Write docs as you build, not after. Future you will thank present you.

## Project Status and Notes

- **Current Phase**: Initial setup and planning
- This project is in early stages - expect significant architecture evolution
- Prioritize demonstrable value over perfection (MVP mindset)
- Keep deployment simple initially; complexity can be added as needed
- Test early and often with real codebases (small, medium, large repositories)
