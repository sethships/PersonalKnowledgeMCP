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

## Claude Code (Stdio Transport)

Claude Code uses the **stdio transport**, which communicates directly with the MCP server via stdin/stdout. This transport:

- Runs as a subprocess managed by Claude Code
- Does **not** require HTTP or authentication tokens (trusted local process)
- Is always enabled and doesn't require `HTTP_TRANSPORT_ENABLED`

For complete Claude Code setup instructions, see the dedicated **[Claude Code Setup Guide](claude-code-setup.md)**.

**Quick Reference** - Claude Code configuration (`~/.config/claude-code/mcp.json` or project-level `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "command": "bun",
      "args": ["run", "/path/to/PersonalKnowledgeMCP/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "CHROMADB_HOST": "localhost",
        "CHROMADB_PORT": "8000"
      }
    }
  }
}
```

---

## HTTP Transport Clients

The following sections cover HTTP-based clients (Cursor, VS Code Continue, custom integrations) that require authentication.

## Authentication Setup

All HTTP transport clients require bearer token authentication. Tokens are managed via the CLI.

### Token Generation

Generate a token using the `pk-mcp` CLI:

```bash
# Create a read-only token for Cursor IDE
bun run cli token create --name "Cursor IDE" --scopes read --instances work

# Create a read/write token for automation
bun run cli token create --name "Automation" --scopes read,write --instances public

# Create an admin token with 30-day expiration
bun run cli token create --name "Admin" --scopes admin --instances private,work,public --expires 2592000
```

**Token Format**: `pk_mcp_<32 hex characters>` (e.g., `pk_mcp_a1b2c3d4e5f6789...`)

**Important**: The token is displayed only once during creation. Store it securely immediately.

### Token Scopes

| Scope | Permissions |
|-------|-------------|
| `read` | Query and search the knowledge base |
| `write` | Add, update, and remove repositories |
| `admin` | Full access including token management |

### Instance Access

Tokens can be restricted to specific knowledge base instances:

| Instance | Description |
|----------|-------------|
| `private` | Personal/sensitive knowledge (default isolation) |
| `work` | Work-related repositories |
| `public` | Public/open-source repositories |

### Token Management Commands

```bash
# List all active tokens
bun run cli token list

# List all tokens including revoked/expired
bun run cli token list --all

# Revoke a token by name
bun run cli token revoke --name "Old Token"

# Rotate a token (revoke old, create new with same permissions)
bun run cli token rotate --name "Cursor IDE"
```

### Using Tokens in Requests

Include the token in the `Authorization` header:

```
Authorization: Bearer pk_mcp_your_token_here
```

---

## Cursor Configuration

Cursor supports MCP servers via the Streamable HTTP transport.

### Prerequisites

1. Generate a token for Cursor:
   ```bash
   bun run cli token create --name "Cursor IDE" --scopes read --instances work
   ```
2. Save the token securely (it's only displayed once)

### Configuration File

Add to your Cursor settings (`~/.cursor/mcp.json` or project-level `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "url": "http://localhost:3001/api/v1/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer pk_mcp_your_token_here"
      }
    }
  }
}
```

**Tip**: Store your token in an environment variable and reference it:

```json
{
  "mcpServers": {
    "personal-knowledge": {
      "url": "http://localhost:3001/api/v1/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${PK_MCP_TOKEN}"
      }
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
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${PK_MCP_TOKEN}"
      }
    }
  }
}
```

**Security Notes**:
- Set `HTTP_HOST=0.0.0.0` in `.env` (required for network access)
- Use a VPN or Tailscale for secure remote access
- Consider TLS termination via reverse proxy (nginx, Caddy)
- Use tokens with minimal required scopes (`read` for search-only access)

## VS Code Continue Extension

The Continue extension for VS Code supports MCP servers.

### Prerequisites

1. Generate a token for VS Code Continue:
   ```bash
   bun run cli token create --name "VS Code Continue" --scopes read --instances work
   ```
2. Save the token securely (it's only displayed once)

### Configuration

Add to your Continue configuration (`~/.continue/config.json`):

```json
{
  "mcpServers": [
    {
      "name": "personal-knowledge",
      "transport": {
        "type": "streamable-http",
        "url": "http://localhost:3001/api/v1/mcp",
        "headers": {
          "Authorization": "Bearer pk_mcp_your_token_here"
        }
      }
    }
  ]
}
```

**Using Environment Variables** (recommended):

```json
{
  "mcpServers": [
    {
      "name": "personal-knowledge",
      "transport": {
        "type": "streamable-http",
        "url": "http://localhost:3001/api/v1/mcp",
        "headers": {
          "Authorization": "Bearer ${PK_MCP_TOKEN}"
        }
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
        "url": "http://localhost:3001/api/v1/mcp",
        "headers": {
          "Authorization": "Bearer ${PK_MCP_TOKEN}"
        }
      }
    }
  ]
}
```

**Tip**: Use separate tokens for user-level and workspace-level configurations for better access control and audit trails.

## Generic HTTP Client

For custom integrations or testing, here's how to interact with the Streamable HTTP endpoint directly.

### Prerequisites

Generate a token for your client:

```bash
bun run cli token create --name "My Custom Client" --scopes read,write --instances work
```

Export it for use in examples:

```bash
export PK_MCP_TOKEN="pk_mcp_your_token_here"
```

### Session Initialization

Initialize a session by sending an `initialize` request with your authorization token:

```bash
curl -X POST http://localhost:3001/api/v1/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $PK_MCP_TOKEN" \
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

Include both the authorization token and session ID in all subsequent requests:

```bash
# List available tools
curl -X POST http://localhost:3001/api/v1/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $PK_MCP_TOKEN" \
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
  -H "Authorization: Bearer $PK_MCP_TOKEN" \
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
  -H "Authorization: Bearer $PK_MCP_TOKEN" \
  -H "Mcp-Session-Id: your-session-id-here"
```

### Terminating Session

Close the session when done:

```bash
curl -X DELETE http://localhost:3001/api/v1/mcp \
  -H "Authorization: Bearer $PK_MCP_TOKEN" \
  -H "Mcp-Session-Id: your-session-id-here"
```

## TypeScript/JavaScript Client Example

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  // Get token from environment
  const token = process.env.PK_MCP_TOKEN;
  if (!token) {
    throw new Error("PK_MCP_TOKEN environment variable is required");
  }

  // Create transport with authentication
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3001/api/v1/mcp"),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }
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

**Usage**:
```bash
export PK_MCP_TOKEN="pk_mcp_your_token_here"
npx ts-node client.ts
```

## Python Client Example

```python
import httpx
import json
import os

class MCPClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url
        self.token = token
        self.session_id = None
        self.client = httpx.Client()

    def _headers(self) -> dict:
        """Build headers with authentication."""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {self.token}",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        return headers

    def initialize(self):
        response = self.client.post(
            f"{self.base_url}/api/v1/mcp",
            headers=self._headers(),
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
            headers=self._headers(),
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
                headers=self._headers(),
            )
        self.client.close()


# Usage
token = os.environ.get("PK_MCP_TOKEN")
if not token:
    raise ValueError("PK_MCP_TOKEN environment variable is required")

client = MCPClient("http://localhost:3001", token)
client.initialize()

results = client.call_tool("semantic_search", {
    "query": "error handling patterns",
    "limit": 10,
})
print(json.dumps(results, indent=2))

client.close()
```

**Usage**:
```bash
export PK_MCP_TOKEN="pk_mcp_your_token_here"
python client.py
```

---

## Multi-Instance Configuration

Personal Knowledge MCP supports multiple isolated instances for different knowledge tiers. This enables security isolation between personal, work, and public knowledge bases.

### Instance Tiers

| Instance | Use Case | Security Level |
|----------|----------|----------------|
| `private` | Personal notes, credentials, sensitive docs | Highest - personal access only |
| `work` | Work repositories, internal documentation | Medium - work token required |
| `public` | Open-source projects, public learning materials | Lower - broader access allowed |

### Running Multiple Instances

Deploy separate MCP server instances for each tier:

**Private Instance** (port 3001):
```bash
# .env.private
HTTP_PORT=3001
DATA_PATH=./data/private
INSTANCE_NAME=private
```

**Work Instance** (port 3002):
```bash
# .env.work
HTTP_PORT=3002
DATA_PATH=./data/work
INSTANCE_NAME=work
```

**Public Instance** (port 3003):
```bash
# .env.public
HTTP_PORT=3003
DATA_PATH=./data/public
INSTANCE_NAME=public
```

### Token Configuration for Multi-Instance

Create tokens with instance-specific access:

```bash
# Token for private instance only
bun run cli token create --name "Private Access" --scopes read --instances private

# Token for work instance only
bun run cli token create --name "Work IDE" --scopes read,write --instances work

# Token for all instances (admin use)
bun run cli token create --name "Admin All" --scopes admin --instances private,work,public
```

### Client Configuration for Multiple Instances

Configure multiple MCP servers in your client to access different instances:

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "pk-private": {
      "url": "http://localhost:3001/api/v1/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${PK_MCP_TOKEN_PRIVATE}"
      }
    },
    "pk-work": {
      "url": "http://localhost:3002/api/v1/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${PK_MCP_TOKEN_WORK}"
      }
    },
    "pk-public": {
      "url": "http://localhost:3003/api/v1/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer ${PK_MCP_TOKEN_PUBLIC}"
      }
    }
  }
}
```

### Docker Compose for Multi-Instance

Example `docker-compose.yml` for running multiple instances:

```yaml
version: "3.8"

services:
  chromadb:
    image: chromadb/chroma:latest
    ports:
      - "8000:8000"
    volumes:
      - chroma_data:/chroma/chroma

  pk-private:
    build: .
    ports:
      - "3001:3001"
    environment:
      - HTTP_PORT=3001
      - DATA_PATH=/data/private
      - INSTANCE_NAME=private
      - CHROMADB_HOST=chromadb
    volumes:
      - private_data:/data/private
    depends_on:
      - chromadb

  pk-work:
    build: .
    ports:
      - "3002:3001"
    environment:
      - HTTP_PORT=3001
      - DATA_PATH=/data/work
      - INSTANCE_NAME=work
      - CHROMADB_HOST=chromadb
    volumes:
      - work_data:/data/work
    depends_on:
      - chromadb

  pk-public:
    build: .
    ports:
      - "3003:3001"
    environment:
      - HTTP_PORT=3001
      - DATA_PATH=/data/public
      - INSTANCE_NAME=public
      - CHROMADB_HOST=chromadb
    volumes:
      - public_data:/data/public
    depends_on:
      - chromadb

volumes:
  chroma_data:
  private_data:
  work_data:
  public_data:
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Connection refused | HTTP transport not enabled | Set `HTTP_TRANSPORT_ENABLED=true` in `.env` |
| 400 Bad Request | Missing session ID | Include `Mcp-Session-Id` header for non-init requests |
| 401 Unauthorized | Missing or invalid token | Check `Authorization: Bearer <token>` header is present and token is valid |
| 401 Token expired | Token past expiration date | Generate a new token with `bun run cli token create` |
| 403 Forbidden | Insufficient scopes | Create a token with required scopes (`read`, `write`, or `admin`) |
| 403 Instance access denied | Token doesn't have instance access | Create a token with correct `--instances` flag |
| 404 Session not found | Session expired or invalid | Re-initialize session |
| 429 Too Many Requests | Rate limit exceeded | Wait and retry, or request rate limit increase |
| 503 Service Unavailable | Session limit reached | Wait for sessions to close or increase `HTTP_MAX_STREAMABLE_SESSIONS` |

### Authentication Troubleshooting

**Token not working?**

1. Verify token format starts with `pk_mcp_`:
   ```bash
   echo $PK_MCP_TOKEN | head -c 7  # Should output: pk_mcp_
   ```

2. Check token is still active:
   ```bash
   bun run cli token list
   ```

3. Verify token has required scopes:
   ```bash
   bun run cli token list --json | grep -A5 "your-token-name"
   ```

4. Check if token is expired or revoked:
   ```bash
   bun run cli token list --all  # Shows expired/revoked tokens
   ```

**Token rotation**:

If a token is compromised or needs regular rotation:

```bash
# Rotate creates a new token with same permissions and revokes the old one
bun run cli token rotate --name "Cursor IDE"
```

### Debug Logging

Enable debug logging to troubleshoot connection issues:

```bash
LOG_LEVEL=debug bun run start
```

For authentication-specific debugging:

```bash
LOG_LEVEL=debug AUTH_DEBUG=true bun run start
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

### Rate Limiting

If you're hitting rate limits, check your configuration:

```bash
# Rate limit settings in .env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_READ_PER_MINUTE=60
RATE_LIMIT_READ_PER_HOUR=1000
RATE_LIMIT_WRITE_PER_MINUTE=30
RATE_LIMIT_WRITE_PER_HOUR=500
RATE_LIMIT_ADMIN_BYPASS=true  # Admin tokens bypass limits
```

## Security Best Practices

### Token Storage

**Never commit tokens to version control.** Tokens should be stored securely:

| Method | Recommended For | Example |
|--------|-----------------|---------|
| Environment variables | Local development | `export PK_MCP_TOKEN="pk_mcp_..."` |
| `.env` files | Development (gitignored) | `PK_MCP_TOKEN=pk_mcp_...` |
| Secret managers | Production | AWS Secrets Manager, Azure Key Vault, HashiCorp Vault |
| System keychain | Personal machines | macOS Keychain, Windows Credential Manager |

**Example `.gitignore` entries**:
```gitignore
.env
.env.local
.env.*.local
*.token
```

### Principle of Least Privilege

Create tokens with minimal required permissions:

```bash
# Read-only for search clients
bun run cli token create --name "Search Only" --scopes read --instances work

# Write access only when needed for indexing
bun run cli token create --name "Indexer" --scopes write --instances work

# Admin only for token management and maintenance
bun run cli token create --name "Admin" --scopes admin --instances private,work,public
```

### Token Rotation

Rotate tokens regularly and immediately if compromised:

```bash
# Rotate a token (revokes old, creates new with same permissions)
bun run cli token rotate --name "Cursor IDE"

# Revoke a compromised token immediately
bun run cli token revoke --name "Compromised Token"
```

**Rotation schedule recommendations**:
- Development tokens: Every 90 days
- Production tokens: Every 30 days
- After team member offboarding: Immediately

### Network Security

1. **Local-Only by Default**: HTTP transport binds to `127.0.0.1` by default - safe for local development
2. **VPN/Tailscale for Remote Access**: If accessing from other machines, use a secure network layer
3. **TLS Termination**: Use a reverse proxy (nginx, Caddy) with HTTPS for network-exposed deployments
4. **CORS Configuration**: Configure allowed origins for browser-based clients:
   ```bash
   CORS_ENABLED=true
   CORS_ORIGINS=http://localhost:3000,https://your-app.example.com
   ```

### Rate Limiting

Protect against abuse with rate limiting:

```bash
RATE_LIMIT_ENABLED=true
RATE_LIMIT_READ_PER_MINUTE=60
RATE_LIMIT_WRITE_PER_MINUTE=30
RATE_LIMIT_ADMIN_BYPASS=true  # Admin tokens can bypass for maintenance
```

### Session Security

1. **Session Limits**: Prevent resource exhaustion with `HTTP_MAX_STREAMABLE_SESSIONS=100`
2. **Session Timeouts**: Automatically expire idle sessions with `HTTP_STREAMABLE_SESSION_TTL_MS=1800000`
3. **Automatic Cleanup**: Stale sessions cleaned up every 5 minutes by default

### Multi-Instance Isolation

For sensitive data, use separate instances with isolated tokens:

```bash
# Private instance - only accessible with private-scoped tokens
bun run cli token create --name "Private Only" --scopes read --instances private

# Tokens cannot cross instance boundaries unless explicitly granted
```

### Audit and Monitoring

Monitor token usage through the CLI:

```bash
# View token usage stats
bun run cli token list --json

# Check for tokens that haven't been used recently (may be stale)
bun run cli token list --all
```

Enable debug logging for security auditing:

```bash
LOG_LEVEL=info  # Logs all authentication events
```

---

**Last Updated**: December 2025
