# Incremental Updates Implementation Roadmap

**Version:** 1.8
**Date:** January 1, 2026
**Status:** ✅ COMPLETE - All Phases Finished (18/18 Issues Closed, Epic Closed)
**Parent Document:** [incremental-updates-plan.md](../architecture/incremental-updates-plan.md)
**Project Phase:** Extension of Phase 1 (Core MCP + Vector Search)
**Epic:** [#41 - Incremental Updates Feature](https://github.com/sethb75/PersonalKnowledgeMCP/issues/41) ✅ CLOSED
**Milestone:** [Incremental Updates](https://github.com/sethb75/PersonalKnowledgeMCP/milestone/2)

---

## Executive Summary

This roadmap provides a detailed implementation plan for the Incremental Updates feature in the Personal Knowledge MCP system. The feature enables efficient index updates when Pull Requests are merged to monitored GitHub repositories, eliminating the need for expensive full re-indexing operations.

### Business Value

| Value Proposition | Impact |
|-------------------|--------|
| **Time Savings** | Reduce typical PR update time from 15-30 minutes to <1 minute |
| **Cost Reduction** | Minimize OpenAI API credits spent on re-embedding unchanged content |
| **Freshness** | Keep index synchronized with repository changes in near real-time |
| **Developer Experience** | Seamless integration with PR workflow via CLI commands |

### Implementation Approach

The implementation follows the **On-Demand Trigger** model as selected in the architecture plan:
- Updates triggered by agent or user after PR merge
- No background polling or webhooks in MVP scope
- Sequential processing (one repository at a time)
- Automatic fallback to full re-index when appropriate

### Timeline Summary

| Phase | Duration | Focus | Deliverables |
|-------|----------|-------|--------------|
| **Phase 1: Foundation** | 5-7 days | Core incremental update capability | CLI commands, GitHub API integration, ChromaDB operations |
| **Phase 2: Observability** | 3-4 days | Visibility and debugging | Update history, metrics, enhanced status |
| **Phase 3: Robustness** | 4-5 days | Production-ready error handling | Retry logic, recovery, partial failure handling |
| **Total** | 12-16 days | Complete incremental updates feature | Production-ready feature |

**Risk Buffer:** +3-5 days for integration testing and edge cases

---

## Execution Order by Phase

### Phase 1: Foundation - Execution Order ✅ COMPLETE

| Order | Issue | Title | Priority | Effort | Depends On |
|-------|-------|-------|----------|--------|------------|
| ~~1~~ | ~~[#42](https://github.com/sethb75/PersonalKnowledgeMCP/issues/42)~~ | ~~Repository Metadata Schema Extension~~ | ~~P0~~ | ~~2-4h~~ | ~~—~~ |
| ~~1~~ | ~~[#44](https://github.com/sethb75/PersonalKnowledgeMCP/issues/44)~~ | ~~ChromaDB Upsert and Delete Operations~~ | ~~P0~~ | ~~4-6h~~ | ~~—~~ |
| ~~2~~ | ~~[#43](https://github.com/sethb75/PersonalKnowledgeMCP/issues/43)~~ | ~~GitHub API Client for Change Detection~~ | ~~P0~~ | ~~4-6h~~ | ~~#42~~ |
| ~~3~~ | ~~[#45](https://github.com/sethb75/PersonalKnowledgeMCP/issues/45)~~ | ~~Incremental Update Pipeline~~ | ~~P0~~ | ~~6-8h~~ | ~~#44~~ |
| ~~4~~ | ~~[#46](https://github.com/sethb75/PersonalKnowledgeMCP/issues/46)~~ | ~~Update Coordinator Service~~ | ~~P0~~ | ~~4-6h~~ | ~~#43~~, ~~#45~~ |
| ~~5~~ | ~~[#47](https://github.com/sethb75/PersonalKnowledgeMCP/issues/47)~~ | ~~CLI Update Commands~~ | ~~P0~~ | ~~3-4h~~ | ~~#46~~ |
| ~~6~~ | ~~[#48](https://github.com/sethb75/PersonalKnowledgeMCP/issues/48)~~ | ~~Foundation Phase Unit and Integration Tests~~ | ~~P0~~ | ~~4-6h~~ | ~~#42~~-~~#47~~ |

**Parallel Tracks:** Issues #42 and #44 can be worked simultaneously (no dependencies).

### Phase 2: Observability - Execution Order ✅ COMPLETE

| Order | Issue | Title | Priority | Effort | Depends On |
|-------|-------|-------|----------|--------|------------|
| ~~1~~ | ~~[#49](https://github.com/sethb75/PersonalKnowledgeMCP/issues/49)~~ | ~~Update History Tracking~~ | ~~P1~~ | ~~3-4h~~ | ~~Phase 1~~ |
| ~~1~~ | ~~[#51](https://github.com/sethb75/PersonalKnowledgeMCP/issues/51)~~ | ~~Enhanced Status Command with Update Information~~ | ~~P1~~ | ~~2-3h~~ | ~~Phase 1~~ |
| ~~1~~ | ~~[#52](https://github.com/sethb75/PersonalKnowledgeMCP/issues/52)~~ | ~~Structured Logging for Update Operations~~ | ~~P1~~ | ~~2-3h~~ | ~~Phase 1~~ |
| ~~1~~ | ~~[#53](https://github.com/sethb75/PersonalKnowledgeMCP/issues/53)~~ | ~~Update Metrics Tracking~~ | ~~P2~~ | ~~2-3h~~ | ~~Phase 1~~ |
| ~~2~~ | ~~[#50](https://github.com/sethb75/PersonalKnowledgeMCP/issues/50)~~ | ~~CLI History Command~~ | ~~P1~~ | ~~2-3h~~ | ~~#49~~ |

**Parallel Tracks:** Issues #49, #51, #52, #53 can all be worked simultaneously after Phase 1 completes.

### Phase 3: Robustness - Execution Order ✅ COMPLETE

| Order | Issue | Title | Priority | Effort | Depends On |
|-------|-------|-------|----------|--------|------------|
| ~~1~~ | ~~[#54](https://github.com/sethb75/PersonalKnowledgeMCP/issues/54)~~ | ~~Interrupted Update Detection~~ | ~~P1~~ | ~~3-4h~~ | ~~Phase 2~~ |
| ~~1~~ | ~~[#56](https://github.com/sethb75/PersonalKnowledgeMCP/issues/56)~~ | ~~Retry Logic with Exponential Backoff~~ | ~~P1~~ | ~~2-3h~~ | ~~Phase 1~~ |
| ~~1~~ | ~~[#57](https://github.com/sethb75/PersonalKnowledgeMCP/issues/57)~~ | ~~Partial Failure Handling~~ | ~~P1~~ | ~~3-4h~~ | ~~Phase 1~~ |
| ~~2~~ | ~~[#55](https://github.com/sethb75/PersonalKnowledgeMCP/issues/55)~~ | ~~Interrupted Update Recovery~~ | ~~P1~~ | ~~3-4h~~ | ~~#54~~ |
| ~~3~~ | ~~[#58](https://github.com/sethb75/PersonalKnowledgeMCP/issues/58)~~ | ~~Comprehensive Error Handling Tests~~ | ~~P1~~ | ~~3-4h~~ | ~~#54~~, ~~#55~~, ~~#56~~, ~~#57~~ |
| ~~4~~ | ~~[#59](https://github.com/sethb75/PersonalKnowledgeMCP/issues/59)~~ | ~~Documentation Updates for Incremental Updates~~ | ~~P1~~ | ~~2-3h~~ | ~~All above~~ |

**Parallel Tracks:** Issues #54, #56, #57 can be worked simultaneously.

---

## Milestone Definitions

### Milestone 1: Incremental Updates - Foundation ✅ COMPLETE
**Target Completion:** Week 1-2
**Actual Completion:** December 16, 2024
**Success Criteria:** Agent can trigger incremental updates via CLI after PR merge

**Definition of Done:**
- [x] `bun run cli update <repo>` command functional
- [x] `bun run cli update-all` command functional
- [x] GitHub API integration for commit comparison working
- [x] ChromaDB upsert/delete operations implemented
- [x] Force push detection triggers full re-index
- [x] Update time <1 minute for typical PRs (5-20 files)
- [x] Unit tests with 90%+ coverage for new components
- [x] Integration tests passing

### Milestone 2: Incremental Updates - Observability ✅ COMPLETE
**Target Completion:** Week 2-3
**Actual Completion:** December 20, 2024
**Success Criteria:** Full visibility into update operations via CLI and logs

**Definition of Done:**
- [x] Update history tracking per repository (last N updates)
- [x] `bun run cli history <repo>` command functional
- [x] Enhanced `bun run cli status` shows update information
- [x] Structured logging for all update operations
- [x] Update metrics (duration, chunk counts, errors) tracked
- [x] Documentation for observability features

### Milestone 3: Incremental Updates - Robustness ✅ COMPLETE
**Target Completion:** Week 3-4
**Actual Completion:** December 21, 2024
**Success Criteria:** Graceful handling of all error scenarios

**Definition of Done:**
- [x] Interrupted update detection and recovery
- [x] Retry logic with exponential backoff
- [x] 500-file threshold triggers full re-index
- [x] Partial failure handling (continue on individual file errors)
- [x] Clear error messages in CLI output
- [x] Comprehensive error handling tests
- [x] Documentation updated with troubleshooting guide

---

## Work Breakdown Structure

### Phase 1: Foundation (5-7 days)

#### 1.1 Repository Metadata Schema Extension — [#42](https://github.com/sethb75/PersonalKnowledgeMCP/issues/42)
**Effort:** 2-4 hours
**Priority:** P0
**Dependencies:** None

**Deliverables:**
- Extend `RepositoryInfo` type with new fields:
  - `lastIndexedCommitSha?: string`
  - `lastIncrementalUpdateAt?: string`
  - `incrementalUpdateCount?: number`
- Update `RepositoryMetadataStore` to handle new fields
- Migration for existing repository metadata (add fields with null defaults)
- Unit tests for schema changes

**Acceptance Criteria:**
- [ ] New fields added to RepositoryInfo type
- [ ] Existing repositories load without errors
- [ ] New repositories store commit SHA on initial index
- [ ] Tests verify backward compatibility

---

#### 1.2 GitHub API Client for Change Detection — [#43](https://github.com/sethb75/PersonalKnowledgeMCP/issues/43)
**Effort:** 4-6 hours
**Priority:** P0
**Dependencies:** #42

**Deliverables:**
- Create `GitHubClient` service class
- Implement `getHeadCommit(owner, repo, branch)` method
- Implement `compareCommits(owner, repo, base, head)` method
- Parse file change list with status (added/modified/deleted/renamed)
- Handle GitHub API authentication via PAT
- Error handling for rate limits and authentication failures

**Acceptance Criteria:**
- [ ] Can retrieve HEAD commit SHA for a branch
- [ ] Can compare two commits and get changed files
- [ ] Handles renamed files correctly
- [ ] Returns structured `FileChange[]` array
- [ ] Graceful error handling for API failures
- [ ] Unit tests with mocked API responses

---

#### 1.3 ChromaDB Upsert and Delete Operations — [#44](https://github.com/sethb75/PersonalKnowledgeMCP/issues/44)
**Effort:** 4-6 hours
**Priority:** P0
**Dependencies:** None (can parallel with #42, #43)

**Deliverables:**
- Add `upsertDocuments()` method to `ChromaStorageClient`
- Add `deleteDocuments()` method to `ChromaStorageClient`
- Add `getDocumentsByMetadata()` method for finding file chunks
- Implement delete-by-file-prefix logic (delete all chunks for a file)
- Unit tests for new operations

**Acceptance Criteria:**
- [ ] Can upsert documents (add or update)
- [ ] Can delete documents by ID list
- [ ] Can find all chunks for a specific file path
- [ ] Operations are idempotent (safe to retry)
- [ ] Integration tests with real ChromaDB

---

#### 1.4 Incremental Update Pipeline — [#45](https://github.com/sethb75/PersonalKnowledgeMCP/issues/45) ✅ **COMPLETED**
**Effort:** 6-8 hours
**Priority:** P0
**Dependencies:** ~~#44~~
**Completed:** 2025-12-15 via PR #65

**Deliverables:**
- ✅ Create `IncrementalUpdatePipeline` service
- ✅ Implement file change categorization (added/modified/deleted)
- ✅ Handle added files: chunk, embed, add to ChromaDB
- ✅ Handle modified files: delete old chunks, add new chunks
- ✅ Handle deleted files: delete all chunks for file
- ✅ Handle renamed files: delete old path, add new path
- ✅ Filter changes to relevant extensions only
- ✅ Return structured `UpdateResult` with statistics

**Acceptance Criteria:**
- [x] Processes all change types correctly
- [x] Only processes files matching include/exclude patterns
- [x] Returns accurate statistics (files processed, chunks upserted/deleted)
- [x] Handles empty change lists gracefully
- [x] Unit tests for each change type

---

#### 1.5 Update Coordinator Service — [#46](https://github.com/sethb75/PersonalKnowledgeMCP/issues/46) ✅ **COMPLETED**
**Effort:** 4-6 hours
**Priority:** P0
**Dependencies:** ~~#43~~, ~~#45~~
**Completed:** 2025-12-15 via PR #66

**Deliverables:**
- ✅ Create `IncrementalUpdateCoordinator` service
- ✅ Orchestrate full update workflow:
  1. Get repository metadata
  2. Fetch HEAD commit from GitHub
  3. Compare with last indexed commit
  4. Detect changes (or detect force push)
  5. Update local clone (`git pull`)
  6. Process changes via pipeline
  7. Update repository metadata with new commit SHA
- ✅ Implement force push detection (commit not found error)
- ✅ Implement 500-file threshold check
- ✅ Trigger full re-index when appropriate

**Acceptance Criteria:**
- [x] Full update workflow completes successfully
- [x] Detects "no changes needed" correctly
- [x] Force push triggers full re-index with warning
- [x] >500 files triggers full re-index with warning
- [x] Updates `lastIndexedCommitSha` on success
- [x] Integration tests with real repository

---

#### 1.6 CLI Update Commands — [#47](https://github.com/sethb75/PersonalKnowledgeMCP/issues/47) ✅ **COMPLETED**
**Effort:** 3-4 hours
**Priority:** P0
**Dependencies:** ~~#46~~
**Completed:** 2025-12-15 via PR #67

**Deliverables:**
- ✅ Implement `bun run cli update <repository>` command
  - Option: `--force` for forced full re-index
- ✅ Implement `bun run cli update-all` command
  - Sequential processing of all indexed repositories
- ✅ Display update results in user-friendly format
- ✅ Handle and display errors appropriately

**Acceptance Criteria:**
- [x] `update <repo>` triggers incremental update
- [x] `update <repo> --force` triggers full re-index
- [x] `update-all` processes all ready repositories
- [x] Clear output showing what changed
- [x] Error messages are actionable
- [x] `--help` shows command documentation

---

#### 1.7 Unit and Integration Tests for Foundation — [#48](https://github.com/sethb75/PersonalKnowledgeMCP/issues/48) ✅ **COMPLETED**
**Effort:** 4-6 hours
**Priority:** P0
**Dependencies:** ~~#42~~-~~#47~~
**Completed:** 2025-12-16 via PR #71

**Deliverables:**
- ✅ Unit tests for all new services
- ✅ Integration tests for update workflow
- ✅ Mock fixtures for GitHub API responses
- ✅ Test coverage report showing 90%+ for new code
- ✅ Update CI/CD pipeline to run new tests

**Acceptance Criteria:**
- [x] All new code has unit tests
- [x] Integration test validates end-to-end flow
- [x] Test coverage >= 90% for new components
- [x] Tests run in CI/CD pipeline
- [x] No flaky tests

---

### Phase 2: Observability (3-4 days)

#### 2.1 Update History Tracking — [#49](https://github.com/sethb75/PersonalKnowledgeMCP/issues/49) ✅ **COMPLETED**
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** ~~Phase 1 complete (#48)~~
**Completed:** 2025-12-16 via PR #73

**Deliverables:**
- ✅ Add `updateHistory` field to repository metadata
- ✅ Track last N updates (configurable, default 20)
- ✅ Store: timestamp, commit range, file counts, duration, errors
- ✅ Implement history rotation (drop oldest when limit reached)
- ✅ Unit tests for history management

**Acceptance Criteria:**
- [x] Updates are recorded in history
- [x] History is persisted across restarts
- [x] Old entries are rotated out
- [x] History includes all relevant metrics

---

#### 2.2 CLI History Command — [#50](https://github.com/sethb75/PersonalKnowledgeMCP/issues/50) ✅ **COMPLETED**
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** ~~#49~~
**Completed:** 2025-12-16 via PR #74

**Deliverables:**
- ✅ Implement `bun run cli history <repository>` command
  - Option: `--limit N` to show last N updates
- ✅ Display update history in tabular format
- ✅ Show: timestamp, commit range, files changed, duration, status
- ✅ Handle empty history gracefully

**Acceptance Criteria:**
- [x] History command shows update records
- [x] `--limit` option works correctly
- [x] Output is readable and well-formatted
- [x] Handles repositories with no history

---

#### 2.3 Enhanced Status Command — [#51](https://github.com/sethb75/PersonalKnowledgeMCP/issues/51) ✅ **COMPLETED**
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** Phase 1 complete (#48)
**Completed:** 2025-12-16 via PR #72

**Deliverables:**
- ✅ Enhance `bun run cli status` to show update information
- ✅ Display: last indexed commit, last update time, update count
- ✅ Show if repository is up-to-date or has pending changes
- ✅ Add `--check` option to check for available updates

**Acceptance Criteria:**
- [x] Status shows update-related metadata
- [x] Can see at a glance if repo needs update
- [x] `--check` option queries GitHub for new commits
- [x] Clear visual indication of status

---

#### 2.4 Structured Logging for Updates — [#52](https://github.com/sethb75/PersonalKnowledgeMCP/issues/52) ✅ **COMPLETED**
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** ~~Phase 1 complete (#48)~~
**Completed:** 2025-12-17 via PR #75

**Deliverables:**
- ✅ Add structured logging throughout update pipeline
- ✅ Log: operation start/end, file counts, errors, duration
- ✅ Include trace ID for correlating log entries
- ✅ Ensure log levels are appropriate (info, warn, error)
- ✅ Document log format and fields

**Acceptance Criteria:**
- [x] All update operations are logged
- [x] Logs are structured (JSON format)
- [x] Can trace an update through logs
- [x] Sensitive data not logged

---

#### 2.5 Update Metrics — [#53](https://github.com/sethb75/PersonalKnowledgeMCP/issues/53) ✅ **COMPLETED**
**Effort:** 2-3 hours
**Priority:** P2
**Dependencies:** ~~Phase 1 complete (#48)~~
**Completed:** 2025-12-20 via PR #77

**Deliverables:**
- ✅ Track aggregate metrics across updates
- ✅ Metrics: total updates, average duration, error rate
- ✅ Store metrics in repository metadata
- ✅ Display metrics in status output

**Acceptance Criteria:**
- [x] Metrics are tracked accurately
- [x] Metrics persist across restarts
- [x] Metrics visible in CLI status

---

### Phase 3: Robustness (4-5 days) ✅ COMPLETE

#### 3.1 Interrupted Update Detection — [#54](https://github.com/sethb75/PersonalKnowledgeMCP/issues/54) ✅ **COMPLETED**
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** ~~Phase 2 complete~~
**Completed:** 2025-12-21 via PR #78

**Deliverables:**
- ✅ Add `updateInProgress` and `updateStartedAt` to metadata
- ✅ Set flag at update start, clear on completion
- ✅ Detect interrupted updates on service startup
- ✅ Option to resume or reset interrupted updates

**Acceptance Criteria:**
- [x] Interrupted updates are detected
- [x] Clear recovery path for interrupted updates
- [x] No data corruption from interruptions

---

#### 3.2 Interrupted Update Recovery — [#55](https://github.com/sethb75/PersonalKnowledgeMCP/issues/55) ✅ **COMPLETED**
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** ~~#54~~
**Completed:** 2025-12-21 via PR #79

**Deliverables:**
- ✅ Implement recovery logic for interrupted updates
- ✅ Option 1: Complete interrupted update if state recoverable
- ✅ Option 2: Trigger full re-index if state unrecoverable
- ✅ CLI command to manually reset stuck updates
- ✅ Logging for recovery actions

**Acceptance Criteria:**
- [x] Can recover from typical interruptions
- [x] Clear notification when recovery occurs
- [x] Manual reset option available
- [x] No silent data inconsistencies

---

#### 3.3 Retry Logic with Exponential Backoff — [#56](https://github.com/sethb75/PersonalKnowledgeMCP/issues/56) ✅ **COMPLETED**
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** ~~Phase 1 complete (#48)~~
**Completed:** 2025-12-21 via PR #80

**Deliverables:**
- ✅ Implement generic retry utility with exponential backoff
- ✅ Apply to GitHub API calls
- ✅ Apply to OpenAI embedding API calls
- ✅ Apply to ChromaDB operations
- ✅ Configurable retry parameters

**Acceptance Criteria:**
- [x] Transient failures are retried automatically
- [x] Backoff prevents API rate limit exhaustion
- [x] Max retries prevents infinite loops
- [x] Non-retryable errors fail immediately

---

#### 3.4 Partial Failure Handling — [#57](https://github.com/sethb75/PersonalKnowledgeMCP/issues/57) ✅ **COMPLETED**
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** ~~Phase 1 complete (#48)~~
**Completed:** 2025-12-21 via PR #81

**Deliverables:**
- ✅ Continue processing when individual files fail
- ✅ Collect errors without stopping pipeline
- ✅ Report failures at end with details
- ✅ Decision logic: when to commit partial progress
- ✅ Clear reporting of which files failed and why

**Acceptance Criteria:**
- [x] Single file failure doesn't abort entire update
- [x] All failures are reported clearly
- [x] Partial progress is saved appropriately
- [x] User can address specific failures

---

#### 3.5 Comprehensive Error Handling Tests — [#58](https://github.com/sethb75/PersonalKnowledgeMCP/issues/58) ✅ **COMPLETED**
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** ~~#54~~, ~~#55~~, ~~#56~~, ~~#57~~
**Completed:** 2025-12-21 via PR #82

**Deliverables:**
- ✅ Test cases for all error scenarios
- ✅ Test interrupted update recovery
- ✅ Test retry logic behavior
- ✅ Test partial failure handling
- ✅ Test threshold-triggered full re-index

**Acceptance Criteria:**
- [x] All error paths have test coverage
- [x] Tests simulate realistic failure scenarios
- [x] No untested error handling code

---

#### 3.6 Documentation Updates — [#59](https://github.com/sethb75/PersonalKnowledgeMCP/issues/59) ✅ **COMPLETED**
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** ~~All above (#54-#58)~~
**Completed:** 2025-12-21 via PR #83

**Deliverables:**
- ✅ Update README with incremental update commands
- ✅ Create troubleshooting guide for common issues
- ✅ Document error messages and resolutions
- ✅ Update architecture documentation
- ✅ Add examples to CLI help

**Acceptance Criteria:**
- [x] All new commands documented
- [x] Troubleshooting guide covers common errors
- [x] Architecture docs reflect implementation
- [x] Users can self-serve for basic issues

---

## Dependency Graph

```
                                Phase 1: Foundation ✅

    [~~#42 Schema~~]    [~~#43 GitHub API~~]    [~~#44 ChromaDB Ops~~]
         |                    |                        |
         +--------------------+                        |
                              |                        |
                   [~~#45 Update Pipeline~~] <---------+
                              |
                   [~~#46 Update Coordinator~~]
                              |
                       [~~#47 CLI Commands~~]
                              |
                       [~~#48 Tests~~]
                              |
                              v
                                Phase 2: Observability ✅

    [~~#49 History Tracking~~] --> [~~#50 CLI History~~]
              |
    [~~#51 Enhanced Status~~]     (can run in parallel)
              |
    [~~#52 Structured Logging~~]  (can run in parallel)
              |
    [~~#53 Update Metrics~~]      (can run in parallel)
              |
              v
                                Phase 3: Robustness ✅

    [~~#54 Interrupted Detection~~] --> [~~#55 Recovery~~]
              |                            |
    [~~#56 Retry Logic~~]    (parallel)        |
              |                            |
    [~~#57 Partial Failure~~] (parallel)       |
              |                            |
              +----------------------------+
                            |
                   [~~#58 Error Tests~~]
                            |
                   [~~#59 Documentation~~]
                            |
                            v
                     ✅ COMPLETE ✅
```

---

## Risk Assessment

### Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| GitHub API rate limits during development | Medium | Medium | Use mocked responses in tests; implement rate limit handling early |
| ChromaDB prefix deletion performance | Medium | Low | Implement metadata-based filtering; benchmark with realistic data volumes |
| Git pull conflicts in local clones | Medium | Low | Implement clone reset/recreation on conflict; document manual resolution |
| Force push detection edge cases | Low | Medium | Conservative approach: any compare failure triggers full re-index |
| Embedding API costs during testing | Low | Medium | Use cached/mocked embeddings in unit tests; integration tests use real API sparingly |

### Schedule Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Phase 1 dependencies delay Phase 2/3 | High | Low | Parallel work on observability design while coding foundation |
| Integration testing reveals issues | Medium | Medium | Start integration testing early in each phase; maintain buffer time |
| Solo developer capacity constraints | Medium | Medium | Prioritize P0 items; defer P2 items if needed |

### Mitigation Strategies

1. **Daily Progress Tracking**: Update roadmap status daily to identify delays early
2. **Incremental Integration**: Test components together frequently, not just at phase end
3. **Scope Flexibility**: Phase 3 items can be deferred if needed; Phase 1 is non-negotiable
4. **Documentation as You Go**: Don't defer all docs to end; write during implementation

---

## Success Criteria

### Phase 1 Success Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| Update time for typical PR | End-to-end timing | < 1 minute for 5-20 files |
| CLI commands functional | Manual testing | All commands work correctly |
| Force push handling | Test scenario | Triggers full re-index |
| Test coverage | Coverage report | >= 90% for new code |

### Phase 2 Success Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| History visibility | CLI output | Last 20 updates visible |
| Status clarity | Manual review | Update status clearly shown |
| Log completeness | Log analysis | All operations logged |

### Phase 3 Success Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| Recovery from interruption | Test scenario | Automatic recovery works |
| Retry effectiveness | Test scenario | Transient failures recovered |
| Partial failure handling | Test scenario | Pipeline continues on file errors |
| Error message quality | Manual review | Actionable error messages |

### Overall Success Criteria ✅ ALL MET

- [x] Agent can update index after merging PRs via CLI
- [x] Updates complete in <1 minute for typical PRs
- [x] System recovers gracefully from all common error scenarios
- [x] Full visibility into update operations via CLI and logs
- [x] Documentation enables self-service troubleshooting
- [x] 90%+ test coverage maintained

---

## Integration with Existing System

### Affected Components

| Component | Changes Required |
|-----------|------------------|
| `RepositoryMetadataStore` | New fields, backward compatibility |
| `ChromaStorageClient` | New methods (upsert, delete, getByMetadata) |
| `IngestionService` | May need refactoring to support partial file processing |
| CLI (`src/cli.ts`) | New commands (update, update-all, history) |
| Configuration | New environment variables for GitHub API |

### New Components

| Component | Purpose |
|-----------|---------|
| `GitHubClient` | GitHub API integration for change detection |
| `IncrementalUpdatePipeline` | File change processing logic |
| `IncrementalUpdateCoordinator` | Orchestration and workflow management |

### Environment Variables (New)

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `GITHUB_PAT` | Yes | GitHub Personal Access Token (existing, used for cloning) | - |
| `UPDATE_HISTORY_LIMIT` | No | Number of updates to retain in history | `20` |
| `MAX_FILES_FOR_INCREMENTAL` | No | Threshold for falling back to full re-index | `500` |

---

## Questions/Clarifications Needed

**No blocking questions identified.**

The architecture document provides clear decisions on all key aspects:
- Update triggering model: On-demand (selected)
- Concurrent updates: Sequential (decided)
- Large change threshold: 500 files (decided)
- Force push handling: Full re-index (decided)
- Branch tracking: Primary branch only (decided)
- Notification mechanism: CLI + logs (decided)

The implementation can proceed based on the approved architecture plan.

---

## GitHub Issue Organization

### Milestone

**Name:** [Incremental Updates](https://github.com/sethb75/PersonalKnowledgeMCP/milestone/2)
**Description:** Enable incremental index updates when PRs are merged to monitored repositories
**Target Date:** 4 weeks from start
**Status:** ✅ Created

### Epic

**Issue:** [#41 - Incremental Updates Feature](https://github.com/sethb75/PersonalKnowledgeMCP/issues/41)

### Issue Summary

| Phase | Issues | Priority | Status |
|-------|--------|----------|--------|
| **Foundation** | ~~#42~~, ~~#43~~, ~~#44~~, ~~#45~~, ~~#46~~, ~~#47~~, ~~#48~~ | All P0 | ✅ 7/7 Complete |
| **Observability** | ~~#49~~, ~~#50~~, ~~#51~~, ~~#52~~, ~~#53~~ | P1/P2 | ✅ 5/5 Complete |
| **Robustness** | ~~#54~~, ~~#55~~, ~~#56~~, ~~#57~~, ~~#58~~, ~~#59~~ | All P1 | ✅ 6/6 Complete |
| **Total** | 18 issues (+ 1 epic) | | **✅ 18/18 Complete (100%)** |

### Labels

Issues use existing labels plus:
- `incremental-updates` - Feature area label
- `phase-foundation` - Phase 1 work
- `phase-observability` - Phase 2 work
- `phase-robustness` - Phase 3 work

### Issue Sizing

| Size | Effort | Example |
|------|--------|---------|
| S | 2-4 hours | Schema extension, single command |
| M | 4-8 hours | Service implementation, API integration |
| L | 8+ hours | Complex service, extensive testing |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-14 | Claude Code | Initial roadmap based on approved architecture plan |
| 1.1 | 2025-12-14 | Claude Code | Added GitHub issue numbers, execution order tables, and dependency references |
| 1.2 | 2025-12-15 | Claude Code | Marked Issue #45 (Incremental Update Pipeline) as completed via PR #65 |
| 1.3 | 2025-12-15 | Claude Code | Marked Issue #46 (Update Coordinator Service) as completed via PR #66 |
| 1.4 | 2025-12-16 | Claude Code | Marked Issue #51 (Enhanced Status Command) as completed via PR #72 |
| 1.5 | 2025-12-20 | Claude Code | Added Related Work section linking to project roadmap and Docker Containerization PRD |
| 1.6 | 2025-12-21 | Claude Code | Added comprehensive documentation: README CLI commands, troubleshooting quick reference, architecture implementation status (#59) |
| 1.7 | 2025-12-25 | Claude Code | Marked all 18 issues as complete (100%). Updated all phases, milestones, and execution tables to reflect completion status. Feature complete! |
| 1.8 | 2026-01-01 | Claude Code | Epic #41 officially closed. Also closed Epic #82 (Docker Containerization) - all 22 issues complete. |

---

## Related Work: Project-Level Roadmap

This Incremental Updates feature is part of the broader Personal Knowledge MCP project roadmap. The phases in this document (Foundation, Observability, Robustness) are sub-phases within **Project Phase 1: Core MCP + Vector Search**.

### Project Phase Overview

| Project Phase | Status | Key Features |
|---------------|--------|--------------|
| **Phase 1: Core MCP + Vector Search** | ✅ Complete | MCP service, ChromaDB, semantic search, CLI, **Incremental Updates** |
| **Phase 2: Code Intelligence + Local Files** | Planned | AST parsing, PostgreSQL, local folder ingestion |
| **Phase 3: Multi-Instance + Containerization** | ✅ Complete | Docker hardening, multi-transport MCP, authentication, Azure DevOps |
| **Phase 4: Graph Relationships + Enterprise** | ✅ Complete | Neo4j, OIDC, Kubernetes, automated pipelines |

### Containerization Impact on Incremental Updates

The [Docker Containerization PRD](Docker-Containerization-PRD.md) (Phase 3) will affect incremental updates in the following ways:

| Containerization Feature | Impact on Incremental Updates |
|--------------------------|------------------------------|
| **Multi-Transport MCP** | Updates can be triggered via HTTP API (not just CLI/stdio) |
| **Multi-Instance Architecture** | Each instance (Private/Work/Public) manages its own update state |
| **Bearer Token Authentication** | HTTP-triggered updates require valid token with `write` scope |
| **Docker Compose Hardening** | ChromaDB health checks ensure updates don't fail silently |

### Future Enhancements (Post-Phase 3)

Once containerization is complete, consider these enhancements to incremental updates:

1. **Webhook-Triggered Updates** (Project Phase 4)
   - GitHub webhooks trigger updates automatically on PR merge
   - Requires HTTP transport from containerization work

2. **Multi-Instance Update Coordination**
   - Coordinate updates across Private/Work/Public instances
   - Ensure consistent state when same repo is indexed in multiple instances

3. **Update Queue with Persistence**
   - Queue update requests for processing
   - Survives container restarts
   - Enables rate limiting and prioritization

---

**Completion Summary:**
1. ~~Create GitHub milestone "Incremental Updates"~~ ✅ Done
2. ~~Create GitHub issues for all work items~~ ✅ Done (19 issues created)
3. ~~Begin Phase 1 implementation~~ ✅ Complete (#42-#48)
4. ~~Complete Phase 2 Observability~~ ✅ Complete (#49-#53)
5. ~~Complete Phase 3 Robustness~~ ✅ Complete (#54-#59)

**🎉 FEATURE COMPLETE - December 21, 2024 🎉**

**🎉 EPIC CLOSED - January 1, 2026 🎉**

All 18 issues in the Incremental Updates feature have been completed. The feature is now production-ready with:
- CLI commands for incremental and full updates
- Update history tracking and metrics
- Robust error handling with retry logic
- Interrupted update detection and recovery
- Comprehensive documentation and troubleshooting guide

Epic #41 was officially closed on January 1, 2026, along with Epic #82 (Docker Containerization and Multi-Transport MCP) which completed all 22 of its issues.
