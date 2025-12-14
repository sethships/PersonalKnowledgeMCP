# PowerShell script to create GitHub issues for Incremental Updates feature
# Repository: sethb75/PersonalKnowledgeMCP
# Run this script from the repository root directory

$ErrorActionPreference = "Stop"

Write-Host "Creating GitHub milestone and issues for Incremental Updates feature..." -ForegroundColor Cyan

# First, create the milestone
Write-Host "`nCreating milestone: Incremental Updates" -ForegroundColor Yellow
$milestoneResult = gh api repos/sethb75/PersonalKnowledgeMCP/milestones -X POST -f title="Incremental Updates" -f description="Enable incremental index updates when PRs are merged to monitored repositories. Implements on-demand triggered updates via CLI commands, eliminating expensive full re-indexing for typical PR changes." -f due_on="2025-01-31T00:00:00Z" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Milestone created successfully" -ForegroundColor Green
    $milestone = $milestoneResult | ConvertFrom-Json
    $milestoneNumber = $milestone.number
} else {
    # Check if milestone already exists
    $existingMilestones = gh api repos/sethb75/PersonalKnowledgeMCP/milestones | ConvertFrom-Json
    $existingMilestone = $existingMilestones | Where-Object { $_.title -eq "Incremental Updates" }
    if ($existingMilestone) {
        Write-Host "Milestone already exists (number: $($existingMilestone.number))" -ForegroundColor Yellow
        $milestoneNumber = $existingMilestone.number
    } else {
        Write-Host "Warning: Could not create or find milestone" -ForegroundColor Red
        $milestoneNumber = $null
    }
}

# Create labels if they don't exist
Write-Host "`nCreating labels..." -ForegroundColor Yellow
$labels = @(
    @{name="incremental-updates"; color="0E8A16"; description="Incremental updates feature area"},
    @{name="phase-foundation"; color="1D76DB"; description="Phase 1 Foundation work"},
    @{name="phase-observability"; color="5319E7"; description="Phase 2 Observability work"},
    @{name="phase-robustness"; color="FBCA04"; description="Phase 3 Robustness work"},
    @{name="size:S"; color="C2E0C6"; description="Small: 2-4 hours effort"},
    @{name="size:M"; color="FEF2C0"; description="Medium: 4-8 hours effort"},
    @{name="size:L"; color="F9D0C4"; description="Large: 8+ hours effort"}
)

foreach ($label in $labels) {
    $result = gh label create $label.name --color $label.color --description $label.description 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Created label: $($label.name)" -ForegroundColor Green
    } else {
        Write-Host "  Label exists: $($label.name)" -ForegroundColor Gray
    }
}

# Helper function to create issue
function Create-Issue {
    param (
        [string]$Title,
        [string]$Body,
        [string[]]$Labels,
        [int]$Milestone = $null
    )

    $labelArg = ($Labels -join ",")

    if ($Milestone) {
        $result = gh issue create --title $Title --body $Body --label $labelArg --milestone $Milestone
    } else {
        $result = gh issue create --title $Title --body $Body --label $labelArg
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Created: $Title" -ForegroundColor Green
        return $result
    } else {
        Write-Host "  Failed: $Title" -ForegroundColor Red
        return $null
    }
}

Write-Host "`n=== Creating Epic Issue ===" -ForegroundColor Cyan

$epicBody = @"
## Summary

Enable incremental index updates when Pull Requests are merged to monitored GitHub repositories, eliminating the need for expensive full re-indexing operations.

## Background

Currently, the system only supports full repository indexing which takes 15-30 minutes for medium-sized repositories and consumes significant OpenAI API credits. This epic implements on-demand incremental updates that process only changed files, completing typical PR updates in under 1 minute.

## Architecture Documents

- [incremental-updates-plan.md](docs/architecture/incremental-updates-plan.md) - Approved architecture plan
- [incremental-updates-roadmap.md](docs/pm/incremental-updates-roadmap.md) - Implementation roadmap

