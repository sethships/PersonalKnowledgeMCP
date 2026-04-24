# Cross-Machine Database Migration — Technical Design

**Status:** Proposed (V1 scope revised 2026-04-23 per feasibility audit)

**Date:** 2026-04-23

**Deciders:** Architecture Team

**Related ADRs:**
- [ADR-0005: Cross-Machine Migration Archive Format](adr/0005-cross-machine-migration-archive-format.md)
- [ADR-0006: FalkorDB Backup Strategy](adr/0006-falkordb-backup-strategy.md)
- [ADR-0007: Cross-Store Consistency Model](adr/0007-cross-store-consistency-model.md)
- [ADR-0008: `repositories.json` Path Model](adr/0008-repositories-json-path-model.md)

**Related Prior Art:**
- `scripts/backup-chromadb.sh` / `.ps1` / `restore-chromadb.*` — conventions to mirror
- ADR-0002 (dual-write to ChromaDB + graph)
- ADR-0004 (FalkorDB adoption)
- `docs/architecture/DB-Migration-Implementation-Notes.md` — engineer-side feasibility audit that drove the V1 scope revision

**V1 Scope Note (important):** This design was revised after a feasibility audit. **Multi-instance support, optional archive encryption, and the `--include-repos-source` flag are deferred out of V1.** V1 targets a single default-profile deployment. The multi-instance analysis is preserved under §12 "Post-V1 / Future" so the prior thinking is not lost. The cross-store consistency and path-flexibility mechanisms have been redesigned (see §6 and §7 respectively).

---

## 1. Purpose

Enable a user to take the full state of a Personal Knowledge MCP deployment — all indexed knowledge, all graph relationships, all repository metadata — and move it to another machine in one operation. This covers:

- New laptop / workstation provisioning
- Disaster recovery from a single archive
- Preparing snapshots for point-in-time debugging
- Cross-OS moves (Windows ↔ Linux ↔ macOS) with minimal reconfiguration

## 2. Scope

### In Scope (V1)

- Backup and restore of all three stores (ChromaDB vector data, FalkorDB graph, repository metadata) for the **single default-profile deployment**.
- Cross-platform CLI parity (Windows PowerShell and bash).
- **Cross-OS portability of the archive**: a Windows-produced archive restores on Linux and vice versa with at most a single documented reconfiguration step (see §7 and ADR-0008).
- Integrity verification (SHA-256 at archive and per-store levels).
- Version compatibility manifest and gating.
- Pre-flight disk/version checks; rollback-capable restore via the set-aside-and-restore pattern (see §6).
- Clobber-semantic restore only.

### Out of Scope (V1 — Deferred)

Moved to §12 "Post-V1 / Future" for preservation:

- **Multi-instance (Private/Work/Public) deployments.** Deferred because FalkorDB is not currently per-instance in the Docker Compose topology (see §12.1). V1 operates only on the default profile.
- **Optional passphrase encryption (`--encrypt`).** Users can wrap the output `.tar.gz` with `age` / `openssl` / `7z` themselves until the feature ships.
- **`--include-repos-source` flag.** Cross-OS portability landmines (symlinks, `.git/config` `[core] worktree`, CRLF handling). Deferred with a documented "tar the repos directory yourself" workaround.

### Out of Scope (V1 — Permanent for now)

- Kubernetes / PVC-based deployments — design acknowledges the path but V1 targets Docker.
- Merge-semantic restore (additive to existing state).
- Cross-major-version migration (e.g., ChromaDB 0.6 → 0.7) — users are prompted to run a fresh reindex.
- Cloud backup destinations (S3, OneDrive, etc.) — users move the file themselves.
- Differential / incremental backups.
- Automated scheduling (cron / Task Scheduler wiring) — users can wire the CLI into their own scheduler.

## 3. Component Overview

### 3.1 High-level context

```
                   +------------------------------------------+
                   |         pk-mcp CLI (migrate group)       |
                   |   (src/cli/commands/migrate-*.ts)        |
                   +----------+-----------------+-------------+
                              |                 |
              +---------------+                 +----------------+
              |                                                  |
              v                                                  v
   +----------+-----------+                      +---------------+---------------+
   | Migration Orchestrator|                     | Archive Reader / Writer       |
   | (coordinates snapshot, |<-------------------| (tar.gz, manifest, sha256)    |
   |  restore, lock gate)   |                    +-------------------------------+
   +----------+-------------+
              |
              | acquires advisory lock (data/.migration.lock)
              | invokes store adapters
              v
   +-------------------+    +---------------------+    +--------------------+
   | ChromaDB Backup   |    | FalkorDB Backup     |    | Metadata Snapshot  |
   | Adapter           |    | Adapter (BGSAVE +   |    | (repositories.json,|
   | (volume tar copy) |    |  volume rdb copy)   |    |  tokenized paths)  |
   +---------+---------+    +----------+----------+    +---------+----------+
             |                          |                        |
             v                          v                        v
      +---------------+          +----------------+        +------------+
      | Docker volume |          | Docker volume  |        | Local FS   |
      | chromadb-data |          | falkordb-data  |        | data/*     |
      +---------------+          +----------------+        +------------+
```

