# ADR-0009: Local Folder as First-Class Repository Source

**Status:** Accepted

**Date:** 2026-05-06

**Deciders:** Architecture Team

**Technical Story:** Implements the [Local Folder as Repository PRD](../../pm/Local-Folder-As-Repository-PRD.md) and the [Implementation Plan](../Local-Folder-As-Repository-Implementation-Plan.md). Tracking issues: #564 (Phase A — data model), #565 (Phase B — lifecycle), #566 (Phase C — user-facing surface), #567 (Phase D — document graph), #568 (this ADR + polish).

## Context and Problem Statement

Before this work, "repository" in Personal Knowledge MCP implicitly meant *a cloned git remote*. Users with a local working tree they had not pushed (a scratch project, a private monorepo checkout, an Obsidian vault, a folder of mixed code and documentation) could not achieve parity with the git-cloned experience.

Phase 6 introduced a parallel concept — **WatchedFolder** — that intentionally targets unstructured documents (`.md`/`.txt`/`.pdf`/`.docx`) and is exposed via a separate `list_watched_folders` MCP surface. WatchedFolders are docs-only and do not flow through the AST/graph pipeline. The result was a **two-class citizen problem**: a local folder was either treated as documents-only or it had to be promoted to a git remote.

We needed an abstraction that registers a local folder as a first-class repository in the existing repository registry, indistinguishable from a git-cloned repository at the MCP tool layer, while coexisting with both git-sourced repositories and Phase 6 WatchedFolders without replacing either.

## Decision Drivers

- **MCP-layer parity.** A registered local folder must appear in `list_indexed_repositories`, be searchable via `semantic_search` and `search_documents`, and be exposed to all graph tools (`get_dependencies`, `get_dependents`, `get_architecture`, `find_path`, `get_graph_metrics`) — identically to a git-sourced repository.
- **Mixed-content support.** A single registered folder may contain source code, documentation, PDFs, and other indexable artifacts. Each file must be routed to the appropriate ingestion pipeline.
- **Pipeline reuse.** The existing `IncrementalUpdatePipeline.processChanges()` contract already accepts `FileChange[]` and is agnostic to how the diff was produced. Reusing it keeps the new source type cheap.
- **Watcher reuse.** Phase 6's `chokidar`-based filesystem watcher infrastructure should service both WatchedFolders and local-folder repositories.
- **Instance-tier safety.** The `public` tier exposes content to unauthenticated readers. Allowing arbitrary local-folder content into `public` would make accidental leakage one CLI flag away.
- **No migration burden on Phase 6 users.** Existing WatchedFolder entries must continue to work unchanged.
- **Back-compat with existing `repositories.json`.** Installations that pre-date this work have no `source` field on any entry; they must continue to load and behave as git-cloned repositories.
- **Minimal refactor.** We are one person with one codebase; a sprawling abstraction layer competes with future feature work.

## Considered Options

### Option A: Promote `WatchedFolder` into a full repository

**Description:** Reuse the Phase 6 `WatchedFolder` concept as the substrate for local-folder repositories. Extend it to support the AST/graph pipeline.

**Pros:**
- Single concept to teach users.
- No new top-level type to introduce.

**Cons:**
- Couples a deliberately-scoped docs-only path to the full code+graph machinery. Phase 6 chose its scope for a reason; widening it is a regression in clarity.
- Forces every existing WatchedFolder consumer (`list_watched_folders`, `search_documents`) to handle the broader concern.
- Migration of existing WatchedFolder entries is not free — we either grandfather them or break callers.

### Option B: Parallel `local-folder` source with its own pipeline

**Description:** Add `source: "local-folder"` to `RepositoryInfo` but build a parallel ingestion pipeline that bypasses the existing `IncrementalUpdatePipeline.processChanges()`.

**Pros:**
- Clean separation; no branching inside the existing pipeline.

**Cons:**
- Diverges from the `IncrementalUpdatePipeline` contract. Every future improvement to incremental updates would have to be back-ported.
- Re-implements change detection, chunking, embedding upserts, and graph deltas.
- Two near-identical pipelines is exactly the maintenance trap we are trying to avoid.

