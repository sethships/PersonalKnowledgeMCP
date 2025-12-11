# [EPIC] Phase 1: Core MCP + Vector Search

## Description

This epic tracks all work required to complete Phase 1 of the Personal Knowledge MCP system. Phase 1 establishes the foundational infrastructure: an MCP service that enables Claude Code to perform semantic searches across indexed GitHub repositories.

**Goal:** Get Claude Code querying indexed code semantically.

**Success Metric:** Claude Code can perform semantic search across one fully indexed repository with query response times under 500ms (95th percentile).

**Timeline:** 2-3 weeks (with 1-week risk buffer)

## Phase 1 Scope

### Must Have (P0)
- [ ] MCP service starts and responds to Claude Code queries
- [ ] At least one private repository successfully indexed (via PAT)
- [ ] Semantic search returns relevant results for natural language queries
- [ ] Query response time < 500ms for 95th percentile
- [ ] Docker Compose deployment works on Windows with Docker Desktop
- [ ] Basic CLI commands functional (index, search, status, remove)
- [ ] Private repository indexing via GitHub PAT
- [ ] 90% test coverage

### Should Have (P1)
- [ ] Health check endpoint operational
- [ ] Structured JSON logging implemented
- [ ] Documentation for setup and usage
- [ ] Multiple repositories indexed simultaneously

### Nice to Have
- [ ] Performance metrics exposed
- [ ] Configurable chunking strategies
- [ ] Public repository support

## Implementation Timeline

### Week 1: Foundation (Issues #1-5)
- Project setup and tooling
- Docker Compose with ChromaDB
- ChromaDB storage client
- Embedding provider interface + OpenAI implementation
- Repository metadata store

### Week 2: Core Features (Issues #6-12)
- Repository cloner
- File scanner
- File chunker
- Ingestion service
- Search service
- MCP server implementation
- MCP tool handlers

### Week 3: Integration (Issues #13-17)
- CLI commands
- Claude Code integration
- Testing and quality
- Documentation
- Performance validation

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | Node.js 20+ with TypeScript |
| Vector DB | ChromaDB |
| Embeddings | OpenAI text-embedding-3-small |
| MCP SDK | @modelcontextprotocol/sdk |
| Testing | Jest with ts-jest |
| Deployment | Docker Compose |

## Reference Documents

- **PRD:** `docs/Phase1-Core-MCP-Vector-Search-PRD.md`
- **SDD:** `docs/architecture/Phase1-System-Design-Document.md`
- **Review Summary:** `pm/phase1-review-summary.md`

## Labels

phase-1, P0, epic

---

**Related Issues:**
- All Phase 1 issues should reference this epic
