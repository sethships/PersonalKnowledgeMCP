# Docker Operations Guide

Comprehensive guide for managing Docker services in the Personal Knowledge MCP project.

## Overview

The Personal Knowledge MCP uses Docker Compose to manage containerized storage backends. This phased approach keeps the architecture clean while supporting future expansion.

### Containerized Services

**Phase 2 (Current - Hardened):**
- **ChromaDB** - Vector database for semantic search
  - Image: `chromadb/chroma:0.6.3` (pinned version)
  - Port: `127.0.0.1:8000` (localhost only)
  - Volume: `chromadb-data`
  - Resource limits: 2 CPU / 2GB RAM max
  - Health checks enabled
  - Log rotation configured

**Phase 2 (Next):**
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

### ChromaDB (Phase 2 - Production Hardened)

**Purpose:** Vector database for semantic similarity search on code embeddings.

**Configuration:**
- **Image:** `chromadb/chroma:0.6.3` (pinned stable version)
- **Container Name:** `pk-mcp-chromadb`
- **Port:** `127.0.0.1:8000:8000` (HTTP API - localhost only for security)
- **Volume:** `chromadb-data:/chroma/chroma`
- **Network:** `pk-mcp-network` (bridge mode)
- **Restart Policy:** `unless-stopped`

**Resource Limits:**
- **CPU Limit:** 2 cores maximum
- **Memory Limit:** 2GB maximum
- **CPU Reserved:** 0.5 cores minimum
- **Memory Reserved:** 512MB minimum

**Environment Variables:**
- `IS_PERSISTENT=TRUE` - Enable data persistence
- `ANONYMIZED_TELEMETRY=FALSE` - Disable telemetry
- `ALLOW_RESET=FALSE` - Prevent accidental data deletion in production

**Health Check:**
The container includes an automated health check that:
- Tests the `/api/v2/heartbeat` endpoint every 30 seconds
- Allows 40 seconds for initial startup
- Times out after 10 seconds per check
- Retries 3 times before marking unhealthy

```bash
# View container health status
docker ps --format "table {{.Names}}\t{{.Status}}"
# Expected: pk-mcp-chromadb   Up X minutes (healthy)

# Check detailed health status
docker inspect pk-mcp-chromadb --format='{{.State.Health.Status}}'
# Expected: healthy

# View health check logs
docker inspect pk-mcp-chromadb --format='{{range .State.Health.Log}}{{.Output}}{{end}}'
```

**Logging Configuration:**
- **Driver:** json-file (structured logging)
- **Max Size:** 10MB per log file
- **Max Files:** 3 (automatic rotation)

```bash
# View logs with rotation info
docker inspect pk-mcp-chromadb --format='{{.HostConfig.LogConfig}}'

# Log files location (Docker manages automatically)
docker logs pk-mcp-chromadb
```

**Manual Health Monitoring:**
```bash
# Check if container is running
docker ps | grep pk-mcp-chromadb

# Test API endpoint from host
curl http://localhost:8000/api/v2/heartbeat
# Expected: {"nanosecond heartbeat": <timestamp>}

# Check resource usage
docker stats pk-mcp-chromadb --no-stream
```

**Security Notes:**
- Port is bound to `127.0.0.1` only - not accessible from network
- `ALLOW_RESET=FALSE` prevents accidental data deletion via API
- Use VPN/Tailscale for remote access if needed

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

# Since relative time (last hour)
docker-compose logs --since="1h"

# Since specific time (if needed)
docker-compose logs --since="2024-01-01T00:00:00"

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

#### Volume Backup and Restore

