# [Documentation] Phase 1 Documentation and README

## Description

Create comprehensive documentation for Phase 1 including setup instructions, usage guide, configuration reference, and troubleshooting guide.

## Requirements

From PRD Success Criteria and project standards:
- README with setup and usage instructions
- Configuration reference
- Claude Code integration guide
- Troubleshooting guide
- API/tool documentation

## Acceptance Criteria

### README.md Updates
- [ ] Project overview and purpose
- [ ] Prerequisites section:
  - [ ] Node.js 20+
  - [ ] Docker Desktop
  - [ ] OpenAI API key
  - [ ] GitHub PAT (for private repos)
- [ ] Quick start guide:
  - [ ] Clone repository
  - [ ] Install dependencies
  - [ ] Configure environment
  - [ ] Start ChromaDB
  - [ ] Build project
  - [ ] Index first repository
- [ ] CLI command reference
- [ ] Environment variable reference
- [ ] Claude Code configuration

### docs/setup-guide.md
- [ ] Detailed prerequisites
- [ ] Step-by-step installation
- [ ] Environment configuration
- [ ] Docker setup
- [ ] Verification steps

### docs/usage-guide.md
- [ ] Indexing repositories
- [ ] Searching indexed code
- [ ] Managing repositories
- [ ] Using with Claude Code
- [ ] Examples and use cases

### docs/configuration.md
- [ ] All environment variables
- [ ] Default values
- [ ] Configuration file options
- [ ] Chunking configuration
- [ ] Performance tuning

### docs/troubleshooting.md
- [ ] Common issues and solutions
- [ ] ChromaDB connection problems
- [ ] OpenAI API errors
- [ ] MCP integration issues
- [ ] Performance problems
- [ ] Debug logging

### docs/claude-code-integration.md
- [ ] MCP configuration format
- [ ] Windows-specific setup
- [ ] Available tools documentation
- [ ] Example queries
- [ ] Tips for effective use

## Technical Notes

### README Structure

```markdown
# Personal Knowledge MCP

Semantic code search for Claude Code via Model Context Protocol.

## Features
- Semantic search across indexed repositories
- Natural language code discovery
- Claude Code integration via MCP

## Prerequisites
- Node.js 20+
- Docker Desktop
- OpenAI API key
- GitHub PAT (for private repositories)

## Quick Start

1. Clone and install
2. Configure environment
3. Start ChromaDB
4. Build project
5. Index a repository
6. Configure Claude Code

## CLI Commands
...

## Configuration
...

## Claude Code Integration
...

## Documentation
- [Setup Guide](docs/setup-guide.md)
- [Usage Guide](docs/usage-guide.md)
- [Configuration Reference](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)

## License
MIT
```

### Environment Variables Table

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| OPENAI_API_KEY | Yes | - | OpenAI API key |
| GITHUB_PAT | No* | - | GitHub PAT for private repos |
| CHROMADB_HOST | No | localhost | ChromaDB host |
| CHROMADB_PORT | No | 8000 | ChromaDB port |
| LOG_LEVEL | No | info | Logging level |
| ... | | | |

### Claude Code Config Example

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "node",
      "args": ["C:/path/to/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "CHROMADB_HOST": "localhost"
      }
    }
  }
}
```

### Troubleshooting Common Issues

**ChromaDB won't start:**
- Check Docker Desktop is running
- Verify port 8000 is available
- Check Docker logs

**Search returns no results:**
- Verify repository is indexed
- Lower similarity threshold
- Check ChromaDB health

**MCP tools not appearing:**
- Verify config path
- Check command path
- Review startup logs

## Testing Requirements

- [ ] All code examples tested
- [ ] Quick start guide followed on clean system
- [ ] All commands documented work
- [ ] Links valid

## Definition of Done

- [ ] README.md comprehensive
- [ ] All doc files created
- [ ] Examples tested
- [ ] Screenshots/diagrams where helpful
- [ ] No broken links
- [ ] Spellcheck passed

## Size Estimate

**Size:** M (Medium) - 4-6 hours

## Dependencies

- All features complete
- #14 Claude Code Integration (for integration docs)

## Blocks

- Phase 1 completion

## Labels

phase-1, P1, documentation