## Key Decisions (from Architecture Plan)

| Decision | Choice |
|----------|--------|
| Update Triggering | On-demand via CLI (agent calls after PR merge) |
| Processing Model | Sequential (one repository at a time) |
| Large Change Threshold | 500 files triggers full re-index |
| Force Push Handling | Detect and trigger full re-index |
| Branch Tracking | Primary branch only (main/master) |

## Success Criteria

- [ ] Agent can update index after merging PRs via CLI
- [ ] Updates complete in <1 minute for typical PRs (5-20 files)
- [ ] System recovers gracefully from all common error scenarios
- [ ] Full visibility into update operations via CLI and logs
- [ ] 90%+ test coverage for all new components

## Implementation Phases

### Phase 1: Foundation (Issues TBD)
Core incremental update capability with CLI commands

### Phase 2: Observability (Issues TBD)
History tracking, metrics, and enhanced status

### Phase 3: Robustness (Issues TBD)
Error handling, recovery, and production hardening

## Related Issues

_Links to be updated as child issues are created_
"@

$epicIssue = Create-Issue -Title "[EPIC] Incremental Updates Feature" -Body $epicBody -Labels @("epic", "enhancement", "incremental-updates") -Milestone $milestoneNumber

Write-Host "`n=== Creating Phase 1: Foundation Issues ===" -ForegroundColor Cyan

# Issue 1.1: Repository Metadata Schema Extension
$body11 = @"
## Summary

Extend the ``RepositoryInfo`` type to track commit SHA and update metadata required for incremental updates.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Foundation
Priority: P0
Effort: 2-4 hours

## Tasks

- [ ] Add ``lastIndexedCommitSha?: string`` field to RepositoryInfo type
- [ ] Add ``lastIncrementalUpdateAt?: string`` field
- [ ] Add ``incrementalUpdateCount?: number`` field
- [ ] Update ``RepositoryMetadataStore`` to handle new fields
- [ ] Ensure backward compatibility (existing repos load without error)
- [ ] Store commit SHA on initial full index
- [ ] Write unit tests for schema changes

## Acceptance Criteria

- [ ] New fields added to RepositoryInfo type in ``src/types/``
- [ ] Existing repository metadata files load without errors
- [ ] New repositories store commit SHA after initial indexing
- [ ] Unit tests verify backward compatibility
- [ ] Test coverage >= 90% for changes

## Technical Notes

``````typescript
interface RepositoryInfo {
  // Existing fields...

  // New fields for incremental updates
  lastIndexedCommitSha?: string;           // Git commit SHA of last indexed state
  lastIncrementalUpdateAt?: string;        // ISO timestamp of last incremental update
  incrementalUpdateCount?: number;         // Count of incremental updates since full index
}
``````

## Dependencies

None - can start immediately

## Definition of Done

- Code implemented and passing all tests
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Repository Metadata Schema Extension" -Body $body11 -Labels @("enhancement", "incremental-updates", "phase-foundation", "size:S") -Milestone $milestoneNumber

# Issue 1.2: GitHub API Client for Change Detection
$body12 = @"
## Summary

Create a GitHub API client service for detecting file changes between commits. This enables identifying which files need to be re-indexed when PRs are merged.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Foundation
Priority: P0
Effort: 4-6 hours

## Tasks

- [ ] Create ``GitHubClient`` service class in ``src/services/``
- [ ] Implement ``getHeadCommit(owner, repo, branch)`` method
- [ ] Implement ``compareCommits(owner, repo, base, head)`` method
- [ ] Parse file change list with status (added/modified/deleted/renamed)
- [ ] Handle GitHub API authentication via existing ``GITHUB_PAT``
- [ ] Implement error handling for rate limits and auth failures
- [ ] Write unit tests with mocked API responses

## Acceptance Criteria

- [ ] Can retrieve HEAD commit SHA for a branch
- [ ] Can compare two commits and get list of changed files
- [ ] Correctly handles renamed files (returns old and new paths)
- [ ] Returns structured ``FileChange[]`` array with status
- [ ] Graceful error handling for API failures
- [ ] Unit tests with mocked API responses achieve 90%+ coverage

