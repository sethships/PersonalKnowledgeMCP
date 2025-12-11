# Docker Operations Guide

Comprehensive guide for managing Docker services in the Personal Knowledge MCP project.

## Overview

The Personal Knowledge MCP uses Docker Compose to manage containerized storage backends. This phased approach keeps the architecture clean while supporting future expansion.

### Containerized Services

**Phase 1 (Current):**
- **ChromaDB** - Vector database for semantic search
- Port: 8000
- Volume: `chromadb-data`

**Phase 2 (Future):**
- **PostgreSQL** - Document store for full artifacts (commented in docker-compose.yml)

**Phase 4 (Future):**
- **Neo4j** - Graph database for relationships (commented in docker-compose.yml)

### Why MCP Service Runs on Host

The MCP service uses stdio transport to communicate with Claude Code, which requires it to run as a native process on the host machine rather than in a container. Only the storage backends are containerized.

For architecture details, see [Phase 1 System Design Document](architecture/Phase1-System-Design-Document.md).

## Prerequisites

### Windows Development Environment

- **Docker Desktop for Windows** (v4.0+)
  - Download: https://www.docker.com/products/docker-desktop/
  - Enable WSL2 backend (recommended for performance)
  - Minimum 4GB RAM allocated to Docker
  - Minimum 20GB disk space

- **WSL2** (recommended)
  - Significantly better I/O performance for volumes
  - Installation: `wsl --install` in PowerShell as Administrator
  - Docker Desktop will auto-configure WSL2 integration

### System Requirements

- **RAM:** Minimum 8GB system RAM (4GB for Docker, 4GB for host)
- **Disk:** 20GB free space (10GB for images/volumes, 10GB for builds)
- **CPU:** 2+ cores (4+ recommended)

### Verifying Installation

```bash
# Check Docker is installed and running
docker --version
# Expected: Docker version 20.10+ or newer

# Check Docker Compose
docker-compose --version
# Expected: Docker Compose version v2.0+ or newer

# Verify Docker is running
docker ps
# Expected: CONTAINER ID column headers (empty list is fine)
```

## Quick Start

### Starting All Services

```bash
# From project root
docker-compose up -d
```

**What this does:**
- Creates custom network `pk-mcp-network` (if not exists)
- Creates named volume `chromadb-data` (if not exists)
- Pulls ChromaDB image (first run only)
- Starts ChromaDB container in detached mode
- Port 8000 mapped to host

**Expected output:**
```
Network personalknowledgemcp_pk-mcp-network  Created
Volume personalknowledgemcp_chromadb-data  Created
Container pk-mcp-chromadb  Created
Container pk-mcp-chromadb  Started
```

### Viewing Logs

```bash
# Follow logs in real-time
docker-compose logs -f

# View recent logs only
docker-compose logs --tail=50

# Logs for specific service
docker-compose logs chromadb

# Logs with timestamps
docker-compose logs -f --timestamps
```

### Stopping Services

```bash
# Stop but preserve data
docker-compose down

# Stop and remove volumes (DESTRUCTIVE - deletes all data)
docker-compose down -v
```

## Service Details

### ChromaDB (Phase 1 - Active)

**Purpose:** Vector database for semantic similarity search on code embeddings.

**Configuration:**
- **Image:** `chromadb/chroma:latest`
- **Container Name:** `pk-mcp-chromadb`
- **Port:** `8000:8000` (HTTP API)
- **Volume:** `chromadb-data:/chroma/chroma`
- **Network:** `pk-mcp-network` (bridge mode)
- **Restart Policy:** `unless-stopped`

**Environment Variables:**
- `IS_PERSISTENT=TRUE` - Enable data persistence
- `ANONYMIZED_TELEMETRY=FALSE` - Disable telemetry
- `ALLOW_RESET=TRUE` - Allow database reset (development convenience)

**Health Monitoring:**
```bash
# Check if container is running
docker ps | grep pk-mcp-chromadb

# Test API endpoint from host
curl http://localhost:8000/api/v2/heartbeat
# Expected: {"nanosecond heartbeat": <timestamp>}

# Check container health (if configured)
docker inspect pk-mcp-chromadb --format='{{.State.Status}}'
# Expected: running
```

**Note:** Health check removed from docker-compose.yml because ChromaDB container doesn't include curl/wget. Monitor health by checking the API endpoint from the host or verifying container status with `docker ps`.

## Common Operations

### Service Management

#### Start Single Service

```bash
docker-compose up -d chromadb
```

#### View Service Status

```bash
# All services
docker-compose ps

# Detailed status
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

#### Restart Service

```bash
# Restart specific service
docker-compose restart chromadb

