# Architecture Documentation

This directory contains architectural documentation for the Personal Knowledge MCP project.

## Contents

- **System Design Documents (SDDs)**: Detailed technical architecture designs
- **Architecture Decision Records (ADRs)**: Record of significant architectural decisions
- **Diagrams**: Visual representations of system architecture
- **Integration Guides**: How different components interact

## Structure

```
architecture/
├── README.md (this file)
├── adr/                          # Architecture Decision Records
│   ├── 0001-mcp-protocol-design.md
│   ├── 0002-storage-backend-selection.md
│   └── ...
├── diagrams/                     # Architecture diagrams
│   ├── system-overview.md
│   ├── data-flow.md
│   └── deployment-architecture.md
└── integration/                  # Integration documentation
    ├── chromadb-integration.md
    ├── neo4j-integration.md
    └── github-integration.md
```

## Architecture Decision Records (ADRs)

ADRs document significant architectural decisions, including:

- Context: What forces are at play
- Decision: What was decided
- Status: Proposed, Accepted, Deprecated, Superseded
- Consequences: What becomes easier or harder

### ADR Template

See `adr/0000-template.md` for the standard ADR format.

## Key Architecture Principles

1. **MCP-Native**: Model Context Protocol as first-class interface
2. **Container-First**: All components containerizable
3. **Local-First with Cloud Flexibility**: Default local, support cloud migration
4. **Multi-Instance by Design**: Isolated instances for security tiers
5. **Polyglot Storage**: Multiple storage backends working in concert
6. **Pipeline-Driven**: Knowledge updates via automated pipelines

## Component Overview

### MCP Service Layer
Bun/TypeScript-based service implementing the MCP protocol specification with stdio and HTTP/SSE transports.

### Storage Layer
- **Vector DB (ChromaDB)**: Semantic search and similarity
- **Graph DB (Neo4j)**: Code relationships and dependencies (Phase 5 Complete)
- **Document Store (PostgreSQL)**: Artifacts and full documents (Framework Ready)

### Ingestion Layer
- Repository cloners (GitHub, Azure DevOps)
- File analyzers and parsers
- Metadata extractors

### Retrieval Layer
- Semantic search engines
- Graph traversal logic
- Context assembly for RAG

## Documentation Status

- [x] System Design Document (Phase 1) - [Phase1-System-Design-Document.md](Phase1-System-Design-Document.md)
- [x] Incremental Updates Plan - [incremental-updates-plan.md](incremental-updates-plan.md)
- [x] Docker Containerization PRD - [Docker-Containerization-PRD.md](../pm/Docker-Containerization-PRD.md)
- [x] ADR 0001: Incremental Update Trigger Strategy - [adr/0001-incremental-update-trigger-strategy.md](adr/0001-incremental-update-trigger-strategy.md)
- [x] ADR 0002: Knowledge Graph Architecture - [adr/0002-knowledge-graph-architecture.md](adr/0002-knowledge-graph-architecture.md)
- [x] ADR 0003: Local Embeddings Architecture - [adr/0003-local-embeddings-architecture.md](adr/0003-local-embeddings-architecture.md)
- [ ] Data flow diagrams
- [ ] Deployment architecture diagrams

## Related Product Documentation

- **[Docker Containerization PRD](../pm/Docker-Containerization-PRD.md)** - Containerization strategy, multi-transport MCP, and security architecture for Phases 3-4
- **[Knowledge Graph PRD](../pm/knowledge-graph-PRD.md)** - Neo4j integration and graph tools for Phase 5
- **[Phase 6 Document Ingestion PRD](../pm/Phase6-Document-Ingestion-PRD.md)** - Unstructured document support (planned)
