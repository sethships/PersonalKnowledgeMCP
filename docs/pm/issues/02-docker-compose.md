# [Infrastructure] Docker Compose Configuration for ChromaDB

## Description

Create Docker Compose configuration to run ChromaDB as a containerized vector database. This provides the persistent storage layer for code embeddings.

## Requirements

From PRD Section "Docker Compose Configuration" and SDD Section 13.1:
- ChromaDB container with persistent volume
- Health check configuration
- Proper port mapping (8000)
- Data persistence across restarts

## Acceptance Criteria

- [ ] `docker-compose.yml` created at project root
- [ ] ChromaDB service configured with:
  - Image: `chromadb/chroma:latest`
  - Container name: `pk-mcp-chromadb`
  - Port mapping: `8000:8000`
  - Volume mount for persistence
  - Health check endpoint configured
  - Telemetry disabled (`ANONYMIZED_TELEMETRY=FALSE`)
  - Persistence enabled (`IS_PERSISTENT=TRUE`)
  - Restart policy: `unless-stopped`
- [ ] Named volume `chromadb-data` created
- [ ] `docker-compose up -d` starts ChromaDB successfully
- [ ] ChromaDB health endpoint responds: `http://localhost:8000/api/v1/heartbeat`
- [ ] Data persists after `docker-compose down` and `docker-compose up`
- [ ] `docker-compose down -v` cleanly removes volume (documented)

## Technical Notes

### Docker Compose Configuration (from SDD 13.1)

```yaml
version: '3.8'

services:
  chromadb:
    image: chromadb/chroma:latest
    container_name: pk-mcp-chromadb
    ports:
      - "8000:8000"
    volumes:
      - chromadb-data:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE
      - ANONYMIZED_TELEMETRY=FALSE
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/heartbeat"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

volumes:
  chromadb-data:
    driver: local
```

### Windows Docker Desktop Notes
- Ensure Docker Desktop is running before `docker-compose up`
- WSL2 backend recommended for performance
- Volume path uses Docker-managed location

### Verification Commands
```bash
# Start ChromaDB
docker-compose up -d

# Check health
curl http://localhost:8000/api/v1/heartbeat

# View logs
docker-compose logs chromadb

# Stop (preserve data)
docker-compose down

# Stop and remove data
docker-compose down -v
```

## Testing Requirements

- [ ] ChromaDB container starts within 30 seconds
- [ ] Health check passes within 60 seconds of container start
- [ ] Can connect from Node.js chromadb client
- [ ] Data survives container restart

## Definition of Done

- [ ] `docker-compose.yml` committed
- [ ] Documentation for starting/stopping ChromaDB added to README
- [ ] Verified on Windows with Docker Desktop
- [ ] Health check verified

## Size Estimate

**Size:** S (Small) - 2-3 hours

## Dependencies

- #1 Project Setup (for package.json with chromadb client)

## Blocks

- #3 ChromaDB Storage Client

## Labels

phase-1, P0, infrastructure
