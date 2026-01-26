# Docker Containerization GitHub Issues

**Date Created:** 2025-12-21
**Parent Roadmap:** [docker-containerization-roadmap.md](./docker-containerization-roadmap.md)
**Parent PRD:** [Docker-Containerization-PRD.md](./Docker-Containerization-PRD.md)

This document contains the GitHub issue specifications for the Docker Containerization initiative. Issues should be created in the order listed to maintain proper dependency relationships.

---

## EPIC Issue

### [EPIC] Docker Containerization and Multi-Transport MCP

**Labels:** `epic`, `phase-2`, `phase-3`, `phase-4`

**Description:**

```markdown
## Overview

This EPIC tracks the Docker Containerization initiative for Personal Knowledge MCP, encompassing:

- **Phase 2**: Docker Compose Hardening - Security, backup automation, and production readiness
- **Phase 3**: Multi-Transport + Authentication - HTTP/SSE transport and bearer token security
- **Phase 4**: OIDC + Kubernetes - Enterprise deployment with Microsoft 365 integration

## Parent Documents

- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md)
- Roadmap: [docker-containerization-roadmap.md](docs/pm/docker-containerization-roadmap.md)

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Docker MCP Toolkit | **Not Used** | Architectural mismatch - stateful service needs persistent indexed data |
| Primary Deployment | Docker Compose | Appropriate for persistent storage requirements |
| Multi-Client Support | HTTP/SSE Transport | Protocol-native solution for cross-client compatibility |
| Authentication | Bearer Token (Phase 3), OIDC (Phase 4) | Progressive security - simple to robust |
| Kubernetes | Phase 4+ | Deferred until multi-instance scaling required |

## Architecture Evolution

**Phase 1-2:**
```
[Claude Code] <--stdio--> [MCP Service (host)] <--HTTP--> [ChromaDB (Docker)]
```

**Phase 3+:**
```
[Claude Code] <--stdio--> [MCP Service (host)] <--HTTP--> [ChromaDB (Docker)]
[Cursor/VSCode] <--HTTP--> [MCP Service (host)]
```

## Phase Breakdown

### Phase 2: Docker Compose Hardening (5 issues)
- [ ] #XX ChromaDB Container Hardening
- [ ] #XX ChromaDB Authentication Configuration
- [ ] #XX Volume Backup and Restore Automation
- [ ] #XX PostgreSQL Container Configuration
- [ ] #XX Docker Operations Runbook Update

### Phase 3: Multi-Transport + Authentication (9 issues)
- [ ] #XX HTTP/SSE Transport Implementation
- [ ] #XX Streamable HTTP Transport Support
- [ ] #XX Bearer Token Authentication Service
- [ ] #XX Authentication Middleware
- [ ] #XX Token Management CLI Commands
- [ ] #XX Multi-Instance Routing and Configuration
- [ ] #XX Rate Limiting for HTTP Endpoints
- [ ] #XX CORS Configuration for HTTP Transport
- [ ] #XX Multi-Client Configuration Guide

### Phase 4: OIDC + Kubernetes (8 issues)
- [ ] #XX OIDC Provider Implementation
- [ ] #XX Microsoft 365 Integration
- [ ] #XX Kubernetes Deployment Manifests
- [ ] #XX Helm Chart Development
- [ ] #XX Neo4j Container Configuration
- [ ] #XX User-to-Instance Authorization Mapping
- [ ] #XX Audit Logging Implementation
- [ ] #XX Kubernetes Deployment Guide

## Success Metrics

### Phase 2
- Container uptime: 99.9% over 30 days
- Backup success rate: 100%
- Restore time: < 5 minutes

### Phase 3
- HTTP query latency (p95): < 600ms
- Authentication success rate: > 99.9%
- Multi-client compatibility: 3+ clients tested

### Phase 4
- OIDC login success rate: > 99%
- Kubernetes deployment time: < 30 minutes
- Cross-instance isolation: 100% verified

## Timeline

| Phase | Development Effort | Target |
|-------|-------------------|--------|
| Phase 2 | 3-4 weeks | Q1 2026 |
| Phase 3 | 4-6 weeks | Q2 2026 |
| Phase 4 | 6-8 weeks | Q3-Q4 2026 |

---
*This EPIC will be updated as issues are created and progress is made.*
```

---

## Phase 2 Issues

### Issue 2.1: [Infrastructure] ChromaDB Container Hardening

**Labels:** `phase-2`, `infrastructure`, `security`, `P0`

**Description:**

```markdown
## Summary

Harden the ChromaDB container with production-ready configurations including resource limits, health checks, restart policies, and localhost-only binding.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Phase 1-2: Docker Compose Hardening"
- Roadmap: [docker-containerization-roadmap.md](docs/pm/docker-containerization-roadmap.md)

## Current State

Basic Docker Compose with minimal configuration:
- No resource limits
- Basic restart policy (`unless-stopped`)
- Bound to all interfaces (0.0.0.0)
- No health checks

## Target State

Production-hardened configuration per PRD specifications.

## Acceptance Criteria

- [ ] ChromaDB image version pinned (e.g., `chromadb/chroma:0.4.22`)
- [ ] Resource limits configured:
  - CPU limit: 2 cores
  - Memory limit: 2GB
  - CPU reservation: 0.5 cores
  - Memory reservation: 512MB
- [ ] Health check implemented using heartbeat endpoint
- [ ] Port bound to localhost only (`127.0.0.1:8000:8000`)
- [ ] Logging configured with rotation (`json-file` driver, 10MB max, 3 files)
- [ ] Environment variables set:
  - `IS_PERSISTENT=TRUE`
  - `ANONYMIZED_TELEMETRY=FALSE`
  - `ALLOW_RESET=FALSE`
- [ ] Container uses dedicated Docker network (`pk-mcp-network`)
- [ ] Restart policy: `unless-stopped`
- [ ] All changes tested on Windows with Docker Desktop
- [ ] Existing functionality verified (index, search operations)

## Technical Notes

See PRD for target `docker-compose.yml` configuration.

## Dependencies

- None (foundational issue)

## Blocked By

- None

## Blocks

- #XX ChromaDB Authentication Configuration
- #XX Volume Backup and Restore Automation
- All Phase 3 issues

## Size Estimate

Small-Medium (S-M) - Primarily configuration changes
```

