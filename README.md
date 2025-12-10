# Personal Knowledge MCP

An AI-first knowledge management service built on the Model Context Protocol (MCP) that enables Claude Code and other AI assistants to efficiently access, retrieve, and utilize knowledge from software development projects and educational materials.

[![Project Status](https://img.shields.io/badge/status-planning-blue)]() [![Python](https://img.shields.io/badge/python-3.11+-blue)]() [![License](https://img.shields.io/badge/license-TBD-lightgrey)]()

## Overview

Personal Knowledge MCP is a purpose-built MCP service that creates a semantic bridge between AI development workflows and diverse knowledge sources. Unlike traditional knowledge management systems retrofitted for AI access, this project is designed from the ground up for AI assistant integration.

### Key Features

- **MCP-Native Architecture**: Purpose-built for AI assistant integration via the Model Context Protocol
- **Multi-Instance Security Model**: Separate knowledge instances for different privacy/security levels (Private, Work, Public)
- **Software Project Focus**: Optimized for code repositories, documentation, and technical artifacts
- **Intelligent Storage Routing**: Automatic selection of optimal storage type (vector, graph, document) per knowledge domain
- **Local-First with Cloud Flexibility**: Home lab deployment with optional cloud scaling
- **Semantic Code Search**: AI assistants can find relevant code and documentation without full codebase scans

## Use Cases

### 1. Software Project Knowledge Management (Primary)

Manage knowledge for multiple active coding projects with intelligent semantic indexing:

- Index GitHub and Azure DevOps repositories
- Semantic search across code, documentation, ADRs, and reference materials
- Efficient context retrieval for AI assistants (reduces token waste)
- Multi-project context switching during development
- Scales from small microservices to large monolithic codebases

### 2. Educational Material Organization

Organize and semantically search structured educational content:

- Index college notes and educational materials from local folders
- Cross-reference concepts across different courses/domains
- Semantic search across hierarchical folder structures
- Support for Markdown, PDF, DOCX, and other document formats

## Technology Stack

### Core Service

- **Language**: Python 3.11+
- **Framework**: FastAPI with async/await
- **MCP SDK**: Official Anthropic MCP Python SDK
- **Deployment**: Docker containers, Kubernetes orchestration

### Storage Backends

- **Vector Database**: Qdrant (semantic search and similarity)
- **Graph Database**: Neo4j Community Edition (relationships and dependencies)
- **Document Store**: PostgreSQL with JSON (artifacts and full documents)

### Ingestion & Analysis

- **Code Parsing**: tree-sitter (AST generation for multiple languages)
- **Document Extraction**: pypdf, python-docx, markdown-it-py
- **Embeddings**: OpenAI API (with future Ollama support for local embeddings)

## Project Status

**Current Phase**: Initial setup and planning (Phase 1 preparation)

This project is in early stages. See the [Product Requirements Document](docs/High-level-Personal-Knowledge-MCP-PRD.md) for detailed vision, goals, and requirements.

### Roadmap

#### Phase 1: Core MCP + Vector Search (Current)

Get Claude Code querying indexed code semantically

- Basic MCP service implementation (read-only queries)
- Single vector database (Qdrant)
- GitHub repository cloner and basic file ingestion
- Simple code text extraction
- OpenAI embeddings API integration

#### Phase 2: Code Intelligence + Local Files

Add code-aware indexing and educational material support

- AST parsing with tree-sitter (functions, classes, imports)
- Document store (PostgreSQL) for full file artifacts
- Local folder ingestion with file watcher
- Markdown/PDF extraction for college notes

#### Phase 3: Multi-Instance + Azure DevOps

Security model and work integration

- Multi-instance configuration and deployment templates
- Authentication layer (token-based initially)
- Azure DevOps repository integration
- Instance-specific routing in MCP service

#### Phase 4: Graph Relationships + Automation

Deeper insights and operational automation

- Graph database (Neo4j) for relationships
- Code dependency extraction and graph population
- GitHub webhook handler (or polling alternative)
- Automated update pipelines

## Documentation

- [Product Requirements Document](docs/High-level-Personal-Knowledge-MCP-PRD.md) - High-level product vision, goals, and requirements
- [Project Configuration](.claude/CLAUDE.md) - Development guidelines for Claude Code
- Architecture Documentation - *(Coming in Phase 1)*
- Architecture Decision Records (ADRs) - *(Coming as decisions are made)*

## Architecture

The system follows a modular, microservices-oriented architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Service Layer                     │
│            (FastAPI + Anthropic MCP SDK)                │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐ ┌──────▼──────┐ ┌────────▼────────┐
│ Vector DB      │ │  Graph DB   │ │  Document Store │
│   (Qdrant)     │ │   (Neo4j)   │ │  (PostgreSQL)   │
└────────────────┘ └─────────────┘ └─────────────────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐ ┌──────▼──────┐ ┌────────▼────────┐
│ Code Ingestion │ │  File Watch │ │  Repo Cloner    │
│   Pipelines    │ │   Service   │ │   (Git/Azure)   │
└────────────────┘ └─────────────┘ └─────────────────┘
```

Detailed architecture documentation will be added as the system evolves.

## Getting Started

*(Coming in Phase 1)*

The initial setup will include:

1. Deploy pre-built containers using Docker Compose
2. Configure storage backends (vector, graph, document)
3. Create knowledge instances for different security tiers
4. Connect GitHub/Azure DevOps repositories
5. Configure Claude Code to use the MCP service

Target: <30 minutes from download to functional MCP service

## Development

### Prerequisites

- **Python**: 3.11 or later
- **Docker**: For containerized deployments
- **Kubernetes**: Local cluster (minikube/kind) or cloud provider (optional, post-MVP)
- **PowerShell**: 7+ (Windows development environment)
- **Git**: For repository management

### Development Setup

*(Coming in Phase 1)*

Will include instructions for:

- Setting up Python virtual environment
- Installing dependencies
- Configuring local storage backends
- Running tests
- Building Docker containers

### Testing

The project maintains 90% test coverage minimum with:

- Unit tests for all components
- Integration tests for storage adapters
- MCP endpoint tests
- Performance tests for query latency targets (<500ms p95)

### Contributing

This is currently a personal project. The repository may be opened for contributions in the future.

Guidelines for contributions (when opened):

- Follow the development workflow in [.claude/CLAUDE.md](.claude/CLAUDE.md)
- Always work in feature branches
- Create PRs for all changes
- Ensure tests pass and coverage remains above 90%
- Follow conventional commit message format

## Performance Targets

### Query Performance (MVP)

- MCP query response: <500ms (95th percentile)
- Semantic search: <200ms for vector similarity lookup
- Graph traversal: <100ms for relationship queries
- Context assembly: <300ms for complete RAG response

### Ingestion Performance (MVP)

- Small repository (<1K files): <5 minutes to full indexing
- Medium repository (1K-10K files): <30 minutes to full indexing
- Large repository (10K-100K files): <4 hours to full indexing
- Incremental updates: <1 minute for typical PR changes

## Security

- **Multi-Instance Isolation**: Separate deployments for different security/privacy tiers
- **No Internet Exposure**: Default to local deployment; remote access via VPN/Tailscale
- **Secret Management**: All secrets in .env files, never in version control
- **Authentication Required**: MCP endpoints require authentication
- **Input Validation**: All external inputs (repository URLs, file paths) validated

## License

*(To be determined)*

## Acknowledgments

Built using:

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Qdrant](https://qdrant.tech/) vector database
- [Neo4j](https://neo4j.com/) graph database
- [FastAPI](https://fastapi.tiangolo.com/) Python framework
- [tree-sitter](https://tree-sitter.github.io/) code parsing library