## Technical Notes

``````typescript
interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  previousPath?: string;  // For renames
}

// GitHub API endpoints used:
// GET /repos/{owner}/{repo}/commits/{branch} - Get HEAD commit
// GET /repos/{owner}/{repo}/compare/{base}...{head} - Compare commits
``````

## Dependencies

- Depends on: Repository Metadata Schema Extension

## Definition of Done

- Code implemented and passing all tests
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "GitHub API Client for Change Detection" -Body $body12 -Labels @("enhancement", "incremental-updates", "phase-foundation", "size:M") -Milestone $milestoneNumber

# Issue 1.3: ChromaDB Upsert and Delete Operations
$body13 = @"
## Summary

Extend ``ChromaStorageClient`` with operations required for incremental updates: upsert (add or update), delete by ID, and query by metadata.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Foundation
Priority: P0
Effort: 4-6 hours

## Tasks

- [ ] Add ``upsertDocuments()`` method to ChromaStorageClient
- [ ] Add ``deleteDocuments(ids: string[])`` method
- [ ] Add ``getDocumentsByMetadata(where: Record<string, any>)`` method
- [ ] Implement delete-by-file-prefix logic (find and delete all chunks for a file)
- [ ] Ensure operations are idempotent (safe to retry)
- [ ] Write unit tests for new operations
- [ ] Write integration tests with real ChromaDB

## Acceptance Criteria

- [ ] Can upsert documents (add new or update existing)
- [ ] Can delete documents by ID list
- [ ] Can find all chunks for a specific file path using metadata filter
- [ ] Operations are idempotent (calling twice produces same result)
- [ ] Integration tests pass with real ChromaDB instance
- [ ] Test coverage >= 90% for new methods

## Technical Notes

``````typescript
// ChromaDB operations to implement:
collection.upsert({ ids, embeddings, documents, metadatas });
collection.delete({ ids });
collection.get({ where: { repository: 'my-repo', file_path: 'src/index.ts' } });
``````

## Dependencies

None - can start immediately (parallel with schema and GitHub API work)

## Definition of Done

- Code implemented and passing all tests
- Integration tests with real ChromaDB passing
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "ChromaDB Upsert and Delete Operations" -Body $body13 -Labels @("enhancement", "incremental-updates", "phase-foundation", "size:M") -Milestone $milestoneNumber

# Issue 1.4: Incremental Update Pipeline
$body14 = @"
## Summary

Create the pipeline service that processes file changes and updates the vector index accordingly. This is the core logic for handling added, modified, deleted, and renamed files.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Foundation
Priority: P0
Effort: 6-8 hours

## Tasks

- [ ] Create ``IncrementalUpdatePipeline`` service in ``src/services/``
- [ ] Implement file change categorization
- [ ] Handle added files: read, chunk, embed, add to ChromaDB
- [ ] Handle modified files: delete old chunks, add new chunks
- [ ] Handle deleted files: delete all chunks for file
- [ ] Handle renamed files: delete old path chunks, add new path chunks
- [ ] Filter changes to relevant extensions only (respect include/exclude patterns)
- [ ] Return structured ``UpdateResult`` with statistics

## Acceptance Criteria

- [ ] Correctly processes all change types (added, modified, deleted, renamed)
- [ ] Only processes files matching repository include/exclude patterns
- [ ] Returns accurate statistics (files processed, chunks upserted/deleted)
- [ ] Handles empty change lists gracefully (no errors, no unnecessary operations)
- [ ] Unit tests cover each change type scenario
- [ ] Test coverage >= 90%

## Technical Notes

``````typescript
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
``````

Strategy for modified files: Delete all existing chunks for the file, then add all new chunks. This handles chunk count changes cleanly.

## Dependencies

- Depends on: ChromaDB Upsert and Delete Operations