---

### Issue 2.2: [Security] ChromaDB Authentication Configuration

**Labels:** `phase-2`, `security`, `P0`

**Description:**

```markdown
## Summary

Enable ChromaDB's built-in token authentication to secure the vector database from unauthorized access.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Security Architecture"
- Roadmap: [docker-containerization-roadmap.md](docs/pm/docker-containerization-roadmap.md)

## Current State

ChromaDB accepts unauthenticated requests on localhost.

## Target State

ChromaDB requires token authentication for all API requests.

## Acceptance Criteria

- [ ] ChromaDB authentication enabled via environment variables:
  - `CHROMA_SERVER_AUTH_PROVIDER=token`
  - `CHROMA_SERVER_AUTH_CREDENTIALS=${CHROMADB_AUTH_TOKEN}`
- [ ] Auth token stored in `.env` file (not committed to repo)
- [ ] `.env.example` updated with placeholder for `CHROMADB_AUTH_TOKEN`
- [ ] MCP service updated to include auth token in ChromaDB requests
- [ ] ChromaDB client configuration updated in `src/storage/ChromaDBClient.ts`
- [ ] All existing tests pass with authentication enabled
- [ ] New integration test verifies auth rejection without valid token
- [ ] Documentation updated for token generation and rotation

## Technical Notes

Token format should be a secure random string (32+ characters).

Generation command:
```bash
openssl rand -hex 32
```

## Dependencies

- #XX ChromaDB Container Hardening

## Blocked By

- #XX ChromaDB Container Hardening

## Blocks

- All Phase 3 HTTP transport work (security foundation)

## Size Estimate

Small (S) - Configuration and minor code changes
```

---

### Issue 2.3: [Infrastructure] Volume Backup and Restore Automation

**Labels:** `phase-2`, `infrastructure`, `P0`

**Description:**

```markdown
## Summary

Implement automated backup and restore scripts for ChromaDB persistent volumes with retention policies.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Volume Management and Backup Patterns"
- Roadmap: [docker-containerization-roadmap.md](docs/pm/docker-containerization-roadmap.md)

## Current State

No backup/restore automation exists. Data loss risk if volume is corrupted.

## Target State

Automated backup scripts with documented restore procedures.

## Acceptance Criteria

- [ ] Backup script created: `scripts/backup-chromadb.sh`
  - Creates timestamped tar.gz backup
  - Configurable backup directory via `BACKUP_DIR` env var
  - Implements retention policy (30 days by default)
  - Works on both Windows (Git Bash/WSL) and Linux
- [ ] Restore script created: `scripts/restore-chromadb.sh`
  - Accepts backup file as argument
  - Prompts for confirmation before destructive operation
  - Stops container, clears data, restores, restarts
  - Provides verification command
- [ ] PowerShell equivalents for Windows: `scripts/backup-chromadb.ps1`, `scripts/restore-chromadb.ps1`
- [ ] Backup verification test script that:
  - Creates backup
  - Corrupts data (test scenario)
  - Restores from backup
  - Verifies data integrity
- [ ] Documentation in `docs/docker-operations.md` updated
- [ ] Pre-upgrade backup reminder in upgrade procedures

## Technical Notes

See PRD for reference script implementations.

Consider using Docker volumes inspection for path detection:
```bash
docker volume inspect personalknowledgemcp_chromadb-data
```

## Dependencies

- #XX ChromaDB Container Hardening (for stable volume naming)

## Blocked By

- #XX ChromaDB Container Hardening

## Blocks

- None directly, but foundational for operational maturity

## Size Estimate

Medium (M) - Multiple scripts with cross-platform support
```

---

### Issue 2.4: [Infrastructure] PostgreSQL Container Configuration

**Labels:** `phase-2`, `infrastructure`, `P1`

**Description:**

```markdown
## Summary

Prepare PostgreSQL container configuration for future Phase 2 document store implementation.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Future Storage Containers"
- High-level PRD: [High-level-Personal-Knowledge-MCP-PRD.md](docs/High-level-Personal-Knowledge-MCP-PRD.md) - Phase 2

## Current State

No PostgreSQL configuration exists.

## Target State

Production-ready PostgreSQL container configuration ready for Phase 2 document store.

## Acceptance Criteria

- [ ] PostgreSQL service added to `docker-compose.yml`
  - Image: `postgres:17.2-alpine` (pinned version)
  - Port bound to localhost: `127.0.0.1:5432:5432`
  - Dedicated volume: `postgres-data`
  - Environment variables for credentials (from .env)
- [ ] Resource limits configured:
  - CPU limit: 2 cores
  - Memory limit: 1GB
- [ ] Health check using `pg_isready`
- [ ] Initialization scripts directory: `./init-scripts:/docker-entrypoint-initdb.d:ro`
- [ ] Basic schema init script created (placeholder for Phase 2)
- [ ] `.env.example` updated with:
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DB`
- [ ] Container uses `pk-mcp-network`
- [ ] Restart policy: `unless-stopped`
- [ ] Verified container starts and accepts connections

## Technical Notes

This is preparation only - the MCP service will not connect to PostgreSQL until Phase 2 document store implementation.

## Dependencies

- None (can be done in parallel with other Phase 2 work)

## Blocked By

- None

## Blocks

- Phase 4 Neo4j configuration (establishes patterns)

## Size Estimate

Small (S) - Configuration only, no application code changes
```

---

### Issue 2.5: [Documentation] Docker Operations Runbook Update

**Labels:** `phase-2`, `documentation`, `P1`

**Description:**

```markdown
## Summary

