# Docker Operations Guide

> **Note:** This guide is being updated for the FalkorDB migration. Some sections still reference Neo4j.
> The graph database has been migrated from Neo4j to FalkorDB. See [Migration Guide](graph-database-migration.md) for details.
> Neo4j-specific backup/restore scripts will be replaced with FalkorDB equivalents in a future update.

Comprehensive operations runbook for managing Docker services in the Personal Knowledge MCP project. This guide covers daily operations, troubleshooting, backup/restore procedures, upgrades, and monitoring.

## Overview

The Personal Knowledge MCP uses Docker Compose to manage containerized storage backends. All core storage services are production-ready.

### Containerized Services

**Production (V1.0):**
- **ChromaDB** - Vector database for semantic search
  - Image: `chromadb/chroma:0.6.3` (pinned version)
  - Port: `127.0.0.1:8000` (localhost only)
  - Volume: `chromadb-data`
  - Resource limits: 2 CPU / 2GB RAM max
  - Health checks enabled
  - Log rotation configured

- **FalkorDB** - Graph database for code relationships and dependencies
  - Image: `falkordb/falkordb:v4.4.1` (pinned version)
  - Port: `127.0.0.1:6380` (Redis protocol)
  - Volume: `falkordb-data`
  - Resource limits: 2 CPU / 2GB RAM max
  - Health checks enabled

**Configured (Phase 4):**
- **PostgreSQL** - Document store for full artifacts
  - Image: `postgres:17.2-alpine` (pinned version)
  - Port: `127.0.0.1:5432` (localhost only)
  - Volume: `postgres-data`
  - Resource limits: 2 CPU / 1GB RAM max
  - Health checks enabled (pg_isready)
  - Init scripts: `./init-scripts:/docker-entrypoint-initdb.d`

### Why MCP Service Runs on Host

The MCP service uses stdio transport to communicate with Claude Code, which requires it to run as a native process on the host machine rather than in a container. Only the storage backends are containerized.

For architecture details, see:
- [Phase 1 System Design Document](architecture/Phase1-System-Design-Document.md)
- [Docker Containerization PRD](pm/Docker-Containerization-PRD.md)

---

## Quick Reference Commands

This section provides commonly-used commands for daily operations. For detailed explanations, see the relevant sections below.

### Service Lifecycle

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d chromadb

# Stop all services (preserve data)
docker-compose down

# Stop specific service
docker-compose stop chromadb

# Restart service
docker-compose restart chromadb

# Stop and DELETE all data (DESTRUCTIVE)
docker-compose down -v
```

### Health Checks

```bash
# Quick status check
docker-compose ps

# Detailed health status
docker ps --format "table {{.Names}}\t{{.Status}}"

# ChromaDB API health
curl http://localhost:8000/api/v2/heartbeat

# PostgreSQL health
docker-compose exec postgres pg_isready -U pk_mcp -d personal_knowledge

# Container health details
docker inspect pk-mcp-chromadb --format='{{.State.Health.Status}}'
```

### Logs

```bash
# Follow all logs
docker-compose logs -f

# Last 50 lines from specific service
docker-compose logs --tail=50 chromadb

# Logs with timestamps
docker-compose logs -f --timestamps

# Logs since last hour
docker-compose logs --since="1h"
```

### Backup and Restore

```bash
# ChromaDB backup (Bash)
./scripts/backup-chromadb.sh

# ChromaDB backup (PowerShell)
.\scripts\backup-chromadb.ps1

# ChromaDB restore (Bash)
./scripts/restore-chromadb.sh ./backups/chromadb-backup-YYYYMMDD-HHMMSS.tar.gz

# ChromaDB restore (PowerShell)
.\scripts\restore-chromadb.ps1 -BackupFile ".\backups\chromadb-backup-YYYYMMDD-HHMMSS.tar.gz"

# Neo4j backup (Bash) - stops container for consistent backup
./scripts/backup-neo4j.sh

# Neo4j backup (PowerShell)
.\scripts\backup-neo4j.ps1

# Neo4j restore (Bash)
./scripts/restore-neo4j.sh ./backups/neo4j-backup-YYYYMMDD-HHMMSS.tar.gz

# Neo4j restore (PowerShell)
.\scripts\restore-neo4j.ps1 -BackupFile ".\backups\neo4j-backup-YYYYMMDD-HHMMSS.tar.gz"

# List available backups
ls -lt ./backups/chromadb-backup-*.tar.gz | head -5
ls -lt ./backups/neo4j-backup-*.tar.gz | head -5
```

### Monitoring

```bash
# Real-time resource usage
docker stats

# One-shot resource stats
docker stats --no-stream

# Disk usage summary
docker system df

# Volume inspection
docker volume ls | grep -E "(chromadb|postgres)"
```

### Troubleshooting

```bash
# Check if Docker is running
docker info > /dev/null 2>&1 && echo "Docker OK" || echo "Docker not running"