# Restart all services
docker-compose restart
```

#### Stop Single Service

```bash
docker-compose stop chromadb
```

#### Execute Commands in Container

```bash
# Interactive shell
docker exec -it pk-mcp-chromadb bash

# Run single command
docker exec pk-mcp-chromadb ps aux

# Note: ChromaDB container is minimal - limited tools available
```

### Viewing Container Information

#### Container Logs

```bash
# Last 100 lines
docker-compose logs --tail=100 chromadb

# Since specific time
docker-compose logs --since="2024-12-10T18:00:00"

# Follow logs from now
docker-compose logs -f chromadb
```

#### Container Stats (Real-time)

```bash
# All containers
docker stats

# Specific container
docker stats pk-mcp-chromadb

# One-shot stats (no streaming)
docker stats --no-stream
```

#### Container Inspection

```bash
# Full container details (JSON)
docker inspect pk-mcp-chromadb

# Specific fields
docker inspect pk-mcp-chromadb --format='{{.State.Status}}'
docker inspect pk-mcp-chromadb --format='{{.NetworkSettings.IPAddress}}'
docker inspect pk-mcp-chromadb --format='{{range .Mounts}}{{.Source}} -> {{.Destination}}{{end}}'
```

## Data Management

### Volume Operations

#### List Volumes

```bash
# All volumes
docker volume ls

# Project volumes only
docker volume ls | grep chromadb
```

#### Inspect Volume

```bash
docker volume inspect personalknowledgemcp_chromadb-data
```

**Output shows:**
- Driver: `local`
- Mountpoint: Physical location on host (WSL2 path on Windows)
- Labels and metadata

#### Volume Backup

**Create Backup:**

```bash
# Backup to compressed archive
docker run --rm \
  -v personalknowledgemcp_chromadb-data:/data:ro \
  -v "$(pwd)":/backup \
  alpine \
  tar czf /backup/chromadb-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

**What this does:**
1. Runs temporary Alpine Linux container
2. Mounts ChromaDB volume as read-only
3. Mounts current directory for backup output
4. Creates timestamped compressed archive
5. Container auto-removes after completion

**Expected output:**
```
chromadb-backup-20241210-183000.tar.gz
```

#### Volume Restore

**Prerequisites:**
- Stop ChromaDB container
- Have backup archive file

**Restore Process:**

```bash
# 1. Stop container
docker-compose stop chromadb

# 2. Clear existing data (OPTIONAL - DESTRUCTIVE)
docker run --rm \
  -v personalknowledgemcp_chromadb-data:/data \
  alpine \
  sh -c "rm -rf /data/*"

# 3. Restore from backup
docker run --rm \
  -v personalknowledgemcp_chromadb-data:/data \
  -v "$(pwd)":/backup:ro \
  alpine \
  tar xzf /backup/chromadb-backup-20241210-183000.tar.gz -C /data

# 4. Restart container
docker-compose up -d chromadb
```

#### Clean Reset (Delete All Data)

**WARNING:** This permanently deletes all vector embeddings, collections, and metadata.

```bash
# Stop services and remove volumes
docker-compose down -v

# Verify volumes removed
docker volume ls | grep chromadb
# Expected: No output

# Restart fresh
docker-compose up -d
```

### Network Operations

#### Inspect Network

```bash
docker network inspect personalknowledgemcp_pk-mcp-network
```

**Shows:**
- Connected containers
- IP address assignments
- Network driver (bridge)
- Subnet configuration

#### Test Network Connectivity

```bash
# From host to container
curl http://localhost:8000/api/v2/heartbeat

# From one container to another (Phase 2+)
docker exec pk-mcp-chromadb ping pk-mcp-postgres
```

## Troubleshooting

### Container Won't Start

**Symptoms:**
- `docker-compose up` fails
- Container immediately exits
- Error messages in `docker-compose logs`

**Diagnosis:**

```bash
# Check if Docker Desktop is running
docker ps
# If error: Start Docker Desktop

# Check port conflicts
netstat -an | grep 8000
# If port in use: Stop conflicting service or change port in docker-compose.yml

# View detailed error logs
docker-compose up
# (without -d flag to see errors in foreground)

# Check Docker Desktop resources
# Settings → Resources → Ensure adequate RAM/disk allocated
```

**Common Fixes:**

**Port 8000 already in use:**
```yaml
# In docker-compose.yml, change port mapping
ports:
  - "8001:8000"  # Map to different host port
```

**Insufficient resources:**
- Docker Desktop → Settings → Resources
- Increase RAM allocation (minimum 4GB)
- Increase disk space (minimum 20GB)

**Permission issues:**
```bash
# Windows: Run Docker Desktop as Administrator
# Or: Reset Docker to factory defaults (Settings → Troubleshoot → Reset)
```

### API Not Responding