Update Docker operations documentation to reflect all Phase 2 hardening changes and establish operational runbooks.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md)
- Existing docs: [docker-operations.md](docs/docker-operations.md)

## Current State

Basic Docker operations documentation exists but lacks:
- Hardening configuration details
- Backup/restore procedures
- Troubleshooting guides
- Monitoring guidance

## Target State

Comprehensive operations runbook for containerized deployments.

## Acceptance Criteria

- [ ] `docs/docker-operations.md` updated with:
  - **Container Configuration Reference**
    - All environment variables documented
    - Resource limits explained
    - Health check behavior documented
  - **Backup and Restore Procedures**
    - Step-by-step backup instructions
    - Step-by-step restore instructions
    - Verification procedures
    - Retention policy explanation
  - **Troubleshooting Guide**
    - Common issues and solutions
    - Health check failure debugging
    - Volume permission issues
    - Container restart loops
  - **Monitoring and Observability**
    - Log access and interpretation
    - Resource usage monitoring
    - Health check monitoring
  - **Upgrade Procedures**
    - Pre-upgrade checklist (backup!)
    - Version upgrade steps
    - Rollback procedures
- [ ] Quick reference commands section
- [ ] Windows-specific notes where applicable
- [ ] Links to relevant PRD sections

## Dependencies

- #XX ChromaDB Container Hardening
- #XX ChromaDB Authentication Configuration
- #XX Volume Backup and Restore Automation
- #XX PostgreSQL Container Configuration

## Blocked By

All Phase 2 implementation issues (should be written after implementation)

## Blocks

- None

## Size Estimate

Medium (M) - Comprehensive documentation
```

---

## Phase 3 Issues

### Issue 3.1: [Feature] HTTP/SSE Transport Implementation

**Labels:** `phase-3`, `feature`, `P0`

**Description:**

```markdown
## Summary

Add HTTP/SSE transport layer to enable network-accessible MCP clients (Cursor, VS Code, etc.) while maintaining stdio for Claude Code.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Phase 3: Multi-Transport MCP Support"
- MCP Spec: [MCP Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)

## Current State

MCP service only supports stdio transport for Claude Code integration.

## Target State

MCP service supports both stdio and HTTP/SSE transports simultaneously.

## Acceptance Criteria

- [ ] Express.js (or equivalent) HTTP server added to project
- [ ] Health check endpoint: `GET /health` (unauthenticated)
- [ ] SSE transport endpoint: `GET /api/v1/sse`
- [ ] Configuration for HTTP transport:
  - Port configurable (default: 3001)
  - Host configurable (default: 127.0.0.1)
  - Enable/disable via config
- [ ] Transport-agnostic core MCP logic maintained
- [ ] Both transports can run simultaneously
- [ ] stdio transport behavior unchanged (Claude Code compatibility)
- [ ] Integration tests for HTTP endpoint
- [ ] Performance benchmark: HTTP latency < 100ms overhead vs stdio

## Technical Notes

```typescript
// Configuration structure
transports: {
  stdio: { enabled: true },
  http: { enabled: true, port: 3001, host: "127.0.0.1" }
}
```

## Dependencies

- Phase 2 Complete

## Blocked By

- Phase 2 issues (hardened infrastructure)

## Blocks

- #XX Streamable HTTP Transport Support
- #XX CORS Configuration
- #XX Rate Limiting

## Size Estimate

Large (L) - New transport layer, significant code
```

---

### Issue 3.2: [Feature] Streamable HTTP Transport Support

**Labels:** `phase-3`, `feature`, `P0`

**Description:**

```markdown
## Summary

Implement MCP Streamable HTTP transport per the 2025-03-26 specification for modern client compatibility.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Transport Implementation"
- MCP Spec: [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)

## Current State

HTTP/SSE transport implemented but Streamable HTTP not yet available.

## Target State

Full Streamable HTTP transport support for modern MCP clients.

## Acceptance Criteria

- [ ] `StreamableHTTPServerTransport` from MCP SDK integrated
- [ ] Single endpoint handles request/response and streaming: `POST /api/v1/mcp`
- [ ] Session management with UUID session IDs
- [ ] Proper content-type handling for JSON-RPC over HTTP
- [ ] Connection keepalive for streaming responses
- [ ] Graceful handling of client disconnects
- [ ] Client configuration examples for:
  - Cursor
  - VS Code with Continue extension
  - Generic HTTP client
- [ ] Integration tests with mock MCP client

## Technical Notes

```typescript
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});
```

## Dependencies

- #XX HTTP/SSE Transport Implementation

## Blocked By

- #XX HTTP/SSE Transport Implementation

## Blocks

- #XX Multi-Client Configuration Guide

## Size Estimate

Medium (M) - SDK integration with transport layer
```

---

### Issue 3.3: [Security] Bearer Token Authentication Service

**Labels:** `phase-3`, `security`, `P0`

**Description:**

```markdown
## Summary

Implement bearer token authentication service for HTTP endpoint security.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Phase 3: Bearer Token Authentication"

## Current State

