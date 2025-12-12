# Development Plan: Issue #12 - Ingestion Service Implementation

**Feature**: Ingestion Service Implementation
**Issue**: #12
**Branch**: `feature/12-ingestion-service`
**Worktree**: `C:\src\PersonalKnowledgeMCP-issue12`
**Estimated Size**: L (Large) - 8-12 hours
**Priority**: P0 (Critical)
**Phase**: Phase 1 - Core MCP + Vector Search

---

## Overview

Implement the `IngestionService` that orchestrates the complete repository indexing workflow. This service coordinates the cloner, scanner, chunker, embedding provider, and storage components to index repositories end-to-end.

## Objectives

1. Orchestrate the complete end-to-end repository indexing pipeline
2. Coordinate all ingestion components (cloner, scanner, chunker, embedding, storage)
3. Implement robust error handling with partial failure support
4. Provide progress reporting for UX feedback
5. Support re-indexing and repository removal operations
6. Achieve 90%+ test coverage with comprehensive unit and integration tests

---

## Prerequisites ✅

All dependencies are **COMPLETE** (verified 2025-12-11):
- ✅ #3 - EPIC: Phase 1 Core (CLOSED)
- ✅ #4 - Project Setup and Tooling (CLOSED)
- ✅ #5 - Docker Compose for ChromaDB (CLOSED)
- ✅ #6 - ChromaDB Storage Client (CLOSED)
- ✅ #7 - Embedding Provider (CLOSED)
- ✅ #8 - Repository Metadata Store (CLOSED)

**Additional Dependencies** (verify status before implementation):
- File Scanner (referenced in issue - check if implemented)
- File Chunker (referenced in issue - check if implemented)
- Repository Cloner (referenced in issue - check if implemented)

---

## Blocks

This issue blocks:
- **#13** - CLI Commands Implementation (index command specifically)

---

## Implementation Phases

### Phase 1: Core Infrastructure & Types (1-2 hours)

**Files to create:**
- `src/services/ingestion-service.ts` - Main service implementation
- `src/types/ingestion.ts` - TypeScript interfaces

**Tasks:**

1. **Define TypeScript Interfaces**
   ```typescript
   interface IndexOptions {
     name?: string;                 // Override repository name
     branch?: string;               // Branch to clone
     shallow?: boolean;             // Shallow clone (default: true)
     includeExtensions?: string[];  // Override default extensions
     excludePatterns?: string[];    // Additional exclude patterns
     onProgress?: (progress: IndexProgress) => void;
   }

   interface IndexProgress {
     phase: 'cloning' | 'scanning' | 'chunking' | 'embedding' | 'storing';
     filesProcessed: number;
     totalFiles: number;
     chunksCreated: number;
     currentFile?: string;
   }

   interface IndexResult {
     repository: string;
     status: "success" | "partial" | "failed";
     filesProcessed: number;
     chunksCreated: number;
     durationMs: number;
     errors?: string[];
   }

   interface IngestionStatus {
     isIndexing: boolean;
     currentRepository?: string;
     progress?: IndexProgress;
   }
   ```

2. **Create IngestionService Class Structure**
   - Constructor with dependency injection:
     - `RepositoryCloner`
     - `FileScanner`
     - `FileChunker`
     - `EmbeddingProvider`
     - `ChromaStorageClient`
     - `RepositoryService`

3. **Add State Management Fields**
   - `isIndexing: boolean`
   - `currentRepository?: string`
   - `currentStatus?: IngestionStatus`
   - `currentProgressCallback?: (progress: IndexProgress) => void`

**Acceptance Criteria:**
- [ ] All interfaces defined matching SDD Section 4.4
- [ ] Class structure complete with proper types
- [ ] Constructor accepts all dependencies
- [ ] State management fields initialized

---

### Phase 2: Index Repository Operation (3-4 hours)

**Method**: `indexRepository(url: string, options?: IndexOptions): Promise<IndexResult>`