# Check port availability
netstat -an | grep -E ":(8000|5432)"

# Enter container shell
docker exec -it pk-mcp-chromadb bash

# View container processes
docker exec pk-mcp-chromadb ps aux

# Full container inspection
docker inspect pk-mcp-chromadb
```

---

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
docker-compose logs --since="YYYY-MM-DDT00:00:00"

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

---

## Troubleshooting

This section provides diagnostic procedures for common issues with containerized services.

### Health Check Failure Debugging

When a container reports unhealthy status, use this diagnostic decision tree:

```
Container shows "unhealthy" or "starting" for extended time
│
├─→ Step 1: Check if container is running
│   $ docker ps -a | grep pk-mcp
│   └─→ If "Exited": See "Container Won't Start" section
│   └─→ If "Up" but unhealthy: Continue to Step 2
│
├─→ Step 2: View health check logs
│   $ docker inspect pk-mcp-chromadb --format='{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}'
│   └─→ Exit code 0 = health check passed
│   └─→ Exit code 1 = health check failed (see output for details)
│   └─→ Exit code 7 = connection refused (service not listening)
│
├─→ Step 3: Test endpoint manually
│   $ curl -v http://localhost:8000/api/v2/heartbeat
│   └─→ "Connection refused": Service not listening on port
│   └─→ "Empty reply": Service starting, wait and retry
│   └─→ HTTP 200: Health check issue, not service issue
│
├─→ Step 4: Check container logs for errors
│   $ docker-compose logs --tail=100 chromadb
│   └─→ Look for: "ERROR", "Exception", "Failed"
│   └─→ Common: Permission errors, disk space, memory limits
│
└─→ Step 5: Verify resources
    $ docker stats pk-mcp-chromadb --no-stream
    └─→ Memory near limit: Increase memory allocation
    └─→ CPU at 100%: Resource contention or infinite loop
```

**ChromaDB-Specific Health Check Issues:**

```bash
# Check if ChromaDB API is responding
curl -s http://localhost:8000/api/v2/heartbeat | jq .

# List collections (validates database functionality)
curl -s http://localhost:8000/api/v2/collections | jq .

# Check internal database status
docker exec pk-mcp-chromadb ls -la /chroma/chroma/
```

**PostgreSQL-Specific Health Check Issues:**

```bash
# Check pg_isready status
docker-compose exec postgres pg_isready -U pk_mcp -d personal_knowledge

# Test database connection
docker-compose exec postgres psql -U pk_mcp -d personal_knowledge -c "SELECT 1;"

# View PostgreSQL logs
docker-compose logs --tail=50 postgres
```

### Volume Permission Issues

Volume permission problems are common, especially on Windows with WSL2.

**Symptoms:**
- Container logs show "Permission denied" errors
- Data not persisting after restart
- Cannot write to mounted volume

**Windows/WSL2 Path Issues:**

```bash
# Check volume mount points
docker inspect pk-mcp-chromadb --format='{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'

# Verify volume exists and has data
docker run --rm -v personalknowledgemcp_chromadb-data:/data:ro alpine ls -la /data

# Check WSL2 filesystem permissions
wsl ls -la /var/lib/docker/volumes/
```

**Common Fixes:**

1. **Reset volume permissions:**
   ```bash
   # Stop container
   docker-compose stop chromadb

   # Fix permissions using alpine container
   docker run --rm -v personalknowledgemcp_chromadb-data:/data alpine chmod -R 755 /data

   # Restart container
   docker-compose start chromadb
   ```

2. **Recreate volume (data loss!):**
   ```bash
   # Backup first!
   ./scripts/backup-chromadb.sh

   # Remove and recreate
   docker-compose down -v
   docker-compose up -d

   # Restore data
   ./scripts/restore-chromadb.sh ./backups/latest-backup.tar.gz
   ```

3. **WSL2 integration issues:**
   ```bash
   # Restart WSL2 (PowerShell as Admin)
   wsl --shutdown

   # Restart Docker Desktop
   # Then restart containers
   docker-compose up -d
   ```

**Git Bash Path Conversion:**

Git Bash on Windows converts Unix paths automatically, which can break Docker volume mounts:

```bash
# Problem: Git Bash converts /data to C:/Program Files/Git/data
docker run -v /data:/container/data alpine ls

# Solution: Use MSYS_NO_PATHCONV environment variable
MSYS_NO_PATHCONV=1 docker run -v /data:/container/data alpine ls

# Or use double slashes
docker run -v //data://container/data alpine ls
```

### Container Restart Loops

When a container continuously restarts, diagnose systematically:

**Symptoms:**
- `docker ps` shows container restarting every few seconds
- Status alternates between "Up" and "Restarting"
- Service never becomes healthy

**Diagnosis Steps:**

```bash
# Step 1: Check restart count
docker inspect pk-mcp-chromadb --format='{{.RestartCount}}'