No authentication for MCP endpoints (stdio doesn't require it).

## Target State

Token-based authentication for all HTTP endpoints.

## Acceptance Criteria

- [ ] Token service implementation: `src/auth/token-service.ts`
  - Token format: `pk_mcp_<32 random hex chars>`
  - Tokens hashed before storage (SHA-256)
  - Token metadata: name, createdAt, expiresAt, scopes, instanceAccess
- [ ] Token scopes: `read`, `write`, `admin`
- [ ] Instance access control: `private`, `work`, `public`
- [ ] Token persistence to secure file (encrypted at rest optional)
- [ ] Token validation < 10ms
- [ ] Scope checking helper methods
- [ ] Instance access checking helper methods
- [ ] Comprehensive unit tests (>90% coverage)

## Technical Notes

Token format inspired by well-known patterns (GitHub, Stripe):
```
pk_mcp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

Never store raw tokens - only hashes.

## Dependencies

- Phase 2 Complete

## Blocked By

- None (can start with Phase 3)

## Blocks

- #XX Authentication Middleware
- #XX Token Management CLI Commands

## Size Estimate

Medium (M) - Core security service
```

---

### Issue 3.4: [Security] Authentication Middleware

**Labels:** `phase-3`, `security`, `P0`

**Description:**

```markdown
## Summary

Implement Express middleware for authenticating HTTP requests using bearer tokens.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Authentication Middleware"

## Current State

No authentication middleware exists.

## Target State

All HTTP MCP endpoints protected by authentication middleware.

## Acceptance Criteria

- [ ] Middleware implementation: `src/auth/middleware.ts`
- [ ] `authenticateRequest` middleware:
  - Extracts `Authorization: Bearer <token>` header
  - Validates token via TokenService
  - Attaches token metadata to request
  - Returns 401 for missing/invalid tokens
  - Returns 401 for expired tokens
- [ ] `requireScope(scope)` middleware factory:
  - Checks if authenticated token has required scope
  - Returns 403 for insufficient scope
- [ ] `requireInstanceAccess(instance)` middleware factory:
  - Checks if token can access requested instance
  - Returns 403 for unauthorized instance
- [ ] Health endpoint excluded from authentication
- [ ] Proper error response format:
  ```json
  { "error": "error_code", "message": "Human readable message" }
  ```
- [ ] Request logging for auth events (success/failure)
- [ ] Integration tests covering all auth scenarios

## Technical Notes

Use `AuthenticatedRequest` interface to type-safely access token metadata:
```typescript
interface AuthenticatedRequest extends Request {
  tokenMetadata?: TokenMetadata;
}
```

## Dependencies

- #XX Bearer Token Authentication Service

## Blocked By

- #XX Bearer Token Authentication Service

## Blocks

- #XX Rate Limiting
- #XX Multi-Instance Routing

## Size Estimate

Medium (M) - Middleware with comprehensive error handling
```

---

### Issue 3.5: [Feature] Token Management CLI Commands

**Labels:** `phase-3`, `feature`, `P0`

**Description:**

```markdown
## Summary

Add CLI commands for token lifecycle management (create, list, revoke, rotate).

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Token Management CLI"

## Current State

No token management capability exists.

## Target State

Full token lifecycle management via CLI.

## Acceptance Criteria

- [ ] `pk-mcp token create` command:
  - Options: `--name`, `--scopes`, `--instances`, `--expires`
  - Outputs token value ONCE (never stored/shown again)
  - Confirms creation with metadata summary
- [ ] `pk-mcp token list` command:
  - Shows all tokens with metadata (name, created, expires, scopes)
  - Does NOT show token values (only hashes exist)
  - Indicates expired tokens
- [ ] `pk-mcp token revoke` command:
  - Options: `--name` or `--id`
  - Confirms revocation
  - Removes token from storage
- [ ] `pk-mcp token rotate` command:
  - Options: `--name`
  - Revokes old token, creates new with same metadata
  - Outputs new token value
- [ ] All commands integrated with existing CLI structure
- [ ] Proper error handling and user feedback
- [ ] Help text for all commands and options

## Technical Notes

Example usage:
```bash
pk-mcp token create --name "cursor-dev" --scopes read,write --instances work,public
# Output: Token created: pk_mcp_a1b2c3d4...
# Store this token securely - it will not be shown again.

pk-mcp token list
# Output: Table of tokens with metadata

pk-mcp token revoke --name "cursor-dev"
# Output: Token 'cursor-dev' has been revoked.
```

## Dependencies

- #XX Bearer Token Authentication Service

## Blocked By

- #XX Bearer Token Authentication Service

## Blocks

- None directly

## Size Estimate

Medium (M) - CLI extensions with token service integration
```

---

### Issue 3.6: [Feature] Multi-Instance Routing and Configuration

**Labels:** `phase-3`, `feature`, `P0`

**Description:**

```markdown
## Summary

Implement instance-aware request routing to support isolated knowledge tiers (Private, Work, Public).

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Multi-Instance Authorization"

## Current State

Single-instance deployment only.

## Target State

Multiple isolated instances with token-based access control.

## Acceptance Criteria

- [ ] Instance configuration schema:
  ```typescript
  interface InstanceConfig {
    name: string;        // "private" | "work" | "public"
    chromadbPort: number;
    dataPath: string;
  }
  ```
- [ ] Instance router: `src/mcp/instance-router.ts`
  - Routes requests to correct instance based on token access
  - Throws AuthorizationError for unauthorized access
- [ ] Docker Compose profiles for each instance
- [ ] Instance-specific volumes
- [ ] Configuration for instance endpoints in config file
- [ ] MCP tool responses indicate which instance was queried
- [ ] Integration tests for instance isolation
- [ ] Cannot access Private data with Work-only token

## Technical Notes

Default instances:
```typescript
const INSTANCES = {
  private: { chromadbPort: 8000, dataPath: "./data/private" },
  work: { chromadbPort: 8001, dataPath: "./data/work" },
  public: { chromadbPort: 8002, dataPath: "./data/public" },
};
```

## Dependencies

- #XX Authentication Middleware
- #XX HTTP/SSE Transport Implementation

## Blocked By

- #XX Authentication Middleware
- #XX HTTP/SSE Transport Implementation

## Blocks

- Phase 4 OIDC instance mapping

## Size Estimate

Large (L) - Significant architecture change for multi-instance support
```

---

### Issue 3.7: [Infrastructure] Rate Limiting for HTTP Endpoints

**Labels:** `phase-3`, `infrastructure`, `security`, `P1`

**Description:**

```markdown
## Summary

Implement rate limiting to protect HTTP endpoints from abuse.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Phase 3 Goals

## Current State

No rate limiting exists.

## Target State

HTTP endpoints protected by configurable rate limits.

## Acceptance Criteria

- [ ] Rate limiting middleware using proven library (e.g., `express-rate-limit`)
- [ ] Configurable limits:
  - Requests per minute (default: 60)
  - Requests per hour (default: 1000)
- [ ] Per-token rate limiting (not just IP)
- [ ] Different limits for read vs write operations
- [ ] Rate limit headers in responses:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`
- [ ] 429 response with retry-after header when limited
- [ ] Rate limit bypass for admin tokens (optional)
- [ ] Configuration via environment/config file
- [ ] Logging of rate limit events

## Technical Notes

Consider in-memory store initially; Redis for distributed deployment later.

## Dependencies

- #XX Authentication Middleware

## Blocked By

- #XX Authentication Middleware

## Blocks

- None

## Size Estimate

Small (S) - Library integration with configuration
```

---

### Issue 3.8: [Feature] CORS Configuration for HTTP Transport

**Labels:** `phase-3`, `feature`, `P1`

**Description:**

```markdown
## Summary

Configure CORS to support browser-based MCP clients.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md)