All three adapters follow a common interface so the orchestrator treats them uniformly:

```
interface StoreBackupAdapter {
  id(): StoreId;                                  // "chromadb" | "falkordb" | "repositories"
  preflight(ctx): Promise<void>;                  // verify ready to snapshot
  snapshot(stagingDir, ctx): Promise<StoreArtifactDescriptor>;
  restorePreflight(artifact, ctx): Promise<void>; // version/compat check
  restore(artifact, ctx): Promise<void>;          // into the target store
  rollback(ctx): Promise<void>;                   // revert mid-restore
}
```

### 3.2 Archive Layout

Per ADR-0005:

```
pk-mcp-migration-20260423-142305.tar.gz
  pk-mcp-migration/
    manifest.json
    README.txt
    stores/
      chromadb/
        chromadb-data.tar
        chromadb-data.sha256
      falkordb/
        dump.rdb
        dump.rdb.sha256
        falkordb-info.json       # redis_version, falkordb_version, graph list
      repositories/
        repositories.json        # paths tokenized per ADR-0008 (clone-managed)
                                 # + external-path entries with isExternalPath: true
        watched-folders.json     # Phase 6 watched folders (tiny; tokenized where applicable)
        instance-config.json     # secrets stripped per allowlist (see §8)
    signatures/
      manifest.json.sha256
+ pk-mcp-migration-20260423-142305.tar.gz.sha256  (sidecar)
```

Note: in V1 (single-instance), archive filenames drop the `-<instance>` suffix that was present in earlier drafts. The suffix returns if/when multi-instance lands post-V1.

`manifest.json` additions to support ADR-0008 Option D external paths:

```json
"repositories": {
  "pathFormat": "tokenized-v1",
  "count": 12,
  "externalPaths": [
    {
      "name": "my-local-research-corpus",
      "localPath": "D:\\research\\corpus",
      "externalPathOrigin": { "os": "win32", "sourceMachine": "kaiju-laptop" }
    }
  ]
}
```

The `externalPaths` array lets the restore tool surface prompts/warnings up-front without having to parse the full `repositories.json` first.

## 4. Data Flow

### 4.1 Backup sequence

```
User            CLI                Orchestrator        Adapters              Stores
 |               |                     |                   |                   |
 | migrate export|                     |                   |                   |
 |-------------->|                     |                   |                   |
 |               | init, parse flags   |                   |                   |
 |               |-------------------->|                   |                   |
 |               |                     | acquire lock      |                   |
 |               |                     |----> data/.migration.lock             |
 |               |                     |                   |                   |
 |               |                     | preflight (all)   |                   |
 |               |                     |------------------>|                   |
 |               |                     |                   | check docker, vol |
 |               |                     |                   | disk space, ver   |
 |               |                     |<------------------|                   |
 |               |                     |                   |                   |
 |               |                     | snapshot falkordb |                   |
 |               |                     |------------------>|                   |
 |               |                     |                   | BGSAVE (async)    |
 |               |                     |                   |------------------>|
 |               |                     | snapshot chromadb |                   |
 |               |                     |------------------>|                   |
 |               |                     |                   | tar volume        |
 |               |                     |                   |------------------>|
 |               |                     |                   | ChromaDB data     |
 |               |                     |                   |<------------------|
 |               |                     |                   | poll LASTSAVE     |
 |               |                     |                   | copy dump.rdb     |
 |               |                     |                   |<------------------|
 |               |                     |<------------------|                   |
 |               |                     |                   |                   |
 |               |                     | snapshot metadata |                   |
 |               |                     |------------------>|                   |
 |               |                     |                   | read repos.json,  |
 |               |                     |                   | tokenize paths,   |
 |               |                     |                   | strip secrets     |
 |               |                     |<------------------|                   |
 |               |                     |                   |                   |
 |               |                     | assemble manifest |                   |
 |               |                     | tar -czf staging  |                   |
 |               |                     | emit archive.sha  |                   |
 |               |                     | release lock      |                   |
 |               |<--------------------|                   |                   |
 | archive path  |                     |                   |                   |
 |<--------------|                     |                   |                   |
```

### 4.2 Restore sequence

