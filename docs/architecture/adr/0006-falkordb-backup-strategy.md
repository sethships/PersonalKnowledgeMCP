# ADR-0006: FalkorDB Backup Strategy

**Status:** Proposed

**Date:** 2026-04-23

**Deciders:** Architecture Team

**Technical Story:** Cross-Machine Migration feature requires backing up FalkorDB graph data. No FalkorDB backup tooling exists today (only legacy Neo4j scripts, superseded by ADR-0004). See [DB-Migration-Design.md](../DB-Migration-Design.md).

## Context and Problem Statement

FalkorDB is a Redis module (`graph.so` loaded by a Redis/FalkorDB server process) that stores graph data in the Redis keyspace. Because it is Redis-based, every Redis persistence mechanism is available — but each has tradeoffs for consistency, lockout windows, and version portability. We need one recommended approach that works across:

- Single-instance Docker Compose deployments
- Multi-instance deployments (each instance having its own FalkorDB if we expand that way)
- Eventual Kubernetes deployments (PVC-backed)

The backup must capture all graphs in the FalkorDB instance (currently just `knowledge_graph`, but the adapter supports multiple via `selectGraph`), and must be restorable to the same minor version of FalkorDB without manual surgery.

## Decision Drivers

- **Consistency**: Backup must represent a single point-in-time state of the graph
- **Minimal downtime**: Ideally online backup; acceptable to pause writes but not reads
- **Portable**: Output must be movable between machines and restorable on any host running a compatible FalkorDB version
- **Completeness**: Must capture all graphs, schema, indexes, and vector data (if FalkorDB vector indexes are in use)
- **Version compatibility**: Must be restorable across minor version bumps; major bumps must be detected and refused
- **Simple**: We are a small team; operational toil is expensive
- **Cross-platform tooling**: Available on Windows, Linux, macOS

## Considered Options

### Option 1: `BGSAVE` + Copy `dump.rdb` from Volume

**Description:** Issue `BGSAVE` against FalkorDB via `redis-cli`; FalkorDB (Redis) forks and writes a compressed RDB snapshot to `/data/dump.rdb` inside the container. We then spin up an Alpine sidecar to copy the file out (same pattern as `backup-chromadb.sh`).

**Pros:**
- Non-blocking: writes continue during `BGSAVE` (copy-on-write fork)
- Native Redis mechanism; battle-tested at scale
- Single file output; trivially portable
- RDB format is stable within a major Redis version
- No extra client tooling needed beyond `redis-cli`
- Works identically against bare-metal, Docker, or K8s deployments
- FalkorDB's own persistence already uses RDB; we're piggybacking on what the engine does anyway

**Cons:**
- RDB format is tied to Redis/FalkorDB version — cross-major-version restore is not guaranteed
- Fork requires memory headroom (worst case 2x); problem on memory-constrained hosts
- No incremental capability (full snapshot each time) — acceptable for our volume sizes
- Requires polling `LASTSAVE` to know when `BGSAVE` completes

### Option 2: `redis-cli --rdb <file>` (Client-Side Pull)

**Description:** Stream an RDB dump from the server to a local file via the client protocol, without touching the server's filesystem.

**Pros:**
- No volume mount required on backup host — pure network operation
- Single-file output
- Works against remote servers
- Good K8s story (port-forward and pull)

**Cons:**
- Server still performs a `SYNC`/`BGSAVE`-equivalent internally; same memory profile as Option 1
- `redis-cli` must be available on the backup host (not in all user environments)
- Slightly slower than volume copy for local deployments due to protocol overhead
- RDB version portability caveat identical to Option 1

### Option 3: `DEBUG RELOAD` + File Copy

**Description:** Force an in-place reload from disk to flush consistency, then copy.

**Pros:**
- Guarantees RDB on disk matches in-memory state at a point

**Cons:**
- `DEBUG` commands are disabled in production configurations by default
- Reload briefly makes the server unresponsive
- No advantage over `BGSAVE` for our use case
- Rejected.

### Option 4: Logical Export via Cypher (`MATCH ... RETURN`) + Replay

**Description:** Walk every node and relationship with Cypher, serialize to a portable format (JSONL, Cypher INSERT statements, or GraphML), replay on restore.

**Pros:**
- Truly version-portable — works across major Redis/FalkorDB version changes
- Human-readable output; diffable; selective replay possible
- Could enable graph-only merge semantics (add-to-existing) rather than clobber

