# [Feature] File Scanner Implementation

## Description

Implement the `FileScanner` component that recursively scans repository directories to identify files for indexing. This component handles file extension filtering, .gitignore rule application, and default exclusion patterns.

## Requirements

From PRD FR-4 and SDD Section 6.5:
- Recursively scan repository directories
- Filter by configurable file extensions
- Apply .gitignore rules
- Exclude common non-code directories
- Return file metadata for each discovered file

## Acceptance Criteria

### Implementation (`src/ingestion/file-scanner.ts`)
- [ ] `FileScanner` class implemented
- [ ] Uses `glob` and `ignore` npm packages
- [ ] Scan operation:
  - [ ] `scanFiles(repoPath: string, options?: ScanOptions): Promise<FileInfo[]>`
  - [ ] Returns array of file info objects
  - [ ] Supports configurable extensions
  - [ ] Supports additional exclude patterns
- [ ] Default file extensions (from PRD FR-4):
  - [ ] Source: `.js`, `.ts`, `.jsx`, `.tsx`, `.cs`, `.py`, `.java`, `.go`, `.rs`, `.cpp`, `.c`, `.h`
  - [ ] Docs: `.md`, `.txt`, `.rst`
  - [ ] Config: `.json`, `.yaml`, `.yml`, `.toml`
- [ ] Default exclusions (from SDD 6.5):
  - [ ] `node_modules/**`
  - [ ] `.git/**`
  - [ ] `dist/**`, `build/**`
  - [ ] `bin/**`, `obj/**`
  - [ ] `*.min.js`, `*.min.css`
  - [ ] `package-lock.json`, `yarn.lock`
- [ ] .gitignore handling:
  - [ ] Load `.gitignore` from repository root if present
  - [ ] Apply gitignore patterns to filter results
- [ ] File metadata:
  - [ ] `relativePath` - Path relative to repo root
  - [ ] `absolutePath` - Full file path
  - [ ] `extension` - File extension (with dot)
  - [ ] `sizeBytes` - File size
  - [ ] `modifiedAt` - Last modified timestamp
- [ ] Progress reporting callback (optional)

### Interfaces

```typescript
interface ScanOptions {
  includeExtensions?: string[];   // Override default extensions
  excludePatterns?: string[];     // Additional exclude patterns
  onProgress?: (scanned: number, total: number) => void;
}

interface FileInfo {
  relativePath: string;   // e.g., "src/auth/middleware.ts"
  absolutePath: string;   // Full path on file system
  extension: string;      // e.g., ".ts"
  sizeBytes: number;
  modifiedAt: Date;
}
```

## Technical Notes

### Glob Pattern Building

```typescript
const patterns = extensions.map(ext => `**/*${ext}`);
// Result: ['**/*.ts', '**/*.js', '**/*.md', ...]
```

### Using glob Package

```typescript
import { glob } from 'glob';

const files = await glob(patterns, {
  cwd: repoPath,
  ignore: excludePatterns,
  nodir: true,
  absolute: false  // Return relative paths
});
```

### Using ignore Package

```typescript
import ignore from 'ignore';

const ig = ignore();
const gitignoreContent = await fs.readFile('.gitignore', 'utf-8');
ig.add(gitignoreContent);

const filteredFiles = ig.filter(files);
```

### File Stats

```typescript
const stats = await fs.stat(absolutePath);
const fileInfo: FileInfo = {
  relativePath: file,
  absolutePath: path.join(repoPath, file),
  extension: path.extname(file),
  sizeBytes: stats.size,
  modifiedAt: stats.mtime
};
```

### Max File Size

Skip files larger than 1MB (from SDD 11.4):
```typescript
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
if (stats.size > MAX_FILE_SIZE) {
  logger.debug(`Skipping large file: ${file} (${stats.size} bytes)`);
  continue;
}
```

### Windows Path Handling
- Use `path.posix.join()` for consistent forward slashes in relative paths
- Or normalize all paths before storage

## Testing Requirements

- [ ] Unit tests (85% coverage):
  - [ ] Extension filtering
  - [ ] Default exclusion patterns
  - [ ] Custom exclusion patterns
  - [ ] .gitignore parsing
  - [ ] File info extraction
- [ ] Integration tests with test fixtures:
  - [ ] Scan sample repository structure
  - [ ] Verify correct file count
  - [ ] Verify exclusions work
  - [ ] Handle empty directories
  - [ ] Handle nested .gitignore (future)
- [ ] Edge cases:
  - [ ] Empty repository
  - [ ] No matching files
  - [ ] Binary files skipped
  - [ ] Symlinks handled

## Definition of Done

- [ ] Implementation complete with TypeScript types
- [ ] Unit tests passing (85% coverage)
- [ ] Integration tests passing with fixtures
- [ ] Default extensions configurable
- [ ] JSDoc comments on public methods
- [ ] Exported from ingestion module index

## Size Estimate

**Size:** M (Medium) - 4-6 hours

## Dependencies

- #1 Project Setup

## Blocks

- #9 Ingestion Service

## Labels

phase-1, P0, feature
