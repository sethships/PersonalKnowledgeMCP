# Cross-Machine DB Migration — V1 Implementation Plan

**Version:** 1.0
**Date:** 2026-04-23
**Status:** Draft (for stakeholder greenlight)
**Author:** Program Management
**Authoritative inputs:**
- PRD: `docs/pm/DB-Migration-Feature-PRD.md` (v1.2)
- Design: `docs/architecture/DB-Migration-Design.md`
- ADRs: `docs/architecture/adr/0005..0008`
- Feasibility review: `docs/architecture/DB-Migration-Implementation-Notes.md`

This is a plan, not a design. The design is fixed. Deviations from the PRD/design are called out explicitly as **Plan Questions** at the end.

---

## 1. Executive Summary

V1 delivers single-instance (`default` profile) cross-machine export / import / verify / inspect of ChromaDB + FalkorDB + repository metadata + `watched-folders.json`, with cross-OS path flexibility and allowlist-based content policy, and closes the long-standing FalkorDB standalone backup gap. The plan decomposes the work into **17 atomic PRs**, each bounded to <=400 LOC, sequenced so that two foundational refactors (per-adapter quiesce gate; path tokenization) land before any archive / CLI work begins.

**Biggest risks:** (1) per-adapter gate touches four writer surfaces and must not regress any existing ingestion path; (2) FalkorDB RDB-copy race and BGSAVE-complete detection require a spike before the adapter PR lands; (3) cross-OS integration testing is more infrastructure investment than existing tests require and needs a CI plan up front.

**Recommended cut:** `pk-mcp repo repath` is **fast-follow after GA**, not blocking GA — see §4.

---

## 2. Work Breakdown (17 PRs, all <=400 LOC)

Naming uses conventional-commit style since that's the project convention. Sizes are ideal-days for one engineer: **S = 1-2 days**, **M = 2-4 days**, **L = 4-6 days**. Any PR that would exceed the ~400 LOC ceiling has been pre-split.

All PRs share a common gate: `bun run typecheck` + `bun test` + `bun run build` green locally before push; >=90% coverage on new code; branch-based; no commits to main. This is reproduced below in the per-PR "Test Strategy" rows only where more specific tests matter.

### Foundation Layer (unblocks everything else)

---

#### PR-01 — `feat(migration): add MigrationLockGate + .migration.lock primitive`

- **Scope:** New module `src/services/migration/migration-lock-gate.ts` implementing:
  - `assertWritesAllowed()` / `probeLockState()` / `acquire()` / `release()` / heartbeat
  - `data/.migration.lock` file with `O_CREAT | O_EXCL`, JSON payload per ADR-0007
  - 500ms in-process TTL cache, `mtime`-based expiry (clock-skew resilient)
  - `MigrationQuiesceError` exported for callers
  - Stale-lock detection and atomic-rename reacquire
  - Process-local owner token for self-exception
