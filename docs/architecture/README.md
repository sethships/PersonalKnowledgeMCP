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
    ├── qdrant-integration.md
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
FastAPI-based service implementing the MCP protocol specification.

### Storage Layer
- **Vector DB (Qdrant)**: Semantic search and similarity
- **Graph DB (Neo4j)**: Relationships and dependencies
- **Document Store (PostgreSQL)**: Artifacts and full documents

### Ingestion Layer
- Repository cloners (GitHub, Azure DevOps)
- File analyzers and parsers
- Metadata extractors

### Retrieval Layer
- Semantic search engines
- Graph traversal logic
- Context assembly for RAG

## Documentation Status

- [ ] System Design Document (Phase 1)
- [ ] ADR 0001: MCP Protocol Design
- [ ] ADR 0002: Storage Backend Selection
- [ ] ADR 0003: Multi-Instance Architecture
- [ ] Data flow diagrams
- [ ] Deployment architecture diagrams

Documentation will be added as architectural decisions are made during implementation.
