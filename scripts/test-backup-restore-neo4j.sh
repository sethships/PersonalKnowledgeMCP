#!/bin/bash
#
# test-backup-restore-neo4j.sh - Neo4j Backup/Restore Verification Test Script
#
# Tests the backup and restore scripts by:
# 1. Verifying Neo4j is running
# 2. Creating test data (test node with known properties)
# 3. Creating a backup
# 4. Deleting the test data (simulating data loss)
# 5. Restoring from backup
# 6. Verifying test data integrity
# 7. Cleaning up
#
# Usage:
#   ./test-backup-restore-neo4j.sh [options]
#
# Options:
#   -k, --keep          Keep test artifacts (backup file, test data)
#   -v, --verbose       Show detailed output
#   -h, --help          Show this help message
#
# Prerequisites:
#   - Neo4j container running and healthy
#   - NEO4J_PASSWORD environment variable set (or in .env file)
#
# Environment Variables:
#   NEO4J_USER          Neo4j username (default: neo4j)
#   NEO4J_PASSWORD      Neo4j password (required)
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
TEST_NODE_ID="test_backup_restore_$(date +%s)"
TEST_BACKUP_DIR="${SCRIPT_DIR}/../.test-backups"
NEO4J_CONTAINER="pk-mcp-neo4j"

# Authentication - check for token in environment or .env file
NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-}"
if [[ -z "$NEO4J_PASSWORD" ]] && [[ -f "${SCRIPT_DIR}/../.env" ]]; then
    NEO4J_PASSWORD=$(grep -E '^NEO4J_PASSWORD=' "${SCRIPT_DIR}/../.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || true)
fi

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
    head -35 "$0" | grep "^#" | sed 's/^#//' | sed 's/^ //'
}

# Execute cypher query via docker exec
run_cypher() {
    local query="$1"
    docker exec "$NEO4J_CONTAINER" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "$query" 2>&1
}

# Check if Neo4j is accessible
check_neo4j() {
    log_step "Checking Neo4j availability"

    # Check if container is running
    if ! docker ps --format '{{.Names}}' | grep -q "$NEO4J_CONTAINER"; then
        log_fail "Neo4j container '$NEO4J_CONTAINER' is not running"
        echo "Please ensure the Neo4j container is running:"
        echo "  docker compose --profile default up -d neo4j"
        exit 2
    fi

    # Check if we can connect
    if ! run_cypher "RETURN 1" &>/dev/null; then
        log_fail "Cannot connect to Neo4j"
        echo "Please ensure NEO4J_PASSWORD is set correctly"
        exit 2
    fi

    log_success "Neo4j is running and healthy"
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites"

    if [[ -z "$NEO4J_PASSWORD" ]]; then
        log_fail "NEO4J_PASSWORD is not set"
        echo "Please set NEO4J_PASSWORD environment variable or add it to .env file"
        exit 2
    fi
    log_verbose "NEO4J_PASSWORD: [set]"

    if ! command -v docker &>/dev/null; then
        log_fail "docker is not installed"
        exit 2
    fi
    log_verbose "docker: OK"

    if ! [[ -x "${SCRIPT_DIR}/backup-neo4j.sh" ]]; then
        log_warn "backup-neo4j.sh is not executable, fixing..."
        chmod +x "${SCRIPT_DIR}/backup-neo4j.sh" 2>/dev/null || true
    fi

    if ! [[ -x "${SCRIPT_DIR}/restore-neo4j.sh" ]]; then
        log_warn "restore-neo4j.sh is not executable, fixing..."
        chmod +x "${SCRIPT_DIR}/restore-neo4j.sh" 2>/dev/null || true
    fi

    log_success "All prerequisites met"
}

# Create test node with known data
create_test_data() {
    log_step "Creating test data: Node with id '${TEST_NODE_ID}'"

    local result
    result=$(run_cypher "CREATE (n:TestBackup {id: '${TEST_NODE_ID}', value: 42, created_at: datetime()}) RETURN n.id AS id" 2>&1) || {
        log_fail "Failed to create test node"
        log_verbose "Response: $result"
        return 1
    }

    log_verbose "Create result: $result"

    # Verify the node was created
    if ! echo "$result" | grep -q "$TEST_NODE_ID"; then
        log_fail "Test node creation could not be verified"
        return 1
    fi

    log_success "Test node created with id '${TEST_NODE_ID}'"
}

