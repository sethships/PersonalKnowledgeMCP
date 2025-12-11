# [Testing] Test Coverage and Quality Validation

## Description

Ensure comprehensive test coverage across all components, achieve the 90% coverage target, and validate system quality through integration and E2E testing.

## Requirements

From PRD Success Criteria and SDD Section 12:
- 90% minimum test coverage
- Unit, integration, and E2E tests
- Performance validation against targets
- All validation test cases pass

## Acceptance Criteria

### Test Coverage Targets (from SDD 12.1)
- [ ] Overall coverage: >= 90%
- [ ] MCP Tool Handlers: >= 95%
- [ ] SearchService: >= 95%
- [ ] EmbeddingProvider: >= 90%
- [ ] ChromaStorageClient: >= 90%
- [ ] FileChunker: >= 95%
- [ ] FileScanner: >= 85%
- [ ] RepositoryCloner: >= 80%

### Unit Test Completion
- [ ] All service classes have unit tests
- [ ] All utility functions have unit tests
- [ ] Edge cases covered
- [ ] Error paths tested

### Integration Test Completion
- [ ] ChromaDB integration tests
- [ ] Search flow integration tests
- [ ] Indexing flow integration tests
- [ ] Repository metadata persistence tests

### E2E Test Completion
- [ ] MCP protocol E2E tests
- [ ] Full workflow E2E tests (index -> search)

### Test Fixtures
- [ ] Sample repository fixture (`tests/fixtures/sample-repo/`)
- [ ] Pre-computed embeddings fixture
- [ ] Test queries with expected results

### Performance Validation
- [ ] Query response time < 500ms (p95)
- [ ] Query response time < 200ms (p50)
- [ ] Small repo indexing < 5 minutes
- [ ] Embedding generation rate measured

### PRD Validation Test Cases
1. [ ] Index Small Repository
   - Public repo with <100 files
   - Indexed in <2 minutes
   - All code files processed

2. [ ] Semantic Search - Exact Match
   - Search for function name
   - Function file in top 3 results

3. [ ] Semantic Search - Conceptual Match
   - Search for "handle user login"
   - Auth-related code returned

4. [ ] Claude Code Integration
   - MCP server configured
   - semantic_search tool appears

5. [ ] Error Handling
   - Invalid repository URL
   - Clear error message, no crash

## Technical Notes

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};
```

### Test Script in package.json

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:e2e": "jest tests/e2e"
  }
}
```

### Mock Strategy Summary

**OpenAI API:**
- Mock `openai` package
- Return deterministic embeddings
- Test rate limit handling

**ChromaDB:**
- Unit tests: Full mock
- Integration tests: Real container (testcontainers)

**File System:**
- Use fixture directories
- Mock `fs` for edge cases

### Sample Repository Fixture

```
tests/fixtures/sample-repo/
├── src/
│   ├── index.ts
│   ├── auth/
│   │   └── middleware.ts
│   └── utils/
│       └── helpers.ts
├── README.md
├── package.json
└── .gitignore
```

### Performance Test

```typescript
describe('Performance: Query Latency', () => {
  it('should respond within 500ms for p95', async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await searchService.search({
        query: testQueries[i % testQueries.length],
        limit: 10,
        threshold: 0.7
      });
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    expect(p50).toBeLessThan(200);
    expect(p95).toBeLessThan(500);
  });
});
```

### Coverage Report Script

```bash
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html
```

## Testing Requirements

This IS the testing issue, so:
- [ ] All other component tests completed
- [ ] Coverage report generated
- [ ] Coverage meets 90% threshold
- [ ] All PRD validation tests pass
- [ ] Performance tests pass

## Definition of Done

- [ ] 90% overall test coverage achieved
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] All E2E tests passing
- [ ] Performance targets validated
- [ ] PRD validation test cases documented and passing
- [ ] Coverage report committed

## Size Estimate

**Size:** L (Large) - 8-12 hours (gap filling across components)

## Dependencies

- All feature issues (#1-#15) must be complete
- Issues may have coverage gaps to fill

## Blocks

- Phase 1 completion

## Labels

phase-1, P0, testing