- **Does NOT:** wire the gate into any adapter (that's PR-02..PR-05). No CLI surface yet.
- **Dependencies:** none.
- **Size:** S (new module, ~250 LOC + tests).
- **Test strategy:** unit tests for acquire / contention / stale-expiry / heartbeat / clock-skew / concurrent-process simulation (spawn two bun processes in a test helper). 100% coverage on this module — it's load-bearing.
- **Risk flags:** R2 (the lock is only useful if adapters honor it — validated in PR-02..PR-05).
- **Acceptance criteria:** ADR-0007 "Advisory lock design" section; FR-2.6 (consistency mechanism); gate module passes its own unit test suite.

---

#### PR-02 — `feat(storage): wire MigrationLockGate into ChromaStorageClient`

- **Scope:** Instrument six mutating methods in `src/storage/chroma-client.ts`: `addDocuments`, `upsertDocuments`, `deleteDocuments`, `createCollection`, `deleteCollection`, `deleteDocumentsByFilePrefix`. Each calls `assertWritesAllowed()` at the top. Add a "coverage unit test" that enumerates all exported mutating methods via reflection/type introspection and asserts each calls the gate (per ADR-0007 Validation Criteria).
- **Does NOT:** touch graph adapter, metadata store, or watched-folder store.
- **Dependencies:** PR-01.
- **Size:** S (6 methods, ~80 LOC of wiring + coverage test).
- **Test strategy:** unit test per method (lock-held raises; lock-held-by-self passes; lock-released passes). Adapter-coverage unit test per ADR-0007.
- **Risk flags:** R2.
- **Acceptance criteria:** ADR-0007 Validation Criteria bullet 1.

---

#### PR-03 — `feat(graph): wire MigrationLockGate into GraphStorageAdapter writes`

- **Scope:** Instrument `GraphStorageAdapter.runQuery` (write intent) and any raw Redis write commands in `src/graph/adapters/FalkorDBAdapter.ts`. Reads (read-intent Cypher, `MATCH`) pass through unchanged. Add the same adapter-coverage unit test pattern as PR-02.
- **Does NOT:** add BGSAVE/LASTSAVE/MODULE LIST ops surface (that comes in PR-08).
- **Dependencies:** PR-01.
- **Size:** S.
- **Test strategy:** unit tests for write Cypher (gated), read Cypher (not gated), adapter-coverage test.
- **Risk flags:** R2. Watch for any graph-populate CLI command that bypasses `runQuery`.
- **Acceptance criteria:** ADR-0007 Validation Criteria bullet 2.

---

#### PR-04 — `feat(repositories): wire MigrationLockGate into RepositoryMetadataStoreImpl`

- **Scope:** Instrument `updateRepository` and `removeRepository` in `src/repositories/metadata-store.ts`. Adapter-coverage unit test.
- **Does NOT:** introduce tokenization yet (PR-06/PR-07).
- **Dependencies:** PR-01.
- **Size:** S.
- **Test strategy:** unit tests + adapter-coverage test per ADR-0007 Validation Criteria bullet 3.
- **Risk flags:** R2.
- **Acceptance criteria:** ADR-0007 Validation Criteria bullet 3.

---

#### PR-05 — `feat(watched-folders): wire MigrationLockGate + caller-side error handling`

- **Scope:** Two parts kept together because they're small:
  1. Instrument `WatchedFolderStoreService.addFolder / updateFolder / removeFolder` in `src/services/watched-folder-store.ts`.
  2. Add caller-side `MigrationQuiesceError` handling per ADR-0007 §"Caller-side error handling": CLI commands abort with exit code and message; `ProcessingQueue` / `FolderDocumentIndexingService` defer-and-retry; MCP tool handlers (`trigger_incremental_update`) return `quiesce_in_progress` structured error with `retry_after_seconds` hint.
- **Dependencies:** PR-01 through PR-04 (all four gate sites need to be live before callers can sensibly handle the error).
- **Size:** M (~300 LOC across the service + caller-side helpers + tests; watch size, may need to split the caller-side helpers into a separate PR-05b if we bust 400 LOC).
- **Test strategy:** per-caller-type tests (CLI abort, queue defer, MCP structured error), plus adapter-coverage on the watched-folder store.
- **Risk flags:** R2. This is the most likely PR to need splitting — if LOC creeps, cut the MCP tool handler piece into PR-05b.
- **Acceptance criteria:** ADR-0007 "Caller-side error handling" section; `MigrationQuiesceError` surfaces sensibly from every caller class.

---

#### PR-06 — `feat(repositories): path-resolver helper module (tokenize + resolve)`

- **Scope:** New module `src/repositories/path-resolver.ts` exporting `tokenizePath()` and `resolveRepositoryPath()` per ADR-0008 §"Resolve/tokenize helpers". Handles `{{CLONE_ROOT}}` / `{{DATA_ROOT}}`, POSIX separator normalization in stored form, most-specific-root preference, case-insensitive matching on Windows, external-path detection with `externalPathOrigin` stamp. No integration into the metadata store yet.
- **Dependencies:** none (can parallel with PR-01..PR-05).
- **Size:** S.
- **Test strategy:** unit tests for: tokenize under CLONE_ROOT, tokenize under DATA_ROOT (non-clone), external-path detection, legacy absolute path on Windows read on Linux, legacy absolute path read on same OS, Windows-vs-Linux separator round-trip, case-insensitive Windows match. These tests are the foundation of FR-1.9 correctness.
- **Risk flags:** R3.
- **Acceptance criteria:** ADR-0008 Validation Criteria bullets covering path-resolver behavior.

---

#### PR-07 — `feat(repositories): integrate path-resolver into metadata store + consumers`

- **Scope:**
  - `RepositoryMetadataStoreImpl.updateRepository` calls `tokenizePath` before write; adds `pathFormat: "tokenized-v1"` top-level marker; materializes `isExternalPath` on legacy reads.
  - `RepositoryMetadataStoreImpl.loadMetadata` tolerates legacy absolute paths (backward-compat).
  - Consumers updated to call `resolveRepositoryPath`: `RepositoryCloner.cloneRepository` / `updateToLatest`, `remove-command.ts` (resolve then validate security boundary), `InterruptedUpdateRecoveryService`, `IncrementalUpdatePipeline` file-scan paths.
- **Dependencies:** PR-06.
- **Size:** M (~350 LOC — metadata store + four consumers + tests). Pre-split trigger: if consumer list grows, split the consumer updates into PR-07b.
- **Test strategy:** unit tests for metadata store tokenize-on-write + legacy tolerance; per-consumer test that a tokenized entry and a legacy entry both resolve correctly; preserved security boundary in `remove-command`; grep-based test that no bare `localPath` read exists outside `resolveRepositoryPath`.
- **Risk flags:** R3. Regression risk on existing ingestion paths is real — run full test suite twice.
- **Acceptance criteria:** ADR-0008 Validation Criteria bullets 1-6; `pathFormat: "tokenized-v1"` marker present in output; `remove-command` security check still refuses path-escape.

---

### Store-Adapter Layer (build the archive payload)

---

#### PR-08 — `feat(graph): FalkorDB ops primitives (BGSAVE, LASTSAVE, MODULE LIST, INFO)`

- **Scope:** Extend the FalkorDB adapter (or add a thin sibling `src/graph/adapters/falkordb-ops-client.ts`) to support raw Redis commands needed for backup: `BGSAVE`, `LASTSAVE`, `INFO server`, `INFO persistence`, `INFO modules`, `MODULE LIST`. Version-detection helper `detectFalkorDbVersion()` implementing ADR-0006's MODULE LIST primary / INFO modules fallback / hard-refuse-on-neither strategy, minimum version v4.0.0.
- **Does NOT:** orchestrate a backup. No Docker sidecar. No RDB file copy.
- **Dependencies:** PR-03 (so writes are gated; BGSAVE itself is NOT a write and should bypass the gate via self-exception).
- **Size:** S.
- **Test strategy:** unit tests mocking Redis responses for `MODULE LIST` parsing (packed integer decode), version-detection fallback chain, refuse-if-no-version. Integration test spike against a live `falkordb/falkordb:v4.4.1` container (required for ADR-0006 T2 confirmation — already verified in the spike, but regression-test it here).
- **Risk flags:** R5 (version-field shape). Spike already resolved this per ADR-0006, but this PR is where it gets codified.
- **Acceptance criteria:** ADR-0006 "Version Detection Strategy" section; version detection refuses on pre-v4.0.0 or missing version; integration test against pinned image passes.

---

#### PR-09 — `feat(scripts): FalkorDB standalone backup/restore scripts (sh + ps1)`

- **Scope:** New files:
  - `scripts/backup-falkordb.sh`
  - `scripts/backup-falkordb.ps1`
  - `scripts/restore-falkordb.sh`
  - `scripts/restore-falkordb.ps1`
  Mirror flag surface of existing `scripts/backup-chromadb.*` (`--backup-dir`, `--retention`, `--volume`, `--dry-run`, `--quiet`, `--bgsave-timeout`). Sourcing `FALKORDB_PASSWORD` from env (no echo, no log). Uses `redis:alpine` sidecar for `redis-cli` commands and a second Alpine sidecar for `dump.rdb` copy. Deprecation markers on `scripts/backup-neo4j.*`, `scripts/restore-neo4j.*`, `scripts/test-backup-restore-neo4j.sh` with forward pointers. Update `docs/docker-operations.md` to remove stale Neo4j references.
- **Dependencies:** none for the scripts themselves. Can land in parallel with any of PR-01..PR-08. Marked here because the design calls for the standalone scripts to exist before the TS adapter reuses the same primitives.
- **Size:** M (four scripts × two platforms, plus deprecation + doc updates).
- **Test strategy:** script-level integration tests that run the backup script against a live FalkorDB container, verify `dump.rdb` extracted, restore the backup into a fresh container, smoke-query with `GRAPH.QUERY knowledge_graph "MATCH (n) RETURN count(n)"`. Run on both PowerShell (Windows CI) and bash (Linux CI) — this is the first cross-platform integration test in the plan.
- **Risk flags:** R4 (Docker volume "swap" semantics). Password handling under PowerShell quoting rules is the single biggest foot-gun.
- **Acceptance criteria:** PRD FR-6.1 through FR-6.4; US-3 acceptance criteria; scripts parity with ChromaDB scripts; Neo4j scripts deprecated or removed; `docs/docker-operations.md` updated.

---

#### PR-10 — `feat(migration): manifest schema + reader/writer`

- **Scope:** New modules under `src/services/migration/`:
  - `manifest-schema.ts` — Zod schema + TS types for manifest v1 per ADR-0005 + ADR-0006 module-version fields + ADR-0008 `repositories.externalPaths` summary.
  - `manifest-writer.ts` / `manifest-reader.ts` — read `package.json.version` for `pkMcpVersion`, `os.hostname()` + `process.platform` for `source.*`, calls version-detection from PR-08 for FalkorDB fields, `docker inspect` helper for image tags.
  - New `src/services/migration/docker-inspect.ts` helper invoking `docker inspect <container> --format '{{.Config.Image}}'` via `Bun.spawn`.
- **Dependencies:** PR-08 (FalkorDB version detection).
- **Size:** M.
- **Test strategy:** unit tests for schema validation (happy path + each rejection case), manifest round-trip, reader tolerates additive `manifestVersion` minor bumps and refuses major mismatches.
- **Risk flags:** R6 (byte-identical SHA is relaxed — enshrine "per-artifact hashes verify end-to-end" as the V1 criterion in tests).
- **Acceptance criteria:** ADR-0005 "Manifest schema (v1)" section; ADR-0006 "Manifest schema update" section; FR-1.4.

---

#### PR-11 — `feat(migration): ChromaDB backup/restore adapter (TS)`

- **Scope:** New `src/services/migration/adapters/chromadb-adapter.ts` implementing the `StoreBackupAdapter` interface from design §3.1:
  - `preflight`: Docker running, container up, volume present
  - `snapshot`: Alpine sidecar tar of the `chromadb-data` volume (mirror `scripts/backup-chromadb.sh` logic in TS), SHA-256 the output, capture image tag via PR-10's docker-inspect helper. Supports `--compose-project-name` flag (T3).
  - `restorePreflight`: version compare against manifest, disk-space check (2x archive size)
  - `restore`: stop container, set-aside copy of live volume to `chromadb-data-migration-setaside-<ts>`, clear live volume, copy archive contents in, start container, health-check
  - `rollback`: clear live, copy set-aside back, start container
- **Dependencies:** PR-10. Independent of graph adapter work.
- **Size:** M.
- **Test strategy:** unit tests with mocked Docker interactions; integration test against a live ChromaDB container: populate → snapshot → wipe → restore → verify collections match.
- **Risk flags:** R4 (rollback-by-set-aside wording, not "atomic swap" — tests must cover the rollback path explicitly).
- **Acceptance criteria:** FR-1.1 (archive contains ChromaDB), FR-3.8 (restored queries work), FR-3.6 (documented partial-failure state).

---

#### PR-12 — `feat(migration): FalkorDB backup/restore adapter (TS)`

- **Scope:** New `src/services/migration/adapters/falkordb-adapter.ts`. Parallels PR-11 for FalkorDB:
  - `snapshot`: issue `BGSAVE` via PR-08 client, poll `LASTSAVE` + `INFO persistence` (`rdb_bgsave_in_progress == 0` AND `rdb_last_bgsave_status == ok` — T7), copy `dump.rdb` via Alpine sidecar, SHA-256, capture image tag + module version + redis version + rdb format into manifest fields (from PR-10).
  - `restore`: stop container, set-aside volume copy, drop `dump.rdb` into volume, start, health-check (`PING` + smoke `GRAPH.QUERY` per ADR-0006).
  - `rollback`: mirror PR-11 pattern.
- **Dependencies:** PR-08, PR-10. Can land in parallel with PR-11.
- **Size:** M.
- **Test strategy:** integration test against live FalkorDB container: populate graph → snapshot → wipe → restore → `MATCH (n) RETURN count(n)` matches. Test version-mismatch refusal path. Test RDB-copy race-safety (T7).
- **Risk flags:** R5, module-load-on-restore (feasibility §3, item 2).
- **Acceptance criteria:** FR-1.2, ADR-0006 validation criteria.

---

#### PR-13 — `feat(migration): metadata snapshot adapter + allowlist sanitizer`

- **Scope:** New `src/services/migration/adapters/metadata-adapter.ts`:
  - `snapshot`: read `data/repositories.json`, tokenize paths at snapshot-assembly time (per ADR-0008 — the source may still have legacy absolute paths; tokenizer normalizes them before the archive is written); read `watched-folders.json` with the same tokenization rules (T13); emit sanitized `instance-config.json` per design §8 allowlist.
  - `restore`: write `repositories.json` into place; write `watched-folders.json`; handle external-path entries per PR-16 (stubbed to throw here; PR-16 fills it in).
- **New module** `src/services/migration/config-allowlist.ts`: schema-driven filter per design §8; fail-closed on unknown key (build breaks via unit test). Allowlist content: `instance.name`, `instance.tier` (reserved), `instance.dataPath` (tokenized), Chroma URL host/port, FalkorDB host/port, embedding provider name / model / endpoint, non-secret tuning knobs. Never: auth tokens, API keys, passwords.
- **`.env` handling**: not in allowlist, not in archive. Documented in README.txt that ships inside the archive.
- **Dependencies:** PR-06, PR-07, PR-10.
- **Size:** M.
- **Test strategy:** allowlist unit tests covering every legal field and at least five illegal fields including a "new field added in a future PR" case that fails the build. Snapshot-and-restore round-trip: legacy absolute paths tokenize on snapshot, restore on target yields tokenized output. External-path round-trip (path preserved verbatim, marker set, origin captured).
- **Risk flags:** R9 (secrets leak if allowlist wrong). Fail-closed test is the load-bearing guardrail.
- **Acceptance criteria:** FR-1.3, FR-1.5, FR-1.10, FR-1.11 (archive side only; restore UX in PR-16).

---

### CLI + Orchestrator Layer

---

#### PR-14 — `feat(migration): orchestrator + archive packaging (tar.gz + SHA)`

- **Scope:** New `src/services/migration/migration-orchestrator.ts` coordinating the three adapters in design §4.1's backup order (fsync metadata → BGSAVE trigger → Chroma tar → poll + copy RDB → write metadata last). New `src/services/migration/archive-writer.ts` and `archive-reader.ts` doing tar.gz packaging. Decision per feasibility §2.3: use `tar-stream` / `node-tar` Bun-native library rather than shelling out to system tar, to sidestep GNU tar vs bsdtar determinism pain. Envelope SHA-256 sidecar.
- **Does NOT:** CLI surface (that's PR-15).
- **Dependencies:** PR-01 through PR-13 except PR-09 (scripts are independent).
- **Size:** M-L (watch LOC — orchestrator + archive I/O is where size creeps; pre-split trigger: if packaging grows past 200 LOC, split archive I/O into PR-14b).
- **Test strategy:** integration test for full orchestrator flow against live containers; unit tests for archive packaging (determinism of per-artifact SHAs, not envelope SHA — R6 relaxation).
- **Risk flags:** R4, R6, R8 (CI investment).
- **Acceptance criteria:** FR-1.4, FR-1.7, FR-1.8, FR-2.6, FR-2.9; design §4.1 backup sequence.

---

#### PR-15 — `feat(cli): pk-mcp migrate export / import / verify / inspect commands`

- **Scope:** New `src/cli/commands/migrate-export-command.ts`, `migrate-import-command.ts`, `migrate-verify-command.ts`, `migrate-inspect-command.ts`. Register under a new `migrate` Commander subcommand group in `src/cli/index.ts` (matches existing `graph`, `token`, `watch`, `documents` pattern). Flags per design §5.1-§5.2: `--output`, `--stores`, `--bgsave-timeout`, `--quiesce-wait`, `--no-verify`, `--dry-run`, `--quiet`, `--yes`, `--allow-minor-drift`, `--staging-dir`, `--keep-set-aside`. Deferred flags (`--instance`, `--encrypt`, `--include-repos-source`) fail fast with "not yet supported in V1; see V1.x roadmap" message. Validation schemas in `src/cli/utils/validation.ts` (Zod).
- **Dependencies:** PR-14.
- **Size:** M.
- **Test strategy:** unit tests for each command's flag parsing; integration test: run `migrate export` on a populated instance, then `migrate inspect` on the output. Verify deferred flags fail fast with correct messages.
- **Risk flags:** CLI naming (`migrate` vs `backup`): PRD picks `migrate`; design §5 already aligned to `migrate`. No ambiguity remains.
- **Acceptance criteria:** FR-2.1, FR-2.3, FR-2.7, FR-2.8, FR-2.9, FR-3.1, FR-3.2, FR-3.4, FR-3.5, FR-3.7, FR-4.1, FR-4.2, FR-4.3, FR-5.1, FR-5.3; US-1, US-2, US-4, US-7, US-8, US-9 acceptance criteria (modulo external-path and cross-OS pieces handled in PR-16 and PR-17).

---

#### PR-16 — `feat(migration): external-path restore UX (prompt, --external-path-map, broken marker)`

- **Scope:** External-path handling during `migrate import` per ADR-0008 §"Restore-side behavior":
  - TTY detection + interactive prompt (path / skip / remove)
  - `--external-path-map <file>` flag accepting JSON/YAML `{ name: newPath }`
  - Non-interactive default: skip with loud warning, exit 0
  - `pathStatus: "broken"` marker in `repositories.json`; consumers (`RepositoryCloner`, etc.) refuse broken entries
  - `fs.realpath` validation of user-supplied remap paths; refuse `..` escapes; refuse paths under `CLONE_ROOT` (external entries must stay external)
  - Manifest `externalPaths` summary consumed up-front so prompting happens before destructive actions
- **Does NOT:** ship `pk-mcp repo repath` subcommand. That's deferred — see §4.
- **Dependencies:** PR-13, PR-15.
- **Size:** M.
- **Test strategy:** unit tests for each restore branch (exists, TTY prompt variants, non-interactive skip, map-remap, invalid map, security refusals). End-to-end integration test: archive with external-path entry → restore with missing path → verify broken marker set and `RepositoryCloner` refuses.
- **Risk flags:** UX-sensitive; user confusion on non-interactive skip is a real risk. Documentation in PR-17 must be crisp.
- **Acceptance criteria:** FR-1.11, FR-3.10; US-11; ADR-0008 Validation Criteria bullets 7-9.

---

#### PR-17 — `docs(migration): README section, docker-operations.md, runbooks, K8s appendix`

- **Scope:**
  - README.md: new "Migration / Backup" section with quick-start examples for export, import, verify, inspect.
  - `docs/docker-operations.md`: already partially updated in PR-09; extend with the TS migration tool as the canonical flow and standalone scripts as escape hatches.
  - `docs/migration/runbook.md` (new): machine-move runbook covering cross-OS (Windows↔Linux), cross-install-path, external-path remediation, non-interactive / CI use.
  - `docs/migration/kubernetes.md` (new): runbook-only guidance per PRD US-10, honest about the Docker-socket limitation flagged in feasibility §3 item 3. No operator; no manifests beyond what's needed to drive the CLI.
  - Release notes outline for V1 GA.
- **Dependencies:** PR-15, PR-16 (docs follow code).
- **Size:** S-M depending on runbook depth.
- **Test strategy:** doc review only; links checked.
- **Risk flags:** none.
- **Acceptance criteria:** FR-6.4; PRD §10.2 "stale Neo4j references = zero"; US-5 / US-10 documentation bullets.

---

## 3. Dependency Graph / Critical Path

```
                        PR-01 (MigrationLockGate)
                          |
          +---------------+---------------+---------------+
          |               |               |               |
        PR-02           PR-03           PR-04           PR-05
       (Chroma         (Graph          (Metadata       (Watched-folder
        gate)           gate)           gate)           gate + callers)
          |               |               |               |
          +---------------+---------------+---------------+
                                  |
                                  +--------+
                                           |
              PR-06 (path-resolver)        |
                  |                        |
              PR-07 (integrate             |
                  resolver + consumers)    |
                  |                        |
                  +----------+-------------+
                             |
                  +----------+----------+
                  |                     |
               PR-08 (FalkorDB ops      PR-09 (standalone
                  primitives)             scripts — PARALLEL)
                  |
               PR-10 (manifest schema)
                  |
          +-------+-------+-------+
          |               |       |
        PR-11           PR-12   PR-13
       (Chroma         (Falkor  (Metadata
        adapter)        adapter) adapter +
          |               |      allowlist)
          +-------+-------+
                  |
               PR-14 (orchestrator +
                      archive packaging)
                  |
               PR-15 (CLI commands)
                  |
               PR-16 (external-path UX)
                  |
               PR-17 (docs)
```

### Critical Path

**PR-01 → PR-05 → PR-07 → PR-10 → PR-14 → PR-15 → PR-16 → PR-17**

That's 8 PRs on the critical path. Everything else is either prerequisite-parallel or wait-blocked on critical-path items.

### Parallelization Opportunities

- **PR-02, PR-03, PR-04** can land in parallel once PR-01 is merged (different adapter files, no shared surface).
- **PR-06** can start as soon as PR-01 begins (no dependency).
- **PR-09** (standalone scripts) is completely independent of the critical path and should be scheduled first for a single engineer because it resolves the longest-standing user pain (FalkorDB has no backups today) and delivers standalone value before the TS migration tool is done. If multiple engineers, PR-09 is an obvious parallel track.
- **PR-08** needs PR-03 merged (adapter gate) but not PR-04/PR-05/PR-06/PR-07.
- **PR-11, PR-12, PR-13** can all land in parallel once PR-10 ships.

### Approximate Serial Length (one engineer)

Summing critical-path PR sizes: S + M + M + M + L + M + M + S = **~22-28 ideal-days**. Add ~20-30% buffer for review cycles and integration-test flakiness, landing in the **5-7 week** band for one engineer, which tracks the feasibility review's "4-8 dev-weeks" estimate. Schedule windows are stakeholder-owned; this plan does not assign calendar dates.

---

## 4. Milestones

### V1 Alpha — "Same-OS export/restore, no external paths"

**Goal:** Prove the core pipeline end-to-end on a single OS family. This is the "does it move data at all?" milestone.

**Cut at:** PR-01 through PR-15 merged. Specifically:
- Quiesce gate across all four writer surfaces (PR-01..PR-05)
- Path tokenization merged and consumers migrated (PR-06, PR-07) — tokenization is load-bearing even on same-OS moves because the source archive could contain legacy absolute paths
- FalkorDB ops + standalone scripts shipped (PR-08, PR-09) — US-3 unblocked standalone
- All three store adapters + manifest + orchestrator + CLI (PR-10..PR-15)

**Explicitly NOT in Alpha:**
- External-path restore UX (PR-16) — alpha refuses external-path entries with a clear "not yet implemented" error
- Cross-OS roundtrip validation (tested, but not Beta-committed)
- Docs polish (PR-17)

**Success criteria for Alpha sign-off:**
- Windows→Windows and Linux→Linux round-trip: `pk-mcp migrate export`, move file, `pk-mcp migrate import`, `pk-mcp migrate verify` returns all-MATCH on a medium (5-10 repo) instance.
- Export time under 5 minutes for medium instance.
- Quiesce window under 30 seconds for medium instance.
- All unit + integration tests pass on Windows CI + Linux CI.

### V1 Beta — "Cross-OS roundtrip confidence"

**Goal:** US-5 (cross-OS / cross-install restore) works end-to-end, and external-path entries are handled with the PRD-required diagnostic.

**Cut at:** PR-16 merged. Alpha + external-path UX + cross-OS integration tests passing.

**Beta-specific validation (see §6):**
- Windows→Linux and Linux→Windows round-trip tests in CI on every PR, not just ad hoc.
- External-path round-trip: archive contains an external-path entry, restore on machine where path doesn't exist, verify prompt / map / skip behaviors all work correctly.
- Legacy archive (pre-ADR-0008 absolute paths) restores cleanly on a post-ADR-0008 install.

**Explicitly NOT in Beta:**
- Final docs polish (still PR-17)
- `pk-mcp repo repath` — see decision below

### V1 GA — "Full PRD V1 scope shipped, verified, documented"

**Goal:** Every V1 FR in the PRD has shipping code + tests + docs. Release notes written.

**Cut at:** PR-17 merged.

**GA-specific validation:**
- All ten PRD V1 success metrics instrumented (or explicitly documented as "measured manually / via self-report").
- All V1 scenarios in PRD §5.4 (Scenario 1 laptop refresh, Scenario 2 DR, Scenario 3 pre-upgrade snapshot) executed on real hardware.
- Performance targets from PRD §7.1 verified on reference hardware and recorded in the V1 release notes.
- Runbook walked through by someone not on the dev team.

### Decision: `pk-mcp repo repath` — Fast-Follow After GA

**Recommendation:** Ship as fast-follow V1.0.1, not blocking V1 GA.

**Rationale:**
- PRD and ADR-0008 list repath as design-level commitment, not a V1 hard requirement. The PRD's US-11 acceptance criteria are satisfied by PR-16's prompt/map/skip/remove restore UX.
- Non-interactive restore with broken external-path entries is handled (skip with warning) without the subcommand. Users can still edit `repositories.json` by hand or delete and re-add if urgent.
- Splitting it out keeps the V1 critical path tight and avoids a 4-5 day subcommand PR landing after PR-16's already-complex restore-UX PR.
- Tracked as a follow-up (see §10).

**What would change my mind:** if Beta user testing reveals that editing `repositories.json` manually is a common enough pain point that GA ships with an unacceptable bug-report rate, bump it into V1 GA as PR-17b and accept the schedule hit.

---

## 5. Risk Register

Severity = **H/M/L** for impact × likelihood. Risks below are the feasibility review's 10 + two raised in program management.

| # | Risk | Sev | Owner role | Mitigation | Trigger that changes plan |
|---|------|-----|-----------|------------|---------------------------|
| R1 | FalkorDB is not per-instance today; multi-instance can't ship without prerequisite infrastructure | — | Architect | **Already mitigated:** deferred to V1.x by PRD v1.1. Plan does not address multi-instance at all. | If stakeholder reopens multi-instance for V1, plan must add 2-3 infra PRs (docker-compose extension, `instance-config.ts` Falkor sub-object, per-instance FALKORDB_* env) *before* PR-08. That's another ~2 weeks. |
| R2 | Per-adapter gate needs instrumentation across 4 writer surfaces; missed caller path silently breaks consistency | H | Eng + Architect | PR-02..PR-05 each land with an adapter-coverage unit test that enumerates exported mutating methods and fails CI if one skips the gate. ADR-0007 Validation Criteria makes this a hard gate. | If the adapter-coverage test turns out not to be feasible (reflection limits in TypeScript), fall back to a grep-based test in CI as a weaker guardrail and add a code-review checklist. |
| R3 | Path tokenization is load-bearing for FR-1.9 and touches every `localPath` consumer | H | Eng | PR-06 lands first with full test matrix (Windows/Linux/legacy/external). PR-07 batches consumers into one PR so reviewer sees the whole surface. Grep-test blocks bare `localPath` reads in consumer code. | If consumer list grows past ~6 files mid-implementation, split PR-07 into PR-07a (metadata store) and PR-07b (consumers). |
| R4 | "Atomic volume swap" is actually rollback-via-set-aside; tests must cover the rollback path | M | Eng | PR-11 and PR-12 each include an explicit rollback test (simulate failure mid-restore, verify set-aside copy restored). Doc PR explicitly says "rollback via set-aside, not filesystem-atomic." | If rollback test turns up race conditions on Windows Docker Desktop specifically, allocate a spike day. |
| R5 | FalkorDB `MODULE LIST` field shape or RDB-copy race | M | Eng | Spike already resolved via ADR-0006 empirical verification against `v4.4.1`. PR-08 codifies the packed-integer parser. PR-12 polls `INFO persistence` *and* `LASTSAVE` per T7. | If `MODULE LIST` shape changes in a FalkorDB minor-version bump during V1 development, update parser and add a regression test; no plan change. |
| R6 | Byte-identical cross-platform archive SHA is not achievable with stock tar | L | Architect (accepted) | **Already mitigated:** ADR-0005 validation criterion relaxed to "per-artifact hashes verify end-to-end." PR-10's tests enforce the relaxed criterion. | None — relaxation stands. |
| R7 | `--include-repos-source` portability landmines | — | — | **Already deferred** to V1.x. Plan does not include this. | If reopened, delay V1 by ~1 week to design the cross-OS git worktree strategy. |
| R8 | Integration-test infrastructure (real Docker, two stores, cross-platform) is heavier than existing test setup | H | Eng + PM | See §6 "Testing Strategy Summary." PR-09 is the canary (first cross-platform integration test); it lands early specifically to shake out CI infrastructure before PR-11 / PR-12 / PR-14 land. Consider `testcontainers-node` dev-dep. | If PR-09's CI pipeline takes >3 days to stabilize, halt the critical path and invest a spike week in the test harness before continuing. |
| R9 | Secrets leak via misconfigured allowlist | M | Architect + Eng | PR-13 includes a fail-closed unit test: unknown key in `instance-config.json` fails the build. Architect owns the exact allowlist per PRD FR-1.5. | If allowlist specification drifts during implementation, freeze-and-review before PR-13 merges. |
| R10 | Quiesce-timeout behavior (abort vs. force-cancel) is a UX call | L | PM | Plan adopts the feasibility review's recommendation: **abort with clear message** for V1. Force-cancel is not implemented. | If users push back in Beta for "I don't want my export to fail just because an ingest is running," reopen in V1.0.1. |
| R11 (new) | Neo4j driver still in `package.json` and `src/graph/schema/neo4j.ts` still exists — FR-6.3 "remove/deprecate stale scripts" is ambiguous about whether driver removal is in scope | L | PM | PR-09 deprecates the Neo4j *scripts* (the PRD's explicit ask). Driver removal and `src/graph/schema/neo4j.ts` cleanup are **out of scope** for V1 per feasibility §2.7; tracked as a follow-up in §10. | If stakeholder wants driver removed in V1, add PR-09b (~S), no critical-path impact. |
| R12 (new) | Docker volume name prefix depends on Compose project name (`personalknowledgemcp_*`) — breaks if user clones to a different dir (T3) | L | Eng | PR-11 implements volume-name regex and `--compose-project-name` flag. Existing Chroma scripts already do this; mirror that. | None if tests cover non-default project name. |

**Top 3 for stakeholder briefing before greenlight (per task instructions):** R2, R8, R1 (the last one only in the sense of "confirm it stays deferred").

---

## 6. Testing Strategy Summary

Project standard: **90% coverage on new code**, enforced via `bunfig.toml`. Plan-specific detail below.

### Layer-by-layer

- **Unit tests (Bun test)**: every new module, every gate integration, allowlist, path-resolver. Mocked Docker where possible. ~80% of total test volume.
- **Integration tests (real containers)**: Chroma adapter, FalkorDB adapter, orchestrator end-to-end. Require `docker-compose up -d` in `beforeAll`. Feasibility §3 item 6 warns this is more ceremony than existing tests — plan accepts this and lands PR-09 first specifically to establish the harness.
- **Cross-platform integration tests**: dual-runner CI matrix (Windows + Linux). PR-09 proves out the matrix; PR-11/12/14 rely on it. See "Cross-OS roundtrip" below.
- **End-to-end scenario tests**: PRD §5.4 Scenarios 1-3 scripted as smoke tests runnable locally; optionally in CI on nightly.

### Cross-OS roundtrip coverage (load-bearing for FR-1.9)

This is the single most important test investment in the plan. Two approaches being evaluated — **decision deferred to engineer during PR-09**:

**Option A (preferred if CI infra permits):** CI matrix runs on both Windows and Linux runners. PR includes a test that:
1. On Linux runner: produce an archive against a populated instance, upload as CI artifact.
2. On Windows runner: download the Linux-produced archive, restore into a fresh Windows instance, run `verify`, assert all-MATCH.
3. Reverse direction (Windows-produced, Linux-restored).
4. Same-install-path and different-install-path variants of each direction.

**Option B (fallback):** A single-platform runner does both operations using WSL or a second Docker context to simulate the other OS. Cheaper but less rigorous.

Decision criterion: if the test harness work for Option A exceeds 2-3 days, fall back to Option B and document the gap.

### Per-adapter gate test coverage without matrix explosion

Per-adapter-coverage unit test (one per adapter, 3-4 total) enumerates exported mutating methods and asserts each calls `MigrationLockGate.assertWritesAllowed()`. Per-caller tests (CLI, queue, MCP handler) are small (3 tests × 3 caller types = 9 tests). Total: ~12-15 tests covering the consistency story end-to-end, not N×M as the ADR feasibility audit warned.

### FalkorDB version-detection test location

Lives in PR-08. Integration test against a live `falkordb/falkordb:v4.4.1` container (pinned in `docker-compose.yml`). Regression-tests the `MODULE LIST` + `INFO modules` + refuse-on-neither strategy. If the pinned image ever changes in `docker-compose.yml`, this test catches the version-detection regression.

### Coverage targets per PR

- PRs 01, 06, 10, 13 (new modules): aim for 100% because they're isolated and load-bearing.
- PRs 02-05 (adapter integrations): 95% (the small uncovered slice is error paths that require process-kill simulation).
- PRs 07, 08, 11, 12, 14 (orchestration + adapters): 90%, project standard.
- PR 15 (CLI): 85-90% — CLI plumbing has inherent coverage gaps around signal handling.
- PR 16 (external-path UX): 90%, with explicit coverage of each branch in the prompt/map/skip logic.

---

## 7. Dependencies on External / Prerequisite Work

Things that must be resolved **before PR-01 starts**, in order of urgency:

1. **Stakeholder greenlight on this plan.** Baseline.
2. **Architect sign-off on the allowlist specification for `instance-config.json`.** PRD FR-1.5 says "the architect owns the exact allowlist specification." This is the input to PR-13. If the spec isn't written, PR-13 blocks. **Recommend architect delivers the allowlist as a small update to ADR-0005 or a new `docs/architecture/migration-allowlist.md` before PR-13 starts (not before PR-01).**
3. **FalkorDB image pin confirmation.** `docker-compose.yml` currently pins `v4.4.1`. ADR-0006's version-detection strategy is validated against this pin. If the pin is about to change as part of another workstream, coordinate so PR-08's regression test targets the right image. **Recommend: confirm with architect that `v4.4.1` holds through V1 GA, or bump the pin now and re-run the spike.**
4. **CI runner availability for Windows + Linux matrix.** The current repo's CI setup needs to be checked — if it's Linux-only today, PR-09 will also carry the "add Windows runner" plumbing, which roughly doubles that PR's size. **Recommend PM verifies CI infra before PR-09 kicks off; if Windows runners aren't already in the CI config, budget a pre-PR spike.**
5. **Decision on `testcontainers-node` adoption.** Feasibility §3 item 6 flags this as a real choice. Going without means a custom docker-compose test harness; going with it means a new dev dependency and a learning curve. **Recommend engineer makes the call during PR-09 setup; no PM involvement needed once the call is logged.**
6. **Nothing else.** All other prerequisites (PRD approval, ADRs 0005-0008, feasibility review) are already done.

---

## 8. Scope Guardrails — What's NOT in V1

PRD §13.1 lists the three primary deferrals. The concern during implementation is scope creep from "while we're already in the code, let's just add X." Guardrails below.

| Deferred item | Likely scope-creep trigger | Guardrail |
|---------------|---------------------------|-----------|
| **Multi-instance** (`--instance` beyond `default`) | Someone sees ChromaDB per-instance in `docker-compose.yml` and thinks the whole feature is "close" | PR-15 rejects non-default `--instance` values with an explicit "deferred to V1.x — tracked in PRD US-D1" message. Don't remove the message early. |
| **Encryption** (`--encrypt`) | Someone argues it's trivial because Bun has AES-256-GCM built in | PRD §13.1 rationale is explicit: crypto tool choice (age vs openssl vs Bun-native) is its own design decision. Refuse out-of-band additions. Users wrap the tarball themselves until V1.x. |
| **`--include-repos-source`** | Someone says "DR users really need offline restore" | PRD rationale: cross-OS portability landmines (symlinks / CRLF / `.git/config`). Users `tar data/repositories/` themselves until V1.x. |
| **Incremental backups** | Archive sizes make routine DR feel painful | PRD §11 accepts this; plan does not address. Tracked as V1.x+. |
| **Per-repo selective migration** | Someone wants to move "just repo X" out of a bigger instance | PRD non-goal #2. Refuse. |
| **Cross-major schema migration** | User upgrades between export and import | PRD non-goal #4; version-gate refuses. |
| **K8s operator** | Someone tries to build one because they have a k8s cluster | PRD non-goal #8; ship runbook only (PR-17). |
| **Auto-rollback across all three DBs** | A review flags "what if Chroma restores but Falkor fails?" | PRD non-goal #10; design §4.3 documents the per-phase failure state. Don't extend rollback logic beyond the per-adapter set-aside. |

**Escalation rule:** any PR that grows scope into a deferred item must be rejected in review and opened as a separate issue against the V1.x backlog. PM owns enforcement.

---

## 9. Rollout & Verification Plan

### Pre-GA smoke tests (Beta exit criteria)

1. **Same-OS round-trip (Linux-Linux):** Populate a medium instance (5-10 repos + 1 watched folder + 1 external-path entry), export, wipe, import, verify. All-MATCH.
2. **Same-OS round-trip (Windows-Windows):** Same as above on Windows.
3. **Cross-OS round-trip (Windows→Linux):** Export on Windows with DATA_PATH at `C:\src\...`, restore on Linux with DATA_PATH at `/home/seth/...`, verify. All-MATCH for clone-managed entries; external-path entry prompts correctly.
4. **Cross-OS round-trip (Linux→Windows):** Reverse of #3.
5. **Cross-install-path (same OS):** Export on Linux with DATA_PATH=A, restore on same Linux with DATA_PATH=B, verify.
6. **External-path interactive remediation:** Restore on machine where external path doesn't exist; prompt offered; accept new path; restore completes; re-verify.
7. **External-path non-interactive:** Same as #6 with `--yes`; verify exit 0 + warning + broken marker; no corrupt state.
8. **External-path map:** Same as #6 with `--external-path-map`; verify remap without prompt.
9. **Version mismatch refused:** Restore an artificially-bumped archive onto a lower version; verify refusal with clear error.
10. **Partial-failure state documented:** Kill the orchestrator mid-export and mid-restore; verify documented state (per FR-3.6); next run detects and offers resume/abandon.

### Performance targets from PRD §7.1 (measured on reference hardware pre-GA)

- Medium instance export: p95 < 5 min.
- Quiesce window p95 < 30 sec for medium instance.
- Import within 2× export time.
- Archive size < 1.2× raw data.

Target measurements recorded in V1 release notes.

### "Done" definition

GA ships when all of:
- PR-01 through PR-17 merged to main.
- All 10 pre-GA smoke tests pass on reference hardware in a single day.
- All four performance targets met.
- README.md, `docs/docker-operations.md`, `docs/migration/runbook.md`, `docs/migration/kubernetes.md` reviewed by someone not on the dev team.
- Release notes written.
- Retrospective scheduled.

---

## 10. Follow-Ups Tracker

Lightweight backlog — not issues, not a formal register, just "don't lose these." Convert to GitHub issues when appropriate.

| ID | Item | Source | Target |
|----|------|--------|--------|
| F1 | **`pk-mcp repo repath <name> <new-path>` subcommand** (ADR-0008 T14) | Design, ADR-0008 §Refactor Sizing, this plan §4 | V1.0.1 fast-follow |
| F2 | **Watched-folders path-resolver shared with Phase 6** (design T13) | Design §13 | Phase 6 implementation — architect to confirm shared module at Phase 6 kickoff |
| F3 | **Multi-instance support** (US-D1) with FalkorDB per-instance prerequisite | PRD §13.1 | V1.x |
| F4 | **Optional passphrase encryption** (US-D2, `--encrypt`) | PRD §13.1 | V1.x |
| F5 | **`--include-repos-source`** (US-D3) | PRD §13.1 | V1.x |
| F6 | **Logical-export fallback for cross-major FalkorDB migration** (ADR-0006 §Logical-export fallback) | ADR-0006 | V1.x+ |
| F7 | **Neo4j driver removal** from `package.json` + `src/graph/schema/neo4j.ts` + `src/graph/adapters/Neo4j*` | Feasibility §2.7 | Separate refactor, not migration-feature scope |
| F8 | **Signed archives / PKI provenance** | PRD §9.5 | Long-term future (§13.2) |
| F9 | **Incremental / differential backups** | PRD §13.2 | Long-term future |
| F10 | **Cloud-native archive targets** (`s3://`, `az://`) | PRD §13.2 | Long-term future |
| F11 | **K8s operator / CRD** | PRD §13.2 | Long-term future |
| F12 | **Automated scheduled exports** (`pk-mcp migrate schedule`) | PRD §13.2 | Long-term future |
| F13 | **Post-restore HNSW warm-up** (feasibility §3 item 12) | Feasibility notes T10 | V1.0.1 fast-follow if users complain |
| F14 | **MCP HTTP/SSE graceful pre-stop broadcast during restore** (feasibility §3 item 8) | Feasibility notes T11 | V1.x |
| F15 | **`PATH_ROOTS` diagnostics in `pk-mcp status --verbose`** (ADR-0008 TODO) | ADR-0008 Implementation Notes | Quality-of-life nice-to-have, V1.0.1 or V1.x |

---

## 11. Plan Questions (inconsistencies or open items to flag, not fix)

These are places where the authoritative design artifacts are either internally inconsistent or leave something ambiguous that implementation will bump into. Per the task instructions, I'm flagging rather than fixing.

1. **CLI name drift appears to be resolved, but worth reconfirming.** Feasibility §2.4 flagged `migrate` (PRD) vs `backup` (earlier design) as a conflict. The current `DB-Migration-Design.md` §5 uses `migrate`. Assuming this is settled; PR-15 uses `migrate`. Confirm with architect if any stale references remain in ADRs.

2. **Allowlist specification owner.** PRD FR-1.5 says "the architect owns the exact allowlist specification." Design §8 enumerates allowlisted fields but it's unclear whether that enumeration IS the spec or is a sketch. PR-13 needs this to be definitive. Architect to confirm: is design §8 the normative spec, or is a separate artifact coming?

3. **PRD FR-6.3 "remove or mark deprecated" for stale Neo4j scripts — pick one.** Plan proposes "deprecate in PR-09, remove in a follow-up." Confirm this is acceptable vs. removing outright. (Low stakes; PM call.)

4. **`pk-mcp repo repath` GA vs fast-follow.** ADR-0008 says "design-level only in V1; implementation can slip to a fast-follow if time-pressed." Plan recommends fast-follow (§4). Confirm stakeholder agrees; otherwise plan needs PR-17b.

5. **Cross-OS CI matrix availability.** Prerequisite §7 item 4. Not a design inconsistency — just a "need to verify before PR-09 runs."

6. **Design §4.3 failure-mode matrix says "detect incomplete-restore marker file; offer resume or abandon"** (T9). That's a real piece of work not explicitly sized in this plan — it folds into PR-11/PR-12's rollback implementation but should be called out as an acceptance criterion for those PRs. Flagged here so it doesn't get missed.

---

**End of plan.**