```
User            CLI                Orchestrator        Adapters              Stores
 |               |                     |                   |                   |
 | migrate import archive.tar.gz       |                   |                   |
 |-------------->|                     |                   |                   |
 |               | verify envelope sha |                   |                   |
 |               | extract to staging  |                   |                   |
 |               |-------------------->|                   |                   |
 |               |                     | acquire lock      |                   |
 |               |                     | parse manifest    |                   |
 |               |                     | version check     |                   |
 |               |                     | disk space check  |                   |
 |               |                     | confirm with user |                   |
 |               |                     |                   |                   |
 |               |                     | stop containers   |                   |
 |               |                     |---------------------->| stop          |
 |               |                     |                   |                   |
 |               |                     | set-aside copy of pre-restore volumes |
 |               |                     |  (sidecar cp -a old -> setaside)      |
 |               |                     |                                       |
 |               |                     | clear live volumes + copy archive in  |
 |               |                     |------------------>|                   |
 |               |                     |                   | tar xzf into vol  |
 |               |                     |                   | copy dump.rdb     |
 |               |                     |                   | write repos.json  |
 |               |                     |                   | (paths resolved   |
 |               |                     |                   |  to target roots) |
 |               |                     |<------------------|                   |
 |               |                     |                                       |
 |               |                     | start containers                      |
 |               |                     |---------------------->| start         |
 |               |                     |                                       |
 |               |                     | health-check loop                     |
 |               |                     |---------------------->| heartbeat     |
 |               |                     |                                       |
 |               |                     | on success: drop set-aside (or keep   |
 |               |                     |              if --keep-set-aside)     |
 |               |                     | on failure: clear live + restore      |
 |               |                     |             from set-aside; fail loud |
 |               |                     | release lock                          |
 |               |<--------------------|                                       |
 | result        |                     |                                       |
 |<--------------|                     |                                       |
```

### 4.3 Failure mode → rollback matrix

| Failure point                | Action                                                                 |
|------------------------------|------------------------------------------------------------------------|
| Envelope SHA mismatch        | Abort before extraction; no side effects                               |
| Manifest version incompat    | Abort before stopping containers; exit with instructive message        |
| Disk space preflight fails   | Abort; suggest `--backup-dir` elsewhere                                |
| ChromaDB volume restore fail | Rollback: clear live, restore from set-aside; start containers         |
| FalkorDB load fails on start | Rollback ChromaDB + FalkorDB from set-aside; log manifest for forensics|
| `repositories.json` parse err| Rollback from set-aside; original JSON preserved                       |
| Post-restore healthcheck fail| Leave restored volumes in place; report; user can inspect and retry    |
| Process killed mid-restore   | On next `migrate import` start, detect incomplete-restore marker file; offer resume or abandon |

## 5. CLI Surface

Commands live under `src/cli/commands/migrate-export-command.ts` and `migrate-import-command.ts`, registered in `src/cli/index.ts` alongside existing `graph`, `token`, `watch` groups. Naming follows the PRD's `migrate` convention (per PRD §8.1):

```
pk-mcp migrate export  [options]
pk-mcp migrate import  <archive> [options]
pk-mcp migrate verify  <archive>
pk-mcp migrate inspect <archive>       # show manifest, sizes, versions
```

Note: a `migrate list` subcommand is deferred from V1. `ls backups/` covers the need.

### 5.1 `migrate export` options (V1)

| Flag | Default | Description |
|------|---------|-------------|
| `--output <path>` | `./backups` | Output directory |
| `--stores <list>` | `chromadb,falkordb,repositories` | Selective backup |
| `--bgsave-timeout <sec>` | `300` | Max wait for FalkorDB BGSAVE |
| `--quiesce-wait <sec>` | `60` | Max wait for in-flight ingestion to drain |
| `--no-verify` | `false` | Skip post-backup verification pass |
| `--dry-run` | `false` | Show plan; take no action |
| `--quiet` | `false` | Suppress progress output |

Flags deferred from V1 (moved to §12): `--instance`, `--include-repos-source`, `--encrypt`.

### 5.2 `migrate import` options (V1)

| Flag | Default | Description |
|------|---------|-------------|
| `--stores <list>` | all in manifest | Selective restore |
| `--yes` | `false` | Skip destructive-action confirmation |
| `--allow-minor-drift` | `false` | Accept minor version mismatches (per ADR-0006) |
| `--staging-dir <path>` | OS temp | Override staging location (disk-space workaround) |
| `--keep-set-aside` | `false` | Don't drop the set-aside copy on success (keep for manual verification) |

## 6. Cross-Store Consistency (Quiesce Model)

**Summary**: V1 uses a **per-adapter gate** that checks the advisory lock at every mutation entry point inside `ChromaStorageClient`, `GraphStorageAdapter`, and `RepositoryMetadataStoreImpl`. See [ADR-0007](adr/0007-cross-store-consistency-model.md) for the full analysis.

### Why not single-chokepoint?

The feasibility audit showed the actual writer surface includes a dozen CLI commands, the folder watcher, the MCP HTTP/SSE server, the MCP stdio server, the processing queue, and multiple graph-mutation commands — several of which run in distinct OS processes. A single in-process chokepoint cannot see across those process boundaries, and refactoring every entry point to call through one would be a substantially larger change than V1 warrants.