## Definition of Done

- Code implemented and passing all tests
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Incremental Update Pipeline" -Body $body14 -Labels @("enhancement", "incremental-updates", "phase-foundation", "size:M") -Milestone $milestoneNumber

# Issue 1.5: Update Coordinator Service
$body15 = @"
## Summary

Create the orchestration service that coordinates the full incremental update workflow, including change detection, local clone updates, and metadata management.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Foundation
Priority: P0
Effort: 4-6 hours

## Tasks

- [ ] Create ``IncrementalUpdateCoordinator`` service in ``src/services/``
- [ ] Implement full update workflow orchestration
- [ ] Get repository metadata and parse GitHub owner/repo
- [ ] Fetch HEAD commit from GitHub API
- [ ] Compare with last indexed commit
- [ ] Handle "no changes" case (return early)
- [ ] Detect force push (commit not found) and trigger full re-index
- [ ] Check 500-file threshold and trigger full re-index if exceeded
- [ ] Update local clone (``git pull``)
- [ ] Call pipeline to process changes
- [ ] Update repository metadata with new commit SHA
- [ ] Return comprehensive update result

## Acceptance Criteria

- [ ] Full update workflow completes successfully for normal updates
- [ ] Correctly detects "no changes needed" and returns early
- [ ] Force push (404 on commit compare) triggers full re-index with warning
- [ ] Changes exceeding 500 files triggers full re-index with warning
- [ ] Updates ``lastIndexedCommitSha`` on successful completion
- [ ] Integration tests with real repository demonstrate end-to-end flow
- [ ] Test coverage >= 90%

## Technical Notes

Force push detection: GitHub Compare API returns 404 when base commit no longer exists. Catch this and trigger full re-index.

## Dependencies

- Depends on: GitHub API Client for Change Detection
- Depends on: Incremental Update Pipeline

## Definition of Done

- Code implemented and passing all tests
- Integration tests with real repository passing
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Update Coordinator Service" -Body $body15 -Labels @("enhancement", "incremental-updates", "phase-foundation", "size:M") -Milestone $milestoneNumber

# Issue 1.6: CLI Update Commands
$body16 = @"
## Summary

Implement CLI commands for triggering incremental updates, enabling agents and users to update the index after merging PRs.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Foundation
Priority: P0
Effort: 3-4 hours

## Tasks

- [ ] Implement ``bun run cli update <repository>`` command
- [ ] Add ``--force`` option to trigger full re-index instead of incremental
- [ ] Implement ``bun run cli update-all`` command for batch updates
- [ ] Display update results in user-friendly format
- [ ] Handle and display errors appropriately
- [ ] Add ``--help`` documentation for new commands

## Acceptance Criteria

- [ ] ``update <repo>`` triggers incremental update for specified repository
- [ ] ``update <repo> --force`` triggers full re-index
- [ ] ``update-all`` processes all repositories with status "ready" sequentially
- [ ] Clear output showing: commit range, files changed, chunks updated, duration
- [ ] Error messages are actionable and include next steps
- [ ] ``--help`` shows accurate documentation for all commands
- [ ] Commands integrate with existing CLI structure

## Technical Notes

Example output format:
``````
Updating my-api...
  Commits: abc1234..def5678
  Files: +2 ~3 -1
  Chunks: +15 -8
  Duration: 847ms
``````

## Dependencies

- Depends on: Update Coordinator Service

## Definition of Done

- Code implemented and passing all tests
- Commands work end-to-end
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "CLI Update Commands" -Body $body16 -Labels @("enhancement", "incremental-updates", "phase-foundation", "size:S") -Milestone $milestoneNumber

# Issue 1.7: Foundation Phase Tests
$body17 = @"
## Summary

Ensure comprehensive test coverage for all Phase 1 Foundation components with both unit tests and integration tests.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Foundation
Priority: P0
Effort: 4-6 hours

## Tasks

