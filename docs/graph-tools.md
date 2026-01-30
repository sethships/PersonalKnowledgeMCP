# Graph Tools - Personal Knowledge MCP

This guide documents the graph-based MCP tools that enable code dependency analysis and impact assessment using the knowledge graph backed by FalkorDB.

## Overview

The Personal Knowledge MCP provides two graph-based tools that complement semantic search with structural code analysis:

| Tool | Purpose | Primary Use Case |
|------|---------|------------------|
| `get_dependencies` | Query what a code entity depends on | Understanding code structure, pre-change analysis |
| `get_dependents` | Query what depends on a code entity | Impact analysis, refactoring risk assessment |

### Graph vs. Semantic Search

| Capability | Semantic Search | Graph Tools |
|------------|-----------------|-------------|
| Find similar code | Yes | No |
| Find code by concept | Yes | No |
| Trace import chains | No | Yes |
| Identify callers/callees | No | Yes |
| Impact analysis | No | Yes |
| Dependency depth traversal | No | Yes |

**Best Practice**: Use semantic search to *find* relevant code, then use graph tools to *understand* its relationships and impact.

## Prerequisites

Before using graph tools, ensure:

1. **FalkorDB is running**: The knowledge graph requires FalkorDB
   ```bash
   docker compose --profile default up -d falkordb
   ```

2. **Repository is indexed with AST parsing**: Graph data requires code analysis beyond simple text indexing
   ```bash
   pk-mcp index <repository-url>
   pk-mcp graph populate <repository-name>
   ```

3. **GraphService is enabled**: The MCP server must be configured with FalkorDB connection
   ```bash
   # Required environment variables
   FALKORDB_HOST=localhost
   FALKORDB_PORT=6380
   FALKORDB_PASSWORD=your-password
   ```

### Supported Languages for Graph Population

The graph tools extract code entities (functions, classes, imports, etc.) from files written in these languages:

| Language | Extensions | Parser |
|----------|------------|--------|
| TypeScript | `.ts`, `.mts`, `.cts` | tree-sitter |
| TSX | `.tsx` | tree-sitter |
| JavaScript | `.js`, `.mjs`, `.cjs` | tree-sitter |
| JSX | `.jsx` | tree-sitter |
| Python | `.py`, `.pyw`, `.pyi` | tree-sitter |
| Java | `.java` | tree-sitter |
| Go | `.go` | tree-sitter |
| Rust | `.rs` | tree-sitter |
| C# | `.cs` | Roslyn |
| C | `.c`, `.h` | tree-sitter |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx` | tree-sitter |
| Ruby | `.rb`, `.rake`, `.gemspec` | tree-sitter |
| PHP | `.php`, `.phtml`, `.php5`, `.php7`, `.inc` | tree-sitter |

## MCP Tools Reference

### get_dependencies

**Purpose**: Get all dependencies of a file, function, or class. Returns what the entity imports, calls, or extends.

**When to use**:
- Understanding what a piece of code relies on before making changes
- Exploring the codebase structure
- Identifying external dependencies
- Planning migrations or upgrades

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entity_type` | string | Yes | - | Type of entity: `"file"`, `"function"`, or `"class"` |
| `entity_path` | string | Yes | - | Path or identifier of the entity |
| `repository` | string | Yes | - | Repository name to scope the query |
| `depth` | integer | No | 1 | Depth of transitive dependencies (1-5) |
| `relationship_types` | array | No | all | Filter: `["imports", "calls", "extends", "implements", "references"]` |

#### Entity Path Format

- **Files**: Relative path from repository root (e.g., `"src/auth/middleware.ts"`)
- **Functions/Classes**: Name or fully qualified name
  - Simple: `"AuthMiddleware"`
  - Qualified: `"src/auth/middleware.ts::AuthMiddleware"`

#### Example Requests

**Get direct imports of a file**:
```json
{
  "entity_type": "file",
  "entity_path": "src/services/auth.ts",
  "repository": "my-api"
}
```

**Get transitive dependencies (2 levels deep)**:
```json
{
  "entity_type": "file",
  "entity_path": "src/services/auth.ts",
  "repository": "my-api",
  "depth": 2
}
```

**Get only import relationships**:
```json
{
  "entity_type": "file",
  "entity_path": "src/services/auth.ts",
  "repository": "my-api",
  "relationship_types": ["imports"]
}
```

**Get dependencies of a specific class**:
```json
{
  "entity_type": "class",
  "entity_path": "AuthService",
  "repository": "my-api",
  "depth": 2,
  "relationship_types": ["extends", "implements"]
}
```

#### Response Format

```json
{
  "entity": {
    "type": "file",
    "path": "src/services/auth.ts",
    "repository": "my-api"
  },
  "dependencies": [
    {
      "type": "file",
      "path": "src/utils/jwt.ts",
      "relationship": "imports",
      "depth": 1,
      "metadata": {
        "line_number": 3
      }
    },
    {
      "type": "package",
      "path": "jsonwebtoken",
      "relationship": "imports",
      "depth": 1,
      "metadata": {
        "external": true
      }
    }
  ],
  "metadata": {
    "total_count": 2,
    "query_time_ms": 45,
    "max_depth_reached": 1
  }
}
```

---

### get_dependents

**Purpose**: Get all code that depends on a file, function, or class. Returns what imports, calls, or extends the entity.

