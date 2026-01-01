# ADR-0003: Local Embeddings Architecture

**Status:** Proposed

**Date:** 2026-01-01

**Deciders:** Architecture Team, Development Team

**Technical Story:** Enable offline, cost-free, and privacy-preserving embedding generation by supporting local models alongside the existing OpenAI provider.

## Context and Problem Statement

The Personal Knowledge MCP currently relies exclusively on OpenAI's Embeddings API for generating vector embeddings. While OpenAI provides high-quality embeddings, this dependency introduces several constraints:

1. **Cost**: Every embedding request incurs API charges ($0.02 per 1M tokens for text-embedding-3-small)
2. **Latency**: Network round-trip adds 100-500ms to each request
3. **Privacy**: Code and documentation content is sent to external servers
4. **Availability**: Requires internet connectivity; unusable in air-gapped environments
5. **Rate Limits**: Subject to OpenAI's rate limiting during heavy indexing

The user has explicitly requested: "We should be able to use local serializers, string and code based, instead of using OpenAI's API." This ADR addresses this requirement by designing a local embeddings architecture.

## Decision Drivers

- **Embedding Quality**: Local embeddings must be comparable to OpenAI for semantic search to work effectively; quality degradation is acceptable only if it's marginal
- **Model Size and Memory**: Must run on developer workstations (8-16GB RAM typical); GPU optional but beneficial
- **Inference Speed**: Target inference time comparable to or faster than OpenAI API round-trip (~200ms for small batches)
- **Cross-Platform Support**: Windows is primary development environment; must also support Linux and macOS
- **TypeScript/Bun Compatibility**: Must integrate with the existing Bun/TypeScript runtime without requiring separate processes where possible
- **Offline Operation**: Must work completely offline once models are downloaded
- **Model Flexibility**: Support multiple models with different size/quality trade-offs
- **Dimension Compatibility**: Must handle dimension mismatches between providers gracefully

## Considered Options

### Option 1: Transformers.js (Xenova/transformers)

**Description:** Run HuggingFace transformer models directly in Node.js/Bun using ONNX Runtime. Transformers.js provides a JavaScript-native implementation of the HuggingFace transformers library.

**Compatible Models:**
- `Xenova/all-MiniLM-L6-v2` (384 dimensions, ~22MB, fastest)
- `Xenova/all-mpnet-base-v2` (768 dimensions, ~100MB, balanced)
- `Xenova/bge-small-en-v1.5` (384 dimensions, ~33MB, good quality)
- `Xenova/bge-base-en-v1.5` (768 dimensions, ~110MB, high quality)
- `Xenova/gte-small` (384 dimensions, ~25MB, multilingual)

**Pros:**
- Pure JavaScript implementation - no Python dependency
- Works in Node.js, Bun, and browsers
- Automatic model caching and download management
- Extensive model zoo from HuggingFace
- Active development and community support
- ONNX Runtime provides good performance
- Well-documented with TypeScript types
- Models are freely downloadable and redistributable

**Cons:**
- Larger memory footprint than native implementations
- Slower than native Python/GPU inference (2-10x depending on model)
- ONNX Runtime compatibility issues possible with some Bun versions
- Model conversion to ONNX format required for non-published models
- No GPU acceleration in JavaScript runtime (CPU only)
- Initial model download can be slow (one-time cost)

**Performance Estimates (CPU, single text):**
- all-MiniLM-L6-v2: ~50-100ms
- all-mpnet-base-v2: ~100-200ms
- bge-base-en-v1.5: ~100-200ms

**Licensing:** Apache 2.0 (Transformers.js), MIT/Apache 2.0 for most HuggingFace models

### Option 2: Ollama

**Description:** Ollama is a local LLM server that supports embedding models. It handles model management, inference optimization, and provides a REST API.

**Compatible Models:**
- `nomic-embed-text` (768 dimensions, ~274MB, high quality)
- `mxbai-embed-large` (1024 dimensions, ~670MB, SOTA quality)
- `all-minilm` (384 dimensions, ~45MB, fast)
- `snowflake-arctic-embed` (1024 dimensions, various sizes)

