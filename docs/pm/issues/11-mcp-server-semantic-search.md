# [Feature] MCP Server and semantic_search Tool Implementation

## Description

Implement the MCP server using the official `@modelcontextprotocol/sdk` and create the `semantic_search` tool handler. This is the primary interface through which Claude Code will query the knowledge base.

## Requirements

From PRD FR-1 and SDD Section 3.2, 6.1:
- MCP-compliant server with stdio transport
- Expose `semantic_search` tool with proper schema
- Handle tool invocations correctly
- Return results in MCP-compliant format
- Graceful error handling

## Acceptance Criteria

### MCP Server (`src/mcp/server.ts`)
- [ ] `PersonalKnowledgeMCPServer` class implemented
- [ ] Uses `@modelcontextprotocol/sdk` package
- [ ] Server configuration:
  - [ ] Name: `personal-knowledge-mcp`
  - [ ] Version: `1.0.0`
  - [ ] Capabilities: `{ tools: {} }`
- [ ] Transport: `StdioServerTransport`
- [ ] Request handlers:
  - [ ] `ListToolsRequestSchema` - Returns tool definitions
  - [ ] `CallToolRequestSchema` - Routes to tool handlers
- [ ] Graceful startup and shutdown
- [ ] Structured logging for all operations

### semantic_search Tool (`src/mcp/tools/semantic-search.ts`)
- [ ] Tool definition matches PRD FR-1 and SDD Section 3.2:
  - [ ] Name: `semantic_search`
  - [ ] Description: Clear, helpful description
  - [ ] Input schema with all parameters
- [ ] Parameters:
  - [ ] `query` (string, required): 1-1000 characters
  - [ ] `limit` (integer, optional): 1-50, default 10
  - [ ] `threshold` (float, optional): 0.0-1.0, default 0.7
  - [ ] `repository` (string, optional): Filter to specific repo
- [ ] Response format:
  - [ ] `results`: Array of search results
  - [ ] `metadata`: Query timing and stats
- [ ] Error handling:
  - [ ] Invalid parameters: Return MCP error
  - [ ] Search failure: Return MCP error with details
  - [ ] Empty results: Return valid response with empty array

### MCP Tool Definition

```json
{
  "name": "semantic_search",
  "description": "Search indexed code repositories using natural language queries. Returns relevant code snippets ranked by semantic similarity.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural language search query describing what you're looking for",
        "minLength": 1,
        "maxLength": 1000
      },
      "limit": {
        "type": "integer",
        "description": "Maximum number of results to return",
        "default": 10,
        "minimum": 1,
        "maximum": 50
      },
      "threshold": {
        "type": "number",
        "description": "Minimum similarity score (0.0 to 1.0)",
        "default": 0.7,
        "minimum": 0.0,
        "maximum": 1.0
      },
      "repository": {
        "type": "string",
        "description": "Filter results to a specific repository name"
      }
    },
    "required": ["query"]
  }
}
```

## Technical Notes

### MCP Server Setup (from SDD Appendix A)

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

class PersonalKnowledgeMCPServer {
  private server: Server;

  constructor(private searchService: SearchService) {
    this.server = new Server(
      { name: "personal-knowledge-mcp", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.getToolDefinitions() };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return this.handleToolCall(request);
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
```

### Tool Response Format

```typescript
async handleToolCall(request: CallToolRequest): Promise<CallToolResult> {
  const { name, arguments: args } = request.params;

  if (name === "semantic_search") {
    try {
      const result = await this.searchService.search({
        query: args.query,
        limit: args.limit ?? 10,
        threshold: args.threshold ?? 0.7,
        repository: args.repository
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Search failed: ${error.message}`
      );
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
}
```

### MCP Error Handling

```typescript
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

// Validation error
throw new McpError(ErrorCode.InvalidParams, "Query parameter is required");

// Internal error
throw new McpError(ErrorCode.InternalError, "Search service unavailable");

// Method not found
throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
```

### Main Entry Point (`src/index.ts`)

```typescript
import { PersonalKnowledgeMCPServer } from './mcp/server.js';
import { createSearchService } from './services/search-service.js';
import { createConfig } from './config/index.js';

async function main() {
  const config = createConfig();
  const searchService = await createSearchService(config);
  const server = new PersonalKnowledgeMCPServer(searchService);

  await server.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

## Testing Requirements

- [ ] Unit tests (95% coverage):
  - [ ] Tool definition correctness
  - [ ] Parameter validation
  - [ ] Successful search response format
  - [ ] Error response format
  - [ ] Unknown tool handling
- [ ] Integration tests:
  - [ ] MCP protocol handshake
  - [ ] List tools returns semantic_search
  - [ ] Tool call returns valid response
- [ ] E2E tests:
  - [ ] Spawn server, send requests via stdio
  - [ ] Verify MCP protocol compliance

## Definition of Done

- [ ] MCP server implementation complete
- [ ] semantic_search tool registered and working
- [ ] Unit tests passing (95% coverage)
- [ ] Integration tests passing
- [ ] MCP protocol compliance verified
- [ ] Structured logging for operations
- [ ] JSDoc comments on public methods

## Size Estimate

**Size:** M (Medium) - 6-8 hours

## Dependencies

- #1 Project Setup (MCP SDK dependency)
- #10 Search Service

## Blocks

- #14 Claude Code Integration

## Labels

phase-1, P0, feature
