#!/bin/bash
#
# backup-neo4j.sh - Neo4j Volume Backup Script
#
# Creates timestamped compressed backups of Neo4j data volume with retention policy.
# Compatible with Linux, WSL, and Git Bash on Windows.
#
# IMPORTANT: Neo4j Community Edition does not support online backups.
# This script stops the Neo4j container before backup for data consistency.
#
# Usage:
#   ./backup-neo4j.sh [options]
#
# Options:
#   -d, --backup-dir DIR    Backup directory (default: ./backups or BACKUP_DIR env)
#   -r, --retention DAYS    Retention period in days (default: 30 or RETENTION_DAYS env)
#   -v, --volume NAME       Volume name override (auto-detected by default)
#   -n, --dry-run           Show what would be done without making changes
#   -q, --quiet             Suppress non-error output
#   -h, --help              Show this help message
#
# Environment Variables:
#   BACKUP_DIR        Default backup directory
#   RETENTION_DAYS    Default retention period in days
#   VOLUME_NAME       Override volume name detection
#
# Exit Codes:
#   0 - Success
#   1 - General error
#   2 - Docker not available
#   3 - Volume not found
#   4 - Backup failed
#
# Examples:
#   ./backup-neo4j.sh
#   ./backup-neo4j.sh --backup-dir /mnt/backups --retention 7
#   BACKUP_DIR=/backups ./backup-neo4j.sh
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Default values (can be overridden by environment or command-line)
DEFAULT_BACKUP_DIR="./backups"
DEFAULT_RETENTION_DAYS=30
VOLUME_PATTERN="neo4j.*data$"
CONTAINER_PATTERN="neo4j"

# Script state
BACKUP_DIR="${BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
RETENTION_DAYS="${RETENTION_DAYS:-$DEFAULT_RETENTION_DAYS}"
VOLUME_NAME="${VOLUME_NAME:-}"
QUIET=false
DRY_RUN=false
CONTAINER_WAS_RUNNING=false

# =============================================================================
# Color Output (if terminal supports it)
# =============================================================================

if [[ -t 1 ]] && command -v tput &>/dev/null; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    BLUE=$(tput setaf 4)
    RESET=$(tput sgr0)
else
    RED=""
    GREEN=""
    YELLOW=""
    BLUE=""
    RESET=""
fi

# =============================================================================
# Logging Functions
# =============================================================================

log_info() {
    if [[ "$QUIET" != "true" ]]; then
        echo "${BLUE}[INFO]${RESET} $*"
    fi
}

log_success() {
    if [[ "$QUIET" != "true" ]]; then
        echo "${GREEN}[SUCCESS]${RESET} $*"
    fi
}

log_warn() {
    echo "${YELLOW}[WARN]${RESET} $*" >&2
}

log_error() {
    echo "${RED}[ERROR]${RESET} $*" >&2
}

# =============================================================================
# Helper Functions
# =============================================================================

show_help() {
    head -45 "$0" | grep "^#" | sed 's/^#//' | sed 's/^ //'
}

# Detect docker compose command (v2 vs v1)
get_docker_compose_cmd() {
    if docker compose version &>/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose &>/dev/null; then
        echo "docker-compose"
    else
        log_error "Neither 'docker compose' nor 'docker-compose' found"
        exit 2
    fi
}

# Check if Docker is available and running
check_docker() {
    if ! command -v docker &>/dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 2
    fi

    if ! docker info &>/dev/null 2>&1; then
        log_error "Docker daemon is not running or not accessible"
        exit 2
    fi
}

# Auto-detect Neo4j volume name
detect_volume() {
    if [[ -n "$VOLUME_NAME" ]]; then
        log_info "Using specified volume: $VOLUME_NAME"
        return 0
    fi

    VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep -E "$VOLUME_PATTERN" | head -1 || true)

    if [[ -z "$VOLUME_NAME" ]]; then
        log_error "Could not find Neo4j volume matching pattern: $VOLUME_PATTERN"
        log_error "Available volumes:"
        docker volume ls --format '  {{.Name}}'
        exit 3
    fi

    log_info "Detected volume: $VOLUME_NAME"
}

# Verify volume exists
verify_volume() {
    if ! docker volume inspect "$VOLUME_NAME" &>/dev/null 2>&1; then
        log_error "Volume '$VOLUME_NAME' does not exist"
        exit 3
    fi
}

# Create backup directory if it doesn't exist
ensure_backup_dir() {
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log_info "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
    fi

    # Convert to absolute path for Docker mount
    BACKUP_DIR=$(cd "$BACKUP_DIR" && pwd)
}

# Find Neo4j container(s)
find_neo4j_containers() {
    docker ps --format '{{.Names}}' | grep -i "$CONTAINER_PATTERN" || true
}