**Pros:**
- Simple installation and model management (`ollama pull nomic-embed-text`)
- GPU acceleration (CUDA, Metal, ROCm) for fast inference
- REST API is easy to integrate from any language
- Handles batching and concurrent requests
- Memory management optimized for LLMs
- Active development with frequent updates
- Supports many GGUF-format models
- Can run other LLMs alongside embeddings

**Cons:**
- Requires separate server process (Docker container or native install)
- Additional operational complexity (process management, health checks)
- Windows support is newer and less tested than macOS/Linux
- Model format (GGUF) is different from HuggingFace/ONNX
- REST API adds small network overhead (localhost still)
- Not all HuggingFace models are available in Ollama format
- Embedding-specific features lag behind LLM features

**Performance Estimates (CPU, single text):**
- all-minilm: ~20-50ms
- nomic-embed-text: ~50-100ms
- mxbai-embed-large: ~100-200ms

**Performance Estimates (GPU, single text):**
- all-minilm: ~5-15ms
- nomic-embed-text: ~10-30ms
- mxbai-embed-large: ~20-50ms

**Licensing:** MIT (Ollama), various for models (check each model)

### Option 3: FastEmbed (Qdrant)

**Description:** FastEmbed is a Python library from Qdrant optimized for fast, lightweight embedding generation using ONNX. It could be exposed via a Python subprocess or a thin FastAPI wrapper.

**Compatible Models:**
- `BAAI/bge-small-en-v1.5` (384 dimensions, default)
- `BAAI/bge-base-en-v1.5` (768 dimensions)
- `BAAI/bge-large-en-v1.5` (1024 dimensions)
- `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions)

**Pros:**
- Highly optimized for speed (claims 50x faster than sentence-transformers)
- Uses ONNX with quantization for efficiency
- Low memory footprint
- Well-tested with Qdrant vector database
- Good model selection for code and text
- Supports batch processing efficiently

**Cons:**
- Requires Python runtime (adds dependency complexity)
- Would need subprocess management or separate service
- Cross-platform Python environment setup can be fragile
- Not native to the TypeScript ecosystem
- Additional IPC overhead between Node/Bun and Python
- Debugging becomes more complex with multiple runtimes

**Performance Estimates (CPU, single text):**
- bge-small-en-v1.5: ~5-20ms
- bge-base-en-v1.5: ~10-40ms

**Licensing:** Apache 2.0

### Option 4: ONNX Runtime Node.js Direct Bindings

**Description:** Use `onnxruntime-node` package directly to load and run ONNX models without the Transformers.js abstraction layer.

**Compatible Models:**
- Any ONNX-exported embedding model from HuggingFace
- Custom converted models

**Pros:**
- Direct, low-level control over inference
- Potentially faster than Transformers.js (no abstraction overhead)
- Native bindings for best CPU performance
- GPU support via CUDA/DirectML execution providers (Windows)

**Cons:**
- Requires manual model preparation (export to ONNX, quantization)
- Need to implement tokenization separately (complex for different models)
- No automatic model downloading or caching
- More code to maintain for each model type
- Limited documentation for embedding-specific use cases
- Bun compatibility may be limited (node-api bindings)
- Higher barrier to adding new models

**Performance Estimates (CPU):**
- Similar to Transformers.js but potentially 10-30% faster

**Licensing:** MIT (onnxruntime-node), various for models

### Option 5: Hybrid - Transformers.js Primary + Ollama Optional

**Description:** Use Transformers.js as the primary local embedding solution for its simplicity and zero-dependency installation, with optional Ollama support for users who want GPU acceleration or specific models.

**Architecture:**
```
                    EmbeddingProvider Interface
                              |
        +---------------------+---------------------+
        |                     |                     |
   OpenAI Provider    Transformers.js Provider   Ollama Provider
   (current, cloud)   (local, CPU, default)      (local, GPU optional)
