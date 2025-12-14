# Personal Knowledge MCP - Integration Guide

This guide explains how to integrate the Personal Knowledge MCP server with Claude Code and other MCP clients.

## Overview

The Personal Knowledge MCP server provides semantic search capabilities across your indexed codebases. It runs as a standalone MCP server that other projects can connect to via the Model Context Protocol.

## Quick Start

### 1. Prerequisites

- **Bun** 1.0+ installed
- **Docker** running with ChromaDB container active
- **OpenAI API Key** in your environment (`OPENAI_API_KEY`)

### 2. Server Setup

The server should already be built and ChromaDB running. Verify with:

```bash
# From the PersonalKnowledgeMCP directory
bun run cli health
```

You should see:
```
✓ ChromaDB             healthy
✓ OpenAI API           healthy
✓ Metadata Store       healthy
✓ All systems operational.
```

## Connecting from Claude Code

### Configuration File Location

Add the MCP server configuration to your Claude Code settings file:

**Windows:** `%USERPROFILE%\.claude\claude_desktop_config.json`

**macOS/Linux:** `~/.claude/claude_desktop_config.json`

### MCP Server Configuration

Add the following to your `mcpServers` section:

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "bun",
      "args": [
        "run",
        "C:\\src\\PersonalKnowledgeMCP\\dist\\index.js"
      ],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "CHROMADB_HOST": "localhost",
        "CHROMADB_PORT": "8000",
        "DATA_PATH": "C:/src/PersonalKnowledgeMCP/data",
        "REPO_CLONE_PATH": "C:/src/PersonalKnowledgeMCP/data/repos",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

> **CRITICAL: Absolute Paths Required**
>
> The `DATA_PATH` and `REPO_CLONE_PATH` environment variables **MUST be absolute paths**.
> When Claude Code spawns the MCP server, the working directory is NOT the project directory.
> Using relative paths (like `./data`) will cause the server to look in the wrong location,
> resulting in "no repositories found" errors even after successful indexing.

**Important Notes:**
- Replace `C:\\src\\PersonalKnowledgeMCP` with the actual path to your installation
- Use double backslashes (`\\`) for Windows paths in JSON (but forward slashes work for env values)
- The `${OPENAI_API_KEY}` will be picked up from your system environment
- `DATA_PATH` must be an **absolute path** to the data directory
- Restart Claude Code after adding this configuration

### Alternative: Use Absolute Path to Bun

If you need to specify the full path to Bun:

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "C:\\Users\\YourUsername\\.bun\\bin\\bun.exe",
      "args": [
        "run",
        "C:\\src\\PersonalKnowledgeMCP\\dist\\index.js"
      ],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "CHROMADB_HOST": "localhost",
        "CHROMADB_PORT": "8000",
        "DATA_PATH": "C:/src/PersonalKnowledgeMCP/data",
        "REPO_CLONE_PATH": "C:/src/PersonalKnowledgeMCP/data/repos"
      }
    }
  }
}
```

## Indexing Your Code

### From Another Project

When working in a different project with Claude Code, you can ask Claude to index that project's code:

**Example prompt:**
```
Please index this project's code into the personal knowledge database for future reference.
```

### Using the CLI Directly

You can also use the CLI tool directly to index repositories:

```bash
# Index a GitHub repository
bun run cli index https://github.com/username/repository

# Index with custom name
bun run cli index https://github.com/username/repository --name my-project

# Index specific branch
bun run cli index https://github.com/username/repository --branch develop

# Force reindexing
bun run cli index https://github.com/username/repository --force
```

### Indexing Local Repositories

To index a local repository, you can still use the CLI by providing a file:// URL or the local git remote URL:

```bash
# From within a git repository
git remote get-url origin  # Get the remote URL
bun run cli index <remote-url>
```

## Available MCP Tools

Once connected, Claude Code can use these tools:

### 1. `semantic_search`

Search across all indexed repositories using natural language.

**Parameters:**
- `query` (required): Natural language search query
- `limit` (optional): Maximum results to return (1-50, default: 10)
- `threshold` (optional): Similarity threshold (0.0-1.0, default: 0.7)
- `repository` (optional): Filter to specific repository

**Example usage in Claude Code:**
```
Find JWT authentication middleware implementations
```

### 2. `list_indexed_repositories`

List all repositories currently indexed in the knowledge base.

**Returns:**
- Repository names and URLs
- Indexing status (ready/indexing/error)
- File and chunk counts
- Last indexed timestamps

**Example usage in Claude Code:**
```
What repositories are indexed?
```

## Querying from Another Project

### Example Workflow

1. **From Project A:** Index Project A's code
   ```
   Claude, please index this project's code for future reference
   ```

2. **From Project B:** Query Project A's code
   ```
   How does Project A implement error handling in their API layer?
   ```

3. **Cross-reference patterns:**
   ```
   Find similar authentication patterns to what Project A uses
   ```

### Search Examples

```
# Find specific functionality
"Find rate limiting implementations"

