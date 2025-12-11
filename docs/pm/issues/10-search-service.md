# [Feature] Search Service Implementation

## Description

Implement the `SearchService` that provides high-level semantic search operations. This service coordinates query embedding generation, vector similarity search, and result formatting.

## Requirements

From PRD FR-6 and SDD Section 4.3:
- Accept natural language queries
- Generate query embedding
- Search across one or all repositories
- Filter by similarity threshold
- Return formatted, ranked results
- Track query performance metrics

## Acceptance Criteria

### Implementation (`src/services/search-service.ts`)
- [ ] `SearchService` class implemented
- [ ] Dependencies injected:
  - [ ] `EmbeddingProvider`
  - [ ] `ChromaStorageClient`
  - [ ] `RepositoryService`
- [ ] Search operation:
  - [ ] `search(query: SearchQuery): Promise<SearchResponse>`
  - [ ] Generates embedding for query text
  - [ ] Searches specified collections (or all)
  - [ ] Filters by threshold
  - [ ] Returns top-N results ranked by similarity
- [ ] Query timing:
  - [ ] Track total query time
  - [ ] Track embedding generation time
  - [ ] Track search time
  - [ ] Include timing in response
- [ ] Result formatting:
  - [ ] Truncate content snippets (max 500 chars)
  - [ ] Include full metadata
  - [ ] Convert distance to similarity (0-1)
- [ ] Validation:
  - [ ] Query string not empty
  - [ ] Limit within bounds (1-50)
  - [ ] Threshold within bounds (0-1)
  - [ ] Repository exists (if specified)

### Interfaces (from SDD 4.3)

```typescript
interface SearchQuery {
  query: string;           // Natural language query
  limit: number;           // Max results (default: 10)
  threshold: number;       // Min similarity (default: 0.7)
  repository?: string;     // Optional repo filter
}

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

## Technical Notes

### Search Flow

```typescript
async search(query: SearchQuery): Promise<SearchResponse> {
  const startTime = performance.now();

  // 1. Validate input
  this.validateQuery(query);

  // 2. Determine collections to search
  let collections: string[];
  if (query.repository) {
    const repo = await this.repositoryService.getRepository(query.repository);
    if (!repo) throw new ValidationError(`Repository not found: ${query.repository}`);
    collections = [repo.collectionName];
  } else {
    const repos = await this.repositoryService.listRepositories();
    collections = repos.filter(r => r.status === 'ready').map(r => r.collectionName);
  }

  if (collections.length === 0) {
    return this.emptyResponse();
  }

  // 3. Generate query embedding
  const embeddingStart = performance.now();
  const queryEmbedding = await this.embeddingProvider.generateEmbedding(query.query);
  const embeddingTime = performance.now() - embeddingStart;

  // 4. Perform similarity search
  const searchStart = performance.now();
  const rawResults = await this.storage.similaritySearch({
    embedding: queryEmbedding,
    collections,
    limit: query.limit,
    threshold: query.threshold
  });
  const searchTime = performance.now() - searchStart;

  // 5. Format results
  const results = rawResults.map(r => this.formatResult(r));

  return {
    results,
    metadata: {
      total_matches: results.length,
      query_time_ms: Math.round(performance.now() - startTime),
      embedding_time_ms: Math.round(embeddingTime),
      search_time_ms: Math.round(searchTime),
      repositories_searched: this.getRepoNames(collections)
    }
  };
}
```

### Input Validation

```typescript
import { z } from 'zod';

const searchQuerySchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).default(0.7),
  repository: z.string().optional()
});

function validateQuery(input: unknown): SearchQuery {
  return searchQuerySchema.parse(input);
}
```

### Content Snippet Truncation

```typescript
const SNIPPET_MAX_LENGTH = 500;

function truncateSnippet(content: string): string {
  if (content.length <= SNIPPET_MAX_LENGTH) {
    return content;
  }

  // Try to truncate at word boundary
  const truncated = content.substring(0, SNIPPET_MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > SNIPPET_MAX_LENGTH - 50) {
    return truncated.substring(0, lastSpace) + '...';
  }
  return truncated + '...';
}
```

### Empty Response

```typescript
function emptyResponse(): SearchResponse {
  return {
    results: [],
    metadata: {
      total_matches: 0,
      query_time_ms: 0,
      embedding_time_ms: 0,
      search_time_ms: 0,
      repositories_searched: []
    }
  };
}
```

### Performance Target

- Total query time < 500ms (p95)
- Embedding generation: ~50-100ms (OpenAI API)
- Vector search: ~50-200ms (ChromaDB)
- Overhead: ~10-50ms

## Testing Requirements

- [ ] Unit tests with mocks (95% coverage):
  - [ ] Valid query processing
  - [ ] Input validation (all error cases)
  - [ ] Single repository search
  - [ ] Multi-repository search
  - [ ] Result formatting
  - [ ] Snippet truncation
  - [ ] Empty results handling
  - [ ] Timing metadata accuracy
- [ ] Integration tests:
  - [ ] Search indexed repository
  - [ ] Threshold filtering works
  - [ ] Limit respected
  - [ ] Repository filter works
- [ ] Performance tests:
  - [ ] Query response < 500ms (p95)
  - [ ] Measure timing breakdown

## Definition of Done

- [ ] Implementation complete with TypeScript types
- [ ] Unit tests passing (95% coverage)
- [ ] Integration tests passing
- [ ] Performance targets met
- [ ] Zod validation implemented
- [ ] JSDoc comments on public methods
- [ ] Exported from services module index

## Size Estimate

**Size:** M (Medium) - 6-8 hours

## Dependencies

- #3 ChromaDB Storage Client
- #4 Embedding Provider
- #5 Repository Metadata Store

## Blocks

- #11 MCP Semantic Search Tool

## Labels

phase-1, P0, feature
