# Implementation Plan: Local Folder as First-Class Repository

**Status:** Approved for implementation
**Date:** 2026-05-04
**Owner:** Architecture
**Related PRD:** `docs/pm/Phase6-Document-Ingestion-PRD.md` (Phase 6 — parallel WatchedFolder concept)
**Related ADR (to author):** `docs/architecture/adr/0007-local-folder-as-repository.md`

---

## 1. Architecture Summary

### 1.1 The flow, in words

```
                                         +------------------------------+
                                         | RepositoryInfo (registry)    |
                                         | source: "git-remote" |       |
                                         |         "local-git"  |       |
                                         |         "local-folder"       |
                                         +---------------+--------------+
                                                         |
   cli index <path>  ---+                                |
   MCP register tool ---+--> IngestionService -----------+
                              (existing, branches on isLocalPath today)
                                  |
                                  | for "local-folder":
                                  |   - skip clone
                                  |   - skip git revparse
                                  |   - build initial FileManifest
                                  v
                          FileScanner (+ .gitignore filter)
                                  |
                                  v
                  +---- FileChunker / DocumentChunker (existing) ----+
                  |                                                  |
                  v                                                  v
            ChromaDB (repo_<name> collection)                  GraphIngestionService
                                                                     |
                                                                     v
                                                +--- CodeEntityExtractor (existing, AST)
                                                |
                                                +--- DocEntityExtractor (NEW)
                                                       - Document, Section, ExternalLink nodes
                                                       - LINKS_TO, MENTIONS edges

   Subsequent updates (manual or watcher-driven):

   FolderEventRouter (NEW shared)
        |  routes by folder ID lookup:
        |    - WatchedFolder ID  -> FolderDocumentIndexingService (Phase 6, unchanged)
        |    - RepositoryInfo where source="local-folder" -> LocalFolderUpdateCoordinator (NEW)
        v
   LocalFolderChangeDetector (NEW)
        - walks tree under repo.localPath
        - reads FileManifest (per-file hash/mtime/size)
        - emits FileChange[] (added/modified/deleted/renamed)
        v
   IncrementalUpdatePipeline.processChanges (existing) --> Chroma + Graph delta updates
```

### 1.2 Where the new pieces sit

| Concern | New component | Lives in |
|---|---|---|
| Per-file content fingerprint store | `FileManifestStore` | `src/services/file-manifest-store.ts` |
| Non-git change detection | `LocalFolderChangeDetector` | `src/services/local-folder-change-detector.ts` |
| Update orchestration for `local-folder` repos | `LocalFolderUpdateCoordinator` | `src/services/local-folder-update-coordinator.ts` |
| Routing watcher events to either WatchedFolder or local-folder-repo | `FolderEventRouter` | `src/services/folder-event-router.ts` |
| Markdown/doc graph extraction | `DocEntityExtractor` | `src/graph/extraction/DocEntityExtractor.ts` |
| `.gitignore` honoring during scan | `GitignoreFilter` (wraps `ignore` npm package) | `src/ingestion/gitignore-filter.ts` |
| MCP tool to register a folder | `register_local_folder` | `src/mcp/tools/register-local-folder.ts` |

### 1.3 What does NOT change

- ChromaDB collection naming (`repo_<sanitized_name>` for repos, `folder_<id>` for Phase 6 WatchedFolders — kept distinct).
- The `IncrementalUpdatePipeline.processChanges()` contract — it already accepts `FileChange[]` and doesn't care how the diff was produced.
- All graph MCP tools (`get_dependencies`, `get_dependents`, `get_architecture`, `find_path`, `get_graph_metrics`).
- All search MCP tools (`semantic_search`, `search_documents`, `search_images`).
- Phase 6 `WatchedFolder` and `FolderDocumentIndexingService` — left intact, no migration.

---

## 2. Component-by-Component Task Breakdown

Tasks are grouped below by PR for engineering granularity. **For delivery, the 8 PRs are bundled into 5 phases** tracked as GitHub issues — see Section 6.1. The PR-level groupings remain the unit of internal sequencing within each phase.

Sizes: S ≤ 100 LoC, M ≤ 300, L ≤ 500, XL > 500 (must be split).

