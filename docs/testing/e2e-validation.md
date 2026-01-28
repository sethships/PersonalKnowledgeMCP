# End-to-End Validation Guide

This document describes the end-to-end validation process for Personal Knowledge MCP integration with Claude Code.

## Overview

End-to-end (E2E) validation tests the complete system from Claude Code through the MCP protocol to ChromaDB and OpenAI, ensuring all components work together correctly in a real-world scenario.

## Prerequisites

Before starting E2E validation:

- [x] ChromaDB running (`docker-compose up -d`)
- [x] Project built (`bun run build`)
- [x] Environment variables configured
- [x] Claude Code installed
- [x] At least one repository indexed

## Test Environment Setup

### 1. Start ChromaDB

```bash
cd C:/src/PersonalKnowledgeMCP

# Start ChromaDB container
docker-compose up -d

# Verify health
curl http://localhost:8000/api/v1/heartbeat
# Expected: {"nanosecond heartbeat": <timestamp>}
```

### 2. Build Project

```bash
# Install dependencies
bun install

# Build MCP server
bun run build

# Verify dist/index.js exists
ls dist/index.js
```

### 3. Index Test Repository

We'll use the PersonalKnowledgeMCP repository itself as the test dataset:

```bash
# Index this repository
bun run cli index https://github.com/sethships/PersonalKnowledgeMCP

# Expected output:
# ✓ Cloning repository...
# ✓ Scanning files...
# ✓ Chunking files...
# ✓ Generating embeddings...
# ✓ Storing in ChromaDB...
#
# Repository indexed successfully!
# - Files: 45-60 (varies by branch)
# - Chunks: 300-400
# - Duration: 2-5 minutes

# Verify status
bun run cli status
# Should show PersonalKnowledgeMCP with status: ✓ ready
```

### 4. Configure Claude Code

Create or update `~/.config/claude-code/mcp.json` (path varies by platform):

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
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Important**: Use absolute paths for `args[1]`.

### 5. Restart Claude Code

Completely close and restart Claude Code to load the MCP server configuration.

---

## E2E Test Cases

### Test Case 1: Tool Discovery

**Objective**: Verify Claude Code can discover and display MCP tools.

**Procedure**:
1. Start Claude Code
2. Wait 2-5 seconds for MCP server initialization
3. Check available tools list

**Expected Result**:
- Two tools visible:
  - `semantic_search`: "Search indexed repositories using natural language..."
  - `list_indexed_repositories`: "Lists all repositories currently indexed..."

**Validation**:
- [ ] Both tools appear in tools list
- [ ] Tool descriptions are clear and helpful
- [ ] Input schemas are correctly displayed

**Screenshot Location**: `docs/testing/screenshots/test-case-1-tool-discovery.png`

**Status**: ⬜ Not Run | ✅ Pass | ❌ Fail

**Notes**:
```
[Add notes here after running test]
```

---

### Test Case 2: List Repositories

**Objective**: Verify `list_indexed_repositories` returns correct data.

**Procedure**:
1. In Claude Code, ask: "Can you list my indexed repositories?"
2. Observe Claude Code invoking `list_indexed_repositories`
3. Check response format and data

**Expected Result**:

```json
{
  "repositories": [
    {
      "name": "PersonalKnowledgeMCP",
      "url": "https://github.com/sethships/PersonalKnowledgeMCP",
      "file_count": 45-60,
      "chunk_count": 300-400,
      "last_indexed": "2025-12-12T...",
      "status": "ready",
      "index_duration_ms": 120000-300000
    }
  ],
  "summary": {
    "total_repositories": 1,
    "total_files_indexed": 45-60,
    "total_chunks": 300-400
  }
}
```

**Validation**:
- [ ] PersonalKnowledgeMCP appears in list
- [ ] URL is correct
- [ ] File count reasonable (45-60)
- [ ] Chunk count reasonable (300-400)
- [ ] Status is "ready"
- [ ] Summary statistics match

**Screenshot Location**: `docs/testing/screenshots/test-case-2-list-repositories.png`

**Status**: ⬜ Not Run | ✅ Pass | ❌ Fail

**Notes**:
```
[Add notes here after running test]
```

---

### Test Case 3: Semantic Search - Exact Match

**Objective**: Verify exact function/class name matching.