# Understand patterns
"Show me examples of dependency injection patterns"

# Learn from existing code
"How are database migrations handled in indexed projects?"

# Cross-project insights
"Find all projects that use Redis for caching"
```

## Monitoring and Maintenance

### Check Server Status

```bash
# Check if ChromaDB is running
docker ps --filter "name=pk-mcp-chromadb"

# Check ChromaDB health
curl http://localhost:8000/api/v2/heartbeat

# List indexed repositories
bun run cli status
```

### View Search Results

```bash
# Search via CLI
bun run cli search "authentication middleware"

# Search with filters
bun run cli search "error handling" --repo my-project --limit 5

# Output as JSON
bun run cli search "config" --json
```

### Remove Repository

```bash
# Remove from index (keeps local files)
bun run cli remove my-project

# Remove and delete local files
bun run cli remove my-project --delete-files --force
```

## Performance Considerations

### Query Response Times

- **Target:** <500ms for 95th percentile queries
- **Typical:** 100-300ms for semantic search

### Indexing Times

- **Small repository** (<1K files): <5 minutes
- **Medium repository** (1K-10K files): <30 minutes
- **Incremental updates:** <1 minute for typical PR changes

### Resource Usage

- **ChromaDB:** ~200-500MB RAM (varies with index size)
- **MCP Server:** ~50-100MB RAM per connection
- **Disk:** ~1-2MB per 1000 code chunks indexed

## Troubleshooting

### Server Won't Start

1. Check ChromaDB is running:
   ```bash
   docker ps --filter "name=pk-mcp-chromadb"
   ```

2. Verify OpenAI API key:
   ```bash
   bun run cli health
   ```

3. Check logs in Claude Code's developer console

### No Search Results (Most Common Issue)

**Root Cause:** The MCP server is using relative paths and looking in the wrong directory.

1. **Verify DATA_PATH is absolute** in your MCP configuration:
   ```json
   "DATA_PATH": "C:/src/PersonalKnowledgeMCP/data"  // CORRECT - absolute path
   "DATA_PATH": "./data"                            // WRONG - relative path
   ```

2. Verify repositories are indexed via CLI:
   ```bash
   bun run cli status
   ```

3. Check indexing status (should be "ready")

4. If CLI shows repos but MCP doesn't find them, the DATA_PATH is incorrect

5. Try lowering the similarity threshold:
   ```json
   {"threshold": 0.5}
   ```

6. After fixing DATA_PATH, **restart Claude Code completely** to reload the MCP server

### Claude Code Can't Find MCP Server

1. Verify the path in `claude_desktop_config.json` is correct
2. Make sure to use double backslashes on Windows
3. Restart Claude Code after config changes
4. Check that `dist/index.js` exists (run `bun run build` if needed)

### Authentication Errors

1. Verify `OPENAI_API_KEY` is set in your environment:
   ```bash
   echo $env:OPENAI_API_KEY  # PowerShell
   echo $OPENAI_API_KEY      # bash/zsh
   ```

2. Test the API key directly:
   ```bash
   bun run cli health
   ```

## Advanced Configuration

### Custom Data Directory

Set a custom location for indexed repositories:

```json
{
  "env": {
    "DATA_PATH": "D:\\Projects\\knowledge-data",
    "REPO_CLONE_PATH": "D:\\Projects\\knowledge-data\\repos"
  }
}
```

### Embedding Model Configuration

Use a different OpenAI embedding model:

```json
{
  "env": {
    "EMBEDDING_MODEL": "text-embedding-3-large",
    "EMBEDDING_DIMENSIONS": "3072"
  }
}
```

**Available models:**
- `text-embedding-3-small` (1536 dimensions) - Fast, lower cost
- `text-embedding-3-large` (3072 dimensions) - Higher quality

### Debug Logging

Enable debug logging for troubleshooting:

```json
{
  "env": {
    "LOG_LEVEL": "debug",
    "LOG_FORMAT": "pretty"
  }
}
```

## Security Considerations

### API Keys

- Never commit `.env` files to version control
- The MCP server inherits environment variables from the parent process
- Claude Code passes environment variables securely via the MCP protocol

### Repository Access

- Private repositories require `GITHUB_PAT` environment variable
- PAT needs `repo` scope for private repository access
- Indexed code is stored locally in ChromaDB

### Network Security

- ChromaDB runs on localhost by default (port 8000)
- No external network exposure required
- MCP communication is local via stdio transport

## Next Steps

1. **Index your first repository:** Use `bun run cli index <url>`
2. **Test semantic search:** Try `bun run cli search "your query"`
3. **Connect from Claude Code:** Add the MCP configuration
4. **Query from other projects:** Ask Claude about your indexed code

## Support and Issues

- **GitHub Issues:** https://github.com/sethb75/PersonalKnowledgeMCP/issues
- **Documentation:** See `docs/` directory in the repository
- **PRD:** `docs/High-level-Personal-Knowledge-MCP-PRD.md`