### Option C (chosen): `local-folder` as a `RepositoryInfo.source` discriminator with branching at the source-shaped seams

**Description:** Add `source: "local-folder"` to the existing `RepositoryInfo` discriminator (`"git-remote" | "local-git" | "local-folder"`). The `IngestionService` branches on `source` only at the points where the source genuinely differs (clone vs. no-clone, git-revparse vs. file-manifest), and otherwise feeds the existing `FileScanner → FileChunker/DocumentChunker → ChromaDB + GraphIngestionService` flow. Change detection for non-git sources is provided by a small new `LocalFolderChangeDetector` that emits the same `FileChange[]` shape consumed by `IncrementalUpdatePipeline.processChanges()`.

**Pros:**
- Full MCP parity at the boundary; existing tools are untouched.
- The blast radius of the change is contained to the genuinely-different seams.
- Existing tests, utilities, and operational tooling apply unchanged.
- Forward-compatible: future source types (e.g., archive-on-disk) can add another discriminator value.

**Cons:**
- `IngestionService` grows a `switch (source)` at the top.
- Two folder concepts now coexist in the system: `WatchedFolder` (Phase 6, docs-only) and `RepositoryInfo where source="local-folder"`. Mitigated by clear naming and by the `FolderEventRouter` dispatching by lookup, not inheritance.

## Decision Outcome

**Chosen option:** Option C — add `local-folder` as a `RepositoryInfo.source` discriminator and branch only at the source-shaped seams.

The following sub-decisions are recorded as part of this ADR:

### Source discriminator and back-compat

- `RepositoryInfo.source` is `"git-remote" | "local-git" | "local-folder"`. See `src/mcp/tools/list-indexed-repositories.ts` and `src/repositories/metadata-store.ts` for the canonical definition.
- On read, an entry without a `source` field is synthesized as `source = "git-remote"`. This is implemented in `src/repositories/metadata-store.ts` (back-compat read path around line 456). Existing installations therefore upgrade in place with no `repositories.json` rewrite required.
- `url` is required for git-sourced repositories; `null` is permitted only when `source === "local-folder"`.

### Manifest design

- Each local-folder repository owns a per-repo `manifest.json` keyed by relative path. Each entry records `mtime`, `size`, and a SHA-256 content hash.
- Change detection uses a fast-path comparison: when the new `(mtime, size)` pair matches the manifest entry, the file is presumed unchanged. The SHA-256 is computed only as a tie-breaker when `mtime` or `size` differs, or when the user requests a forced re-scan.
- The manifest is host-local. Cross-machine portability is explicitly deferred (see ADR-0008, which addresses portability for the registry-level path model only).

### Document graph scope

- Markdown gets full-fidelity extraction: headings, internal links, Obsidian-style `[[wikilinks]]`, and file-to-file mentions. Extraction lives in `src/graph/extraction/DocEntityExtractor.ts` and is invoked by `GraphIngestionService` for any document file regardless of repository source.
- PDF and DOCX get low-fidelity extraction. Edges produced from these sources carry a `confidence` attribute so that graph-tool consumers can filter or weight them.
- Code retains AST-level precision via the existing `CodeEntityExtractor`. The graph schema is unchanged for code.

### Automatic graph population in `cli index` (issue #580)

The original ADR assumed graph population happened only via the explicit `cli graph populate` / `cli graph populate-all` commands after `cli index`. Issue #580 surfaced that this left the Phase D doc-graph extractors as production dead code: ChromaDB was populated by `cli index`, but no path automatically populated `:Document`/`:Section` nodes, wikilink/MENTIONS edges, or `:ExternalLink` nodes.

The fix wires the graph step directly into `IngestionService.indexRepository`:

- When `IngestionService` is constructed with an optional `graphIngestionService`, `cli index <url>` runs a Phase 5 graph step after the chunk → embed → store pipeline completes. The step calls `ingestFiles()` (code graph) followed by `ingestDocumentGraph()` (doc graph). Order is load-bearing: the symbol index inside `ingestDocumentGraph` queries the persisted code graph for MENTIONS resolution, so code symbols must already be there.
- The graph step is **opt-in via dependency injection**. Callers that construct `IngestionService` without a `graphIngestionService` (e.g., test fixtures, environments without FalkorDB/Neo4j) get the original ChromaDB-only behavior. Graph errors emit non-fatal `IndexError`s — ChromaDB stays populated even when FalkorDB is unhealthy.
- The `cli graph populate` and `cli graph populate-all` commands still exist for git-remote and local-git repos. They now refuse to run on `local-folder` sources (since `cli index` already populates those) and gain a doc-graph extraction pass for the repos they do handle.

This also means the incremental update path (`IncrementalUpdatePipeline.processChanges`) flushes per-update doc-graph extractions in a single batch after the per-file code-graph ingest calls — closing the loop so live folder edits keep the doc graph fresh.

### `FolderEventRouter` shared component

- A single new component, `src/services/folder-event-router.ts`, dispatches filesystem events from the shared `chokidar` infrastructure to either:
  - `FolderDocumentIndexingService` (Phase 6, when the folder ID resolves to a `WatchedFolder`), or
  - `LocalFolderUpdateCoordinator` (when the folder path resolves to a `RepositoryInfo` with `source = "local-folder"`).
- The router dispatches **by lookup**, not by inheritance. `WatchedFolder` and the `local-folder` repo source remain intentionally separate concepts; the router is the only place that knows about both.

### Tier handling: `public` is refused for local-folder sources

- Registration with `tier = "public"` for a local folder returns a clear error directing the user to `private` or `work`.
- This is enforced at both the CLI (`src/cli/index.ts` `index` command) and the MCP tool (`src/mcp/tools/register-local-folder.ts`). The MCP tool's input schema accepts only `"private" | "work"`; the CLI accepts the string and rejects it downstream so that the user receives a uniform error message.
- Rationale: the `public` tier serves unauthenticated readers. Local content is by definition unvetted; moving it into `public` should be a deliberate, documented act, not the side effect of a registration flag.

### Watcher default

- `--watch` defaults to **enabled** for local-folder registrations. `--no-watch` disables it. Rationale: the primary motivation for registering a local folder is live editing; the surprising default would be to *not* re-index on save. Users who want a snapshot-only registration can pass `--no-watch`.

### Symlink default

- `--follow-symlinks` defaults to **off**. Out-of-folder targets are rejected even when the flag is set, to prevent accidental escape from the registered tree.

### Positive Consequences

- A local folder is indistinguishable from a git-cloned repository at the MCP tool layer.
- Existing tests and operational tooling apply unchanged to local-folder repositories.
- Phase 6 WatchedFolder users are unaffected; no migration is required.
- `chokidar` watcher infrastructure and `IncrementalUpdatePipeline` are reused, not re-implemented.
- The `back-compat read path` keeps existing installations working without a one-shot upgrade dance.

### Negative Consequences

- `IngestionService` grows a top-level `switch (source)` and a small set of source-shaped seams. Each future source type compounds this, modestly.
- Two folder concepts (WatchedFolder and `local-folder` repo source) coexist. Documentation and `--help` text must keep their distinction crisp; the `FolderEventRouter` is the only piece of code that bridges them.
- Manifests are host-local. A user who restores a backup on a different machine gets a fresh manifest and a full re-scan on first update. ADR-0008 addresses registry-level portability; per-folder manifest portability is deferred.

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| User accidentally registers a huge tree (`$HOME`, a system root) and exhausts disk / embeddings quota. | Soft and hard size guardrails at registration time; documented in the PRD and surfaced in the CLI/MCP help text. |
| Drift when a registered folder is moved or deleted. | Existing `drift_detected` status path is reused; the `LocalFolderChangeDetector` raises drift through the same channel as git sources. |
| Confusion between WatchedFolder and `local-folder` repo source. | `--help` text on `index` and on `register_local_folder` explicitly contrasts the two; this ADR is linked from both docs. |
| Doc-graph edges from low-fidelity extractors (PDF/DOCX) get treated as authoritative. | `confidence` attribute on edges; consumers filter or weight as needed. |
| Cross-OS path handling on the manifest. | Paths are stored as repo-relative POSIX strings inside the manifest; the consumer rejoins with the host's `path.sep`. |