# Step 2: View exit code from last run
docker inspect pk-mcp-chromadb --format='{{.State.ExitCode}}'
# Exit codes: 0=normal, 1=error, 137=OOM killed, 139=segfault

# Step 3: Check logs from before crash
docker logs pk-mcp-chromadb --tail=200

# Step 4: Check if OOM (Out of Memory) killed
docker inspect pk-mcp-chromadb --format='{{.State.OOMKilled}}'
# true = container was killed due to memory limit

# Step 5: Review events
docker events --filter container=pk-mcp-chromadb --since="1h"
```

**Common Causes and Fixes:**

1. **Memory Exhaustion (Exit 137, OOMKilled=true):**
   ```yaml
   # Increase memory limit in docker-compose.yml
   deploy:
     resources:
       limits:
         memory: 4G  # Was 2G
   ```

2. **Configuration Error (Exit 1):**
   ```bash
   # Check for config issues in logs
   docker logs pk-mcp-chromadb 2>&1 | grep -i "error\|config\|invalid"

   # Validate environment variables
   docker inspect pk-mcp-chromadb --format='{{range .Config.Env}}{{println .}}{{end}}'
   ```

3. **Dependency Not Ready:**
   ```bash
   # Check if dependent services are healthy
   docker-compose ps

   # Add health check dependency in compose file
   depends_on:
     postgres:
       condition: service_healthy
   ```

4. **Corrupt Data:**
   ```bash
   # Backup current state
   ./scripts/backup-chromadb.sh --backup-dir ./corrupt-backup

   # Try clean restart
   docker-compose down -v
   docker-compose up -d

   # If works, selectively restore data
   ```

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

---

## Monitoring and Observability

This section covers log analysis, metrics collection, and observability patterns for containerized services.

### Log Patterns and Interpretation

Understanding log patterns helps quickly identify issues.

**ChromaDB Log Patterns:**

```bash
# Healthy startup sequence
docker-compose logs chromadb 2>&1 | grep -E "(Starting|Running|Ready)"
# Expected: "Running Chroma", "Uvicorn running on http://0.0.0.0:8000"

# Error detection
docker-compose logs chromadb 2>&1 | grep -iE "(error|exception|failed|fatal)"

# Warning detection
docker-compose logs chromadb 2>&1 | grep -iE "(warn|warning)"

# Collection operations
docker-compose logs chromadb 2>&1 | grep -iE "(collection|create|delete)"
```

**PostgreSQL Log Patterns:**

```bash
# Connection events
docker-compose logs postgres 2>&1 | grep -E "(connection|LOG:.*connection)"

# Query errors
docker-compose logs postgres 2>&1 | grep -E "(ERROR|FATAL)"

# Slow queries (if logging enabled)
docker-compose logs postgres 2>&1 | grep -E "duration:"

# Startup/shutdown
docker-compose logs postgres 2>&1 | grep -E "(ready|shutdown|accepting)"
```

**Common Log Patterns to Watch:**

| Pattern | Meaning | Action |
|---------|---------|--------|
| `OOM` or `killed` | Out of memory | Increase memory limit |
| `connection refused` | Service not ready | Wait or check health |
| `permission denied` | File access issue | Check volume permissions |
| `disk full` | No space | Clean up or expand disk |
| `timeout` | Slow response | Check resources, network |
| `authentication failed` | Bad credentials | Verify env variables |

### Structured Log Querying

Extract specific information from logs using structured queries:

```bash
# Get logs in JSON format for parsing
docker logs pk-mcp-chromadb --details 2>&1 | head -50

# Filter logs by time range
docker-compose logs --since="YYYY-MM-DDT00:00:00" --until="YYYY-MM-DDT12:00:00" chromadb

# Count errors in last hour
docker-compose logs --since="1h" chromadb 2>&1 | grep -ci "error"

# Extract timestamps and error messages
docker-compose logs chromadb 2>&1 | grep -E "error|ERROR" | awk '{print $1, $2, $0}'
```

**Using jq for JSON Logs:**

```bash
# If logs are in JSON format
docker logs pk-mcp-chromadb 2>&1 | jq -r 'select(.level == "error") | .message' 2>/dev/null

# Parse health check output
docker inspect pk-mcp-chromadb --format='{{json .State.Health.Log}}' | jq '.[-1]'
```

### Real-Time Monitoring

**Live Resource Dashboard:**

```bash
# Watch all container stats
watch -n 5 'docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"'

# Monitor specific containers
docker stats pk-mcp-chromadb pk-mcp-postgres --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

**Health Status Monitoring:**