# Stop Neo4j container for consistent backup
stop_container() {
    local containers
    containers=$(find_neo4j_containers)

    if [[ -z "$containers" ]]; then
        log_info "No running Neo4j container found"
        CONTAINER_WAS_RUNNING=false
        return 0
    fi

    CONTAINER_WAS_RUNNING=true
    log_info "Stopping Neo4j container(s) for consistent backup: $containers"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] Would stop Neo4j container(s)"
        return 0
    fi

    # Try docker compose first
    local compose_cmd
    compose_cmd=$(get_docker_compose_cmd)

    if $compose_cmd stop neo4j &>/dev/null 2>&1; then
        log_info "Container stopped via docker compose"
    else
        # Fall back to docker stop
        for container in $containers; do
            log_info "Stopping container: $container"
            docker stop "$container" &>/dev/null || true
        done
    fi

    # Wait briefly for clean shutdown
    sleep 2
}

# Restart Neo4j container after backup
restart_container() {
    if [[ "$CONTAINER_WAS_RUNNING" != "true" ]]; then
        return 0
    fi

    log_info "Restarting Neo4j container..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] Would restart Neo4j container"
        return 0
    fi

    local compose_cmd
    compose_cmd=$(get_docker_compose_cmd)

    if $compose_cmd up -d neo4j &>/dev/null 2>&1; then
        log_info "Container restarted via docker compose"
    else
        log_warn "Could not restart container automatically"
        log_warn "Please start the container manually: $compose_cmd up -d neo4j"
    fi
}

# Generate SHA256 checksum for backup file
generate_checksum() {
    local backup_path="$1"
    local checksum_path="${backup_path}.sha256"

    log_info "Generating SHA256 checksum..."

    if command -v sha256sum &>/dev/null; then
        sha256sum "$backup_path" | cut -d' ' -f1 > "$checksum_path"
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$backup_path" | cut -d' ' -f1 > "$checksum_path"
    else
        log_warn "No checksum tool available (sha256sum or shasum)"
        return 1
    fi

    if [[ -f "$checksum_path" ]]; then
        local checksum
        checksum=$(cat "$checksum_path")
        log_info "Checksum: ${checksum:0:16}... (saved to $(basename "$checksum_path"))"
        return 0
    else
        log_warn "Failed to create checksum file"
        return 1
    fi
}

# Generate metadata JSON file for backup
generate_metadata() {
    local backup_path="$1"
    local metadata_path="${backup_path%.tar.gz}.metadata.json"

    log_info "Generating backup metadata..."

    local size_bytes
    size_bytes=$(stat -c%s "$backup_path" 2>/dev/null || stat -f%z "$backup_path" 2>/dev/null || echo "0")

    local size_human
    size_human=$(du -h "$backup_path" | cut -f1)

    local checksum=""
    if [[ -f "${backup_path}.sha256" ]]; then
        checksum=$(cat "${backup_path}.sha256")
    fi

    local hostname
    hostname=$(hostname 2>/dev/null || echo "unknown")

    cat > "$metadata_path" << EOF
{
  "backup_file": "$(basename "$backup_path")",
  "created_at": "$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)",
  "volume_name": "$VOLUME_NAME",
  "database": "neo4j",
  "size_bytes": $size_bytes,
  "size_human": "$size_human",
  "sha256": "$checksum",
  "hostname": "$hostname",
  "backup_dir": "$BACKUP_DIR",
  "retention_days": $RETENTION_DAYS,
  "script_version": "1.0.0"
}
EOF

    if [[ -f "$metadata_path" ]]; then
        log_info "Metadata saved to $(basename "$metadata_path")"
        return 0
    else
        log_warn "Failed to create metadata file"
        return 1
    fi
}

# Create the backup
create_backup() {
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)
    local backup_file="neo4j-backup-${timestamp}.tar.gz"
    local backup_path="${BACKUP_DIR}/${backup_file}"

    log_info "Creating backup: $backup_file"
    log_info "Volume: $VOLUME_NAME"
    log_info "Destination: $BACKUP_DIR"

    # Dry-run mode - show what would happen
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] Would create backup: $backup_path"
        log_info "[DRY-RUN] Would generate checksum: ${backup_path}.sha256"
        log_info "[DRY-RUN] Would generate metadata: ${backup_path%.tar.gz}.metadata.json"
        echo "$backup_path"
        return 0
    fi

    # Stop container for consistent backup
    stop_container

    # Run backup using Alpine container
    # Mount volume as read-only for safety
    # Note: MSYS_NO_PATHCONV=1 prevents Git Bash from converting Unix paths
    if MSYS_NO_PATHCONV=1 docker run --rm \
        -v "${VOLUME_NAME}:/data:ro" \
        -v "${BACKUP_DIR}:/backup" \
        alpine \
        tar czf "/backup/${backup_file}" -C /data . 2>&1; then

        # Verify backup was created
        if [[ -f "$backup_path" ]]; then
            local size
            size=$(du -h "$backup_path" | cut -f1)
            log_success "Backup created: $backup_path ($size)"

            # Generate checksum and metadata
            generate_checksum "$backup_path" || true
            generate_metadata "$backup_path" || true

            echo "$backup_path"
        else
            log_error "Backup file was not created"
            restart_container
            exit 4
        fi
    else
        log_error "Backup command failed"
        restart_container
        exit 4
    fi

    # Restart container after backup
    restart_container
}