```

**Pros:**
- Best of both worlds: easy setup (Transformers.js) and performance (Ollama)
- Progressive complexity: users can start simple, upgrade if needed
- Transformers.js works immediately with no additional installation
- Ollama provides path to GPU acceleration
- Configuration-driven selection
- Graceful fallback between providers

**Cons:**
- Two local embedding implementations to maintain
- Configuration complexity (choosing between options)
- Testing matrix increases
- Documentation must cover both paths

## Decision Outcome

**Chosen option:** "Option 5: Hybrid - Transformers.js Primary + Ollama Optional", because:

1. **Zero Friction Default**: Transformers.js works immediately after `bun install` without any additional installation steps, Docker containers, or Python environments. This aligns with the project's developer experience goals.

2. **Performance Path**: Ollama provides a clear upgrade path for users with GPU hardware or those who need faster inference. This avoids the "one size fits all" trap.

3. **Existing Architecture Fit**: The current `EmbeddingProvider` interface is already designed for multiple providers. Adding two more providers follows the established pattern without architectural changes.

4. **Windows Primary Support**: Both Transformers.js and Ollama work on Windows. Transformers.js is pure JavaScript (excellent Windows support), and Ollama has native Windows binaries.

5. **Model Ecosystem Access**: Between Transformers.js (HuggingFace ONNX models) and Ollama (GGUF models), users have access to a wide variety of embedding models.

6. **Offline First**: Both solutions work completely offline after initial model download, addressing the air-gapped requirement.

7. **Risk Mitigation**: If one solution has compatibility issues (e.g., Bun + ONNX Runtime), the other remains available.

### Default Model Recommendations

| Use Case | Provider | Model | Dimensions | Size | Notes |
|----------|----------|-------|------------|------|-------|
| Quick Start | Transformers.js | all-MiniLM-L6-v2 | 384 | 22MB | Fast, good for most use cases |
| Higher Quality | Transformers.js | bge-base-en-v1.5 | 768 | 110MB | Better for code understanding |
| GPU Acceleration | Ollama | nomic-embed-text | 768 | 274MB | Best balance for local GPU |
| Maximum Quality | Ollama | mxbai-embed-large | 1024 | 670MB | SOTA but resource intensive |
| Cloud Baseline | OpenAI | text-embedding-3-small | 1536 | N/A | Current default, best quality |

### Positive Consequences

- Users can generate embeddings without OpenAI API key or internet access
- No per-token costs for local embeddings
- Code and documentation never leave the local machine
- GPU acceleration available for users with compatible hardware
- Model selection flexibility for different quality/speed trade-offs
- Demonstrates provider abstraction working as designed
- Enables usage in corporate environments with strict data policies

### Negative Consequences

- Initial model download required (one-time, can be slow)
- Local models are generally lower quality than OpenAI text-embedding-3
- Memory usage increases when models are loaded
- Two additional embedding implementations to maintain and test
- Users must understand dimension compatibility implications
- Documentation burden increases

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Bun ONNX Runtime compatibility | Test thoroughly; Ollama as fallback if issues arise |
| Memory pressure on developer machines | Recommend minimum specs; smaller models as default |
| Model download failures | Retry logic; allow manual model placement; cache validation |
| Quality degradation vs OpenAI | Document expected quality; allow hybrid usage per-repo |
| Windows-specific issues | Prioritize Windows testing; community feedback loop |
| Model versioning/updates | Pin model versions; document upgrade process |
| Dimension mismatch when switching providers | Track provider per collection; re-index warning |

## Architecture Design

### Provider Interface Consistency

The existing `EmbeddingProvider` interface requires no changes. Each new provider implements the same contract:

```typescript
interface EmbeddingProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly dimensions: number;

  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  healthCheck(): Promise<boolean>;
}
```

### New Provider Implementations

#### TransformersJsEmbeddingProvider

```typescript
// src/providers/transformersjs-embedding.ts

import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";

export interface TransformersJsProviderConfig extends EmbeddingProviderConfig {
  /** Model identifier from HuggingFace (e.g., "Xenova/all-MiniLM-L6-v2") */
  modelPath: string;