**Cons:**
- Custom tooling to write and maintain (nontrivial — must handle all node labels, property types, indexes, constraints)
- Slow on large graphs (order of magnitude worse than RDB snapshot)
- Index and constraint definitions are harder to round-trip than data
- Does not cover FalkorDB-specific features (e.g., vector indexes) cleanly
- Risk of silent semantic drift between export and import if Cypher dialect shifts
- No precedent in the FalkorDB ecosystem — we'd be inventing

### Option 5: `GRAPH.COPY` (FalkorDB-specific)

**Description:** FalkorDB supports `GRAPH.COPY <src> <dst>` to duplicate a graph in-place. Not a backup mechanism — output stays on the same server.

**Pros:** Fast in-server copy for pre-migration snapshotting.

**Cons:** Does not produce a portable artifact. Not a backup strategy. Rejected for cross-machine use.

## Decision Outcome

**Chosen option: Option 1 — `BGSAVE` + volume-mounted RDB copy.** With an escape hatch to Option 4 (logical export) for version-incompatible restores.

Rationale:

1. **Alignment with engine**: FalkorDB/Redis is designed around RDB; using it is the path of least surprise and gets us correctness for free.
2. **Operational symmetry**: The copy-from-volume pattern exactly mirrors `backup-chromadb.sh`. Code reuse is high.
3. **Online**: `BGSAVE` does not block reads or writes in normal operation; meets our low-downtime driver.
4. **Single file**: Drops cleanly into the migration archive alongside the ChromaDB tar.
5. **Portability suffices in practice**: We pin `falkordb/falkordb:v4.4.1` in `docker-compose.yml`. Cross-machine restore of the same image version always works. Cross-version restore is detected via the manifest and — if incompatible — the user is directed to the logical-export path (Option 4) as a fallback.

### Primary backup flow

> *Revised 2026-05-05 — code-review fix M-7. This specification is the single source of truth for both PR-08 (TS implementation in `falkordb-ops.ts`) and PR-09 (shell scripts). Both must reference this section; if the predicate logic needs to change, change it here first and update both implementations.*

The BGSAVE → poll-LASTSAVE → poll-INFO-persistence sequence is specified below in language-agnostic numbered form, naming exact Redis fields, predicates, and ordering.

1. Confirm FalkorDB container is running and authenticated (`PING` returns `PONG`).
2. Issue Redis command `LASTSAVE`. Record the integer Unix timestamp it returns as `t0`.
3. Issue Redis command `BGSAVE`. Expect either `Background saving started` or, if a save is already in flight, `Background save already in progress` — both are non-error.
4. Poll Redis every 1 second (default 300 sec total budget; configurable via `--bgsave-timeout` per Design §5.1) until ALL of the following predicates hold simultaneously in a single polling tick:
   - `LASTSAVE` returns an integer strictly greater than `t0` (the saved-snapshot timestamp has advanced).
   - `INFO persistence` field `rdb_bgsave_in_progress` equals `0` (no fork is still writing).
   - `INFO persistence` field `rdb_last_bgsave_status` equals `ok` (the last save succeeded; any other value, including `err`, is a hard failure — abort backup with the value reported).
   If the timeout expires before all three predicates hold, abort backup and report the last observed values for diagnostics.
5. Capture version metadata per **Version Detection Strategy** below.
6. Use a read-only Alpine sidecar mounted against `falkordb-data` to copy `dump.rdb` to the staging area.
7. SHA-256 the copied file; write version metadata into the store's section of `manifest.json`.

### Version Detection Strategy (empirically verified)

An investigative spike was run against our pinned `falkordb/falkordb:v4.4.1` image (container `pk-mcp-falkordb`) on 2026-04-23. Findings:

**`INFO server` observed output (relevant fields):**
```
redis_version:7.2.4
redis_mode:standalone
...
```
`INFO server` does **not** expose any `falkordb_version` field. The earlier draft's hedge was correct — it is not present.

**`MODULE LIST` observed output (one entry, flattened RESP array):**
```
name
graph
ver
40401
path
/FalkorDB/bin/src/falkordb.so
args
MAX_QUEUED_QUERIES
25
TIMEOUT
1000
RESULTSET_SIZE
10000
```
The `ver` field is a **packed integer** using the conventional Redis module encoding `MAJOR * 10000 + MINOR * 100 + PATCH`. `40401` decodes to `4.4.1`, which matches the pinned image tag. This is machine-parseable and stable.

**`INFO modules` observed output (Redis 7+ only):**
```
# Modules
module:name=graph,ver=40401,api=1,filters=0,usedby=[],using=[],options=[]
```
Same `ver=40401` encoding. Redundant with `MODULE LIST` but easier to regex-parse.

