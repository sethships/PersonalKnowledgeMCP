# Incremental Updates - GitHub Issues

**Created:** December 14, 2025
**Milestone:** Incremental Updates
**Total Issues:** 17 (including epic)

---

## Epic Issue

### Issue #XX: [EPIC] Incremental Updates Feature

**Labels:** `epic`, `enhancement`, `incremental-updates`

**Description:**
Enable incremental index updates when Pull Requests are merged to monitored GitHub repositories, eliminating the need for expensive full re-indexing operations.

**Background:**
Currently, the system only supports full repository indexing which takes 15-30 minutes for medium-sized repositories and consumes significant OpenAI API credits. This epic implements on-demand incremental updates that process only changed files, completing typical PR updates in under 1 minute.

**Architecture Document:** [incremental-updates-plan.md](../architecture/incremental-updates-plan.md)
**Implementation Roadmap:** [incremental-updates-roadmap.md](./incremental-updates-roadmap.md)

**Key Decisions (from Architecture Plan):**
- Update Triggering: On-demand via CLI (agent calls after PR merge)
- Processing: Sequential (one repository at a time)
- Large Change Threshold: 500 files triggers full re-index
- Force Push Handling: Detect and trigger full re-index
- Branch Tracking: Primary branch only (main/master)

**Success Criteria:**
- [ ] Agent can update index after merging PRs via CLI
- [ ] Updates complete in <1 minute for typical PRs (5-20 files)
- [ ] System recovers gracefully from all common error scenarios
- [ ] Full visibility into update operations via CLI and logs
- [ ] 90%+ test coverage for all new components

