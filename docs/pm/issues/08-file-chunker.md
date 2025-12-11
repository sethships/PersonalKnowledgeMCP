# [Feature] File Chunker Implementation

## Description

Implement the `FileChunker` component that splits files into embedding-appropriate chunks. This component handles large file splitting with configurable overlap to maintain context across chunk boundaries.

## Requirements

From PRD FR-4 (chunking) and SDD Section 6.6:
- Split large files into chunks based on token limit
- Preserve line boundaries for readability
- Maintain overlap between chunks for context
- Track chunk positions within original file
- Compute content hash for deduplication

## Acceptance Criteria

### Implementation (`src/ingestion/file-chunker.ts`)
- [ ] `FileChunker` class implemented
- [ ] Chunk operation:
  - [ ] `chunkFile(fileInfo: FileInfo, repository: string): Promise<FileChunk[]>`
  - [ ] Returns array of chunks (possibly single chunk for small files)
- [ ] Token estimation:
  - [ ] Rough estimate: ~4 characters per token (code-specific)
  - [ ] Or use `tiktoken` library for accuracy (optional enhancement)
- [ ] Chunking configuration:
  - [ ] `maxChunkTokens` - Max tokens per chunk (default: 500)
  - [ ] `overlapTokens` - Overlap between chunks (default: 50)
  - [ ] Configurable via environment variables
- [ ] Small file handling:
  - [ ] Files under `maxChunkTokens` return single chunk
  - [ ] No unnecessary splitting
- [ ] Large file handling:
  - [ ] Split at line boundaries (not mid-line)
  - [ ] Include overlap lines from previous chunk
  - [ ] Track start/end line numbers
- [ ] Chunk identification:
  - [ ] Unique ID format: `{repo}:{file_path}:{chunk_index}`
  - [ ] Content hash (SHA-256) for deduplication
- [ ] Safety limits:
  - [ ] Max chunks per file: 100 (from SDD 11.4)
  - [ ] Log warning if file exceeds limit

### Interfaces

```typescript
interface ChunkerConfig {
  maxChunkTokens?: number;   // Default: 500
  overlapTokens?: number;    // Default: 50
}

interface FileChunk {
  id: string;                // Unique chunk ID
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

## Technical Notes

### Token Estimation

Simple approach (adequate for Phase 1):
```typescript
function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for code
  return Math.ceil(text.length / 4);
}
```

Alternative (more accurate):
```typescript
import { encoding_for_model } from 'tiktoken';
const encoder = encoding_for_model('text-embedding-3-small');
const tokenCount = encoder.encode(text).length;
```

### Content Hash Computation

```typescript
import crypto from 'crypto';

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
```

### Chunk ID Format

```typescript
function createChunkId(repo: string, path: string, index: number): string {
  return `${repo}:${path}:${index}`;
}
// Example: "my-api:src/auth/middleware.ts:0"
```

### Line-Based Chunking Algorithm

```typescript
function splitIntoChunks(content: string, config: ChunkerConfig): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkStartLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokens(line);

    if (currentTokens + lineTokens > config.maxChunkTokens && currentChunk.length > 0) {
      // Save current chunk
      chunks.push(createChunk(currentChunk, chunkStartLine, chunks.length));

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

  // Don't forget last chunk
  if (currentChunk.length > 0) {
    chunks.push(createChunk(currentChunk, chunkStartLine, chunks.length));
  }

  return chunks;
}
```

### Overlap Strategy

```typescript
function getOverlapLines(chunk: string[], overlapTokens: number): string[] {
  const overlap: string[] = [];
  let tokens = 0;

  // Take lines from end of chunk until we hit overlap limit
  for (let i = chunk.length - 1; i >= 0 && tokens < overlapTokens; i--) {
    overlap.unshift(chunk[i]);
    tokens += estimateTokens(chunk[i]);
  }

  return overlap;
}
```

### Environment Variables

- `CHUNK_MAX_TOKENS` - Default: 500
- `CHUNK_OVERLAP_TOKENS` - Default: 50

## Testing Requirements

- [ ] Unit tests (95% coverage):
  - [ ] Small file (no chunking needed)
  - [ ] Large file (multiple chunks)
  - [ ] Overlap correctness
  - [ ] Line boundary preservation
  - [ ] Token estimation
  - [ ] Content hash generation
  - [ ] Chunk ID format
  - [ ] Total chunks count updated
- [ ] Edge cases:
  - [ ] Empty file
  - [ ] Single very long line
  - [ ] File with only whitespace
  - [ ] Chunk limit exceeded (100 chunks)
- [ ] Integration with FileInfo:
  - [ ] Metadata preservation
  - [ ] File path handling

## Definition of Done

- [ ] Implementation complete with TypeScript types
- [ ] Unit tests passing (95% coverage)
- [ ] Token estimation reasonable for code
- [ ] Overlap provides context continuity
- [ ] JSDoc comments on public methods
- [ ] Exported from ingestion module index

## Size Estimate

**Size:** M (Medium) - 4-6 hours

## Dependencies

- #1 Project Setup
- #7 File Scanner (for FileInfo type)

## Blocks

- #9 Ingestion Service

## Labels

phase-1, P0, feature
