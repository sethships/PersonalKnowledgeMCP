# Development Plan: File Chunker Implementation (Issue #11)

**Issue:** [#11 - File Chunker Implementation](https://github.com/sethb75/PersonalKnowledgeMCP/issues/11)
**Branch:** `feature/11-file-chunker-implementation`
**Worktree Location:** `../PersonalKnowledgeMCP-issue-11`
**Estimated Effort:** 4-6 hours (Medium)
**Priority:** P0 (Critical)
**Phase:** Phase 1

## Overview

Implement the `FileChunker` component that intelligently splits files into embedding-appropriate chunks with configurable overlap to maintain context across chunk boundaries. This is a core component of the ingestion pipeline that enables efficient semantic search over large code files.

## Objectives

1. Create a robust file chunking system that handles files of any size
2. Preserve line boundaries for code readability
3. Maintain overlap between chunks for semantic context continuity
4. Support configurable chunk size and overlap parameters
5. Generate unique chunk identifiers and content hashes for deduplication
6. Achieve 95%+ test coverage with comprehensive edge case handling

## Dependencies

### Blocked By
- ✅ #1 Project Setup (Completed)
- ✅ #7 File Scanner (Completed - provides `FileInfo` type)

### Blocks
- #9 Ingestion Service (waiting for this implementation)

## Technical Architecture

### Core Components

#### 1. FileChunker Class (`src/ingestion/file-chunker.ts`)
Primary class responsible for chunking operations with configurable behavior.

#### 2. Configuration Interface
```typescript
interface ChunkerConfig {
  maxChunkTokens?: number;   // Default: 500
  overlapTokens?: number;    // Default: 50
}
```

#### 3. FileChunk Interface
```typescript
interface FileChunk {
  id: string;                // Format: {repo}:{file_path}:{chunk_index}
  filePath: string;          // Original file path
  repository: string;        // Repository name
  content: string;           // Chunk text content
  chunkIndex: number;        // Position in file (0-based)
  totalChunks: number;       // Total chunks for this file
  startLine: number;         // Starting line in original
  endLine: number;           // Ending line in original
  metadata: {
    extension: string;
    sizeBytes: number;
    contentHash: string;     // SHA-256 of chunk content
    fileModifiedAt: Date;
  };
}
```

## Implementation Plan

### Step 1: Type Definitions and Interfaces (30 min)
**File:** `src/types/chunk.ts`

- [ ] Define `ChunkerConfig` interface
- [ ] Define `FileChunk` interface
- [ ] Export types from `src/types/index.ts`
- [ ] Ensure compatibility with existing `FileInfo` type from #7

**Deliverable:** Clean TypeScript interfaces with comprehensive JSDoc comments

---

### Step 2: Token Estimation Utility (45 min)
**File:** `src/ingestion/file-chunker.ts` (helper functions)

#### Implementation Options

**Option A: Simple Character-Based (Recommended for Phase 1)**
```typescript
function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for code
  return Math.ceil(text.length / 4);
}
```
✅ **Pros:** Fast, no dependencies, adequate for MVP
❌ **Cons:** Less accurate than tokenizer

**Option B: tiktoken Library (Future Enhancement)**
```typescript
import { encoding_for_model } from 'tiktoken';

const encoder = encoding_for_model('text-embedding-3-small');
function estimateTokens(text: string): number {
  return encoder.encode(text).length;
}
```
✅ **Pros:** Accurate token counts
❌ **Cons:** Additional dependency, slower

**Decision:** Start with Option A, make it easy to swap implementations later

**Tasks:**
- [ ] Implement `estimateTokens()` helper function
- [ ] Add unit tests for token estimation accuracy
- [ ] Document estimation approach in JSDoc comments

---

### Step 3: Content Hash Computation (30 min)
**File:** `src/ingestion/file-chunker.ts` (helper functions)

```typescript
import crypto from 'crypto';

function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
```

**Tasks:**
- [ ] Implement `computeContentHash()` function using Node crypto
- [ ] Ensure UTF-8 encoding for consistent hashes
- [ ] Add tests verifying hash stability and uniqueness

---

### Step 4: Chunk ID Generation (30 min)
**File:** `src/ingestion/file-chunker.ts` (helper functions)

```typescript
function createChunkId(repository: string, filePath: string, chunkIndex: number): string {
  // Format: "my-api:src/auth/middleware.ts:0"
  return `${repository}:${filePath}:${chunkIndex}`;
}
```

**Tasks:**
- [ ] Implement `createChunkId()` with proper escaping if needed
- [ ] Handle edge cases (special characters in repo/path names)
- [ ] Test ID uniqueness and format consistency

---

### Step 5: Overlap Line Extraction (1 hour)
**File:** `src/ingestion/file-chunker.ts`

Implement algorithm to extract overlap lines from end of previous chunk.

```typescript
function getOverlapLines(lines: string[], overlapTokens: number): string[] {
  const overlap: string[] = [];
  let tokens = 0;

  // Take lines from end of chunk until we hit overlap limit
  for (let i = lines.length - 1; i >= 0 && tokens < overlapTokens; i--) {
    overlap.unshift(lines[i]);
    tokens += estimateTokens(lines[i]);
  }

  return overlap;
}
```

**Key Considerations:**
- Overlap should include enough context but not too much
- Handle edge case where single line exceeds overlap limit
- Ensure overlap is computed from END of previous chunk

**Tasks:**
- [ ] Implement `getOverlapLines()` helper function
- [ ] Test with various overlap sizes
- [ ] Validate that overlap provides semantic continuity
- [ ] Edge case: overlap larger than chunk content

---

### Step 6: Core Chunking Algorithm (2 hours)
**File:** `src/ingestion/file-chunker.ts`

Implement the main line-based chunking logic that splits files intelligently.

#### Algorithm Pseudocode
```
1. Split content into lines
2. Initialize first chunk with empty lines array
3. For each line:
   a. Estimate tokens for current line
   b. If adding line would exceed maxChunkTokens AND chunk is not empty:
      - Save current chunk to results
      - Create new chunk starting with overlap from previous chunk
      - Add current line to new chunk
   c. Else:
      - Add line to current chunk
4. Save final chunk if non-empty
5. Update totalChunks count for all chunks
```

#### Implementation Structure
```typescript
function splitIntoChunks(
  content: string,
  config: ChunkerConfig
): { chunks: string[][], lineRanges: Array<{ start: number; end: number }> } {
  const lines = content.split('\n');
  const chunks: string[][] = [];
  const lineRanges: Array<{ start: number; end: number }> = [];

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkStartLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokens(line);

    if (currentTokens + lineTokens > config.maxChunkTokens && currentChunk.length > 0) {
      // Save current chunk
      lineRanges.push({ start: chunkStartLine, end: i });
      chunks.push([...currentChunk]);

      // Start new chunk with overlap
      const overlapLines = getOverlapLines(currentChunk, config.overlapTokens);
      currentChunk = [...overlapLines, line];
      currentTokens = estimateTokens(currentChunk.join('\n'));
      chunkStartLine = i + 1 - overlapLines.length;
    } else {
      currentChunk.push(line);
      currentTokens += lineTokens;
    }
  }

  // Save last chunk
  if (currentChunk.length > 0) {
    lineRanges.push({ start: chunkStartLine, end: lines.length });
    chunks.push(currentChunk);
  }

  return { chunks, lineRanges };
}
```

**Tasks:**
- [ ] Implement `splitIntoChunks()` core algorithm
- [ ] Handle empty files (return empty array)
- [ ] Handle files smaller than maxChunkTokens (single chunk)
- [ ] Ensure line boundaries are preserved (no mid-line splits)
- [ ] Track start/end line numbers accurately
- [ ] Test with various file sizes and content types

---

### Step 7: FileChunker Class Implementation (1.5 hours)
**File:** `src/ingestion/file-chunker.ts`

Main class that orchestrates chunking operations.

```typescript
export class FileChunker {
  private config: Required<ChunkerConfig>;
  private readonly MAX_CHUNKS_PER_FILE = 100;

  constructor(config?: ChunkerConfig) {
    this.config = {
      maxChunkTokens: config?.maxChunkTokens ?? 500,
      overlapTokens: config?.overlapTokens ?? 50,
    };

    // Load from environment if available
    if (process.env.CHUNK_MAX_TOKENS) {
      this.config.maxChunkTokens = parseInt(process.env.CHUNK_MAX_TOKENS, 10);
    }
    if (process.env.CHUNK_OVERLAP_TOKENS) {
      this.config.overlapTokens = parseInt(process.env.CHUNK_OVERLAP_TOKENS, 10);
    }
  }

  async chunkFile(fileInfo: FileInfo, repository: string): Promise<FileChunk[]> {
    // Implementation here
  }
}
```

#### Key Implementation Points

1. **Configuration Loading**
   - Constructor accepts optional config
   - Override with environment variables if present
   - Validate configuration (overlap < maxTokens)

2. **Main chunkFile() Method**
   - Accept `FileInfo` and repository name
   - Read file content from fileInfo.content or path
   - Call `splitIntoChunks()` algorithm
   - Build `FileChunk` objects with all required fields
   - Compute content hash for each chunk
   - Handle chunk limit (max 100 chunks per file)

3. **Chunk Limit Enforcement**
   - Log warning if file would exceed 100 chunks
   - Options: truncate, throw error, or increase chunk size dynamically
   - **Recommended:** Log warning and return first 100 chunks

**Tasks:**
- [ ] Implement `FileChunker` class constructor
- [ ] Implement `chunkFile()` main method
- [ ] Environment variable loading and validation
- [ ] Chunk limit enforcement (100 chunks max)
- [ ] Proper error handling and logging
- [ ] Integration with FileInfo type

---

### Step 8: Logging Integration (30 min)
**File:** `src/ingestion/file-chunker.ts`

Add appropriate logging for debugging and monitoring.

**Log Points:**
- **DEBUG:** Chunk configuration on initialization
- **DEBUG:** File processing start (file path, size)
- **INFO:** Large file detected (>X chunks)
- **WARN:** Chunk limit exceeded (would produce >100 chunks)
- **DEBUG:** Chunk processing complete (file path, chunk count)

**Tasks:**
- [ ] Import project logger from `src/logging`
- [ ] Add strategic log statements
- [ ] Ensure log messages are informative but not verbose
- [ ] Test logging output in various scenarios

---

### Step 9: Module Exports (15 min)
**Files:** `src/ingestion/index.ts`, `src/types/index.ts`

Ensure proper module exports for clean imports elsewhere.

**Tasks:**
- [ ] Export `FileChunker` from `src/ingestion/index.ts`
- [ ] Export `FileChunk` and `ChunkerConfig` types from `src/types/index.ts`
- [ ] Verify imports work correctly in test files
- [ ] Update barrel exports if needed

---

## Testing Strategy

### Unit Tests (`tests/unit/ingestion/file-chunker.test.ts`)

#### Test Categories

**1. Token Estimation Tests**
- [ ] Empty string returns 0 tokens
- [ ] Known text returns expected token count (~4 chars/token)
- [ ] Unicode characters handled correctly
- [ ] Very long strings estimated correctly

**2. Hash Computation Tests**
- [ ] Same content produces same hash
- [ ] Different content produces different hash
- [ ] Hash is valid SHA-256 hex string (64 characters)
- [ ] UTF-8 encoding consistency

**3. Chunk ID Generation Tests**
- [ ] Format matches specification: `{repo}:{path}:{index}`
- [ ] Special characters in repo/path handled safely
- [ ] Index increments correctly
- [ ] IDs are unique across chunks

**4. Small File Handling**
- [ ] File under token limit returns single chunk
- [ ] Chunk has index 0 and totalChunks 1
- [ ] Content preserved exactly
- [ ] Metadata copied correctly

**5. Large File Chunking**
- [ ] Multiple chunks created when needed
- [ ] All chunks respect maxChunkTokens limit
- [ ] Line boundaries preserved (no mid-line splits)
- [ ] Start/end line numbers tracked correctly
- [ ] Total chunks count accurate for all chunks

**6. Overlap Tests**
- [ ] Overlap lines included in subsequent chunks
- [ ] Overlap respects overlapTokens limit
- [ ] Last chunk's content appears in next chunk's start
- [ ] Overlap provides semantic context continuity

**7. Edge Cases**
- [ ] Empty file returns empty array
- [ ] Single very long line (longer than maxChunkTokens)
- [ ] File with only whitespace/newlines
- [ ] Chunk limit exceeded (>100 chunks) - warning logged
- [ ] File with no final newline
- [ ] Windows vs Unix line endings (\r\n vs \n)

**8. Configuration Tests**
- [ ] Default configuration applied correctly
- [ ] Custom config respected
- [ ] Environment variables override defaults
- [ ] Invalid config values handled gracefully

**9. Integration with FileInfo**
- [ ] FileInfo metadata preserved in chunks
- [ ] File extension copied correctly
- [ ] Modified timestamp preserved
- [ ] Repository name set correctly

**10. Performance Tests**
- [ ] Large file (10K+ lines) processes in reasonable time (<1 second)
- [ ] Memory usage reasonable for large files
- [ ] No memory leaks with repeated chunking

### Coverage Target
- **Minimum:** 95% line coverage
- **Target:** 98%+ with comprehensive edge case testing

---

## Environment Variables

Add to `.env.example`:

```bash
# File Chunker Configuration
CHUNK_MAX_TOKENS=500        # Maximum tokens per chunk (default: 500)
CHUNK_OVERLAP_TOKENS=50     # Overlap tokens between chunks (default: 50)
```

**Tasks:**
- [ ] Update `.env.example` with new variables
- [ ] Document in README.md or configuration docs
- [ ] Add validation for reasonable ranges

---

## Documentation Requirements

### JSDoc Comments

**Class-Level Documentation:**
```typescript
/**
 * FileChunker splits large files into embedding-appropriate chunks with overlap.
 *
 * Preserves line boundaries for code readability and maintains overlap between
 * chunks to ensure semantic context continuity across chunk boundaries.
 *
 * @example
 * ```typescript
 * const chunker = new FileChunker({ maxChunkTokens: 500, overlapTokens: 50 });
 * const chunks = await chunker.chunkFile(fileInfo, 'my-repo');
 * console.log(`Created ${chunks.length} chunks`);
 * ```
 */
```

**Method-Level Documentation:**
- Document all public methods with parameters, return types, and examples
- Explain chunking algorithm behavior
- Note edge cases and limitations

**Tasks:**
- [ ] Add comprehensive JSDoc to FileChunker class
- [ ] Document all public methods
- [ ] Include usage examples
- [ ] Document configuration options

---

## Definition of Done Checklist

### Implementation
- [ ] `FileChunker` class fully implemented in `src/ingestion/file-chunker.ts`
- [ ] All interfaces defined in `src/types/chunk.ts`
- [ ] Token estimation implemented (character-based for Phase 1)
- [ ] Content hash computation (SHA-256)
- [ ] Chunk ID generation with correct format
- [ ] Overlap algorithm working correctly
- [ ] Core chunking algorithm handles all file sizes
- [ ] Chunk limit enforcement (max 100 chunks with warning)
- [ ] Configuration loading from constructor and environment
- [ ] Logging integrated at appropriate levels

### Testing
- [ ] 95%+ test coverage achieved
- [ ] All unit tests passing
- [ ] Edge cases covered:
  - [ ] Empty files
  - [ ] Small files (single chunk)
  - [ ] Large files (multiple chunks)
  - [ ] Very long single lines
  - [ ] Whitespace-only files
  - [ ] Chunk limit exceeded
- [ ] Performance tests for large files

### Documentation
- [ ] JSDoc comments on all public APIs
- [ ] Code comments explaining complex logic
- [ ] `.env.example` updated with new variables
- [ ] Environment variable documentation

### Integration
- [ ] Exported from `src/ingestion/index.ts`
- [ ] Types exported from `src/types/index.ts`
- [ ] Compatible with existing `FileInfo` type
- [ ] Ready for use in #9 Ingestion Service

### Quality
- [ ] TypeScript strict mode compliance
- [ ] No linting errors
- [ ] Code formatted consistently
- [ ] No type `any` used
- [ ] Proper error handling

### Git & CI/CD
- [ ] All changes committed with descriptive messages
- [ ] Tests passing locally: `bun test --coverage`
- [ ] Build successful: `bun run build`
- [ ] Type checking passed: `bun run typecheck`
- [ ] PR created against `main` branch
- [ ] PR description references issue #11
- [ ] CI/CD pipeline passing

---

## Implementation Timeline

### Phase 1: Foundation (1.5 hours)
- Type definitions
- Token estimation utility
- Hash computation
- Chunk ID generation
- Initial test setup

### Phase 2: Core Algorithm (2 hours)
- Overlap line extraction
- Main chunking algorithm
- Line boundary preservation
- Tests for chunking logic

### Phase 3: Integration (1.5 hours)
- FileChunker class implementation
- Configuration loading
- Chunk limit enforcement
- Logging integration

### Phase 4: Testing & Polish (1 hour)
- Comprehensive edge case testing
- Performance testing
- Documentation
- Code review preparation

**Total Estimated Time:** 4-6 hours

---

## Risks and Mitigations

### Risk 1: Token Estimation Inaccuracy
**Impact:** Chunks may exceed embedding model limits
**Likelihood:** Medium
**Mitigation:**
- Start with conservative character-to-token ratio (4:1)
- Add buffer margin to maxChunkTokens
- Plan for tiktoken integration in future if needed

### Risk 2: Very Long Single Lines
**Impact:** Unable to split while preserving line boundaries
**Likelihood:** Low (rare in code)
**Mitigation:**
- Log warning for lines exceeding chunk limit
- Accept single chunk exceeding limit rather than splitting mid-line
- Document limitation

### Risk 3: Performance with Large Files
**Impact:** Slow chunking could delay repository indexing
**Likelihood:** Low
**Mitigation:**
- Use efficient string operations (avoid repeated concatenation)
- Stream processing if needed for very large files
- Performance tests in test suite

### Risk 4: Chunk Limit Too Restrictive
**Impact:** Cannot process very large files (>100 chunks)
**Likelihood:** Low
**Mitigation:**
- 100 chunks × 500 tokens = 50K tokens (125K characters) should cover most files
- Log detailed warning with file path for investigation
- Make limit configurable if needed

---

## Post-Implementation Tasks

### Immediate Follow-ups
- [ ] Update issue #9 (Ingestion Service) to integrate FileChunker
- [ ] Consider performance profiling with real-world codebases
- [ ] Evaluate need for tiktoken integration based on embedding accuracy

### Future Enhancements (Not in Scope)
- Language-aware chunking (keep functions/classes together)
- AST-based chunking for better semantic boundaries (Phase 2)
- Parallel chunking for multiple files
- Streaming for extremely large files

---

## References

- **Issue:** https://github.com/sethb75/PersonalKnowledgeMCP/issues/11
- **PRD:** `docs/High-level-Personal-Knowledge-MCP-PRD.md`
- **SDD Section:** 6.6 (File Chunking Logic)
- **Related Issues:** #7 (File Scanner), #9 (Ingestion Service)
- **Milestone:** Phase 1 - Core MCP + Vector Search

---

## Notes for Implementation

### Development Environment Setup
```bash
# Navigate to worktree
cd ../PersonalKnowledgeMCP-issue-11

# Install dependencies (if not already done)
bun install

# Run tests in watch mode during development
bun test --watch

# Check test coverage
bun test --coverage
```

### Recommended Implementation Order
1. Start with types and interfaces (clear contracts)
2. Build helper functions with tests (token estimation, hashing, IDs)
3. Implement overlap logic with tests
4. Build core chunking algorithm with comprehensive tests
5. Wrap in FileChunker class
6. Add logging and configuration
7. Final integration and polish

### Testing During Development
- Write tests BEFORE implementation (TDD approach recommended)
- Run tests frequently: `bun test --watch`
- Aim for green tests before moving to next component
- Use test coverage to identify gaps: `bun test --coverage`

### Commit Strategy
- Small, focused commits (one logical change per commit)
- Conventional commit format: `feat(chunker): add token estimation utility`
- Commit types: `feat`, `test`, `refactor`, `docs`, `fix`
- Push frequently to remote branch for backup

---

**Created:** 2025-12-11
**Worktree:** `../PersonalKnowledgeMCP-issue-11`
**Branch:** `feature/11-file-chunker-implementation`
**Status:** Ready for implementation