**When to use**:
- Impact analysis before refactoring
- Understanding the blast radius of a change
- Identifying critical shared code
- Planning deprecation of APIs or functions

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entity_type` | string | Yes | - | Type of entity: `"file"`, `"function"`, `"class"`, or `"package"` |
| `entity_path` | string | Yes | - | Path or identifier of the entity |
| `repository` | string | No | all | Repository name (omit to search all repositories) |
| `depth` | integer | No | 1 | Depth of transitive dependents (1-5) |
| `include_cross_repo` | boolean | No | false | Include dependents from other repositories |

#### Key Differences from get_dependencies

1. **Repository is optional**: Omit to search all indexed repositories
2. **Supports "package" entity type**: For package-level impact analysis
3. **Cross-repository search**: Find dependents across your entire codebase
4. **Impact analysis metrics**: Response includes severity assessment

#### Example Requests

**Find all files that import a utility**:
```json
{
  "entity_type": "file",
  "entity_path": "src/utils/validation.ts",
  "repository": "my-api"
}
```

**Impact analysis across all repositories**:
```json
{
  "entity_type": "function",
  "entity_path": "validateToken",
  "include_cross_repo": true
}
```

**Find all callers of a function (2 levels deep)**:
```json
{
  "entity_type": "function",
  "entity_path": "src/auth/middleware.ts::authenticate",
  "repository": "my-api",
  "depth": 2
}
```

**Package-level impact analysis**:
```json
{
  "entity_type": "package",
  "entity_path": "src/shared/utils",
  "repository": "my-api"
}
```

#### Response Format

```json
{
  "entity": {
    "type": "function",
    "path": "validateToken",
    "repository": "my-api"
  },
  "dependents": [
    {
      "type": "file",
      "path": "src/middleware/auth.ts",
      "repository": "my-api",
      "relationship": "calls",
      "depth": 1,
      "metadata": {
        "line_number": 42
      }
    },
    {
      "type": "file",
      "path": "src/routes/protected.ts",
      "repository": "my-api",
      "relationship": "calls",
      "depth": 2,
      "metadata": {}
    }
  ],
  "impact_analysis": {
    "direct_impact_count": 1,
    "transitive_impact_count": 1,
    "impact_score": 0.35
  },
  "metadata": {
    "total_count": 2,
    "query_time_ms": 67,
    "repositories_searched": ["my-api"]
  }
}
```

#### Understanding Impact Analysis

The `impact_analysis` object helps assess refactoring risk:

| Field | Description | Interpretation |
|-------|-------------|----------------|
| `direct_impact_count` | Files/entities that directly depend on this entity | Immediate change required |
| `transitive_impact_count` | Entities affected through dependency chains | Potential cascade effects |
| `impact_score` | Normalized score (0.0-1.0) | Higher = more risk |

**Impact Score Guidelines**:
- `0.0 - 0.2`: Low impact, safe to refactor
- `0.2 - 0.5`: Moderate impact, plan carefully
- `0.5 - 0.8`: High impact, comprehensive testing needed
- `0.8 - 1.0`: Critical impact, consider incremental changes

---

## Usage Examples

### Example 1: Pre-Refactoring Analysis

Before renaming a utility function:

```
Claude, I want to rename the validateEmail function in src/utils/validation.ts.
Can you show me what depends on it?
```

Claude would use:
```json
{
  "entity_type": "function",
  "entity_path": "src/utils/validation.ts::validateEmail",
  "repository": "my-api",
  "depth": 2
}
```

### Example 2: Understanding New Code

When exploring unfamiliar code:

```
Claude, I'm looking at src/services/payment.ts. What external services
and internal modules does it depend on?
```

Claude would use:
```json
{
  "entity_type": "file",
  "entity_path": "src/services/payment.ts",
  "repository": "my-api",
  "depth": 1,
  "relationship_types": ["imports"]
}
```

### Example 3: Deprecation Planning

Planning to deprecate an old API:

```
Claude, we want to deprecate the legacy authentication middleware.
What's the impact across all our repositories?
```

Claude would use:
```json
{
  "entity_type": "file",
  "entity_path": "src/middleware/legacy-auth.ts",
  "include_cross_repo": true,
  "depth": 3
}
```

### Example 4: Architecture Overview

Understanding module boundaries:

```
Claude, show me all the dependencies of our core domain module
to check for unwanted coupling.
```

Claude would use:
```json
{
  "entity_type": "file",
  "entity_path": "src/domain/index.ts",
  "repository": "my-api",
  "depth": 1
}
```

---

## Performance

Graph tools are optimized for fast response times:

| Query Type | Target Latency |
|------------|----------------|
| Direct dependencies (depth=1) | < 100ms |
| Transitive queries (depth=2-3) | < 300ms |
| Cross-repository queries | < 500ms |
| Full module graph | < 1000ms |

---

## Troubleshooting

### "Entity not found" Error

**Cause**: The entity path doesn't match any indexed code.

**Solutions**:
1. Verify the path is relative to repository root
2. Check that the repository is indexed: `pk-mcp status`
3. For functions/classes, try the fully qualified name

### "No graph data available" Error

**Cause**: FalkorDB is not running or not configured.

**Solutions**:
1. Start FalkorDB: `docker compose --profile default up -d falkordb`
2. Verify connection: `docker compose logs falkordb`
3. Check environment variables: `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_PASSWORD`

### Empty Results

**Cause**: The entity exists but has no relationships of the requested type.

**Solutions**:
1. Try without `relationship_types` filter to see all relationships
2. Increase `depth` to find transitive dependencies
3. For `get_dependents`, try `include_cross_repo: true`

### Slow Queries

**Cause**: Deep traversal or large result sets.

**Solutions**:
1. Reduce `depth` parameter
2. Add `relationship_types` filter
3. Scope to a specific repository instead of all

---

## Related Documentation

- [Knowledge Graph PRD](pm/knowledge-graph-PRD.md) - Full product requirements
- [Knowledge Graph Architecture](architecture/adr/0002-knowledge-graph-architecture.md) - Technical design
- [MCP Integration Guide](MCP_INTEGRATION_GUIDE.md) - General MCP setup
