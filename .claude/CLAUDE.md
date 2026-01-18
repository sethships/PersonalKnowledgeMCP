# Claude Code Project Configuration

This file contains project-specific instructions for Claude Code when working on the Personal Knowledge MCP project.

## Project Context

This is a personal RAG (Retrieval-Augmented Generation) knowledgebase system built on the Model Context Protocol (MCP). The project enables Claude Code and other AI assistants to efficiently access, retrieve, and utilize knowledge from software development projects and educational materials.

**Primary Use Cases:**
1. **Software Project Knowledge Management**: Managing knowledge for multiple active coding projects with intelligent semantic indexing of code, documentation, ADRs, and reference materials
2. **Educational Material Organization**: Semantic search and cross-referencing of structured college notes and educational content

**Technology Stack:**
- **Runtime**: Bun 1.0+ (fast all-in-one JavaScript runtime)
- **Language**: TypeScript 5.3+ (strict type safety)
- **MCP SDK**: Official Anthropic MCP SDK (@modelcontextprotocol/sdk)
- **AST Parsing**: tree-sitter (web-tree-sitter) for 12 languages, Roslyn for C#
- **Containers**: Docker for ChromaDB and Neo4j containerization
- **Storage Backends**:
  - Vector DB (ChromaDB) for semantic search
  - Graph DB (Neo4j Community) for code relationships and dependencies
  - Document Store (PostgreSQL with JSON) for artifacts (Phase 2+)
- **Embedding Providers**: OpenAI API, Transformers.js (local), Ollama (GPU)
- **Platform**: Cross-platform with Windows development environment (PowerShell 7, Bun)

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
- Use TypeScript strict mode with comprehensive type annotations

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
- **Minimum 90% test coverage** (per global standards, enforced in bunfig.toml)
- Use Bun's built-in test runner (`bun test`)
- Write tests for all MCP server endpoints
- Include integration tests for storage adapters
- Test multi-instance isolation thoroughly (Phase 3+)
- Performance tests for query latency targets (<500ms p95)
- Test ChromaDB integration with real containers
- Run full test suite before declaring any task complete (`bun test --coverage`)

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
2. Install dependencies: `bun install`
3. Implement feature with tests
4. Run full test suite locally: `bun test --coverage`
5. Build project: `bun run build`
6. Create PR with descriptive title and detailed description
7. Ensure CI/CD checks pass
8. Get at least one reviewer approval
9. Merge to main
10. Automated deployment to test environment

## Phased Implementation Plan

### Phase 1: Core MCP + Vector Search (Complete)
**Goal**: Get Claude Code querying indexed code semantically
- Basic MCP service implementation (stdio transport)
- Single vector database (ChromaDB)
- GitHub repository cloner and basic file ingestion
- File chunking and text extraction
- OpenAI embeddings API integration
- CLI commands for repository management