**Implementation Phases:**
1. **Foundation** (Issues #XX-XX): Core incremental update capability
2. **Observability** (Issues #XX-XX): History tracking and enhanced status
3. **Robustness** (Issues #XX-XX): Error handling and recovery

---

## Phase 1: Foundation Issues

### Issue: Repository Metadata Schema Extension

**Labels:** `enhancement`, `incremental-updates`, `phase-foundation`, `size:S`
**Priority:** P0
**Effort:** 2-4 hours
**Dependencies:** None

**Description:**
Extend the `RepositoryInfo` type to track commit SHA and update metadata required for incremental updates.

**Tasks:**
- [ ] Add `lastIndexedCommitSha?: string` field to RepositoryInfo type
- [ ] Add `lastIncrementalUpdateAt?: string` field
- [ ] Add `incrementalUpdateCount?: number` field
- [ ] Update `RepositoryMetadataStore` to handle new fields
- [ ] Ensure backward compatibility (existing repos load without error)
- [ ] Store commit SHA on initial full index
- [ ] Write unit tests for schema changes

**Acceptance Criteria:**
- [ ] New fields added to RepositoryInfo type in `src/types/`
- [ ] Existing repository metadata files load without errors
- [ ] New repositories store commit SHA after initial indexing
- [ ] Unit tests verify backward compatibility
- [ ] Test coverage >= 90% for changes

**Technical Notes:**
```typescript
interface RepositoryInfo {
  // Existing fields...

  // New fields for incremental updates
  lastIndexedCommitSha?: string;           // Git commit SHA of last indexed state
  lastIncrementalUpdateAt?: string;        // ISO timestamp of last incremental update
  incrementalUpdateCount?: number;         // Count of incremental updates since full index
}
```

---

### Issue: GitHub API Client for Change Detection

**Labels:** `enhancement`, `incremental-updates`, `phase-foundation`, `size:M`
**Priority:** P0
**Effort:** 4-6 hours
**Dependencies:** Repository Metadata Schema Extension

**Description:**
Create a GitHub API client service for detecting file changes between commits. This enables identifying which files need to be re-indexed when PRs are merged.

**Tasks:**
- [ ] Create `GitHubClient` service class in `src/services/`
- [ ] Implement `getHeadCommit(owner, repo, branch)` method
- [ ] Implement `compareCommits(owner, repo, base, head)` method
- [ ] Parse file change list with status (added/modified/deleted/renamed)
- [ ] Handle GitHub API authentication via existing `GITHUB_PAT`
- [ ] Implement error handling for rate limits and auth failures
- [ ] Write unit tests with mocked API responses

**Acceptance Criteria:**
- [ ] Can retrieve HEAD commit SHA for a branch
- [ ] Can compare two commits and get list of changed files
- [ ] Correctly handles renamed files (returns old and new paths)
- [ ] Returns structured `FileChange[]` array with status
- [ ] Graceful error handling for API failures
- [ ] Unit tests with mocked API responses achieve 90%+ coverage

**Technical Notes:**
```typescript
interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  previousPath?: string;  // For renames
}

// GitHub API endpoints used:
// GET /repos/{owner}/{repo}/commits/{branch} - Get HEAD commit
// GET /repos/{owner}/{repo}/compare/{base}...{head} - Compare commits
```

---

### Issue: ChromaDB Upsert and Delete Operations

**Labels:** `enhancement`, `incremental-updates`, `phase-foundation`, `size:M`
**Priority:** P0
**Effort:** 4-6 hours
**Dependencies:** None (can parallel with schema and GitHub API work)

**Description:**
Extend `ChromaStorageClient` with operations required for incremental updates: upsert (add or update), delete by ID, and query by metadata.

**Tasks:**
- [ ] Add `upsertDocuments()` method to ChromaStorageClient
- [ ] Add `deleteDocuments(ids: string[])` method
- [ ] Add `getDocumentsByMetadata(where: Record<string, any>)` method
- [ ] Implement delete-by-file-prefix logic (find and delete all chunks for a file)
- [ ] Ensure operations are idempotent (safe to retry)
- [ ] Write unit tests for new operations
- [ ] Write integration tests with real ChromaDB

**Acceptance Criteria:**
- [ ] Can upsert documents (add new or update existing)
- [ ] Can delete documents by ID list
- [ ] Can find all chunks for a specific file path using metadata filter
- [ ] Operations are idempotent (calling twice produces same result)
- [ ] Integration tests pass with real ChromaDB instance
- [ ] Test coverage >= 90% for new methods

**Technical Notes:**
```typescript
// ChromaDB operations to implement:
collection.upsert({ ids, embeddings, documents, metadatas });
collection.delete({ ids });
collection.get({ where: { repository: 'my-repo', file_path: 'src/index.ts' } });
```

---

### Issue: Incremental Update Pipeline

**Labels:** `enhancement`, `incremental-updates`, `phase-foundation`, `size:M`
**Priority:** P0
**Effort:** 6-8 hours
**Dependencies:** ChromaDB Upsert and Delete Operations

**Description:**
Create the pipeline service that processes file changes and updates the vector index accordingly. This is the core logic for handling added, modified, deleted, and renamed files.

**Tasks:**
- [ ] Create `IncrementalUpdatePipeline` service in `src/services/`
- [ ] Implement file change categorization
- [ ] Handle added files: read, chunk, embed, add to ChromaDB
- [ ] Handle modified files: delete old chunks, add new chunks
- [ ] Handle deleted files: delete all chunks for file
- [ ] Handle renamed files: delete old path chunks, add new path chunks
- [ ] Filter changes to relevant extensions only (respect include/exclude patterns)
- [ ] Return structured `UpdateResult` with statistics

**Acceptance Criteria:**
- [ ] Correctly processes all change types (added, modified, deleted, renamed)
- [ ] Only processes files matching repository include/exclude patterns
- [ ] Returns accurate statistics (files processed, chunks upserted/deleted)
- [ ] Handles empty change lists gracefully (no errors, no unnecessary operations)
- [ ] Unit tests cover each change type scenario
- [ ] Test coverage >= 90%

**Technical Notes:**
```typescript
interface UpdateResult {
  stats: {
    filesAdded: number;
    filesModified: number;
    filesDeleted: number;
    chunksUpserted: number;
    chunksDeleted: number;
    durationMs: number;
  };
  errors: { path: string; error: string }[];
}
```

Strategy for modified files: Delete all existing chunks for the file, then add all new chunks. This handles chunk count changes cleanly.

---

### Issue: Update Coordinator Service

**Labels:** `enhancement`, `incremental-updates`, `phase-foundation`, `size:M`
**Priority:** P0
**Effort:** 4-6 hours
**Dependencies:** GitHub API Client, Incremental Update Pipeline

**Description:**
Create the orchestration service that coordinates the full incremental update workflow, including change detection, local clone updates, and metadata management.

**Tasks:**
- [ ] Create `IncrementalUpdateCoordinator` service in `src/services/`
- [ ] Implement full update workflow orchestration
- [ ] Get repository metadata and parse GitHub owner/repo
- [ ] Fetch HEAD commit from GitHub API
- [ ] Compare with last indexed commit
- [ ] Handle "no changes" case (return early)
- [ ] Detect force push (commit not found) and trigger full re-index
- [ ] Check 500-file threshold and trigger full re-index if exceeded
- [ ] Update local clone (`git pull`)
- [ ] Call pipeline to process changes
- [ ] Update repository metadata with new commit SHA
- [ ] Return comprehensive update result

**Acceptance Criteria:**
- [ ] Full update workflow completes successfully for normal updates
- [ ] Correctly detects "no changes needed" and returns early
- [ ] Force push (404 on commit compare) triggers full re-index with warning
- [ ] Changes exceeding 500 files triggers full re-index with warning
- [ ] Updates `lastIndexedCommitSha` on successful completion
- [ ] Integration tests with real repository demonstrate end-to-end flow
- [ ] Test coverage >= 90%

**Technical Notes:**
Force push detection: GitHub Compare API returns 404 when base commit no longer exists. Catch this and trigger full re-index.

---

### Issue: CLI Update Commands

**Labels:** `enhancement`, `incremental-updates`, `phase-foundation`, `size:S`
**Priority:** P0
**Effort:** 3-4 hours
**Dependencies:** Update Coordinator Service

**Description:**
Implement CLI commands for triggering incremental updates, enabling agents and users to update the index after merging PRs.

**Tasks:**
- [ ] Implement `bun run cli update <repository>` command
- [ ] Add `--force` option to trigger full re-index instead of incremental
- [ ] Implement `bun run cli update-all` command for batch updates
- [ ] Display update results in user-friendly format
- [ ] Handle and display errors appropriately
- [ ] Add `--help` documentation for new commands

**Acceptance Criteria:**
- [ ] `update <repo>` triggers incremental update for specified repository
- [ ] `update <repo> --force` triggers full re-index
- [ ] `update-all` processes all repositories with status "ready" sequentially
- [ ] Clear output showing: commit range, files changed, chunks updated, duration
- [ ] Error messages are actionable and include next steps
- [ ] `--help` shows accurate documentation for all commands
- [ ] Commands integrate with existing CLI structure

**Technical Notes:**
Example output format:
```
Updating my-api...
  Commits: abc1234..def5678
  Files: +2 ~3 -1
  Chunks: +15 -8
  Duration: 847ms
```

---

### Issue: Foundation Phase Unit and Integration Tests

**Labels:** `testing`, `incremental-updates`, `phase-foundation`, `size:M`
**Priority:** P0
**Effort:** 4-6 hours
**Dependencies:** All Phase 1 Foundation issues

**Description:**
Ensure comprehensive test coverage for all Phase 1 Foundation components with both unit tests and integration tests.

**Tasks:**
- [ ] Unit tests for GitHubClient with mocked API responses
- [ ] Unit tests for ChromaStorageClient new methods
- [ ] Unit tests for IncrementalUpdatePipeline
- [ ] Unit tests for IncrementalUpdateCoordinator
- [ ] Integration tests for end-to-end update flow
- [ ] Create mock fixtures for GitHub API responses
- [ ] Verify test coverage >= 90% for all new code
- [ ] Update CI/CD pipeline to run new tests

**Acceptance Criteria:**
- [ ] All new services have comprehensive unit tests
- [ ] Integration test validates complete update workflow
- [ ] Test coverage report shows >= 90% for new code
- [ ] All tests pass in CI/CD pipeline
- [ ] No flaky tests (tests pass consistently)
- [ ] Mock fixtures are realistic and cover edge cases

---

## Phase 2: Observability Issues

### Issue: Update History Tracking

**Labels:** `enhancement`, `incremental-updates`, `phase-observability`, `size:S`
**Priority:** P1
**Effort:** 3-4 hours
**Dependencies:** Phase 1 Foundation complete

**Description:**
Track update history per repository to provide visibility into past update operations, enabling troubleshooting and audit capabilities.

**Tasks:**
- [ ] Add `updateHistory` array field to RepositoryInfo type
- [ ] Define `UpdateHistoryEntry` type with: timestamp, commit range, stats, errors
- [ ] Track last N updates (configurable via env var, default 20)
- [ ] Record each update in history on completion
- [ ] Implement history rotation (drop oldest when limit reached)
- [ ] Persist history across service restarts
- [ ] Write unit tests for history management

**Acceptance Criteria:**
- [ ] Updates are recorded in repository history
- [ ] History persists across service restarts
- [ ] Old entries are rotated out when limit exceeded
- [ ] History includes: timestamp, commit range, file counts, duration, error count
- [ ] Test coverage >= 90%

**Technical Notes:**
```typescript
interface UpdateHistoryEntry {
  timestamp: string;              // ISO timestamp
  previousCommit: string;
  newCommit: string;
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  chunksUpserted: number;
  chunksDeleted: number;
  durationMs: number;
  errorCount: number;
  status: 'success' | 'partial' | 'failed';
}
```

---

### Issue: CLI History Command

**Labels:** `enhancement`, `incremental-updates`, `phase-observability`, `size:S`
**Priority:** P1
**Effort:** 2-3 hours
**Dependencies:** Update History Tracking

**Description:**
Implement CLI command to view update history for a repository, enabling users to see past updates and diagnose issues.

**Tasks:**
- [ ] Implement `bun run cli history <repository>` command
- [ ] Add `--limit N` option to show last N updates (default: 10)
- [ ] Display history in readable tabular format
- [ ] Show: timestamp, commit range, files changed, duration, status
- [ ] Handle repositories with no update history gracefully
- [ ] Add `--help` documentation

**Acceptance Criteria:**
- [ ] `history <repo>` shows update history for repository
- [ ] `--limit` option controls number of entries shown
- [ ] Output is well-formatted and readable
- [ ] Handles empty history gracefully (informative message)
- [ ] Error handling for non-existent repository

**Technical Notes:**
Example output:
```
Update History for my-api (last 5 updates):

Timestamp            Commits           Files    Chunks   Duration  Status
2025-12-14 10:30    abc12..def56      +2 ~1    +8 -3    523ms     success
2025-12-14 09:15    789ab..abc12      ~5       +12 -12  891ms     success
...
```

---

### Issue: Enhanced Status Command with Update Information

**Labels:** `enhancement`, `incremental-updates`, `phase-observability`, `size:S`
**Priority:** P1
**Effort:** 2-3 hours
**Dependencies:** Phase 1 Foundation complete

**Description:**
Enhance the existing `status` CLI command to show incremental update information, making it easy to see if repositories are up-to-date.

**Tasks:**
- [ ] Add last indexed commit SHA to status output
- [ ] Add last update timestamp to status output
- [ ] Add incremental update count to status output
- [ ] Show visual indicator if repository may have pending updates
- [ ] Add `--check` option to query GitHub for new commits
- [ ] Update `--help` documentation

**Acceptance Criteria:**
- [ ] Status output includes update-related metadata for each repository
- [ ] Can see at a glance which repos have been recently updated
- [ ] `--check` option shows if repos have commits newer than indexed
- [ ] Clear visual indication of update status (up-to-date, updates available, etc.)

**Technical Notes:**
Example enhanced status output:
```
Repository Status:

Name      Files   Chunks   Last Index    Last Commit   Updates   Status
my-api    234     1,892    2h ago        abc1234       12        up-to-date
lib-util  89      456      1d ago        def5678       3         updates available
```

---

### Issue: Structured Logging for Update Operations

**Labels:** `enhancement`, `incremental-updates`, `phase-observability`, `size:S`
**Priority:** P1
**Effort:** 2-3 hours
**Dependencies:** Phase 1 Foundation complete

**Description:**
Add comprehensive structured logging throughout the update pipeline for debugging and operational visibility.

**Tasks:**
- [ ] Add structured logging to GitHubClient (API calls, responses, errors)
- [ ] Add structured logging to IncrementalUpdatePipeline (file processing)
- [ ] Add structured logging to UpdateCoordinator (workflow orchestration)
- [ ] Include trace/correlation ID in all related log entries
- [ ] Ensure log levels are appropriate (info, warn, error, debug)
- [ ] Document log format and fields in troubleshooting guide

**Acceptance Criteria:**
- [ ] All update operations are logged with structured data
- [ ] Can trace a single update through logs using correlation ID
- [ ] Sensitive data (tokens, credentials) never logged
- [ ] Log levels correctly reflect severity
- [ ] Documentation describes log format and common entries

**Technical Notes:**
Log format should include:
- timestamp
- level
- message
- correlationId (for tracing)
- repository (when applicable)
- operation (e.g., "github_compare", "chroma_upsert")
- duration (for timed operations)
- error details (for failures)

---

### Issue: Update Metrics Tracking

**Labels:** `enhancement`, `incremental-updates`, `phase-observability`, `size:S`
**Priority:** P2
**Effort:** 2-3 hours
**Dependencies:** Phase 1 Foundation complete

**Description:**
Track aggregate metrics across update operations for performance monitoring and trend analysis.

**Tasks:**
- [ ] Define metrics to track: total updates, avg duration, error rate, etc.
- [ ] Store aggregate metrics in system metadata
- [ ] Calculate metrics on-demand from update history
- [ ] Display metrics in status command output
- [ ] Persist metrics across restarts

**Acceptance Criteria:**
- [ ] Metrics accurately reflect update history
- [ ] Metrics visible in CLI status output
- [ ] Metrics persist across service restarts

**Technical Notes:**
Metrics to track:
- Total incremental updates (all time)
- Average update duration
- Total files processed
- Total chunks modified
- Error rate (failed/total)
- Last 7-day trend

---

## Phase 3: Robustness Issues

### Issue: Interrupted Update Detection

**Labels:** `enhancement`, `incremental-updates`, `phase-robustness`, `size:S`
**Priority:** P1
**Effort:** 3-4 hours
**Dependencies:** Phase 2 complete

**Description:**
Detect interrupted updates (e.g., service crash mid-update) and provide recovery options to prevent data inconsistency.

**Tasks:**
- [ ] Add `updateInProgress: boolean` field to repository metadata
- [ ] Add `updateStartedAt: string` field to track when update began
- [ ] Set flag at update start, clear on completion (success or failure)
- [ ] Detect interrupted updates on service startup
- [ ] Log warning when interrupted update detected
- [ ] Provide recovery options (continue, reset, full re-index)

**Acceptance Criteria:**
- [ ] Updates are marked as in-progress during execution
- [ ] Interrupted updates are detected on next operation
- [ ] Clear notification/warning when interrupted update found
- [ ] Recovery path prevents data corruption

---

### Issue: Interrupted Update Recovery

**Labels:** `enhancement`, `incremental-updates`, `phase-robustness`, `size:S`
**Priority:** P1
**Effort:** 3-4 hours
**Dependencies:** Interrupted Update Detection

**Description:**
Implement recovery logic for interrupted updates, ensuring the system can return to a consistent state.

**Tasks:**
- [ ] Implement recovery logic that evaluates interrupted state
- [ ] Option 1: Complete interrupted update if changes still identifiable
- [ ] Option 2: Trigger full re-index if state unrecoverable
- [ ] Add CLI command to manually reset stuck updates
- [ ] Add detailed logging for recovery actions
- [ ] Write tests for recovery scenarios

**Acceptance Criteria:**
- [ ] Can recover from typical interruptions automatically
- [ ] Clear notification when recovery action taken
- [ ] Manual reset option available via CLI (`bun run cli reset-update <repo>`)
- [ ] No silent data inconsistencies
- [ ] Recovery logic tested with simulated interruptions

---

### Issue: Retry Logic with Exponential Backoff

**Labels:** `enhancement`, `incremental-updates`, `phase-robustness`, `size:S`
**Priority:** P1
**Effort:** 2-3 hours
**Dependencies:** Phase 1 Foundation complete

**Description:**
Implement retry logic with exponential backoff for transient failures in external API calls.

**Tasks:**
- [ ] Create generic retry utility function with exponential backoff
- [ ] Configure: max retries, initial delay, max delay, backoff multiplier
- [ ] Apply to GitHub API calls
- [ ] Apply to OpenAI embedding API calls
- [ ] Apply to ChromaDB operations
- [ ] Add retry configuration via environment variables
- [ ] Log retry attempts with details

**Acceptance Criteria:**
- [ ] Transient failures are retried automatically
- [ ] Exponential backoff prevents rate limit exhaustion
- [ ] Max retries prevents infinite loops
- [ ] Non-retryable errors (4xx) fail immediately
- [ ] Retry attempts are logged
- [ ] Configurable retry parameters

**Technical Notes:**
```typescript
interface RetryConfig {
  maxRetries: number;           // default: 3
  initialDelayMs: number;       // default: 1000
  maxDelayMs: number;           // default: 60000
  backoffMultiplier: number;    // default: 2
}
```

---

### Issue: Partial Failure Handling

**Labels:** `enhancement`, `incremental-updates`, `phase-robustness`, `size:S`
**Priority:** P1
**Effort:** 3-4 hours
**Dependencies:** Phase 1 Foundation complete

**Description:**
Handle individual file failures gracefully, allowing the update to continue and reporting all failures at the end.

**Tasks:**
- [ ] Continue processing when individual files fail
- [ ] Collect errors without stopping pipeline
- [ ] Determine when to commit partial progress vs rollback
- [ ] Report all failures at end with actionable details
- [ ] Record partial success status in update history
- [ ] Document expected user actions for common failures

**Acceptance Criteria:**
- [ ] Single file failure does not abort entire update
- [ ] All failures reported clearly at end of update
- [ ] Partial progress saved when appropriate
- [ ] User can identify and address specific failures
- [ ] Update history shows partial success status when applicable

---

### Issue: Comprehensive Error Handling Tests

**Labels:** `testing`, `incremental-updates`, `phase-robustness`, `size:M`
**Priority:** P1
**Effort:** 3-4 hours
**Dependencies:** All Phase 3 error handling issues

**Description:**
Create comprehensive test coverage for all error handling scenarios to ensure robust behavior.

**Tasks:**
- [ ] Test interrupted update detection and recovery
- [ ] Test retry logic behavior (success after retry, max retries exceeded)
- [ ] Test partial failure handling
- [ ] Test threshold-triggered full re-index (>500 files)
- [ ] Test force push detection and re-index trigger
- [ ] Test network/API failures at various points
- [ ] Test concurrent update prevention

**Acceptance Criteria:**
- [ ] All error handling code paths have test coverage
- [ ] Tests simulate realistic failure scenarios
- [ ] Tests verify correct behavior (not just no crashes)
- [ ] Coverage >= 90% for error handling code

---

### Issue: Documentation Updates for Incremental Updates

**Labels:** `documentation`, `incremental-updates`, `phase-robustness`, `size:S`
**Priority:** P1
**Effort:** 2-3 hours
**Dependencies:** All above issues complete

**Description:**
Update project documentation to cover the incremental updates feature comprehensively.

**Tasks:**
- [ ] Update README with new CLI commands (update, update-all, history)
- [ ] Create troubleshooting guide section for incremental updates
- [ ] Document common error messages and resolutions
- [ ] Update architecture documentation to reflect implementation
- [ ] Add workflow examples (e.g., post-PR update flow)
- [ ] Update CLI help text to be comprehensive

**Acceptance Criteria:**
- [ ] All new commands documented in README
- [ ] Troubleshooting guide covers common errors
- [ ] Architecture docs accurately reflect implementation
- [ ] Users can self-serve for basic troubleshooting
- [ ] Examples show typical usage patterns

---

## Issue Creation Summary

| Phase | Issue Count | Priority Mix |
|-------|-------------|--------------|
| Foundation | 7 + 1 epic | All P0 |
| Observability | 5 | P1, P2 |
| Robustness | 6 | All P1 |
| **Total** | **18** | |

---

*Document generated: December 14, 2025*