- [ ] Unit tests for GitHubClient with mocked API responses
- [ ] Unit tests for ChromaStorageClient new methods
- [ ] Unit tests for IncrementalUpdatePipeline
- [ ] Unit tests for IncrementalUpdateCoordinator
- [ ] Integration tests for end-to-end update flow
- [ ] Create mock fixtures for GitHub API responses
- [ ] Verify test coverage >= 90% for all new code
- [ ] Update CI/CD pipeline to run new tests

## Acceptance Criteria

- [ ] All new services have comprehensive unit tests
- [ ] Integration test validates complete update workflow
- [ ] Test coverage report shows >= 90% for new code
- [ ] All tests pass in CI/CD pipeline
- [ ] No flaky tests (tests pass consistently)
- [ ] Mock fixtures are realistic and cover edge cases

## Dependencies

- Depends on: All Phase 1 Foundation issues

## Definition of Done

- All tests implemented and passing
- Coverage >= 90% for all new code
- No flaky tests
- CI/CD pipeline updated and passing
"@

Create-Issue -Title "Foundation Phase Unit and Integration Tests" -Body $body17 -Labels @("testing", "incremental-updates", "phase-foundation", "size:M") -Milestone $milestoneNumber

Write-Host "`n=== Creating Phase 2: Observability Issues ===" -ForegroundColor Cyan

# Issue 2.1: Update History Tracking
$body21 = @"
## Summary

Track update history per repository to provide visibility into past update operations, enabling troubleshooting and audit capabilities.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Observability
Priority: P1
Effort: 3-4 hours

## Tasks

- [ ] Add ``updateHistory`` array field to RepositoryInfo type
- [ ] Define ``UpdateHistoryEntry`` type with: timestamp, commit range, stats, errors
- [ ] Track last N updates (configurable via env var, default 20)
- [ ] Record each update in history on completion
- [ ] Implement history rotation (drop oldest when limit reached)
- [ ] Persist history across service restarts
- [ ] Write unit tests for history management

## Acceptance Criteria

- [ ] Updates are recorded in repository history
- [ ] History persists across service restarts
- [ ] Old entries are rotated out when limit exceeded
- [ ] History includes: timestamp, commit range, file counts, duration, error count
- [ ] Test coverage >= 90%

## Technical Notes

``````typescript
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
``````

## Dependencies

- Depends on: Phase 1 Foundation complete

## Definition of Done

- Code implemented and passing all tests
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Update History Tracking" -Body $body21 -Labels @("enhancement", "incremental-updates", "phase-observability", "size:S") -Milestone $milestoneNumber

# Issue 2.2: CLI History Command
$body22 = @"
## Summary

Implement CLI command to view update history for a repository, enabling users to see past updates and diagnose issues.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Observability
Priority: P1
Effort: 2-3 hours

## Tasks

- [ ] Implement ``bun run cli history <repository>`` command
- [ ] Add ``--limit N`` option to show last N updates (default: 10)
- [ ] Display history in readable tabular format
- [ ] Show: timestamp, commit range, files changed, duration, status
- [ ] Handle repositories with no update history gracefully
- [ ] Add ``--help`` documentation

## Acceptance Criteria

- [ ] ``history <repo>`` shows update history for repository
- [ ] ``--limit`` option controls number of entries shown
- [ ] Output is well-formatted and readable
- [ ] Handles empty history gracefully (informative message)
- [ ] Error handling for non-existent repository

## Technical Notes

Example output:
``````
Update History for my-api (last 5 updates):

Timestamp            Commits           Files    Chunks   Duration  Status
2025-12-14 10:30    abc12..def56      +2 ~1    +8 -3    523ms     success
2025-12-14 09:15    789ab..abc12      ~5       +12 -12  891ms     success
...
``````

## Dependencies

- Depends on: Update History Tracking

## Definition of Done

- Code implemented and passing all tests
- Command works end-to-end
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "CLI History Command" -Body $body22 -Labels @("enhancement", "incremental-updates", "phase-observability", "size:S") -Milestone $milestoneNumber

