# Licensing Information

This document provides licensing information for Personal Knowledge MCP and its dependencies, with particular attention to graph database options.

## Project License

Personal Knowledge MCP is licensed under the **MIT License** - see the [LICENSE](../LICENSE) file for details.

## Dependency Licensing Overview

| Component | License | Copyleft | Notes |
|-----------|---------|----------|-------|
| Bun Runtime | MIT | No | Permissive |
| TypeScript | Apache 2.0 | No | Permissive |
| ChromaDB | Apache 2.0 | No | Vector database |
| FalkorDB | Apache 2.0 | No | Graph database (default) |
| Neo4j Driver | Apache 2.0 | No | Client library only |
| Neo4j Server | AGPL v3 + Commons Clause | **Yes** | See below |
| tree-sitter | MIT | No | AST parsing |
| OpenAI SDK | MIT | No | Embeddings |

---

## Graph Database Options

Personal Knowledge MCP supports two graph database backends. Understanding their licensing is important for your deployment choices.

### FalkorDB (Default, Recommended)

| Aspect | Details |
|--------|---------|
| **License** | Apache 2.0 |
| **Copyleft** | No |
| **Commercial Use** | Unrestricted |
| **Redistribution** | Permitted with attribution |

FalkorDB is the default graph database, chosen for its fully permissive Apache 2.0 license. You can use, modify, and distribute FalkorDB without copyleft obligations.

**Why FalkorDB is the default**: See [ADR-0004](architecture/adr/0004-graph-database-migration-neo4j-to-falkordb.md) for the complete decision rationale.

### Neo4j (Optional Alternative)

Neo4j remains available as an alternative adapter for users with existing Neo4j infrastructure.

| Component | License | Implications |
|-----------|---------|--------------|
| **Neo4j JavaScript Driver** | Apache 2.0 | No copyleft concerns |
| **Neo4j Community Edition** | AGPL v3 + Commons Clause | Copyleft + commercial restrictions |
| **Neo4j Enterprise Edition** | Commercial | Requires paid license |

#### Neo4j Licensing Considerations

**If you choose to use Neo4j:**

1. **Driver Usage** (Low Risk): The `neo4j-driver` npm package is Apache 2.0 licensed. Using it in your application does not trigger copyleft requirements.

2. **Server Deployment** (Evaluate Carefully):
   - **AGPL v3**: If you modify Neo4j and provide it as a network service, you may be required to release your modifications under AGPL v3.
   - **Commons Clause**: Restricts selling Neo4j Community Edition as a standalone database service.

3. **Recommended Approach**: If you need Neo4j features, consider:
   - Using Neo4j as a separate service that users install themselves
   - Evaluating Neo4j Enterprise Edition for commercial deployments
   - Using FalkorDB (default) to avoid these considerations entirely

#### Further Reading

- [Neo4j Licensing Terms](https://neo4j.com/licensing/)
- [AGPL v3 License Text](https://www.gnu.org/licenses/agpl-3.0.html)
- [Apache 2.0 License Text](https://www.apache.org/licenses/LICENSE-2.0)

---

## Switching Graph Database Adapters

To select your graph database adapter:

```bash
# Use FalkorDB (default)
bun run cli graph populate my-repo

# Use FalkorDB explicitly
bun run cli graph populate my-repo --adapter falkordb

# Use Neo4j
bun run cli graph populate my-repo --adapter neo4j
```

Or set the environment variable:

```bash
# In .env
GRAPH_ADAPTER=falkordb  # or neo4j
```

---

## Disclaimer

This document is provided for informational purposes only and does not constitute legal advice. For specific licensing questions affecting your use case, consult with a qualified attorney.

---

**Last Updated**: 2026-02-01
