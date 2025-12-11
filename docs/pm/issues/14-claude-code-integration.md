# [Feature] Claude Code Integration and Testing

## Description

Configure and validate the MCP service integration with Claude Code. This includes creating the MCP configuration, testing tool discovery, and verifying end-to-end semantic search functionality.

## Requirements

From PRD US-3 and Success Criteria:
- Claude Code can discover and invoke semantic_search tool
- Claude Code can invoke list_indexed_repositories tool
- Search results are useful and relevant
- Configuration is documented

## Acceptance Criteria

### Configuration Setup
- [ ] MCP configuration file documented for Claude Code
- [ ] Configuration supports:
  - [ ] Command to run: `node dist/index.js`
  - [ ] Working directory
  - [ ] Environment variables passed through
- [ ] Configuration examples for Windows and cross-platform

### Claude Code Configuration File

Location varies by platform, typical path structure:
```
~/.config/claude-code/mcp.json
```

Example configuration:
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

### Tool Discovery
- [ ] Claude Code lists `semantic_search` in available tools
- [ ] Claude Code lists `list_indexed_repositories` in available tools
- [ ] Tool descriptions are clear and helpful
- [ ] Input schemas are correctly displayed

### Functional Testing
- [ ] semantic_search returns results for valid queries
- [ ] list_indexed_repositories shows indexed repos
- [ ] Results are formatted correctly for Claude Code consumption
- [ ] Error messages are clear when issues occur

### Validation Test Cases

1. **Tool Discovery Test**
   - Start MCP service
   - In Claude Code, verify tools appear in tool list
   - Expected: Both tools visible with descriptions

2. **List Repositories Test**
   - Index at least one repository
   - Invoke list_indexed_repositories from Claude Code
   - Expected: Repository appears with correct metadata

3. **Semantic Search Test - Exact Match**
   - Index repository with known function names
   - Search for specific function name
   - Expected: Function file in top results

4. **Semantic Search Test - Conceptual Match**
   - Index repository with authentication code
   - Search for "handle user login"
   - Expected: Auth-related code in results

5. **Error Handling Test**
   - Search with invalid threshold
   - Expected: Clear error message, no crash

## Technical Notes

### Startup Sequence

1. Start ChromaDB: `docker-compose up -d`
2. Wait for ChromaDB health: `curl http://localhost:8000/api/v1/heartbeat`
3. Start Claude Code
4. Claude Code spawns MCP service via configured command
5. MCP service connects to ChromaDB
6. Tools become available

### Debugging Tips

**Check MCP server starts:**
```bash
node dist/index.js
# Should wait for stdio input, no errors
```

**Test tool manually:**
```bash
# Send MCP request via stdin (advanced)
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/index.js
```

**Check logs:**
- MCP service logs to stderr
- ChromaDB logs: `docker-compose logs chromadb`

### Common Issues

1. **Tool not appearing:**
   - Check MCP configuration path
   - Verify command path is correct
   - Check for startup errors in logs

2. **Search returns empty:**
   - Verify repository is indexed (use `pk-mcp status`)
   - Check ChromaDB is running
   - Lower threshold value

3. **Connection errors:**
   - Ensure ChromaDB is running
   - Check CHROMADB_HOST/PORT env vars
   - Verify no firewall blocking

### Environment Variables Required

```bash
OPENAI_API_KEY=sk-...      # Required for embeddings
GITHUB_PAT=ghp_...         # Required for private repos
CHROMADB_HOST=localhost    # ChromaDB host
CHROMADB_PORT=8000         # ChromaDB port
```

## Testing Requirements

- [ ] Integration tests simulating MCP protocol:
  - [ ] List tools request
  - [ ] Call semantic_search
  - [ ] Call list_indexed_repositories
- [ ] E2E tests with actual Claude Code:
  - [ ] Tool discovery
  - [ ] Search execution
  - [ ] Result display
- [ ] Documentation verification:
  - [ ] Setup instructions work
  - [ ] Configuration examples are correct

## Definition of Done

- [ ] MCP configuration documented in README
- [ ] Configuration examples for Windows
- [ ] Tool discovery verified in Claude Code
- [ ] semantic_search works end-to-end
- [ ] list_indexed_repositories works
- [ ] Validation test cases pass
- [ ] Troubleshooting guide created

## Size Estimate

**Size:** M (Medium) - 4-6 hours (mostly testing and documentation)

## Dependencies

- #2 Docker Compose (ChromaDB must be running)
- #11 MCP Server and semantic_search
- #12 list_indexed_repositories tool
- At least one repository indexed

## Blocks

- None (final integration milestone)

## Labels

phase-1, P0, feature, testing
