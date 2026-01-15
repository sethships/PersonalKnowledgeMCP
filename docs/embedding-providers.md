# Embedding Provider Guide

This guide covers embedding provider selection, configuration, and trade-offs for Personal Knowledge MCP.

## Table of Contents

- [Overview](#overview)
- [Provider Comparison](#provider-comparison)
- [Provider Details](#provider-details)
  - [OpenAI (Cloud)](#openai-cloud)
  - [Transformers.js (Local - CPU)](#transformersjs-local---cpu)
  - [Ollama (Local - GPU)](#ollama-local---gpu)
- [Configuration Guide](#configuration-guide)
- [Model Selection](#model-selection)
- [Offline Usage](#offline-usage)
- [Per-Repository Configuration](#per-repository-configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

Embedding providers convert text into vector representations (embeddings) that enable semantic search. Personal Knowledge MCP supports multiple providers to balance quality, speed, cost, and deployment requirements.

**Why Different Providers?**

| Concern | OpenAI | Transformers.js | Ollama |
|---------|--------|-----------------|--------|
| Quality | Highest | Good | Good-High |
| Cost | Per-token | Free | Free |
| Privacy | Cloud | Local | Local |
| Offline | No | Yes | Yes |
| GPU | N/A | No | Yes |
| Setup | API key | Zero-config | Server install |

---

## Provider Comparison

### Quick Reference

| Provider | Quality (MTEB) | Speed (warm) | Cost | Offline | GPU | Best For |
|----------|----------------|--------------|------|---------|-----|----------|
| **OpenAI** | 62-65 | 100-200ms | $0.02/1M tokens | No | N/A | Highest quality, team use |
| **Transformers.js** | 56-64 | 50-100ms | Free | Yes | No | Zero-config, air-gapped |
| **Ollama** | 62-65 | 5-50ms (GPU) | Free | Yes | Yes | GPU acceleration, privacy |

### Decision Matrix

| Use Case | Recommended Provider |
|----------|---------------------|
| Getting started quickly | Transformers.js (default) |
| Highest search quality | OpenAI |
| Air-gapped/offline environment | Transformers.js |
| GPU available, want speed | Ollama |
| Privacy-sensitive codebase | Transformers.js or Ollama |
| CI/CD pipeline indexing | OpenAI (fastest, no model loading) |

---

## Provider Details

### OpenAI (Cloud)

OpenAI provides the highest quality embeddings through their cloud API. This is the recommended choice when search quality is paramount and internet access is available.

#### Setup

1. **Get an API key** from [OpenAI Platform](https://platform.openai.com/api-keys)

2. **Configure environment**:
   ```bash
   # Required
   export OPENAI_API_KEY=sk-your-api-key-here

   # Optional
   export OPENAI_ORGANIZATION=org-...  # For organization accounts
   export OPENAI_BASE_URL=...          # For Azure OpenAI or proxies
   ```

3. **Verify setup**:
   ```bash
   bun run cli health
   # OpenAI API: OK (200ms)
   ```

#### Available Models

| Model | Dimensions | MTEB Score | Cost | Notes |
|-------|------------|------------|------|-------|
| `text-embedding-3-small` | 1536 | 62.3 | $0.02/1M tokens | Default, best value |
| `text-embedding-3-large` | 3072 | 64.6 | $0.13/1M tokens | Highest quality |
| `text-embedding-ada-002` | 1536 | 61.0 | $0.10/1M tokens | Legacy |

#### Usage

```bash
# OpenAI is used automatically when OPENAI_API_KEY is set
bun run cli index https://github.com/user/repo

# Explicitly specify OpenAI
bun run cli index --provider openai https://github.com/user/repo
```

#### Cost Estimation

| Repository Size | Approx. Tokens | Cost (3-small) |
|-----------------|----------------|----------------|
| Small (<500 files) | 500K-2M | $0.01-0.04 |
| Medium (500-2K files) | 2M-10M | $0.04-0.20 |
| Large (>2K files) | 10M-50M | $0.20-1.00 |

**Note**: Search queries also consume tokens (~100 tokens per query).

---

### Transformers.js (Local - CPU)

Transformers.js runs HuggingFace models directly in JavaScript using ONNX Runtime. This is the default provider when no OpenAI API key is configured.

#### Setup

No setup required. Transformers.js works immediately after `bun install`.

```bash
# Uses Transformers.js automatically when no OPENAI_API_KEY
bun run cli index https://github.com/user/repo

# Explicitly specify Transformers.js
bun run cli index --provider transformersjs https://github.com/user/repo
```

#### Available Models

| Model | Dimensions | MTEB Score | Size | Notes |
|-------|------------|------------|------|-------|
| `Xenova/all-MiniLM-L6-v2` | 384 | 56.3 | 22MB | Default, fastest |
| `Xenova/all-mpnet-base-v2` | 768 | 57.8 | 100MB | Balanced |
| `Xenova/bge-small-en-v1.5` | 384 | ~60 | 33MB | Good quality |
| `Xenova/bge-base-en-v1.5` | 768 | 63.6 | 110MB | Best quality |
| `Xenova/gte-small` | 384 | ~58 | 25MB | Multilingual |

#### Model Selection

```bash
# Use default model (all-MiniLM-L6-v2)
bun run cli index --provider transformersjs https://github.com/user/repo

# Use higher-quality model
bun run cli index --provider transformersjs --model Xenova/bge-base-en-v1.5 https://github.com/user/repo
```

#### Model Download and Caching

Models are downloaded automatically on first use:

```
Downloading Xenova/all-MiniLM-L6-v2...
Downloading model.onnx: 100%
Model loaded successfully.
```

**Cache location**: `~/.cache/huggingface/transformers` (configurable via `TRANSFORMERS_CACHE`)

**Pre-download models** (for air-gapped deployment):
```bash
# Download model to cache
bun run cli providers setup transformersjs

# Or specify model
bun run cli providers setup transformersjs --model Xenova/bge-base-en-v1.5
```

#### Performance

| Scenario | Latency |
|----------|---------|
| First request (model loading) | 2-5 seconds |
| Subsequent requests (warm) | 50-100ms |
| Batch of 100 texts | 5-10 seconds |

**Memory usage**: 200-500MB depending on model

---

### Ollama (Local - GPU)

Ollama is a local LLM server that supports embedding models with optional GPU acceleration. Use this when you have GPU hardware and want the fastest local inference.

#### Setup

1. **Install Ollama**:
   - **Windows/macOS/Linux**: Download from [ollama.ai](https://ollama.ai/download)
   - **Docker**:
     ```bash
     docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
     ```

2. **Pull an embedding model**:
   ```bash
   ollama pull nomic-embed-text
   ```

3. **Verify Ollama is running**:
   ```bash
   curl http://localhost:11434/api/tags
   # Should list available models
   ```

4. **Configure environment** (optional):
   ```bash
   export OLLAMA_BASE_URL=http://localhost:11434  # Default
   export OLLAMA_HOST=localhost                    # Alternative
   export OLLAMA_PORT=11434                        # Alternative
   ```

#### Available Models

| Model | Dimensions | Quality | Size | Notes |
|-------|------------|---------|------|-------|
| `nomic-embed-text` | 768 | 62.4 | 274MB | Default, balanced |
| `mxbai-embed-large` | 1024 | 64.7 | 670MB | SOTA quality |
| `all-minilm` | 384 | 56.3 | 45MB | Smallest, fastest |
| `snowflake-arctic-embed` | 1024 | ~64 | 600MB | High quality |

#### Usage

```bash
# Use Ollama
bun run cli index --provider ollama https://github.com/user/repo

# Specify model
bun run cli index --provider ollama --model mxbai-embed-large https://github.com/user/repo
```

#### GPU Acceleration

Ollama automatically uses GPU when available:
- **NVIDIA**: CUDA support built-in
- **Apple Silicon**: Metal acceleration built-in
- **AMD**: ROCm support (Linux)

Check GPU usage:
```bash
# NVIDIA
nvidia-smi

# Watch GPU memory during indexing
watch -n 1 nvidia-smi
```

#### Performance

| Scenario | CPU | GPU |
|----------|-----|-----|
| Single text (cold) | 500ms-2s | 200ms-1s |
| Single text (warm) | 20-50ms | 5-20ms |
| Batch of 100 texts | 2-5s | 200-500ms |

**Memory usage**: 500MB-2GB RAM (model loaded), 1-4GB VRAM (GPU)

---

## Configuration Guide

### Environment Variables

| Variable | Provider | Default | Description |
|----------|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | All | Auto-detect | Force provider: `openai`, `transformersjs`, `ollama` |
| `OPENAI_API_KEY` | OpenAI | - | OpenAI API key (required for OpenAI) |
| `OPENAI_ORGANIZATION` | OpenAI | - | OpenAI organization ID |
| `OPENAI_BASE_URL` | OpenAI | api.openai.com | API base URL (for Azure/proxies) |
| `TRANSFORMERS_CACHE` | Transformers.js | ~/.cache/huggingface | Model cache directory |
| `OLLAMA_BASE_URL` | Ollama | http://localhost:11434 | Ollama server URL |
| `OLLAMA_HOST` | Ollama | localhost | Ollama host (alternative) |
| `OLLAMA_PORT` | Ollama | 11434 | Ollama port (alternative) |

### Provider Auto-Detection

When `EMBEDDING_PROVIDER` is not set:

1. If `OPENAI_API_KEY` is set → Use OpenAI
2. Otherwise → Use Transformers.js

### CLI Provider Selection

```bash
# Automatic selection (based on environment)
bun run cli index https://github.com/user/repo

# Explicit provider
bun run cli index --provider openai https://github.com/user/repo
bun run cli index --provider transformersjs https://github.com/user/repo
bun run cli index --provider ollama https://github.com/user/repo

# Provider with specific model
bun run cli index --provider transformersjs --model Xenova/bge-base-en-v1.5 https://github.com/user/repo
bun run cli index --provider ollama --model mxbai-embed-large https://github.com/user/repo
```

### Provider Status

Check available providers and their status:

```bash
bun run cli providers list

# Output:
# ┌─────────────────┬────────────┬──────────────────────────┬────────────┐
# │ Provider        │ Status     │ Model                    │ Dimensions │
# ├─────────────────┼────────────┼──────────────────────────┼────────────┤
# │ openai          │ Available  │ text-embedding-3-small   │ 1536       │
# │ transformersjs  │ Available  │ Xenova/all-MiniLM-L6-v2  │ 384        │
# │ ollama          │ Available  │ nomic-embed-text         │ 768        │
# └─────────────────┴────────────┴──────────────────────────┴────────────┘
```

---

## Model Selection

### Quality Comparison (MTEB Benchmark)

The [MTEB (Massive Text Embedding Benchmark)](https://huggingface.co/spaces/mteb/leaderboard) measures embedding quality across multiple tasks.

| Model | MTEB Average | Dimensions | Provider |
|-------|--------------|------------|----------|
| OpenAI text-embedding-3-large | 64.6 | 3072 | OpenAI |
| mxbai-embed-large | 64.7 | 1024 | Ollama |
| bge-base-en-v1.5 | 63.6 | 768 | Transformers.js |
| OpenAI text-embedding-3-small | 62.3 | 1536 | OpenAI |
| nomic-embed-text | 62.4 | 768 | Ollama |
| all-mpnet-base-v2 | 57.8 | 768 | Transformers.js |
| all-MiniLM-L6-v2 | 56.3 | 384 | Transformers.js |

### Recommended Models by Use Case

| Use Case | Model | Provider | Why |
|----------|-------|----------|-----|
| **General code search** | text-embedding-3-small | OpenAI | Best quality-cost balance |
| **Quick local testing** | all-MiniLM-L6-v2 | Transformers.js | Fast, zero-config |
| **Code understanding** | bge-base-en-v1.5 | Transformers.js | Optimized for code |
| **GPU acceleration** | nomic-embed-text | Ollama | Good quality, GPU support |
| **Maximum quality** | mxbai-embed-large | Ollama | SOTA open-source |
| **Air-gapped** | bge-base-en-v1.5 | Transformers.js | Best offline quality |

### Dimension Compatibility

**Important**: Different models produce different embedding dimensions. Embeddings with different dimensions cannot be mixed in the same ChromaDB collection.

| Scenario | Result |
|----------|--------|
| Same provider, same model | Compatible |
| Same provider, different model (same dimensions) | Works but search quality may vary |
| Different dimensions | **Incompatible** - requires full re-index |

When switching providers or models:
```bash
# Check current provider for a repository
bun run cli status

# If switching to different dimensions, force re-index
bun run cli index --force https://github.com/user/repo
```

---

## Offline Usage

### Zero-Internet Operation with Transformers.js

Transformers.js enables complete offline operation after initial model download.

#### Setup for Offline Use

1. **Download model while online**:
   ```bash
   # Download default model
   bun run cli providers setup transformersjs

   # Download specific model
   bun run cli providers setup transformersjs --model Xenova/bge-base-en-v1.5
   ```

2. **Verify cache location**:
   ```bash
   ls ~/.cache/huggingface/transformers/
   # Should show downloaded model files
   ```

3. **Use offline**:
   ```bash
   # No internet required for indexing or search
   bun run cli index --provider transformersjs https://github.com/user/repo
   bun run cli search "authentication middleware"
   ```

#### Air-Gapped Deployment

For environments with no internet access:

1. **On internet-connected machine**:
   ```bash
   # Download models
   bun run cli providers setup transformersjs

   # Package cache directory
   tar -czvf transformers-cache.tar.gz ~/.cache/huggingface/transformers/
   ```

2. **On air-gapped machine**:
   ```bash
   # Extract cache
   tar -xzvf transformers-cache.tar.gz -C ~/

   # Set cache path if needed
   export TRANSFORMERS_CACHE=~/.cache/huggingface/transformers

   # Use Transformers.js (will use cached models)
   bun run cli index --provider transformersjs ...
   ```

### Offline with Ollama

Ollama also works offline after model download:

1. **Pull models while online**:
   ```bash
   ollama pull nomic-embed-text
   ```

2. **Models persist** in Ollama's data directory

3. **Use offline**:
   ```bash
   bun run cli index --provider ollama https://github.com/user/repo
   ```

---

## Per-Repository Configuration

Different repositories can use different embedding providers, but each repository should maintain consistency.

### Checking Repository Provider

```bash
# View repository metadata including provider
bun run cli status --json | jq '.repositories[] | {name, embeddingProvider, embeddingModel}'
```

### Switching Providers for a Repository

When switching providers:

1. **Same dimensions**: Search will work but quality may vary
2. **Different dimensions**: Must re-index

```bash
# Re-index with new provider (required for dimension changes)
bun run cli index --provider ollama --force https://github.com/user/repo
```

### Mixed-Provider Setup

You can use different providers for different repositories:

```bash
# High-quality for important project
bun run cli index --provider openai https://github.com/company/core-api

# Local for experiments
bun run cli index --provider transformersjs https://github.com/user/side-project

# GPU-accelerated for large repo
bun run cli index --provider ollama https://github.com/company/monorepo
```

**Search behavior**: Searches query multiple collections and merge results by similarity score, regardless of provider.

---

## Troubleshooting

### OpenAI Issues

#### "Invalid API key" Error

```bash
# Verify API key format
echo $OPENAI_API_KEY
# Should start with "sk-"

# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
# Should return 200 OK with model list
```

**Solution**: Get a valid key from [OpenAI Platform](https://platform.openai.com/api-keys)

#### Rate Limit Exceeded (429)

```bash
# Check current rate limit status
curl https://api.openai.com/v1/rate_limits \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**Solutions**:
- Wait and retry (automatic exponential backoff)
- Reduce batch size: `export EMBEDDING_BATCH_SIZE=50`
- Upgrade OpenAI tier: [platform.openai.com/account/limits](https://platform.openai.com/account/limits)

#### Insufficient Quota

**Solutions**:
- Add billing: [platform.openai.com/account/billing](https://platform.openai.com/account/billing)
- Switch to local provider: `--provider transformersjs`

### Transformers.js Issues

#### Model Download Fails

```
Error: Failed to download model
```

**Solutions**:
1. Check internet connection
2. Clear cache and retry:
   ```bash
   rm -rf ~/.cache/huggingface/transformers/
   bun run cli providers setup transformersjs
   ```
3. Use pre-downloaded model (see [Air-Gapped Deployment](#air-gapped-deployment))

#### ONNX Runtime Errors

```
Error: ONNX Runtime failed to load
```

**Solutions**:
1. Update Bun: `bun upgrade`
2. Clear Bun cache: `bun pm cache clean`
3. Reinstall dependencies: `rm -rf node_modules && bun install`

#### High Memory Usage

**Solutions**:
- Use smaller model: `--model Xenova/all-MiniLM-L6-v2`
- Process smaller batches (automatic)
- Increase available memory

### Ollama Issues

#### Connection Refused

```
Error: Failed to connect to Ollama at localhost:11434
```

**Solutions**:
1. Verify Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```
2. Start Ollama:
   - **Native**: `ollama serve`
   - **Docker**: `docker start ollama`
3. Check port:
   ```bash
   netstat -an | grep 11434
   ```

#### Model Not Found

```
Error: Model "nomic-embed-text" not found
```

**Solution**: Pull the model:
```bash
ollama pull nomic-embed-text
```

#### GPU Not Detected

**Solutions**:
1. Verify GPU drivers are installed
2. Check CUDA/ROCm/Metal support
3. View Ollama logs: `ollama logs`

### Dimension Mismatch Errors

```
Error: Embedding dimensions (768) do not match collection (1536)
```

**Cause**: Trying to add embeddings with different dimensions to existing collection.

**Solution**: Re-index with `--force`:
```bash
bun run cli index --force https://github.com/user/repo
```

### Provider Selection Not Working

```bash
# Verify environment variables
echo "EMBEDDING_PROVIDER=$EMBEDDING_PROVIDER"
echo "OPENAI_API_KEY=$OPENAI_API_KEY"

# Check provider status
bun run cli providers list

# Force specific provider
bun run cli index --provider transformersjs https://github.com/user/repo
```

---

## Reference

### Related Documentation

- [ADR-0003: Local Embeddings Architecture](architecture/adr/0003-local-embeddings-architecture.md) - Technical design decisions
- [Troubleshooting Guide](troubleshooting.md) - General troubleshooting
- [Claude Code Setup](claude-code-setup.md) - MCP integration

### External Resources

- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard) - Embedding model benchmarks
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
- [Ollama Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md)

---

**Last Updated**: 2026-01-15
