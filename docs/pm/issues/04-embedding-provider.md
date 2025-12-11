# [Feature] Embedding Provider Interface and OpenAI Implementation

## Description

Implement the `EmbeddingProvider` interface that abstracts embedding generation, along with the concrete `OpenAIEmbeddingProvider` implementation. This abstraction allows future swapping between OpenAI, HuggingFace, Ollama, or other embedding providers.

## Requirements

From PRD FR-5, TD-2 and SDD Section 4.1:
- Abstract interface for embedding providers
- OpenAI implementation using text-embedding-3-small
- Rate limiting with exponential backoff
- Batch processing for efficiency
- Health check capability

## Acceptance Criteria

### Interface (`src/providers/embedding-provider.ts`)
- [ ] `EmbeddingProvider` interface defined with:
  - [ ] `providerId: string` (readonly)
  - [ ] `modelId: string` (readonly)
  - [ ] `dimensions: number` (readonly)
  - [ ] `generateEmbedding(text: string): Promise<number[]>`
  - [ ] `generateEmbeddings(texts: string[]): Promise<number[][]>`
  - [ ] `healthCheck(): Promise<boolean>`
- [ ] `EmbeddingProviderConfig` interface for configuration

### OpenAI Implementation (`src/providers/openai-embedding.ts`)
- [ ] `OpenAIEmbeddingProvider` class implements `EmbeddingProvider`
- [ ] Uses `openai` npm package
- [ ] Configurable model via `EMBEDDING_MODEL` env var (default: `text-embedding-3-small`)
- [ ] API key loaded from `OPENAI_API_KEY` env var
- [ ] Dimensions: 1536 for text-embedding-3-small
- [ ] Batch processing:
  - [ ] Max batch size: 100 (OpenAI limit)
  - [ ] Splits large arrays into batches
  - [ ] Maintains input order in results
- [ ] Rate limiting:
  - [ ] Exponential backoff on rate limit errors (429)
  - [ ] Initial delay: 1 second
  - [ ] Max delay: 60 seconds
  - [ ] Max retries: 3
- [ ] Error handling:
  - [ ] API key validation
  - [ ] Network error handling
  - [ ] Timeout handling (30s default)
  - [ ] Custom `EmbeddingError` class
- [ ] Health check pings API with minimal token usage

### Error Handling
- [ ] `EmbeddingError` custom error class defined
- [ ] Errors include `retryable` flag
- [ ] API key never logged or exposed in errors

## Technical Notes

### Interface Definition (from SDD 4.1)

```typescript
interface EmbeddingProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly dimensions: number;

  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  healthCheck(): Promise<boolean>;
}

interface EmbeddingProviderConfig {
  provider: "openai" | "ollama" | "huggingface";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxBatchSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
}
```

### OpenAI Implementation Pattern

```typescript
class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "openai";
  readonly modelId: string;
  readonly dimensions = 1536;

  private client: OpenAI;
  private maxBatchSize = 100;
  private maxRetries = 3;

  constructor(config: OpenAIEmbeddingConfig) {
    this.modelId = config.model || "text-embedding-3-small";
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const batches = this.createBatches(texts, this.maxBatchSize);
    const results: number[][] = [];

    for (const batch of batches) {
      const response = await this.callWithRetry(batch);
      results.push(...response.data.map(d => d.embedding));
    }

    return results;
  }
}
```

### Exponential Backoff

```typescript
const delays = [1000, 2000, 4000]; // Up to 3 retries
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  try {
    return await this.client.embeddings.create({ ... });
  } catch (error) {
    if (isRateLimitError(error) && attempt < maxRetries) {
      await sleep(delays[attempt]);
      continue;
    }
    throw error;
  }
}
```

### Environment Variables

- `OPENAI_API_KEY` - Required, API key
- `EMBEDDING_MODEL` - Optional, defaults to `text-embedding-3-small`

## Testing Requirements

- [ ] Unit tests with mocked OpenAI client (95% coverage)
  - [ ] Single embedding generation
  - [ ] Batch embedding generation
  - [ ] Batch splitting for large arrays
  - [ ] Retry on rate limit
  - [ ] Max retries exceeded
  - [ ] API key missing error
  - [ ] Health check success/failure
- [ ] Integration tests (optional, requires API key):
  - [ ] Real embedding generation
  - [ ] Verify embedding dimensions

## Definition of Done

- [ ] Interface defined and exported
- [ ] OpenAI implementation complete
- [ ] Unit tests passing (95% coverage)
- [ ] Error handling robust
- [ ] No API key exposure in logs
- [ ] JSDoc comments on public methods
- [ ] Factory function to create provider from config

## Size Estimate

**Size:** M (Medium) - 6-8 hours

## Dependencies

- #1 Project Setup

## Blocks

- #9 Ingestion Service
- #10 Search Service

## Labels

phase-1, P0, feature