# Apply retention policy - delete old backups
apply_retention() {
    if [[ "$RETENTION_DAYS" -le 0 ]]; then
        log_info "Retention policy disabled (RETENTION_DAYS=$RETENTION_DAYS)"
        return 0
    fi

    log_info "Applying retention policy: keeping backups from last $RETENTION_DAYS days"

    # Find old backups
    local deleted_count=0
    local total_freed=0
    while IFS= read -r old_backup; do
        if [[ -n "$old_backup" ]]; then
            local backup_name
            backup_name=$(basename "$old_backup")

            # Calculate age in days
            local mod_time
            mod_time=$(stat -c %Y "$old_backup" 2>/dev/null || stat -f %m "$old_backup" 2>/dev/null || echo "0")
            local now
            now=$(date +%s)
            local age_days=$(( (now - mod_time) / 86400 ))

            # Get file size
            local size
            size=$(du -h "$old_backup" | cut -f1)
            local size_bytes
            size_bytes=$(stat -c%s "$old_backup" 2>/dev/null || stat -f%z "$old_backup" 2>/dev/null || echo "0")

            if [[ "$DRY_RUN" == "true" ]]; then
                log_info "[DRY-RUN] Would remove: $backup_name (${age_days} days old, $size)"
            else
                log_info "Removing: $backup_name (${age_days} days old, $size)"
                rm -f "$old_backup"

                # Also remove associated checksum and metadata files
                rm -f "${old_backup}.sha256" 2>/dev/null || true
                rm -f "${old_backup%.tar.gz}.metadata.json" 2>/dev/null || true
            fi

            ((deleted_count++)) || true
            ((total_freed += size_bytes)) || true
        fi
    done < <(find "$BACKUP_DIR" -name "neo4j-backup-*.tar.gz" -type f -mtime +$RETENTION_DAYS 2>/dev/null || true)

    if [[ $deleted_count -gt 0 ]]; then
        # Convert bytes to human-readable
        local freed_human
        if [[ $total_freed -gt 1073741824 ]]; then
            freed_human="$(echo "scale=2; $total_freed / 1073741824" | bc 2>/dev/null || echo "$((total_freed / 1073741824))")GB"
        elif [[ $total_freed -gt 1048576 ]]; then
            freed_human="$(echo "scale=2; $total_freed / 1048576" | bc 2>/dev/null || echo "$((total_freed / 1048576))")MB"
        else
            freed_human="${total_freed}B"
        fi

        if [[ "$DRY_RUN" == "true" ]]; then
            log_info "[DRY-RUN] Would remove $deleted_count old backup(s), freeing ~$freed_human"
        else
            log_info "Removed $deleted_count old backup(s), freed ~$freed_human"
        fi
    else
        log_info "No old backups to remove"
    fi
}

# List existing backups
list_backups() {
    if [[ "$QUIET" == "true" ]]; then
        return 0
    fi

    local count
    count=$(find "$BACKUP_DIR" -name "neo4j-backup-*.tar.gz" -type f 2>/dev/null | wc -l || echo 0)

    if [[ $count -gt 0 ]]; then
        log_info "Existing backups in $BACKUP_DIR:"
        find "$BACKUP_DIR" -name "neo4j-backup-*.tar.gz" -type f -printf "  %T+ %s %f\n" 2>/dev/null | sort -r | head -10 || \
        ls -lht "$BACKUP_DIR"/neo4j-backup-*.tar.gz 2>/dev/null | head -10 || true
    fi
}

# =============================================================================
# Argument Parsing
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -d|--backup-dir)
                BACKUP_DIR="$2"
                shift 2
                ;;
            -r|--retention)
                RETENTION_DAYS="$2"
                shift 2
                ;;
            -v|--volume)
                VOLUME_NAME="$2"
                shift 2
                ;;
            -q|--quiet)
                QUIET=true
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    parse_args "$@"

    log_info "Neo4j Backup Script"
    log_info "==================="

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN MODE] No changes will be made"
    fi

    # Pre-flight checks
    check_docker
    detect_volume
    verify_volume
    ensure_backup_dir

    # Create backup (includes stop/start of container)
    create_backup

    # Apply retention policy
    apply_retention

    # Show summary
    list_backups

    if [[ "$DRY_RUN" == "true" ]]; then
        log_success "Dry-run completed - no changes were made"
    else
        log_success "Backup completed successfully"
    fi
}

main "$@"
