# Troubleshooting Guide

This guide helps resolve common issues when using Personal Knowledge MCP with Claude Code and other MCP clients.

## Table of Contents

- [Tools Not Appearing in Claude Code](#tools-not-appearing-in-claude-code)
- [Search Returns Empty Results](#search-returns-empty-results)
- [Connection Errors](#connection-errors)
- [Performance Issues](#performance-issues)
- [Repository Indexing Problems](#repository-indexing-problems)
- [OpenAI API Issues](#openai-api-issues)
- [Docker and ChromaDB Issues](#docker-and-chromadb-issues)
- [Log Analysis](#log-analysis)

---

## Tools Not Appearing in Claude Code

### Symptoms

- Claude Code doesn't show `semantic_search` or `list_indexed_repositories` tools
- MCP server appears not to be running
- No response when attempting to use tools

### Root Causes

1. **Incorrect MCP configuration path**
2. **Invalid command path in configuration**
3. **MCP server startup errors**
4. **Build output (`dist/index.js`) doesn't exist**

### Resolution Steps

#### 1. Check MCP Configuration File Path

**Windows**:
```powershell
# Check if configuration file exists
Test-Path "$env:APPDATA/Claude Code/mcp.json"

# View contents
Get-Content "$env:APPDATA/Claude Code/mcp.json"
```

**macOS/Linux**:
```bash
# Check if configuration file exists
ls -la ~/Library/Application\ Support/Claude\ Code/mcp.json  # macOS
ls -la ~/.config/claude-code/mcp.json  # Linux

# View contents
cat ~/Library/Application\ Support/Claude\ Code/mcp.json  # macOS
cat ~/.config/claude-code/mcp.json  # Linux

# Or use forward slashes (works in most shells)
ls -la "$HOME/Library/Application Support/Claude Code/mcp.json"  # macOS
```

#### 2. Verify Command Path is Absolute

The `args` array in MCP configuration must use absolute paths:

**Incorrect** (relative path):
```json
{
  "command": "bun",
  "args": ["run", "dist/index.js"]  // ❌ Relative path won't work
}
```

**Correct** (absolute path):
```json
{
  "command": "bun",
  "args": ["run", "C:/src/PersonalKnowledgeMCP/dist/index.js"]  // ✅ Windows
}
```

```json
{
  "command": "bun",
  "args": ["run", "/Users/username/PersonalKnowledgeMCP/dist/index.js"]  // ✅ macOS/Linux
}
```

#### 3. Verify Build Output Exists

```bash
cd C:/src/PersonalKnowledgeMCP  # Or your project path

# Check if dist/index.js exists
ls dist/index.js

# If not, build the project
bun run build

# Verify build succeeded
ls dist/index.js
```

#### 4. Test MCP Server Manually

```bash
cd C:/src/PersonalKnowledgeMCP

# Ensure environment variables are set
export OPENAI_API_KEY=sk-...
export CHROMADB_HOST=localhost
export CHROMADB_PORT=8000

# Test server startup (should wait for stdio input, no errors)
bun run dist/index.js
# Press Ctrl+C to exit
```

If errors appear, check:
- ChromaDB is running (`docker ps | grep chromadb`)
- OpenAI API key is valid
- All required environment variables are set

#### 5. Check Claude Code Logs

Claude Code logs MCP server output. Check for startup errors or exceptions.

**Typical startup sequence** (no errors):
```
[info] Loading configuration
[info] Initializing OpenAI embedding provider
[info] Connecting to ChromaDB at localhost:8000
[info] ChromaDB health check: OK
[info] Initializing repository metadata service
[info] Creating search service
[info] Registering MCP tools
[info] MCP server started, listening on stdio
```

---

## Search Returns Empty Results

### Symptoms

- `semantic_search` returns `[]` (empty results array)
- Queries that should match known code return nothing
- Total matches is 0

### Root Causes

1. **No repositories indexed**
2. **ChromaDB not running or data lost**
3. **Threshold too high**
4. **Query too specific or uses wrong terminology**

### Resolution Steps

#### 1. Verify Repository is Indexed

```bash
# List indexed repositories
bun run cli status

# Expected output:
# ┌────────────────────────┬─────────────────────────────┬────────┬─────────┬─────────────────────┬────────┐
# │ Repository             │ URL                         │ Files  │ Chunks  │ Last Indexed        │ Status │
# ├────────────────────────┼─────────────────────────────┼────────┼─────────┼─────────────────────┼────────┤
# │ PersonalKnowledgeMCP   │ https://github.com/...      │ 45     │ 320     │ 2025-12-12 10:00:00 │ ✓ ready│
# └────────────────────────┴─────────────────────────────┴────────┴─────────┴─────────────────────┴────────┘
```

If empty, index a repository:
```bash
bun run cli index https://github.com/sethb75/PersonalKnowledgeMCP
```

#### 2. Check ChromaDB is Running

```bash
# Check Docker container status
docker ps | grep chromadb

# Expected output:
# CONTAINER ID   IMAGE                        STATUS         PORTS
# abc123def456   chromadb/chroma:latest      Up 2 hours     0.0.0.0:8000->8000/tcp

# If not running:
docker-compose up -d

# Verify ChromaDB responds
curl http://localhost:8000/api/v1/heartbeat
# Expected: {"nanosecond heartbeat": 1702392000000000000}
```

#### 3. Lower Threshold Value

The default threshold is 0.7 (70% similarity). If no results appear, try lower values:

```bash
# Try with threshold 0.5 (50% similarity)
bun run cli search "your query" --threshold 0.5

# Or even lower for very broad matching
bun run cli search "your query" --threshold 0.3
```

In Claude Code, you can request:
```
Search for "authentication" with a threshold of 0.5
```

#### 4. Verify Data in ChromaDB

```bash
# Use ChromaDB CLI to check collections
docker exec -it pk-mcp-chromadb chromadb utils collections

# Or use Python to inspect
docker exec -it pk-mcp-chromadb python3 -c "
import chromadb
client = chromadb.HttpClient(host='localhost', port=8000)
collections = client.list_collections()
for c in collections:
    print(f'{c.name}: {c.count()} documents')
"
```

#### 5. Reindex Repository

If data appears lost or corrupted:
```bash
# Reindex the repository
bun run cli index https://github.com/user/repo --force

# Check status after reindexing
bun run cli status
```

---

## Connection Errors

### Symptoms

- `Error: Failed to connect to ChromaDB`
- `ECONNREFUSED` errors
- `Timeout waiting for ChromaDB response`

### Root Causes

1. **ChromaDB not running**
2. **Wrong host/port configuration**
3. **Firewall blocking port 8000**
4. **Docker networking issues**

### Resolution Steps

#### 1. Ensure ChromaDB is Running

```bash
# Check Docker containers
docker ps

# If chromadb not listed:
docker-compose up -d

# Check logs for errors
docker-compose logs chromadb

# Wait for startup (up to 30 seconds)
# Then test health
curl http://localhost:8000/api/v1/heartbeat
```

#### 2. Verify CHROMADB_HOST and CHROMADB_PORT

```bash
# Check environment variables
echo $CHROMADB_HOST  # Should be: localhost
echo $CHROMADB_PORT  # Should be: 8000

# If not set:
export CHROMADB_HOST=localhost
export CHROMADB_PORT=8000
```

In Claude Code MCP configuration, verify:
```json
{
  "env": {
    "CHROMADB_HOST": "localhost",
    "CHROMADB_PORT": "8000"
  }
}
```

#### 3. Check Firewall Rules

**Windows**:
```powershell
# Check if port 8000 is listening
netstat -an | findstr :8000

# Add firewall rule if needed (run as Administrator)
New-NetFirewallRule -DisplayName "ChromaDB" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
```

**macOS/Linux**:
```bash
# Check if port 8000 is listening
lsof -i :8000

# Or with netstat
netstat -an | grep 8000
```

#### 4. Test Direct Connection

```bash
# Test HTTP connection
curl -v http://localhost:8000/api/v1/heartbeat

# Expected response:
# HTTP/1.1 200 OK
# {"nanosecond heartbeat": ...}

# If connection refused, check Docker networking:
docker network ls
docker network inspect pk-mcp_default
```

#### 5. Restart Docker Compose

```bash
# Complete restart
docker-compose down
docker-compose up -d

# Wait 30 seconds for initialization
sleep 30

# Test connection
curl http://localhost:8000/api/v1/heartbeat
```

---

## Performance Issues

### Symptoms

- Searches taking >2 seconds
- Indexing is very slow
- High memory/CPU usage

### Root Causes

1. **Repository too large for current configuration**
2. **Too many repositories indexed**
3. **High embedding batch size causing OpenAI rate limits**
4. **Insufficient Docker resources**

### Resolution Steps

#### 1. Monitor Query Performance

In MCP search responses, check performance metadata:
```json
{
  "metadata": {
    "query_time_ms": 450,        // Total time
    "embedding_time_ms": 200,     // OpenAI embedding generation
    "search_time_ms": 250         // ChromaDB vector search
  }
}
```

**Performance targets**:
- `embedding_time_ms`: <200ms (depends on OpenAI API)
- `search_time_ms`: <200ms (depends on chunk count)
- `query_time_ms`: <500ms total (p95)

#### 2. Optimize Embedding Configuration

If `embedding_time_ms` is high:

```bash
# Reduce batch size to avoid rate limits
export EMBEDDING_BATCH_SIZE=50  # Default: 100

# Increase timeout if hitting timeouts
export EMBEDDING_TIMEOUT_MS=60000  # Default: 30000 (30s)
```

#### 3. Optimize Search Parameters

Use stricter parameters to reduce result set:

```bash
# Higher threshold = fewer results, faster search
bun run cli search "query" --threshold 0.8

# Lower limit = less processing
bun run cli search "query" --limit 5

# Filter to specific repository
bun run cli search "query" --repo my-api
```

#### 4. Increase Docker Resources

**Docker Desktop Settings**:
1. Open Docker Desktop
2. Go to Settings → Resources
3. Increase memory allocation (minimum 2GB for ChromaDB)
4. Increase CPU allocation (minimum 2 cores)
5. Click "Apply & Restart"

#### 5. Monitor Repository Size

```bash
# Check repository statistics
bun run cli status

# If chunk count is very high (>10,000), consider:
# - Indexing specific subdirectories only
# - Excluding test files and generated code
# - Using more selective file extensions
```

For large repositories, use `--include-extensions` and `--exclude-patterns`:
```bash
# Index only source files, exclude tests
bun run cli index https://github.com/user/large-repo \
  --include-extensions ".ts,.js" \
  --exclude-patterns "**/*.test.ts,**/*.spec.ts,node_modules/**"
```

---

## Repository Indexing Problems

### Symptoms

- `git clone` failures
- "Authentication required" errors
- Indexing hangs or takes extremely long
- Status shows "error" for repository

### Resolution Steps

#### 1. Private Repository Authentication

For private repositories, set GitHub PAT:

```bash
# Create PAT at: https://github.com/settings/tokens
# Required scopes: repo (full control)

export GITHUB_PAT=ghp_your_token_here

# Verify it works
curl -H "Authorization: token $GITHUB_PAT" \
  https://api.github.com/user

# Then index the repository
bun run cli index https://github.com/user/private-repo
```

In Claude Code MCP configuration:
```json
{
  "env": {
    "GITHUB_PAT": "${GITHUB_PAT}"
  }
}
```

#### 2. Clone Failures

```bash
# Test git clone manually
git clone https://github.com/user/repo /tmp/test-clone

# If that works but indexing fails, check:
# - Disk space: df -h
# - Permissions: ls -la ./data/repositories
# - Directory exists: mkdir -p ./data/repositories
```

#### 3. Slow Indexing

Expected indexing times:
- Small repo (<500 files): 2-5 minutes
- Medium repo (500-2K files): 5-15 minutes
- Large repo (>2K files): 15+ minutes

If significantly slower:
```bash
# Check OpenAI API latency
time curl -X POST https://api.openai.com/v1/embeddings \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"text-embedding-3-small","input":"test"}'

# Should complete in <2 seconds
```

#### 4. Review Indexing Logs

```bash
# Enable debug logging
LOG_LEVEL=debug bun run cli index https://github.com/user/repo

# Check for:
# - File scanning progress
# - Chunking phase
# - Embedding generation phase (should see batches)
# - Storage phase
```

#### 5. Remove and Reindex

If repository stuck in "indexing" or "error" status:

```bash
# Remove repository
bun run cli remove repository-name --force --delete-files

# Reindex from scratch
bun run cli index https://github.com/user/repo
```

---

## OpenAI API Issues

### Symptoms

- "Invalid API key" errors
- "Rate limit exceeded" errors
- "Insufficient quota" errors
- Embedding generation timeouts

### Resolution Steps

#### 1. Verify API Key

```bash
# Test API key validity
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Should return list of models (200 OK)
# If 401 Unauthorized, key is invalid
```

Get a new API key at: https://platform.openai.com/api-keys

#### 2. Check Quota and Billing

1. Visit: https://platform.openai.com/usage
2. Verify you have available quota
3. Check billing is set up: https://platform.openai.com/account/billing

**Note**: Embedding API usage is very low cost:
- text-embedding-3-small: $0.00002 / 1K tokens
- Typical repository (500 files): ~$0.10-0.50

#### 3. Handle Rate Limits

If hitting rate limits (HTTP 429):

```bash
# Reduce batch size
export EMBEDDING_BATCH_SIZE=50  # Default: 100

# Increase retries
export EMBEDDING_MAX_RETRIES=5  # Default: 3

# The client will automatically retry with exponential backoff
```

For persistent rate limit issues, consider upgrading OpenAI tier: https://platform.openai.com/account/limits

#### 4. Timeout Issues

```bash
# Increase timeout for slow network
export EMBEDDING_TIMEOUT_MS=60000  # Default: 30000 (30s)
```

---

## Docker and ChromaDB Issues

### Symptoms

- ChromaDB container won't start
- Container crashes shortly after startup
- "port 8000 already in use" errors

### Resolution Steps

#### 1. Port Conflict

```bash
# Check what's using port 8000
netstat -ano | findstr :8000  # Windows
lsof -i :8000  # macOS/Linux

# If another service is using it:
# Option 1: Stop that service
# Option 2: Change ChromaDB port in docker-compose.yml:
#   ports:
#     - "8001:8000"  # Use 8001 on host
# Then update CHROMADB_PORT=8001
```

#### 2. Container Logs Show Errors

```bash
# View container logs
docker-compose logs chromadb

# Common errors:
# - "Permission denied" → Check volume permissions
# - "Out of memory" → Increase Docker memory limit
# - "Database corrupt" → Delete volume and restart

# View real-time logs
docker-compose logs -f chromadb
```

#### 3. Reset ChromaDB Data

**WARNING**: This deletes all indexed data.

```bash
# Stop and remove containers + volumes
docker-compose down -v

# Remove data directory
rm -rf ./data/chromadb

# Restart
docker-compose up -d

# Reindex repositories
bun run cli index <url>
```

#### 4. Update ChromaDB Image

```bash
# Pull latest image
docker-compose pull chromadb

# Restart with new image
docker-compose up -d chromadb
```

---

## Log Analysis

### Enable Detailed Logging

```bash
# Set log level
export LOG_LEVEL=debug  # Options: error, warn, info, debug

# Set log format
export LOG_FORMAT=pretty  # Options: json, pretty

# Run with debug logs
LOG_LEVEL=debug bun run dist/index.js
```

### Log File Locations

- **MCP Server logs**: stderr (visible in Claude Code console)
- **CLI logs**: stdout
- **ChromaDB logs**: `docker-compose logs chromadb`

### Key Log Messages

**Successful startup**:
```
[info] Loading configuration
[info] Initializing OpenAI embedding provider
[info] Connecting to ChromaDB at localhost:8000
[info] ChromaDB health check: OK
[info] MCP server started, listening on stdio
```

**Search execution**:
```
[info] Executing semantic_search tool
[debug] Query: "authentication middleware"
[debug] Limit: 10, Threshold: 0.7
[info] semantic_search completed successfully
[debug] Result count: 5, Duration: 423ms
```

**Error indicators**:
```
[error] Failed to connect to ChromaDB
[error] OpenAI API error: Invalid API key
[error] Repository clone failed
[warn] No repositories available for search
```

---

## Getting Help

If issues persist after trying these solutions:

1. **Check GitHub Issues**: https://github.com/sethb75/PersonalKnowledgeMCP/issues
2. **Create New Issue**: Include:
   - Exact error message
   - Steps to reproduce
   - Logs (with `LOG_LEVEL=debug`)
   - Environment (OS, Bun version, Docker version)
   - Configuration (redact API keys)

3. **Quick Diagnostics**:
```bash
# Generate diagnostics report
bun run cli health > diagnostics.txt

# Include in issue report
```

---

**Last Updated**: 2025-12-12