## Current State

No CORS configuration exists.

## Target State

Secure CORS configuration for browser-based clients.

## Acceptance Criteria

- [ ] CORS middleware configured with:
  - Allowed origins (configurable, default: localhost only)
  - Allowed methods: GET, POST, OPTIONS
  - Allowed headers: Authorization, Content-Type
  - Credentials: true (for auth headers)
- [ ] Environment variable for allowed origins list
- [ ] Preflight (OPTIONS) requests handled
- [ ] CORS errors logged for debugging
- [ ] Configuration documented

## Technical Notes

Default secure configuration:
```typescript
cors({
  origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  credentials: true,
})
```

## Dependencies

- #XX HTTP/SSE Transport Implementation

## Blocked By

- #XX HTTP/SSE Transport Implementation

## Blocks

- None

## Size Estimate

Small (S) - Standard CORS configuration
```

---

### Issue 3.9: [Documentation] Multi-Client Configuration Guide

**Labels:** `phase-3`, `documentation`, `P1`

**Description:**

```markdown
## Summary

Create comprehensive configuration guides for all supported MCP clients.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Client Configuration Examples"

## Current State

Only Claude Code configuration documented.

## Target State

Complete configuration guides for all supported clients.

## Acceptance Criteria

- [ ] `docs/client-configuration.md` created with:
  - **Claude Code (stdio)**
    - Current configuration (already working)
    - Environment variables required
  - **Cursor (HTTP)**
    - `url` configuration
    - `transport: "streamable-http"`
    - Authorization header with token
    - Troubleshooting tips
  - **VS Code with Continue (SSE)**
    - Continue extension setup
    - MCP server configuration
    - Token configuration
    - Troubleshooting tips
  - **Generic HTTP Client**
    - Endpoint URLs
    - Request format
    - Authentication header format
    - Example curl commands
- [ ] Token generation instructions (reference token CLI)
- [ ] Multi-instance configuration examples
- [ ] Common issues and solutions
- [ ] Security best practices for token storage

## Dependencies

All Phase 3 feature issues

## Blocked By

All Phase 3 feature issues

## Blocks

- None

## Size Estimate

Medium (M) - Comprehensive documentation
```

---

## Phase 4 Issues

### Issue 4.1: [Security] OIDC Provider Implementation

**Labels:** `phase-4`, `security`, `P0`

**Description:**

```markdown
## Summary

Implement OpenID Connect authentication provider for enterprise SSO.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Phase 4: OpenID Connect (OIDC)"

## Current State

Bearer token authentication only.

## Target State

OIDC authentication alongside existing token auth.

## Acceptance Criteria

- [ ] OIDC provider implementation: `src/auth/oidc-provider.ts`
- [ ] Using `openid-client` library
- [ ] PKCE (Proof Key for Code Exchange) support
- [ ] Token refresh handling
- [ ] User info extraction (email, name)
- [ ] Configuration via environment:
  - `OIDC_ENABLED`
  - `OIDC_ISSUER`
  - `OIDC_CLIENT_ID`
  - `OIDC_CLIENT_SECRET`
  - `OIDC_REDIRECT_URI`
- [ ] Authorization URL generation
- [ ] Callback handling with code exchange
- [ ] Session management for OIDC users
- [ ] Graceful degradation to bearer token if OIDC disabled
- [ ] Comprehensive unit tests

## Technical Notes

Focus on authorization code flow with PKCE for security.

## Dependencies

- Phase 3 Complete (HTTP transport required for OIDC callbacks)

## Blocked By

- Phase 3 HTTP transport

## Blocks

- #XX Microsoft 365 Integration
- #XX User-to-Instance Authorization Mapping

## Size Estimate

Large (L) - Complex security implementation
```

---

### Issue 4.2: [Security] Microsoft 365 Integration

**Labels:** `phase-4`, `security`, `P0`

**Description:**

```markdown
## Summary

Configure and test OIDC integration with Microsoft 365 Business Standard tenant.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Microsoft 365 Registration"

## Current State

Generic OIDC provider implemented.

## Target State

Working SSO with your-tenant.example.com Microsoft 365 tenant.

## Acceptance Criteria

- [ ] Azure AD (Entra ID) app registration documentation
- [ ] Required permissions: `openid`, `profile`, `email`
- [ ] Redirect URI configuration guide
- [ ] Client secret management (rotation procedure)
- [ ] Tenant-specific configuration:
  - Issuer URL format
  - Discovery endpoint
- [ ] Login flow tested end-to-end
- [ ] Token refresh verified
- [ ] User info mapping to internal format
- [ ] Error handling for:
  - Consent not granted
  - Token expired
  - Network issues
- [ ] Security considerations documented

## Technical Notes

Issuer URL format:
```
https://login.microsoftonline.com/{tenant-id}/v2.0
```

## Dependencies

- #XX OIDC Provider Implementation

## Blocked By

- #XX OIDC Provider Implementation

## Blocks

- None directly (enables enterprise SSO)

## Size Estimate

