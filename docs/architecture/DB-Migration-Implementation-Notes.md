# DB Migration — Implementation Feasibility Notes

**Role:** Engineer-side pressure test of the PRD, design doc, and ADRs 0005/0006/0007.
**Date:** 2026-04-23
**Status:** Review notes for architect + PM. No code written; no upstream docs modified.

Related reviewed artifacts:
- `C:\src\PersonalKnowledgeMCP\docs\pm\DB-Migration-Feature-PRD.md`
- `C:\src\PersonalKnowledgeMCP\docs\architecture\DB-Migration-Design.md`
- `C:\src\PersonalKnowledgeMCP\docs\architecture\adr\0005-cross-machine-migration-archive-format.md`
- `C:\src\PersonalKnowledgeMCP\docs\architecture\adr\0006-falkordb-backup-strategy.md`
- `C:\src\PersonalKnowledgeMCP\docs\architecture\adr\0007-cross-store-consistency-model.md`

---

## 1. Verdict

**Yellow — implementable, but three foundational assumptions are wrong and need architect revision before the engineer starts building.**

The overall shape (single tarball + manifest + per-store adapters + soft-quiesce lock + clobber-restore with rollback) is sound and fits the codebase. The problems are concentrated in three places: (1) multi-instance FalkorDB doesn't exist in the current topology, (2) the advisory lock needs to hook a surface that is larger than the design suggests, and (3) the "backup" vs "migrate" naming has drifted between the PRD and the design. None of these kill the design, but all three should be resolved before scoping.

Confidence on the V1 set listed in §3 of the design: medium. Confidence on the timelines implied by the PRD's performance targets: low on large instances.

---

## 2. Codebase Assumption Audit

### 2.1 "Soft-quiesce lock at `data/.migration.lock` pauses ingestion writes" — PARTIALLY WRONG

**What the design says (ADR-0007):** "Lock check is in the ingestion entry point (`update-all-command.ts`, `index-command.ts`)."

**What the code actually shows:** Writers do not funnel through two CLI entry points. Inspection of `src/services/` and `src/cli/commands/` shows a much larger writer surface:

- `src/cli/commands/index-command.ts`
- `src/cli/commands/update-all-command.ts`
- `src/cli/commands/update-repository-command.ts`
- `src/cli/commands/documents-index-command.ts`
- `src/cli/commands/watch-command.ts` (add / rescan subcommands)
- `src/services/folder-watcher-service.ts` (`FolderWatcherService`) — continuous background writer driven by `chokidar`, triggers ingest without any CLI user in the loop
- `src/services/processing-queue.ts` — async queue feeding watchers
- `src/services/incremental-update-pipeline.ts` (`IncrementalUpdatePipeline`)
- `src/services/incremental-update-coordinator.ts` (`IncrementalUpdateCoordinator`)
- `src/services/ingestion-service.ts` (`IngestionService`)
- MCP tool handlers in `src/mcp/server.ts` that can trigger index / update flows via HTTP/SSE or stdio
- HTTP transport layer (`src/http/`) that may serve the above MCP tools

The lock must be checked in one central place (likely `IngestionService` or `IncrementalUpdateCoordinator`) that every path above calls into, *and* inside `FolderWatcherService` before it dispatches a watcher-triggered ingest, *and* in the MCP tool handler layer. There is currently no single chokepoint. The nearest approximation is `IncrementalUpdateCoordinator`, which most repo-update paths route through; folder-watcher document ingestion and fresh index may not.

Additionally, today's write-safety mechanism is the **per-repo** `updateInProgress` flag stored in `repositories.json` (see `src/services/interrupted-update-detector.ts`). It is not a global mutex, it is not process-wide, and it is not visible to the MCP HTTP transport running out-of-process. Saying "the ingestion pipeline is the only writer" is aspirational; in practice there is at least the CLI process, the MCP stdio server, the MCP HTTP/SSE server, and the folder-watcher all potentially writing.

