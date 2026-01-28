# Claude Code Setup Guide

This guide walks you through configuring Personal Knowledge MCP for use with Claude Code.

## Prerequisites

Before setting up Claude Code integration, ensure you have:

1. **Bun 1.0+** installed ([install guide](https://bun.sh))
2. **Docker Desktop** running (for ChromaDB)
3. **OpenAI API Key** with access to embeddings API
4. **GitHub Personal Access Token** (optional, for private repositories)
5. **Personal Knowledge MCP** cloned and built

## Quick Start

### 1. Build the MCP Server

From the PersonalKnowledgeMCP project directory:

```bash
# Install dependencies
bun install

# Build the MCP server
bun run build

# Verify build output exists
ls dist/index.js
```

The build creates `dist/index.js`, which is the MCP server entry point that Claude Code will invoke.

### 2. Start ChromaDB

```bash
# Start ChromaDB container
docker-compose up -d

# Verify ChromaDB is running
curl http://localhost:8000/api/v1/heartbeat

# Expected response: {"nanosecond heartbeat": <timestamp>}
```

### 3. Set Environment Variables

Create or update your `.env` file in the project root with required variables:

```bash
# Required: OpenAI API key for embeddings
OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE

# Optional: GitHub PAT for private repositories
GITHUB_PAT=ghp_YOUR_TOKEN_HERE

# ChromaDB connection (defaults shown)
CHROMADB_HOST=localhost
CHROMADB_PORT=8000

# Data storage path
DATA_PATH=./data

# Logging configuration
LOG_LEVEL=info
LOG_FORMAT=pretty
```

**Security Note**: Never commit `.env` files to version control. Use `.env.example` as a template.

### 4. Configure Claude Code

Claude Code supports two configuration locations for MCP servers. Choose based on your use case:

#### Configuration Options

| Option | Location | Best For |
|--------|----------|----------|
| **Project-level** | `.claude/mcp.json` in project root | Portable, project-specific setup; version control friendly |
| **User-level** | Platform-specific path (see below) | Personal/global settings; shared across all projects |

**Project-level configuration** is recommended when:
- You want the MCP config checked into version control
- Multiple team members need the same MCP server setup
- Configuration is specific to a particular project

**User-level configuration** is better when:
- You have a central MCP server instance used across all projects
- Configuration contains paths or settings specific to your machine
- You don't want MCP config in your repository

#### Project-Level Configuration (Recommended)

Create `.claude/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "bun",
      "args": ["run", "C:/src/PersonalKnowledgeMCP/dist/index.js"],
      "cwd": "C:/src/PersonalKnowledgeMCP",
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GITHUB_PAT": "${GITHUB_PAT}",
        "CHROMADB_HOST": "localhost",
        "CHROMADB_PORT": "8000",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Important**: The `cwd` field is required for project-level configs to ensure correct path resolution for data directories.

#### User-Level Configuration

User-level MCP configuration file locations by platform:

| Platform | Configuration Path |
|----------|-------------------|
| **Windows** | `%APPDATA%\Claude Code\mcp.json` or `C:\Users\<username>\AppData\Roaming\Claude Code\mcp.json` |
| **macOS** | `~/Library/Application Support/Claude Code/mcp.json` |
| **Linux** | `~/.config/claude-code/mcp.json` |

#### Add Personal Knowledge MCP Configuration

Edit the MCP configuration file and add the `personal-knowledge` server:

**Windows Example**:
```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "bun",
      "args": ["run", "C:/src/PersonalKnowledgeMCP/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GITHUB_PAT": "${GITHUB_PAT}",
        "CHROMADB_HOST": "localhost",
        "CHROMADB_PORT": "8000",
        "DATA_PATH": "C:/src/PersonalKnowledgeMCP/data",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**macOS/Linux Example**:
```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "bun",
      "args": ["run", "/Users/username/PersonalKnowledgeMCP/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GITHUB_PAT": "${GITHUB_PAT}",
        "CHROMADB_HOST": "localhost",
        "CHROMADB_PORT": "8000",
        "DATA_PATH": "/Users/username/PersonalKnowledgeMCP/data",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Configuration Notes**:
- **Paths**: Use absolute paths for `args[1]` and `DATA_PATH`
- **Windows Paths**: Use forward slashes (`/`) or escaped backslashes (`\\`)
- **Environment Variables**: Use `${VAR_NAME}` syntax to reference system environment variables
- **Multiple Servers**: You can define multiple MCP servers in the same configuration file

#### Alternative: Using Node.js Instead of Bun

If you prefer to use Node.js instead of Bun for the MCP server:

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "node",
      "args": ["C:/src/PersonalKnowledgeMCP/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "GITHUB_PAT": "${GITHUB_PAT}",
        "CHROMADB_HOST": "localhost",
        "CHROMADB_PORT": "8000"
      }
    }
  }
}
```

**Note**: The build output (`dist/index.js`) is compatible with both Bun and Node.js runtimes.

### 5. Start Claude Code

Restart Claude Code to load the new MCP server configuration:

1. Close Claude Code completely (exit from system tray if applicable)
2. Start Claude Code
3. Wait for MCP servers to initialize (usually 2-5 seconds)

### 6. Verify Integration

Once Claude Code starts, verify the Personal Knowledge MCP tools are available:

1. In Claude Code, check for available tools
2. You should see two tools:
   - **`semantic_search`**: Search indexed repositories semantically
   - **`list_indexed_repositories`**: List all indexed repositories

Try a simple query to verify functionality:

```
Can you list my indexed repositories?
```

Claude Code should invoke `list_indexed_repositories` and show results (initially empty if no repositories indexed yet).

## Indexing Your First Repository

Before you can search, you need to index at least one repository:

```bash
# Index a repository (example: this project itself)
bun run cli index https://github.com/sethships/PersonalKnowledgeMCP

# Check indexing status
bun run cli status

# Expected output:
# Repository: PersonalKnowledgeMCP
# URL: https://github.com/sethships/PersonalKnowledgeMCP
# Status: ready
# Chunks: ~250-350 (varies)
# Last Indexed: 2025-12-12T...
```

Indexing time varies by repository size:
- Small (<1K files): ~5 minutes
- Medium (1K-10K files): ~30 minutes
- Large (>10K files): Consider indexing specific subdirectories

## Testing the Integration

### Test 1: List Indexed Repositories

In Claude Code, ask:

```
Show me my indexed repositories
```

Expected: Claude Code invokes `list_indexed_repositories` and displays repository metadata.

### Test 2: Semantic Search - Exact Match

In Claude Code, ask:

```
Find ChromaDBClient class implementation
```

Expected: Claude Code invokes `semantic_search` with query and returns `src/storage/chromadb-client.ts` with high relevance score.

### Test 3: Semantic Search - Conceptual Match

In Claude Code, ask:

```
Where is the vector database integration code?
```

Expected: Claude Code returns files related to ChromaDB storage layer, demonstrating semantic understanding.

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for embeddings | `sk-proj-abc123...` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_PAT` | GitHub Personal Access Token | (none) |
| `CHROMADB_HOST` | ChromaDB server hostname | `localhost` |
| `CHROMADB_PORT` | ChromaDB server port | `8000` |
| `DATA_PATH` | Local data storage directory | `./data` |
| `LOG_LEVEL` | Logging level | `info` |
| `LOG_FORMAT` | Log output format | `pretty` |
| `EMBEDDING_MODEL` | OpenAI embedding model | `text-embedding-3-small` |
| `EMBEDDING_DIMENSIONS` | Embedding vector dimensions | `1536` |
| `EMBEDDING_BATCH_SIZE` | Batch size for embedding generation | `100` |
| `EMBEDDING_MAX_RETRIES` | Max retries for embedding API | `3` |
| `EMBEDDING_TIMEOUT_MS` | Timeout for embedding requests | `30000` |

### Setting Environment Variables

**Windows (PowerShell)**:
```powershell
$env:OPENAI_API_KEY = "sk-proj-YOUR_KEY_HERE"
$env:GITHUB_PAT = "ghp_YOUR_TOKEN_HERE"
```

**Windows (Command Prompt)**:
```cmd
set OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE
set GITHUB_PAT=ghp_YOUR_TOKEN_HERE
```

**macOS/Linux (Bash/Zsh)**:
```bash
export OPENAI_API_KEY="sk-proj-YOUR_KEY_HERE"
export GITHUB_PAT="ghp_YOUR_TOKEN_HERE"
```

**Persistent Configuration** (recommended):
Add environment variables to your shell profile (`.bashrc`, `.zshrc`, or PowerShell profile) or use a `.env` file in the project directory.

## Startup Sequence

Understanding the startup sequence helps with troubleshooting:

1. **User starts Claude Code**
2. **Claude Code reads MCP configuration** (`mcp.json`)
3. **Claude Code spawns MCP server process**:
   - Runs command: `bun run <path>/dist/index.js`
   - Passes environment variables from configuration
   - Connects stdin/stdout pipes for MCP communication
4. **MCP server initializes** (see logs in Claude Code console):
   - Loads configuration from environment
   - Initializes OpenAI embedding provider
   - Connects to ChromaDB (health check)
   - Initializes repository metadata service
   - Creates search service
   - Registers MCP tools
   - Starts listening on stdio transport
5. **Claude Code sends `tools/list` request**
6. **MCP server responds with tool definitions**
7. **Tools become available in Claude Code**

**Expected Startup Time**: 2-5 seconds

## Troubleshooting

For common issues and solutions, see the [Troubleshooting Guide](troubleshooting.md).

Quick checks:

1. **Tools not appearing?**
   - Check MCP configuration file path is correct
   - Verify `dist/index.js` exists after build
   - Check Claude Code logs for startup errors

2. **Search returns empty?**
   - Verify repository is indexed: `bun run cli status`
   - Check ChromaDB is running: `docker ps`
   - Try lowering threshold: Use threshold 0.5 instead of 0.7

3. **Connection errors?**
   - Ensure ChromaDB is running: `docker-compose up -d`
   - Check health: `curl http://localhost:8000/api/v1/heartbeat`
   - Verify firewall not blocking port 8000

## Performance Expectations

Personal Knowledge MCP is designed for fast retrieval with minimal token waste:

| Operation | Target Latency (p95) |
|-----------|---------------------|
| Tool discovery | <100ms |
| List repositories | <50ms |
| Semantic search | <500ms |
| Repository indexing (small) | <5 minutes |

**Performance Tips**:
- Use appropriate `threshold` values (0.7 is a good default)
- Limit results with `limit` parameter (default 10)
- Filter by `repository` when searching specific projects
- Index only relevant directories for large repositories

## Next Steps

- **Index more repositories**: Use `bun run cli index <url>` to add knowledge sources
- **Explore search capabilities**: Try different queries to understand semantic search behavior
- **Adjust thresholds**: Experiment with `threshold` values (0.5 for broader results, 0.8 for more precise)
- **Review architecture**: See [Phase 1 System Design Document](architecture/Phase1-System-Design-Document.md)

## Support

- **Issues**: [GitHub Issues](https://github.com/sethships/PersonalKnowledgeMCP/issues)
- **Documentation**: [Project README](../README.md)
- **Troubleshooting**: [Troubleshooting Guide](troubleshooting.md)
- **Architecture**: [Architecture Documentation](architecture/)

---

**Last Updated**: 2025-12-12