  /** Optional: Directory for model cache (defaults to ~/.cache/transformers.js) */
  cacheDir?: string;

  /** Optional: Quantized model variant (default: false) */
  quantized?: boolean;
}

export class TransformersJsEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "transformersjs";
  readonly modelId: string;
  readonly dimensions: number;

  private pipeline: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(config: TransformersJsProviderConfig) {
    this.modelId = config.modelPath;
    this.dimensions = config.dimensions;
    // Lazy initialization to avoid blocking constructor
  }

  async generateEmbedding(text: string): Promise<number[]> {
    await this.ensureInitialized();
    // Mean pooling over token embeddings
    const output = await this.pipeline!(text, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(output.data);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Process in sequence to avoid memory spikes
    // Could be parallelized with worker threads for performance
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.generateEmbedding(text));
    }
    return results;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      return true;
    } catch {
      return false;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize();
    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    // Dynamic import to avoid loading if not used
    const { pipeline } = await import("@xenova/transformers");
    this.pipeline = await pipeline("feature-extraction", this.modelId);
  }
}
```

#### OllamaEmbeddingProvider

```typescript
// src/providers/ollama-embedding.ts

import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";

export interface OllamaProviderConfig extends EmbeddingProviderConfig {
  /** Model name as registered in Ollama (e.g., "nomic-embed-text") */
  modelName: string;

  /** Ollama server base URL (default: "http://localhost:11434") */
  baseUrl?: string;

  /** Keep model loaded in memory between requests (default: true) */
  keepAlive?: string;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "ollama";
  readonly modelId: string;
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly keepAlive: string;

  constructor(config: OllamaProviderConfig) {
    this.modelId = config.modelName;
    this.dimensions = config.dimensions;
    this.baseUrl = config.baseUrl || "http://localhost:11434";
    this.keepAlive = config.keepAlive || "5m";
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelId,
        prompt: text,
        keep_alive: this.keepAlive,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Ollama API handles one text at a time; process sequentially
    // Model stays loaded due to keep_alive, so subsequent calls are fast
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.generateEmbedding(text));
    }
    return results;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return false;

      // Verify the model is available
      const data = await response.json() as { models: Array<{ name: string }> };
      return data.models.some(m => m.name.startsWith(this.modelId));
    } catch {
      return false;
    }
  }
}
```

### Updated Factory Pattern

```typescript
// src/providers/factory.ts (updated)

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  const providerType = config.provider.toLowerCase();

  switch (providerType) {
    case "openai":
      return createOpenAIProvider(config);

    case "transformersjs":
    case "transformers":
    case "local":
      return createTransformersJsProvider(config);

    case "ollama":
      return createOllamaProvider(config);

    default:
      throw new EmbeddingValidationError(
        `Unsupported provider: ${config.provider}. Supported: openai, transformersjs, ollama`,
        "provider"
      );
  }
}

function createTransformersJsProvider(config: EmbeddingProviderConfig): TransformersJsEmbeddingProvider {
  const transformersConfig: TransformersJsProviderConfig = {
    ...config,
    modelPath: config.options?.modelPath as string || "Xenova/all-MiniLM-L6-v2",
    cacheDir: Bun.env["TRANSFORMERS_CACHE"] || undefined,
    quantized: config.options?.quantized as boolean || false,
  };

  return new TransformersJsEmbeddingProvider(transformersConfig);
}

function createOllamaProvider(config: EmbeddingProviderConfig): OllamaEmbeddingProvider {
  const ollamaConfig: OllamaProviderConfig = {
    ...config,
    modelName: config.options?.modelName as string || "nomic-embed-text",
    baseUrl: Bun.env["OLLAMA_BASE_URL"] || "http://localhost:11434",
    keepAlive: config.options?.keepAlive as string || "5m",
  };

  return new OllamaEmbeddingProvider(ollamaConfig);
}
```

### Configuration via Environment Variables

```bash
# .env.example additions

