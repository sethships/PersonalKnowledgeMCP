#!/bin/bash
#
# test-backup-restore.sh - Backup/Restore Verification Test Script
#
# Tests the backup and restore scripts by:
# 1. Verifying ChromaDB is running
# 2. Creating a test collection with known data
# 3. Creating a backup
# 4. Deleting the test collection (simulating data loss)
# 5. Restoring from backup
# 6. Verifying test collection data integrity
# 7. Cleaning up
#
# Usage:
#   ./test-backup-restore.sh [options]
#
# Options:
#   -k, --keep          Keep test artifacts (backup file, test collection)
#   -v, --verbose       Show detailed output
#   -h, --help          Show this help message
#
# Prerequisites:
#   - ChromaDB container running and healthy
#   - curl installed
#   - jq installed (optional, for better output)
#
# Environment Variables:
#   CHROMADB_AUTH_TOKEN     Authentication token for ChromaDB API (if enabled)
#                           Can also be set in project .env file
#
# Exit Codes:
#   0 - All tests passed
#   1 - Test failed
#   2 - Prerequisites not met
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_COLLECTION_NAME="test_backup_restore_$(date +%s)"
TEST_BACKUP_DIR="${SCRIPT_DIR}/../.test-backups"
CHROMADB_URL="http://localhost:8000"