### Why per-adapter works

Despite the sprawling caller surface, every write that matters for migration consistency funnels through exactly three low-level adapters:

1. `ChromaStorageClient` — `addDocuments`, `upsertDocuments`, `deleteDocuments`, `createCollection`, `deleteCollection`, `deleteDocumentsByFilePrefix`
2. `GraphStorageAdapter` — write Cypher (`runQuery` with write intent) and any raw Redis write commands (non-BGSAVE)
3. `RepositoryMetadataStoreImpl` — `updateRepository`, `removeRepository` (plus `WatchedFolderStoreService` methods for `watched-folders.json`)

Instrumenting the three adapters provides **complete writer coverage by construction**: anything that doesn't go through one of them isn't a relevant write, and anything that does inherits quiesce semantics automatically — including future features.

### The `MigrationLockGate`

- **Location**: `src/services/migration/migration-lock-gate.ts` (new module).
- **Contract**:
  - `assertWritesAllowed(): void` — throws `MigrationQuiesceError` if the lock is held by another process.
  - `probeLockState(): LockState` — non-throwing, returns `{ held, heldByCurrentProcess, expiresAt, operation }`.
- **Lock file**: `data/.migration.lock` (JSON), acquired with `O_CREAT | O_EXCL` semantics, expiry tracked via `mtime` for clock-skew resilience.
- **In-process cache**: 500ms TTL to keep per-write overhead well under 1µs in the steady state.
- **Self-exception**: the migration tool's own writes (restore flow) carry a process-local owner token so they pass the gate.

### Caller-side error handling

- **Synchronous CLI commands** that hit a locked gate: abort with `"a backup or restore is in progress"` and non-zero exit code.
- **Background batch processors** (`ProcessingQueue`, `FolderDocumentIndexingService`): on `MigrationQuiesceError`, leave the batch in the retry queue and sleep for the lock's remaining TTL. Watcher-detected changes are preserved across the window, not dropped.
- **MCP tool handlers** (`trigger_incremental_update`): return a structured `quiesce_in_progress` error with a `retry_after_seconds` hint. Claude Code and other clients can retry.

### Snapshot order within the quiesce window

