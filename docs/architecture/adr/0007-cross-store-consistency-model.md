# ADR-0007: Cross-Store Consistency Model for Migration

**Status:** Proposed (revised after feasibility audit)

**Date:** 2026-04-23

**Deciders:** Architecture Team

**Technical Story:** Migration spans three independent stores (ChromaDB, FalkorDB, `repositories.json`). Without a defined consistency model, a backup taken while writes are in flight can produce a bundle where, e.g., the graph references chunks the vector store doesn't have. See [DB-Migration-Design.md](../DB-Migration-Design.md).

**Revision Notes:** The original version of this ADR asserted that the ingestion pipeline writes through two CLI entry points (`update-all-command.ts`, `index-command.ts`) and that a single advisory-lock check at that boundary would suffice. The feasibility audit (`docs/architecture/DB-Migration-Implementation-Notes.md` §2.1) demonstrated that the real writer surface is substantially larger — it spans at least a dozen CLI commands, the folder watcher driven by chokidar, the MCP HTTP/SSE and stdio tool handlers, and out-of-process MCP server writes that the CLI cannot see. This revision replaces the "single-chokepoint lock" approach with a **per-adapter gate** model (see §Decision Outcome), and preserves the original multi-option analysis for reference.

## Context and Problem Statement

ChromaDB, FalkorDB, and `repositories.json` are updated by the ingestion pipeline roughly in sequence (see ADR-0002 for the dual-write path: ChromaDB first, then graph, then metadata). They are **not transactional** with each other. If a backup snapshots them at arbitrary moments during an ingest or update, the restored state can be internally inconsistent:

- A chunk exists in ChromaDB but no graph node references it (chunk was indexed just before snapshot, graph write hadn't happened yet)
- `repositories.json` shows a newer `lastIndexedCommitSha` than what ChromaDB actually contains
- Graph references a file that ChromaDB has already deleted during a remove operation

For a personal knowledge system, mild inconsistency is tolerable (stale results, not corrupted ones), but users migrating to a new machine reasonably expect their restored system to be at least as coherent as the source was.

## The Real Writer Surface (Audit Result)

Migration cannot be correct without understanding which processes and code paths may write to the three stores while a backup is running. The audit confirmed the following:

### Writer-producing processes

| Process | Lifetime | Can write? | Visibility to a CLI `backup` process |
|---------|----------|------------|--------------------------------------|
| `pk-mcp` CLI command (one-shot, e.g. `index`, `update-all`) | Seconds to minutes | Yes | Out-of-process unless the CLI user serializes calls |
| `pk-mcp` MCP server via stdio (Claude Code) | Long-lived, attached to IDE | Yes (via `trigger_incremental_update`) | Out-of-process |
| `pk-mcp` MCP server via HTTP/SSE | Long-lived daemon | Yes (via `trigger_incremental_update` and any future write tools) | Out-of-process |
| MCP server's `FolderWatcherService` + `ProcessingQueue` | Runs inside MCP server process | Yes (background, no CLI user in the loop) | Out-of-process |
| `pk-mcp watch` CLI subcommand variants | Short or long | Yes | Same as their host CLI |

### Writer-producing code paths (where writes originate)

- **CLI commands:** `index-command.ts`, `update-all-command.ts`, `update-repository-command.ts`, `documents-index-command.ts`, `watch-command.ts` (add / rescan), `remove-command.ts`, `reset-update-command.ts`, `migrate-extensions-command.ts`, `graph-populate-command.ts`, `graph-populate-all-command.ts`, `graph-transfer-command.ts`, `graph-migrate-command.ts`
- **Services:** `IngestionService.indexRepository / reindexRepository / removeRepository`, `IncrementalUpdateCoordinator.updateRepository`, `IncrementalUpdatePipeline.processChanges`, `FolderWatcherService` (emits events), `ProcessingQueue` (dispatches batches), `FolderDocumentIndexingService.handleDetectedChange`, `GraphIngestionService.ingestFiles / deleteRepositoryData / deleteFileData`
- **MCP tool handlers:** `trigger_incremental_update` in `src/mcp/tools/`
- **Metadata stores:** `RepositoryMetadataStoreImpl.updateRepository / removeRepository` (writes `repositories.json`), `WatchedFolderStoreService.addFolder / updateFolder / removeFolder` (writes `watched-folders.json`)

### The three actual bytes-on-wire write surfaces

Despite the sprawling set of callers, every write that matters for migration consistency funnels through exactly one of three low-level writers:

1. **ChromaDB client** — `ChromaStorageClient.addDocuments / upsertDocuments / deleteDocuments / createCollection / deleteCollection / deleteDocumentsByFilePrefix`
2. **Graph storage adapter** — `GraphStorageAdapter.runQuery` (write Cypher) and any raw-command execution used by graph ingestion
3. **Repository metadata store** — `RepositoryMetadataStoreImpl.updateRepository / removeRepository` (and `WatchedFolderStoreService` for the watched-folders file)

This observation — that there are many callers but only three **adapters** that actually mutate persistent state — is the pivot that makes a coordinated quiesce tractable.

### Existing write-safety mechanism today

The repo today relies on a **per-repository** `updateInProgress` flag stored in `repositories.json`, plus an in-memory `_isIndexing` boolean in `IngestionService`. Neither is a global mutex. Neither is visible across processes. Neither covers the watcher path, MCP server writes, or `graph-populate*` commands.

## Decision Drivers

- **Simplicity**: We are not building a distributed transaction coordinator
- **Low user friction**: Backup should be a one-command operation
- **Acceptable consistency**: Restored state should be "as good as" the source at some recent wall-clock point
- **Correctness**: Restore must never leave the system in a worse state than a fresh re-index would produce
- **Performance**: Quiesce windows should be short (seconds, not minutes)
- **Observability**: User should know whether the backup was taken cleanly or while writes were active
- **Cross-process coordination**: The lock must work when the CLI, the MCP stdio server, and the MCP HTTP server are distinct OS processes
- **Implementability with bounded refactor**: Per the V1 scope, we cannot afford a top-to-bottom writer-path rewrite

## Considered Options

### Option 1: Stop-the-World Quiesce (Hard Consistency)

**Description:** Before backup, pause all ingestion and the MCP server process. Wait for any in-flight writes to drain. Take snapshots of all three stores. Resume.

**Pros:**
- Strong guarantee of cross-store consistency
- Mental model matches SQL dump conventions
- Simplest restore reasoning — the backup is a valid application state

**Cons:**
- Requires the ability to pause the MCP server, which runs on the host (not in a container the backup tool controls)
- Windows of unavailability for potentially minutes on a large ingest
- Users running the MCP server attached to an IDE would notice outages

### Option 2: Eventually-Consistent Snapshot with Reconciliation on Restore

**Description:** Take all three snapshots concurrently without quiescing. On restore, run a reconciliation pass:
- Drop graph nodes referencing chunks not present in ChromaDB
- Mark affected repositories in `repositories.json` as `status: "degraded"` to trigger a re-scan
- Log all reconciliation actions

**Pros:**
- Zero downtime during backup
- Handles all inconsistency modes

**Cons:**
- Reconciliation logic is nontrivial and error-prone to test
- Silently "fixing" data is risky — user may not realize they lost fidelity
- Adds restore-time complexity every user pays for, even when the backup was taken cleanly

### Option 3: Single-Chokepoint Refactor + Advisory Lock (Original Recommendation)

**Description:** Refactor all writer paths so they route through a single `WriteCoordinator` (or the existing `IngestionService` expanded to own all writes). The coordinator checks the advisory lock before admitting work.

**Pros:**
- One place to enforce the invariant
- Cleanest mental model for future contributors
- Also useful for rate limiting, telemetry, and backpressure

**Cons:**
- Large refactor surface across `FolderWatcherService`, every CLI command that writes, every MCP tool handler, and the graph ingestion service
- Requires changes in every single out-of-process writer since a single in-memory coordinator does not span processes
- Doesn't actually help across the CLI / MCP-stdio / MCP-HTTP process boundary without also adding a file-based lock — you end up building both the coordinator and the lock
- Non-trivial merge conflict risk for parallel feature work
- Under-sized in the original ADR

### Option 4: Per-Entry-Point Gate (Per-Path Lock Check)

**Description:** Teach every writer entry point (every CLI command, every MCP tool handler, the folder watcher dispatch) to consult the advisory lock before doing work.

**Pros:**
- No architectural refactor
- Each entry point is a small, independent change

**Cons:**
- N places to remember; easy to miss one in a future PR
- Test matrix explodes: per entry point × lock-held vs. not × stale-lock scenarios
- Hard to guarantee "every writer respects the lock" by construction; relies on reviewer vigilance
- Exactly the anti-pattern the audit flagged

### Option 5: Per-Adapter Gate (Thin Check at Storage-Adapter Boundary) — **RECOMMENDED**

**Description:** Add a `MigrationLockGate` that is consulted inside the three low-level adapters at every mutation entry point:
- `ChromaStorageClient` (in our `chroma-client.ts` wrapper, not the vendor library) checks the gate before every `addDocuments`, `upsertDocuments`, `deleteDocuments`, `createCollection`, `deleteCollection`, `deleteDocumentsByFilePrefix`.
- `GraphStorageAdapter` checks the gate before every write Cypher query (`runQuery` with write intent) and any raw Redis write command.
- `RepositoryMetadataStoreImpl` checks the gate before every `updateRepository` and `removeRepository`.
- (`WatchedFolderStoreService` likewise, for completeness, before its three write methods.)

The gate is a process-singleton that reads `data/.migration.lock` on each write attempt (cached with short TTL to avoid per-write stat overhead). When the lock is held by another process and has not expired, write attempts raise `MigrationQuiesceError` which upstream callers (CLI commands, MCP tool handlers, the ProcessingQueue batch runner) handle by deferring work, retrying with backoff, or surfacing a clear error message.

**Pros:**
- **Writer coverage is complete by construction.** If it doesn't go through one of the three adapters, it doesn't touch persistent state. New writers added in future features automatically inherit the gate.
- **Cross-process safe.** The lock file is the coordination primitive; every process that loads the adapter sees it.
- **Small, well-bounded change surface.** Three adapters × a handful of write methods each = roughly 10–15 method call-sites instrumented, plus one gate module.
- **Test matrix is linear in adapter count, not in caller count.** Three adapters to test under lock-held / not-held / stale-lock, vs. a dozen entry points.
- **Failure mode is local and legible.** Callers see a specific `MigrationQuiesceError` rather than silent drift.
- **Minimally invasive to the folder-watcher / processing-queue path.** They keep enqueuing and dispatching work; the batch processor either defers or surfaces a quiesce error that the queue's existing retry mechanism handles.

**Cons:**
- Still requires callers to handle the error sensibly (defer-and-retry vs. abort). Mitigated by a small set of caller-side helpers.
- The per-write lock check cost is nonzero; mitigated by in-process TTL cache (e.g., re-read the lock file at most every 500ms; see §Implementation).
- Does not protect against someone bypassing our adapter layer and writing directly to ChromaDB or FalkorDB (e.g., running `redis-cli` manually). Documented as a boundary of the consistency envelope, same as before.

### Option 6: Snapshot-Then-Accept-Drift (Plus a Restore-Time Reconciliation Pass)

**Description:** Don't quiesce at all. Take the snapshots in a defined order that minimizes drift (metadata last). On restore, run the same reconciliation pass as Option 2 to catch the fact that ChromaDB and FalkorDB may have been snapshotted seconds apart.

**Pros:** Zero-downtime backup. Trivial to implement on the backup side.

**Cons:** Reconciliation cost is paid by every user on every restore, even when the source was idle. Same silent-repair risk as Option 2. Rejected.

## Decision Outcome

**Chosen option: Option 5 — Per-Adapter Gate at the ChromaDB / Graph / Metadata storage-adapter boundary.**

Rationale:

1. **Correctness by construction.** Writes cannot reach persistent state without passing through one of the three adapters. Gating at that boundary makes full writer coverage a property of the architecture rather than a property of reviewer diligence.
2. **Bounded refactor scope.** Three adapter files instrumented, plus a new `src/services/migration/migration-lock.ts` module. Acceptable for V1.
3. **Cross-process by default.** The gate uses a file-based advisory lock (`data/.migration.lock`), so it spans the CLI, the MCP stdio server, the MCP HTTP server, and the folder-watcher regardless of which process they run in.
4. **IDE-friendly.** Reads continue to flow through `ChromaStorageClient.similaritySearch` and `GraphStorageAdapter.runQuery` (read intent) unimpeded. The quiesce window is write-only.
5. **Observable.** `MigrationQuiesceError` gives operators and users a specific, actionable signal, rather than silent stalling.

### Advisory lock design

- **Location**: `data/.migration.lock` (JSON file) — sits beside `repositories.json`. The lock protects the whole single-instance scope (see also ADR-0008 on the data-root layout).
- **Contents**:
  ```json
  {
    "heldBy": { "pid": 12345, "hostname": "dev-laptop", "command": "pk-mcp migrate export" },
    "operation": "backup" | "restore",
    "acquiredAt": "2026-04-23T14:23:05Z",
    "expiresAt": "2026-04-23T14:33:05Z",
    "lockVersion": 1
  }
  ```
- **Acquisition**: `fs.open(path, 'wx')` (O_CREAT | O_EXCL). If the file already exists, check `expiresAt`:
  - If in the future: reject acquisition; caller either waits (bounded) or aborts with a clear message.
  - If in the past: treat as stale; re-acquire via atomic rename of a new lock file into place (keeps the wx semantics).
- **Heartbeat**: Backup tool extends `expiresAt` at 80% of TTL. Default TTL is 10 minutes; configurable via `--bgsave-timeout` and related flags.
- **Release**: Trap handler removes the lock on any process exit (success, failure, signal). The stale-expiry check is the second line of defense for SIGKILL.
- **Clock-skew guardrail**: Expiry is computed against the lock file's `mtime` (monotonic on the local filesystem) rather than against a remote clock, avoiding issues when the restore host's wall clock differs from the source.

### The `MigrationLockGate` and per-adapter wiring

- **Module**: `src/services/migration/migration-lock-gate.ts`. Exposes:
  - `assertWritesAllowed(): void` — throws `MigrationQuiesceError` if the lock is held by another process.
  - `probeLockState(): LockState` — non-throwing, returns `{ held, heldByCurrentProcess, expiresAt, operation }`.
  - In-process cache with TTL (default 500ms) to keep per-write overhead under 1µs in the steady state.
- **Integration points** (V1):
  1. `ChromaStorageClient` in `src/storage/chroma-client.ts` — wrap the six mutating methods listed above.
  2. `GraphStorageAdapter` in `src/graph/adapters/FalkorDBAdapter.ts` — gate write queries and any `BGSAVE`-adjacent mutations that aren't the backup itself.
  3. `RepositoryMetadataStoreImpl.updateRepository / removeRepository` in `src/repositories/metadata-store.ts`.
  4. `WatchedFolderStoreService.addFolder / updateFolder / removeFolder` in `src/services/watched-folder-store.ts`.
- **Self-exception**: Writes originating from the migration tool itself (restore path, which is the sole writer at the time) pass a process-local "owner" token that the gate recognizes via `heldByCurrentProcess`. This avoids the backup/restore process deadlocking against its own gate.

### Caller-side error handling

Callers cannot assume writes succeed. Three patterns by caller type:

- **Synchronous CLI commands** (`index`, `update-all`, `update-repository`, `remove`, `documents-index`, `graph-populate*`, `migrate-extensions`): on `MigrationQuiesceError`, abort with a user-visible message ("a backup/restore is in progress; try again in a few seconds") and a non-zero exit code. Simple and predictable for scripted use.
- **Background batch processors** (`ProcessingQueue`, `FolderDocumentIndexingService`): on `MigrationQuiesceError`, leave the batch in the retry queue and sleep for the lock's remaining TTL (bounded by the queue's existing retry logic). This preserves watcher-detected changes across the quiesce window instead of dropping them.
- **MCP tool handlers** (`trigger_incremental_update`): on `MigrationQuiesceError`, return a structured error (`quiesce_in_progress`) to the client with a `retry_after_seconds` hint. Claude Code and other MCP clients can surface this to the user.

