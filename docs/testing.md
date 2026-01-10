# Testing Guide

This document describes how to run tests for the Personal Knowledge MCP project.

## Quick Start

```bash
# Run all unit tests
bun test

# Run tests with coverage
bun test --coverage

# Run specific test file
bun test tests/unit/http/routes/health.test.ts

# Run tests matching pattern
bun test --grep "health"
```

## Test Structure

```
tests/
├── unit/               # Unit tests (no external dependencies)
│   ├── http/           # HTTP route and middleware tests
│   ├── storage/        # Storage client tests
│   ├── graph/          # Neo4j client tests
│   └── ...
└── integration/        # Integration tests (require running services)
    ├── storage/        # ChromaDB integration tests
    └── graph/          # Neo4j integration tests
```

## Running Integration Tests

### Prerequisites

Integration tests require running backend services (ChromaDB, Neo4j).

```bash
# Start all services for integration testing
docker compose --profile default up -d

# Verify services are healthy
docker compose ps
```

### ChromaDB Integration Tests

```bash
# Start ChromaDB only
docker compose up -d chromadb

# Run ChromaDB integration tests
bun test tests/integration/storage/chroma-integration.test.ts
```

### Neo4j Integration Tests

```bash
# Ensure NEO4J_PASSWORD is set in .env
# Start Neo4j
docker compose up -d neo4j

# Run Neo4j integration tests
bun test tests/integration/graph/neo4j-integration.test.ts
```

## ChromaDB Authentication Testing

For testing ChromaDB with authentication enabled, use the dedicated test environment.

### Setup

1. **Create test environment file:**
   ```bash
   cp .env.test.example .env.test
   # Edit .env.test and set a secure test token
   ```

2. **Start auth-enabled ChromaDB:**
   ```bash
   # Load test environment and start auth-enabled ChromaDB
   export $(cat .env.test | xargs)
   docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test-auth up -d
   ```

3. **Verify it's running:**
   ```bash
   curl http://localhost:8100/api/v2/heartbeat
   ```

### Running Auth Tests

```bash
# Set required environment variables
export RUN_AUTH_INTEGRATION_TESTS=true
export CHROMADB_TEST_AUTH_TOKEN=your-test-token

# Run auth integration tests
bun test tests/integration/storage/chroma-auth-integration.test.ts
```

### Test Scenarios

The auth integration tests verify:
- Successful connection with valid token
- Connection rejection with invalid token
- Connection rejection without token (when auth is required)
- Health check behavior with authentication

### Cleanup

```bash
# Stop auth-enabled ChromaDB
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test-auth down

# Remove test data volume (optional)
docker volume rm pk-mcp-chromadb-test-auth-data
```

## Continuous Integration

### Main CI Pipeline

The CI pipeline runs on every push and PR to main:

1. **Type checking** - `bun run typecheck`
2. **Linting** - `bun run lint`
3. **Format check** - `bun run format:check`
4. **Unit & Integration tests** - `bun test --coverage`
5. **Build** - `bun run build`

### ChromaDB Auth Tests (CI)

A separate job runs ChromaDB authentication tests after the main pipeline passes.
This uses a test token stored in GitHub Secrets or a default CI token.

## Writing Tests

### Unit Test Guidelines

- Test one thing per test case
- Use descriptive test names
- Mock external dependencies
- Follow existing patterns in the codebase

```typescript
describe("ComponentName", () => {
  test("should do X when Y", async () => {
    // Arrange
    const input = createInput();

    // Act
    const result = await component.doSomething(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

### Integration Test Guidelines

- Skip tests when services are unavailable
- Clean up test data after tests
- Use unique identifiers to avoid conflicts
- Add reasonable timeouts

```typescript
// Check if service is available before running tests
const serviceAvailable = await checkService();
const describeOrSkip = serviceAvailable ? describe : describe.skip;

describeOrSkip("Integration Tests", () => {
  // Tests that require the service
});
```

## Coverage Requirements

- **Minimum coverage**: 90% (configured in `bunfig.toml`)
- Coverage reports are uploaded to Codecov in CI
- View coverage locally: `bun test --coverage`

## Troubleshooting

### ChromaDB Connection Issues

```bash
# Check if ChromaDB is running
docker compose ps
docker compose logs chromadb

# Verify connectivity
curl http://localhost:8000/api/v2/heartbeat
```

### Neo4j Connection Issues

```bash
# Check if Neo4j is running
docker compose ps
docker compose logs neo4j

# Verify connectivity (requires cypher-shell in container)
docker exec pk-mcp-neo4j cypher-shell -u neo4j -p $NEO4J_PASSWORD "RETURN 1"
```

### Test Timeout Issues

If tests timeout waiting for services:
1. Increase wait time in test setup
2. Check service logs for startup errors
3. Ensure sufficient system resources