**Symptoms:**
- `curl http://localhost:8000/api/v2/heartbeat` fails
- Connection refused or timeout errors

**Diagnosis:**

```bash
# Verify container is running
docker ps | grep pk-mcp-chromadb
# Expected: Status shows "Up X seconds"

# Check container logs for errors
docker-compose logs chromadb

# Verify port mapping
docker port pk-mcp-chromadb
# Expected: 8000/tcp -> 0.0.0.0:8000

# Test from inside container (if tools available)
docker exec pk-mcp-chromadb wget -O- http://localhost:8000/api/v2/heartbeat
```

**Common Fixes:**

**Wait for initialization:**
```bash
# ChromaDB takes 10-30 seconds to fully start
sleep 30
curl http://localhost:8000/api/v2/heartbeat
```

**Restart container:**
```bash
docker-compose restart chromadb
sleep 20
curl http://localhost:8000/api/v2/heartbeat
```

**Network issue:**
```bash
# Recreate network
docker-compose down
docker network prune -f
docker-compose up -d
```

### Data Not Persisting

**Symptoms:**
- Collections disappear after container restart
- Fresh database after `docker-compose down && docker-compose up`

**Diagnosis:**

```bash
# Verify volume exists
docker volume ls | grep chromadb
# Expected: personalknowledgemcp_chromadb-data

# Check volume mount
docker inspect pk-mcp-chromadb --format='{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
# Expected: chromadb-data -> /chroma/chroma

# Verify data in volume
docker run --rm \
  -v personalknowledgemcp_chromadb-data:/data:ro \
  alpine \
  ls -lah /data
```

**Common Fixes:**

**Using `-v` flag:**
```bash
# DON'T use -v flag when stopping
docker-compose down  # ✅ Preserves data
docker-compose down -v  # ❌ DELETES all volumes
```

**Volume not mounted:**
```yaml
# Verify in docker-compose.yml:
volumes:
  - chromadb-data:/chroma/chroma  # Must match volume name defined at bottom
```

### Performance Issues

**Symptoms:**
- Slow API responses
- High CPU/memory usage
- Disk I/O bottlenecks

**Diagnosis:**

```bash
# Monitor resource usage
docker stats pk-mcp-chromadb

# Check disk I/O
docker exec pk-mcp-chromadb df -h

# View process list
docker exec pk-mcp-chromadb ps aux
```

**Common Fixes:**

**Enable WSL2 backend (Windows):**
- Docker Desktop → Settings → General
- Enable "Use the WSL 2 based engine"
- Restart Docker Desktop
- Significant performance improvement for file I/O

**Increase Docker resources:**
- Docker Desktop → Settings → Resources
- Increase CPU count (4+ cores recommended)
- Increase RAM (6-8GB for moderate workloads)

**Optimize WSL2 memory:**
```ini
# Create/edit %USERPROFILE%\.wslconfig
[wsl2]
memory=6GB
processors=4
```

**Check disk space:**
```bash
# Host disk space
df -h

# Docker disk space
docker system df

# Clean up unused resources
docker system prune -a --volumes
# WARNING: Removes ALL unused images, containers, volumes
```

### Container Logs Show Errors

**Common Error Patterns:**

**"Port already allocated":**
```
Error: Cannot start service chromadb: Ports are not available: exposing port TCP 0.0.0.0:8000 -> 0.0.0.0:0: listen tcp 0.0.0.0:8000: bind: address already in use
```

**Fix:**
```bash
# Find process using port 8000
netstat -ano | findstr :8000

# Stop the conflicting process
# Or change port in docker-compose.yml
```

**"No space left on device":**
```
Error: Failed to create volume: Error response from daemon: No space left on device
```

**Fix:**
```bash
# Check Docker disk usage
docker system df

# Clean up
docker system prune -a --volumes

# Increase Docker Desktop disk allocation
# Settings → Resources → Disk image size
```

## Development vs Production

### Development (Current Setup)

**Use docker-compose.yml:**

```bash
docker-compose up -d
```

**Characteristics:**
- Local development on Windows/macOS/Linux
- Easy start/stop for testing
- Data persists across restarts (unless using `-v`)
- Suitable for single-developer use
- No load balancing or high availability

### Production (Phase 4+)

**Use Kubernetes manifests:**

```bash
kubectl apply -f kubernetes/
```

**Characteristics:**
- Multi-node deployment
- Auto-scaling based on load
- High availability with replica sets
- Persistent volumes with cloud storage backends
- Service discovery and load balancing
- Monitoring with Prometheus/Grafana

**See:** `kubernetes/` directory for production deployment manifests (Phase 4)

### CI/CD Integration

**GitHub Actions (.github/workflows/ci.yml):**

Integration tests with ChromaDB are currently disabled (commented out) pending test implementation. When enabled:

