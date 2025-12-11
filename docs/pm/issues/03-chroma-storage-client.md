# [Feature] ChromaDB Storage Client Implementation

## Description

Implement the `ChromaStorageClient` class that provides an abstraction layer over the ChromaDB JavaScript client. This component handles all vector storage operations including collection management, document storage, and similarity search.

## Requirements

From PRD FR-2 and SDD Section 4.2:
- Collection management (create, delete, list)
- Document storage with embeddings and metadata
- Similarity search with configurable parameters
- Connection health checks
- Proper error handling

## Acceptance Criteria

- [ ] `ChromaStorageClient` interface defined in `src/storage/chroma-client.ts`
- [ ] Implementation class `ChromaStorageClientImpl` created
- [ ] Connection management:
  - [ ] `connect()` establishes connection to ChromaDB
  - [ ] `healthCheck()` returns true when ChromaDB is reachable
  - [ ] Configurable host and port via environment variables
- [ ] Collection operations:
  - [ ] `getOrCreateCollection(name)` creates collection with cosine similarity metric
  - [ ] `deleteCollection(name)` removes collection
  - [ ] `listCollections()` returns all collection info
  - [ ] `getCollectionStats(name)` returns document count and metadata
- [ ] Document operations:
  - [ ] `addDocuments(collectionName, documents)` stores documents with embeddings
  - [ ] Document metadata follows schema from SDD Section 5.1
- [ ] Search operations:
  - [ ] `similaritySearch(query)` performs vector similarity search
  - [ ] Supports searching across multiple collections
  - [ ] Converts ChromaDB distance to similarity score (0-1)
  - [ ] Filters results by threshold
  - [ ] Returns results sorted by similarity (descending)
- [ ] Collection naming follows `repo_<sanitized_name>` convention
- [ ] All methods have proper TypeScript types
- [ ] Errors wrapped in custom `StorageError` class

## Technical Notes

### Interface Definition (from SDD 4.2)

```typescript
interface ChromaStorageClient {
  connect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  getOrCreateCollection(name: string): Promise<ChromaCollection>;
  deleteCollection(name: string): Promise<void>;
  listCollections(): Promise<CollectionInfo[]>;
  addDocuments(collectionName: string, documents: DocumentInput[]): Promise<void>;
  similaritySearch(query: SimilarityQuery): Promise<SimilarityResult[]>;
  getCollectionStats(name: string): Promise<CollectionStats>;
}
```

### Key Data Structures

```typescript
interface DocumentInput {
  id: string;                    // Unique ID: {repo}:{file_path}:{chunk_index}
  content: string;               // Text content
  embedding: number[];           // Pre-computed embedding vector
  metadata: DocumentMetadata;    // File and chunk metadata
}

interface SimilarityQuery {
  embedding: number[];           // Query embedding
  collections: string[];         // Collections to search
  limit: number;                 // Max results
  threshold: number;             // Min similarity (0-1)
}

interface SimilarityResult {
  id: string;
  content: string;
  metadata: DocumentMetadata;
  distance: number;              // Raw ChromaDB distance
  similarity: number;            // Converted to 0-1
}
```

### Distance to Similarity Conversion

ChromaDB returns cosine distance (0 = identical, 2 = opposite).
Convert to similarity: `similarity = 1 - (distance / 2)`

### Collection Caching

Cache collection handles in-memory to avoid repeated lookups:
```typescript
private collections: Map<string, Collection> = new Map();
```

### Configuration

```typescript
interface ChromaConfig {
  host: string;    // Default: 'localhost'
  port: number;    // Default: 8000
}
```

## Testing Requirements

- [ ] Unit tests with mocked ChromaDB client (90% coverage)
- [ ] Integration tests with real ChromaDB container:
  - [ ] Collection CRUD operations
  - [ ] Document add and retrieve
  - [ ] Similarity search with known embeddings
  - [ ] Threshold filtering
  - [ ] Multi-collection search
- [ ] Error handling tests:
  - [ ] Connection failure
  - [ ] Collection not found
  - [ ] Invalid parameters

## Definition of Done

- [ ] Code complete with TypeScript types
- [ ] Unit tests passing (90% coverage)
- [ ] Integration tests passing
- [ ] No linting errors
- [ ] JSDoc comments on public methods
- [ ] Exported from storage module index

## Size Estimate

**Size:** M (Medium) - 6-8 hours

## Dependencies

- #1 Project Setup
- #2 Docker Compose (ChromaDB must be running for integration tests)

## Blocks

- #9 Ingestion Service
- #10 Search Service

## Labels

phase-1, P0, feature