### Phase 2: Code Intelligence + Multi-Provider Embeddings (Current Phase)
**Goal**: Add code-aware indexing and local embedding options
- AST parsing with tree-sitter for 13 languages (TypeScript, TSX, JavaScript, JSX, Python, Java, Go, Rust, C#, C, C++, Ruby, PHP)
- Knowledge graph (Neo4j) with get_dependencies, get_dependents, get_architecture, find_path tools
- Multi-provider embeddings: OpenAI, Transformers.js (zero-config local), Ollama (GPU)
- Graph schema migrations CLI commands

### Phase 3: Multi-Instance + Containerization (Complete)
**Goal**: Security model and production deployment
- Multi-instance configuration and deployment templates
- HTTP/SSE transport alongside stdio for cross-client support
- Bearer token authentication with CLI management
- Rate limiting and CORS support
- Docker Compose hardening

### Phase 4: Enterprise Features + Automation
**Goal**: Enterprise integration and operational automation
- OpenID Connect (OIDC) - Microsoft Entra ID, Auth0, Okta integration
- User mapping with claim-based instance access control
- Azure DevOps repository integration
- Automated update pipelines and GitHub webhooks
- Kubernetes deployment with Helm charts

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
- `src/index.ts`: MCP server entry point
- `src/cli.ts`: CLI entry point
- `src/mcp/`: MCP server implementation and tool handlers
- `src/services/`: Business logic (search, ingestion, repository services)
- `src/providers/`: Embedding providers (OpenAI)
- `src/storage/`: Storage adapter implementations (ChromaDB client)
- `src/ingestion/`: Repository cloning, file scanning, chunking
- `src/config/`: Configuration loading
- `src/logging/`: Logging setup
- `src/types/`: Shared type definitions
- `tests/`: Test suite (unit, integration, e2e)

## Language and Framework Specifics

### TypeScript Standards
- Use strict mode with comprehensive type checking
- Explicit return types for all functions
- No `any` types - use proper typing or `unknown`
- Use interfaces for object shapes, types for unions/intersections
- Prefer `const` over `let`, avoid `var`
- Use async/await for asynchronous operations
- Follow functional programming patterns where appropriate

### Bun-Specific Patterns
- Use Bun's native APIs when available (file I/O, env, etc.)
- Leverage Bun's fast bundler for builds: `bun build`
- Use Bun's built-in test runner with coverage tracking
- Take advantage of Bun's speed for development (`bun --watch`)
- Use `bunfig.toml` for project-specific Bun configuration

### MCP SDK Usage
- Use stdio transport for Claude Code integration
- Implement proper error handling with MCP error codes
- Follow MCP tool definition schemas exactly
- Return structured JSON responses from tool handlers
- Test MCP integration with real Claude Code early

### Docker Best Practices
- ChromaDB runs in Docker (host MCP service for stdio)
- Use Docker Compose for local development
- Persist ChromaDB data with named volumes
- Health checks for all containerized services
- Pin all dependency and image versions

## Common Pitfalls to Avoid

1. **Over-Engineering**: This is MVP-focused. Don't add features not in current phase.
2. **Token Waste**: The whole point is efficient retrieval. Don't implement anything that defeats this.
3. **Security Shortcuts**: Multi-instance isolation is critical. Never compromise on this.
4. **Performance Regression**: Always benchmark against targets before declaring complete.
5. **Documentation Debt**: Write docs as you build, not after. Future you will thank present you.

## Project Status and Notes

- **Current Phase**: Phase 2 - Code Intelligence + Multi-Provider Embeddings (Phase 1 complete)
- Repository reorganized for Bun/TypeScript/ChromaDB (December 2024)
- Knowledge graph with Neo4j implemented and operational
- Multi-provider embedding support (OpenAI, Transformers.js, Ollama)
- Prioritize demonstrable value over perfection (MVP mindset)
- Keep deployment simple initially; complexity can be added as needed
- Test early and often with real codebases (small, medium, large repositories)

### Supported Languages for AST Parsing

The following languages are supported for graph population and semantic search filtering:
- **TypeScript Ecosystem**: TypeScript (.ts, .mts, .cts), TSX (.tsx), JavaScript (.js, .mjs, .cjs), JSX (.jsx)
- **Python**: Python (.py, .pyw, .pyi)
- **Java**: Java (.java)
- **Go**: Go (.go)
- **Rust**: Rust (.rs)
- **C#**: C# (.cs) - uses Roslyn instead of tree-sitter
- **C/C++**: C (.c, .h), C++ (.cpp, .cc, .cxx, .hpp, .hxx)
- **Ruby**: Ruby (.rb, .rake, .gemspec)
- **PHP**: PHP (.php, .phtml, .php5, .php7, .inc)

## Quick Reference

### Common Commands
```bash
# Development
bun install              # Install dependencies
bun run dev             # Run in watch mode
bun run build           # Build for production
bun test --coverage     # Run tests with coverage

# Docker
docker-compose up -d    # Start ChromaDB
docker-compose down     # Stop ChromaDB
docker-compose logs -f  # View logs

# CLI
bun run cli index <url>      # Index a repository
bun run cli search "query"   # Search indexed repos
bun run cli status           # List repositories
```

### Key Configuration Files
- `bunfig.toml`: Bun configuration
- `tsconfig.json`: TypeScript configuration
- `.env`: Environment variables (not committed)
- `config/default.json`: Application defaults
- `docker-compose.yml`: ChromaDB setup