For automated backup and restore operations with retention policies, use the scripts in the `scripts/` directory. See [Backup and Restore Automation](#backup-and-restore-automation) section for detailed usage.

**Quick Commands:**

```bash
# Create backup with 30-day retention (Bash)
./scripts/backup-chromadb.sh

# Create backup with 30-day retention (PowerShell)
.\scripts\backup-chromadb.ps1

# Restore from backup (Bash)
./scripts/restore-chromadb.sh ./backups/chromadb-backup-YYYYMMDD-HHMMSS.tar.gz

# Restore from backup (PowerShell)
.\scripts\restore-chromadb.ps1 -BackupFile ".\backups\chromadb-backup-YYYYMMDD-HHMMSS.tar.gz"
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
- Services only accessible from localhost by default
- Future services (PostgreSQL, Neo4j) will share this network
- MCP service on host connects via localhost:8000

**Localhost-Only Port Binding (Phase 2 Security):**
- Port 8000 is bound to `127.0.0.1` only - not exposed to network interfaces
- This prevents access from other machines on the local network
- Even without a firewall, the service is inaccessible from outside the host
- This is the recommended configuration for development and single-user production

**Remote Access Options:**
- Use VPN/Tailscale for secure remote access (recommended)
- For multi-user or public exposure, add reverse proxy with authentication
- Never bind to `0.0.0.0` in production without authentication

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

## Backup and Restore Automation

The `scripts/` directory contains automated backup and restore scripts with retention policies for ChromaDB data volumes. These scripts support both Bash (Linux, WSL, Git Bash) and PowerShell (Windows) environments.

### Available Scripts

| Script | Description |
|--------|-------------|
| `backup-chromadb.sh` | Bash backup script with retention policy |
| `backup-chromadb.ps1` | PowerShell backup script |
| `restore-chromadb.sh` | Bash restore script with confirmation |
| `restore-chromadb.ps1` | PowerShell restore script |
| `test-backup-restore.sh` | Verification test script |

### Creating Backups

**Bash (Linux/WSL/Git Bash):**
```bash
# Basic usage - creates backup in ./backups with 30-day retention
./scripts/backup-chromadb.sh

# Custom backup directory and retention
./scripts/backup-chromadb.sh --backup-dir /mnt/backups --retention 7

# Using environment variables
BACKUP_DIR=/backups RETENTION_DAYS=14 ./scripts/backup-chromadb.sh
```

**PowerShell (Windows):**
```powershell
# Basic usage
.\scripts\backup-chromadb.ps1

# Custom backup directory and retention
.\scripts\backup-chromadb.ps1 -BackupDir "D:\Backups" -RetentionDays 7

# Quiet mode (minimal output)
.\scripts\backup-chromadb.ps1 -Quiet
```

**Backup Features:**
- Automatic volume detection (finds ChromaDB volume)
- Timestamped archives: `chromadb-backup-YYYYMMDD-HHMMSS.tar.gz`
- Configurable retention policy (default: 30 days)
- Cross-platform compatibility
- Exit codes for scripting integration

### Restoring from Backup

**Bash (Linux/WSL/Git Bash):**
```bash
# Interactive restore (prompts for confirmation)
./scripts/restore-chromadb.sh ./backups/chromadb-backup-20241221-120000.tar.gz

# Non-interactive restore (skip confirmation)
./scripts/restore-chromadb.sh ./backups/chromadb-backup-20241221-120000.tar.gz --yes
```

**PowerShell (Windows):**
```powershell
# Interactive restore
.\scripts\restore-chromadb.ps1 -BackupFile ".\backups\chromadb-backup-20241221-120000.tar.gz"

# Non-interactive restore
.\scripts\restore-chromadb.ps1 -BackupFile ".\backups\chromadb-backup-20241221-120000.tar.gz" -Force
```

**Restore Process:**
1. Validates backup file exists and is readable
2. Prompts for confirmation (unless `--yes`/`-Force` flag)
3. Stops ChromaDB container
4. Clears existing volume data
5. Extracts backup to volume
6. Restarts container and waits for health
7. Provides verification commands

### Verifying Backup/Restore

Run the verification test script to ensure backup and restore work correctly:

```bash
# Run full verification test
./scripts/test-backup-restore.sh

# Verbose output
./scripts/test-backup-restore.sh --verbose

# Keep test artifacts for inspection
./scripts/test-backup-restore.sh --keep
```

**Test Process:**
1. Verifies ChromaDB is running
2. Creates test collection with sample data
3. Creates backup
4. Deletes test collection (simulates data loss)
5. Restores from backup
6. Verifies data integrity
7. Cleans up test artifacts

### Scheduled Backups

**Linux/macOS (cron):**
```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/project/scripts/backup-chromadb.sh --quiet >> /var/log/chromadb-backup.log 2>&1
```

**Windows (Task Scheduler):**
```powershell
# Create scheduled task for daily backup at 2 AM
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\path\to\project\scripts\backup-chromadb.ps1 -Quiet"
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "ChromaDB Daily Backup"
```

### Pre-Upgrade Backup Reminder

**IMPORTANT:** Always create a backup before upgrading ChromaDB or making significant changes:

```bash
# Before any upgrade
./scripts/backup-chromadb.sh --backup-dir ./pre-upgrade-backups

# Verify backup was created
ls -la ./pre-upgrade-backups/

# Then proceed with upgrade
docker-compose pull chromadb
docker-compose up -d chromadb
```

### Disaster Recovery Procedure

In case of data loss or corruption:

1. **Stop the service** (if not already stopped):
   ```bash
   docker-compose stop chromadb
   ```

2. **Identify latest backup**:
   ```bash
   ls -lt ./backups/chromadb-backup-*.tar.gz | head -5
   ```

3. **Restore from backup**:
   ```bash
   ./scripts/restore-chromadb.sh ./backups/chromadb-backup-YYYYMMDD-HHMMSS.tar.gz --yes
   ```

4. **Verify restoration**:
   ```bash
   curl http://localhost:8000/api/v2/heartbeat
   curl http://localhost:8000/api/v2/collections
   ```

5. **Document the incident** for future reference.

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