**`GRAPH.CONFIG GET *`** does not surface a version; only operational tunables (timeouts, thread counts, etc.). Not useful for version detection.

**Chosen strategy:**

- **Primary**: Issue `MODULE LIST`, locate the entry with `name == "graph"`, read its `ver` field, decode `MAJOR.MINOR.PATCH` from the packed integer.
- **Fallback**: If `MODULE LIST` returns an empty array or no `graph` entry (corrupt/misconfigured install), parse `INFO modules` for a line matching `module:name=graph,ver=(\d+)`. Same decode.
- **Second fallback**: If neither surfaces a version (very old FalkorDB or non-standard build), refuse to create the backup with an instructive error. Do **not** silently record `"unknown"` — a backup whose version cannot be determined cannot be safely gated on restore.
- **`redis_version`** (from `INFO server`) is captured alongside for diagnostics and RDB-format compatibility gating (see below) but is not the primary version signal for major/minor compat checks; RDB format is tied to Redis major.

**Parsing shape (pseudocode):**

```
function detectFalkorDbVersion(client):
    modules = client.sendCommand(["MODULE", "LIST"])         // RESP array of arrays
    graphEntry = modules.find(m => readField(m, "name") == "graph")
    if graphEntry:
        packed = int(readField(graphEntry, "ver"))            // e.g., 40401
        return { major: packed / 10000,
                 minor: (packed / 100) % 100,
                 patch: packed % 100,
                 raw:   packed }
    // Fallback
    infoModules = client.sendCommand(["INFO", "modules"])
    match = regex(/module:name=graph,ver=(\d+)/).exec(infoModules)
    if match:
        packed = int(match[1])
        return decodePacked(packed)
    throw new Error("FalkorDB version could not be detected; refusing backup")
```

**Manifest schema update** (supersedes the §3.2 note in the design doc):

```json
"falkordb": {
  "image": "falkordb/falkordb:v4.4.1",
  "moduleVersion": { "major": 4, "minor": 4, "patch": 1, "raw": 40401 },
  "redisVersion": "7.2.4",
  "rdbFormat": 11,
  "sha256": "..."
}
```

**Restore-time compatibility gate:**

- Same `moduleVersion.major`: proceed (warn on minor drift unless `--allow-minor-drift`).
- Different `moduleVersion.major`: refuse; direct to logical-export fallback.
- Different `redisVersion` major (e.g., 6.x -> 7.x): refuse even if module majors match — RDB format ver 9 vs 11 is not guaranteed forward-compatible and almost never backward-compatible. Direct to logical-export fallback.
- Missing `moduleVersion` in a legacy archive: refuse and instruct the user to take a fresh backup from the source machine, or use logical export.

**Minimum FalkorDB version supported for backup:** **v4.0.0** (packed `40000`). Earlier versions predate our project's adoption (ADR-0004) and are not tested. This floor is enforced at backup time, not just restore time, so archives produced by this tool are guaranteed to carry module version metadata in the packed-integer form.

**RDB format observation:** The produced `dump.rdb` begins with magic bytes `REDIS0011` (RDB format version 11), which is the Redis 7.x format. This is consistent across Redis 7.x minor versions, so restoring from 7.2.x into 7.2.y is safe. A Redis major-version bump in the FalkorDB base image (e.g., to Redis 8) would change this and is the motivating case for the `redisVersion` major gate above.

### Primary restore flow

1. Read `manifest.json`; extract `falkordb.image` and `falkordb.sha256`.
2. Verify SHA-256 of the embedded `dump.rdb`.
3. Compare manifest's FalkorDB version to the running container's version.
   - Same minor, same major: proceed.
   - Different minor, same major: warn, proceed (config flag `--allow-minor-drift`).
   - Different major: **refuse**. Direct user to logical-export fallback.
4. Stop the FalkorDB container.
5. Clear volume (mirror `restore-chromadb.sh` pattern).
6. Copy `dump.rdb` into the volume via Alpine sidecar.
7. Start container. FalkorDB loads `dump.rdb` automatically on boot.
8. Health-check (PING via `redis-cli`) until responsive; run a smoke query (`GRAPH.QUERY knowledge_graph "MATCH (n) RETURN count(n) LIMIT 1"`).

### Logical-export fallback (escape hatch)

