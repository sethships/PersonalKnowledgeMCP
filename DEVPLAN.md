# Development Plan: Issue #7 - Embedding Provider Interface and OpenAI Implementation

**Issue:** [#7](https://github.com/sethb75/PersonalKnowledgeMCP/issues/7)
**Branch:** `feature/7-embedding-provider`
**Worktree:** `C:\src\PersonalKnowledgeMCP-issue-7`
**Estimated Size:** Medium (6-8 hours)
**Priority:** P0 (Must have - Critical priority)
**Phase:** Phase 1 - Core MCP + Vector Search

## Objective

Implement an abstract `EmbeddingProvider` interface and concrete `OpenAIEmbeddingProvider` implementation to enable embedding generation for semantic search. This abstraction allows future swapping between OpenAI, HuggingFace, Ollama, or other embedding providers.

## Dependencies

- **Requires:** Issue #1 (Project Setup) - ✅ Complete
- **Blocks:** Issue #9 (Ingestion Service), Issue #10 (Search Service)

## Implementation Plan

### Step 1: Define Core Interfaces (30 min)
**File:** `src/providers/embedding-provider.ts`

- [ ] Define `EmbeddingProvider` interface:
  - `providerId: string` (readonly)
  - `modelId: string` (readonly)
  - `dimensions: number` (readonly)
  - `generateEmbedding(text: string): Promise<number[]>`
  - `generateEmbeddings(texts: string[]): Promise<number[][]>`
  - `healthCheck(): Promise<boolean>`
- [ ] Define `EmbeddingProviderConfig` interface:
  - `provider: "openai" | "ollama" | "huggingface"`
  - `model: string`
  - `apiKey?: string`
  - `baseUrl?: string`
  - `maxBatchSize?: number`
  - `maxRetries?: number`
  - `timeoutMs?: number`
- [ ] Define `OpenAIEmbeddingConfig` specific interface
- [ ] Add comprehensive JSDoc comments

### Step 2: Define Custom Error Classes (20 min)
**File:** `src/providers/embedding-provider.ts` or `src/errors/embedding-error.ts`

- [ ] Create `EmbeddingError` custom error class:
  - Extends `Error`
  - Add `retryable: boolean` flag
  - Add `providerId: string`
  - Ensure API keys are never exposed in error messages or stack traces
- [ ] Add helper functions to identify error types:
  - `isRateLimitError(error: unknown): boolean`
  - `isNetworkError(error: unknown): boolean`

### Step 3: Install OpenAI SDK (5 min)
**Command:** `bun add openai`

- [ ] Install `openai` npm package
- [ ] Add to package.json dependencies

### Step 4: Implement OpenAIEmbeddingProvider (2-3 hours)
**File:** `src/providers/openai-embedding.ts`

#### Core Implementation
- [ ] Create `OpenAIEmbeddingProvider` class implementing `EmbeddingProvider`
- [ ] Constructor:
  - Accept `OpenAIEmbeddingConfig`
  - Validate API key presence (throw if missing)
  - Initialize OpenAI client
  - Set default model: `text-embedding-3-small`
  - Set dimensions: `1536`
  - Configure max batch size: `100`
  - Configure max retries: `3`
  - Configure timeout: `30000ms`

#### Batch Processing Logic
- [ ] Implement `createBatches()` private method:
  - Split input array into chunks of `maxBatchSize`
  - Maintain order of inputs
- [ ] Implement `generateEmbeddings()` method:
  - Split texts into batches
  - Process each batch sequentially
  - Flatten results maintaining input order
  - Handle empty input arrays gracefully

#### Rate Limiting & Retry Logic
- [ ] Implement `callWithRetry()` private method:
  - Exponential backoff: 1s → 2s → 4s (up to 3 retries)
  - Catch 429 rate limit errors specifically
  - Retry on rate limits only (not on auth or validation errors)
  - Maximum delay cap: 60 seconds
  - Throw `EmbeddingError` with retryable flag on exhaustion

#### Single Embedding Method
- [ ] Implement `generateEmbedding()` method:
  - Call `generateEmbeddings()` with single-element array
  - Return first result

#### Health Check
- [ ] Implement `healthCheck()` method:
  - Generate embedding for minimal text (e.g., "test")
  - Return `true` on success, `false` on failure
  - Catch and log errors without throwing

#### Error Handling
- [ ] API key validation on construction
- [ ] Network error handling with descriptive messages
- [ ] Timeout handling (30s default)
- [ ] Sanitize all error messages to prevent API key leakage
- [ ] Log errors appropriately (use project logging setup)

### Step 5: Configuration & Environment Variables (30 min)
**File:** `.env.example` (update)

- [ ] Document required environment variables:
  - `OPENAI_API_KEY` - Required, API key
  - `EMBEDDING_MODEL` - Optional, defaults to `text-embedding-3-small`
- [ ] Add config loading in `src/config/` if needed
- [ ] Ensure sensitive values never logged

### Step 6: Factory Function (30 min)
**File:** `src/providers/index.ts` or `src/providers/factory.ts`

- [ ] Create `createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider`
- [ ] Support provider selection:
  - `"openai"` → `OpenAIEmbeddingProvider`
  - Future: `"ollama"`, `"huggingface"`
- [ ] Throw descriptive error for unsupported providers
- [ ] Add JSDoc with usage examples

### Step 7: Unit Tests (2-3 hours)
**File:** `tests/providers/openai-embedding.test.ts`

#### Mock Setup
- [ ] Mock OpenAI client responses
- [ ] Create reusable mock factories for:
  - Successful embedding responses
  - Rate limit errors (429)
  - Network errors
  - Invalid API key errors

#### Test Cases (Target 95% coverage)
- [ ] **Single embedding generation:**
  - Successful generation
  - Returns array of 1536 dimensions
- [ ] **Batch embedding generation:**
  - Small batch (< 100 items)
  - Large batch requiring splitting (> 100 items)
  - Maintains input order
  - Empty array input
- [ ] **Batch splitting:**
  - Verify batches created correctly
  - Verify order preservation across batches
- [ ] **Rate limiting & retry:**
  - Retry on 429 error
  - Exponential backoff timing verification
  - Success after 1 retry
  - Success after 2 retries
  - Failure after max retries exceeded
- [ ] **Error handling:**
  - Missing API key throws on construction
  - Network errors throw `EmbeddingError`
  - Timeout errors handled
  - API key never in error messages
- [ ] **Health check:**
  - Success case returns true
  - Failure case returns false (doesn't throw)
- [ ] **Configuration:**
  - Custom model configuration
  - Custom batch size
  - Custom retry count
  - Custom timeout

#### Integration Tests (Optional, requires real API key)
- [ ] Real embedding generation (single)
- [ ] Real embedding generation (batch)
- [ ] Verify embedding dimensions match expected (1536)
- [ ] Health check with real API

### Step 8: Documentation (30 min)
**Files:** Update as needed

- [ ] Add JSDoc comments to all public methods and interfaces
- [ ] Document error handling approach
- [ ] Add usage examples in docstrings
- [ ] Update README.md if needed (likely premature for Phase 1)
- [ ] Consider adding ADR for embedding provider choice (optional)

### Step 9: Pre-PR Checklist (30 min)

- [ ] Run full test suite: `bun test --coverage`
- [ ] Verify 95%+ test coverage for new code
- [ ] Run linter if configured: `bun run lint`
- [ ] Build project: `bun run build`
- [ ] Manual testing:
  - Test with real API key in local environment
  - Verify rate limiting works (can simulate with delays)
  - Test health check
- [ ] Review all code for API key exposure risks
- [ ] Verify no console.log statements remain
- [ ] Check all TODOs resolved or documented

### Step 10: Create Pull Request (15 min)

- [ ] Create PR with descriptive title: `feat: Implement Embedding Provider Interface and OpenAI Implementation`
- [ ] Link to issue #7 in PR description
- [ ] Include summary of implementation approach
- [ ] Note any deviations from original plan
- [ ] List testing performed
- [ ] Tag for review
- [ ] Ensure CI/CD checks pass

## Technical Decisions & Notes

### Why text-embedding-3-small?
- Good balance of performance and cost
- 1536 dimensions sufficient for code/documentation similarity
- OpenAI's recommended model for most use cases
- Can be overridden via environment variable

### Batch Size of 100
- OpenAI API limit is 100 inputs per request
- Reduces API calls and improves throughput
- Simplifies implementation (no need for dynamic batching)

### Exponential Backoff Strategy
- 1s → 2s → 4s progression balances responsiveness with API respect
- Max 3 retries prevents infinite loops
- Only retry on rate limits (not auth/validation errors)
- Total max wait time: ~7 seconds before giving up

### Error Handling Philosophy
- Fail fast on configuration errors (missing API key)
- Retry on transient errors (rate limits)
- Don't retry on permanent errors (auth, validation)
- Health check never throws (returns boolean)
- All errors sanitized to prevent key leakage

### Future Provider Support
- Interface designed for easy addition of Ollama, HuggingFace
- Config supports baseUrl for custom endpoints
- Provider factory makes swapping trivial

## Definition of Done Checklist

- [ ] `EmbeddingProvider` interface defined and exported
- [ ] `OpenAIEmbeddingProvider` implementation complete
- [ ] Unit tests passing with 95%+ coverage
- [ ] Error handling robust and tested
- [ ] No API key exposure in logs or errors
- [ ] JSDoc comments on all public methods
- [ ] Factory function to create provider from config
- [ ] `.env.example` updated with required variables
- [ ] All acceptance criteria from issue #7 met
- [ ] PR created and approved
- [ ] CI/CD checks passing

## Time Tracking

| Step | Estimated | Actual | Notes |
|------|-----------|--------|-------|
| 1. Core Interfaces | 30 min | | |
| 2. Error Classes | 20 min | | |
| 3. Install OpenAI SDK | 5 min | | |
| 4. OpenAI Implementation | 2-3 hours | | |
| 5. Configuration | 30 min | | |
| 6. Factory Function | 30 min | | |
| 7. Unit Tests | 2-3 hours | | |
| 8. Documentation | 30 min | | |
| 9. Pre-PR Checklist | 30 min | | |
| 10. Create PR | 15 min | | |
| **Total** | **6-8 hours** | | |

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| API key leakage in errors | Medium | High | Comprehensive error sanitization, code review |
| Rate limit handling insufficient | Low | Medium | Thorough testing of retry logic |
| Batch processing order bugs | Low | High | Explicit order preservation tests |
| OpenAI SDK breaking changes | Low | Medium | Pin version in package.json |
| Test coverage < 95% | Medium | Medium | Write tests alongside implementation |

## Next Steps After Completion

Once this PR is merged:
1. Issue #9 (Ingestion Service) can use embedding provider
2. Issue #10 (Search Service) can generate query embeddings
3. Consider adding Ollama provider for local/offline usage (Phase 2+)

## References

- Issue #7: https://github.com/sethb75/PersonalKnowledgeMCP/issues/7
- PRD: `docs/High-level-Personal-Knowledge-MCP-PRD.md`
- OpenAI Embeddings API: https://platform.openai.com/docs/guides/embeddings
- OpenAI SDK: https://github.com/openai/openai-node