# Issue 2.3: Enhanced Status Command
$body23 = @"
## Summary

Enhance the existing ``status`` CLI command to show incremental update information, making it easy to see if repositories are up-to-date.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Observability
Priority: P1
Effort: 2-3 hours

## Tasks

- [ ] Add last indexed commit SHA to status output
- [ ] Add last update timestamp to status output
- [ ] Add incremental update count to status output
- [ ] Show visual indicator if repository may have pending updates
- [ ] Add ``--check`` option to query GitHub for new commits
- [ ] Update ``--help`` documentation

## Acceptance Criteria

- [ ] Status output includes update-related metadata for each repository
- [ ] Can see at a glance which repos have been recently updated
- [ ] ``--check`` option shows if repos have commits newer than indexed
- [ ] Clear visual indication of update status (up-to-date, updates available, etc.)

## Technical Notes

Example enhanced status output:
``````
Repository Status:

Name      Files   Chunks   Last Index    Last Commit   Updates   Status
my-api    234     1,892    2h ago        abc1234       12        up-to-date
lib-util  89      456      1d ago        def5678       3         updates available
``````

## Dependencies

- Depends on: Phase 1 Foundation complete

## Definition of Done

- Code implemented and passing all tests
- Command works end-to-end
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Enhanced Status Command with Update Information" -Body $body23 -Labels @("enhancement", "incremental-updates", "phase-observability", "size:S") -Milestone $milestoneNumber

# Issue 2.4: Structured Logging
$body24 = @"
## Summary

Add comprehensive structured logging throughout the update pipeline for debugging and operational visibility.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Observability
Priority: P1
Effort: 2-3 hours

## Tasks

- [ ] Add structured logging to GitHubClient (API calls, responses, errors)
- [ ] Add structured logging to IncrementalUpdatePipeline (file processing)
- [ ] Add structured logging to UpdateCoordinator (workflow orchestration)
- [ ] Include trace/correlation ID in all related log entries
- [ ] Ensure log levels are appropriate (info, warn, error, debug)
- [ ] Document log format and fields in troubleshooting guide

## Acceptance Criteria

- [ ] All update operations are logged with structured data
- [ ] Can trace a single update through logs using correlation ID
- [ ] Sensitive data (tokens, credentials) never logged
- [ ] Log levels correctly reflect severity
- [ ] Documentation describes log format and common entries

## Technical Notes

Log format should include:
- timestamp
- level
- message
- correlationId (for tracing)
- repository (when applicable)
- operation (e.g., "github_compare", "chroma_upsert")
- duration (for timed operations)
- error details (for failures)

## Dependencies

- Depends on: Phase 1 Foundation complete

## Definition of Done

- Logging implemented throughout update pipeline
- Documentation updated
- PR approved and merged to main
"@

Create-Issue -Title "Structured Logging for Update Operations" -Body $body24 -Labels @("enhancement", "incremental-updates", "phase-observability", "size:S") -Milestone $milestoneNumber

# Issue 2.5: Update Metrics
$body25 = @"
## Summary

Track aggregate metrics across update operations for performance monitoring and trend analysis.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Observability
Priority: P2
Effort: 2-3 hours

## Tasks

- [ ] Define metrics to track: total updates, avg duration, error rate, etc.
- [ ] Store aggregate metrics in system metadata
- [ ] Calculate metrics on-demand from update history
- [ ] Display metrics in status command output
- [ ] Persist metrics across restarts

## Acceptance Criteria

- [ ] Metrics accurately reflect update history
- [ ] Metrics visible in CLI status output
- [ ] Metrics persist across service restarts

## Technical Notes

Metrics to track:
- Total incremental updates (all time)
- Average update duration
- Total files processed
- Total chunks modified
- Error rate (failed/total)
- Last 7-day trend

## Dependencies

- Depends on: Phase 1 Foundation complete

## Definition of Done