```bash
# Continuous health check monitoring
watch -n 10 'docker ps --format "table {{.Names}}\t{{.Status}}" | grep pk-mcp'

# Alert on unhealthy (script example)
while true; do
  STATUS=$(docker inspect pk-mcp-chromadb --format='{{.State.Health.Status}}' 2>/dev/null)
  if [ "$STATUS" != "healthy" ]; then
    echo "ALERT: ChromaDB is $STATUS at $(date)"
  fi
  sleep 30
done
```

### Disk Space Monitoring

```bash
# Docker disk usage breakdown
docker system df -v

# Volume sizes
docker system df --format "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}"

# Monitor volume growth
watch -n 60 'docker run --rm -v personalknowledgemcp_chromadb-data:/data alpine du -sh /data'
```

---

## Upgrade Procedures

This section covers safe upgrade procedures for containerized services with rollback capabilities.

### Pre-Upgrade Checklist

Before upgrading any service, complete this checklist:

- [ ] **Create backup** of all data volumes
- [ ] **Verify backup integrity** by listing backup contents
- [ ] **Document current versions** of all images
- [ ] **Check release notes** for breaking changes
- [ ] **Verify disk space** for new images (minimum 5GB free)
- [ ] **Schedule maintenance window** if production system
- [ ] **Notify users** if applicable
- [ ] **Test upgrade** in non-production environment first

```bash
# Pre-upgrade verification script
echo "=== Pre-Upgrade Checklist ==="

# 1. Create backup
echo "Creating backup..."
./scripts/backup-chromadb.sh --backup-dir ./pre-upgrade-backup

# 2. Verify backup
echo "Verifying backup..."
ls -la ./pre-upgrade-backup/chromadb-backup-*.tar.gz

# 3. Document current versions
echo "Current versions:"
docker-compose images

# 4. Check disk space
echo "Disk space:"
docker system df

# 5. Verify services are healthy
echo "Service health:"
docker-compose ps
```

### ChromaDB Upgrade Steps

**Step 1: Backup Current Data**

```bash
# Create timestamped backup
./scripts/backup-chromadb.sh --backup-dir ./pre-upgrade-backup

# Verify backup was created
ls -la ./pre-upgrade-backup/
```

**Step 2: Update Image Version**

```yaml
# In docker-compose.yml, update version
services:
  chromadb:
    image: chromadb/chroma:0.6.4  # Update from 0.6.3
```

**Step 3: Pull New Image**

```bash
# Pull without starting
docker-compose pull chromadb

# Verify new image downloaded
docker images | grep chromadb
```

**Step 4: Stop Current Container**

```bash
# Graceful stop
docker-compose stop chromadb

# Verify stopped
docker-compose ps chromadb
```

**Step 5: Start with New Image**

```bash
# Start container with new image
docker-compose up -d chromadb

# Watch startup logs
docker-compose logs -f chromadb
```

**Step 6: Verify Upgrade**

```bash
# Wait for healthy status
timeout 60 bash -c 'until docker inspect pk-mcp-chromadb --format="{{.State.Health.Status}}" | grep -q healthy; do sleep 2; done'

# Verify API responds
curl http://localhost:8000/api/v2/heartbeat

# Verify data integrity
curl http://localhost:8000/api/v2/collections

# Check version (if available in API)
curl http://localhost:8000/api/v2/version 2>/dev/null || echo "Version endpoint not available"
```

### PostgreSQL Upgrade Steps

**IMPORTANT:** PostgreSQL major version upgrades require data migration. Minor version upgrades (e.g., 17.2 to 17.3) are simpler.

**Minor Version Upgrade (17.x to 17.y):**

```bash
# 1. Backup (manual - PostgreSQL backup scripts planned for future)
docker-compose exec postgres pg_dump -U pk_mcp personal_knowledge > ./pre-upgrade-backup/postgres-dump.sql

# 2. Update version in docker-compose.yml
# Change: postgres:17.2-alpine → postgres:17.3-alpine

# 3. Pull and restart
docker-compose pull postgres
docker-compose stop postgres
docker-compose up -d postgres

# 4. Verify
docker-compose exec postgres psql -U pk_mcp -d personal_knowledge -c "SELECT version();"
```

**Major Version Upgrade (16.x to 17.x):**

Major version upgrades require `pg_upgrade` or dump/restore:

```bash
# 1. Full backup
docker-compose exec postgres pg_dumpall -U pk_mcp > ./pre-upgrade-backup/postgres-full-dump.sql

# 2. Stop and remove old container
docker-compose stop postgres
docker-compose rm postgres

# 3. Remove old volume (data will be restored)
docker volume rm personalknowledgemcp_postgres-data

# 4. Update version and start
# Change version in docker-compose.yml
docker-compose up -d postgres

# 5. Restore data
docker-compose exec -T postgres psql -U pk_mcp -d postgres < ./pre-upgrade-backup/postgres-full-dump.sql

# 6. Verify
docker-compose exec postgres psql -U pk_mcp -d personal_knowledge -c "SELECT COUNT(*) FROM _schema_info;"
```

