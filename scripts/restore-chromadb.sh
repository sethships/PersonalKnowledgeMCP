#!/bin/bash
#
# restore-chromadb.sh - ChromaDB Volume Restore Script
#
# Restores ChromaDB data from a backup archive.
# Compatible with Linux, WSL, and Git Bash on Windows.
#
# Usage:
#   ./restore-chromadb.sh <backup-file> [options]
#
# Arguments:
#   backup-file         Path to the backup archive (chromadb-backup-*.tar.gz)
#
# Options:
#   -y, --yes           Skip confirmation prompt
#   -v, --volume NAME   Volume name override (auto-detected by default)
#   -q, --quiet         Suppress non-error output
#   -h, --help          Show this help message
#
# Environment Variables:
#   VOLUME_NAME         Override volume name detection
#
# Exit Codes:
#   0 - Success
#   1 - General error
#   2 - Docker not available
#   3 - Volume not found
#   4 - Backup file not found or invalid
#   5 - Restore failed
#   6 - User cancelled
#
# Examples:
#   ./restore-chromadb.sh ./backups/chromadb-backup-20241210-183000.tar.gz
#   ./restore-chromadb.sh backup.tar.gz --yes
#   ./restore-chromadb.sh backup.tar.gz --volume myproject_chromadb-data
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

VOLUME_PATTERN="chromadb.*data$"
CONTAINER_PATTERN="chromadb"

# Script state
BACKUP_FILE=""
VOLUME_NAME="${VOLUME_NAME:-}"
SKIP_CONFIRM=false
QUIET=false

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

# Validate backup file
validate_backup_file() {
    if [[ -z "$BACKUP_FILE" ]]; then
        log_error "No backup file specified"
        echo "Usage: $0 <backup-file> [options]"
        echo "Use --help for more information"
        exit 4
    fi

    if [[ ! -f "$BACKUP_FILE" ]]; then
        log_error "Backup file not found: $BACKUP_FILE"
        exit 4
    fi

    if [[ ! -r "$BACKUP_FILE" ]]; then
        log_error "Backup file is not readable: $BACKUP_FILE"
        exit 4
    fi

    # Verify it's a valid gzip archive
    if ! gzip -t "$BACKUP_FILE" &>/dev/null 2>&1; then
        # Try using file command as fallback
        if ! file "$BACKUP_FILE" | grep -q "gzip compressed"; then
            log_error "Backup file is not a valid gzip archive: $BACKUP_FILE"
            exit 4
        fi
    fi

    # Convert to absolute path
    BACKUP_FILE=$(cd "$(dirname "$BACKUP_FILE")" && pwd)/$(basename "$BACKUP_FILE")
    log_info "Backup file validated: $BACKUP_FILE"
}

# Verify backup checksum if available
verify_checksum() {
    local checksum_file="${BACKUP_FILE}.sha256"

    if [[ ! -f "$checksum_file" ]]; then
        log_warn "No checksum file found (${checksum_file})"
        log_warn "Skipping integrity verification - backup may not have been created with checksums"
        return 0
    fi

    log_info "Verifying backup integrity..."

    local expected_checksum
    expected_checksum=$(cat "$checksum_file")

    local actual_checksum
    if command -v sha256sum &>/dev/null; then
        actual_checksum=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)
    elif command -v shasum &>/dev/null; then
        actual_checksum=$(shasum -a 256 "$BACKUP_FILE" | cut -d' ' -f1)
    else
        log_warn "No checksum tool available (sha256sum or shasum) - skipping verification"
        return 0
    fi

    if [[ "$expected_checksum" == "$actual_checksum" ]]; then
        log_info "Checksum verified: ${actual_checksum:0:16}..."
        return 0
    else
        log_error "Checksum mismatch!"
        log_error "Expected: $expected_checksum"
        log_error "Actual:   $actual_checksum"
        log_error "The backup file may be corrupted. Aborting restore."
        exit 4
    fi
}

# Auto-detect ChromaDB volume name
detect_volume() {
    if [[ -n "$VOLUME_NAME" ]]; then
        log_info "Using specified volume: $VOLUME_NAME"
        return 0
    fi

    VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep -E "$VOLUME_PATTERN" | head -1 || true)

    if [[ -z "$VOLUME_NAME" ]]; then
        log_error "Could not find ChromaDB volume matching pattern: $VOLUME_PATTERN"
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

# Find ChromaDB container(s)
find_chromadb_containers() {
    docker ps --format '{{.Names}}' | grep -i "$CONTAINER_PATTERN" || true
}

