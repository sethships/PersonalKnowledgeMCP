# [Feature] Repository Metadata Store

## Description

Implement the `RepositoryMetadataStore` that manages repository metadata in a JSON file. This component tracks which repositories are indexed, their status, configuration, and statistics.

## Requirements

From SDD Section 5.2:
- JSON file-based storage at `./data/repositories.json`
- Track repository metadata including URL, path, status, and statistics
- Support CRUD operations on repository records
- Thread-safe file operations

## Acceptance Criteria

### Interface (`src/storage/repository-metadata.ts`)
- [ ] `RepositoryService` interface defined with:
  - [ ] `listRepositories(): Promise<RepositoryInfo[]>`
  - [ ] `getRepository(name: string): Promise<RepositoryInfo | null>`
  - [ ] `updateRepository(info: RepositoryInfo): Promise<void>`
  - [ ] `removeRepository(name: string): Promise<void>`
- [ ] `RepositoryInfo` interface matching SDD spec

### Implementation
- [ ] File location: `{DATA_PATH}/repositories.json`
- [ ] Auto-creates file if not exists (with version and empty repos)
- [ ] Atomic writes (write to temp file, then rename)
- [ ] File format matches SDD Section 5.2 schema
- [ ] Version field: `"1.0"`
- [ ] Handles file read/write errors gracefully

### Data Model (`RepositoryInfo`)
- [ ] `name: string` - Repository identifier
- [ ] `url: string` - Original clone URL
- [ ] `localPath: string` - Path to cloned repo
- [ ] `collectionName: string` - ChromaDB collection name
- [ ] `fileCount: number` - Number of files indexed
- [ ] `chunkCount: number` - Total chunks created
- [ ] `lastIndexedAt: string` - ISO 8601 timestamp
- [ ] `indexDurationMs: number` - Time taken to index
- [ ] `status: "ready" | "indexing" | "error"`
- [ ] `errorMessage?: string` - Error details if status is "error"
- [ ] `branch: string` - Branch that was indexed
- [ ] `includeExtensions: string[]` - File extensions included
- [ ] `excludePatterns: string[]` - Patterns excluded

### Error Handling
- [ ] File not found: Create new empty store
- [ ] Parse error: Log warning, create new store
- [ ] Write error: Throw with meaningful message

## Technical Notes

### File Format (from SDD 5.2)

```json
{
  "version": "1.0",
  "repositories": {
    "my-api": {
      "name": "my-api",
      "url": "https://github.com/user/my-api.git",
      "localPath": "./data/repos/my-api",
      "collectionName": "repo_my_api",
      "fileCount": 127,
      "chunkCount": 342,
      "lastIndexedAt": "2025-12-10T15:30:00Z",
      "indexDurationMs": 45230,
      "status": "ready",
      "branch": "main",
      "includeExtensions": [".ts", ".js", ".md"],
      "excludePatterns": ["node_modules/**", "dist/**"]
    }
  }
}
```

### Atomic Write Pattern

```typescript
async function atomicWrite(path: string, data: object): Promise<void> {
  const tempPath = `${path}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
  await fs.rename(tempPath, path);
}
```

### Collection Name Sanitization

```typescript
function sanitizeCollectionName(name: string): string {
  // Replace non-alphanumeric with underscore, lowercase
  return `repo_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}
```

### Data Path Configuration

```typescript
const dataPath = process.env.DATA_PATH || './data';
const metadataPath = path.join(dataPath, 'repositories.json');
```

## Testing Requirements

- [ ] Unit tests (90% coverage):
  - [ ] Create new store when file doesn't exist
  - [ ] Read existing store
  - [ ] Add new repository
  - [ ] Update existing repository
  - [ ] Remove repository
  - [ ] List all repositories
  - [ ] Get single repository
  - [ ] Handle missing repository gracefully
- [ ] File operation tests:
  - [ ] Atomic write prevents corruption
  - [ ] Handle concurrent writes (basic)

## Definition of Done

- [ ] Interface and implementation complete
- [ ] Unit tests passing (90% coverage)
- [ ] File operations are atomic
- [ ] Error handling robust
- [ ] JSDoc comments on public methods
- [ ] Exported from storage module index

## Size Estimate

**Size:** S (Small) - 3-4 hours

## Dependencies

- #1 Project Setup

## Blocks

- #9 Ingestion Service
- #12 List Repositories MCP Tool

## Labels

phase-1, P0, feature
