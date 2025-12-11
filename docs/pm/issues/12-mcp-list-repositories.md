# [Feature] MCP list_indexed_repositories Tool Implementation

## Description

Implement the `list_indexed_repositories` MCP tool that exposes repository metadata to Claude Code. This tool allows users and Claude Code to discover what repositories are indexed and their status.

## Requirements

From PRD FR-1 and SDD Section 3.3:
- Expose tool via MCP server
- Return all indexed repositories with metadata
- Include summary statistics
- No parameters required

## Acceptance Criteria

### Tool Implementation (`src/mcp/tools/list-repositories.ts`)
- [ ] Tool registered with MCP server
- [ ] Tool definition:
  - [ ] Name: `list_indexed_repositories`
  - [ ] Description: Clear description of functionality
  - [ ] Input schema: Empty object (no parameters)
- [ ] Response includes:
  - [ ] Array of repository info
  - [ ] Summary statistics
- [ ] Each repository includes:
  - [ ] `name` - Repository identifier
  - [ ] `url` - Original clone URL
  - [ ] `file_count` - Number of files indexed
  - [ ] `chunk_count` - Total chunks
  - [ ] `last_indexed` - ISO 8601 timestamp
  - [ ] `status` - "ready", "indexing", or "error"
  - [ ] `index_duration_ms` - Time taken to index
  - [ ] `error_message` - If status is "error"
- [ ] Summary includes:
  - [ ] `total_repositories` - Count of repos
  - [ ] `total_files_indexed` - Sum of all files
  - [ ] `total_chunks` - Sum of all chunks

### MCP Tool Definition

```json
{
  "name": "list_indexed_repositories",
  "description": "List all repositories currently indexed in the knowledge base. Shows repository names, file counts, and indexing status.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

### Response Schema

```typescript
interface ListRepositoriesResponse {
  repositories: RepositoryInfo[];
  summary: {
    total_repositories: number;
    total_files_indexed: number;
    total_chunks: number;
  };
}

interface RepositoryInfo {
  name: string;
  url: string;
  file_count: number;
  chunk_count: number;
  last_indexed: string;
  status: "ready" | "indexing" | "error";
  index_duration_ms?: number;
  error_message?: string;
}
```

## Technical Notes

### Tool Handler Implementation

```typescript
async handleListRepositories(): Promise<ListRepositoriesResponse> {
  const repos = await this.repositoryService.listRepositories();

  const repositories: RepositoryInfo[] = repos.map(repo => ({
    name: repo.name,
    url: repo.url,
    file_count: repo.fileCount,
    chunk_count: repo.chunkCount,
    last_indexed: repo.lastIndexedAt,
    status: repo.status,
    index_duration_ms: repo.indexDurationMs,
    error_message: repo.errorMessage
  }));

  const summary = {
    total_repositories: repositories.length,
    total_files_indexed: repositories.reduce((sum, r) => sum + r.file_count, 0),
    total_chunks: repositories.reduce((sum, r) => sum + r.chunk_count, 0)
  };

  return { repositories, summary };
}
```

### Integration with MCP Server

Add to `PersonalKnowledgeMCPServer`:

```typescript
private getToolDefinitions(): Tool[] {
  return [
    // semantic_search definition...
    {
      name: "list_indexed_repositories",
      description: "List all repositories currently indexed in the knowledge base...",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    }
  ];
}

async handleToolCall(request: CallToolRequest): Promise<CallToolResult> {
  const { name, arguments: args } = request.params;

  if (name === "list_indexed_repositories") {
    const result = await this.handleListRepositories();
    return {
      content: [{ type: "text", text: JSON.stringify(result) }]
    };
  }

  // ... other tools
}
```

### Example Response

```json
{
  "repositories": [
    {
      "name": "my-api",
      "url": "https://github.com/user/my-api.git",
      "file_count": 127,
      "chunk_count": 342,
      "last_indexed": "2025-12-10T15:30:00Z",
      "status": "ready",
      "index_duration_ms": 45230
    },
    {
      "name": "frontend-app",
      "url": "https://github.com/user/frontend-app.git",
      "file_count": 89,
      "chunk_count": 156,
      "last_indexed": "2025-12-10T14:00:00Z",
      "status": "ready",
      "index_duration_ms": 32100
    }
  ],
  "summary": {
    "total_repositories": 2,
    "total_files_indexed": 216,
    "total_chunks": 498
  }
}
```

## Testing Requirements

- [ ] Unit tests (90% coverage):
  - [ ] Tool definition correctness
  - [ ] Empty repository list
  - [ ] Single repository
  - [ ] Multiple repositories
  - [ ] Summary calculation
  - [ ] Error status handling
- [ ] Integration tests:
  - [ ] List tools includes list_indexed_repositories
  - [ ] Tool call returns valid response
  - [ ] Response matches schema

## Definition of Done

- [ ] Tool registered with MCP server
- [ ] Response format matches schema
- [ ] Unit tests passing (90% coverage)
- [ ] Integration tests passing
- [ ] Works with Claude Code

## Size Estimate

**Size:** S (Small) - 2-3 hours

## Dependencies

- #5 Repository Metadata Store
- #11 MCP Server (must be in place)

## Blocks

- #14 Claude Code Integration

## Labels

phase-1, P0, feature
