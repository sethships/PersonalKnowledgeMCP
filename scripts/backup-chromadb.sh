#!/bin/bash
#
# backup-chromadb.sh - ChromaDB Volume Backup Script
#
# Creates timestamped compressed backups of ChromaDB data volume with retention policy.
# Compatible with Linux, WSL, and Git Bash on Windows.
#
# Usage:
#   ./backup-chromadb.sh [options]
#
# Options:
#   -d, --backup-dir DIR    Backup directory (default: ./backups or BACKUP_DIR env)
#   -r, --retention DAYS    Retention period in days (default: 30 or RETENTION_DAYS env)
#   -v, --volume NAME       Volume name override (auto-detected by default)
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
#   ./backup-chromadb.sh
#   ./backup-chromadb.sh --backup-dir /mnt/backups --retention 7
#   BACKUP_DIR=/backups ./backup-chromadb.sh
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Default values (can be overridden by environment or command-line)
DEFAULT_BACKUP_DIR="./backups"
DEFAULT_RETENTION_DAYS=30
VOLUME_PATTERN="chromadb.*data$"

# Script state
BACKUP_DIR="${BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
RETENTION_DAYS="${RETENTION_DAYS:-$DEFAULT_RETENTION_DAYS}"
VOLUME_NAME="${VOLUME_NAME:-}"
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
    head -40 "$0" | grep "^#" | sed 's/^#//' | sed 's/^ //'
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

# Create backup directory if it doesn't exist
ensure_backup_dir() {
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log_info "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
    fi

    # Convert to absolute path for Docker mount
    BACKUP_DIR=$(cd "$BACKUP_DIR" && pwd)
}

# Create the backup
create_backup() {
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)
    local backup_file="chromadb-backup-${timestamp}.tar.gz"
    local backup_path="${BACKUP_DIR}/${backup_file}"

    log_info "Creating backup: $backup_file"
    log_info "Volume: $VOLUME_NAME"
    log_info "Destination: $BACKUP_DIR"

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
            echo "$backup_path"
        else
            log_error "Backup file was not created"
            exit 4
        fi
    else
        log_error "Backup command failed"
        exit 4
    fi
}

# Apply retention policy - delete old backups
apply_retention() {
    if [[ "$RETENTION_DAYS" -le 0 ]]; then
        log_info "Retention policy disabled (RETENTION_DAYS=$RETENTION_DAYS)"
        return 0
    fi

    log_info "Applying retention policy: keeping backups from last $RETENTION_DAYS days"

    # Find and delete old backups
    local deleted_count=0
    while IFS= read -r old_backup; do
        if [[ -n "$old_backup" ]]; then
            log_info "Removing old backup: $(basename "$old_backup")"
            rm -f "$old_backup"
            ((deleted_count++)) || true
        fi
    done < <(find "$BACKUP_DIR" -name "chromadb-backup-*.tar.gz" -type f -mtime +$RETENTION_DAYS 2>/dev/null || true)

    if [[ $deleted_count -gt 0 ]]; then
        log_info "Removed $deleted_count old backup(s)"
    fi
}

# List existing backups
list_backups() {
    if [[ "$QUIET" == "true" ]]; then
        return 0
    fi

    local count
    count=$(find "$BACKUP_DIR" -name "chromadb-backup-*.tar.gz" -type f 2>/dev/null | wc -l || echo 0)

    if [[ $count -gt 0 ]]; then
        log_info "Existing backups in $BACKUP_DIR:"
        find "$BACKUP_DIR" -name "chromadb-backup-*.tar.gz" -type f -printf "  %T+ %s %f\n" 2>/dev/null | sort -r | head -10 || \
        ls -lht "$BACKUP_DIR"/chromadb-backup-*.tar.gz 2>/dev/null | head -10 || true
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

    log_info "ChromaDB Backup Script"
    log_info "======================"

    # Pre-flight checks
    check_docker
    detect_volume
    verify_volume
    ensure_backup_dir

    # Create backup
    create_backup

    # Apply retention policy
    apply_retention

    # Show summary
    list_backups

    log_success "Backup completed successfully"
}

main "$@"
