# Development Plan: File Scanner Implementation (Issue #10)

## Overview
Implement the `FileScanner` component that recursively scans repository directories to identify files for indexing with extension filtering, .gitignore support, and exclusion patterns.

**Issue:** #10
**Branch:** feature/10-file-scanner-implementation
**Priority:** P0 (Critical - Phase 1)
**Estimate:** 4-6 hours (Medium)
**Blocks:** #9 Ingestion Service

## Objectives

1. Create a robust file scanning component that can discover all indexable files in a repository
2. Support configurable file extension filtering (source, docs, config files)
3. Respect .gitignore rules to avoid indexing ignored files
4. Apply sensible default exclusions (node_modules, build artifacts, etc.)
5. Return comprehensive file metadata for downstream processing
6. Achieve 85%+ test coverage with unit and integration tests

## Technical Approach

### Core Implementation (`src/ingestion/file-scanner.ts`)

**Primary Dependencies:**
- `glob` - Efficient file pattern matching
- `ignore` - .gitignore parsing and filtering
- Built-in `fs/promises` - File system operations
- Built-in `path` - Path manipulation

**Key Components:**

1. **FileScanner Class**
   - Main entry point: `scanFiles(repoPath: string, options?: ScanOptions): Promise<FileInfo[]>`
   - Configurable extension filtering
   - .gitignore integration
   - Progress reporting callback support