**Implementation Flow:**

```typescript
async indexRepository(url: string, options: IndexOptions = {}): Promise<IndexResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // Validation
    this.validateUrl(url);
    const repoName = options.name || this.extractRepoName(url);

    // Set indexing state
    this.isIndexing = true;
    this.currentRepository = repoName;
    this.currentProgressCallback = options.onProgress;

    // Phase 1: Clone repository
    this.reportProgress({ phase: 'cloning', filesProcessed: 0, totalFiles: 0, chunksCreated: 0 });
    const clonePath = await this.cloner.clone(url, {
      branch: options.branch,
      shallow: options.shallow ?? true
    });

    // Phase 2: Scan files
    this.reportProgress({ phase: 'scanning', filesProcessed: 0, totalFiles: 0, chunksCreated: 0 });
    const files = await this.scanner.scanFiles(clonePath, {
      includeExtensions: options.includeExtensions,
      excludePatterns: options.excludePatterns
    });

    // Phase 3: Create ChromaDB collection
    const collectionName = this.sanitizeCollectionName(repoName);
    await this.storage.getOrCreateCollection(collectionName);

    // Phase 4: Process files in batches
    const batchSize = 50;
    let chunksCreated = 0;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      try {
        // Chunk files
        this.reportProgress({
          phase: 'chunking',
          filesProcessed: i,
          totalFiles: files.length,
          chunksCreated
        });
        const chunks = await this.chunkBatch(batch, repoName);

        // Generate embeddings
        this.reportProgress({
          phase: 'embedding',
          filesProcessed: i,
          totalFiles: files.length,
          chunksCreated
        });
        const embeddings = await this.embeddingProvider.generateEmbeddings(
          chunks.map(c => c.content)
        );

        // Store in ChromaDB
        this.reportProgress({
          phase: 'storing',
          filesProcessed: i,
          totalFiles: files.length,
          chunksCreated
        });
        await this.storage.addDocuments(
          collectionName,
          chunks.map((chunk, j) => ({
            id: chunk.id,
            content: chunk.content,
            embedding: embeddings[j],
            metadata: this.buildMetadata(chunk)
          }))
        );

        chunksCreated += chunks.length;
      } catch (error) {
        // Log error but continue with next batch
        errors.push(`Batch ${i}-${i+batchSize}: ${error.message}`);
      }
    }

    // Phase 5: Update repository metadata
    await this.repositoryService.updateRepository({
      name: repoName,
      url,
      localPath: clonePath,
      collectionName,
      fileCount: files.length,
      chunkCount: chunksCreated,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: Date.now() - startTime,
      status: errors.length > 0 ? 'partial' : 'ready'
    });

    return {
      repository: repoName,
      status: errors.length > 0 ? 'partial' : 'success',
      filesProcessed: files.length,
      chunksCreated,
      durationMs: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error) {
    // Handle fatal errors
    return {
      repository: repoName || 'unknown',
      status: 'failed',
      filesProcessed: 0,
      chunksCreated: 0,
      durationMs: Date.now() - startTime,
      errors: [error.message]
    };
  } finally {
    this.isIndexing = false;
    this.currentRepository = undefined;
    this.currentProgressCallback = undefined;
  }
}
```

**Batch Processing Strategy:**
- File batch size: 50 files
- Embedding batch size: 100 texts (OpenAI limit)
- Process embeddings per file batch
- Continue on individual batch errors (graceful degradation)

**Acceptance Criteria:**
- [ ] URL validation implemented
- [ ] All 5 pipeline phases execute correctly
- [ ] Progress callback invoked for each phase
- [ ] Batch processing handles files correctly
- [ ] ChromaDB collection created and populated
- [ ] Repository metadata persisted
- [ ] Partial failures tracked and reported
- [ ] Fatal errors handled gracefully
- [ ] Result object complete and accurate

---

### Phase 3: Re-index Operation (1 hour)