### Rollback Procedures

If an upgrade fails, follow these rollback steps:

**ChromaDB Rollback:**

```bash
# 1. Stop the new container
docker-compose stop chromadb

# 2. Revert docker-compose.yml to previous version
# Change: chromadb/chroma:0.6.4 → chromadb/chroma:0.6.3

# 3. Remove the container (not the volume)
docker-compose rm chromadb

# 4. If data is corrupted, restore from backup
./scripts/restore-chromadb.sh ./pre-upgrade-backup/chromadb-backup-YYYYMMDD-HHMMSS.tar.gz

# 5. Start with old version
docker-compose up -d chromadb

# 6. Verify
curl http://localhost:8000/api/v2/heartbeat
```

**PostgreSQL Rollback:**

```bash
# 1. Stop new container
docker-compose stop postgres

# 2. Revert version in docker-compose.yml

# 3. If data migration occurred, restore from backup
docker-compose rm postgres
docker volume rm personalknowledgemcp_postgres-data
docker-compose up -d postgres
docker-compose exec -T postgres psql -U pk_mcp -d postgres < ./pre-upgrade-backup/postgres-full-dump.sql

# 4. Verify
docker-compose exec postgres psql -U pk_mcp -d personal_knowledge -c "SELECT 1;"
```

### Version Pinning Best Practices

Always pin versions to avoid unexpected upgrades:

```yaml
# GOOD: Pinned versions
services:
  chromadb:
    image: chromadb/chroma:0.6.3
  postgres:
    image: postgres:17.2-alpine

# BAD: Floating tags (avoid these)
services:
  chromadb:
    image: chromadb/chroma:latest  # Don't use
  postgres:
    image: postgres:17  # Risky - minor version changes
```

**Version Documentation:**

Maintain a versions file for tracking:

```bash
# Create/update versions record
cat > ./DOCKER_VERSIONS.md << 'EOF'
# Docker Image Versions

| Service    | Current Version      | Last Updated | Notes           |
|------------|---------------------|--------------|-----------------|
| ChromaDB   | chromadb/chroma:0.6.3 | 2025-12-22 | Stable release |
| PostgreSQL | postgres:17.2-alpine  | 2025-12-22 | Phase 2 ready  |
EOF
```

---

## Windows-Specific Notes

This section consolidates Windows-specific considerations for Docker operations.

### Docker Desktop Configuration

**Recommended Settings:**

1. **General:**
   - Enable "Use the WSL 2 based engine" (significant performance improvement)
   - Enable "Start Docker Desktop when you log in" (optional)

2. **Resources:**
   - Memory: 4-6GB minimum (8GB recommended for multiple services)
   - CPUs: 4+ cores recommended
   - Disk image size: 60GB minimum
   - Disk image location: SSD preferred

3. **WSL Integration:**
   - Enable integration with your default WSL2 distro
   - Enable for specific distros you use for development

### WSL2 Memory Configuration

WSL2 can consume excessive memory. Configure limits:

```ini
# Create/edit: %USERPROFILE%\.wslconfig
[wsl2]
memory=6GB
processors=4
swap=2GB
localhostForwarding=true
```

After editing, restart WSL2:
```powershell
wsl --shutdown
```

### Path Handling Differences

**Git Bash Path Conversion:**

Git Bash automatically converts Unix-style paths to Windows paths, which breaks Docker volume mounts:

```bash
# Problem scenario
docker run -v /c/Users/me/data:/data alpine ls
# Git Bash converts /c/Users to C:\Users internally

# Solution 1: MSYS_NO_PATHCONV environment variable
MSYS_NO_PATHCONV=1 docker run -v //c/Users/me/data:/data alpine ls

# Solution 2: Use Windows-style paths with forward slashes
docker run -v "C:/Users/me/data:/data" alpine ls

# Solution 3: Use double slashes
docker run -v "//c/Users/me/data://data" alpine ls
```

**The backup scripts handle this automatically:**
```bash
# In backup-chromadb.sh
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${VOLUME_NAME}:/data:ro" \
  -v "${BACKUP_DIR}:/backup" \
  alpine tar czf "/backup/${backup_file}" -C /data .
```

### PowerShell vs Git Bash

**PowerShell:**
- Native Windows paths work directly
- Use `.ps1` script versions
- Execution policy may need adjustment: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

**Git Bash:**
- Unix-style commands and paths
- Use `.sh` script versions
- Watch for path conversion issues (see above)
- Mintty terminal may have display issues with `docker logs -f`

**Command Differences:**