**Implication:** The design should either (a) scope the lock check to a single coordinating service and refactor the other paths to route through it (which is effort the design doesn't budget), or (b) make the lock a file-based advisory gate checked at the top of each writer entry point with explicit test coverage for each path. Option (b) is the less-invasive realistic choice for V1, but the ADR presents it as a trivial "one integration point." It isn't.

### 2.2 "BGSAVE + dump.rdb copy via Alpine sidecar" — WORKS, BUT UNDER-SPECIFIED

**What the design says (ADR-0006):** Mirror the Chroma pattern: spin up an Alpine container mounted against `falkordb-data`, copy `/data/dump.rdb` out.

**What the code actually shows (docker-compose.yml lines 183-216):**
- FalkorDB volume is `falkordb-data:/data`. The RDB path `/data/dump.rdb` is correct and the volume is mountable into a sidecar the same way Chroma is. That works.
- `FALKORDB_PASSWORD` is sourced from env; defaults to `testpassword`. The ADR assumes `redis-cli` + password is available either on host or in a sidecar. Neither `redis-cli` nor `falkordb-cli` is presently required in dev tooling; users running on Windows/PowerShell may not have it. A sidecar container for the `BGSAVE` call itself (`redis:alpine` with `redis-cli`) solves this but the design never spells it out — it only covers the file-copy sidecar.
- The FalkorDB client library is `falkordb ^6.6.0`. Whether the Node client exposes a raw `sendCommand("BGSAVE")` path is not verified in the design. Reviewing `src/graph/adapters/FalkorDBAdapter.ts`, only Cypher (`runQuery`) is wrapped. If we issue BGSAVE via the existing client, the adapter needs a new primitive; if we shell out to `redis-cli` in a container, we need a second sidecar. Either is fine, but the design doesn't pick one.
- **Multi-instance assumption is broken.** docker-compose.yml defines `falkordb` only under profiles `default` and `all`. There is no `falkordb-private`, `falkordb-work`, or `falkordb-public`. Contrast with ChromaDB which has all four (`chromadb`, `chromadb-private`, `chromadb-work`, `chromadb-public`). Today, all instances share the single FalkorDB. This directly contradicts:
  - PRD §3.1 goal #3: "FalkorDB parity" (parity with ChromaDB's multi-instance posture is not achievable without adding three FalkorDB services)
  - PRD §5 US-5 multi-instance migration acceptance criteria
  - Design §5.3 which says `--instance work` scopes per-profile data
  - `src/cli/utils/falkordb-config.ts` confirms: single `FALKORDB_HOST`/`FALKORDB_PORT` env pair; no per-instance config
  - `src/config/instance-config.ts` has a `chromadb` sub-object per instance but no `falkordb`

This is the single biggest design-vs-code mismatch. Either:
- Add three FalkorDB services to docker-compose + per-instance config (non-trivial docker-compose + app-config change, independent of this feature), or
- Scope multi-instance migration to ChromaDB + metadata, treat FalkorDB as a shared backup (captured once per export, same content regardless of `--instance`), and explicitly document that graph data is not tier-isolated today, or
- Use `GRAPH.LIST` + per-graph logical export to separate graph data by repo-to-instance mapping. That works only if graph nodes carry an instance label, which they do not today.

**T6 in the design** ("Confirm FalkorDB vector indexes round-trip cleanly through RDB") is flagged correctly as a TODO but not blocking. The project doesn't currently use FalkorDB vector indexes, so this is fine for V1 as long as it gets tested before any future graph-vector feature ships.

### 2.3 "Cross-platform tar via bsdtar" — MOSTLY TRUE, BUT READ THE CAVEATS

- Windows 10 1809+ and Windows 11 ship `bsdtar` as `tar.exe` on PATH. Reasonable baseline.
- `package.json` lists no tar library. The design mandates `child_process.spawn`/`Bun.spawn` against the system tar. This is operationally fine but has landmines:
  - GNU tar vs bsdtar flag parity: `--sort=name`, `--mtime=@<epoch>`, `--format=ustar`, `--numeric-owner`, `--owner=0`, `--group=0` are not all accepted by bsdtar. The design calls this out as T1 but doesn't commit to an approach. This will bite determinism/SHA-reproducibility tests on Windows.
  - Windows Git Bash path conversion (`MSYS_NO_PATHCONV=1`) is handled in existing shell scripts; the new TS implementation shelling out via `Bun.spawn` should use argv arrays to sidestep that entirely — confirm in implementation, not shell strings.
  - Long path handling on Windows (>260 chars) for archives containing `data/repos/`: not addressed.
- `jszip` is already a dependency (used for DOCX parsing). If deterministic cross-platform output becomes a blocker, a Bun-native tar-stream library (`tar-stream`, `node-tar`) is a more defensible choice than shelling out. Adding a dependency is acceptable here.
- **Recommendation:** the engineer should strongly consider a Bun-native tar library for the migration tool and treat the existing `scripts/backup-chromadb.sh` pattern of "shell alpine container + tar" as the escape hatch for standalone use, not the core implementation. The design implicitly mixes the two.

### 2.4 "CLI surface `pk-mcp backup create/restore`" — FITS CLEANLY, BUT NAME DRIFTED

- `src/cli/index.ts` uses Commander subcommand groups for `token`, `graph`, `providers`, `models`, `tables`, `documents`, `watch`. Adding `backup` (or `migrate`) as a new `program.command("backup").description(...)` group with `.command("create")`, `.command("restore")`, `.command("verify")`, `.command("inspect")`, `.command("list")` subcommands is a direct copy of existing patterns. Effort: small.
- Validation schemas live in `src/cli/utils/validation.ts` (Zod). New schemas would be added there per existing convention.
- Dependency init: `initializeDependencies()` (src/cli/utils/dependency-init.ts) provides `repositoryService` and similar. For backup, the orchestrator additionally needs:
  - A handle to Docker (for volume operations) — not currently a dependency
  - A way to read docker-compose.yml image tags at runtime — not currently a dependency
  - A FalkorDB client that can issue `BGSAVE`/`LASTSAVE` raw commands — not currently in the adapter
- **Name drift between PRD and design is real and needs to be resolved before anyone builds.**
  - PRD §1 table, §5, §8.1: **`pk-mcp migrate export` / `pk-mcp migrate import`**
  - Design §5: **`pk-mcp backup create` / `pk-mcp backup restore`**
  - The rationale in the design (§5 intro) says it matches "existing CLI conventions" — but there is no precedent either way; both `graph migrate` (verb-object) and `token create` (object-verb) exist. Either naming can be justified.
  - Pick one. The engineer should not be reconciling this at implementation time. Recommend `migrate` since (a) the PRD is the source-of-truth product contract and (b) "backup" implies routine DR, not cross-machine move, which undersells the feature's value prop.

### 2.5 "`repositories.json` path tokenization" — REQUIRED; DESIGN UNDERPLAYS IT

**What the code actually shows:** Every record in `data/repositories.json` stores `localPath` as an absolute OS-native path. Live inspection:

```
"localPath": "C:\\src\\PersonalKnowledgeMCP\\data\\repositories\\PersonalKnowledgeMCP"
```

JSON Doc comment in `src/repositories/types.ts` says the field is absolute. The existing data on this checkout is Windows-absolute with escaped backslashes.

Implications:
- Direct byte-identical restore across machines will break: the new host will not have that `C:\` path, and code that uses `localPath` (see `src/ingestion/repository-cloner.ts`, `src/services/interrupted-update-recovery.ts`) will fail at the first re-clone / re-pull.
- Rewriting paths on import is mandatory, not optional. The design acknowledges this as an open question (PRD Q2); the design picks no answer. This needs to land before implementation.
- Tokenization approach (`${DATA_DIR}/repositories/...`) or relative-path-with-resolver both work. Tokenization is slightly preferable because it tolerates the target machine's operator re-locating `DATA_DIR`. Either way, **the on-restore path rewrite must round-trip through the `localPath` of every record**, and `sanitizeCollectionName()` / `collectionName` are already stable and don't need rewriting (good).
- `updateHistory` arrays contain no paths — safe.
- Cross-platform: the on-disk JSON uses `\\`-escaped Windows separators. A Linux reader must normalize. JSON parsing doesn't care, but any code that does string-concat on top of `localPath` will. Test both directions explicitly in CI.

### 2.6 "Manifest-based version compatibility" — DISCOVERABILITY IS WEAK

The design says the manifest captures:
- `chromadb.image`: `chromadb/chroma:0.6.3`
- `falkordb.image`: `falkordb/falkordb:v4.4.1`
- `pkMcpVersion`: e.g., `"1.0.4"`
- `redis_version` / `falkordb_version` from `INFO server`

What the code supports today:
- **`pkMcpVersion`**: Available via `package.json.version` at runtime. Easy.
- **ChromaDB image tag**: Not programmatically known by the app. The Chroma client library hits `/api/v2/heartbeat` and can report a chroma server version string, but not the Docker image tag. To get the tag we must `docker inspect` the container, which requires (a) container name assumption (`pk-mcp-chromadb` etc.) and (b) Docker CLI availability on the host. Docker is already assumed by `backup-chromadb.sh`, so fine.
- **FalkorDB image tag / versions**: Not programmatically known by the app. Same deal: `docker inspect` or `INFO server` via `redis-cli`. `INFO server` returns `redis_version` but FalkorDB's module version (`falkordb_version`) comes from `MODULE LIST` or a custom `GRAPH.CONFIG GET` — needs verification. The ADR assumes `INFO server` surfaces `falkordb_version`; that field is not standard Redis. Verify empirically before building.
- **Multi-instance image tag**: all instances share the same image tags in docker-compose anchors, so no drift. But the manifest format in ADR-0005 captures one `chromadb.image` field globally, which is correct for today's topology.

**Implication:** The manifest writer needs a helper that talks to the Docker CLI (`docker inspect pk-mcp-chromadb --format '{{.Config.Image}}'`) and to FalkorDB (`INFO server` + `MODULE LIST`). Neither exists today. Small additions, but they should be called out and the FalkorDB version-field assumption should be validated as part of the FalkorDB adapter spike, not during ADR acceptance.

### 2.7 Other assumption checks

- **"Ingestion entry point = `update-all-command.ts`"** (ADR-0007 risk table). See §2.1 — this understates the writer surface.
- **"Atomic rename-and-swap of Docker volumes"** (ADR-0007 §Atomicity). Docker volumes in the named-volume scheme are opaque; you cannot `mv` them like filesystem directories. The pattern that works is:
  - Stop container → `docker volume rename` (does not exist — Docker has no native rename) / alternative: `docker run --rm -v old:/from -v new:/to alpine cp -a /from/. /to/` → recreate → start
  - Or, dump new data to a staging directory on the host, `docker run --rm -v old:/data alpine rm -rf /data/*`, then `docker run --rm -v staging:/from -v old:/data alpine cp -a /from/. /data/`
  - Neither is atomic at the filesystem level. "Set-aside-then-swap" in the Docker-volume world means "keep a copy of the old data and restore it on failure via a second sidecar invocation." The design should say this explicitly — "atomic" is misleading here. Disk-space NFR (2x during restore) already assumes the set-aside copy, so the ops envelope is right; the word "atomic" is wrong.
- **"Encryption via `age` or `openssl enc`"** (Design §6, ADR reserved). `age` requires a binary on each platform; `openssl` is not on stock Windows. If encryption matters for V1, Bun's native `crypto.subtle` / `crypto.createCipheriv` with AES-256-GCM and scrypt/argon2 KDF is a better default because it requires no extra tooling. Either way, encryption is the cleanest item to defer past V1.
- **"30-day retention like `backup-chromadb.sh`"**: existing script does this via `find -mtime`. Fine for shell; in TS, a trivial `fs.readdir` + `stat.mtime` loop. Small.
- **"Stale Neo4j scripts are removed or deprecated"** (PRD FR-6.3): `scripts/backup-neo4j.*`, `scripts/restore-neo4j.*`, `scripts/test-backup-restore-neo4j.sh` are present; also `neo4j-driver` is still a runtime dependency in package.json. Removing the driver needs a code check — `src/graph/schema/neo4j.ts` and `src/migration/graph-data-migration.ts` may still reference it. Out of scope for the migration feature itself, but the PRD implies cleanup; watch scope creep.

---

## 3. Hidden Complexity / Landmines

Items the design does not mention that will bite during implementation:

1. **ChromaDB collection IDs survive, collection UUIDs may not.** ChromaDB 0.6.x internally keys collections by UUID; `collectionName` is the lookup we use (`repo_personalknowledgemcp`). Volume-level restore preserves everything including UUIDs, so this is probably fine. But if a user has ever run `ALLOW_RESET=TRUE` and reset a collection, the old UUID is gone. Worth a post-restore sanity check that the collection list from ChromaDB matches the count in `repositories.json`.

2. **FalkorDB module load on restore.** After `dump.rdb` is dropped into the volume, FalkorDB must load the `graph.so` module before the RDB finishes parsing. If `MODULES` isn't loaded when the RDB is read, Redis rejects unknown types and the server fails to start. The official image handles this via its entrypoint, but if anyone has a `redis.conf` override or runs a custom image, restore could wedge. Document that the target FalkorDB container must be the stock image used for the backup.

3. **Docker socket is required, not just Docker CLI.** The Alpine-sidecar pattern needs `docker run`, which requires access to `/var/run/docker.sock`. On Windows Docker Desktop this is generally fine, but in rootless or remote-Docker setups it is not. Also relevant for Kubernetes: Jobs cannot spawn sibling containers without elevated privileges or in-cluster Docker access. This bounds the "Kubernetes path" in Design §9 more than the design admits — volume-mount-plus-sidecar is fundamentally Docker-model and does not translate cleanly to PVCs.

4. **Partial-restore crash mid-swap.** The failure matrix in Design §4.3 is optimistic. If the process crashes after `stop containers` + `rename-aside` but before the new volumes are populated, the user is left with renamed-aside old volumes and no running containers. The recovery path is manual: find the set-aside volumes, start the right one. The design says `--keep-set-aside` preserves these on success, but the crash path is silent. Add: on startup of the `backup restore` command, detect any prior-incomplete restore via a marker file and offer a resume / abandon choice.

5. **`data/repos/` size and content.** This directory contains full-tree clones of indexed repos. On this checkout it holds at least one clone (`PersonalKnowledgeMCP` itself, ~50MB of source + node_modules in .gitignore). `--include-repos-source` can balloon archive size by 10-100x. The path-normalization issue (§2.5) also applies if we archive cloned source: absolute paths in `.git/config` `[core] worktree = ...`, symlinks on Linux that don't translate to Windows, and CRLF vs LF translation artifacts if the clone was done on Windows with `autocrlf=true`. V1 should keep this flag default-off and document that the resulting archive is not portable if `--include-repos-source` is used (only restore on the same OS family).

6. **Integration test fixtures.** Current integration tests (`tests/integration/storage/chroma-auth-integration.test.ts` and friends) require the user to manually `docker compose up -d` the appropriate profile before running. There is no `testcontainers-node` equivalent wired in. A migration test suite that needs ChromaDB + FalkorDB + a populated `repositories.json`, then backup, then tear down, then restore, then verify is **substantially more ceremony** than existing tests. Plan for either: (a) a new test helper that drives docker-compose inside `beforeAll`/`afterAll`, or (b) add `testcontainers` as a dev dep. Either is a real piece of work, not a line-item.

7. **`updateInProgress` flag interaction with quiesce lock.** If an update crashes mid-flight and leaves `updateInProgress: true`, the interrupted-update-recovery service (`src/services/interrupted-update-recovery.ts`) clears it on next startup. But what if the user runs `backup create` when interrupted state exists? The quiesce lock sees no active writer, takes the snapshot — and the snapshot captures `updateInProgress: true` in the archive. On restore, the target machine will then think an update is in flight. Define: backup must either refuse to proceed with `updateInProgress` records present, or sanitize them during manifest assembly.

8. **MCP HTTP/SSE transport in-flight during backup.** The MCP HTTP transport can hold long-lived SSE connections. Stopping containers for restore will kill these in-flight streams; clients will see broken connections, not graceful errors. Low severity for a personal tool, but worth documenting.

9. **`dump.rdb` copy race.** `BGSAVE` writes to a temp file and renames on success. If we copy `dump.rdb` out during that window, we may grab the old snapshot instead of the new one. The `LASTSAVE` poll is meant to avoid this, but on a busy instance `LASTSAVE` advances as soon as the fork completes, not when the file is fully flushed. Add an `fsync` or a short `sleep 1` safeguard, or poll `INFO persistence` for `rdb_bgsave_in_progress: 0` *and* `rdb_last_bgsave_status: ok`. ADR-0006 hints at this but leaves it as a TODO.

10. **Archive SHA mismatch on re-pack.** The design promises "byte-identical archives across platforms" (ADR-0005 validation criterion). That requires: same tar flags, same gzip level, same file order, same timestamps (mtime normalized to manifest-`createdAt`), same owner/group, no extended attributes on the contents. GNU tar defaults and bsdtar defaults differ in at least two of those. This is T1 in the design — flagged but blocking a V1 acceptance criterion. Recommend relaxing the criterion to "envelope SHA verifies on the producing host, integrity hashes verify on restore host" and dropping byte-identical cross-platform.

11. **Neo4j detritus in active code.** `neo4j-driver` is still a runtime dep; `src/graph/schema/neo4j.ts` exists; `src/graph/adapters/*` has a Neo4j adapter. The FR-6 cleanup item has scope implications (removing the driver) that are not this feature.

12. **Post-restore search re-warming.** ChromaDB may lazy-build HNSW indexes on first query after load. On a large collection the first query post-restore can take seconds. Not a correctness issue but violates the "works identically to source machine" UX promise in FR-3.8 for the immediate moments after import. Mention in UX or warm the index as part of restore completion.

13. **Docker volume name prefix.** Volumes are named `personalknowledgemcp_chromadb-data` (prefix is docker-compose project name, which defaults to directory name). If a user clones this repo to a different directory on the target machine, the volume prefix changes, and the Alpine sidecar pattern breaks. The existing Chroma script uses a regex (`chromadb.*data$`). The migration tool must do the same or accept a `--compose-project-name` flag. Design doesn't mention this.

---

## 4. Component-Level Effort Map

Sized using T-shirt scale. S = ~1-3 dev-days, M = ~3-10, L = ~10+. Not a schedule, an inventory.

| # | Component | Size | Depends on | Notes |
|---|-----------|------|------------|-------|
| C1 | **FalkorDB standalone scripts** (`scripts/backup-falkordb.{sh,ps1}`, `scripts/restore-falkordb.{sh,ps1}`) with `BGSAVE` + RDB copy + health-check, mirroring Chroma scripts | M | Spike on redis-cli sidecar pattern | Largest unknown is the sidecar redis-cli container choice (official `redis:alpine`?) and BGSAVE-complete detection reliability. PowerShell parity requires careful quoting around `docker run`. Must handle FALKORDB_PASSWORD securely (no echo, no log). |
| C2 | **Manifest schema, writer, reader, versioning** | S | — | TS types + Zod schema in `src/services/migration/` alongside existing `src/migration/`. Includes `productVersion` read from package.json, hash-of-manifest, additive schema evolution rules. |
| C3 | **Quiesce lock primitive** (`data/.migration.lock`, O_EXCL create, stale-lock TTL, pid, monotonic expiry) | S | — | Pure fs + process work. Small in isolation. |
| C4 | **Ingestion integration for quiesce lock** — gating in `IncrementalUpdateCoordinator`, `IngestionService`, `FolderWatcherService`, MCP tool handlers, HTTP transport, and each CLI command entry that writes | **M, leaning L** | C3 | The real cost. Must add tests per path. The design under-sizes this; see §2.1. |
| C5 | **Docker volume backup adapter (ChromaDB)** — volume auto-detect, read-only Alpine sidecar tar, SHA-256, version-from-docker-inspect | S | — | Largely a TS port of `backup-chromadb.sh`. Volume name regex + `--compose-project-name` flag to handle non-default project names. |
| C6 | **Docker volume restore adapter (ChromaDB)** — set-aside, clear, copy-in, start, health-check, rollback on failure | S | C5 | Atomic cut-over semantics per §2.7: "atomic" means "rollback-capable via set-aside," not filesystem-atomic. |
| C7 | **FalkorDB backup adapter (TS)** — orchestrator-driven version of C1 with LASTSAVE polling, `INFO persistence` sanity, `docker inspect` for image tag, `MODULE LIST` for falkordb_version | M | C1 spike | Needs raw Redis command capability in the adapter (not currently wired through `FalkorDBAdapter.ts`). Tree-sitter-like small addition to the adapter or a second lightweight Redis client for ops commands. |
| C8 | **FalkorDB restore adapter (TS)** — stop, set-aside, drop dump.rdb into volume, start, health-check, smoke query | S | C7 | Needs to verify RDB loaded cleanly before declaring success. |
| C9 | **Metadata snapshot adapter** — read `data/repositories.json`, serialize sanitized `instance-config.json` (strip `.chromadb.authToken` + `FALKORDB_PASSWORD` surfaces), tokenize paths on export, rewrite on import | M | — | Path tokenization + Windows/Linux normalization is the real work; see §2.5. |
| C10 | **Archive packaging** — tar streaming, gzip, SHA-256 sidecar, deterministic-ish flags, single-file output | M | — | Recommend `node-tar` / `tar-stream` over shelling out. If staying with shell-out, the deterministic-flags story is its own sub-task. |
| C11 | **CLI `migrate create` / `migrate restore` / `migrate verify` / `migrate inspect` / `migrate list`** | S | C2, C5-C10 | Direct extension of `src/cli/index.ts` patterns. |
| C12 | **Post-restore verification command** — compare manifest counts vs live ChromaDB collection counts + live FalkorDB `GRAPH.LIST` + `MATCH(n) RETURN count(n)` + `data/repositories.json` SHAs | S | C11 | Manifest-vs-live diff; straightforward once adapters exist. |
| C13 | **Multi-instance awareness** — infer active profile from docker-compose, route ChromaDB adapter to the right container, refuse cross-tier restores | **L (blocked)** | ADR decision on FalkorDB per-instance | Per §2.2: FalkorDB is currently shared across instances. Either the architect amends the design to accept this (ChromaDB is per-instance, FalkorDB is shared; `--instance X` exports the global FalkorDB alongside Chroma-X), or docker-compose + config gets a proper per-instance FalkorDB first. The latter is a feature unto itself. |
| C14 | **Dry-run mode** | S | C11 | Each adapter reports "what it would do" without side effects. |
| C15 | **Encryption (optional, reserved)** | M | C10 | Bun-native AES-256-GCM with scrypt KDF. Recommend deferring out of V1 entirely. |
| C16 | **Integration tests (unit + real-Docker + cross-platform)** | **L** | All above | Docker orchestration in test setup is the biggest lift. Likely needs `testcontainers` or a custom docker-compose fixture. 90% coverage mandate is plausible for unit, not plausible for cross-platform integration without CI investment. |
| C17 | **Docs updates** (README migration section, `docs/docker-operations.md` Neo4j → FalkorDB migration, runbooks, K8s appendix) | S | Everything else | Partly sunk cost — someone has to write the operator guide anyway. |
| C18 | **Stale Neo4j script cleanup / deprecation markers** | S | — | Mostly `rm`; scope creeps if we remove `neo4j-driver` from code paths. Leave driver removal out of this feature. |

Total if V1 = C1-C12, C14, C16-C17 with C13 scoped down and C15 deferred: 4-8 dev-weeks for one engineer, depending on how the FalkorDB multi-instance question resolves and how much CI infrastructure is pre-existing. The PRD's implicit timeline ("V1 is complete and in active daily use, let's ship this next phase") is consistent with that band.

---

## 5. Risks That Could Invalidate the Design

Ranked likelihood × impact (H/M/L each).

| # | Risk | Likelihood | Impact | Net |
|---|------|-----------|--------|-----|
| R1 | **FalkorDB is not per-instance in docker-compose or config.** If the architect intends real per-instance graph tier isolation, this feature depends on a separate infrastructure change. If not, the "multi-instance awareness" story has to be rewritten honestly. | H | H | **Blocker** — resolve before design acceptance. |
| R2 | **Advisory lock cannot be reliably enforced without refactoring writer paths.** Multiple writer surfaces (CLI, MCP stdio, MCP HTTP, folder-watcher) do not share a single coordination point today. A "trust each entry point to check the lock" approach will miss paths and produce inconsistent backups. | H | H | **Major** — the design should commit to either a refactor to a single chokepoint or an explicit per-path gate with test coverage per path. |
| R3 | **Path tokenization strategy is left as an open question.** PRD Q2 unanswered. Cross-platform restore will silently corrupt state if paths are not rewritten. | H | H | **Major, easy to fix** — architect picks one answer. |
| R4 | **Docker-volume "atomic swap" terminology misleads the engineer.** No fs-atomic volume rename in Docker; rollback is a second sidecar data-copy on failure. | H | M | Documentation issue; worth fixing in the design to avoid incorrect expectations during testing. |
| R5 | **FalkorDB version field assumed from `INFO server` may not exist.** `falkordb_version` is not a standard Redis INFO field. If only the module version from `MODULE LIST` is available, version gating in ADR-0006 needs adjustment. | M | M | Quick spike to resolve during implementation; low blast radius. |
| R6 | **Cross-platform deterministic archive SHA is not achievable with stock tar.** ADR-0005 validation criterion "byte-identical store contents" is unlikely to hold. | H | L | Relax the criterion to "integrity hashes verify end-to-end"; byte-identicality of the envelope is a nice-to-have, not a requirement. |
| R7 | **`--include-repos-source` archives are not portable across OS families.** Git metadata + symlinks + CRLF handling break. | M | M | Mark explicitly as "same-OS-family only" or exclude from V1. |
| R8 | **Integration test environment (real Docker, two stores, multi-profile) is substantially more than existing tests handle.** | H | M | Plan for CI investment; do not treat the test layer as a line item. |
| R9 | **Secrets-stripping coverage is incomplete by design.** Design §6 enumerates a known-secrets field list but any future config key added without touching the stripper leaks into the archive. Need a default-deny / allowlist approach or a test that fails on unknown-key passthrough. | M | M | Low cost to fix now, high cost if it ships leaky. |
| R10 | **Quiesce-timeout behavior (T4) is undecided.** "Abort backup vs. force-cancel ingestion" is a UX question; the answer affects scheduled/DR users in the opposite way from interactive users. | M | M | Product decision; defer to PM with engineering recommendation of "abort with clear message" for V1 (simpler, safer). |

---

## 6. Recommended V1 Cut

Engineer-opinionated V1 scope (tighter than the PRD):

**In V1:**
- FR-6 standalone FalkorDB scripts (C1) — this is 80% of the user pain today
- Manifest (C2), quiesce lock primitive (C3), minimal ingestion integration at the `IncrementalUpdateCoordinator` and `FolderWatcherService` chokepoints (C4 partial)
- Per-store adapters: ChromaDB + FalkorDB + metadata (C5-C9)
- CLI: `create`, `restore`, `verify`, `inspect`; **drop `list`** — `ls backups/` works (C11 reduced)
- Single-instance export/restore (default profile only) (C13 deferred)
- Archive packaging (C10) with deterministic-ish flags but **relaxed validation criterion**: envelope SHA verifies on the producer host; per-store hashes verify cross-platform
- Post-restore verification (C12)
- Dry-run (C14)
- Integration tests against one profile (C16 reduced)
- Docs (C17)

**Defer out of V1:**
1. **Multi-instance (`--instance` flag for anything other than `default`)**. The PRD positions this as a V1 goal (FR-2.2, US-5). The engineer's view: with FalkorDB shared across instances today, the tool cannot honestly implement per-instance scoping without prerequisite infrastructure work. Ship single-instance V1; add per-instance in V1.1 after docker-compose + config are extended. **This is a direct disagreement with the PRD; call it out explicitly.**
2. **Encryption (`--encrypt`, C15)**. PRD labels P1 and the design already reserves it. Fine to defer; makes V1 shippable weeks sooner. Users can encrypt the resulting tarball with `age` or `openssl` themselves until the feature ships.
3. **`--include-repos-source` (C10 extension, PRD FR-1.6 P1)**. Platform-portability landmines. Document "tar `data/repos/` yourself if you want offline restore."
4. **Kubernetes path** (Design §9, PRD US-10). Design already defers. Keep it deferred; runbook-only.
5. **Logical-export fallback for cross-major version** (ADR-0006 escape hatch). Reuse `src/migration/graph-data-migration.ts` when the need arises; don't build the CLI surface for it in V1.

**V1 claimed but I think should stay V1 (agreeing with PRD):**
- FalkorDB standalone scripts (FR-6) — yes, ship
- Integrity verification (FR-4) — yes, ship
- Dry-run (FR-3.4, US-7) — yes, ship
- Version-compat gating (FR-3.2) — yes, ship

**V1 claimed by PRD that I think should be cut** (repeat from above for visibility):
- Multi-instance awareness in the tool itself (PRD §3.1 goal #8, FR-2.2, US-5)
- Optional encryption (PRD §3.1 goal #7, US-6)

---

## 7. Questions Back to Product and Architecture

1. **Multi-instance + FalkorDB.** Is FalkorDB intended to be per-instance (Private/Work/Public each with their own Redis/Falkor)? If yes, that is a prerequisite feature to this one and should have its own design. If no, the PRD's multi-instance promises need scoping to ChromaDB + metadata, and the UX needs a clear statement that graph data is not tier-isolated. (Addressed to architect + PM.)

2. **`migrate` vs `backup` CLI naming.** The PRD says `pk-mcp migrate`, the design says `pk-mcp backup`. Pick one. Recommend `migrate`. (Architect.)

3. **Writer-path refactor appetite.** Does architecture want a single `IngestionService` chokepoint (meaningful refactor, long-term cleaner) or are we OK with per-entry-point lock checks (faster, more surface area, higher bug risk)? (Architect.)

4. **Path tokenization answer.** Architect picks: `${DATA_DIR}/...` tokenization, relative paths with resolver, or on-restore rewrite. Needed before C9 can start. (Architect.)

5. **FalkorDB raw-command access.** Does the existing `FalkorDBAdapter` get extended to support `BGSAVE`/`LASTSAVE`/`INFO`/`MODULE LIST`, or do we add a separate lightweight Redis client for ops commands? (Architect.)

6. **Quiesce timeout policy (T4).** When an in-flight ingest doesn't drain within the quiesce window, abort backup or force-cancel the ingest? Recommend abort. (Product.)

7. **Encryption in V1.** Can we defer `--encrypt` to V1.1? (Product.)

8. **Multi-instance in V1.** Can we defer `--instance <non-default>` support to V1.1, delivered alongside the FalkorDB per-instance infrastructure change if that is even intended? (Product.)

9. **Retention policy integration.** Chroma's script applies 30-day retention inline. Does the migration tool apply retention automatically (surprising), require a flag (safer), or stay silent (clearest)? Recommend silent — users wire pruning into their own scheduling. (Product.)

10. **`--include-repos-source` portability caveat.** If the flag produces archives that only restore on the same OS family, is that acceptable (document it), or should we refuse cross-OS restore of source-bearing archives at import time? (Product.)

11. **Archive envelope-SHA cross-platform promise.** OK to relax "byte-identical across platforms" to "integrity verifiable end-to-end"? (Architect, PM.)

12. **Neo4j script removal scope.** PRD FR-6.3 says remove/deprecate stale scripts. Should this feature also remove `neo4j-driver` from `package.json` and delete `src/graph/schema/neo4j.ts` / `src/graph/adapters/Neo4j*`? Recommend leaving driver removal out of this feature to control scope. (Architect.)

---

*End of notes. No code changes, no upstream doc edits.*