# Stop ChromaDB container
stop_container() {
    local containers
    containers=$(find_chromadb_containers)

    if [[ -z "$containers" ]]; then
        log_info "No running ChromaDB container found"
        return 0
    fi

    log_info "Stopping ChromaDB container(s): $containers"

    # Try docker compose first
    local compose_cmd
    compose_cmd=$(get_docker_compose_cmd)

    if $compose_cmd stop chromadb &>/dev/null 2>&1; then
        log_info "Container stopped via docker compose"
    else
        # Fall back to docker stop
        for container in $containers; do
            log_info "Stopping container: $container"
            docker stop "$container" &>/dev/null || true
        done
    fi
}

# Start ChromaDB container
start_container() {
    local compose_cmd
    compose_cmd=$(get_docker_compose_cmd)

    log_info "Starting ChromaDB container..."

    if $compose_cmd up -d chromadb &>/dev/null 2>&1; then
        log_info "Container started via docker compose"
    else
        # Can't start without compose file, warn user
        log_warn "Could not start container automatically"
        log_warn "Please start the container manually: $compose_cmd up -d chromadb"
        return 1
    fi
}

# Wait for container to be healthy
wait_for_healthy() {
    local max_attempts=30
    local attempt=0

    log_info "Waiting for ChromaDB to be healthy..."

    while [[ $attempt -lt $max_attempts ]]; do
        if curl -sf http://localhost:8000/api/v2/heartbeat &>/dev/null; then
            log_success "ChromaDB is healthy"
            return 0
        fi
        ((attempt++))
        sleep 2
    done

    log_warn "ChromaDB health check timed out after $((max_attempts * 2)) seconds"
    log_warn "The container may still be starting up"
    return 1
}

# Confirm with user before proceeding
confirm_restore() {
    if [[ "$SKIP_CONFIRM" == "true" ]]; then
        return 0
    fi

    local file_size
    file_size=$(du -h "$BACKUP_FILE" | cut -f1)

    echo ""
    echo "${YELLOW}WARNING: This operation will REPLACE all existing ChromaDB data.${RESET}"
    echo ""
    echo "  Backup file: $(basename "$BACKUP_FILE")"
    echo "  File size:   $file_size"
    echo "  Target volume: $VOLUME_NAME"
    echo ""
    echo "This action is DESTRUCTIVE and cannot be undone."
    echo ""

    read -p "Are you sure you want to proceed? (y/N) " confirm
    case "$confirm" in
        [Yy]|[Yy][Ee][Ss])
            return 0
            ;;
        *)
            log_info "Restore cancelled by user"
            exit 6
            ;;
    esac
}

# Clear existing data in volume
clear_volume() {
    log_info "Clearing existing data in volume..."

    # Note: MSYS_NO_PATHCONV=1 prevents Git Bash from converting Unix paths
    MSYS_NO_PATHCONV=1 docker run --rm \
        -v "${VOLUME_NAME}:/data" \
        alpine \
        sh -c "rm -rf /data/*" 2>&1

    if [[ $? -ne 0 ]]; then
        log_error "Failed to clear volume data"
        exit 5
    fi

    log_info "Volume cleared"
}

# Restore data from backup
restore_data() {
    local backup_dir
    backup_dir=$(dirname "$BACKUP_FILE")
    local backup_name
    backup_name=$(basename "$BACKUP_FILE")

    log_info "Restoring data from backup..."

    # Note: MSYS_NO_PATHCONV=1 prevents Git Bash from converting Unix paths
    MSYS_NO_PATHCONV=1 docker run --rm \
        -v "${VOLUME_NAME}:/data" \
        -v "${backup_dir}:/backup:ro" \
        alpine \
        tar xzf "/backup/${backup_name}" -C /data 2>&1

    if [[ $? -ne 0 ]]; then
        log_error "Failed to restore data from backup"
        exit 5
    fi

    log_success "Data restored from backup"
}

# Show verification command
show_verification() {
    echo ""
    log_info "Verification:"
    echo "  curl http://localhost:8000/api/v2/heartbeat"
    echo "  curl http://localhost:8000/api/v2/collections"
    echo ""
}

# =============================================================================
# Argument Parsing
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -y|--yes)
                SKIP_CONFIRM=true
                shift
                ;;
            -v|--volume)
                VOLUME_NAME="$2"
                shift 2
                ;;
            -q|--quiet)
                QUIET=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
            *)
                if [[ -z "$BACKUP_FILE" ]]; then
                    BACKUP_FILE="$1"
                else
                    log_error "Unexpected argument: $1"
                    exit 1
                fi
                shift
                ;;
        esac
    done
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    parse_args "$@"

    log_info "ChromaDB Restore Script"
    log_info "======================="

    # Pre-flight checks
    check_docker
    validate_backup_file
    verify_checksum
    detect_volume
    verify_volume

    # Confirm with user
    confirm_restore

    # Perform restore
    stop_container
    clear_volume
    restore_data
    start_container || true
    wait_for_healthy || true

    # Show verification commands
    show_verification

    log_success "Restore completed successfully"
}

main "$@"