## Implementation Notes

| Concern | Component | File |
|---|---|---|
| Per-file content fingerprint store | `FileManifestStore` | `src/services/file-manifest-store.ts` |
| Non-git change detection | `LocalFolderChangeDetector` | `src/services/local-folder-change-detector.ts` |
| Update orchestration for `local-folder` repos | `LocalFolderUpdateCoordinator` | `src/services/local-folder-update-coordinator.ts` |
| Routing watcher events | `FolderEventRouter` | `src/services/folder-event-router.ts` |
| Markdown / doc graph extraction | `DocEntityExtractor` | `src/graph/extraction/DocEntityExtractor.ts` |
| `.gitignore` honoring during scan | `GitignoreFilter` | `src/ingestion/gitignore-filter.ts` |
| MCP tool to register a folder | `register_local_folder` | `src/mcp/tools/register-local-folder.ts` |

What does NOT change:

- ChromaDB collection naming (`repo_<sanitized_name>` for repos, `folder_<id>` for Phase 6 WatchedFolders — kept distinct).
- The `IncrementalUpdatePipeline.processChanges()` contract.
- All graph MCP tools (`get_dependencies`, `get_dependents`, `get_architecture`, `find_path`, `get_graph_metrics`).
- All search MCP tools (`semantic_search`, `search_documents`, `search_images`).
- Phase 6 `WatchedFolder` and `FolderDocumentIndexingService`.

## What Was Deferred and Why

- **Cross-machine portability of a local-folder repository's index.** Indexes are host-local. The manifest's `mtime` semantics differ across filesystems and a backup-on-Windows / restore-on-Linux flow would force a full re-scan anyway. ADR-0008 addresses registry-level path portability; per-folder manifest portability is a separate, larger problem.
- **Cross-repo linking.** A wikilink that points outside the registered folder does not produce a graph edge to a different repository. Cross-repo linking would require a global symbol table, which is outside V1 scope.
- **`.pkmignore`.** Users supply include/exclude globs at registration time, and `.gitignore` at the folder root is honored automatically. A dedicated `.pkmignore` is deferred until there is concrete demand.
- **Retroactive doc-graph for existing `WatchedFolder` entries.** No migration is provided. A user who wants graph tools on their notes registers the folder as a `local-folder` repository instead of (or in addition to) a `WatchedFolder`. Doc-graph extraction is a forward-compatible capability that `WatchedFolder` may adopt later.
- **Cloud / network-share folder sources** (OneDrive, Google Drive, SMB shares) and **two-way sync** to the source folder.

## Links

- [Local Folder as Repository PRD](../../pm/Local-Folder-As-Repository-PRD.md)
- [Implementation Plan](../Local-Folder-As-Repository-Implementation-Plan.md)
- [Phase 6 Document Ingestion PRD](../../pm/Phase6-Document-Ingestion-PRD.md) (parallel WatchedFolder concept)
- [ADR-0001](./0001-incremental-update-trigger-strategy.md) — incremental update trigger strategy
- [ADR-0004](./0004-graph-database-migration-neo4j-to-falkordb.md) — graph DB migration to FalkorDB
- [ADR-0007](./0007-cross-store-consistency-model.md) — cross-store consistency between Chroma and FalkorDB
- [ADR-0008](./0008-repositories-json-path-model.md) — `repositories.json` path model for cross-OS migration

## Validation Criteria

This ADR is validated when, against the merged main:

- `pk-mcp index <local-path>` registers the folder, scans it, and emits embeddings + graph entities.
- `list_indexed_repositories` returns the folder with `source: "local-folder"` and the absolute path.
- `semantic_search`, `get_dependencies`, `get_dependents`, `get_architecture`, `find_path`, and `get_graph_metrics` all accept the local-folder repository name as a `repository` filter and behave identically to a git-sourced repository.
- Editing a file inside a watched folder triggers an incremental update without manual intervention.
- `pk-mcp index <path> --tier public` returns the documented refusal error.
- An existing `repositories.json` from before this work loads cleanly and its entries report `source: "git-remote"` via the back-compat read path.