For major-version migration scenarios, provide `pk-mcp graph export --format=cypher` and `pk-mcp graph import --format=cypher` commands. These walk the graph via the existing `FalkorDBAdapter` and emit replayable Cypher. Not included in the default migration bundle to keep V1 scope contained.

### Positive Consequences

- Fast, reliable, online backups of the knowledge graph
- Single-file output slots into the migration archive cleanly
- Zero new dependencies
- Restore matches the existing ChromaDB restore idiom, reducing cognitive load

### Negative Consequences

- Cross-major-version migration requires a separate tool that does not exist yet; users are on notice
- `BGSAVE` fork can transiently double memory usage on a hot instance
- No point-in-time recovery; only snapshot-in-time (acceptable for a personal knowledgebase)
- The RDB format is tied to the Redis major embedded in the FalkorDB image. A future FalkorDB release that bumps its Redis base from 7.x to 8.x will invalidate the simple "same FalkorDB major = restore" rule. Version gate now checks Redis major as well as FalkorDB module major; restore across a Redis major boundary is refused and routed to logical export. This is a known forward-looking constraint, not a current problem (v4.4.1 ships Redis 7.2.4).

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| `BGSAVE` fails silently (disk full, permissions) | Poll `LASTSAVE` with timeout; on no advance, check `INFO persistence` for `rdb_last_bgsave_status` and fail loudly |
| Memory fork OOM on constrained hosts | Document memory requirement; offer `--use-save` flag that blocks writes but avoids fork (TODO: decide whether to expose) |
| RDB file size grows unexpectedly | Capture `INFO memory` and `used_memory_rss` in manifest for diagnostics |
| User restores onto newer FalkorDB major | Manifest comparison halts restore with explicit error and points to logical export |
| User restores across a Redis major boundary (RDB format shift) | `redisVersion` major gate refuses; user routes through logical export |
| `MODULE LIST` returns unexpected shape on future FalkorDB release | Parser reads by field name (`name`, `ver`), not by positional index — resilient to field additions. Fallback to `INFO modules` regex if schema changes drastically |
| Vector index data (if/when FalkorDB vector indexes are adopted) not captured by RDB | TODO: Validate that all FalkorDB index types are RDB-persisted; they are at 4.x, but confirm before GA |

## Implementation Notes

- Wrapper scripts: `scripts/backup-falkordb.sh` and `scripts/backup-falkordb.ps1`, sibling to the existing ChromaDB scripts. Must share the same flags (`--backup-dir`, `--retention`, `--volume`, `--dry-run`, `--quiet`).
- FalkorDB password is sourced from `FALKORDB_PASSWORD` (same env var as `docker-compose.yml`).
- Timeout for `BGSAVE` completion should default to 300s; configurable via `--bgsave-timeout`.
- Polling interval of 1s balances responsiveness against server load.
- TODO: Decide whether to fsync before copy (extra paranoia) or trust BGSAVE's own fsync behavior.
- TODO: Enumerate and validate capture of all FalkorDB graph databases (`GRAPH.LIST` + `dump.rdb` is global, so this is implicitly handled — confirm).
- Version-detection spike results (2026-04-23): ran `MODULE LIST`, `INFO server`, `INFO modules`, and `GRAPH.CONFIG GET *` against the pinned `v4.4.1` image. `MODULE LIST` reliably returns a packed integer `ver=40401` for the graph module; `INFO server` does **not** expose a FalkorDB-specific version. `INFO modules` (Redis 7+) provides a regex-parseable mirror. Strategy settled: `MODULE LIST` primary, `INFO modules` fallback, hard refuse if neither surfaces a version. Minimum supported FalkorDB version: v4.0.0.

## Links

- [ADR-0004: Graph Database Migration from Neo4j to FalkorDB](0004-graph-database-migration-neo4j-to-falkordb.md)
- [ADR-0005: Cross-Machine Migration Archive Format](0005-cross-machine-migration-archive-format.md)
- [ADR-0007: Cross-Store Consistency Model](0007-cross-store-consistency-model.md)
- [FalkorDB Persistence Docs](https://docs.falkordb.com/admin/persistence.html)
- [Redis RDB Persistence](https://redis.io/docs/management/persistence/#rdb-advantages)
- `scripts/backup-chromadb.sh` — pattern to mirror

## Validation Criteria

- Backup completes in <30s for a graph of 100k nodes + 1M relationships on reference hardware
- Restore on a fresh host with the same FalkorDB image produces a graph with identical node/relationship counts and a working smoke query
- Major-version mismatch is detected and restore is refused with a helpful message
- No write-path disruption observable to a parallel MCP client during backup