| Operation | PowerShell | Git Bash |
|-----------|-----------|----------|
| Backup | `.\scripts\backup-chromadb.ps1` | `./scripts/backup-chromadb.sh` |
| Environment vars | `$env:VAR="value"` | `export VAR="value"` |
| Path separator | `\` or `/` | `/` |
| Grep equivalent | `Select-String` | `grep` |
| Find files | `Get-ChildItem -Recurse` | `find` |

### Windows Firewall Considerations

Docker Desktop manages firewall rules automatically, but for localhost binding:

- Ports bound to `127.0.0.1` are NOT accessible from network
- No additional firewall rules needed for localhost-only services
- If binding to `0.0.0.0`, Windows Firewall may prompt

### Hyper-V vs WSL2 Backend

**WSL2 (Recommended):**
- Better file I/O performance
- Lower memory overhead
- Faster container startup
- Linux kernel for better compatibility

**Hyper-V:**
- Required for Windows containers
- More isolation
- Higher resource usage
- Slower file operations with bind mounts

Check current backend:
```powershell
# PowerShell
docker info | Select-String "OSType"
```

### Common Windows Issues

**"Docker Desktop - WSL distro terminated abruptly":**
```powershell
# Restart WSL
wsl --shutdown
# Restart Docker Desktop
```

**"Cannot connect to Docker daemon":**
```powershell
# Ensure Docker Desktop is running
# Check system tray for Docker icon
# Restart Docker Desktop if needed
```

**"Error: volume path invalid":**
```bash
# Check for path conversion issues
# Use MSYS_NO_PATHCONV=1 prefix in Git Bash
# Or use PowerShell with native paths
```

---

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

**Development Mode:**
- No authentication on ChromaDB (local development only)
- Telemetry disabled to prevent data leakage

**Production Mode:**
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

### PostgreSQL (Phase 2 - Ready)

**Purpose:** Document store for full file artifacts and metadata.

**Status:** Configured and ready for use. Already enabled in `docker-compose.yml`.

**Configuration:**
- **Image:** `postgres:17.2-alpine` (pinned stable version)
- **Container Name:** `pk-mcp-postgres`
- **Port:** `127.0.0.1:5432:5432` (localhost only for security)
- **Volume:** `postgres-data:/var/lib/postgresql/data`
- **Init Scripts:** `./init-scripts:/docker-entrypoint-initdb.d:ro`
- **Network:** `pk-mcp-network` (bridge mode)
- **Restart Policy:** `unless-stopped`

**Resource Limits:**
- **CPU Limit:** 2 cores maximum
- **Memory Limit:** 1GB maximum
- **CPU Reserved:** 0.25 cores minimum
- **Memory Reserved:** 256MB minimum

**Environment Variables (from .env):**
- `POSTGRES_USER` - Database user (default: `pk_mcp`)
- `POSTGRES_PASSWORD` - **Required** - Database password (no default, must be set)
- `POSTGRES_DB` - Database name (default: `personal_knowledge`)

**Health Check:**
- Uses `pg_isready` to verify database accepts connections
- Checks every 30 seconds with 10-second timeout
- 3 retries before marking unhealthy
- 30-second start period for initialization

**Starting PostgreSQL:**
```bash
# Set password in .env file first
echo "POSTGRES_PASSWORD=your-secure-password" >> .env

# Start the container
docker-compose up -d postgres

# Check health status
docker-compose ps postgres

# Verify connection
docker-compose exec postgres pg_isready -U pk_mcp -d personal_knowledge
```

**Init Scripts:**

PostgreSQL automatically runs SQL scripts from `./init-scripts/` on first startup:
- Scripts run in alphanumeric order (001-*, 002-*, etc.)
- Currently includes placeholder schema for Phase 2 document store
- Add migration scripts with numbered prefixes as needed

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
| `backup-chromadb.sh` | Bash backup script for ChromaDB with retention policy |
| `backup-chromadb.ps1` | PowerShell backup script for ChromaDB |
| `restore-chromadb.sh` | Bash restore script for ChromaDB with confirmation |
| `restore-chromadb.ps1` | PowerShell restore script for ChromaDB |
| `test-backup-restore.sh` | ChromaDB backup/restore verification test script |
| `backup-neo4j.sh` | Bash backup script for Neo4j with retention policy |
| `backup-neo4j.ps1` | PowerShell backup script for Neo4j |
| `restore-neo4j.sh` | Bash restore script for Neo4j with confirmation |
| `restore-neo4j.ps1` | PowerShell restore script for Neo4j |
| `test-backup-restore-neo4j.sh` | Neo4j backup/restore verification test script |

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

### Neo4j Backup and Restore

The backup scripts for Neo4j follow the same patterns as ChromaDB but with an important difference: Neo4j Community Edition does not support online backups, so the scripts stop the container before creating a backup to ensure data consistency.

#### Creating Neo4j Backups

**Bash (Linux/WSL/Git Bash):**
```bash
# Basic usage - creates backup in ./backups with 30-day retention
./scripts/backup-neo4j.sh