- Metrics tracking implemented
- Visible in status command
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Update Metrics Tracking" -Body $body25 -Labels @("enhancement", "incremental-updates", "phase-observability", "size:S") -Milestone $milestoneNumber

Write-Host "`n=== Creating Phase 3: Robustness Issues ===" -ForegroundColor Cyan

# Issue 3.1: Interrupted Update Detection
$body31 = @"
## Summary

Detect interrupted updates (e.g., service crash mid-update) and provide recovery options to prevent data inconsistency.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Robustness
Priority: P1
Effort: 3-4 hours

## Tasks

- [ ] Add ``updateInProgress: boolean`` field to repository metadata
- [ ] Add ``updateStartedAt: string`` field to track when update began
- [ ] Set flag at update start, clear on completion (success or failure)
- [ ] Detect interrupted updates on service startup
- [ ] Log warning when interrupted update detected
- [ ] Provide recovery options (continue, reset, full re-index)

## Acceptance Criteria

- [ ] Updates are marked as in-progress during execution
- [ ] Interrupted updates are detected on next operation
- [ ] Clear notification/warning when interrupted update found
- [ ] Recovery path prevents data corruption

## Dependencies

- Depends on: Phase 2 complete

## Definition of Done

- Detection implemented and tested
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Interrupted Update Detection" -Body $body31 -Labels @("enhancement", "incremental-updates", "phase-robustness", "size:S") -Milestone $milestoneNumber

# Issue 3.2: Interrupted Update Recovery
$body32 = @"
## Summary

Implement recovery logic for interrupted updates, ensuring the system can return to a consistent state.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Robustness
Priority: P1
Effort: 3-4 hours

## Tasks

- [ ] Implement recovery logic that evaluates interrupted state
- [ ] Option 1: Complete interrupted update if changes still identifiable
- [ ] Option 2: Trigger full re-index if state unrecoverable
- [ ] Add CLI command to manually reset stuck updates
- [ ] Add detailed logging for recovery actions
- [ ] Write tests for recovery scenarios

## Acceptance Criteria

- [ ] Can recover from typical interruptions automatically
- [ ] Clear notification when recovery action taken
- [ ] Manual reset option available via CLI (``bun run cli reset-update <repo>``)
- [ ] No silent data inconsistencies
- [ ] Recovery logic tested with simulated interruptions

## Dependencies

- Depends on: Interrupted Update Detection

## Definition of Done

- Recovery implemented and tested
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Interrupted Update Recovery" -Body $body32 -Labels @("enhancement", "incremental-updates", "phase-robustness", "size:S") -Milestone $milestoneNumber

# Issue 3.3: Retry Logic
$body33 = @"
## Summary

Implement retry logic with exponential backoff for transient failures in external API calls.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Robustness
Priority: P1
Effort: 2-3 hours

## Tasks

- [ ] Create generic retry utility function with exponential backoff
- [ ] Configure: max retries, initial delay, max delay, backoff multiplier
- [ ] Apply to GitHub API calls
- [ ] Apply to OpenAI embedding API calls
- [ ] Apply to ChromaDB operations
- [ ] Add retry configuration via environment variables
- [ ] Log retry attempts with details

## Acceptance Criteria

- [ ] Transient failures are retried automatically
- [ ] Exponential backoff prevents rate limit exhaustion
- [ ] Max retries prevents infinite loops
- [ ] Non-retryable errors (4xx) fail immediately
- [ ] Retry attempts are logged
- [ ] Configurable retry parameters

## Technical Notes

``````typescript
interface RetryConfig {
  maxRetries: number;           // default: 3
  initialDelayMs: number;       // default: 1000
  maxDelayMs: number;           // default: 60000
  backoffMultiplier: number;    // default: 2
}
``````

## Dependencies

- Depends on: Phase 1 Foundation complete

## Definition of Done

- Retry utility implemented
- Applied to all external API calls
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Retry Logic with Exponential Backoff" -Body $body33 -Labels @("enhancement", "incremental-updates", "phase-robustness", "size:S") -Milestone $milestoneNumber