**Method**: `reindexRepository(name: string): Promise<IndexResult>`

```typescript
async reindexRepository(name: string): Promise<IndexResult> {
  // 1. Lookup existing repository
  const repo = await this.repositoryService.getRepository(name);
  if (!repo) {
    throw new Error(`Repository not found: ${name}`);
  }

  // 2. Delete existing ChromaDB collection
  await this.storage.deleteCollection(repo.collectionName);

  // 3. Re-index using stored URL and options
  return this.indexRepository(repo.url, {
    name: repo.name,
    branch: repo.branch,
    // Preserve original options if stored
  });
}
```

**Acceptance Criteria:**
- [ ] Repository lookup validates existence
- [ ] Collection deletion successful
- [ ] Re-indexing delegates to indexRepository
- [ ] Metadata updated with new timestamps

---

### Phase 4: Remove Operation (1 hour)

**Method**: `removeRepository(name: string): Promise<void>`

```typescript
async removeRepository(name: string): Promise<void> {
  // 1. Lookup repository
  const repo = await this.repositoryService.getRepository(name);
  if (!repo) {
    throw new Error(`Repository not found: ${name}`);
  }

  // 2. Delete ChromaDB collection
  await this.storage.deleteCollection(repo.collectionName);

  // 3. Remove metadata
  await this.repositoryService.deleteRepository(name);

  // 4. Optionally delete cloned files
  // (Add option parameter if needed)
}
```

**Acceptance Criteria:**
- [ ] Repository validation
- [ ] Collection deletion successful
- [ ] Metadata removal successful
- [ ] Error handling for missing resources

---

### Phase 5: Status & Progress Operations (1 hour)

**Method**: `getStatus(): Promise<IngestionStatus>`

```typescript
async getStatus(): Promise<IngestionStatus> {
  return {
    isIndexing: this.isIndexing,
    currentRepository: this.currentRepository,
    progress: this.currentStatus?.progress
  };
}

private reportProgress(progress: IndexProgress): void {
  this.currentStatus = {
    isIndexing: true,
    currentRepository: this.currentRepository,
    progress
  };

  if (this.currentProgressCallback) {
    this.currentProgressCallback(progress);
  }
}
```

**Acceptance Criteria:**
- [ ] getStatus returns correct state
- [ ] Progress included when indexing
- [ ] Progress callback invoked when set
- [ ] State management accurate

---

### Phase 6: Helper Utilities (1 hour)

**Utility Functions:**

```typescript
private validateUrl(url: string): void {
  // GitHub URL validation
  const githubPattern = /^https:\/\/github\.com\/[\w-]+\/[\w-]+(.git)?$/;
  if (!githubPattern.test(url)) {
    throw new Error('Invalid GitHub repository URL');
  }
}

private extractRepoName(url: string): string {
  // Extract "repo-name" from "https://github.com/user/repo-name.git"
  const match = url.match(/\/([^\/]+?)(\.git)?$/);
  return match ? match[1] : 'unknown';
}

private sanitizeCollectionName(name: string): string {
  // ChromaDB collection name requirements:
  // - alphanumeric, underscores, hyphens
  // - starts with letter
  // - max 63 chars
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[^a-z]/, 'repo-')
    .substring(0, 63);
}

private buildMetadata(chunk: Chunk): Record<string, any> {
  return {
    file_path: chunk.filePath,
    chunk_index: chunk.index,
    repository: chunk.repository,
    language: chunk.language,
    // Additional metadata as needed
  };
}

private async chunkBatch(files: FileInfo[], repoName: string): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for (const file of files) {
    const fileChunks = await this.chunker.chunkFile(file, repoName);
    chunks.push(...fileChunks);
  }
  return chunks;
}
```

**Acceptance Criteria:**
- [ ] URL validation handles GitHub URLs
- [ ] Repository name extraction works
- [ ] Collection name sanitization produces valid names
- [ ] Metadata structure correct
- [ ] Batch chunking aggregates properly

