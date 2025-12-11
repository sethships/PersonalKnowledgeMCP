# [Infrastructure] Logging Infrastructure Setup

## Description

Implement structured logging infrastructure using Pino. This provides consistent, JSON-formatted logging across all components with proper log levels and context.

## Requirements

From PRD NFR-5 and SDD Section 9.2:
- Structured JSON logging
- Configurable log levels
- Component context in logs
- Request ID tracing
- Error stack traces in logs
- No secrets in logs

## Acceptance Criteria

### Implementation (`src/logging/index.ts`)
- [ ] Logger factory using Pino
- [ ] Log levels: error, warn, info, debug, trace
- [ ] Configurable via `LOG_LEVEL` environment variable
- [ ] JSON format with:
  - [ ] `timestamp` - ISO 8601
  - [ ] `level` - Log level name
  - [ ] `message` - Log message
  - [ ] `context` - Component and operation context
  - [ ] `data` - Operation-specific data (optional)
  - [ ] `error` - Error details if applicable

### Child Logger Support
- [ ] Create child loggers with component context
- [ ] Support request ID for tracing
- [ ] Example usage:
  ```typescript
  const logger = createLogger('search-service');
  logger.info('Search completed', { query, resultsCount, durationMs });
  ```

### Secret Redaction
- [ ] Redact `OPENAI_API_KEY` from logs
- [ ] Redact `GITHUB_PAT` from logs
- [ ] Redact authorization headers

### Log Output
- [ ] Default: stderr (for MCP compatibility)
- [ ] Optional: File output for debugging
- [ ] Pretty print option for development

## Technical Notes

### Logger Factory

```typescript
import pino from 'pino';

interface LoggerConfig {
  level: string;
  component: string;
  prettyPrint?: boolean;
}

export function createLogger(component: string): pino.Logger {
  const level = process.env.LOG_LEVEL || 'info';

  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { component },
    redact: {
      paths: ['apiKey', 'authorization', 'token', 'pat'],
      censor: '[REDACTED]'
    },
    formatters: {
      level: (label) => ({ level: label })
    }
  });
}
```

### Child Logger with Context

```typescript
const baseLogger = createLogger('mcp-server');

// Create child with request context
const requestLogger = baseLogger.child({ requestId: 'req-123' });
requestLogger.info('Processing tool call', { tool: 'semantic_search' });
```

### Log Entry Structure

```typescript
interface LogEntry {
  timestamp: string;      // ISO 8601
  level: string;          // error, warn, info, debug, trace
  message: string;
  component: string;      // mcp-server, search-service, etc.
  requestId?: string;     // For tracing
  operation?: string;     // semantic_search, index_repository
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}
```

### Example Log Output

```json
{
  "timestamp": "2025-12-10T15:30:00.000Z",
  "level": "info",
  "message": "Semantic search completed",
  "component": "search-service",
  "operation": "semantic_search",
  "data": {
    "query": "authentication middleware",
    "resultsCount": 5,
    "durationMs": 145,
    "repositoriesSearched": ["my-api"]
  }
}
```

### Error Logging

```typescript
try {
  // operation
} catch (error) {
  logger.error({
    message: 'Search failed',
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  });
}
```

### Pretty Print for Development

```typescript
// In development mode
const devLogger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  }
});
```

## Testing Requirements

- [ ] Unit tests (85% coverage):
  - [ ] Logger creation
  - [ ] Log level filtering
  - [ ] Child logger context
  - [ ] Secret redaction
- [ ] Integration tests:
  - [ ] Log output format verification
  - [ ] Level filtering works
  - [ ] Redaction works for all secret types

## Definition of Done

- [ ] Logger factory implemented
- [ ] Child logger support
- [ ] Secret redaction working
- [ ] LOG_LEVEL configuration
- [ ] Unit tests passing (85% coverage)
- [ ] All components use structured logging
- [ ] Documentation for log format

## Size Estimate

**Size:** S (Small) - 3-4 hours

## Dependencies

- #1 Project Setup (pino dependency)

## Blocks

- All components should use this logging

## Labels

phase-1, P1, infrastructure