Medium (M) - Configuration and testing focus
```

---

### Issue 4.3: [Infrastructure] Kubernetes Deployment Manifests

**Labels:** `phase-4`, `infrastructure`, `P0`

**Description:**

```markdown
## Summary

Create Kubernetes deployment manifests for production-ready orchestration.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Phase 4 Goals

## Current State

Docker Compose only.

## Target State

Full Kubernetes deployment capability.

## Acceptance Criteria

- [ ] `kubernetes/` directory structure:
  - `base/` - Base configurations
  - `overlays/` - Environment-specific patches
- [ ] MCP Service deployment:
  - Deployment manifest
  - Service manifest
  - ConfigMap for configuration
  - Secret references
- [ ] ChromaDB StatefulSet:
  - StatefulSet manifest
  - Persistent volume claim
  - Service manifest
- [ ] PostgreSQL StatefulSet (similar structure)
- [ ] Network policies for isolation
- [ ] Ingress configuration (NGINX)
- [ ] Resource requests and limits
- [ ] Liveness and readiness probes
- [ ] Pod disruption budgets
- [ ] Verified deployment on local K3s or minikube
- [ ] Deployment commands documented

## Technical Notes

Use kustomize for overlay management.

## Dependencies

- Phase 3 Complete (multi-transport required)

## Blocked By

- Phase 3 issues

## Blocks

- #XX Helm Chart Development

## Size Estimate

Large (L) - Comprehensive K8s manifests
```

---

### Issue 4.4: [Infrastructure] Helm Chart Development

**Labels:** `phase-4`, `infrastructure`, `P1`

**Description:**

```markdown
## Summary

Create Helm charts for parameterized Kubernetes deployment.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md)

## Current State

Raw Kubernetes manifests.

## Target State

Production-ready Helm charts.

## Acceptance Criteria

- [ ] `charts/personal-knowledge-mcp/` structure
- [ ] `values.yaml` with all configurable parameters:
  - Image versions
  - Replica counts
  - Resource limits
  - Storage sizes
  - Auth configuration
  - Instance configuration
- [ ] Template files for all resources
- [ ] Conditional resource creation (e.g., optional Neo4j)
- [ ] `Chart.yaml` with proper metadata
- [ ] Values schema validation (`values.schema.json`)
- [ ] Example values files:
  - `values-dev.yaml`
  - `values-prod.yaml`
- [ ] Helm chart tests
- [ ] Installation documentation
- [ ] Upgrade notes

## Technical Notes

Consider chart dependencies for PostgreSQL/ChromaDB if suitable community charts exist.

## Dependencies

- #XX Kubernetes Deployment Manifests

## Blocked By

- #XX Kubernetes Deployment Manifests

## Blocks

- None

## Size Estimate

Medium (M) - Templating of existing manifests
```

---

### Issue 4.5: [Infrastructure] Neo4j Container Configuration

**Labels:** `phase-4`, `infrastructure`, `P1`

**Description:**

```markdown
## Summary

Configure Neo4j container for Phase 4 graph database functionality.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Future Storage Containers"
- High-level PRD: Phase 4 goals

## Current State

No graph database.

## Target State

Neo4j container ready for graph relationship storage.

## Acceptance Criteria

- [ ] Neo4j service in `docker-compose.yml`:
  - Image: `neo4j:5.25.1-community` (pinned)
  - Ports: `127.0.0.1:7474:7474` (HTTP), `127.0.0.1:7687:7687` (Bolt)
  - Volumes: `neo4j-data`, `neo4j-logs`
- [ ] Resource limits:
  - CPU: 2 cores
  - Memory: 2GB
- [ ] Memory configuration:
  - Heap: 512MB initial, 1GB max
  - Page cache: 512MB
- [ ] Health check configured
- [ ] Authentication via environment variables
- [ ] `.env.example` updated with Neo4j credentials
- [ ] Uses `pk-mcp-network`
- [ ] Restart policy: `unless-stopped`
- [ ] Basic connectivity test

## Technical Notes

Neo4j requires accepting license agreement via environment variable.

## Dependencies

- #XX PostgreSQL Container Configuration (establishes patterns)

## Blocked By

- PostgreSQL patterns from Phase 2

## Blocks

- None (preparation for future work)

## Size Estimate

Small (S) - Configuration only
```

---

### Issue 4.6: [Feature] User-to-Instance Authorization Mapping

**Labels:** `phase-4`, `feature`, `security`, `P0`

**Description:**

```markdown
## Summary

Map OIDC users to authorized instances based on role/group membership.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md) - Section "Multi-Instance Authorization"

## Current State

Token-based instance access only.

## Target State

OIDC users automatically mapped to appropriate instances.

## Acceptance Criteria

- [ ] User-to-instance mapping configuration:
  - Email-based rules
  - Group/role-based rules (from OIDC claims)
- [ ] Default instance assignment
- [ ] Multiple instance access per user
- [ ] Admin override capability
- [ ] Mapping configuration file/database
- [ ] Runtime mapping updates without restart
- [ ] Audit logging of access decisions
- [ ] Integration tests for mapping scenarios

## Technical Notes

Example mapping:
```typescript
const mappings = {
  "user@your-tenant.example.com": ["private", "work", "public"],
  "*@your-tenant.example.com": ["work", "public"],
  "guest": ["public"]
};
```

## Dependencies

- #XX OIDC Provider Implementation
- #XX Multi-Instance Routing and Configuration

## Blocked By

- #XX OIDC Provider Implementation
- #XX Multi-Instance Routing (from Phase 3)

## Blocks

- None

## Size Estimate

Medium (M) - Authorization logic with configuration
```

---

### Issue 4.7: [Security] Audit Logging Implementation

**Labels:** `phase-4`, `security`, `P1`

**Description:**

```markdown
## Summary

Implement comprehensive audit logging for security and compliance.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md)

## Current State

Basic application logging only.

## Target State

Comprehensive audit trail for security events.

