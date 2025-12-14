# Incremental Updates Implementation Roadmap

**Version:** 1.1
**Date:** December 14, 2025
**Status:** Issues Created - Ready for Implementation
**Parent Document:** [incremental-updates-plan.md](../architecture/incremental-updates-plan.md)
**Project Phase:** Extension of Phase 1 (Core MCP + Vector Search)
**Epic:** [#41 - Incremental Updates Feature](https://github.com/sethb75/PersonalKnowledgeMCP/issues/41)
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

### Phase 1: Foundation - Execution Order

| Order | Issue | Title | Priority | Effort | Depends On |
|-------|-------|-------|----------|--------|------------|
| 1 | [#42](https://github.com/sethb75/PersonalKnowledgeMCP/issues/42) | Repository Metadata Schema Extension | P0 | 2-4h | — |
| 1 | [#44](https://github.com/sethb75/PersonalKnowledgeMCP/issues/44) | ChromaDB Upsert and Delete Operations | P0 | 4-6h | — |
| 2 | [#43](https://github.com/sethb75/PersonalKnowledgeMCP/issues/43) | GitHub API Client for Change Detection | P0 | 4-6h | #42 |
| 3 | [#45](https://github.com/sethb75/PersonalKnowledgeMCP/issues/45) | Incremental Update Pipeline | P0 | 6-8h | #44 |
| 4 | [#46](https://github.com/sethb75/PersonalKnowledgeMCP/issues/46) | Update Coordinator Service | P0 | 4-6h | #43, #45 |
| 5 | [#47](https://github.com/sethb75/PersonalKnowledgeMCP/issues/47) | CLI Update Commands | P0 | 3-4h | #46 |
| 6 | [#48](https://github.com/sethb75/PersonalKnowledgeMCP/issues/48) | Foundation Phase Unit and Integration Tests | P0 | 4-6h | #42-#47 |

**Parallel Tracks:** Issues #42 and #44 can be worked simultaneously (no dependencies).

### Phase 2: Observability - Execution Order

| Order | Issue | Title | Priority | Effort | Depends On |
|-------|-------|-------|----------|--------|------------|
| 1 | [#49](https://github.com/sethb75/PersonalKnowledgeMCP/issues/49) | Update History Tracking | P1 | 3-4h | Phase 1 |
| 1 | [#51](https://github.com/sethb75/PersonalKnowledgeMCP/issues/51) | Enhanced Status Command with Update Information | P1 | 2-3h | Phase 1 |
| 1 | [#52](https://github.com/sethb75/PersonalKnowledgeMCP/issues/52) | Structured Logging for Update Operations | P1 | 2-3h | Phase 1 |
| 1 | [#53](https://github.com/sethb75/PersonalKnowledgeMCP/issues/53) | Update Metrics Tracking | P2 | 2-3h | Phase 1 |
| 2 | [#50](https://github.com/sethb75/PersonalKnowledgeMCP/issues/50) | CLI History Command | P1 | 2-3h | #49 |

**Parallel Tracks:** Issues #49, #51, #52, #53 can all be worked simultaneously after Phase 1 completes.

### Phase 3: Robustness - Execution Order

| Order | Issue | Title | Priority | Effort | Depends On |
|-------|-------|-------|----------|--------|------------|
| 1 | [#54](https://github.com/sethb75/PersonalKnowledgeMCP/issues/54) | Interrupted Update Detection | P1 | 3-4h | Phase 2 |
| 1 | [#56](https://github.com/sethb75/PersonalKnowledgeMCP/issues/56) | Retry Logic with Exponential Backoff | P1 | 2-3h | Phase 1 |
| 1 | [#57](https://github.com/sethb75/PersonalKnowledgeMCP/issues/57) | Partial Failure Handling | P1 | 3-4h | Phase 1 |
| 2 | [#55](https://github.com/sethb75/PersonalKnowledgeMCP/issues/55) | Interrupted Update Recovery | P1 | 3-4h | #54 |
| 3 | [#58](https://github.com/sethb75/PersonalKnowledgeMCP/issues/58) | Comprehensive Error Handling Tests | P1 | 3-4h | #54, #55, #56, #57 |
| 4 | [#59](https://github.com/sethb75/PersonalKnowledgeMCP/issues/59) | Documentation Updates for Incremental Updates | P1 | 2-3h | All above |

**Parallel Tracks:** Issues #54, #56, #57 can be worked simultaneously.

---

## Milestone Definitions

### Milestone 1: Incremental Updates - Foundation
**Target Completion:** Week 1-2
**Success Criteria:** Agent can trigger incremental updates via CLI after PR merge

**Definition of Done:**
- [ ] `bun run cli update <repo>` command functional
- [ ] `bun run cli update-all` command functional
- [ ] GitHub API integration for commit comparison working
- [ ] ChromaDB upsert/delete operations implemented
- [ ] Force push detection triggers full re-index
- [ ] Update time <1 minute for typical PRs (5-20 files)
- [ ] Unit tests with 90%+ coverage for new components
- [ ] Integration tests passing

### Milestone 2: Incremental Updates - Observability
**Target Completion:** Week 2-3
**Success Criteria:** Full visibility into update operations via CLI and logs

**Definition of Done:**
- [ ] Update history tracking per repository (last N updates)
- [ ] `bun run cli history <repo>` command functional
- [ ] Enhanced `bun run cli status` shows update information
- [ ] Structured logging for all update operations
- [ ] Update metrics (duration, chunk counts, errors) tracked
- [ ] Documentation for observability features

### Milestone 3: Incremental Updates - Robustness
**Target Completion:** Week 3-4
**Success Criteria:** Graceful handling of all error scenarios

**Definition of Done:**
- [ ] Interrupted update detection and recovery
- [ ] Retry logic with exponential backoff
- [ ] 500-file threshold triggers full re-index
- [ ] Partial failure handling (continue on individual file errors)
- [ ] Clear error messages in CLI output
- [ ] Comprehensive error handling tests
- [ ] Documentation updated with troubleshooting guide

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

#### 1.4 Incremental Update Pipeline — [#45](https://github.com/sethb75/PersonalKnowledgeMCP/issues/45)
**Effort:** 6-8 hours
**Priority:** P0
**Dependencies:** #44

**Deliverables:**
- Create `IncrementalUpdatePipeline` service
- Implement file change categorization (added/modified/deleted)
- Handle added files: chunk, embed, add to ChromaDB
- Handle modified files: delete old chunks, add new chunks
- Handle deleted files: delete all chunks for file
- Handle renamed files: delete old path, add new path
- Filter changes to relevant extensions only
- Return structured `UpdateResult` with statistics

**Acceptance Criteria:**
- [ ] Processes all change types correctly
- [ ] Only processes files matching include/exclude patterns
- [ ] Returns accurate statistics (files processed, chunks upserted/deleted)
- [ ] Handles empty change lists gracefully
- [ ] Unit tests for each change type

---

#### 1.5 Update Coordinator Service — [#46](https://github.com/sethb75/PersonalKnowledgeMCP/issues/46)
**Effort:** 4-6 hours
**Priority:** P0
**Dependencies:** #43, #45

**Deliverables:**
- Create `IncrementalUpdateCoordinator` service
- Orchestrate full update workflow:
  1. Get repository metadata
  2. Fetch HEAD commit from GitHub
  3. Compare with last indexed commit
  4. Detect changes (or detect force push)
  5. Update local clone (`git pull`)
  6. Process changes via pipeline
  7. Update repository metadata with new commit SHA
- Implement force push detection (commit not found error)
- Implement 500-file threshold check
- Trigger full re-index when appropriate

**Acceptance Criteria:**
- [ ] Full update workflow completes successfully
- [ ] Detects "no changes needed" correctly
- [ ] Force push triggers full re-index with warning
- [ ] >500 files triggers full re-index with warning
- [ ] Updates `lastIndexedCommitSha` on success
- [ ] Integration tests with real repository

---

#### 1.6 CLI Update Commands — [#47](https://github.com/sethb75/PersonalKnowledgeMCP/issues/47)
**Effort:** 3-4 hours
**Priority:** P0
**Dependencies:** #46

**Deliverables:**
- Implement `bun run cli update <repository>` command
  - Option: `--force` for forced full re-index
- Implement `bun run cli update-all` command
  - Sequential processing of all indexed repositories
- Display update results in user-friendly format
- Handle and display errors appropriately

**Acceptance Criteria:**
- [ ] `update <repo>` triggers incremental update
- [ ] `update <repo> --force` triggers full re-index
- [ ] `update-all` processes all ready repositories
- [ ] Clear output showing what changed
- [ ] Error messages are actionable
- [ ] `--help` shows command documentation

---

#### 1.7 Unit and Integration Tests for Foundation — [#48](https://github.com/sethb75/PersonalKnowledgeMCP/issues/48)
**Effort:** 4-6 hours
**Priority:** P0
**Dependencies:** #42-#47

**Deliverables:**
- Unit tests for all new services
- Integration tests for update workflow
- Mock fixtures for GitHub API responses
- Test coverage report showing 90%+ for new code
- Update CI/CD pipeline to run new tests

**Acceptance Criteria:**
- [ ] All new code has unit tests
- [ ] Integration test validates end-to-end flow
- [ ] Test coverage >= 90% for new components
- [ ] Tests run in CI/CD pipeline
- [ ] No flaky tests

---

### Phase 2: Observability (3-4 days)

#### 2.1 Update History Tracking — [#49](https://github.com/sethb75/PersonalKnowledgeMCP/issues/49)
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** Phase 1 complete (#48)

**Deliverables:**
- Add `updateHistory` field to repository metadata
- Track last N updates (configurable, default 20)
- Store: timestamp, commit range, file counts, duration, errors
- Implement history rotation (drop oldest when limit reached)
- Unit tests for history management

**Acceptance Criteria:**
- [ ] Updates are recorded in history
- [ ] History is persisted across restarts
- [ ] Old entries are rotated out
- [ ] History includes all relevant metrics

---

#### 2.2 CLI History Command — [#50](https://github.com/sethb75/PersonalKnowledgeMCP/issues/50)
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** #49

**Deliverables:**
- Implement `bun run cli history <repository>` command
  - Option: `--limit N` to show last N updates
- Display update history in tabular format
- Show: timestamp, commit range, files changed, duration, status
- Handle empty history gracefully

**Acceptance Criteria:**
- [ ] History command shows update records
- [ ] `--limit` option works correctly
- [ ] Output is readable and well-formatted
- [ ] Handles repositories with no history

---

#### 2.3 Enhanced Status Command — [#51](https://github.com/sethb75/PersonalKnowledgeMCP/issues/51)
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** Phase 1 complete (#48)

**Deliverables:**
- Enhance `bun run cli status` to show update information
- Display: last indexed commit, last update time, update count
- Show if repository is up-to-date or has pending changes
- Add `--check` option to check for available updates

**Acceptance Criteria:**
- [ ] Status shows update-related metadata
- [ ] Can see at a glance if repo needs update
- [ ] `--check` option queries GitHub for new commits
- [ ] Clear visual indication of status

---

#### 2.4 Structured Logging for Updates — [#52](https://github.com/sethb75/PersonalKnowledgeMCP/issues/52)
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** Phase 1 complete (#48)

**Deliverables:**
- Add structured logging throughout update pipeline
- Log: operation start/end, file counts, errors, duration
- Include trace ID for correlating log entries
- Ensure log levels are appropriate (info, warn, error)
- Document log format and fields

**Acceptance Criteria:**
- [ ] All update operations are logged
- [ ] Logs are structured (JSON format)
- [ ] Can trace an update through logs
- [ ] Sensitive data not logged

---

#### 2.5 Update Metrics — [#53](https://github.com/sethb75/PersonalKnowledgeMCP/issues/53)
**Effort:** 2-3 hours
**Priority:** P2
**Dependencies:** Phase 1 complete (#48)

**Deliverables:**
- Track aggregate metrics across updates
- Metrics: total updates, average duration, error rate
- Store metrics in repository metadata
- Display metrics in status output

**Acceptance Criteria:**
- [ ] Metrics are tracked accurately
- [ ] Metrics persist across restarts
- [ ] Metrics visible in CLI status

---

### Phase 3: Robustness (4-5 days)

#### 3.1 Interrupted Update Detection — [#54](https://github.com/sethb75/PersonalKnowledgeMCP/issues/54)
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** Phase 2 complete

**Deliverables:**
- Add `updateInProgress` and `updateStartedAt` to metadata
- Set flag at update start, clear on completion
- Detect interrupted updates on service startup
- Option to resume or reset interrupted updates

**Acceptance Criteria:**
- [ ] Interrupted updates are detected
- [ ] Clear recovery path for interrupted updates
- [ ] No data corruption from interruptions

---

#### 3.2 Interrupted Update Recovery — [#55](https://github.com/sethb75/PersonalKnowledgeMCP/issues/55)
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** #54

**Deliverables:**
- Implement recovery logic for interrupted updates
- Option 1: Complete interrupted update if state recoverable
- Option 2: Trigger full re-index if state unrecoverable
- CLI command to manually reset stuck updates
- Logging for recovery actions

**Acceptance Criteria:**
- [ ] Can recover from typical interruptions
- [ ] Clear notification when recovery occurs
- [ ] Manual reset option available
- [ ] No silent data inconsistencies

---

#### 3.3 Retry Logic with Exponential Backoff — [#56](https://github.com/sethb75/PersonalKnowledgeMCP/issues/56)
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** Phase 1 complete (#48)

**Deliverables:**
- Implement generic retry utility with exponential backoff
- Apply to GitHub API calls
- Apply to OpenAI embedding API calls
- Apply to ChromaDB operations
- Configurable retry parameters

**Acceptance Criteria:**
- [ ] Transient failures are retried automatically
- [ ] Backoff prevents API rate limit exhaustion
- [ ] Max retries prevents infinite loops
- [ ] Non-retryable errors fail immediately

---

#### 3.4 Partial Failure Handling — [#57](https://github.com/sethb75/PersonalKnowledgeMCP/issues/57)
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** Phase 1 complete (#48)

**Deliverables:**
- Continue processing when individual files fail
- Collect errors without stopping pipeline
- Report failures at end with details
- Decision logic: when to commit partial progress
- Clear reporting of which files failed and why

**Acceptance Criteria:**
- [ ] Single file failure doesn't abort entire update
- [ ] All failures are reported clearly
- [ ] Partial progress is saved appropriately
- [ ] User can address specific failures

---

#### 3.5 Comprehensive Error Handling Tests — [#58](https://github.com/sethb75/PersonalKnowledgeMCP/issues/58)
**Effort:** 3-4 hours
**Priority:** P1
**Dependencies:** #54, #55, #56, #57

**Deliverables:**
- Test cases for all error scenarios
- Test interrupted update recovery
- Test retry logic behavior
- Test partial failure handling
- Test threshold-triggered full re-index

**Acceptance Criteria:**
- [ ] All error paths have test coverage
- [ ] Tests simulate realistic failure scenarios
- [ ] No untested error handling code

---

#### 3.6 Documentation Updates — [#59](https://github.com/sethb75/PersonalKnowledgeMCP/issues/59)
**Effort:** 2-3 hours
**Priority:** P1
**Dependencies:** All above (#54-#58)

**Deliverables:**
- Update README with incremental update commands
- Create troubleshooting guide for common issues
- Document error messages and resolutions
- Update architecture documentation
- Add examples to CLI help

**Acceptance Criteria:**
- [ ] All new commands documented
- [ ] Troubleshooting guide covers common errors
- [ ] Architecture docs reflect implementation
- [ ] Users can self-serve for basic issues

---

## Dependency Graph

```
                                Phase 1: Foundation

    [#42 Schema]        [#43 GitHub API]        [#44 ChromaDB Ops]
         |                    |                        |
         +--------------------+                        |
                              |                        |
                       [#45 Update Pipeline] <---------+
                              |
                       [#46 Update Coordinator]
                              |
                       [#47 CLI Commands]
                              |
                       [#48 Tests]
                              |
                              v
                                Phase 2: Observability

    [#49 History Tracking] --> [#50 CLI History]
              |
    [#51 Enhanced Status]     (can run in parallel)
              |
    [#52 Structured Logging]  (can run in parallel)
              |
    [#53 Update Metrics]      (can run in parallel)
              |
              v
                                Phase 3: Robustness

    [#54 Interrupted Detection] --> [#55 Recovery]
              |                            |
    [#56 Retry Logic]    (parallel)        |
              |                            |
    [#57 Partial Failure] (parallel)       |
              |                            |
              +----------------------------+
                            |
                   [#58 Error Tests]
                            |
                   [#59 Documentation]
                            |
                            v
                        Complete
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

### Overall Success Criteria

- [ ] Agent can update index after merging PRs via CLI
- [ ] Updates complete in <1 minute for typical PRs
- [ ] System recovers gracefully from all common error scenarios
- [ ] Full visibility into update operations via CLI and logs
- [ ] Documentation enables self-service troubleshooting
- [ ] 90%+ test coverage maintained

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
| **Foundation** | #42, #43, #44, #45, #46, #47, #48 | All P0 | ✅ Created |
| **Observability** | #49, #50, #51, #52, #53 | P1/P2 | ✅ Created |
| **Robustness** | #54, #55, #56, #57, #58, #59 | All P1 | ✅ Created |
| **Total** | 18 issues (+ 1 epic) | | |

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

---

**Next Steps:**
1. ~~Create GitHub milestone "Incremental Updates"~~ ✅ Done
2. ~~Create GitHub issues for all work items~~ ✅ Done (19 issues created)
3. Begin Phase 1 implementation starting with [#42 Schema Extension](https://github.com/sethb75/PersonalKnowledgeMCP/issues/42) and [#44 ChromaDB Operations](https://github.com/sethb75/PersonalKnowledgeMCP/issues/44) (can be done in parallel)