---

## Testing Strategy

### Unit Tests (2-3 hours, target 90% coverage)

**Test Suite**: `tests/unit/services/ingestion-service.test.ts`

**Mock Strategy:**
- Mock all injected dependencies
- Use test fixtures for file data
- Deterministic test data

**Test Cases:**

1. **indexRepository Tests**
   - [ ] Happy path - successful complete indexing
   - [ ] URL validation - invalid URLs rejected
   - [ ] Clone failure handling
   - [ ] Scan failure handling
   - [ ] Chunk failure handling
   - [ ] Embedding generation failure
   - [ ] Storage failure handling
   - [ ] Partial failure - some batches fail
   - [ ] Progress callback invoked at each phase
   - [ ] Batch processing handles file count correctly
   - [ ] Metadata persistence called with correct data
   - [ ] isIndexing flag managed correctly

2. **reindexRepository Tests**
   - [ ] Happy path - successful re-index
   - [ ] Repository not found error
   - [ ] Collection deletion failure
   - [ ] Delegates to indexRepository correctly

3. **removeRepository Tests**
   - [ ] Happy path - successful removal
   - [ ] Repository not found error
   - [ ] Collection deletion failure
   - [ ] Metadata removal failure

4. **getStatus Tests**
   - [ ] Not indexing state
   - [ ] Indexing in progress state
   - [ ] Progress data included when indexing

5. **Helper Function Tests**
   - [ ] validateUrl - valid GitHub URLs pass
   - [ ] validateUrl - invalid URLs fail
   - [ ] extractRepoName - various URL formats
   - [ ] sanitizeCollectionName - edge cases
   - [ ] buildMetadata - structure correct
   - [ ] chunkBatch - aggregation logic

**Coverage Target**: >= 90%

---

### Integration Tests (1-2 hours)

**Test Suite**: `tests/integration/ingestion-service.integration.test.ts`

**Requirements:**
- Real ChromaDB container (docker-compose or testcontainers)
- Small test repository fixture
- Real file operations

**Test Cases:**
1. [ ] Index small test repository end-to-end
2. [ ] Re-index existing repository
3. [ ] Remove repository and verify cleanup
4. [ ] Verify data in ChromaDB after indexing
5. [ ] Query indexed data via storage client
6. [ ] Progress reporting functional
7. [ ] Error recovery and partial indexing

---

### Performance Tests (1 hour)

**Test Suite**: `tests/performance/ingestion-service.perf.test.ts`

**Test Cases:**
1. [ ] Small repo (<100 files) - index in <2 minutes
2. [ ] Medium repo (100-500 files) - index in <5 minutes
3. [ ] Measure embedding generation throughput
4. [ ] Measure batch processing efficiency
5. [ ] Verify p95 query latency <500ms (if applicable)

**Performance Targets:**
- Small repo (<100 files): <2 minutes
- Medium repo (100-500 files): <5 minutes

---

## Export and Documentation

### Module Exports

**File**: `src/services/index.ts`

```typescript
export { IngestionService } from './ingestion-service';
export type {
  IndexOptions,
  IndexProgress,
  IndexResult,
  IngestionStatus
} from '../types/ingestion';
```

### JSDoc Documentation

Add comprehensive JSDoc to all public methods:

```typescript
/**
 * Indexes a GitHub repository by cloning, scanning, chunking, embedding, and storing in ChromaDB.
 *
 * @param url - GitHub repository URL (e.g., "https://github.com/user/repo.git")
 * @param options - Optional indexing configuration
 * @returns Promise resolving to indexing result with statistics and errors
 *
 * @example
 * ```typescript
 * const result = await ingestionService.indexRepository(
 *   'https://github.com/user/my-repo.git',
 *   {
 *     branch: 'main',
 *     onProgress: (progress) => console.log(progress.phase)
 *   }
 * );
 * console.log(`Indexed ${result.filesProcessed} files`);
 * ```
 */
async indexRepository(url: string, options?: IndexOptions): Promise<IndexResult>
```