# Authentication - check for token in environment or .env file
CHROMADB_AUTH_TOKEN="${CHROMADB_AUTH_TOKEN:-}"
if [[ -z "$CHROMADB_AUTH_TOKEN" ]] && [[ -f "${SCRIPT_DIR}/../.env" ]]; then
    CHROMADB_AUTH_TOKEN=$(grep -E '^CHROMADB_AUTH_TOKEN=' "${SCRIPT_DIR}/../.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || true)
fi

# Curl wrapper function for ChromaDB API calls with optional auth
chromadb_curl() {
    local method="${1:-GET}"
    local endpoint="$2"
    local data="${3:-}"

    local curl_args=(-sf -X "$method" "${CHROMADB_URL}${endpoint}")

    if [[ -n "$CHROMADB_AUTH_TOKEN" ]]; then
        curl_args+=(-H "Authorization: Bearer ${CHROMADB_AUTH_TOKEN}")
    fi

    if [[ -n "$data" ]]; then
        curl_args+=(-H "Content-Type: application/json" -d "$data")
    fi

    curl "${curl_args[@]}"
}

# Script state
KEEP_ARTIFACTS=false
VERBOSE=false
BACKUP_FILE=""
TEST_PASSED=true

# =============================================================================
# Color Output
# =============================================================================

if [[ -t 1 ]] && command -v tput &>/dev/null; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    BLUE=$(tput setaf 4)
    CYAN=$(tput setaf 6)
    RESET=$(tput sgr0)
else
    RED=""
    GREEN=""
    YELLOW=""
    BLUE=""
    CYAN=""
    RESET=""
fi

# =============================================================================
# Logging Functions
# =============================================================================

log_info() {
    echo "${BLUE}[INFO]${RESET} $*"
}

log_success() {
    echo "${GREEN}[PASS]${RESET} $*"
}

log_fail() {
    echo "${RED}[FAIL]${RESET} $*"
    TEST_PASSED=false
}

log_warn() {
    echo "${YELLOW}[WARN]${RESET} $*"
}

log_step() {
    echo ""
    echo "${CYAN}==>${RESET} $*"
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo "${BLUE}[DEBUG]${RESET} $*"
    fi
}

# =============================================================================
# Helper Functions
# =============================================================================

show_help() {
    head -30 "$0" | grep "^#" | sed 's/^#//' | sed 's/^ //'
}

# Check if ChromaDB is accessible
check_chromadb() {
    log_step "Checking ChromaDB availability"

    if ! chromadb_curl GET "/api/v2/heartbeat" &>/dev/null; then
        log_fail "ChromaDB is not accessible at ${CHROMADB_URL}"
        echo "Please ensure the ChromaDB container is running:"
        echo "  docker compose up -d chromadb"
        exit 2
    fi

    log_success "ChromaDB is running and healthy"
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites"

    if ! command -v curl &>/dev/null; then
        log_fail "curl is not installed"
        exit 2
    fi
    log_verbose "curl: OK"

    if ! command -v docker &>/dev/null; then
        log_fail "docker is not installed"
        exit 2
    fi
    log_verbose "docker: OK"

    if ! [[ -x "${SCRIPT_DIR}/backup-chromadb.sh" ]]; then
        log_warn "backup-chromadb.sh is not executable, fixing..."
        chmod +x "${SCRIPT_DIR}/backup-chromadb.sh" 2>/dev/null || true
    fi

    if ! [[ -x "${SCRIPT_DIR}/restore-chromadb.sh" ]]; then
        log_warn "restore-chromadb.sh is not executable, fixing..."
        chmod +x "${SCRIPT_DIR}/restore-chromadb.sh" 2>/dev/null || true
    fi

    log_success "All prerequisites met"
}

# Create test collection with known data
create_test_collection() {
    log_step "Creating test collection: ${TEST_COLLECTION_NAME}"

    # Create collection
    local create_response
    create_response=$(chromadb_curl POST "/api/v2/collections" \
        "{\"name\": \"${TEST_COLLECTION_NAME}\", \"metadata\": {\"test\": true}}" 2>&1) || {
        log_fail "Failed to create test collection"
        log_verbose "Response: $create_response"
        return 1
    }

    log_verbose "Collection created: $create_response"

    # Get collection ID
    local collection_id
    collection_id=$(echo "$create_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

    if [[ -z "$collection_id" ]]; then
        log_fail "Could not get collection ID"
        return 1
    fi

    log_verbose "Collection ID: $collection_id"

    # Add test documents
    local add_response
    add_response=$(chromadb_curl POST "/api/v2/collections/${collection_id}/add" \
        '{"ids": ["test-doc-1", "test-doc-2", "test-doc-3"], "documents": ["Test document one", "Test document two", "Test document three"], "metadatas": [{"index": 1}, {"index": 2}, {"index": 3}]}' 2>&1) || {
        log_fail "Failed to add test documents"
        log_verbose "Response: $add_response"
        return 1
    }

    log_verbose "Documents added"
    log_success "Test collection created with 3 documents"
}

# Verify test collection exists and has correct data
verify_test_collection() {
    local expected_count="${1:-3}"

    log_step "Verifying test collection"

    # Check collection exists
    local collections_response
    collections_response=$(chromadb_curl GET "/api/v2/collections" 2>&1) || {
        log_fail "Failed to list collections"
        return 1
    }

    if ! echo "$collections_response" | grep -q "\"name\":\"${TEST_COLLECTION_NAME}\""; then
        log_fail "Test collection '${TEST_COLLECTION_NAME}' not found"
        log_verbose "Collections: $collections_response"
        return 1
    fi

    # Get collection ID
    local collection_id
    collection_id=$(echo "$collections_response" | grep -o "\"id\":\"[^\"]*\",\"name\":\"${TEST_COLLECTION_NAME}\"" | head -1 | cut -d'"' -f4 || true)

    if [[ -z "$collection_id" ]]; then
        # Try alternative extraction
        collection_id=$(chromadb_curl GET "/api/v2/collections/${TEST_COLLECTION_NAME}" 2>&1 | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
    fi

    if [[ -z "$collection_id" ]]; then
        log_fail "Could not get collection ID for verification"
        return 1
    fi

    # Get document count
    local count_response
    count_response=$(chromadb_curl GET "/api/v2/collections/${collection_id}/count" 2>&1) || {
        log_fail "Failed to get document count"
        return 1
    }

    local actual_count
    actual_count=$(echo "$count_response" | grep -o '[0-9]*' | head -1 || echo "0")

    if [[ "$actual_count" != "$expected_count" ]]; then
        log_fail "Document count mismatch: expected $expected_count, got $actual_count"
        return 1
    fi

    log_success "Test collection verified: ${actual_count} documents"
}

# Create backup
create_backup() {
    log_step "Creating backup"

    mkdir -p "${TEST_BACKUP_DIR}"

    BACKUP_FILE=$("${SCRIPT_DIR}/backup-chromadb.sh" \
        --backup-dir "${TEST_BACKUP_DIR}" \
        --retention 0 \
        --quiet 2>&1 | tail -1)

    if [[ -z "$BACKUP_FILE" ]] || [[ ! -f "$BACKUP_FILE" ]]; then
        log_fail "Backup script did not create a backup file"
        log_verbose "Output: $BACKUP_FILE"
        return 1
    fi

    local backup_size
    backup_size=$(du -h "$BACKUP_FILE" | cut -f1)

    log_success "Backup created: $(basename "$BACKUP_FILE") ($backup_size)"
}

# Delete test collection (simulate data loss)
delete_test_collection() {
    log_step "Simulating data loss: deleting test collection"

    # Get collection ID first
    local collection_response
    collection_response=$(chromadb_curl GET "/api/v2/collections/${TEST_COLLECTION_NAME}" 2>&1) || {
        log_warn "Test collection not found (may have already been deleted)"
        return 0
    }

    local collection_id
    collection_id=$(echo "$collection_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)

    if [[ -n "$collection_id" ]]; then
        chromadb_curl DELETE "/api/v2/collections/${TEST_COLLECTION_NAME}" &>/dev/null || true
    fi

    # Verify deletion
    if chromadb_curl GET "/api/v2/collections/${TEST_COLLECTION_NAME}" &>/dev/null; then
        log_fail "Failed to delete test collection"
        return 1
    fi

    log_success "Test collection deleted (data loss simulated)"
}

# Restore from backup
restore_backup() {
    log_step "Restoring from backup"

    if [[ -z "$BACKUP_FILE" ]] || [[ ! -f "$BACKUP_FILE" ]]; then
        log_fail "No backup file to restore from"
        return 1
    fi

    "${SCRIPT_DIR}/restore-chromadb.sh" "$BACKUP_FILE" --yes --quiet 2>&1 || {
        log_fail "Restore script failed"
        return 1
    }

    # Wait for ChromaDB to be ready after restore
    local max_wait=30
    local waited=0
    while ! chromadb_curl GET "/api/v2/heartbeat" &>/dev/null; do
        if [[ $waited -ge $max_wait ]]; then
            log_fail "ChromaDB did not become healthy after restore"
            return 1
        fi
        sleep 1
        ((waited++))
    done

    log_success "Backup restored successfully"
}

# Cleanup test artifacts
cleanup() {
    if [[ "$KEEP_ARTIFACTS" == "true" ]]; then
        log_info "Keeping test artifacts (--keep flag set)"
        log_info "  Backup file: ${BACKUP_FILE:-none}"
        log_info "  Test collection: ${TEST_COLLECTION_NAME}"
        return 0
    fi

    log_step "Cleaning up test artifacts"

    # Delete test collection if it exists
    chromadb_curl DELETE "/api/v2/collections/${TEST_COLLECTION_NAME}" &>/dev/null || true

    # Delete backup file
    if [[ -n "$BACKUP_FILE" ]] && [[ -f "$BACKUP_FILE" ]]; then
        rm -f "$BACKUP_FILE"
        log_verbose "Deleted backup file: $BACKUP_FILE"
    fi

    # Delete test backup directory if empty
    rmdir "${TEST_BACKUP_DIR}" 2>/dev/null || true

    log_success "Cleanup completed"
}

# =============================================================================
# Argument Parsing
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -k|--keep)
                KEEP_ARTIFACTS=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
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

    echo ""
    echo "${CYAN}========================================${RESET}"
    echo "${CYAN}  Backup/Restore Verification Test${RESET}"
    echo "${CYAN}========================================${RESET}"
    echo ""
    echo "Test collection: ${TEST_COLLECTION_NAME}"
    echo "Backup directory: ${TEST_BACKUP_DIR}"
    echo ""

    # Setup trap for cleanup on exit
    trap cleanup EXIT

    # Run test phases
    check_prerequisites
    check_chromadb

    create_test_collection || { TEST_PASSED=false; }
    verify_test_collection 3 || { TEST_PASSED=false; }

    create_backup || { TEST_PASSED=false; }

    delete_test_collection || { TEST_PASSED=false; }

    # Verify collection is actually gone
    log_step "Verifying data loss"
    if chromadb_curl GET "/api/v2/collections/${TEST_COLLECTION_NAME}" &>/dev/null; then
        log_fail "Collection still exists after deletion"
        TEST_PASSED=false
    else
        log_success "Confirmed: test collection is gone"
    fi

    restore_backup || { TEST_PASSED=false; }

    # Verify data was restored
    verify_test_collection 3 || { TEST_PASSED=false; }

    # Final summary
    echo ""
    echo "${CYAN}========================================${RESET}"
    if [[ "$TEST_PASSED" == "true" ]]; then
        echo "${GREEN}  ALL TESTS PASSED${RESET}"
        echo "${CYAN}========================================${RESET}"
        echo ""
        exit 0
    else
        echo "${RED}  SOME TESTS FAILED${RESET}"
        echo "${CYAN}========================================${RESET}"
        echo ""
        exit 1
    fi
}

main "$@"
