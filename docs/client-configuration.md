# Client Configuration Guide

This guide explains how to configure MCP clients to connect to Personal Knowledge MCP using the HTTP transport layer.

## Transport Options

Personal Knowledge MCP supports two HTTP transport types:

| Transport | Endpoint | Specification | Recommended For |
|-----------|----------|---------------|-----------------|
| Streamable HTTP | `POST/GET/DELETE /api/v1/mcp` | MCP 2025-03-26 | Modern clients (Cursor, VS Code Continue) |
| SSE (Legacy) | `POST /api/v1/sse`, `GET /api/v1/sse` | Legacy | Older clients |

**Recommendation**: Use Streamable HTTP for new integrations. It provides better session management and follows the latest MCP specification.

## Prerequisites

1. **Enable HTTP Transport**: Set `HTTP_TRANSPORT_ENABLED=true` in your `.env` file
2. **Start the Server**: Run `bun run start` or start via Docker
3. **Verify Health**: Check `http://localhost:3001/api/v1/health` returns healthy status

```bash
# Quick health check
curl http://localhost:3001/api/v1/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T12:00:00.000Z",
  "components": {
    "chromaDb": { "status": "healthy" },
    "mcpServer": { "status": "healthy" }
  }
}
```

## Cursor Configuration

Cursor supports MCP servers via the Streamable HTTP transport.

### Configuration File

Add to your Cursor settings (`~/.cursor/mcp.json` or project-level `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "url": "http://localhost:3001/api/v1/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### Network Access

For remote access (e.g., running MCP server on a different machine):

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "url": "http://192.168.1.100:3001/api/v1/mcp",
      "transport": "streamable-http"
    }
  }
}
```

**Security Note**: If exposing over the network, ensure:
- Set `HTTP_HOST=0.0.0.0` in `.env` (required for network access)
- Use a VPN or Tailscale for secure remote access
- Consider adding reverse proxy with authentication

## VS Code Continue Extension

The Continue extension for VS Code supports MCP servers.

### Configuration

Add to your Continue configuration (`~/.continue/config.json`):

```json
{
  "mcpServers": [
    {
      "name": "personal-knowledge",
      "transport": {
        "type": "streamable-http",
        "url": "http://localhost:3001/api/v1/mcp"
      }
    }
  ]
}
```

### Workspace-Specific Configuration

For project-specific settings, add to `.continue/config.json` in your project root:

```json
{
  "mcpServers": [
    {
      "name": "personal-knowledge",
      "transport": {
        "type": "streamable-http",
        "url": "http://localhost:3001/api/v1/mcp"
      }
    }
  ]
}
```

## Generic HTTP Client

For custom integrations or testing, here's how to interact with the Streamable HTTP endpoint directly.

### Session Initialization

Initialize a session by sending an `initialize` request:

```bash
curl -X POST http://localhost:3001/api/v1/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": {
        "name": "my-client",
        "version": "1.0.0"
      }
    },
    "id": 1
  }'
```

The response includes a session ID in the `Mcp-Session-Id` header. Save this for subsequent requests.

### Making Requests with Session ID

Include the session ID in all subsequent requests:

```bash
# List available tools
curl -X POST http://localhost:3001/api/v1/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: your-session-id-here" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 2
  }'
```

### Calling Tools

Execute a semantic search:

```bash
curl -X POST http://localhost:3001/api/v1/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: your-session-id-here" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "semantic_search",
      "arguments": {
        "query": "authentication middleware",
        "limit": 10
      }
    },
    "id": 3
  }'
```

### Opening SSE Stream (Optional)

For server-initiated messages, open an SSE stream:

```bash
curl -N http://localhost:3001/api/v1/mcp \
  -H "Accept: text/event-stream" \
  -H "Mcp-Session-Id: your-session-id-here"
```

### Terminating Session

Close the session when done:

```bash
curl -X DELETE http://localhost:3001/api/v1/mcp \
  -H "Mcp-Session-Id: your-session-id-here"
```

## TypeScript/JavaScript Client Example

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  // Create transport
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3001/api/v1/mcp")
  );

  // Create and connect client
  const client = new Client({
    name: "my-mcp-client",
    version: "1.0.0",
  });

  await client.connect(transport);

  // List available tools
  const tools = await client.listTools();
  console.log("Available tools:", tools);

  // Execute semantic search
  const result = await client.callTool("semantic_search", {
    query: "database connection pooling",
    limit: 5,
  });
  console.log("Search results:", result);

  // Close connection
  await client.close();
}

main().catch(console.error);
```

## Python Client Example

```python
import httpx
import json

class MCPClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session_id = None
        self.client = httpx.Client()

    def initialize(self):
        response = self.client.post(
            f"{self.base_url}/api/v1/mcp",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "python-client", "version": "1.0.0"},
                },
                "id": 1,
            },
        )
        self.session_id = response.headers.get("Mcp-Session-Id")
        return response.json()

    def call_tool(self, tool_name: str, arguments: dict):
        response = self.client.post(
            f"{self.base_url}/api/v1/mcp",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Mcp-Session-Id": self.session_id,
            },
            json={
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
                "id": 2,
            },
        )
        return response.json()

    def close(self):
        if self.session_id:
            self.client.delete(
                f"{self.base_url}/api/v1/mcp",
                headers={"Mcp-Session-Id": self.session_id},
            )
        self.client.close()


# Usage
client = MCPClient("http://localhost:3001")
client.initialize()

results = client.call_tool("semantic_search", {
    "query": "error handling patterns",
    "limit": 10,
})
print(json.dumps(results, indent=2))

client.close()
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Connection refused | HTTP transport not enabled | Set `HTTP_TRANSPORT_ENABLED=true` in `.env` |
| 400 Bad Request | Missing session ID | Include `Mcp-Session-Id` header for non-init requests |
| 404 Session not found | Session expired or invalid | Re-initialize session |
| 503 Service Unavailable | Session limit reached | Wait for sessions to close or increase `HTTP_MAX_STREAMABLE_SESSIONS` |

### Debug Logging

Enable debug logging to troubleshoot connection issues:

```bash
LOG_LEVEL=debug bun run start
```

### Session Limits

Default limits can be adjusted in `.env`:

```bash
# Maximum concurrent sessions
HTTP_MAX_STREAMABLE_SESSIONS=100

# Session timeout (30 minutes default)
HTTP_STREAMABLE_SESSION_TTL_MS=1800000

# Cleanup interval (5 minutes default)
HTTP_STREAMABLE_CLEANUP_INTERVAL_MS=300000
```

## Security Considerations

1. **Local-Only by Default**: HTTP transport binds to `127.0.0.1` by default
2. **No Authentication**: Current implementation does not include authentication - use network-level security (VPN, Tailscale)
3. **Session Limits**: Prevent resource exhaustion with `HTTP_MAX_STREAMABLE_SESSIONS`
4. **Timeout Cleanup**: Stale sessions are automatically cleaned up based on TTL settings

For production deployments requiring network access:
- Use a reverse proxy (nginx, Caddy) with TLS termination
- Implement authentication at the proxy level
- Consider OAuth2/OIDC for enterprise deployments