# Embedding Provider Selection
# Options: "openai" (default), "transformersjs", "ollama"
EMBEDDING_PROVIDER=transformersjs

# TransformersJS Settings
TRANSFORMERS_CACHE=~/.cache/transformers.js
TRANSFORMERS_MODEL=Xenova/all-MiniLM-L6-v2

# Ollama Settings
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=nomic-embed-text
OLLAMA_KEEP_ALIVE=5m

# OpenAI Settings (existing)
OPENAI_API_KEY=sk-...
```

### CLI Provider Selection

```bash
# Use default local provider
pk-mcp index https://github.com/user/repo

# Explicitly use Transformers.js
pk-mcp index --provider transformersjs https://github.com/user/repo

# Use Ollama for GPU acceleration
pk-mcp index --provider ollama --model nomic-embed-text https://github.com/user/repo

# Use OpenAI for best quality
pk-mcp index --provider openai https://github.com/user/repo
```

### Model Auto-Download

Transformers.js handles model downloading automatically:

```typescript
class TransformersJsEmbeddingProvider {
  private async initialize(): Promise<void> {
    console.log(`Downloading/loading model: ${this.modelId}...`);
    console.log("This may take a few minutes on first use.");

    const { pipeline, env } = await import("@xenova/transformers");

    // Configure cache directory if specified
    if (this.cacheDir) {
      env.cacheDir = this.cacheDir;
    }

    // Disable local model requirement (allow download)
    env.allowLocalModels = true;
    env.allowRemoteModels = true;

    this.pipeline = await pipeline("feature-extraction", this.modelId, {
      progress_callback: (progress: { status: string; file?: string; progress?: number }) => {
        if (progress.status === "progress" && progress.file && progress.progress) {
          const pct = Math.round(progress.progress);
          console.log(`Downloading ${progress.file}: ${pct}%`);
        }
      },
    });

    console.log(`Model ${this.modelId} loaded successfully.`);
  }
}
```

For Ollama, models are downloaded via the Ollama CLI:

```bash
# One-time setup
ollama pull nomic-embed-text

# Or auto-pull on first use (if Ollama configured to allow)
```

## Data Model Considerations

### Embedding Dimension Compatibility

Different models produce different embedding dimensions:

| Provider/Model | Dimensions |
|----------------|------------|
| OpenAI text-embedding-3-small | 1536 |
| OpenAI text-embedding-3-large | 3072 |
| all-MiniLM-L6-v2 | 384 |
| bge-base-en-v1.5 | 768 |
| nomic-embed-text | 768 |
| mxbai-embed-large | 1024 |

**Key Constraint:** ChromaDB collections have fixed dimensions. Embeddings of different dimensions cannot be mixed in the same collection.

### Collection Metadata Tracking

Store the embedding provider and model information in collection metadata:

```typescript
interface CollectionMetadata {
  // Existing fields
  repositoryId: string;
  indexedAt: string;

  // New fields for provider tracking
  embeddingProvider: string;     // "openai", "transformersjs", "ollama"
  embeddingModel: string;        // "text-embedding-3-small", "all-MiniLM-L6-v2", etc.
  embeddingDimensions: number;   // 1536, 384, 768, etc.
}
```

### Re-indexing Strategy

When switching embedding providers:

1. **Same Dimensions**: In theory, embeddings could be mixed. In practice, different models produce different vector spaces, so semantic search quality would degrade. **Recommendation**: Full re-index.

2. **Different Dimensions**: Cannot add new embeddings to existing collection. **Required**: Full re-index.

**Re-index Warning Logic:**

```typescript
async function validateProviderCompatibility(
  collection: Collection,
  newProvider: EmbeddingProvider
): Promise<{ compatible: boolean; reason?: string }> {
  const metadata = await collection.getMetadata();

  // Check dimension match
  if (metadata.embeddingDimensions !== newProvider.dimensions) {
    return {
      compatible: false,
      reason: `Dimension mismatch: collection has ${metadata.embeddingDimensions}D embeddings, ` +
              `but ${newProvider.providerId}/${newProvider.modelId} produces ${newProvider.dimensions}D`,
    };
  }

  // Check provider/model match (warning, not error)
  if (metadata.embeddingProvider !== newProvider.providerId ||
      metadata.embeddingModel !== newProvider.modelId) {
    return {
      compatible: true, // Technically compatible
      reason: `Warning: collection was indexed with ${metadata.embeddingProvider}/${metadata.embeddingModel}. ` +
              `Using ${newProvider.providerId}/${newProvider.modelId} may affect search quality. ` +
              `Consider re-indexing for best results.`,
    };
  }

  return { compatible: true };
}
```

### Fallback Strategy

Support configurable fallback when primary provider fails:

```typescript
interface EmbeddingFallbackConfig {
  primary: EmbeddingProviderConfig;
  fallback?: EmbeddingProviderConfig;
  fallbackConditions?: Array<"offline" | "rate_limit" | "error">;
}