# Issue 3.4: Partial Failure Handling
$body34 = @"
## Summary

Handle individual file failures gracefully, allowing the update to continue and reporting all failures at the end.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Robustness
Priority: P1
Effort: 3-4 hours

## Tasks

- [ ] Continue processing when individual files fail
- [ ] Collect errors without stopping pipeline
- [ ] Determine when to commit partial progress vs rollback
- [ ] Report all failures at end with actionable details
- [ ] Record partial success status in update history
- [ ] Document expected user actions for common failures

## Acceptance Criteria

- [ ] Single file failure does not abort entire update
- [ ] All failures reported clearly at end of update
- [ ] Partial progress saved when appropriate
- [ ] User can identify and address specific failures
- [ ] Update history shows partial success status when applicable

## Dependencies

- Depends on: Phase 1 Foundation complete

## Definition of Done

- Partial failure handling implemented
- Test coverage >= 90%
- PR approved and merged to main
"@

Create-Issue -Title "Partial Failure Handling" -Body $body34 -Labels @("enhancement", "incremental-updates", "phase-robustness", "size:S") -Milestone $milestoneNumber

# Issue 3.5: Error Handling Tests
$body35 = @"
## Summary

Create comprehensive test coverage for all error handling scenarios to ensure robust behavior.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Robustness
Priority: P1
Effort: 3-4 hours

## Tasks

- [ ] Test interrupted update detection and recovery
- [ ] Test retry logic behavior (success after retry, max retries exceeded)
- [ ] Test partial failure handling
- [ ] Test threshold-triggered full re-index (>500 files)
- [ ] Test force push detection and re-index trigger
- [ ] Test network/API failures at various points
- [ ] Test concurrent update prevention

## Acceptance Criteria

- [ ] All error handling code paths have test coverage
- [ ] Tests simulate realistic failure scenarios
- [ ] Tests verify correct behavior (not just no crashes)
- [ ] Coverage >= 90% for error handling code

## Dependencies

- Depends on: All Phase 3 error handling issues

## Definition of Done

- All error scenario tests implemented
- Coverage >= 90% for error handling code
- No flaky tests
- PR approved and merged to main
"@

Create-Issue -Title "Comprehensive Error Handling Tests" -Body $body35 -Labels @("testing", "incremental-updates", "phase-robustness", "size:M") -Milestone $milestoneNumber

# Issue 3.6: Documentation Updates
$body36 = @"
## Summary

Update project documentation to cover the incremental updates feature comprehensively.

## Context

Part of: [EPIC] Incremental Updates Feature
Phase: Robustness
Priority: P1
Effort: 2-3 hours

## Tasks

- [ ] Update README with new CLI commands (update, update-all, history)
- [ ] Create troubleshooting guide section for incremental updates
- [ ] Document common error messages and resolutions
- [ ] Update architecture documentation to reflect implementation
- [ ] Add workflow examples (e.g., post-PR update flow)
- [ ] Update CLI help text to be comprehensive

## Acceptance Criteria

- [ ] All new commands documented in README
- [ ] Troubleshooting guide covers common errors
- [ ] Architecture docs accurately reflect implementation
- [ ] Users can self-serve for basic troubleshooting
- [ ] Examples show typical usage patterns

## Dependencies

- Depends on: All above issues complete

## Definition of Done

- All documentation updated
- PR approved and merged to main
"@

Create-Issue -Title "Documentation Updates for Incremental Updates" -Body $body36 -Labels @("documentation", "incremental-updates", "phase-robustness", "size:S") -Milestone $milestoneNumber

Write-Host "`n=== Issue Creation Complete ===" -ForegroundColor Cyan
Write-Host "Created 17 issues (1 epic + 7 foundation + 5 observability + 6 robustness)" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Review created issues in GitHub" -ForegroundColor White
Write-Host "2. Update epic with child issue links" -ForegroundColor White
Write-Host "3. Begin implementation with Phase 1 Foundation issues" -ForegroundColor White