2. **Type Definitions**
   ```typescript
   interface ScanOptions {
     includeExtensions?: string[];   // Override defaults
     excludePatterns?: string[];     // Additional exclusions
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

3. **Default Configuration**
   - **Extensions:**
     - Source: `.js`, `.ts`, `.jsx`, `.tsx`, `.cs`, `.py`, `.java`, `.go`, `.rs`, `.cpp`, `.c`, `.h`
     - Docs: `.md`, `.txt`, `.rst`
     - Config: `.json`, `.yaml`, `.yml`, `.toml`
   - **Exclusions:**
     - `node_modules/**`, `.git/**`
     - `dist/**`, `build/**`, `bin/**`, `obj/**`
     - `*.min.js`, `*.min.css`
     - `package-lock.json`, `yarn.lock`
   - **Size Limit:** Skip files > 1MB (per SDD 11.4)

### Implementation Steps

#### Phase 1: Core Scanning (2 hours)
- [ ] Create `src/ingestion/file-scanner.ts`
- [ ] Define TypeScript interfaces (`ScanOptions`, `FileInfo`)
- [ ] Implement `FileScanner` class with basic structure
- [ ] Add default extension and exclusion pattern constants
- [ ] Implement glob-based file discovery
  - Build glob patterns from extensions
  - Configure glob with exclusion patterns
  - Return relative paths from repository root
- [ ] Extract file metadata for each discovered file
  - Absolute and relative paths
  - Extension extraction
  - File size and modified timestamp
  - Apply 1MB size filter

#### Phase 2: .gitignore Integration (1 hour)
- [ ] Implement .gitignore loading from repository root
- [ ] Use `ignore` package to parse .gitignore content
- [ ] Apply gitignore filters to glob results
- [ ] Handle missing .gitignore gracefully
- [ ] Log debug messages for ignored files

#### Phase 3: Progress Reporting & Polish (1 hour)
- [ ] Implement optional progress callback
- [ ] Add comprehensive logging (debug level for file-by-file)
- [ ] Handle edge cases:
  - Empty repositories
  - No matching files
  - Symlinks (skip or follow based on config)
  - Binary files (rely on extension filtering)
- [ ] Windows path normalization (use posix separators)
- [ ] Export from `src/ingestion/index.ts`
- [ ] Add JSDoc comments to public methods

#### Phase 4: Testing (2-3 hours)
- [ ] **Unit Tests** (`tests/ingestion/file-scanner.test.ts`):
  - Extension filtering works correctly
  - Default exclusion patterns applied
  - Custom exclusion patterns applied
  - .gitignore parsing and filtering
  - File metadata extraction accuracy
  - Size limit enforcement (skip >1MB files)
  - Progress callback invocation
  - Target: 85%+ coverage

- [ ] **Integration Tests** (with test fixtures):
  - Create `tests/fixtures/sample-repo/` with known structure
  - Include various file types
  - Add .gitignore with test patterns
  - Verify correct file count returned
  - Verify exclusions work end-to-end
  - Test empty directory handling
  - Test nested structures

- [ ] **Edge Case Tests:**
  - Empty repository (no files)
  - No matching files after filters
  - Repository without .gitignore
  - Symlinks present
  - Deeply nested directories

#### Phase 5: Documentation & PR (30 minutes)
- [ ] Add JSDoc comments to all public APIs
- [ ] Update README if needed (likely minimal)
- [ ] Create PR with:
  - Clear description linking to issue #10
  - Test results and coverage report
  - Example usage snippet
- [ ] Run full test suite: `bun test --coverage`
- [ ] Run type check: `bun run typecheck`
- [ ] Request review

## Key Design Decisions

1. **Why glob + ignore packages?**
   - `glob`: Industry standard for file pattern matching, fast and reliable
   - `ignore`: Official .gitignore spec implementation, handles all edge cases
   - Both are lightweight, well-maintained, and battle-tested

2. **Path Normalization Strategy**
   - Store relative paths with POSIX separators (forward slashes)
   - Convert on Windows using `path.posix.join()` or normalize before storage
   - Ensures cross-platform compatibility in database

3. **Size Limit Rationale**
   - 1MB threshold prevents indexing large binaries or generated files
   - Configurable in future if needed
   - Log skipped files at debug level for visibility

4. **Progress Reporting**
   - Optional callback for CLI feedback
   - Not required for basic operation
   - Enables future UX improvements (progress bars, etc.)

5. **Synchronous vs Async**
   - Use async operations for all file I/O
   - Await glob and fs.stat operations
   - Better integration with async ingestion pipeline

## Testing Strategy

### Test Fixtures Structure
```
tests/fixtures/sample-repo/
├── .gitignore              # Contains: build/, *.log
├── src/
│   ├── index.ts           # Should be included
│   ├── utils.js           # Should be included
│   └── helper.min.js      # Should be excluded (default)
├── docs/
│   └── README.md          # Should be included
├── build/                 # Should be excluded (gitignore)
│   └── output.js
├── node_modules/          # Should be excluded (default)
│   └── package/
├── test.log               # Should be excluded (gitignore)
└── large-file.txt         # Create >1MB, should be excluded
```

### Coverage Targets
- Line coverage: ≥85%
- Branch coverage: ≥80%
- Function coverage: 100%

### Test Execution
```bash
# Run all tests with coverage
bun test --coverage

# Run only file scanner tests
bun test tests/ingestion/file-scanner.test.ts

# Watch mode during development
bun test --watch tests/ingestion/file-scanner.test.ts
```

## Dependencies & Integration

**Depends On:**
- #1 Project Setup (already complete)

**Blocks:**
- #9 Ingestion Service (needs FileScanner to discover files)

**Future Integrations:**
- Ingestion Service will call `scanFiles()` as first step
- Results feed into File Chunker (#11)
- Repository metadata store tracks scan results (#8)

## Success Criteria (Definition of Done)

- ✅ `FileScanner` class implemented with full TypeScript types
- ✅ All acceptance criteria from issue #10 met
- ✅ Unit tests passing with ≥85% coverage
- ✅ Integration tests passing with fixture repository
- ✅ Edge cases handled gracefully
- ✅ JSDoc comments on public methods
- ✅ Exported from `src/ingestion/index.ts`
- ✅ Type checking passes (`bun run typecheck`)
- ✅ Full test suite passes (`bun test`)
- ✅ PR created and reviewed
- ✅ CI/CD checks passing

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Windows path separator issues | Medium | Use posix paths consistently, test on Windows |
| .gitignore edge cases | Low | Use battle-tested `ignore` package |
| Performance on large repos | Medium | Efficient glob patterns, stream processing if needed |
| Binary file detection | Low | Rely on extension filtering, add MIME check if needed |
| Symlink handling | Low | Document behavior, add config option in future |

## Notes

- Keep implementation simple and focused on MVP requirements
- Avoid premature optimization - profile if performance issues arise
- .gitignore support is single-level (repo root) for Phase 1
  - Nested .gitignore support can be added in Phase 2+ if needed
- Progress callback is optional - don't block on UX refinements
- File size limit (1MB) is a sensible default from SDD
- This component is pure file discovery - no content reading or parsing

## References

- Issue #10: https://github.com/sethb75/PersonalKnowledgeMCP/issues/10
- PRD Section FR-4: File type support
- SDD Section 6.5: File Scanner specification
- SDD Section 11.4: File size limits