**Procedure**:
1. In Claude Code, ask: "Find ChromaDBClient class implementation"
2. Observe search execution
3. Check results

**Expected Result**:
- `src/storage/chromadb-client.ts` in top 3 results
- Similarity score >0.8
- Content snippet shows class definition
- Response time <500ms

**Validation**:
- [ ] Correct file in results
- [ ] Similarity score >0.8
- [ ] Content relevant
- [ ] Response time acceptable (<500ms)
- [ ] Metadata includes file path, repository, chunk index

**Query**:
```
Find ChromaDBClient class implementation
```

**Top Result Expected**:
```json
{
  "content": "export class ChromaDBClient { ...",
  "similarity_score": 0.92,
  "metadata": {
    "file_path": "src/storage/chromadb-client.ts",
    "repository": "PersonalKnowledgeMCP",
    "chunk_index": 0,
    "file_extension": "ts"
  }
}
```

**Screenshot Location**: `docs/testing/screenshots/test-case-3-exact-match.png`

**Status**: ⬜ Not Run | ✅ Pass | ❌ Fail

**Actual Response Time**: _____ ms

**Notes**:
```
[Add notes here after running test]
```

---

### Test Case 4: Semantic Search - Conceptual Match

**Objective**: Verify semantic understanding beyond keyword matching.

**Procedure**:
1. In Claude Code, ask: "Where is the vector database integration code?"
2. Observe search execution with semantic understanding
3. Check results for conceptual relevance

**Expected Result**:
- ChromaDB storage layer files in results:
  - `src/storage/chromadb-client.ts`
  - `src/ingestion/ingestion-service.ts`
  - `src/services/search-service.ts` (uses ChromaDB)
- Similarity scores 0.7-0.9
- No exact "vector database" keyword matches required
- Response demonstrates semantic understanding

**Validation**:
- [ ] ChromaDB-related files in top 5 results
- [ ] Results semantically relevant (not just keyword matches)
- [ ] Similarity scores reasonable (0.7-0.9)
- [ ] Multiple relevant files found

**Query**:
```
Where is the vector database integration code?
```

**Screenshot Location**: `docs/testing/screenshots/test-case-4-conceptual-match.png`

**Status**: ⬜ Not Run | ✅ Pass | ❌ Fail

**Notes**:
```
[Add notes here after running test]
```

---

### Test Case 5: Threshold Variations

**Objective**: Verify threshold parameter affects result quality.

**Procedure**:
1. Search with threshold 0.5: "MCP server implementation"
2. Search with threshold 0.7: "MCP server implementation"
3. Search with threshold 0.9: "MCP server implementation"
4. Compare result counts and quality

**Expected Result**:
- Lower threshold (0.5): More results, broader matches
- Medium threshold (0.7): Balanced results, good relevance
- High threshold (0.9): Fewer results, very precise matches

**Validation**:
- [ ] Threshold 0.5 returns most results
- [ ] Threshold 0.7 returns moderate results
- [ ] Threshold 0.9 returns fewest, most precise results
- [ ] All results remain relevant

**Results**:

| Threshold | Result Count | Top Result Score | Notes |
|-----------|--------------|------------------|-------|
| 0.5       |              |                  |       |
| 0.7       |              |                  |       |
| 0.9       |              |                  |       |

**Status**: ⬜ Not Run | ✅ Pass | ❌ Fail

**Notes**:
```
[Add notes here after running test]
```

---

### Test Case 6: Error Handling - Invalid Threshold

**Objective**: Verify validation errors are clear and helpful.

**Procedure**:
1. In Claude Code, request search with invalid threshold
2. Example: "Search for MCP server with threshold 2.0"
3. Observe error handling

