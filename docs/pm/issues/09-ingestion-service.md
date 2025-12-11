# [Feature] Ingestion Service Implementation

## Description

Implement the `IngestionService` that orchestrates the complete repository indexing workflow. This service coordinates the cloner, scanner, chunker, embedding provider, and storage components to index repositories end-to-end.

## Requirements

From PRD FR-4, FR-5 and SDD Section 4.4:
- Orchestrate full indexing pipeline
- Clone repository (if not already cloned)
- Scan files with filtering
- Chunk files for embedding
- Generate embeddings in batches
- Store in ChromaDB
- Update repository metadata
- Report progress during indexing

## Acceptance Criteria

### Implementation (`src/services/ingestion-service.ts`)
- [ ] `IngestionService` class implemented
- [ ] Dependencies injected:
  - [ ] `RepositoryCloner`
  - [ ] `FileScanner`
  - [ ] `FileChunker`
  - [ ] `EmbeddingProvider`
  - [ ] `ChromaStorageClient`
  - [ ] `RepositoryService`
- [ ] Index operation:
  - [ ] `indexRepository(url: string, options?: IndexOptions): Promise<IndexResult>`
  - [ ] Validates URL before starting
  - [ ] Creates ChromaDB collection for repository
  - [ ] Processes files in batches
  - [ ] Reports progress via callback
- [ ] Re-index operation:
  - [ ] `reindexRepository(name: string): Promise<IndexResult>`
  - [ ] Deletes existing collection
  - [ ] Re-indexes from cloned repository
- [ ] Remove operation:
  - [ ] `removeRepository(name: string): Promise<void>`
  - [ ] Deletes ChromaDB collection
  - [ ] Removes repository metadata
  - [ ] Optionally deletes cloned files
- [ ] Status operation:
  - [ ] `getStatus(): Promise<IngestionStatus>`
  - [ ] Returns current indexing status
  - [ ] Shows progress if indexing in progress
- [ ] Error handling:
  - [ ] Partial failure tracking
  - [ ] Continue on individual file errors
  - [ ] Summary of errors in result

### Interfaces (from SDD 4.4)

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

## Technical Notes

### Pipeline Flow

```typescript
async indexRepository(url: string, options: IndexOptions): Promise<IndexResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // 1. Clone repository
    reportProgress({ phase: 'cloning' });
    const clonePath = await this.cloner.clone(url, {
      branch: options.branch,
      shallow: options.shallow
    });
    const repoName = options.name || extractRepoName(url);

    // 2. Scan files
    reportProgress({ phase: 'scanning' });
    const files = await this.scanner.scanFiles(clonePath, {
      includeExtensions: options.includeExtensions,
      excludePatterns: options.excludePatterns
    });

    // 3. Create collection
    const collectionName = sanitizeCollectionName(repoName);
    await this.storage.getOrCreateCollection(collectionName);

    // 4. Process files in batches
    const batchSize = 50;
    let chunksCreated = 0;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      // Chunk files
      reportProgress({ phase: 'chunking', filesProcessed: i });
      const chunks = await this.chunkBatch(batch, repoName);

      // Generate embeddings
      reportProgress({ phase: 'embedding', filesProcessed: i });
      const embeddings = await this.embeddingProvider.generateEmbeddings(
        chunks.map(c => c.content)
      );

      // Store in ChromaDB
      reportProgress({ phase: 'storing', filesProcessed: i });
      await this.storage.addDocuments(collectionName,
        chunks.map((chunk, j) => ({
          id: chunk.id,
          content: chunk.content,
          embedding: embeddings[j],
          metadata: this.buildMetadata(chunk)
        }))
      );

      chunksCreated += chunks.length;
    }

    // 5. Update metadata
    await this.repositoryService.updateRepository({
      name: repoName,
      url,
      localPath: clonePath,
      collectionName,
      fileCount: files.length,
      chunkCount: chunksCreated,
      lastIndexedAt: new Date().toISOString(),
      indexDurationMs: Date.now() - startTime,
      status: errors.length > 0 ? 'partial' : 'ready',
      // ... other fields
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
  }
}
```

### Batch Processing

- File batch size: 50 files
- Embedding batch size: 100 texts (OpenAI limit)
- Process embeddings per file batch, not all at once

### Progress Reporting

```typescript
private reportProgress(progress: IndexProgress): void {
  if (this.currentProgressCallback) {
    this.currentProgressCallback(progress);
  }
  this.currentStatus = {
    isIndexing: true,
    currentRepository: this.currentRepo,
    progress
  };
}
```

### Error Handling Strategy

- Log errors for individual files
- Continue processing other files
- Report partial success if some files failed
- Return error summary in result

### Concurrency

Phase 1: Single repository at a time (sequential).
Set `isIndexing` flag to prevent concurrent indexing.

## Testing Requirements

- [ ] Unit tests with mocks (90% coverage):
  - [ ] Full pipeline flow
  - [ ] Progress callback invocations
  - [ ] Error handling for each component
  - [ ] Partial failure handling
  - [ ] Status tracking
- [ ] Integration tests:
  - [ ] Index small test repository
  - [ ] Re-index existing repository
  - [ ] Remove repository
  - [ ] Verify data in ChromaDB
- [ ] Performance tests:
  - [ ] Small repo (<100 files) < 2 minutes
  - [ ] Medium repo (100-500 files) < 5 minutes

## Definition of Done

- [ ] Implementation complete with TypeScript types
- [ ] Unit tests passing (90% coverage)
- [ ] Integration tests passing
- [ ] Progress reporting functional
- [ ] Error handling robust
- [ ] JSDoc comments on public methods
- [ ] Exported from services module index

## Size Estimate

**Size:** L (Large) - 8-12 hours

## Dependencies

- #3 ChromaDB Storage Client
- #4 Embedding Provider
- #5 Repository Metadata Store
- #6 Repository Cloner
- #7 File Scanner
- #8 File Chunker

## Blocks

- #13 CLI Commands (index command)

## Labels

phase-1, P0, feature
