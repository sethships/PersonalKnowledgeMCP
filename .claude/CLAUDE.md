# Claude Code Project Configuration

This file contains project-specific instructions for Claude Code when working on the Personal Knowledge MCP project.

## Project Context

This is a personal RAG (Retrieval-Augmented Generation) knowledgebase system built on the Model Context Protocol (MCP). The project uses:

- **Containers**: Docker for containerization
- **Orchestration**: Kubernetes for deployment
- **Architecture**: Microservices with multiple storage backends
- **Platform**: Cross-platform with Windows development environment

## Development Guidelines

### Branch and PR Strategy
- Always work in feature branches
- Create PRs for all changes
- Follow conventional commit messages

### Technology Stack
- Container platform: Docker
- Orchestration: Kubernetes
- Development environment: Windows with PowerShell 7

### Code Organization
- Keep MCP server implementations modular
- Separate concerns between storage adapters, retrieval logic, and API layers
- Document architectural decisions in `docs/architecture/`

### Documentation
- Maintain the PRD in `docs/High-level-Personal-Knowledge-MCP-PRD.md`
- Update README.md as features are implemented
- Add ADRs (Architecture Decision Records) for significant technical choices

### Testing
- Write tests for all MCP server endpoints
- Include integration tests for storage adapters
- Test containerized deployments locally before pushing

## Key Files

- `docs/High-level-Personal-Knowledge-MCP-PRD.md`: Product requirements and vision
- `README.md`: Project overview and getting started guide
- `.gitignore`: Excludes secrets, data, and build artifacts

## Notes

- This project is in early stages - expect significant architecture evolution
- Prioritize user experience and maintainability over premature optimization
- Keep deployment simple initially; complexity can be added as needed