# Custom backup directory and retention
./scripts/backup-neo4j.sh --backup-dir /mnt/backups --retention 7

# Dry-run mode (shows what would happen without making changes)
./scripts/backup-neo4j.sh --dry-run

# Using environment variables
BACKUP_DIR=/backups RETENTION_DAYS=14 ./scripts/backup-neo4j.sh
```

**PowerShell (Windows):**
```powershell
# Basic usage
.\scripts\backup-neo4j.ps1

# Custom backup directory and retention
.\scripts\backup-neo4j.ps1 -BackupDir "D:\Backups" -RetentionDays 7

# Dry-run mode
.\scripts\backup-neo4j.ps1 -DryRun

# Quiet mode (minimal output)
.\scripts\backup-neo4j.ps1 -Quiet
```

**Neo4j Backup Features:**
- Automatic volume detection (finds Neo4j volume matching `neo4j.*data$` pattern)
- Automatic container stop/start for consistent backups
- Timestamped archives: `neo4j-backup-YYYYMMDD-HHMMSS.tar.gz`
- SHA256 checksum generation for integrity verification
- JSON metadata file with backup details
- Configurable retention policy (default: 30 days)
- Cross-platform compatibility (Bash and PowerShell)
- Exit codes for scripting integration

**Important:** The backup process briefly stops the Neo4j container. Plan backups during low-usage periods if the database is actively being used.

#### Restoring Neo4j from Backup

**Bash (Linux/WSL/Git Bash):**
```bash
# Interactive restore (prompts for confirmation)
./scripts/restore-neo4j.sh ./backups/neo4j-backup-20241221-120000.tar.gz

# Non-interactive restore (skip confirmation)
./scripts/restore-neo4j.sh ./backups/neo4j-backup-20241221-120000.tar.gz --yes

# Restore to specific volume
./scripts/restore-neo4j.sh ./backups/neo4j-backup-20241221-120000.tar.gz --volume my-neo4j-data
```

**PowerShell (Windows):**
```powershell
# Interactive restore
.\scripts\restore-neo4j.ps1 -BackupFile ".\backups\neo4j-backup-20241221-120000.tar.gz"

# Non-interactive restore
.\scripts\restore-neo4j.ps1 -BackupFile ".\backups\neo4j-backup-20241221-120000.tar.gz" -Force
```

**Restore Process:**
1. Validates backup file exists and is a valid gzip archive
2. Verifies checksum if `.sha256` file exists
3. Auto-detects or validates target volume
4. Prompts for confirmation (unless `--yes`/`-Force` flag)
5. Stops Neo4j container
6. Clears existing volume data
7. Extracts backup to volume
8. Restarts container
9. Waits for health check (using cypher-shell)
10. Provides verification commands

**Environment Variables for Health Check:**
- `NEO4J_USER` - Neo4j username (default: `neo4j`)
- `NEO4J_PASSWORD` - Neo4j password (required for health check, can be set in `.env` file)

#### Verifying Neo4j Backup/Restore

Run the verification test script to ensure backup and restore work correctly:

```bash
# Run full verification test
./scripts/test-backup-restore-neo4j.sh

# Verbose output
./scripts/test-backup-restore-neo4j.sh --verbose

# Keep test artifacts for inspection
./scripts/test-backup-restore-neo4j.sh --keep
```

**Prerequisites:**
- Neo4j container running and healthy
- `NEO4J_PASSWORD` environment variable set (or in `.env` file)

**Test Process:**
1. Verifies Neo4j is running and accessible
2. Creates a test node with known properties
3. Creates backup (stops and restarts container)
4. Deletes test node (simulates data loss)
5. Restores from backup
6. Verifies test node exists with correct values
7. Cleans up test artifacts

#### Scheduled Neo4j Backups

**Linux/macOS (cron):**
```bash
# Edit crontab
crontab -e