# Verify test data exists and has correct values
verify_test_data() {
    log_step "Verifying test data"

    local result
    result=$(run_cypher "MATCH (n:TestBackup {id: '${TEST_NODE_ID}'}) RETURN n.id AS id, n.value AS value" 2>&1) || {
        log_fail "Failed to query test node"
        log_verbose "Response: $result"
        return 1
    }

    log_verbose "Query result: $result"

    # Check if node exists
    if ! echo "$result" | grep -q "$TEST_NODE_ID"; then
        log_fail "Test node '${TEST_NODE_ID}' not found"
        return 1
    fi

    # Check if value is correct
    if ! echo "$result" | grep -q "42"; then
        log_fail "Test node value mismatch (expected 42)"
        return 1
    fi

    log_success "Test node verified: id='${TEST_NODE_ID}', value=42"
}

# Create backup
create_backup() {
    log_step "Creating backup"

    mkdir -p "${TEST_BACKUP_DIR}"

    # Export password for the backup script
    export NEO4J_PASSWORD

    BACKUP_FILE=$("${SCRIPT_DIR}/backup-neo4j.sh" \
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

# Delete test data (simulate data loss)
delete_test_data() {
    log_step "Simulating data loss: deleting test node"

    local result
    result=$(run_cypher "MATCH (n:TestBackup {id: '${TEST_NODE_ID}'}) DELETE n RETURN count(n) AS deleted" 2>&1) || {
        log_warn "Failed to delete test node (may have already been deleted)"
        return 0
    }

    log_verbose "Delete result: $result"

    # Verify deletion
    local verify_result
    verify_result=$(run_cypher "MATCH (n:TestBackup {id: '${TEST_NODE_ID}'}) RETURN count(n) AS count" 2>&1) || true

    if echo "$verify_result" | grep -q "0"; then
        log_success "Test node deleted (data loss simulated)"
    else
        log_fail "Failed to delete test node"
        return 1
    fi
}

# Restore from backup
restore_backup() {
    log_step "Restoring from backup"

    if [[ -z "$BACKUP_FILE" ]] || [[ ! -f "$BACKUP_FILE" ]]; then
        log_fail "No backup file to restore from"
        return 1
    fi

    # Export password for the restore script
    export NEO4J_PASSWORD

    "${SCRIPT_DIR}/restore-neo4j.sh" "$BACKUP_FILE" --yes --quiet 2>&1 || {
        log_fail "Restore script failed"
        return 1
    }

    # Wait for Neo4j to be ready after restore
    local max_wait=60
    local waited=0
    log_info "Waiting for Neo4j to be ready after restore..."

    while ! run_cypher "RETURN 1" &>/dev/null; do
        if [[ $waited -ge $max_wait ]]; then
            log_fail "Neo4j did not become healthy after restore"
            return 1
        fi
        sleep 2
        ((waited += 2))
    done

    log_success "Backup restored successfully"
}

# Cleanup test artifacts
cleanup() {
    if [[ "$KEEP_ARTIFACTS" == "true" ]]; then
        log_info "Keeping test artifacts (--keep flag set)"
        log_info "  Backup file: ${BACKUP_FILE:-none}"
        log_info "  Test node id: ${TEST_NODE_ID}"
        return 0
    fi

    log_step "Cleaning up test artifacts"

    # Delete test node if it exists
    run_cypher "MATCH (n:TestBackup {id: '${TEST_NODE_ID}'}) DELETE n" &>/dev/null || true
    log_verbose "Deleted test node (if exists)"

    # Delete backup file and associated files
    if [[ -n "$BACKUP_FILE" ]] && [[ -f "$BACKUP_FILE" ]]; then
        rm -f "$BACKUP_FILE"
        rm -f "${BACKUP_FILE}.sha256" 2>/dev/null || true
        rm -f "${BACKUP_FILE%.tar.gz}.metadata.json" 2>/dev/null || true
        log_verbose "Deleted backup files"
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
    echo "${CYAN}  Neo4j Backup/Restore Verification Test${RESET}"
    echo "${CYAN}========================================${RESET}"
    echo ""
    echo "Test node id: ${TEST_NODE_ID}"
    echo "Backup directory: ${TEST_BACKUP_DIR}"
    echo ""

    # Setup trap for cleanup on exit
    trap cleanup EXIT

    # Run test phases
    check_prerequisites
    check_neo4j

    create_test_data || { TEST_PASSED=false; }
    verify_test_data || { TEST_PASSED=false; }

    create_backup || { TEST_PASSED=false; }

    delete_test_data || { TEST_PASSED=false; }

    # Verify data is actually gone
    log_step "Verifying data loss"
    local verify_result
    verify_result=$(run_cypher "MATCH (n:TestBackup {id: '${TEST_NODE_ID}'}) RETURN count(n) AS count" 2>&1) || true

    if echo "$verify_result" | grep -q "0"; then
        log_success "Confirmed: test node is gone"
    else
        log_fail "Node still exists after deletion"
        TEST_PASSED=false
    fi

    restore_backup || { TEST_PASSED=false; }

    # Verify data was restored
    verify_test_data || { TEST_PASSED=false; }

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