```yaml
- name: Start ChromaDB
  run: docker-compose up -d chromadb

- name: Wait for ChromaDB health
  run: |
    timeout 60 bash -c 'until curl -f http://localhost:8000/api/v2/heartbeat; do sleep 2; done'

- name: Run integration tests
  run: bun test tests/integration/

- name: Stop ChromaDB
  run: docker-compose down -v
  if: always()
```

**Key practices:**
- Always use `docker-compose down -v` in cleanup
- Wait for service health before running tests
- Use `if: always()` to ensure cleanup runs even on test failure

## Security Considerations

### Network Isolation

**Custom Bridge Network:**

ChromaDB runs in isolated `pk-mcp-network` bridge network:
- Services only accessible from host by default
- Future services (PostgreSQL, Neo4j) will share this network
- MCP service on host connects via localhost:8000

**Port Exposure:**
- Only port 8000 is exposed to host
- No direct internet exposure by default
- Use VPN/Tailscale for remote access (recommended)
- For public exposure, add reverse proxy with authentication

### Environment Variable Management

**Sensitive configuration:**
```bash
# NEVER commit .env files to git
# ✅ Use .env.example as template
cp .env.example .env
# Edit .env with actual credentials
```

**Docker Compose reads .env automatically:**
```yaml
environment:
  - CHROMADB_AUTH_PROVIDER=${CHROMADB_AUTH_PROVIDER:-none}
  - CHROMADB_AUTH_CREDENTIALS=${CHROMADB_AUTH_CREDENTIALS}
```

### Volume Permissions

**Default permissions:**
- Volumes created with Docker daemon user ownership
- Files accessible from containers by default
- Host access may require elevated permissions

**Windows with WSL2:**
- Volume data stored in WSL2 filesystem
- Access via: `\\wsl$\docker-desktop-data\version-pack-data\community\docker\volumes\`

**Permission best practices:**
- Don't manually modify volume data from host
- Use `docker exec` or backup/restore procedures
- Avoid running Docker as root (Linux)

### Secrets Management

**Phase 1 (Current):**
- No authentication on ChromaDB (local development only)
- Telemetry disabled to prevent data leakage

**Phase 2+:**
- Enable ChromaDB authentication with token-based auth
- Use Docker secrets for production deployments
- Rotate credentials regularly

**Example with secrets (future):**
```yaml
chromadb:
  environment:
    - CHROMADB_AUTH_PROVIDER=token
    - CHROMADB_AUTH_CREDENTIALS_FILE=/run/secrets/chromadb_token
  secrets:
    - chromadb_token

secrets:
  chromadb_token:
    file: ./secrets/chromadb_token.txt
```

## Future Services (Phase 2+)

### PostgreSQL (Phase 2)

**Purpose:** Document store for full file artifacts and metadata.

**Uncomment in docker-compose.yml:**
```yaml
postgres:
  image: postgres:17.2-alpine
  container_name: pk-mcp-postgres
  ports:
    - "5432:5432"
  volumes:
    - postgres-data:/var/lib/postgresql/data
  environment:
    - POSTGRES_USER=${POSTGRES_USER:-pk_mcp_user}
    - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
    - POSTGRES_DB=${POSTGRES_DATABASE:-personal_knowledge}
  networks:
    - pk-mcp-network
  restart: unless-stopped
```

**Add volume definition:**
```yaml
volumes:
  postgres-data:
    driver: local
```

### Neo4j (Phase 4)

**Purpose:** Graph database for code dependencies and knowledge relationships.

**Uncomment in docker-compose.yml:**
```yaml
neo4j:
  image: neo4j:5.25.1-community
  container_name: pk-mcp-neo4j
  ports:
    - "7474:7474"  # HTTP
    - "7687:7687"  # Bolt
  volumes:
    - neo4j-data:/data
    - neo4j-logs:/logs
  environment:
    - NEO4J_AUTH=${NEO4J_USER:-neo4j}/${NEO4J_PASSWORD:-changeme}
    - NEO4J_ACCEPT_LICENSE_AGREEMENT=yes
  networks:
    - pk-mcp-network
  restart: unless-stopped
```

**Add volume definitions:**
```yaml
volumes:
  neo4j-data:
    driver: local
  neo4j-logs:
    driver: local
```

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [ChromaDB Documentation](https://docs.trychroma.com/)
- [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
- [WSL2 Installation Guide](https://learn.microsoft.com/en-us/windows/wsl/install)

---

**For project-specific details:**
- [High-Level PRD](High-level-Personal-Knowledge-MCP-PRD.md)
- [Phase 1 System Design](architecture/Phase1-System-Design-Document.md)
- [README - Getting Started](../README.md#getting-started)