# Add daily backup at 3 AM (offset from ChromaDB backup)
0 3 * * * NEO4J_PASSWORD=yourpassword /path/to/project/scripts/backup-neo4j.sh --quiet >> /var/log/neo4j-backup.log 2>&1
```

**Windows (Task Scheduler):**
```powershell
# Create scheduled task for daily backup at 3 AM
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\path\to\project\scripts\backup-neo4j.ps1 -Quiet"
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "Neo4j Daily Backup"
```

#### Neo4j Disaster Recovery Procedure

In case of Neo4j data loss or corruption:

1. **Stop the service** (if not already stopped):
   ```bash
   docker-compose stop neo4j
   ```

2. **Identify latest backup**:
   ```bash
   ls -lt ./backups/neo4j-backup-*.tar.gz | head -5
   ```

3. **Verify backup integrity** (if checksum exists):
   ```bash
   # Compare stored checksum with actual
   cat ./backups/neo4j-backup-YYYYMMDD-HHMMSS.tar.gz.sha256
   sha256sum ./backups/neo4j-backup-YYYYMMDD-HHMMSS.tar.gz
   ```

4. **Restore from backup**:
   ```bash
   ./scripts/restore-neo4j.sh ./backups/neo4j-backup-YYYYMMDD-HHMMSS.tar.gz --yes
   ```

5. **Verify restoration**:
   ```bash
   # Check Neo4j browser
   # Open http://localhost:7474 in a browser

   # Or via cypher-shell
   docker exec pk-mcp-neo4j cypher-shell -u neo4j -p <password> "MATCH (n) RETURN count(n) AS nodeCount"
   ```

6. **Document the incident** for future reference.

## Multi-Instance Deployment

The Personal Knowledge MCP supports running multiple isolated ChromaDB instances for different security tiers. This enables separation of Private, Work, and Public knowledge bases.

### Use Cases

- **Private Instance**: Personal notes, financial data, health records
- **Work Instance**: Company code, internal documentation, proprietary knowledge
- **Public Instance**: Open source projects, public documentation, shared resources

### Instance Configuration

Each instance requires unique settings for ports, volumes, and container names.

**Example: Running Three Isolated Instances**

Create separate compose files or use environment variables to differentiate instances:

```bash
# Private instance (port 8000)
INSTANCE_NAME=private CHROMADB_PORT=8000 docker-compose -f docker-compose.private.yml up -d

# Work instance (port 8001)
INSTANCE_NAME=work CHROMADB_PORT=8001 docker-compose -f docker-compose.work.yml up -d

# Public instance (port 8002)
INSTANCE_NAME=public CHROMADB_PORT=8002 docker-compose -f docker-compose.public.yml up -d
```

**docker-compose.private.yml Example:**
```yaml
services:
  chromadb:
    image: chromadb/chroma:0.6.3
    container_name: pk-mcp-chromadb-private
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - chromadb-data-private:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE
      - ANONYMIZED_TELEMETRY=FALSE
      - ALLOW_RESET=FALSE
    restart: unless-stopped

volumes:
  chromadb-data-private:
    driver: local
```

### Backup Strategy for Multi-Instance

Use the `--volume` flag to specify which instance to backup:

**ChromaDB Instances:**
```bash
# Backup private instance
./scripts/backup-chromadb.sh --volume personalknowledgemcp_chromadb-data-private \
    --backup-dir ./backups/private

# Backup work instance
./scripts/backup-chromadb.sh --volume personalknowledgemcp_chromadb-data-work \
    --backup-dir ./backups/work

# Backup public instance
./scripts/backup-chromadb.sh --volume personalknowledgemcp_chromadb-data-public \
    --backup-dir ./backups/public
```

**Neo4j Instances:**
```bash
# Backup private Neo4j instance
./scripts/backup-neo4j.sh --volume personalknowledgemcp_neo4j-data-private \
    --backup-dir ./backups/private

# Backup work Neo4j instance
./scripts/backup-neo4j.sh --volume personalknowledgemcp_neo4j-data-work \
    --backup-dir ./backups/work
```

### Restore to Specific Instance

**ChromaDB:**
```bash
# Restore to private instance
./scripts/restore-chromadb.sh ./backups/private/chromadb-backup-*.tar.gz \
    --volume personalknowledgemcp_chromadb-data-private
```

**Neo4j:**
```bash
# Restore to private Neo4j instance
./scripts/restore-neo4j.sh ./backups/private/neo4j-backup-*.tar.gz \
    --volume personalknowledgemcp_neo4j-data-private
```

### Security Considerations

- **Network Isolation**: Each instance should bind to localhost only
- **Volume Separation**: Use distinct volume names to prevent data mixing
- **Access Control**: Consider using different authentication tokens per instance (Phase 3+)
- **Backup Separation**: Store backups in separate directories with appropriate permissions
- **Firewall Rules**: Ensure each port is appropriately protected

### MCP Service Configuration

Configure the MCP service to connect to the appropriate instance:

```json
{
  "instances": {
    "private": {
      "chromadb_url": "http://localhost:8000",
      "collections_prefix": "private_"
    },
    "work": {
      "chromadb_url": "http://localhost:8001",
      "collections_prefix": "work_"
    },
    "public": {
      "chromadb_url": "http://localhost:8002",
      "collections_prefix": "public_"
    }
  }
}
```

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [ChromaDB Documentation](https://docs.trychroma.com/)
- [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
- [WSL2 Installation Guide](https://learn.microsoft.com/en-us/windows/wsl/install)

---

**For project-specific details:**
- [High-Level PRD](High-level-Personal-Knowledge-MCP-PRD.md)
- [Docker Containerization PRD](pm/Docker-Containerization-PRD.md)
- [Phase 1 System Design](architecture/Phase1-System-Design-Document.md)
- [README - Getting Started](../README.md#getting-started)
