# Development Plan: Issue #13 - Search Service Implementation

**Issue:** [#13 - Search Service Implementation](https://github.com/sethb75/PersonalKnowledgeMCP/issues/13)
**Branch:** `feature/13-search-service`
**Worktree:** `C:\src\PersonalKnowledgeMCP-issue-13`
**Size Estimate:** M (Medium) - 6-8 hours
**Priority:** P0 (Critical)
**Phase:** Phase 1

## Overview

Implement the `SearchService` that provides high-level semantic search operations. This service coordinates query embedding generation, vector similarity search, and result formatting for the Personal Knowledge MCP system.

## Objectives

- Accept natural language queries from MCP tools
- Generate query embeddings using the EmbeddingProvider
- Search across one or all indexed repositories
- Filter results by similarity threshold
- Return formatted, ranked results with performance metrics
- Meet performance target: <500ms query response time (p95)

## Architecture & Design

### Component Dependencies

```
SearchService
├── EmbeddingProvider (Issue #4) - Generate query embeddings
├── ChromaStorageClient (Issue #3) - Vector similarity search
└── RepositoryService (Issue #5) - Repository metadata
```

### Key Interfaces

```typescript
// Input
interface SearchQuery {
  query: string;           // Natural language query
  limit: number;           // Max results (default: 10, range: 1-50)
  threshold: number;       // Min similarity (default: 0.7, range: 0-1)
  repository?: string;     // Optional repo filter
}

// Output
interface SearchResponse {
  results: SearchResult[];
  metadata: {
    total_matches: number;
    query_time_ms: number;
    embedding_time_ms: number;
    search_time_ms: number;
    repositories_searched: string[];
  };
}

interface SearchResult {
  file_path: string;
  repository: string;
  content_snippet: string;   // Truncated to ~500 chars
  similarity_score: number;  // 0.0 to 1.0
  chunk_index: number;
  metadata: {
    file_extension: string;
    file_size_bytes: number;
    indexed_at: string;
  };
}
```

### Design Decisions

1. **Validation Strategy**: Use Zod schemas for runtime validation with clear error messages
2. **Performance Tracking**: Use `performance.now()` for high-resolution timing at each step
3. **Snippet Truncation**: Truncate at word boundaries when possible for better readability
4. **Empty Results**: Return structured empty response rather than null/undefined
5. **Collection Selection**: Filter to only 'ready' repositories to avoid partial results

## Implementation Steps

### Step 1: Setup and Types (30 min)
- [ ] Create `src/services/search-service.ts`
- [ ] Create `src/types/search.ts` for SearchQuery, SearchResponse, SearchResult interfaces
- [ ] Add Zod validation schemas
- [ ] Export from `src/services/index.ts`

### Step 2: Core SearchService Class (1.5 hours)
- [ ] Implement constructor with dependency injection
  - [ ] EmbeddingProvider
  - [ ] ChromaStorageClient
  - [ ] RepositoryService
- [ ] Implement `validateQuery()` method using Zod
- [ ] Implement `emptyResponse()` helper
- [ ] Add error classes (ValidationError, SearchError)

### Step 3: Main Search Logic (2 hours)
- [ ] Implement `search(query: SearchQuery)` method:
  - [ ] Input validation
  - [ ] Collection determination (single repo vs all repos)
  - [ ] Query embedding generation with timing
  - [ ] Similarity search with timing
  - [ ] Result formatting
  - [ ] Metadata assembly
- [ ] Implement `formatResult()` helper
- [ ] Implement `truncateSnippet()` helper
- [ ] Implement `getRepoNames()` helper

### Step 4: Utility Functions (30 min)
- [ ] Snippet truncation with word boundary detection
- [ ] Distance to similarity score conversion
- [ ] Repository name extraction from collection names

### Step 5: Unit Tests (2 hours)
- [ ] Test file: `tests/services/search-service.test.ts`
- [ ] Mock dependencies (EmbeddingProvider, ChromaStorageClient, RepositoryService)
- [ ] Test cases:
  - [ ] Valid query processing end-to-end
  - [ ] Input validation errors (empty query, invalid limit, invalid threshold)
  - [ ] Single repository search
  - [ ] Multi-repository search
  - [ ] Repository filter with non-existent repo
  - [ ] Result formatting correctness
  - [ ] Snippet truncation (short content, long content, word boundary)
  - [ ] Empty results handling (no repos, no matches)
  - [ ] Timing metadata accuracy
  - [ ] Similarity score conversion
- [ ] Target: 95%+ coverage

### Step 6: Integration Tests (1.5 hours)
- [ ] Test file: `tests/integration/search-service.integration.test.ts`
- [ ] Setup: Real ChromaDB instance, real RepositoryService, mock EmbeddingProvider
- [ ] Test cases:
  - [ ] Search against indexed test repository
  - [ ] Threshold filtering works correctly
  - [ ] Limit parameter respected
  - [ ] Repository filter works
  - [ ] Multi-repo search aggregation

### Step 7: Performance Validation (30 min)
- [ ] Create performance test: `tests/performance/search-service.perf.test.ts`
- [ ] Measure query response time (target: <500ms p95)
- [ ] Measure timing breakdown:
  - [ ] Embedding generation: ~50-100ms
  - [ ] Vector search: ~50-200ms
  - [ ] Overhead: ~10-50ms
- [ ] Test with various query sizes and result counts

### Step 8: Documentation (30 min)
- [ ] Add JSDoc comments to all public methods
- [ ] Document constructor parameters
- [ ] Document error conditions
- [ ] Add usage examples in comments
- [ ] Update README if needed

### Step 9: Final Review (30 min)
- [ ] Run full test suite: `bun test --coverage`
- [ ] Verify coverage ≥95%
- [ ] Run type check: `bun run typecheck`
- [ ] Check lint: `bun run lint` (if configured)
- [ ] Verify all acceptance criteria met

## Testing Strategy

### Unit Tests (95% Coverage Target)

**Happy Path:**
- Valid query with all parameters
- Valid query with defaults
- Single repository search
- Multi-repository search

**Edge Cases:**
- Empty query string
- Query at max length (1000 chars)
- Limit boundaries (1, 50)
- Threshold boundaries (0, 1)
- No repositories indexed
- Repository not found
- All repositories not ready
- Empty search results

**Result Formatting:**
- Content shorter than 500 chars
- Content longer than 500 chars
- Word boundary truncation
- Distance to similarity conversion
- Metadata extraction

### Integration Tests

**Real ChromaDB Interaction:**
- Index small test repository
- Perform semantic search
- Verify result ordering by similarity
- Test threshold filtering
- Test limit parameter
- Test repository filter

### Performance Tests

**Timing Validation:**
- Measure p50, p95, p99 query times
- Verify <500ms p95 target
- Breakdown timing by component
- Test with 10, 50, 100 result limits

## Dependencies

### Blocking Dependencies (Must be complete)
- [x] #3 ChromaDB Storage Client (completed)
- [x] #4 Embedding Provider (completed)
- [x] #5 Repository Metadata Store (completed)

### Related Issues
- **Blocked by this:** #11 MCP Semantic Search Tool

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Total query time (p95) | <500ms | End-to-end |
| Embedding generation | ~50-100ms | OpenAI API call |
| Vector search | ~50-200ms | ChromaDB query |
| Formatting overhead | ~10-50ms | Result processing |

## Error Handling

### Validation Errors
- Empty or invalid query string
- Limit out of range (not 1-50)
- Threshold out of range (not 0-1)
- Repository not found

### Runtime Errors
- Embedding generation failure
- ChromaDB connection failure
- No repositories available
- Repository not in 'ready' state

All errors should be properly typed and include helpful messages.

## Definition of Done

- [x] All implementation steps completed
- [ ] SearchService class implemented with full TypeScript types
- [ ] Zod validation schemas for all inputs
- [ ] Unit tests passing with ≥95% coverage
- [ ] Integration tests passing
- [ ] Performance tests meeting <500ms target
- [ ] JSDoc comments on all public methods
- [ ] No TypeScript errors (`bun run typecheck`)
- [ ] Exported from services module index
- [ ] All acceptance criteria from issue #13 met

## Implementation Notes

### Snippet Truncation Logic
```typescript
const SNIPPET_MAX_LENGTH = 500;

function truncateSnippet(content: string): string {
  if (content.length <= SNIPPET_MAX_LENGTH) {
    return content;
  }

  const truncated = content.substring(0, SNIPPET_MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');

  // Only truncate at word boundary if it's reasonably close to max
  if (lastSpace > SNIPPET_MAX_LENGTH - 50) {
    return truncated.substring(0, lastSpace) + '...';
  }
  return truncated + '...';
}
```

### Collection Selection Strategy
```typescript
// Only search repositories in 'ready' state
const repos = await this.repositoryService.listRepositories();
const readyRepos = repos.filter(r => r.status === 'ready');
const collections = readyRepos.map(r => r.collectionName);
```

### Timing Measurement Pattern
```typescript
const startTime = performance.now();
// ... operation ...
const elapsedMs = Math.round(performance.now() - startTime);
```

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenAI API latency exceeds 100ms | High | Monitor and consider caching common queries |
| ChromaDB search slower than expected | High | Optimize collection size, index configuration |
| Memory usage for large result sets | Medium | Strict limit enforcement (max 50) |
| Repository in 'indexing' state | Low | Filter to 'ready' status only |

## Success Criteria

1. ✅ All unit tests pass with ≥95% coverage
2. ✅ All integration tests pass
3. ✅ Performance target met (<500ms p95)
4. ✅ Type-safe implementation (no `any` types)
5. ✅ Comprehensive error handling
6. ✅ Well-documented public API

## Next Steps After Completion

1. Create PR against main branch
2. Ensure CI/CD checks pass
3. Request code review
4. Address review feedback
5. Merge to main
6. Unblock issue #11 (MCP Semantic Search Tool)

---

**Created:** 2025-12-11
**Last Updated:** 2025-12-11
**Status:** Ready to implement