## Acceptance Criteria

- [ ] Audit log service: `src/logging/audit-logger.ts`
- [ ] Events logged:
  - Authentication success/failure
  - Token creation/revocation
  - Instance access attempts
  - Authorization denials
  - Configuration changes
- [ ] Log format includes:
  - Timestamp (ISO 8601)
  - Event type
  - User/token identifier
  - Source IP
  - Instance accessed
  - Success/failure
  - Additional context
- [ ] Separate audit log file (not mixed with application logs)
- [ ] Log rotation configured
- [ ] No sensitive data in logs (no tokens, passwords)
- [ ] Query capability for audit events
- [ ] Retention policy configuration

## Technical Notes

Consider structured JSON logs for easy parsing/analysis.

## Dependencies

- OIDC and auth services must exist

## Blocked By

- #XX OIDC Provider Implementation
- Auth middleware from Phase 3

## Blocks

- None

## Size Estimate

Medium (M) - Logging infrastructure
```

---

### Issue 4.8: [Documentation] Kubernetes Deployment Guide

**Labels:** `phase-4`, `documentation`, `P1`

**Description:**

```markdown
## Summary

Create comprehensive Kubernetes deployment and operations guide.

## Parent Documents
- PRD: [Docker-Containerization-PRD.md](docs/pm/Docker-Containerization-PRD.md)

## Current State

Docker Compose documentation only.

## Target State

Complete Kubernetes deployment documentation.

## Acceptance Criteria

- [ ] `docs/kubernetes-deployment.md` with:
  - **Prerequisites**
    - Kubernetes cluster requirements
    - kubectl setup
    - Helm installation
  - **Quick Start**
    - Minimal deployment steps
    - Verification commands
  - **Full Deployment Guide**
    - Namespace setup
    - Secret creation
    - Helm installation with values
    - Ingress configuration
    - TLS certificate setup
  - **Operations**
    - Scaling procedures
    - Upgrade procedures
    - Backup/restore in K8s context
    - Monitoring integration
  - **Troubleshooting**
    - Common issues
    - Debug commands
    - Log access
  - **Security Considerations**
    - Network policies
    - Secret management
    - RBAC configuration

## Dependencies

All Phase 4 infrastructure issues

## Blocked By

All Phase 4 infrastructure and feature issues

## Blocks

- None

## Size Estimate

Large (L) - Comprehensive documentation
```

---

## Issue Creation Order

Issues should be created in this order to establish proper dependency links:

1. **EPIC Issue** - Docker Containerization and Multi-Transport MCP

### Phase 2 (in order)
2. ChromaDB Container Hardening
3. ChromaDB Authentication Configuration (blocks: #2)
4. Volume Backup and Restore Automation (blocks: #2)
5. PostgreSQL Container Configuration
6. Docker Operations Runbook Update (blocks: #2, #3, #4, #5)

### Phase 3 (in order)
7. HTTP/SSE Transport Implementation (blocks: Phase 2)
8. Streamable HTTP Transport Support (blocks: #7)
9. Bearer Token Authentication Service (blocks: Phase 2)
10. Authentication Middleware (blocks: #9)
11. Token Management CLI Commands (blocks: #9)
12. Multi-Instance Routing and Configuration (blocks: #7, #10)
13. Rate Limiting for HTTP Endpoints (blocks: #10)
14. CORS Configuration for HTTP Transport (blocks: #7)
15. Multi-Client Configuration Guide (blocks: all Phase 3)

### Phase 4 (in order)
16. OIDC Provider Implementation (blocks: Phase 3)
17. Microsoft 365 Integration (blocks: #16)
18. Kubernetes Deployment Manifests (blocks: Phase 3)
19. Helm Chart Development (blocks: #18)
20. Neo4j Container Configuration
21. User-to-Instance Authorization Mapping (blocks: #16, #12)
22. Audit Logging Implementation (blocks: #16)
23. Kubernetes Deployment Guide (blocks: all Phase 4)

---

## Labels Required

Ensure these labels exist in the repository:

- `epic`
- `phase-2`
- `phase-3`
- `phase-4`
- `P0`
- `P1`
- `P2`
- `infrastructure`
- `security`
- `feature`
- `documentation`
- `testing`

---

*Document generated: 2025-12-21*
*Repository: sethb75/PersonalKnowledgeMCP*

---

## AMENDMENT: Phase 4.0 Issues - Graph Database Migration (Added 2026-01-26)

These issues should be created and completed BEFORE the original Phase 4 issues.

### Issue 4.0.1: [Architecture] Create GraphStorageAdapter Interface

**Labels:** `phase-4`, `architecture`, `P0`

**Description:**

```markdown
## Summary

Create an abstract interface for graph storage operations to enable database-agnostic graph queries. This is the foundation for migrating from Neo4j to FalkorDB.

## Parent Documents
- ADR: [0004-graph-database-migration-neo4j-to-falkordb.md](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)
- Roadmap: [docker-containerization-roadmap.md](docs/pm/docker-containerization-roadmap.md)

## Acceptance Criteria

- [ ] `GraphStorageAdapter` interface defined in `src/graph/adapters/types.ts`
- [ ] Interface includes: connect, disconnect, healthCheck, runQuery
- [ ] Interface includes: upsertNode, deleteNode, createRelationship, deleteRelationship
- [ ] Interface includes: traverse, analyzeDependencies, getContext
- [ ] `GraphStorageAdapterFactory` created for provider selection
- [ ] Configuration schema supports multiple providers
- [ ] Existing Neo4jClient refactored to implement interface
- [ ] All existing tests continue to pass

## Technical Notes

The interface should be database-agnostic, using generic types for nodes and relationships.

## Dependencies

- None (foundational issue)

## Blocks

- All other Phase 4.0 issues

## Size Estimate

Medium (M) - 2-3 days
```

---

### Issue 4.0.2: [Feature] Implement FalkorDBAdapter

**Labels:** `phase-4`, `feature`, `P0`

**Description:**

```markdown
## Summary

