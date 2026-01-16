#!/bin/bash
#
# restore-neo4j.sh - Neo4j Volume Restore Script
#
# Restores Neo4j data from a backup archive.
# Compatible with Linux, WSL, and Git Bash on Windows.
#
# IMPORTANT: This script stops the Neo4j container before restoring.
# All existing data in the volume will be replaced.
#
# Usage:
#   ./restore-neo4j.sh <backup-file> [options]
#
# Arguments:
#   backup-file         Path to the backup archive (neo4j-backup-*.tar.gz)
#
# Options:
#   -y, --yes           Skip confirmation prompt
#   -v, --volume NAME   Volume name override (auto-detected by default)
#   -q, --quiet         Suppress non-error output
#   -h, --help          Show this help message
#
# Environment Variables:
#   VOLUME_NAME         Override volume name detection
#   NEO4J_USER          Neo4j username for health check (default: neo4j)
#   NEO4J_PASSWORD      Neo4j password for health check (required)
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
#   ./restore-neo4j.sh ./backups/neo4j-backup-20241210-183000.tar.gz
#   ./restore-neo4j.sh backup.tar.gz --yes
#   ./restore-neo4j.sh backup.tar.gz --volume myproject_neo4j-data
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

VOLUME_PATTERN="neo4j.*data$"
CONTAINER_PATTERN="neo4j"

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
    head -50 "$0" | grep "^#" | sed 's/^#//' | sed 's/^ //'
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

# Find Neo4j container(s)
find_neo4j_containers() {
    docker ps --format '{{.Names}}' | grep -i "$CONTAINER_PATTERN" || true
}

# Stop Neo4j container
stop_container() {
    local containers
    containers=$(find_neo4j_containers)

    if [[ -z "$containers" ]]; then
        log_info "No running Neo4j container found"
        return 0
    fi

    log_info "Stopping Neo4j container(s): $containers"

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

    # Wait for clean shutdown
    sleep 2
}

# Start Neo4j container
start_container() {
    local compose_cmd
    compose_cmd=$(get_docker_compose_cmd)

    log_info "Starting Neo4j container..."

    if $compose_cmd up -d neo4j &>/dev/null 2>&1; then
        log_info "Container started via docker compose"
    else
        # Can't start without compose file, warn user
        log_warn "Could not start container automatically"
        log_warn "Please start the container manually: $compose_cmd up -d neo4j"
        return 1
    fi
}

# Wait for container to be healthy
wait_for_healthy() {
    local max_attempts=60
    local attempt=0

    log_info "Waiting for Neo4j to be healthy..."

    # Get credentials from environment
    local neo4j_user="${NEO4J_USER:-neo4j}"
    local neo4j_password="${NEO4J_PASSWORD:-}"

    # Try .env file if password not set
    if [[ -z "$neo4j_password" ]]; then
        local script_dir
        script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        if [[ -f "${script_dir}/../.env" ]]; then
            neo4j_password=$(grep -E '^NEO4J_PASSWORD=' "${script_dir}/../.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || true)
        fi
    fi

    if [[ -z "$neo4j_password" ]]; then
        log_warn "NEO4J_PASSWORD not set - skipping health check"
        log_warn "Please verify Neo4j is running manually"
        return 1
    fi

    while [[ $attempt -lt $max_attempts ]]; do
        # Try cypher-shell health check via docker exec
        local container
        container=$(find_neo4j_containers | head -1)

        if [[ -n "$container" ]]; then
            if docker exec "$container" cypher-shell -u "$neo4j_user" -p "$neo4j_password" "RETURN 1" &>/dev/null 2>&1; then
                log_success "Neo4j is healthy"
                return 0
            fi
        fi

        ((attempt++))
        sleep 2
    done

    log_warn "Neo4j health check timed out after $((max_attempts * 2)) seconds"
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
    echo "${YELLOW}WARNING: This operation will REPLACE all existing Neo4j data.${RESET}"
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
    local neo4j_user="${NEO4J_USER:-neo4j}"

    echo ""
    log_info "Verification:"
    echo "  # Check Neo4j browser (after container starts):"
    echo "  http://localhost:7474"
    echo ""
    echo "  # Or via cypher-shell:"
    echo "  docker exec pk-mcp-neo4j cypher-shell -u $neo4j_user -p <password> 'RETURN 1'"
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

    log_info "Neo4j Restore Script"
    log_info "===================="

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