| PR | Phase | Issue |
| -- | ----- | ----- |
| PR 1 | A — Foundation | [#564](https://github.com/sethships/PersonalKnowledgeMCP/issues/564) |
| PR 2 | B — Local folder lifecycle | [#565](https://github.com/sethships/PersonalKnowledgeMCP/issues/565) |
| PR 3 | B — Local folder lifecycle | [#565](https://github.com/sethships/PersonalKnowledgeMCP/issues/565) |
| PR 4 | C — User-facing surface | [#566](https://github.com/sethships/PersonalKnowledgeMCP/issues/566) |
| PR 5 | C — User-facing surface | [#566](https://github.com/sethships/PersonalKnowledgeMCP/issues/566) |
| PR 6 | D — Document graph | [#567](https://github.com/sethships/PersonalKnowledgeMCP/issues/567) |
| PR 6b | D — Document graph | [#567](https://github.com/sethships/PersonalKnowledgeMCP/issues/567) |
| PR 7 | E — ADR + polish | [#568](https://github.com/sethships/PersonalKnowledgeMCP/issues/568) |

### PR 1 — Data model + manifest plumbing (foundation)

- [ ] **T1.1** Add `RepositoryInfo.source` discriminator. **(S, modify)**
  - File: `src/repositories/types.ts`
  - Add `source: "git-remote" | "local-git" | "local-folder"` (default `"git-remote"` on read for back-compat).
  - Make `url` optional (`string | null`) when `source === "local-folder"`.
  - Add `tier?: "private" | "work" | "public"` (default `"private"`; refused as `"public"` for local folders at registration).
  - Add `lastManifestId?: string` pointer to manifest file.
  - Acceptance: existing tests pass with default `source = "git-remote"` injected on read.
- [ ] **T1.2** Migrate `metadata-store.ts` to handle the new field. **(S, modify)**
  - File: `src/repositories/metadata-store.ts`
  - Read path: synthesize `source: "git-remote"` if missing.
  - Write path: persist new fields.
  - Acceptance: round-trip test of all three source values.
- [ ] **T1.3** Relax `UpdateHistoryEntry` schema for non-git repos. **(S, modify)**
  - File: `src/repositories/types.ts`
  - Make `previousCommit` and `newCommit` accept synthetic markers `local-<isoDate>` (string, not enforced 40-hex). Document semantics.
  - Acceptance: unit test asserts both 40-hex and `local-...` markers are accepted.
- [ ] **T1.4** Add `FileManifestStore`. **(M, new)**
  - File: `src/services/file-manifest-store.ts`
  - Pattern: same singleton + atomic-write as `watched-folder-store.ts`.
  - Storage: `{DATA_PATH}/manifests/<repo-name>.json` (one file per repo).
  - Schema: `{ version, repository, generatedAt, files: { [relPath]: { sha256, sizeBytes, mtimeMs } } }`.
  - Operations: `loadManifest(repo)`, `saveManifest(repo, manifest)`, `deleteManifest(repo)`.
  - Acceptance: 100% line coverage; concurrent-write serialization test.

### PR 2 — Local-folder ingestion path (initial scan)

- [ ] **T2.1** Extend `IngestionService` to accept `source` and skip git-revparse for non-git folders. **(S, modify)**
  - File: `src/services/ingestion-service.ts` (lines ~244–295)
  - Detect: if `isLocalPath(url)` AND no `.git` directory present, set `source = "local-folder"`, leave `commitSha` undefined, do not call `git revparse`.
  - If `.git` present, set `source = "local-git"`, behave as today.
  - Acceptance: integration test indexes a non-git folder end-to-end.
- [ ] **T2.2** Build initial manifest after first scan. **(S, modify)**
  - File: `src/services/ingestion-service.ts`
  - After file scan completes for a `local-folder` repo, compute `(sha256, size, mtime)` per file and persist via `FileManifestStore.saveManifest`.
  - Acceptance: manifest file written; size matches scanned file count.
- [ ] **T2.3** Implement `GitignoreFilter`. **(S, new)**
  - File: `src/ingestion/gitignore-filter.ts`
  - Dependency: `ignore` npm package (MIT-licensed, well-maintained).
  - Walks up from each candidate file looking for `.gitignore` files; merges rules.
  - Acceptance: unit tests for nested `.gitignore`, negation rules (`!keep.txt`), and absence of any `.gitignore`.
- [ ] **T2.4** Wire `GitignoreFilter` into `FileScanner`. **(S, modify)**
  - File: `src/ingestion/file-scanner.ts`
  - Apply filter only when scanning a `local-folder` or `local-git` source. Git-remote shallow clones don't need it (the remote already excludes ignored files; honoring `.gitignore` on a shallow clone is still safe but redundant).
  - Acceptance: integration test with a folder containing `.gitignore` excluding `node_modules/`.
- [ ] **T2.5** Size guardrails at registration. **(S, modify)**
  - File: `src/services/ingestion-service.ts`
  - Pre-scan pass: count files and sum bytes (after `.gitignore` filter, before chunking).
  - Soft warn at 10K files OR 1 GiB; hard refuse at 100K files OR 10 GiB unless `--force` is set.
  - Acceptance: unit tests for each threshold (warn, refuse, refuse+force).
- [ ] **T2.6** Refuse `tier = "public"` for `local-folder`. **(S, modify)**
  - File: `src/services/ingestion-service.ts`
  - Throw `LocalFolderPublicTierRefusedError` (new error class).
  - Acceptance: unit test confirms refusal; tier can be set to `private` or `work`.

### PR 3 — Local-folder change detection + incremental update

- [ ] **T3.1** Implement `LocalFolderChangeDetector`. **(M, new)**
  - File: `src/services/local-folder-change-detector.ts`
  - Algorithm: walk tree (respecting `.gitignore`, include extensions, symlink rules), build current `FileSnapshot[]`. Diff against stored manifest:
    - In current and not in manifest -> `added`
    - In manifest and not in current -> `deleted`
    - In both, `(size, mtimeMs)` differ -> compute sha256; if hash also differs -> `modified`; if hash same (touch with no content change) -> skip
    - In both, `(size, mtimeMs)` match -> skip (fast path, no hash)
  - No rename detection in v1 (delete + add). Document this.
  - Output: `FileChange[]` matching the existing pipeline contract.
  - Acceptance: unit tests for added, modified-content, modified-mtime-only, deleted, large-tree (1K files) under 200 ms.
- [ ] **T3.2** Implement `LocalFolderUpdateCoordinator`. **(M, new)**
  - File: `src/services/local-folder-update-coordinator.ts`
  - Mirrors `IncrementalUpdateCoordinator` but for `local-folder` repos:
    1. Load `RepositoryInfo`, validate `source === "local-folder"` and `localPath` still exists.
    2. If `localPath` missing -> return `drift_detected` (re-using existing status).
    3. Run `LocalFolderChangeDetector` to produce `FileChange[]`.
    4. Pass to `IncrementalUpdatePipeline.processChanges` (unchanged).
    5. On success, update `FileManifestStore` with new snapshot + write `UpdateHistoryEntry` with `previousCommit = "local-<isoDate-prev>"`, `newCommit = "local-<isoDate-now>"`.
  - Acceptance: integration test: register folder, modify a file, run update, confirm chunks updated and graph nodes updated.
- [ ] **T3.3** Wire `trigger_incremental_update` MCP tool to dispatch by source. **(S, modify)**
  - File: `src/mcp/tools/trigger-incremental-update.ts`
  - Branch on `repo.source`: `git-remote`/`local-git` -> existing `IncrementalUpdateCoordinator`; `local-folder` -> `LocalFolderUpdateCoordinator`.
  - Acceptance: tool works for both source types; existing tests still pass.
- [ ] **T3.4** Update `list_indexed_repositories` output. **(S, modify)**
  - File: `src/mcp/tools/list-indexed-repositories.ts`
  - Add `source` and `localPath` (absolute) fields to response payload.
  - Acceptance: contract test confirms new fields present; existing fields unchanged.

### PR 4 — CLI and MCP registration surface

- [ ] **T4.1** Auto-detect non-git folders in existing `cli index <path>`. **(S, modify)**
  - File: `src/cli/commands/index-command.ts`
  - If `isLocalPath(arg)` and no `.git` directory -> register as `local-folder` (no separate `index-folder` verb).
  - Add flags: `--name <n>`, `--tier private|work`, `--force`, `--watch`, `--follow-symlinks`.
  - Acceptance: CLI test indexes a non-git folder end-to-end.
- [ ] **T4.2** Reject duplicate-name registrations. **(S, modify)**
  - File: `src/services/ingestion-service.ts`
  - Existing `RepositoryAlreadyExistsError` already handles this, but also check for path duplication: same absolute `localPath` registered under a different name should be rejected with a clear error pointing to the existing name.
  - Acceptance: unit test for both name collision and path collision.
- [ ] **T4.3** New MCP tool `register_local_folder`. **(M, new)**
  - File: `src/mcp/tools/register-local-folder.ts`
  - Parameters: `{ path: string, name?: string, tier?: "private"|"work", watch?: boolean, force?: boolean, followSymlinks?: boolean }`.
  - Returns: job ID for async progress tracking (reuses Phase 6 `JobTracker`).
  - Acceptance: contract test + integration test against running MCP server.
- [ ] **T4.4** Register `register_local_folder` in tool index. **(S, modify)**
  - File: `src/mcp/tools/index.ts`, `src/mcp/server.ts`
  - Acceptance: tool appears in `tools/list` MCP response.

### PR 5 — Watcher and FolderEventRouter

- [ ] **T5.1** Extract a shared `FolderEventRouter`. **(M, new)**
  - File: `src/services/folder-event-router.ts`
  - On chokidar event `(folderId, eventType, absolutePath)`:
    - Look up `folderId` in `WatchedFolderStore` -> route to `FolderDocumentIndexingService` (Phase 6, unchanged behavior).
    - Else look up by `localPath` in `RepositoryMetadataStore` where `source === "local-folder"` -> debounce + enqueue an incremental update via `LocalFolderUpdateCoordinator`.
  - Debounce per repo (default 2000 ms, configurable per repo).
  - Acceptance: unit test confirms router dispatches to correct backend; integration test confirms file edit -> chunks updated within debounce window + processing time.
- [ ] **T5.2** Make `FolderWatcherService` consume the router. **(S, modify)**
  - File: `src/services/folder-watcher-service.ts`
  - Replace direct call to `FolderDocumentIndexingService` with `FolderEventRouter.route(...)`.
  - Acceptance: existing Phase 6 watcher tests still pass.
- [ ] **T5.3** Watch lifecycle for local-folder repos. **(M, new)**
  - File: `src/services/local-folder-update-coordinator.ts`
  - Add `startWatching(repo)` / `stopWatching(repo)` that call into chokidar via the existing watcher service. Persist `watchEnabled: boolean` on `RepositoryInfo`.
  - On MCP server startup, restart watchers for all `local-folder` repos with `watchEnabled === true`.
  - Acceptance: integration test confirms watcher restarts after server reboot.
- [ ] **T5.4** Symlink policy. **(S, modify)**
  - File: `src/ingestion/file-scanner.ts`
  - Default: do not follow symlinks. With `--follow-symlinks`, follow but cap depth at 8 and reject any symlink target outside the repo root unless target is also inside the repo root (TOCTOU-aware: stat after resolve).
  - Acceptance: unit test confirms a symlink to `/etc` is skipped by default; opt-in flag works for in-repo symlinks.

### PR 6 — Document graph extraction (Markdown)

**Note on doc-graph scope**: v1 ships markdown-graph at full fidelity (PR 6) and PDF/DOCX-graph at lower fidelity (PR 6b, immediately following). The markdown extractor and the PDF/DOCX extractor share the `Document` node schema introduced in T6.1 but are independent extractors with different input shapes and different MENTIONS confidence levels.

- [ ] **T6.1** Schema additions for doc-graph. **(S, modify)**
  - File: `src/graph/schema/falkordb.ts` (and `neo4j.ts` if dual-stack is still maintained)
  - New node labels: `Document`, `Section`, `ExternalLink`.
  - New indexes: `Document.id`, `Document.repository`, `Section.documentId`.
  - New edges: `LINKS_TO` (Document -> Document or Document -> ExternalLink), `MENTIONS` (Document -> Function|Class|Module), `HAS_SECTION` (Document -> Section), `CONTAINS_SECTION` (Section -> Section, for nesting).
  - Acceptance: migration runs cleanly on a fresh FalkorDB; idempotent on existing.
- [ ] **T6.2** New `DocEntityExtractor`. **(M, new)**
  - File: `src/graph/extraction/DocEntityExtractor.ts`
  - Reuses `MarkdownParser` (already extracts sections + frontmatter via `marked`). **Decoupling constraint: this extractor takes a parsed document AST + repo context as input. It MUST NOT depend on `RepositoryInfo.source` or any local-folder-specific type, so a future PR can wire it into `FolderDocumentIndexingService` for retroactive Phase 6 `WatchedFolder` doc-graph coverage with a minimal change.**
  - Extracts:
    - `Document` node (one per markdown file): `{ id, repository, path, title (from frontmatter or H1), wordCount }`.
    - `Section` nodes (one per heading): `{ id, documentId, level, title, anchor, startOffset, endOffset }` plus parent-child `CONTAINS_SECTION` edges based on heading nesting. **Section nodes are internal-only in v1 — they are not surfaced through `get_architecture` or any other MCP tool. They are queryable only via direct graph queries and via `find_path`.**
    - Outbound markdown links (`[text](path)`): if `path` resolves to a file in the same repo -> `LINKS_TO Document`; else create/reuse `ExternalLink` node.
    - Wikilinks (`[[Page]]`): resolved with **strict precedence order, first match wins**: (1) exact `Document.title` match in same repo; (2) path-stem match in same repo (basename without extension); (3) `Section.anchor` match in same repo; (4) `Function`/`Class`/`Module` name match in same repo. Subsequent matches logged at debug level.
    - Inline code-symbol mentions: tokenize fenced code blocks and inline-code spans; extract identifiers matching the existing `Function`/`Class` table for the same repo (case-sensitive exact match, scoped to the repo). Emit `MENTIONS` edges. Cross-repo resolution is explicitly out of scope for v1 (see Deferred Features). **Resolution is best-effort and lossy by design** — see risk register.
  - Acceptance: unit test fixtures cover frontmatter title, nested headings, relative links, wikilinks (with all four precedence tiers exercised in order), code-symbol mentions; bench on a 500-file Obsidian-style vault stays under 30 s total. Wikilink test must explicitly assert that when the same name exists at multiple precedence tiers, the higher-tier match wins.
- [ ] **T6.3** Wire `DocEntityExtractor` into `GraphIngestionService`. **(M, modify)**
  - File: `src/graph/ingestion/GraphIngestionService.ts`
  - Add a parallel pipeline branch: if file extension is `.md` (and later `.pdf`/`.docx`), run `DocEntityExtractor` instead of `EntityExtractor`/`RelationshipExtractor`.
  - File-deletion path must also remove `Document`/`Section`/`ExternalLink` nodes for that file.
  - Acceptance: integration test indexes a markdown file, asserts `Document` and `Section` nodes appear; deletion test confirms cleanup.
- [ ] **T6.4** Two-pass MENTIONS resolution. **(M, new)**
  - The mention-resolution step needs the code-graph to already exist for the same repo. Solution: run `DocEntityExtractor` in a second pass after code extraction completes (per repo, per ingestion run). Re-resolve mentions on every incremental update where either the doc OR the referenced symbol changed.
  - Acceptance: edit a markdown doc to mention `AuthService`; run update; confirm `MENTIONS` edge created. Delete `AuthService` class; confirm orphaned `MENTIONS` edge removed on next update.
- [ ] **T6.5** Shared-parse refactor for `MarkdownParser`. **(S, modify)**
  - File: `src/documents/extractors/MarkdownParser.ts`, `src/services/ingestion-service.ts`
  - Expose the parsed token stream / AST so the chunker AND `DocEntityExtractor` consume one parse per file.
  - **Hard user constraint: the entire document MUST remain indexed. This refactor MUST NOT cause any part of a document to be omitted from semantic search coverage.**
  - Acceptance criteria (all required):
    1. **Coverage invariant**: every byte and every heading-bounded section of the source document is represented by ≥1 semantic chunk after refactor. Specifically: the union of all chunk character-ranges, after normalizing whitespace per the chunker's existing rules, must equal the full source-file character range. No section heading and no body paragraph may be missing from the chunk set.
    2. Sum of chunk char-ranges (post-normalization) equals total normalized file length.
    3. Existing `tests/integration/documents/document-chunking-pipeline.integration.test.ts` continues to pass without modification.
    4. New regression test (see T7.1): markdown corpus indexed, chunk coverage verified byte-complete.

### PR 6b — PDF/DOCX graph extraction (v1 scope, lower fidelity than markdown)

- [ ] **T6b.1** New `PdfDocxEntityExtractor`. **(M, new)**
  - File: `src/graph/extraction/PdfDocxEntityExtractor.ts`
  - Same decoupling constraint as `DocEntityExtractor`: takes parsed-document input + repo context, no local-folder-specific dependencies, so it can be retroactively wired into `FolderDocumentIndexingService` later.
  - Reuses existing `PdfExtractor` and `DocxExtractor` (already produce text + page/section info).
  - Minimum viable extraction:
    - `Document` node (one per PDF/DOCX file): `{ id, repository, path, title (from document metadata or filename fallback), wordCount, format: "pdf" | "docx", pageCount }`.
    - **No `Section` hierarchy** unless the source provides a trivially extractable outline:
      - DOCX: use heading styles (`Heading 1`, `Heading 2`, ...) when present in the docx style map.
      - PDF: use the document outline / bookmarks when present in the PDF metadata. If absent, no `Section` nodes are created — the `Document` node stands alone.
    - **Outbound code-symbol mentions only.** Run a regex/heuristic pass over the extracted plain text matching identifier-shaped tokens (`/[A-Z][A-Za-z0-9_]{2,}|[a-z][A-Za-z0-9_]{2,}\(/`) against the existing `Function`/`Class`/`Module` table for the same repo (case-sensitive, exact match, intra-repo only). Emit `MENTIONS` edges.
    - **No `LINKS_TO` edges** in v1 — PDF hyperlinks and DOCX hyperlinks are not extracted. Defer to v2.
    - All `MENTIONS` edges from PDF/DOCX carry a property `confidence: "low"` (vs `"high"` for markdown code-fence mentions). This lets users filter out noisy mentions in queries (e.g., `WHERE m.confidence = "high"`).
  - Acceptance: unit test fixtures (use existing `tests/fixtures/documents/`) cover a PDF with outline, a PDF without outline, a DOCX with heading styles, a DOCX without; mention-resolution test against a known symbol table; confidence attribute present on every PDF/DOCX-sourced `MENTIONS` edge.
- [ ] **T6b.2** Wire `PdfDocxEntityExtractor` into `GraphIngestionService`. **(S, modify)**
  - File: `src/graph/ingestion/GraphIngestionService.ts`
  - Branch on file extension: `.md` -> `DocEntityExtractor`; `.pdf`/`.docx` -> `PdfDocxEntityExtractor`; code extensions -> existing extractors. File-deletion path must remove `Document` and `MENTIONS` edges for that file.
  - Acceptance: integration test ingests a PDF and a DOCX, asserts `Document` nodes appear and `MENTIONS` edges have `confidence: "low"`; deletion removes both.
- [ ] **T6b.3** Update `docGraphCoverage` reporting. **(S, modify)**
  - File: `src/repositories/types.ts`, `src/mcp/tools/list-indexed-repositories.ts`
  - `docGraphCoverage: ("markdown" | "pdf" | "docx")[]` — populated based on which formats were actually encountered and processed during indexing.
  - Acceptance: contract test verifies the field reflects actual coverage, not a hardcoded value.

### PR 7 — Tests + docs

- [ ] **T7.1** Test coverage uplift. **(L)** — see Section 4.
- [ ] **T7.2** ADR-0007. **(S, new)**
  - File: `docs/architecture/adr/0007-local-folder-as-repository.md`
  - Captures: source discriminator decision, manifest design, doc-graph scope (markdown only in v1), watcher routing.
- [ ] **T7.3** README + `feature-summary.md` updates. **(S)**
- [ ] **T7.4** CLI help text + MCP tool descriptions polished. **(S)**

---

## 3. Data Model Changes

### 3.1 `RepositoryInfo` additions

```typescript
// src/repositories/types.ts
export interface RepositoryInfo {
  // ... existing fields ...

  /** NEW: source discriminator. Defaults to "git-remote" on read for back-compat. */
  source: "git-remote" | "local-git" | "local-folder";

  /** EXISTING but now nullable for local-folder */
  url: string | null;

  /** NEW: security tier. Defaults to "private". "public" refused for local-folder. */
  tier?: "private" | "work" | "public";

  /** NEW: pointer to per-repo manifest file. Only set when source="local-folder". */
  lastManifestId?: string;

  /** NEW: persisted watch state for local-folder repos */
  watchEnabled?: boolean;

  /** NEW: doc-graph coverage hint for clients. Reflects which doc formats actually
   *  produced graph entities during indexing. PDF/DOCX entries carry lower-fidelity
   *  MENTIONS edges (confidence="low"). */
  docGraphCoverage?: ("markdown" | "pdf" | "docx")[];
}
```

### 3.2 `UpdateHistoryEntry` relaxation

```typescript
// src/repositories/types.ts
export interface UpdateHistoryEntry {
  // ... existing fields ...

  /** RELAXED: was 40-hex SHA, now also accepts "local-<isoDate>" markers */
  previousCommit: string;
  newCommit: string;
}
```

### 3.3 New `FileManifest`

```typescript
// src/services/file-manifest-store.ts
export interface FileManifestEntry {
  sha256: string;     // 64-char hex
  sizeBytes: number;
  mtimeMs: number;    // POSIX milliseconds
}

export interface FileManifest {
  version: "1.0";
  repository: string;          // RepositoryInfo.name
  generatedAt: string;         // ISO 8601
  files: Record<string, FileManifestEntry>; // key = POSIX-normalized relative path
}
```

Storage: `{DATA_PATH}/manifests/<sanitized-repo-name>.json`. Atomic write (temp + rename).

### 3.4 Graph schema additions

| Element | Type | Notes |
|---|---|---|
| `Document` (node label) | new | Properties: `id`, `repository`, `path`, `title`, `wordCount`, `format` (`"markdown"` \| `"pdf"` \| `"docx"`), `pageCount?` (PDF/DOCX only) |
| `Section` (node label) | new | Properties: `id`, `documentId`, `level`, `title`, `anchor`, `startOffset`, `endOffset` |
| `ExternalLink` (node label) | new | Properties: `id`, `url`, `firstSeenIn` (repository) |
| `HAS_SECTION` (edge) | new | `Document -> Section` |
| `CONTAINS_SECTION` (edge) | new | `Section -> Section` (for nesting) |
| `LINKS_TO` (edge) | new | `Document -> Document` (intra-repo) or `Document -> ExternalLink` |
| `MENTIONS` (edge) | new | `Document -> Function | Class | Module`. Resolution is exact-name, repo-scoped, case-sensitive. Carries property `confidence: "high" | "low"` — `"high"` for markdown code-fence/inline-code mentions, `"low"` for PDF/DOCX heuristic regex matches. |
| Indexes | new | `Document.id`, `Document.repository`, `Section.documentId` |

Migration: new `0002-doc-graph-schema.ts` migration file under `src/graph/migration/migrations/`.

---

## 4. Test Plan

### 4.1 Unit tests (target: per-file 95%+ coverage)

| Module | Test cases |
|---|---|
| `FileManifestStore` | round-trip save/load; atomic-write under concurrent writes; missing-file = empty manifest; corrupted-file = surfaces error |
| `LocalFolderChangeDetector` | added file; modified content (size differs); modified content (mtime differs but size same); touch-only (mtime differs, hash same -> skipped); deleted file; mass change (1K files) under 200 ms |
| `GitignoreFilter` | nested `.gitignore`; negation rules (`!keep.txt`); no `.gitignore` present; `.gitignore` containing patterns from outside repo root |
| `LocalFolderUpdateCoordinator` | happy-path update; `localPath` missing -> `drift_detected`; manifest write atomic on partial pipeline failure; tier validation |
| `DocEntityExtractor` | frontmatter title; H1 fallback title; nested heading -> `CONTAINS_SECTION`; relative link resolves to in-repo doc; broken relative link -> no edge; wikilink to title; wikilink to path stem; wikilink to section anchor; wikilink to code symbol; **wikilink precedence test: same name exists at title + path-stem + anchor + symbol; verify title wins**; code-fence symbol mention -> `MENTIONS` with `confidence: "high"`; mention of nonexistent symbol -> no edge |
| `PdfDocxEntityExtractor` | PDF with outline -> `Document` + `Section` nodes; PDF without outline -> `Document` only; DOCX with heading styles -> `Document` + `Section`; DOCX without heading styles -> `Document` only; mention regex match against symbol table -> `MENTIONS` with `confidence: "low"`; minimum identifier length (3 chars) enforced; `--no-pdf-docx-graph` flag suppresses entity creation |
| Markdown shared-parse refactor (T6.5) | **chunk-coverage invariant: indexed markdown corpus produces chunks whose unioned char-ranges (post-normalization) equal the full source-file char-ranges; no heading and no body paragraph is missing from the chunk set; sum of chunk char-ranges = total normalized file length** |
| `FolderEventRouter` | event for known WatchedFolder routes to doc indexer; event for known local-folder repo routes to update coordinator; event for unknown folder dropped with warning |
| Size guardrails | soft-warn at 10K files; hard-refuse at 100K; `--force` bypasses hard-refuse; same for byte limits |
| Symlink policy | symlink to `/etc` skipped by default; `--follow-symlinks` follows in-repo symlinks; out-of-repo symlink rejected even with flag |
| Tier refusal | `tier=public` rejected for `local-folder`; allowed for `git-remote` |
| Collision rejection | name collision throws `RepositoryAlreadyExistsError`; path collision throws new `LocalFolderPathAlreadyRegisteredError` with existing-name in message |

### 4.2 Integration tests (`tests/integration/`)

- End-to-end: register non-git folder via CLI -> `list_indexed_repositories` shows it -> `semantic_search` returns hits -> `get_dependencies` works on a function in that folder.
- Manifest -> incremental update: register folder, modify one file, run `trigger_incremental_update`, verify chunks updated and exactly one `UpdateHistoryEntry` appended.
- Markdown doc-graph: register folder with markdown docs, verify `Document` and `Section` nodes; modify a link, verify `LINKS_TO` edge updated.
- **Markdown chunk-coverage regression**: load a known multi-section markdown corpus, run full ingestion, assert every section heading and every body paragraph appears in at least one chunk and that the union of chunk char-ranges (post-normalization) equals the full file char-range. This test guards the shared-parse refactor (T6.5) against silent coverage regressions.
- PDF/DOCX doc-graph: register folder containing a PDF with an outline and a DOCX with heading styles; verify `Document` nodes appear, `Section` nodes only when source provides them, and any `MENTIONS` edges carry `confidence: "low"`.
- Mention confidence filtering: query the graph for `MENTIONS` edges with `confidence = "high"` and confirm only markdown-sourced edges return.
- MENTIONS resolution: index a code repo + a docs folder pointing at it; verify `MENTIONS` edges created; delete the referenced class; verify edges cleaned up on next update.
- Watcher: register folder with `--watch`, edit a file, wait for debounce + processing, verify chunks updated.

### 4.3 Isolated tests (`tests/isolated/`)

- `incremental-update-local-folder.test.ts` (mirrors the existing `incremental-update-local-git.test.ts` already in the working tree).
- `watcher-restart-on-server-reboot.test.ts`.
- Large-tree perf test: 10K-file folder, full first index under 5 min, incremental update of 10 files under 30 s.

### 4.4 Coverage gates

Per project standards, full suite must pass with ≥ 90% coverage. New code (PRs 1–7) targets ≥ 95% line coverage; the `DocEntityExtractor` mention-resolution path is the most failure-prone and gets the heaviest test coverage.

---

## 5. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Doc-graph MENTIONS resolution scope creep.** Markdown contains arbitrary text; matching every word against the symbol table will explode in noise. | High | High | Restrict v1 to: (a) symbols inside fenced code blocks and inline-code spans only, (b) exact-name match, (c) case-sensitive, (d) repo-scoped only. No fuzzy match. No cross-repo. Document this explicitly in the ADR. If users want broader linking, defer to v2. |
| 2 | **`LocalFolderChangeDetector` mtime unreliability across filesystems.** SMB/network drives, Docker bind mounts, and some Windows configurations report imprecise or wrong mtimes. | Medium | Medium | Always recompute hash when `(size, mtime)` differ — never trust mtime alone for "modified". Add a `--paranoid` opt-in that hashes everything. Document known-bad filesystems. |
| 3 | **Watcher fan-out under bulk operations** (e.g., user runs `git pull` inside a watched local-folder repo and 500 files change at once). | Medium | Medium | Per-repo debounce (2 s default). Coalesce events into a single update job. Cap concurrent updates at 1 per repo (existing pattern in `IngestionService._isIndexing`). |
| 4 | **Symlink TOCTOU.** A symlink resolved at scan time can change before file read. | Low | High (security) | Use `realpath()` after `lstat()` and confirm the resolved path is still within the repo root before opening. Reject silently and log on mismatch. |
| 5 | **PDF/DOCX text-extraction quality.** Extracted text from PDF/DOCX is often noisy: line breaks split identifiers, OCR artifacts produce false matches, layout-driven extraction can concatenate unrelated tokens. The regex/heuristic mention pass against the symbol table will produce false positives. | High | Medium | (a) Mark all PDF/DOCX `MENTIONS` edges with `confidence: "low"` so consumers can filter them out in queries. (b) Require minimum identifier length (≥3 chars) and exact case match to reduce noise. (c) Document the limitation prominently in README and in `list_indexed_repositories` output. (d) Surface a per-repo metric `lowConfidenceMentionsCount` so users can see how much noise their docs add. (e) Provide a CLI flag `--no-pdf-docx-graph` for users who find the noise unhelpful. |

---

## 5a. Deferred Features (Backlog)

These are explicitly out of scope for v1 and tracked here for future planning. Each entry should become a GitHub issue at v1 ship time.

| # | Feature | Rationale for deferral | Estimated size |
|---|---|---|---|
| D1 | **Cross-repository linking and MENTIONS resolution.** Allow markdown docs in repo A to resolve `[[Setup]]` and code-symbol mentions against repo B; expose `--cross-repo-mentions` opt-in flag. **User explicitly requested this be flagged: "we could flag a feature to add later about linking repositories/folders."** | Resolution ambiguity when same name exists in multiple repos; explosion of resolution cost; needs a precedence model across repos. | M–L |
| D2 | **PDF/DOCX hyperlink extraction.** Emit `LINKS_TO` edges from PDF and DOCX hyperlinks. | Lower priority than mention extraction; PDF link extraction is library-quality-dependent. | S–M |
| D3 | **Retroactive doc-graph for Phase 6 `WatchedFolder`.** Wire `DocEntityExtractor` and `PdfDocxEntityExtractor` into `FolderDocumentIndexingService`. | Decoupling discipline in v1 design (T6.2, T6b.1) keeps this small — likely a single PR plus migration of existing folder-collection data. | S–M |
| D4 | **`Section` node surfacing in MCP tools.** Dedicated `get_document_outline` tool or `get_architecture` extension to expose document section hierarchy. | Internal-only in v1 to avoid bloating `get_architecture`; revisit once usage data shows demand. | S |
| D5 | **`.pkmignore` support.** A pkm-specific ignore file alongside `.gitignore`. | Punted in original scoping; add only if a real user asks. | S |
| D6 | **Cross-machine portability of local-folder repos.** Index data referencing absolute paths can't move hosts as-is. Needs a path-anchor strategy. | High cost, marginal value for current single-user, single-host model. | L |
| D7 | **Rename detection** in `LocalFolderChangeDetector`. Currently a rename is processed as delete + add. | Adds complexity (content-hash bucketing across delete/add candidates). Acceptable in v1 because chunks are re-embedded under the new path; cost is wasted re-embedding only. | M |
| D8 | **Higher-fidelity PDF/DOCX graph extraction**: layout-aware extraction, OCR confidence scoring, table-aware mention extraction. | v1 ships heuristic regex matching with `confidence: "low"`. Better extractors are available but expensive. | L |

---

## 6. Sequencing & Parallelization

### 6.1 Consolidated 5-phase delivery

The 8 PRs in Section 2 are **delivered as 5 phases** to give reviewers complete vertical slices. Each phase is tracked by a GitHub issue; PRs cite their phase issue.

| Phase | Issue | Bundles | Approx LoC |
| ----- | ----- | ------- | ---------- |
| **A — Foundation** | [#564](https://github.com/sethships/PersonalKnowledgeMCP/issues/564) | PR 1 (data model + manifest) | ~300–400 |
| **B — Local folder lifecycle** | [#565](https://github.com/sethships/PersonalKnowledgeMCP/issues/565) | PR 2 (initial scan) + PR 3 (change detection + incremental update) | ~700–900 |
| **C — User-facing surface** | [#566](https://github.com/sethships/PersonalKnowledgeMCP/issues/566) | PR 4 (CLI/MCP registration) + PR 5 (watcher + FolderEventRouter) | ~700–900 |
| **D — Document graph** | [#567](https://github.com/sethships/PersonalKnowledgeMCP/issues/567) | PR 6 (markdown) + PR 6b (PDF/DOCX) | ~700–1100 |
| **E — ADR + polish** | [#568](https://github.com/sethships/PersonalKnowledgeMCP/issues/568) | PR 7 (ADR-0007, README, CLI/MCP help) | ~150–300 |

Phases B, C, and D **will exceed the 400-LoC project guideline**. Accepted because shipping each as a single coherent PR delivers a complete reviewable feature slice; reviewers should expect to load the design docs as context.

### 6.2 Critical path

```
Phase A (#564 — types + manifest)
   │
   ├──> Phase B (#565 — lifecycle: scan + update)
   │       │
   │       └──> Phase C (#566 — CLI/MCP surface + watcher)
   │
   └──> Phase D (#567 — doc-graph: markdown + PDF/DOCX)
                                 │
                                 ▼
                       Phase E (#568 — ADR + polish)
                       (waits for A–D)
```

### 6.3 Parallelizable

- **Phase D (#567)** depends on Phase A only — graph schema additions sit on top of the type discriminator. The extractor is intentionally decoupled from the local-folder concept and can be developed and unit-tested against fixture documents with no live local-folder repo. Can run in parallel with B and C if reviewer bandwidth allows.
- **Within Phase C**, the watcher (PR 5 work) depends on the coordinator landing in Phase B. The CLI/MCP registration (PR 4 work) can be drafted against a mocked coordinator.

### 6.4 Suggested execution order (single-developer path)

1. Phase A — [#564](https://github.com/sethships/PersonalKnowledgeMCP/issues/564) — Foundation (blocks everything).
2. Phase B — [#565](https://github.com/sethships/PersonalKnowledgeMCP/issues/565) — Lifecycle: scan + change detection + incremental update.
3. Phase C — [#566](https://github.com/sethships/PersonalKnowledgeMCP/issues/566) — CLI/MCP surface + watcher.
4. Phase D — [#567](https://github.com/sethships/PersonalKnowledgeMCP/issues/567) — Markdown + PDF/DOCX doc-graph.
5. Phase E — [#568](https://github.com/sethships/PersonalKnowledgeMCP/issues/568) — ADR + README + CLI help polish.

Each phase independently passes `bun run typecheck` + `bun test` + `bun run build` per the mandatory pre-PR checklist.

### 6.5 Estimated total size

- Net new code: ~2,900–3,600 LoC across 5 phase PRs (PDF/DOCX adds ~400 LoC).
- Modified code: ~450–650 LoC across existing files (the shared-parse refactor adds modest delta to `MarkdownParser` and `IngestionService`).
- Test code: ~2,400+ LoC (PDF/DOCX adds ~400 LoC of tests + chunk-coverage regression test).

---

## 7. Resolved Technical Decisions (Doc-Graph Scoping)

All six questions surfaced during doc-graph scoping have been resolved by the user. They are recorded here for traceability; no further input is required to begin implementation.

1. **Cross-repo MENTIONS resolution — RESOLVED: intra-repo only in v1.** Cross-repository linking is tracked as deferred feature **D1** (Section 5a) per user request: "we could flag a feature to add later about linking repositories/folders."
2. **Wikilink precedence — RESOLVED: doc title > path stem > section anchor > code symbol; first match wins.** Locked into T6.2 acceptance criteria.
3. **`Section` node visibility — RESOLVED: internal-only in v1.** Not surfaced through `get_architecture` or any other MCP tool. Locked into T6.1 (schema) and T6.2 (extractor) acceptance. Future surfacing tracked as deferred feature **D4**.
4. **`MarkdownParser` shared-parse reuse — RESOLVED: accepted with hard coverage constraint.** The shared parse must not omit any part of the document from chunk coverage. Locked into T6.5 acceptance criteria with byte-complete coverage assertion and a regression test in T7.1.
5. **PDF/DOCX-graph extraction — RESOLVED: included in v1.** User overrode the architect's deferral recommendation. Implemented as PR 6b with `confidence: "low"` MENTIONS edges and the limitations documented. Higher-fidelity extraction tracked as deferred feature **D8**.
6. **Phase 6 `WatchedFolder` retroactive doc-graph — RESOLVED: stays decoupled in v1, retroactive wiring tracked as deferred feature D3.** Decoupling discipline enforced by acceptance criteria on T6.2 and T6b.1: extractors take parsed-document input + repo context only, with no `RepositoryInfo.source` or local-folder-specific dependencies.

---

## 8. Cross-References

- **Existing local-path code** (this plan's foundation): `src/utils/path-utils.ts::isLocalPath`, `src/services/ingestion-service.ts:244–295`, `src/services/incremental-update-coordinator.ts:451,759,775`, `src/cli/commands/index-command.ts`.
- **Phase 6 infrastructure to reuse**: `src/services/folder-watcher-service.ts`, `src/services/watched-folder-store.ts`, `src/services/folder-document-indexing-service.ts`, `src/mcp/job-tracker.ts`.
- **Pipeline seam**: `src/services/incremental-update-pipeline.ts::processChanges` — accepts `FileChange[]` regardless of source.
- **Graph ingestion seam**: `src/graph/ingestion/GraphIngestionService.ts` — branches on file extension already; doc branch is additive.
- **Markdown parsing**: `src/documents/extractors/MarkdownParser.ts` — already extracts sections + frontmatter; reuse, do not duplicate.
- **In-flight test file** (signal that work has started): `tests/isolated/incremental-update-local-git.test.ts`.

---

*End of plan.*