Implement the GraphStorageAdapter interface for FalkorDB, enabling Cypher query execution against FalkorDB.

## Parent Documents
- ADR: [0004-graph-database-migration-neo4j-to-falkordb.md](docs/architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md)

## Acceptance Criteria

- [ ] `FalkorDBAdapter` class implements `GraphStorageAdapter`
- [ ] Uses `@falkordb/falkordb` TypeScript client
- [ ] Connection pooling with configurable pool size
- [ ] Health check endpoint integration
- [ ] All existing Cypher queries work (95%+ compatibility)
- [ ] Query parameter binding works correctly
- [ ] Error handling maps FalkorDB errors to application errors
- [ ] Unit tests with >90% coverage
- [ ] Integration tests against real FalkorDB container

## Technical Notes

FalkorDB is Cypher-compatible, so most queries should work unchanged. 
Focus areas:
- Variable-length path patterns
- MERGE operations
- Batched operations with UNWIND

## Dependencies

- Issue 4.0.1: GraphStorageAdapter Interface

## Blocks

- Issue 4.0.3: Data Migration Tooling
- Issue 4.0.4: Docker Compose Update

## Size Estimate

Medium (M) - 3-4 days
```

---

### Issue 4.0.3: [Infrastructure] Data Migration Tooling

**Labels:** `phase-4`, `infrastructure`, `P1`

**Description:**

```markdown
## Summary

Create tooling to migrate existing graph data from Neo4j to FalkorDB.

## Acceptance Criteria

- [ ] Export script: `scripts/export-neo4j-graph.ts`
- [ ] Import script: `scripts/import-falkordb-graph.ts`
- [ ] Data validation script to verify migration integrity
- [ ] CLI command: `pk-mcp graph migrate-db`
- [ ] Progress reporting during migration
- [ ] Handles large graphs with batching
- [ ] Documentation for migration process

## Dependencies

- Issue 4.0.2: FalkorDBAdapter

## Size Estimate

Small (S) - 1-2 days
```

---

### Issue 4.0.4: [Infrastructure] Docker Compose FalkorDB Configuration

**Labels:** `phase-4`, `infrastructure`, `P0`

**Description:**

```markdown
## Summary

Update Docker Compose to use FalkorDB instead of Neo4j.

## Acceptance Criteria

- [ ] FalkorDB service added to docker-compose.yml
- [ ] Neo4j service removed (or commented for reference)
- [ ] Volume configuration for FalkorDB data persistence
- [ ] Health check configured
- [ ] Resource limits appropriate for FalkorDB
- [ ] Port binding to localhost only (127.0.0.1)
- [ ] Environment variables updated in .env.example
- [ ] All Docker profiles updated (default, private, work, public, all)

## Technical Notes

FalkorDB container: `falkordb/falkordb:latest` (pin version after testing)
Default port: 6379 (Redis protocol)

## Dependencies

- Issue 4.0.2: FalkorDBAdapter

## Size Estimate

Small (S) - 1 day
```

---

### Issue 4.0.5: [Testing] Graph Test Suite Migration

**Labels:** `phase-4`, `testing`, `P0`

**Description:**

```markdown
## Summary

Migrate all graph-related tests to work with FalkorDB.

## Acceptance Criteria

- [ ] All unit tests in `tests/unit/graph/` pass with FalkorDB
- [ ] All integration tests in `tests/integration/graph/` pass
- [ ] Benchmark tests updated for FalkorDB
- [ ] Test fixtures updated if needed
- [ ] Mock/stub utilities updated for new adapter
- [ ] CI/CD pipeline uses FalkorDB container
- [ ] Test coverage remains >90%

## Dependencies

- Issue 4.0.2: FalkorDBAdapter
- Issue 4.0.4: Docker Compose Update

## Size Estimate

Medium (M) - 3-5 days
```

---

### Issue 4.0.6: [Documentation] Graph Database Migration Documentation

**Labels:** `phase-4`, `documentation`, `P1`

**Description:**

```markdown
## Summary

Update all documentation to reflect FalkorDB migration.

## Acceptance Criteria

- [ ] README.md technology stack updated
- [ ] `docs/neo4j-setup.md` renamed to `docs/graph-database-setup.md`
- [ ] Setup instructions updated for FalkorDB
- [ ] Troubleshooting guide updated
- [ ] ADR-0004 finalized and linked
- [ ] CHANGELOG updated with migration notes
- [ ] Helm chart README updated

## Dependencies

- All other Phase 4.0 issues complete

## Size Estimate

Small (S) - 1 day
```

---

### Issue 4.0.7: [Cleanup] Remove Neo4j Dependency

**Labels:** `phase-4`, `cleanup`, `P1`

**Description:**

```markdown
## Summary

Remove neo4j-driver dependency and all Neo4j-specific code after successful migration.

## Acceptance Criteria

- [ ] `neo4j-driver` removed from package.json
- [ ] Neo4jAdapter code removed or archived
- [ ] Neo4j-specific error handling removed
- [ ] All imports updated
- [ ] No references to Neo4j in codebase (except historical docs/ADRs)
- [ ] Bundle size reduced
- [ ] All tests pass without neo4j-driver

## Dependencies

- All other Phase 4.0 issues complete
- FalkorDB proven stable in production use

## Size Estimate

Small (S) - 0.5 days
```

---

## Phase 4.0 Issue Creation Order

1. Issue 4.0.1: GraphStorageAdapter Interface (blocks all others)
2. Issue 4.0.2: FalkorDBAdapter (blocks 4.0.3, 4.0.4, 4.0.5)
3. Issue 4.0.4: Docker Compose Update (can parallel with 4.0.3)
4. Issue 4.0.3: Data Migration Tooling
5. Issue 4.0.5: Test Suite Migration
6. Issue 4.0.6: Documentation
7. Issue 4.0.7: Neo4j Removal (final cleanup)