### Snapshot order within the quiesce window

Unchanged from the prior ADR version:

1. Flush `repositories.json` to disk (already sync-written; belt-and-suspenders `fsync`).
2. Trigger FalkorDB `BGSAVE` (non-blocking; starts first because it runs asynchronously on the server).
3. Tar ChromaDB volume (blocking, via Alpine sidecar with read-only mount).
4. Poll FalkorDB `LASTSAVE` + `INFO persistence` (`rdb_bgsave_in_progress == 0` AND `rdb_last_bgsave_status == ok`) to confirm BGSAVE completed; copy the resulting `dump.rdb`.
5. Snapshot `repositories.json` and instance config (last — they're the "source of truth" pointer).

Putting `repositories.json` last ensures that if it references a repo commit, both the vector chunks and graph nodes for that commit are already captured in the archive.

### Restore semantics

- **Default: clobber** the target stores entirely with archive contents. Safest, most predictable.
- **Preflight checks** before any destructive action:
  - Advisory lock acquired
  - Target volume(s) exist or are creatable
  - Free disk space >= uncompressed archive size + 20% headroom
  - Versions are compatible (per ADR-0005 manifest + ADR-0006 major-version gate)
  - User confirmation prompt (suppressible with `--yes`) that lists what will be overwritten
- **Rollback-by-set-aside** (not filesystem-atomic — see §Note on "atomic" wording below):
  - Extract each store to a staging directory
  - Stop all three containers
  - **Set-aside pass**: for each Docker volume, create a second volume with a `-migration-setaside-<timestamp>` suffix and copy the existing data into it via an Alpine sidecar (`docker run --rm -v old:/from -v setaside:/to alpine cp -a /from/. /to/`). This is the only way to preserve the pre-restore state, because Docker named volumes have no native `rename` operation.
  - **Overwrite pass**: clear each live volume (`docker run --rm -v vol:/data alpine sh -c 'rm -rf /data/*'`) and copy the archive contents into it.
  - Start containers; health-check each.
  - On success: drop the set-aside volumes (or keep them if `--keep-set-aside` was passed for manual verification).
  - On any failure: clear the half-restored volumes and copy the set-aside back into place; start containers; fail loudly with the manifest attached for forensics.

### Note on "atomic" wording

Earlier revisions of this ADR described the cut-over as "atomic volume swap." That phrasing is misleading. Docker named volumes cannot be renamed atomically at the filesystem layer; there is no `docker volume rename` command, and the volumes are opaque to the host (typically backed by subdirectories of `/var/lib/docker/volumes/` that should not be moved directly). What the design actually provides is **rollback via a set-aside copy**: we copy the old data aside first, and on failure we restore from that copy. The user-visible guarantee is "either the new state is live, or the old state is live; we never leave a half-restored state." It is atomic from the user's perspective, not from the filesystem's.

The NFR of "2× disk space required during restore" is an honest consequence of this.

### Positive Consequences

- Cross-store consistency guaranteed under normal operation because no adapter accepts writes while the lock is held.
- Read availability preserved during backup.
- Single coordination primitive (`data/.migration.lock`) that spans processes and can serve future needs (vacuum, schema migration).
- Restore rollback path prevents half-restored disasters.
- New writers added in future features inherit quiesce coverage automatically as long as they go through the adapter layer (which is enforced by the storage/type system).

### Negative Consequences

- Three adapter files need modification. Small per file, but the change must be reviewed carefully for regressions in existing test coverage.
- Users running external tools that write directly to ChromaDB or FalkorDB (e.g., `redis-cli` sessions) are outside the consistency envelope. Documented limitation.
- Rollback-by-set-aside requires temporarily 2× disk space for volume data during restore.
- The CLI command paths that currently just swallow ingestion errors must now distinguish `MigrationQuiesceError` from generic storage errors to produce the right user message.

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| A future adapter method is added without gate instrumentation | Unit test per adapter enumerates every exported mutating method and asserts it invokes the gate. Lint rule (`eslint-plugin-custom-rules`) can enforce if needed. |
| Backup tool crashes mid-run leaving lock held | Trap handler releases lock on any exit; stale-lock expiry via `mtime` is a second line of defense. |
| Restore rollback fails mid-flight | Set-aside volumes are retained until explicit cleanup; log aggressively; leave the set-aside data in place for manual recovery even after tool exits. Partial-restore crash detection marker file on startup of the next `migrate import` lets the user resume or abandon. |
| Clock skew between source and destination invalidates `expiresAt` comparisons | Expiry is computed against local `mtime` rather than wall clock on restore hosts. |
| Folder watcher dispatches during quiesce and drops events | `ProcessingQueue` is the backpressure boundary; on `MigrationQuiesceError` the batch stays in the queue and is retried after the lock is released. No data loss; a small latency spike during backup. |
| MCP client sees sudden errors during backup | Structured `quiesce_in_progress` error with `retry_after_seconds` hint; Claude Code can retry transparently. Documented in the MCP tool contract. |
| Per-write gate check becomes a hot path | 500ms in-process TTL cache keeps steady-state cost negligible; re-validated on any gate miss. |

## Implementation Notes

- `MigrationLockGate` must be acquired before any Docker commands or file reads in the backup/restore orchestrator.
- Lock file is written with `O_CREAT | O_EXCL` semantics (`fs.open(path, 'wx')`) to prevent races.
- The gate is a singleton initialized by `dependency-init.ts` so the CLI, the MCP stdio server, and the MCP HTTP server all share the same implementation behavior (different process instances share the same file-based signal).
- TODO: Decide whether to pause the MCP HTTP/SSE transport during *restore* (definitely yes — containers are stopped). During *backup*, reads must continue (HTTP transport stays up).
- TODO: Specify behavior when an in-flight ingestion is past the quiesce wait timeout — abort backup with clear message (recommended), or force-cancel the ingestion (harsher, not recommended for V1).

## Links

- [ADR-0001: Incremental Update Trigger Strategy](0001-incremental-update-trigger-strategy.md) — writer-side entry points (historical)
- [ADR-0002: Knowledge Graph Architecture](0002-knowledge-graph-architecture.md) — dual-write pattern
- [ADR-0005: Cross-Machine Migration Archive Format](0005-cross-machine-migration-archive-format.md)
- [ADR-0006: FalkorDB Backup Strategy](0006-falkordb-backup-strategy.md)
- [ADR-0008: `repositories.json` Path Model](0008-repositories-json-path-model.md) — data-root and cross-OS portability
- [DB-Migration-Design.md](../DB-Migration-Design.md)
- [DB-Migration-Implementation-Notes.md](../DB-Migration-Implementation-Notes.md) — feasibility audit that drove this revision

## Validation Criteria

- Every `ChromaStorageClient` mutating method invokes `assertWritesAllowed` before issuing the underlying Chroma call (verified by unit test).
- Every `GraphStorageAdapter` write method invokes `assertWritesAllowed` before issuing the underlying Redis/Cypher call (verified by unit test).
- `RepositoryMetadataStoreImpl.updateRepository` and `removeRepository` invoke `assertWritesAllowed` before touching the file (verified by unit test).
- An ingest operation kicked off during a backup either defers (queue path) or aborts with a `MigrationQuiesceError` (CLI / MCP path); no writes land during the quiesce window.
- Backup archive restored on a clean host produces a system that passes existing integration tests.
- Restore with a simulated mid-flight failure successfully rolls back to pre-restore state via the set-aside copy.
- Lock held by a crashed backup process does not permanently block ingestion (expiry + stale-lock detection work).
- A new adapter method added without gate instrumentation fails the adapter-coverage unit test.