class FallbackEmbeddingProvider implements EmbeddingProvider {
  private primary: EmbeddingProvider;
  private fallback: EmbeddingProvider | null;
  private fallbackConditions: Set<string>;

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      return await this.primary.generateEmbedding(text);
    } catch (error) {
      if (this.shouldFallback(error)) {
        console.warn(`Primary provider failed, using fallback: ${error.message}`);
        return await this.fallback!.generateEmbedding(text);
      }
      throw error;
    }
  }

  private shouldFallback(error: Error): boolean {
    if (!this.fallback) return false;

    if (error instanceof EmbeddingNetworkError && this.fallbackConditions.has("offline")) {
      return true;
    }
    if (error instanceof EmbeddingRateLimitError && this.fallbackConditions.has("rate_limit")) {
      return true;
    }
    if (this.fallbackConditions.has("error")) {
      return true;
    }

    return false;
  }
}
```

**Example Configuration:**

```yaml
# config/default.yaml
embedding:
  primary:
    provider: openai
    model: text-embedding-3-small
    dimensions: 1536
  fallback:
    provider: transformersjs
    model: Xenova/all-MiniLM-L6-v2
    dimensions: 384
  fallbackConditions:
    - offline
    - rate_limit
```

Note: Fallback with different dimensions requires separate collections or dimension-aware retrieval logic.

## Performance Benchmarks

Estimated performance comparisons (to be validated during implementation):

| Scenario | OpenAI | Transformers.js (CPU) | Ollama (CPU) | Ollama (GPU) |
|----------|--------|----------------------|--------------|--------------|
| Single text (first request) | 300-500ms | 2-5s (model load) | 500ms-2s | 200ms-1s |
| Single text (warm) | 100-200ms | 50-100ms | 20-50ms | 5-20ms |
| Batch of 10 texts | 200-400ms | 500ms-1s | 200-500ms | 50-100ms |
| Batch of 100 texts | 500-1000ms | 5-10s | 2-5s | 200-500ms |
| Memory usage | N/A | 200-500MB | 500MB-2GB | 1-4GB VRAM |

**Note:** Transformers.js model load time is only incurred once per session; subsequent requests use cached model.

## Implementation Plan

### Phase 1: Transformers.js Provider (Week 1)

1. Add `@xenova/transformers` dependency
2. Implement `TransformersJsEmbeddingProvider`
3. Add to provider factory with "transformersjs" and "local" aliases
4. Create unit tests with mocked pipeline
5. Create integration tests with actual model
6. Update CLI to accept `--provider` flag
7. Document model options and trade-offs

### Phase 2: Ollama Provider (Week 2)

1. Implement `OllamaEmbeddingProvider`
2. Add to provider factory with "ollama" alias
3. Create health check for Ollama availability
4. Add retry logic for Ollama connection failures
5. Create unit tests with mocked fetch
6. Create integration tests with running Ollama
7. Document Ollama setup instructions

### Phase 3: Integration and Configuration (Week 3)

1. Update configuration loading for new providers
2. Add collection metadata for provider tracking
3. Implement re-index validation/warning
4. Add environment variable documentation
5. Update docker-compose.yml with Ollama service (optional)
6. Performance benchmarking against targets

### Phase 4: Fallback and Polish (Week 4)

1. Implement fallback provider wrapper
2. Add progress reporting for model downloads
3. Error message improvements for provider-specific issues
4. End-to-end testing across all providers
5. Documentation and examples
6. Performance optimization based on benchmarks

## Validation Criteria

This decision will be validated as successful if:

1. **Functionality**: All three providers (OpenAI, Transformers.js, Ollama) pass the same test suite
2. **Performance**: Local providers achieve <500ms for single embedding after warm-up
3. **Offline**: Semantic search works completely offline with local providers
4. **Quality**: Search results from local providers are usable for code navigation (subjective evaluation)
5. **Installation**: Zero additional installation steps for Transformers.js default
6. **Documentation**: Clear guidance on provider selection and trade-offs
7. **Cross-Platform**: Tested on Windows (primary) and at least one other OS

## Links

- [ADR-0002: Knowledge Graph Architecture](./0002-knowledge-graph-architecture.md) - Related architecture decision
- [Phase 1 System Design Document](../Phase1-System-Design-Document.md) - Original OpenAI integration
- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
- [Ollama API Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [MTEB Embedding Leaderboard](https://huggingface.co/spaces/mteb/leaderboard) - Model quality comparison
- [ONNX Runtime Node.js](https://onnxruntime.ai/docs/api/js/index.html) - Underlying runtime for Transformers.js

## Appendix A: Model Quality Comparison

Based on the MTEB (Massive Text Embedding Benchmark) leaderboard:

| Model | MTEB Average | Dimensions | Notes |
|-------|--------------|------------|-------|
| OpenAI text-embedding-3-large | 64.6 | 3072 | Highest quality, largest |
| OpenAI text-embedding-3-small | 62.3 | 1536 | Current default |
| mxbai-embed-large | 64.7 | 1024 | SOTA open-source |
| nomic-embed-text | 62.4 | 768 | Good balance |
| bge-base-en-v1.5 | 63.6 | 768 | Strong for code |
| all-mpnet-base-v2 | 57.8 | 768 | Widely used |
| all-MiniLM-L6-v2 | 56.3 | 384 | Fastest, smallest |

**Key Insight:** The quality gap between OpenAI and the best open-source models has narrowed significantly. For code understanding specifically, specialized models like `bge` may perform comparably.

## Appendix B: Ollama Docker Compose Addition

For users who want Ollama via Docker:

```yaml
# docker-compose.yml (optional addition)
services:
  ollama:
    image: ollama/ollama:latest
    container_name: pk-mcp-ollama
    ports:
      - "127.0.0.1:11434:11434"
    volumes:
      - ollama-models:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    # GPU configuration above is optional; remove for CPU-only
    profiles:
      - local-embeddings

volumes:
  ollama-models:
```

Usage:
```bash
# Start with Ollama
docker-compose --profile local-embeddings up -d

# Pull embedding model
docker exec pk-mcp-ollama ollama pull nomic-embed-text
```

## Appendix C: Bun Compatibility Notes

As of Bun 1.0+, ONNX Runtime compatibility has been improving. Known considerations:

1. **Native Modules**: ONNX Runtime uses native Node.js modules. Bun's Node.js compatibility layer handles most cases, but edge cases may exist.

2. **Worker Threads**: Transformers.js can use worker threads for parallelization. Bun's worker thread support should be compatible.

3. **File System Caching**: Model caching uses the file system. Bun's `fs` APIs are fully compatible.

4. **Testing Recommendation**: During implementation, test with both latest Bun release and Bun canary to identify any compatibility issues early.

5. **Fallback**: If Bun + ONNX Runtime has issues, the Ollama provider offers a pure HTTP-based alternative that avoids native module complexity.

---

**Document History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-01 | Architecture Team | Initial ADR for local embeddings support |