---

## Definition of Done Checklist

- [ ] **Implementation Complete**
  - [ ] All acceptance criteria met for all phases
  - [ ] TypeScript types complete and accurate
  - [ ] All methods implemented per specification

- [ ] **Testing Complete**
  - [ ] Unit tests implemented (90%+ coverage)
  - [ ] Integration tests passing
  - [ ] Performance tests passing
  - [ ] All edge cases covered

- [ ] **Quality Checks**
  - [ ] No TypeScript errors (`bun run typecheck`)
  - [ ] All tests pass (`bun test --coverage`)
  - [ ] Linting passes (`bun run lint`)
  - [ ] Code follows project style guidelines

- [ ] **Documentation**
  - [ ] JSDoc comments on all public methods
  - [ ] Exported from services module index
  - [ ] README updated if needed

- [ ] **PR Requirements**
  - [ ] Branch created from main
  - [ ] PR created with descriptive title
  - [ ] PR description includes:
    - Issue link (#12)
    - Summary of changes
    - Test results
    - Example usage
  - [ ] At least one reviewer assigned
  - [ ] CI/CD checks passing

---

## Implementation Order

1. ✅ Create branch and worktree (COMPLETE)
2. ✅ Create development plan (COMPLETE)
3. Phase 6: Helper Utilities (needed by other phases)
4. Phase 1: Core Infrastructure & Types
5. Phase 5: Status & Progress Operations
6. Phase 2: Index Repository Operation
7. Phase 3: Re-index Operation
8. Phase 4: Remove Operation
9. Unit Tests
10. Integration Tests
11. Performance Tests
12. Documentation and exports
13. Final verification and cleanup
14. Create Pull Request

---

## Notes & Considerations

### Concurrency
- **Phase 1**: Single repository at a time (sequential)
- Use `isIndexing` flag to prevent concurrent indexing
- Future phases can add queuing if needed

### Error Handling Strategy
- **Individual file errors**: Log and continue (graceful degradation)
- **Batch errors**: Track in errors array, continue with next batch
- **Fatal errors**: Return failed status with error message
- **Partial success**: Return "partial" status with error summary

### Progress Reporting
- Report progress at each major phase transition
- Update progress during batch processing
- Enable CLI/UX feedback for long operations
- Optional callback - don't block if not provided

### Performance Considerations
- Batch size (50 files) balances memory vs. throughput
- Embedding batch size (100) respects OpenAI limits
- Monitor and profile if performance issues arise
- Future optimization: parallel chunking/embedding

### Future Enhancements
- Concurrent repository indexing (with queue)
- Incremental updates (changed files only)
- Resume interrupted indexing
- Compression for large repositories
- Real-time progress updates via WebSocket

---

## Related Issues & Dependencies

**Depends On:**
- ✅ #3 - EPIC Phase 1 Core (CLOSED)
- ✅ #4 - Project Setup (CLOSED)
- ✅ #5 - ChromaDB Docker (CLOSED)
- ✅ #6 - ChromaDB Storage Client (CLOSED)
- ✅ #7 - Embedding Provider (CLOSED)
- ✅ #8 - Repository Metadata Store (CLOSED)

**Blocks:**
- #13 - CLI Commands (index command needs this)

**Related:**
- #15 - MCP list_indexed_repositories tool
- #16 - CLI Commands
- #19 - Test Coverage Validation

---

## Next Steps After Completion

1. Implement #13 (CLI Commands) - `index` command will use this service
2. Integrate with #15 (MCP tools) for Claude Code access
3. Complete Phase 1 with remaining components
4. System-level integration and E2E testing

---

**Plan Created**: 2025-12-11
**Status**: Ready to begin implementation
**Worktree**: C:\src\PersonalKnowledgeMCP-issue12
