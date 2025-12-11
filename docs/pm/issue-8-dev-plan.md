# Development Plan: Repository Metadata Store (Issue #8)

## Overview

**Issue:** [#8 - Repository Metadata Store](https://github.com/sethb75/PersonalKnowledgeMCP/issues/8)
**Priority:** P0 (Critical)
**Phase:** Phase 1 - Core MCP + Vector Search
**Size Estimate:** Small (3-4 hours)
**Branch:** feature/8-repository-metadata-store
**Worktree:** C:\src\PersonalKnowledgeMCP-issue-8

## Objectives

Implement a JSON file-based metadata store that:
1. Tracks which repositories are indexed in the system
2. Stores repository metadata (URL, status, statistics, configuration)
3. Provides thread-safe CRUD operations
4. Uses atomic writes to prevent data corruption
5. Handles errors gracefully with proper fallback behavior

## Dependencies

### Blocked By
- ✅ #1 Project Setup (COMPLETED)

### Blocks
- #9 Ingestion Service (needs metadata store to track indexing status)
- #12 List Repositories MCP Tool (needs metadata store to list repos)

## Technical Approach

### File Structure

**New Files:**
- `src/storage/repository-metadata.ts` - Interface and implementation
- `src/storage/index.ts` - Module exports (update)
- `tests/unit/storage/repository-metadata.test.ts` - Unit tests
- `tests/integration/storage/repository-metadata.integration.test.ts` - Integration tests

### Data Model

```typescript
interface RepositoryInfo {
  name: string;                    // Repository identifier
  url: string;                     // Original clone URL
  localPath: string;               // Path to cloned repo
  collectionName: string;          // ChromaDB collection name
  fileCount: number;               // Number of files indexed
  chunkCount: number;              // Total chunks created
  lastIndexedAt: string;           // ISO 8601 timestamp
  indexDurationMs: number;         // Time taken to index
  status: "ready" | "indexing" | "error";
  errorMessage?: string;           // Error details if status is "error"
  branch: string;                  // Branch that was indexed
  includeExtensions: string[];     // File extensions included
  excludePatterns: string[];       // Patterns excluded
}

interface RepositoryService {
  listRepositories(): Promise<RepositoryInfo[]>;
  getRepository(name: string): Promise<RepositoryInfo | null>;
  updateRepository(info: RepositoryInfo): Promise<void>;
  removeRepository(name: string): Promise<void>;
}

interface MetadataStore {
  version: string;
  repositories: Record<string, RepositoryInfo>;
}
```

### Storage Location

- **File Path:** `{DATA_PATH}/repositories.json`
- **Default:** `./data/repositories.json`
- **Configuration:** Via `process.env.DATA_PATH` or config file

### Key Implementation Patterns

#### 1. Atomic Writes
```typescript
async function atomicWrite(path: string, data: object): Promise<void> {
  const tempPath = `${path}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
  await fs.rename(tempPath, path);
}
```

#### 2. Collection Name Sanitization
```typescript
function sanitizeCollectionName(name: string): string {
  return `repo_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}
```

#### 3. Error Handling Strategy
- **File not found:** Create new empty store with version
- **Parse error:** Log warning, create new store
- **Write error:** Throw with meaningful error message
- **Concurrent access:** Use atomic writes (rename is atomic on most filesystems)

## Implementation Steps

### Step 1: Define Interfaces (30 min)
- [ ] Create `src/storage/repository-metadata.ts`
- [ ] Define `RepositoryInfo` interface with all required fields
- [ ] Define `RepositoryService` interface with CRUD methods
- [ ] Define internal `MetadataStore` interface for file format
- [ ] Add JSDoc comments to all interfaces

### Step 2: Implement Core Metadata Store (90 min)
- [ ] Implement `FileBasedRepositoryMetadataStore` class
- [ ] Constructor: Initialize file path from config/env
- [ ] `ensureInitialized()`: Create file if not exists
- [ ] `loadStore()`: Read and parse JSON file
- [ ] `saveStore()`: Atomic write to JSON file
- [ ] `listRepositories()`: Return all repositories as array
- [ ] `getRepository()`: Find and return single repository
- [ ] `updateRepository()`: Add or update repository record
- [ ] `removeRepository()`: Delete repository record
- [ ] Add comprehensive error handling
- [ ] Add file locking or synchronization for thread safety

### Step 3: Utility Functions (15 min)
- [ ] `sanitizeCollectionName()`: Convert repo name to valid ChromaDB collection
- [ ] `atomicWrite()`: Helper for safe file writes
- [ ] Validation helpers for RepositoryInfo fields

### Step 4: Configuration Integration (15 min)
- [ ] Add `DATA_PATH` to environment variables
- [ ] Update `.env.example` with `DATA_PATH` example
- [ ] Integrate with existing config module if applicable
- [ ] Document configuration in README

### Step 5: Module Exports (5 min)
- [ ] Export interfaces from `src/storage/repository-metadata.ts`
- [ ] Update `src/storage/index.ts` to re-export metadata store
- [ ] Ensure clean module structure

### Step 6: Unit Tests (60 min)
- [ ] Setup test fixtures and helpers
- [ ] Test: Create new store when file doesn't exist
- [ ] Test: Read existing store successfully
- [ ] Test: Add new repository
- [ ] Test: Update existing repository
- [ ] Test: Remove repository
- [ ] Test: List all repositories
- [ ] Test: Get single repository (exists)
- [ ] Test: Get single repository (not found) returns null
- [ ] Test: Handle corrupted JSON gracefully
- [ ] Test: Atomic write prevents corruption
- [ ] Test: Concurrent write handling (basic)
- [ ] Achieve 90%+ test coverage

### Step 7: Integration Tests (30 min)
- [ ] Test: Full lifecycle (create, update, list, remove)
- [ ] Test: Multiple repositories in store
- [ ] Test: Persistence across instance recreation
- [ ] Test: Real file system operations

### Step 8: Documentation (20 min)
- [ ] Add comprehensive JSDoc to all public methods
- [ ] Document file format in code comments
- [ ] Add usage examples in comments
- [ ] Update README if needed
- [ ] Create ADR if architectural decisions made

### Step 9: Code Review Prep (15 min)
- [ ] Run `bun test --coverage` - ensure 90%+ coverage
- [ ] Run `bun run typecheck` - ensure no type errors
- [ ] Run `bun run build` - ensure clean build
- [ ] Format code consistently
- [ ] Review all acceptance criteria from issue

### Step 10: PR Creation (15 min)
- [ ] Verify all tests pass
- [ ] Verify CI/CD checks would pass
- [ ] Create PR with detailed description
- [ ] Link to issue #8
- [ ] Add checklist of implemented features
- [ ] Request review

## Testing Strategy

### Unit Tests (90% Coverage Target)

**File:** `tests/unit/storage/repository-metadata.test.ts`

```typescript
describe('FileBasedRepositoryMetadataStore', () => {
  describe('initialization', () => {
    it('should create new store when file does not exist');
    it('should load existing store successfully');
    it('should handle corrupted JSON by creating new store');
  });

  describe('listRepositories', () => {
    it('should return empty array for new store');
    it('should return all repositories');
  });

  describe('getRepository', () => {
    it('should return repository when found');
    it('should return null when not found');
  });

  describe('updateRepository', () => {
    it('should add new repository');
    it('should update existing repository');
    it('should sanitize collection name');
  });

  describe('removeRepository', () => {
    it('should remove existing repository');
    it('should handle removing non-existent repository');
  });

  describe('atomic writes', () => {
    it('should use temp file for writes');
    it('should not corrupt data on failed write');
  });
});
```

### Integration Tests

**File:** `tests/integration/storage/repository-metadata.integration.test.ts`

```typescript
describe('RepositoryMetadataStore Integration', () => {
  it('should persist data across instance recreation');
  it('should handle multiple concurrent operations');
  it('should work with real file system');
});
```

## Acceptance Criteria Checklist

### Interface Definition
- [ ] `RepositoryService` interface with all required methods
- [ ] `RepositoryInfo` interface with all required fields
- [ ] Proper TypeScript types (no `any`)

### Implementation
- [ ] File location: `{DATA_PATH}/repositories.json`
- [ ] Auto-creates file if not exists
- [ ] Atomic writes (temp file + rename)
- [ ] File format matches SDD Section 5.2 schema
- [ ] Version field: `"1.0"`
- [ ] Handles read/write errors gracefully

### Data Model
- [ ] All `RepositoryInfo` fields implemented
- [ ] Status enum: `"ready" | "indexing" | "error"`
- [ ] Optional `errorMessage` field
- [ ] Arrays for `includeExtensions` and `excludePatterns`

### Error Handling
- [ ] File not found → create new store
- [ ] Parse error → log warning, create new store
- [ ] Write error → throw meaningful error
- [ ] Graceful degradation

### Testing
- [ ] 90%+ unit test coverage
- [ ] All edge cases covered
- [ ] Integration tests pass
- [ ] Atomic write verification

### Documentation
- [ ] JSDoc on all public methods
- [ ] Exported from storage module index
- [ ] Usage examples in comments
- [ ] README updated if needed

### Build & Quality
- [ ] `bun test --coverage` passes (90%+)
- [ ] `bun run typecheck` passes
- [ ] `bun run build` succeeds
- [ ] No linting errors

## Definition of Done

- ✅ All acceptance criteria met
- ✅ All unit tests passing (90%+ coverage)
- ✅ All integration tests passing
- ✅ Type checking passes with no errors
- ✅ Build completes successfully
- ✅ Code reviewed and approved
- ✅ PR merged to main
- ✅ No regressions in existing functionality

## Risk Assessment

### Low Risk
- File-based storage is simple and well-understood
- No external dependencies required
- Atomic writes prevent most corruption scenarios

### Medium Risk
- Concurrent access handling (mitigated by atomic writes)
- File system permissions issues (mitigated by error handling)

### Mitigation Strategies
1. **Atomic Writes:** Use temp file + rename pattern
2. **Error Logging:** Comprehensive error messages for debugging
3. **Validation:** Validate all input data before writing
4. **Testing:** High test coverage catches edge cases

## Notes

- This is a foundational component - keep it simple and robust
- Focus on correctness over performance (files are small)
- Atomic writes are sufficient for MVP; can add proper locking later if needed
- Collection name sanitization ensures ChromaDB compatibility
- Consider adding schema validation in future iterations

## Time Estimates

| Step | Estimated Time |
|------|----------------|
| Define Interfaces | 30 min |
| Implement Core Store | 90 min |
| Utility Functions | 15 min |
| Configuration | 15 min |
| Module Exports | 5 min |
| Unit Tests | 60 min |
| Integration Tests | 30 min |
| Documentation | 20 min |
| Code Review Prep | 15 min |
| PR Creation | 15 min |
| **Total** | **~4.8 hours** |

*Note: Estimate assumes no major blockers. Add 20% buffer for unexpected issues.*

## Success Metrics

- ✅ Repository metadata can be persisted and retrieved
- ✅ Atomic writes prevent data corruption
- ✅ 90%+ test coverage achieved
- ✅ All type checks pass
- ✅ Ready for integration with Ingestion Service (#9)
- ✅ Ready for use by List Repositories tool (#12)

## Next Steps After Completion

1. Merge PR to main
2. Unblock issue #9 (Ingestion Service)
3. Unblock issue #12 (List Repositories MCP Tool)
4. Monitor for any production issues
5. Consider enhancements (schema validation, migrations, etc.)
