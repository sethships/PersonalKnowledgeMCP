# Contributing to Personal Knowledge MCP

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the Personal Knowledge MCP project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing Requirements](#testing-requirements)
- [Submitting Changes](#submitting-changes)
- [Issue Guidelines](#issue-guidelines)

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Bun 1.0+**: [Install Bun](https://bun.sh/)
- **Docker Desktop**: For running ChromaDB
- **Git**: For version control
- **OpenAI API Key**: For embedding generation
- **GitHub PAT** (optional): For private repository indexing

### Initial Setup

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/PersonalKnowledgeMCP.git
   cd PersonalKnowledgeMCP
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env and add your OPENAI_API_KEY and other required values
   ```

4. **Start ChromaDB**:
   ```bash
   docker-compose up -d
   ```

5. **Verify setup**:
   ```bash
   bun run typecheck    # TypeScript type checking
   bun run lint         # ESLint
   bun test             # Run tests
   bun run build        # Build the project
   ```

6. **Set up Git hooks** (optional but recommended):
   ```bash
   bun install  # Pre-commit hooks are automatically set up
   ```

## Development Workflow

### Branch Strategy

We follow a **feature branch workflow**:

1. **Create a feature branch** from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   ```

2. **Branch naming conventions**:
   - `feature/` - New features (e.g., `feature/graph-relationships`)
   - `fix/` - Bug fixes (e.g., `fix/search-timeout`)
   - `docs/` - Documentation updates (e.g., `docs/api-reference`)
   - `refactor/` - Code refactoring (e.g., `refactor/embedding-service`)
   - `test/` - Test additions/improvements (e.g., `test/integration-coverage`)

3. **Work on your changes**:
   ```bash
   # Make changes
   bun test --watch     # Run tests in watch mode during development
   bun run lint:fix     # Auto-fix linting issues
   bun run format       # Format code
   ```

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add semantic search caching"
   # Pre-commit hooks will automatically run linting and formatting
   ```

5. **Push and create a pull request**:
   ```bash
   git push origin feature/your-feature-name
   # Then create a PR on GitHub
   ```

### Commit Message Convention

We follow **Conventional Commits** format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring (no functional changes)
- `test`: Adding or updating tests
- `chore`: Build system, dependencies, tooling
- `perf`: Performance improvements

**Examples**:
```
feat(search): add caching for semantic search queries

Implements LRU cache to reduce OpenAI API calls for repeated queries.
Configurable TTL via SEARCH_CACHE_TTL_MS environment variable.

Closes #42
```

```
fix(ingestion): handle binary file detection correctly

Fixes issue where binary files were being processed as text,
causing embedding generation failures.

Fixes #38
```

## Code Standards

### TypeScript Guidelines

- **Strict mode**: Always enabled (enforced by `tsconfig.json`)
- **No `any` types**: Use proper typing or `unknown`
- **Explicit return types**: All functions must have return type annotations
- **No unused variables**: Prefix with `_` if intentionally unused
- **Async/await**: Prefer over raw Promises
- **Functional patterns**: Prefer immutability and pure functions

**Example**:
```typescript
// ✅ Good
async function searchDocuments(query: string, limit: number): Promise<SearchResult[]> {
  const embedding = await generateEmbedding(query);
  return await vectorStore.search(embedding, limit);
}

// ❌ Bad
async function searchDocuments(query, limit) {  // Missing types
  let embedding = await generateEmbedding(query);  // Unnecessary `let`
  return vectorStore.search(embedding, limit);  // Missing `await`
}
```

### Code Organization

- **File structure**:
  ```
  src/
  ├── mcp/          # MCP server implementation
  ├── services/     # Business logic
  ├── providers/    # External service adapters (OpenAI)
  ├── storage/      # Database clients
  ├── ingestion/    # File processing pipelines
  ├── config/       # Configuration management
  ├── logging/      # Logging setup
  └── types/        # Shared type definitions
  ```

- **Imports**: Absolute imports from `src/` root
- **Barrel exports**: Use `index.ts` for module exports
- **Single responsibility**: One class/function per concern

### Linting and Formatting

- **ESLint**: Run `bun run lint` (auto-fix with `bun run lint:fix`)
- **Prettier**: Run `bun run format` (check with `bun run format:check`)
- **Pre-commit hooks**: Automatically run on `git commit`

### Documentation Standards

#### Code Documentation

```typescript
/**
 * Searches indexed repositories using semantic similarity.
 *
 * @param query - Natural language search query
 * @param options - Search options (limit, threshold, repository filter)
 * @returns Array of search results with similarity scores
 * @throws {EmbeddingError} If embedding generation fails
 * @throws {StorageError} If ChromaDB query fails
 *
 * @example
 * ```typescript
 * const results = await searchService.search(
 *   "authentication middleware",
 *   { limit: 10, threshold: 0.75 }
 * );
 * ```
 */
async function search(
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  // Implementation
}
```

#### File Headers

```typescript
/**
 * Search Service
 *
 * Implements semantic search across indexed repositories using vector similarity.
 * Coordinates embedding generation, ChromaDB queries, and result ranking.
 *
 * @module services/search
 */
```

#### Architecture Decision Records (ADRs)

For significant architectural decisions, create ADRs in `docs/architecture/adr/`:

```markdown
# ADR-001: Use ChromaDB for Vector Storage

## Status
Accepted

## Context
[Problem statement]

## Decision
[Solution chosen]

## Consequences
[Trade-offs and implications]
```

## Testing Requirements

### Coverage Standards

- **Minimum coverage**: 90% (enforced in `bunfig.toml`)
- **Critical components**: 95% coverage
  - MCP tool handlers
  - Search service
  - Embedding provider
  - ChromaDB client

### Running Tests

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run specific test file
bun test tests/unit/search-service.test.ts

# Watch mode during development
bun test --watch
```

### Writing Tests

Use **Bun's built-in test runner**:

```typescript
import { expect, test, describe, beforeAll, afterAll } from "bun:test";

describe("SearchService", () => {
  let searchService: SearchService;

  beforeAll(async () => {
    // Setup: Initialize services, mock dependencies
    searchService = new SearchService(mockEmbeddingProvider, mockVectorStore);
  });

  afterAll(async () => {
    // Cleanup: Close connections, clear mocks
  });

  test("should return relevant results for semantic query", async () => {
    const results = await searchService.search("authentication middleware", {
      limit: 5,
      threshold: 0.7,
    });

    expect(results).toHaveLength(5);
    expect(results[0].score).toBeGreaterThanOrEqual(0.7);
  });

  test("should handle embedding generation failure gracefully", async () => {
    // Mock failure scenario
    mockEmbeddingProvider.generate.mockRejectedValue(new Error("API timeout"));

    await expect(
      searchService.search("query", { limit: 10 })
    ).rejects.toThrow("API timeout");
  });
});
```

### Test Priorities

1. **Unit tests**: Service logic, utilities, transformations
2. **Integration tests**: Database interactions, API calls (with mocks)
3. **E2E tests**: Full MCP tool flows (critical paths only)

## Submitting Changes

### Pull Request Process

1. **Ensure all checks pass**:
   ```bash
   bun run typecheck   # TypeScript
   bun run lint        # ESLint
   bun test --coverage # Tests with coverage
   bun run build       # Build
   ```

2. **Create a pull request**:
   - Use the PR template (auto-populated)
   - Link related issues (`Closes #123`)
   - Provide clear description and test evidence
   - Mark as draft if work-in-progress

3. **Address review feedback**:
   - Respond to all comments
   - Make requested changes
   - Re-request review when ready

4. **Merge requirements**:
   - At least one approval
   - All CI checks passing
   - No merge conflicts
   - Branch up-to-date with `main`

### Code Review Guidelines

**For Authors**:
- Keep PRs small (<400 lines of changes)
- Self-review before requesting review
- Provide context in PR description
- Respond to feedback promptly

**For Reviewers**:
- Review within 2 business days
- Be constructive and specific
- Test locally if necessary
- Approve only when confident

## Issue Guidelines

### Reporting Bugs

Use the **Bug Report** template and include:
- Clear reproduction steps
- Expected vs. actual behavior
- Environment details (OS, Bun version)
- Relevant logs or error messages

### Suggesting Features

Use the **Feature Request** template and include:
- Problem statement (user need)
- Proposed solution
- Relevant project phase (Phase 1-4)
- Alternatives considered

### Infrastructure Changes

Use the **Infrastructure/Tooling** template for:
- CI/CD improvements
- Build system changes
- Testing infrastructure
- Development tools

## Project Phases

Understanding project phases helps align contributions:

- **Phase 1** (Complete): Core MCP + Vector Search
- **Phase 2** (Current): Code Intelligence + Multi-Provider Embeddings (13 languages, Neo4j graph)
- **Phase 3** (Complete): Multi-Instance + HTTP Transport

See [docs/High-level-Personal-Knowledge-MCP-PRD.md](docs/High-level-Personal-Knowledge-MCP-PRD.md) for details.

## Getting Help

- **Documentation**: Check `docs/` folder
- **Project Config**: See `.claude/CLAUDE.md` for development guidelines
- **Discussions**: Use GitHub Discussions for questions
- **Issues**: Search existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (TBD).

---

Thank you for contributing to Personal Knowledge MCP! 🚀