**Expected Result**:
- Clear validation error message
- MCP server remains stable (doesn't crash)
- Error explains valid threshold range (0.0-1.0)

**Validation**:
- [ ] Error message received
- [ ] Error message is clear and actionable
- [ ] MCP server doesn't crash
- [ ] Claude Code handles error gracefully

**Screenshot Location**: `docs/testing/screenshots/test-case-6-error-handling.png`

**Status**: ⬜ Not Run | ✅ Pass | ❌ Fail

**Error Message**:
```
[Paste actual error message here]
```

**Notes**:
```
[Add notes here after running test]
```

---

### Test Case 7: Error Handling - ChromaDB Offline

**Objective**: Verify graceful degradation when ChromaDB unavailable.

**Procedure**:
1. Stop ChromaDB: `docker-compose down`
2. In Claude Code, attempt search
3. Observe error handling

**Expected Result**:
- Connection error with helpful message
- Error suggests checking ChromaDB status
- MCP server doesn't crash
- Claude Code displays error to user

**Validation**:
- [ ] Clear error message about ChromaDB connection
- [ ] Helpful troubleshooting hints provided
- [ ] MCP server remains responsive

**Error Message**:
```
[Paste actual error message here]
```

**Recovery**:
```bash
# Restart ChromaDB
docker-compose up -d

# Retry search - should work
```

**Status**: ⬜ Not Run | ✅ Pass | ❌ Fail

**Notes**:
```
[Add notes here after running test]
```

---

### Test Case 8: Performance Validation

**Objective**: Verify performance meets <500ms target (p95).

**Procedure**:
1. Execute 10 searches with various queries
2. Record response times from metadata
3. Calculate p95 (95th percentile)

**Queries**:
1. "ChromaDBClient class"
2. "MCP server initialization"
3. "embedding provider"
4. "repository metadata service"
5. "semantic search implementation"
6. "file chunking logic"
7. "git repository cloning"
8. "error handling"
9. "type definitions"
10. "configuration loading"

**Results**:

| Query # | Query Text | Total (ms) | Embedding (ms) | Search (ms) |
|---------|------------|------------|----------------|-------------|
| 1       |            |            |                |             |
| 2       |            |            |                |             |
| 3       |            |            |                |             |
| 4       |            |            |                |             |
| 5       |            |            |                |             |
| 6       |            |            |                |             |
| 7       |            |            |                |             |
| 8       |            |            |                |             |
| 9       |            |            |                |             |
| 10      |            |            |                |             |

**Calculated Metrics**:
- **p50 (median)**: _____ ms
- **p95**: _____ ms
- **p99**: _____ ms
- **max**: _____ ms

**Target**: p95 <500ms (total query time)

> **Note**: The <500ms target is for total MCP query response time. This includes:
> - Embedding generation via OpenAI API (~200-400ms depending on network)
> - Vector similarity search in ChromaDB (<200ms)
>
> The vector search component alone targets <200ms. Total query time varies based on OpenAI API latency.

**Validation**:
- [ ] p95 <500ms (total query time, may vary with API latency)
- [ ] p50 <250ms (total query time)
- [ ] Vector search only: <200ms (check `search_time_ms` in response metadata)
- [ ] No queries >1500ms (accounts for API latency spikes)

**Status**: ⬜ Not Run | ✅ Pass | ❌ Fail

**Notes**:
```
[Add notes here after running test]
```

---

## Summary

### Test Results Overview

| Test Case | Status | Notes |
|-----------|--------|-------|
| 1. Tool Discovery | ⬜ | |
| 2. List Repositories | ⬜ | |
| 3. Exact Match Search | ⬜ | |
| 4. Conceptual Match Search | ⬜ | |
| 5. Threshold Variations | ⬜ | |
| 6. Error Handling - Invalid Input | ⬜ | |
| 7. Error Handling - ChromaDB Offline | ⬜ | |
| 8. Performance Validation | ⬜ | |

**Overall Status**: ⬜ Not Started | 🔄 In Progress | ✅ All Pass | ❌ Failures Present

### Issues Found

```
[List any issues discovered during E2E testing]

Example:
- Search occasionally times out for queries with many results
- Error messages could be more specific about validation failures
- Performance degraded with >1000 chunks in collection
```

### Performance Summary

- **Median Query Time**: _____ ms
- **p95 Query Time**: _____ ms
- **Target Met**: ⬜ Yes | ⬜ No

### Recommendations

```
[Add recommendations for improvements]

Example:
- Consider adding result caching for common queries
- Improve error messages to include troubleshooting links
- Add query optimization for large repositories
```

---

## Validation Sign-Off

**Tested By**: _________________

**Date**: _________________

**Claude Code Version**: _________________

**Bun Version**: _________________

**Environment**: _________________

**Overall Result**: ⬜ Pass | ⬜ Pass with Issues | ⬜ Fail

**Notes**:
```
[Final notes about validation]
```

---

**Last Updated**: 2025-12-12