1. Flush `repositories.json` and `watched-folders.json` to disk (already sync-written; belt-and-suspenders `fsync`).
2. Trigger FalkorDB `BGSAVE` (non-blocking; starts first because it runs asynchronously on the server).
3. Tar ChromaDB volume (blocking, via Alpine sidecar with read-only mount).
4. Poll FalkorDB `LASTSAVE` **and** `INFO persistence` (`rdb_bgsave_in_progress == 0` and `rdb_last_bgsave_status == ok`) to confirm BGSAVE completed; copy the resulting `dump.rdb`. Capture the FalkorDB version per ADR-0006's empirically-verified `MODULE LIST` strategy (see §10).
5. Snapshot `repositories.json` (normalized per ADR-0008 — clone-managed tokenized, external flagged), `watched-folders.json` (tokenized where the path is under a known root; otherwise flagged as external, same rules as repositories), and instance config (last — they're the "source of truth" pointer).

## 7. Cross-OS Path Flexibility

**Summary**: `repositories.json` stores tokenized paths (`{{CLONE_ROOT}}/...`, `{{DATA_ROOT}}/...`) rather than absolute OS-native paths. See [ADR-0008](adr/0008-repositories-json-path-model.md) for the full analysis.

### Motivation

PRD v1.1 FR-1.9 requires that a Windows-produced archive restore on Linux (and vice versa) with at most a single documented re-configuration step. The current state stores `localPath` as absolute OS-native paths (e.g., `"C:\\src\\PersonalKnowledgeMCP\\data\\repositories\\..."`), which silently break on any cross-OS or cross-install-location restore.

### Mechanism (V1)

- **On write**, `RepositoryMetadataStoreImpl.updateRepository` tokenizes `localPath` against the configured data/clone roots before serializing. Stored form uses POSIX separators regardless of host OS:
  ```json
  { "localPath": "{{CLONE_ROOT}}/PersonalKnowledgeMCP" }
  ```
- **On read**, consumers (`RepositoryCloner`, `IncrementalUpdatePipeline`, `remove-command.ts`, recovery services) call `resolveRepositoryPath(stored, currentRoots)` which resolves the token against the current process's configured roots.
- **Configurable roots** (already present in codebase): `DATA_PATH` env (default `./data`), `CLONE_PATH` env (default `./data/repositories`). The tokenizer prefers the most-specific root.
- **Backward compatibility**: legacy absolute paths continue to load. On the next write, they are silently rewritten to tokenized form. No data migration step is required.
- **Archive tokenization**: the migration tool tokenizes `repositories.json` at snapshot assembly time, so produced archives are OS-neutral even when the source has legacy absolute paths.

### The "single documented re-configuration step" on the target machine

If the target machine uses the same default `DATA_PATH`/`CLONE_PATH` values, restoration is zero-config. If the target machine's data location differs from the source's, the user sets `DATA_PATH` (and optionally `CLONE_PATH`) in `.env` before running `migrate import`. That is the one reconfiguration step FR-1.9 permits — the tokens resolve against the target's environment automatically.

### Security boundary preserved

`remove-command.ts` already enforces that a repository's `localPath` lives under `CLONE_PATH` (path-escape protection). The tokenized model strengthens this: resolve first, then check the resolved path against the current `CLONE_PATH`.

### External local paths (ADR-0008 Option D — now in V1)

The codebase supports indexing against a local filesystem path outside the clone directory (see `isLocalPath` in `src/utils/path-utils.ts`). ADR-0008 Option D, promoted into V1 scope on 2026-04-23, defines how these entries survive cross-OS/cross-install restore:

- **On write**, the metadata store stamps entries whose `localPath` escapes every known root with `isExternalPath: true` and stores the path verbatim (OS-native separators preserved). An informational `externalPathOrigin: { os, sourceMachine }` is captured at ingestion time.
- **In the archive**, external entries are included; the archive manifest surfaces them in a `repositories.externalPaths` summary so the restore flow can act on them without parsing the full `repositories.json`. The *files* referenced by external paths are **not** bundled (V1 design philosophy — `--include-repos-source` remains deferred).
- **On restore**, for each external entry whose path does not exist on the target:
  - **Interactive (TTY)**: prompt the user to provide a new path, `skip` (retain entry with `pathStatus: "broken"`), or `remove` the entry.
  - **Non-interactive (`--yes` / no TTY)**: default to `skip` with a loud per-entry warning. Restore exit code is 0 (soft failure). Users repair later via a reserved `pk-mcp repo repath <name> <new-path>` subcommand.
  - **`--external-path-map <file>`**: JSON/YAML mapping of `{ name: newPath }`. Mapped entries are re-pointed without prompting; unmapped entries fall back to the interactive/non-interactive rules above.
- **Security posture**: external paths bypass the `remove-command.ts` "must be under `CLONE_PATH`" check by design. The restore-time prompt validates user-supplied re-point paths via `fs.realpath` and refuses `..` escapes. Malicious archives carrying suspicious external paths (e.g., `/etc`) are visible to the user in the prompt; automatic re-pointing is never performed.

This replaces the earlier "documented non-portable case" language. External paths are now a first-class concern of the migration tool in V1.

## 8. Security

- **Config sanitization uses an allowlist, not a blocklist.** Stakeholder decision 2026-04-23. Rationale: a blocklist silently leaks any future config field we forget to add to it; an allowlist defaults to "drop" so new fields are safe by construction and must be deliberately added to the archive.
- **Allowlisted fields from `instance-config.json`** (the only config file included in the archive):
  - Non-secret instance metadata: `instance.name`, `instance.tier` (future — currently single-profile), `instance.dataPath` (tokenized before serialization).
  - Storage endpoint *shapes* (not credentials): ChromaDB URL host/port, FalkorDB host/port. Credential fields (`chromadbAuthToken`, `falkordbPassword`, bearer `auth.tokens[*]`) are **never** in the allowlist.
  - Embedding-provider shape: provider name (`openai` / `transformers` / `ollama`), model identifier, endpoint (for Ollama). API keys (`openaiApiKey`) are **never** allowlisted.
  - Tuning knobs with no security sensitivity: chunk sizes, concurrency limits, retention counts.
- **`.env` is excluded wholesale.** It is not the source of the allowlist. `.env` contains secrets by design; the archive is not the vehicle for transporting them. Users re-populate `.env` on the target machine from their own secret management (password manager, vault, etc.). The archive's embedded `README.txt` spells this out.
- **Implementation shape (design-level only)**: a schema-driven filter enumerates allowed keys and emits a sanitized object; a test fails the build if an unknown key reaches the serializer (fail-closed). Writer never sees the raw config; it consumes the sanitized output.
- **Archive encryption is deferred out of V1.** Users wrap the output with `age` / `openssl` / `7z` themselves in the interim. Rationale: avoiding a crypto choice in V1 keeps the feature lean and shippable, and the archive is a single file, so wrapping is trivial.
- **Embeddings can leak proprietary content.** Archives are treated as sensitive by policy; the CLI warns users at creation time.
- **External-path entries** (ADR-0008 Option D) are not a secrets-stripping concern per se, but the restore-time prompt (see §7) acts as a human-in-the-loop check on paths carried in from a source archive.

## 9. Cross-Platform Implementation Notes

- TypeScript migration code in `src/services/migration/` is the source of truth. The `pk-mcp migrate` commands drive it. Legacy `scripts/backup-chromadb.*` scripts remain as a standalone escape hatch for ChromaDB-only backups but **do not coordinate across stores** — the README will clarify.
- Tar invocation via `child_process.spawn` (not shelling through bash) for Windows/Unix parity. Bun's `Bun.spawn` is suitable. Consider a Bun-native tar library (`tar-stream` / `node-tar`) if deterministic cross-platform output becomes a blocker — shelling out to GNU tar vs. bsdtar has known metadata-determinism gaps.
- Paths stored inside the tar are POSIX-style (`stores/chromadb/...`), regardless of host.
- Tar mode: `--format=ustar --sort=name --numeric-owner --owner=0 --group=0` when supported (GNU tar). On bsdtar (Windows native), `--format=ustar --uname= --gname=` achieves equivalent determinism. Wrapper normalizes.
- Line endings in `README.txt` inside the archive: LF only, to match the POSIX convention inside archives.
- **Validation criterion relaxed**: the "byte-identical archives across platforms" promise from the first draft is lowered to "integrity hashes verify end-to-end" — the envelope SHA is guaranteed on the producing host; per-store hashes verify on restore regardless of platform. Byte-identical cross-platform archives are a stretch goal, not a V1 requirement.

## 10. Version Compatibility

- **ChromaDB**: manifest captures the image tag in use at backup time (via `docker inspect pk-mcp-chromadb --format '{{.Config.Image}}'`). Restore compares to the target's running image. Same tag = pass. Minor mismatch = warn + proceed. Major mismatch = refuse (data format can shift at 0.x boundaries).
- **FalkorDB**: version detection strategy is now empirically verified (ADR-0006, 2026-04-23 spike against the pinned `v4.4.1` image). Manifest captures `moduleVersion` (major/minor/patch decoded from the packed `ver` integer in `MODULE LIST` — e.g., `40401` -> `4.4.1`), `redisVersion` (from `INFO server`), and `rdbFormat` (observed `11` for Redis 7.x). Same `moduleVersion.major` = pass (warn on minor drift). Different `moduleVersion.major` = refuse and route to the logical-export fallback. Different `redisVersion.major` = also refuse (RDB format boundary). Missing version fields on a legacy archive = refuse and instruct a fresh backup. Minimum supported FalkorDB version: v4.0.0.
- **Repository metadata**: `repositories.json` has its own `version` field (currently `"1.0"`). Post-ADR-0008 adds `pathFormat: "tokenized-v1"` and the `isExternalPath` per-record flag (Option D — now V1). Restore tolerates legacy (no `pathFormat`) archives and auto-normalizes on first write (tokenize under-root paths; flag outside-root paths external).
- **Tool version**: `source.pkMcpVersion` in manifest. Mismatch is informational, not gating — unless a breaking change flag in the tool's migration history table marks the source version as unsupported.

## 11. Kubernetes Path (Deferred — Acknowledged)

V1 does not solve K8s backup. The PVC at `kubernetes/base/mcp-service/pvc.yaml` plus the ChromaDB/FalkorDB PVCs (when they land) can be backed up via:

- **Velero** with volume snapshots — recommended. Works with any CSI driver that supports snapshots. Produces its own backup objects.
- **Sidecar pattern** — a job pod mounts the PVCs, invokes the same migration tool in CLI mode, uploads the resulting archive to object storage.

Either approach reuses the same manifest format and per-store adapters. The quiesce gate becomes a ConfigMap/annotation rather than a file, and the MCP service's adapters honor it the same way. **TODO: produce a K8s-specific design doc when K8s deployment is prioritized.**

A note on feasibility: the volume-mount-plus-sidecar pattern is fundamentally Docker-model; it does not translate cleanly to PVCs without either elevated privileges or Velero-style CSI snapshots. This bounds the "K8s path" more than a casual read of this section suggests.

## 12. Post-V1 / Future (Preserved Analysis)

These items were in the original V1 scope and are preserved here so the thinking isn't lost. None are in V1.

### 12.1 Multi-instance (Private / Work / Public)

**Why deferred**: FalkorDB is not per-instance in the current `docker-compose.yml`. ChromaDB has `chromadb`, `chromadb-private`, `chromadb-work`, `chromadb-public` services under the appropriate profiles; FalkorDB only has `falkordb` under `default` and `all`. `src/config/instance-config.ts` has a per-instance `chromadb` sub-object but no `falkordb`. Shipping per-instance migration while graph data is shared across instances would mean archives silently commingle graph content across security tiers — the exact anti-goal that motivated multi-instance in the first place.

**Prerequisites for post-V1 multi-instance migration**:
1. Add `falkordb-private`, `falkordb-work`, `falkordb-public` services to `docker-compose.yml` under the appropriate profiles, with separate `falkordb-data-*` volumes.
2. Extend `src/config/instance-config.ts`'s `InstanceConfig` to include a `falkordb` sub-object parallel to `chromadb`.
3. Extend `src/cli/utils/falkordb-config.ts` to resolve per-instance `FALKORDB_HOST`/`FALKORDB_PORT` rather than the current single-pair scheme.
4. Graph-level entities gain an instance-label property so `GRAPH.COPY` or logical export can separate by instance if needed.

**Preserved design elements** (for the future implementation):
- Archive filename suffix returns: `pk-mcp-migration-<ts>-<instance>.tar.gz`.
- `--instance <name>` flag scopes export to one profile.
- `--instance all` produces **separate archives per instance**, not a merged bundle (security tiers must never be comingled).
- Restore refuses to cross tiers unless `--force-instance` is supplied (reserved, noisy confirmation).
- Manifest `source.instance` field identifies the tier.
- Tokenization (ADR-0008) already supports per-instance data roots via `InstanceConfig.dataPath`, so no path-model change is needed when multi-instance lands.

### 12.2 Archive encryption (`--encrypt`)

**Why deferred**: Tool-choice question (age vs. openssl enc vs. Bun-native AES-256-GCM) is unresolved; the feature adds complexity for V1 users who can wrap the archive with their own tools. Shipping without encryption is acceptable given the archive is a single file.

**Preserved design elements**:
- `--encrypt` flag prompts for (or reads from env) a passphrase.
- Encrypted archives have a distinct file extension (e.g., `.tar.gz.enc`) or manifest marker.
- Algorithm is a widely-adopted authenticated scheme (AES-256-GCM or equivalent).
- Passphrase never logged, never written to disk.
- Recommended approach when the feature ships: Bun-native `crypto.createCipheriv` with AES-256-GCM and scrypt/argon2 KDF — requires no extra tooling, cross-platform by default.

### 12.3 `--include-repos-source`

**Why deferred**: Cross-OS portability landmines. Git's `.git/config` `[core] worktree` may contain absolute paths; symlinks don't translate cleanly between Windows and Linux; CRLF handling can produce different file contents between OSes on the same clone.

**Preserved design elements**:
- Flag-gated opt-in (default false) because repos can be re-cloned from URLs in `repositories.json`.
- If shipped: produces archives that are "same-OS-family only" — restore across OS families must either refuse or clone afresh.
- Size warning: doubles or triples archive size for typical workloads.

## 13. Open Technical Questions (TODO)

These remain open after the V1 scope revision and need answers during implementation spikes.

Resolved as of 2026-04-23 (see note below):
- ~~**T2**: FalkorDB `falkordb_version` / `MODULE LIST`~~ — **RESOLVED** by spike. `MODULE LIST` returns a packed integer `ver=40401` for the graph module; parser decodes to `4.4.1`. Full strategy in ADR-0006 (Version Detection Strategy section). Minimum supported FalkorDB version: v4.0.0.
- ~~**T12**: `watched-folders.json` inclusion~~ — **RESOLVED**. Stakeholder decision: include in V1. See §3.2 archive layout.

Still open:

- **T1**: Deterministic tar output across GNU tar and bsdtar — verify via a round-trip integration test on CI (Linux + Windows runners). Accept "per-store hashes verify cross-platform" as the V1 criterion; byte-identical envelope is a stretch goal.
- **T3**: Docker volume name prefix includes the Compose project name (`personalknowledgemcp_chromadb-data`). If the user clones the repo to a different directory, the volume prefix changes. Support a `--compose-project-name` flag (mirroring the detection regex in the existing `scripts/backup-chromadb.sh`).
- **T4**: Quiesce-wait timeout behavior. Abort backup vs. force-cancel the ingestion. Recommend abort with clear message for V1 (simpler, safer).
- **T5**: Whether to ship a `backup-falkordb.*` standalone script pair alongside the TS implementation for symmetry with the ChromaDB scripts. (PRD FR-6 says yes.)
- **T6**: Confirm FalkorDB vector indexes round-trip cleanly through RDB. Not in V1 use today, but test before any future graph-vector feature.
- **T7**: `dump.rdb` copy race. `BGSAVE` writes a temp file and renames. Our copy must check both `LASTSAVE` advancement and `INFO persistence.rdb_bgsave_in_progress == 0` before copying, not just `LASTSAVE`.
- **T8**: `updateInProgress` flag interaction with quiesce lock. If a prior update crashed leaving `updateInProgress: true`, the backup tool should either refuse or sanitize that flag during manifest assembly so the restore target doesn't think an update is in flight. Recommend sanitize-with-warning.
- **T9**: Partial-restore crash mid-flight. Add an incomplete-restore marker file so the next `migrate import` startup detects leftover set-aside volumes and offers a resume / abandon choice.
- **T10**: Post-restore ChromaDB HNSW warm-up. First query post-restore can take seconds on large collections (lazy index build). Optionally warm the index as part of restore completion; otherwise document the brief slowdown.
- **T11**: MCP HTTP/SSE transport behavior during restore. Containers stop; existing SSE clients see broken connections, not graceful errors. Document; consider a pre-stop broadcast in a future iteration.
- **T13** (new): `watched-folders.json` tokenization. Phase 6 watched folders may be under `DATA_PATH` (tokenize) or arbitrary user paths (treat as external, same Option D rules as `repositories.json`). Confirm during Phase 6 implementation that the path-resolver module is shared, not reimplemented.
- **T14** (new): `pk-mcp repo repath <name> <new-path>` subcommand — design-level commitment made in ADR-0008. Decide whether it ships in V1 GA or as a fast-follow patch. Non-interactive restore with broken external paths is the motivating scenario.

## 14. Questions for Product

*(For the PRD author)*

Resolved in V1.1 of the PRD (no further input needed):
- ~~**Multi-instance scope**~~ — deferred to V1.x.
- ~~**Encryption in V1**~~ — deferred to V1.x.
- ~~**`--include-repos-source`**~~ — deferred to V1.x.
- ~~**Path tokenization answer**~~ — resolved in ADR-0008 (tokenized storage).

Resolved 2026-04-23:
- ~~**Watched-folders.json in V1 archive payload**~~ — yes. Included per §3.2.
- ~~**Secret stripping: blocklist vs. allowlist**~~ — allowlist. See §8.
- ~~**FalkorDB version detection**~~ — `MODULE LIST` primary, `INFO modules` fallback, hard refuse on neither. See ADR-0006 and §10.
- ~~**External local-path handling (ADR-0008 Option D)**~~ — in V1 scope. See §7 and ADR-0008.

Still open:

1. **Distribution/transport**: Should the tool assist with transferring archives (e.g., SCP helper, cloud upload), or is transport purely the user's problem? (PRD's current stance is "user's problem.")
2. **Retention**: Existing `backup-chromadb.sh` has a 30-day retention policy. Do we apply the same to migration bundles? Recommend silent (no auto-pruning) — users wire their own scheduling.
3. **User interface**: CLI-only acceptable for V1? (PRD says yes; confirming.)
4. **Scheduling**: Do users expect a scheduled-backup feature in V1? Recommend no — `cron` / Task Scheduler suffice.
5. **Cross-major restore fallback**: We propose a logical-export escape hatch (slow Cypher walk). Is that a V1 nicety or acceptable to defer? Recommend defer.
6. **Telemetry**: Should the backup process emit metrics to the existing observability pipeline, or stay local-only?
7. **Licensing / content ownership**: Archives may contain proprietary source code embeddings. Do we need explicit consent language at first backup?

---

## Appendix A: Files Created / Modified (Design Only — No Implementation)

- `docs/architecture/DB-Migration-Design.md` — this document (revised)
- `docs/architecture/adr/0005-cross-machine-migration-archive-format.md`
- `docs/architecture/adr/0006-falkordb-backup-strategy.md`
- `docs/architecture/adr/0007-cross-store-consistency-model.md` (revised — per-adapter gate)
- `docs/architecture/adr/0008-repositories-json-path-model.md` (new — tokenized paths)

## Appendix B: Inventory of Existing Related Artifacts

| Path | Role | Action |
|------|------|--------|
| `scripts/backup-chromadb.{sh,ps1}` | Standalone ChromaDB backup | Keep; reused conceptually, called from orchestrator |
| `scripts/restore-chromadb.{sh,ps1}` | Standalone ChromaDB restore | Keep; conceptually mirrored |
| `scripts/backup-neo4j.{sh,ps1}` | Legacy (Neo4j superseded by FalkorDB per ADR-0004) | Mark deprecated; remove in follow-up PR |
| `scripts/restore-neo4j.{sh,ps1}` | Legacy | Mark deprecated; remove in follow-up PR |
| `data/repositories.json` | Metadata store | Inventoried by migration adapter; paths tokenized per ADR-0008 |
| `src/config/instance-config.ts` | Instance configuration (V1 single-instance; has per-instance `dataPath` seam for post-V1) | Serialized (sanitized) |
| `src/graph/adapters/FalkorDBAdapter.ts` | Live graph client | Instrumented with `MigrationLockGate` (ADR-0007) |
| `src/storage/chroma-client.ts` | Live vector client | Instrumented with `MigrationLockGate` (ADR-0007) |
| `src/repositories/metadata-store.ts` | Metadata writer singleton | Instrumented with `MigrationLockGate` + tokenization (ADR-0007, ADR-0008) |
| `src/services/watched-folder-store.ts` | Watched-folders persistence | Instrumented with `MigrationLockGate`; included in V1 archive payload (see §3.2) |
| `kubernetes/base/mcp-service/pvc.yaml` | K8s PVC (untracked) | Referenced in §11; V1 deferred |
