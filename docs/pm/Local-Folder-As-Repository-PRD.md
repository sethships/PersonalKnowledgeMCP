# Local Folder as First-Class Repository PRD - Personal Knowledge MCP

**Version:** 1.0
**Date:** May 4, 2026
**Status:** Approved for Implementation
**Author:** Product Team
**Parent Document:** [High-level Personal Knowledge MCP PRD](../High-level-Personal-Knowledge-MCP-PRD.md)
**Related Document:** [Phase 6: Unstructured Document Ingestion PRD](./Phase6-Document-Ingestion-PRD.md)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Scope](#2-scope)
3. [User Stories and Use Cases](#3-user-stories-and-use-cases)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Goals](#5-non-goals)
6. [Decisions Log](#6-decisions-log)
7. [Phasing](#7-phasing)
8. [Open Items](#8-open-items)

---

## 1. Problem Statement

In the user's own framing: *"I want to point the system at a local folder and have it behave like an indexed repository — same MCP tools, same lifecycle, same mental model. The source just happens to be a filesystem path instead of a git remote."*

Today, "repository" in Personal Knowledge MCP is implicitly *a cloned git remote*. Users with a local working tree they have not pushed (a scratch project, a private monorepo checkout, a folder of design docs not under git, an Obsidian vault, a folder of mixed code and documentation) cannot achieve parity with the git-cloned experience.

Phase 6 introduced a parallel concept — **WatchedFolder** — that intentionally targets unstructured documents (.md/.txt/.pdf/.docx) and is exposed via a separate `list_watched_folders` MCP surface. WatchedFolders are docs-only and do not flow through the AST/graph pipeline. The result is a **two-class citizen problem**: a local folder is either treated as documents-only (Phase 6) or it must be promoted to a git remote.

This PRD defines a new capability — **Local Folder Source** — that registers a local folder as a first-class repository in the existing repository registry. It coexists with both git-sourced repositories and Phase 6 WatchedFolders without replacing either.

---

## 2. Scope

### In scope

- A new "local folder" source type for repositories. A registered local folder is **indistinguishable from a git-cloned repository** at the MCP tool layer: it appears in `list_indexed_repositories`, is searchable via `semantic_search` and `search_documents`, and is exposed to all graph tools (`get_dependencies`, `get_dependents`, `get_architecture`, `find_path`).
- Mixed-content support: a single registered folder may contain source code, documentation, PDFs, and other indexable artifacts. Each file is routed to the appropriate ingestion pipeline.
- **Graph extraction for documents, not just code.** The graph pipeline expands beyond AST-derived code relationships to include document-level relationships: markdown links, heading hierarchies, cross-references to code symbols, Obsidian-style `[[wikilinks]]`, and file-to-file mentions. Code retains AST-level precision; documents get link/reference-based extraction.
- Filesystem watching for local-folder repositories, reusing Phase 6's `chokidar` infrastructure via a shared event router.
- `.gitignore` honored when present at the folder root.
- Soft and hard size guardrails to prevent accidental indexing of overly broad paths (e.g., a home directory or system root).
- Drift detection when a registered folder is moved or deleted, surfaced through the existing `drift_detected` status.

### Out of scope (future phases)

- Cross-machine portability of a local-folder repository's index. Indexes are host-local.
- A dedicated `.pkmignore` filter file. Users may supply include/exclude globs at registration.
- Automatic migration of existing Phase 6 WatchedFolder entries into local-folder repositories.
- Cloud / network-share folder sources (OneDrive, Google Drive, SMB shares).
- Two-way sync or write-back to the source folder.

### Relationship to Phase 6

Phase 6's WatchedFolder remains the documents-only path with its own `list_watched_folders` surface. Local-folder repositories are a **new, parallel** abstraction that supports the full pipeline (code + docs + graph). Users wanting graph tools on a folder of notes should register it as a local-folder repository, not as a Phase 6 WatchedFolder. The two will coexist; no migration is provided. Doc-graph extraction is a forward-compatible capability that WatchedFolder may adopt later.

---

## 3. User Stories and Use Cases

### US-1: Local code checkout (primary)
**As a** developer with a local checkout that is not pushed to a remote
**I want to** register `C:\src\my-project` as a repository
**So that** `semantic_search`, `get_dependencies`, `get_dependents`, `get_architecture`, and `find_path` work on it identically to a cloned GitHub repository.

**Acceptance criteria:**
- Registration accepts an absolute folder path and optional `--name`.
- Registered folder appears in `list_indexed_repositories` with `source: "local-folder"` and the absolute path.
- All graph MCP tools return results filtered by the local-folder repository name.

### US-2: Knowledge vault
**As a** knowledge worker with an Obsidian vault at `D:\notes`
**I want to** register the vault as a repository
**So that** it is searchable via `semantic_search`, *and* internal links and `[[wikilinks]]` participate in the knowledge graph.

**Acceptance criteria:**
- Markdown files are parsed for inter-document links, headings, and cross-references.
- `get_dependencies` on a notes file returns documents it links to.
- `get_dependents` returns documents that link back.

### US-3: Mixed-content folder
**As a** researcher with a folder containing source code, PDFs, and markdown notes
**I want to** register the folder once and have everything indexed appropriately
**So that** code goes through the AST/graph pipeline and documents go through the document/graph pipeline, all under one repository identifier.

### US-4: Lifecycle parity
**As a** user of any local-folder repository
**I want** `trigger_incremental_update` and `get_update_status` to work identically to git-sourced repositories.

### US-5: Live editing
**As an** active developer or writer
**I want** the system to detect filesystem changes and update the index automatically
**So that** I do not need to manually trigger updates during a normal work session.

### US-6: Safety net for broad registrations
**As a** user who might accidentally point the tool at a very large directory
**I want** the system to warn or refuse before indexing tens of thousands of files
**So that** I do not exhaust disk, memory, or embedding-provider quota by mistake.

---

## 4. Functional Requirements

### 4.1 Registration

- **FR-1.1** A single CLI verb registers a local folder as a repository: `cli index <path>`. The existing `cli index <url-or-path>` verb auto-detects whether the argument is a git URL or a local absolute path. **No separate `index-folder` verb is introduced.**
- **FR-1.2** Registration is asynchronous and returns a job ID. Progress is observable via `get_update_status`.
- **FR-1.3** The absolute, canonicalized path is the deduplication key. If a path is already registered, registration fails with a clear error.
- **FR-1.4** The user-supplied `--name` (or a derived default from the leaf folder name) is the display key. Name collisions with any existing repository (git-sourced or local-folder) are rejected; the user must supply an explicit `--name`.
- **FR-1.5** Symlinks are NOT followed by default. An opt-in `--follow-symlinks` flag enables traversal.
- **FR-1.6** Registration requires an instance tier choice. Default is `private`. The `public` tier is **refused** for local-folder registrations; the user receives a clear error directing them to use `private` or `work`.

### 4.2 Repository parity at the MCP layer

- **FR-2.1** Registered local folders appear in `list_indexed_repositories` with at minimum: `name`, `source: "local-folder"`, `absolute_path`, `instance_tier`, `file_count`, `last_indexed_at`, and `status`.
- **FR-2.2** All MCP tools that accept a `repository` filter MUST accept a local-folder repository name and behave identically to a git-sourced repository:
  - `semantic_search`
  - `search_documents`
  - `get_dependencies`
  - `get_dependents`
  - `get_architecture`
  - `find_path`
  - `get_graph_metrics`
  - `trigger_incremental_update`
  - `get_update_status`
- **FR-2.3** Update-history records relax their schema so that the commit SHA field is optional. Local-folder updates record a content fingerprint (path + mtime + size hash, or content hash) in lieu of a commit SHA.

### 4.3 Ingestion routing

- **FR-3.1** Each file in a registered folder is routed to the appropriate pipeline based on extension and detection:
  - Source code in supported languages → AST parsing + graph population (code precision).
  - Markdown / text / PDF / DOCX → document ingestion + graph extraction (link/reference precision).
  - Other allowed extensions → text-only chunking and embedding, no graph entities.
- **FR-3.2** Default include set is the existing `DEFAULT_EXTENSIONS` whitelist (the same set used for git-sourced repositories today). Users may override via `--include` and `--exclude` glob lists at registration.
- **FR-3.3** If a `.gitignore` is present at the folder root (or in subdirectories), it MUST be honored. Patterns from `.gitignore` compose with user-supplied excludes.
- **FR-3.4** No `.pkmignore` is introduced in v1. (See Open Items.)

### 4.4 Graph extraction for documents

- **FR-4.1** Markdown files contribute the following graph entities and relationships:
  - **Entities:** documents, headings (with hierarchy), explicit anchors. Heading/section nodes are **internal-only in v1** — they participate in graph traversals but are NOT surfaced through `get_architecture`. (Future revisions may expose them.)
  - **Relationships:** `LINKS_TO` (markdown links and `[[wikilinks]]`), `CONTAINS` (heading hierarchy), `MENTIONS` (cross-references to code symbols when detectable, e.g., `auth.ts::login`, `\`ClassName\``).
- **FR-4.2** PDF and DOCX files participate in the graph with **minimum-viable extraction** in v1:
  - **Entities:** the document itself as a graph node (with title/author metadata where available).
  - **Relationships:** `MENTIONS` edges from the document to known code symbols when extracted text contains a recognizable match (e.g., a fully-qualified path-and-symbol reference, or an unambiguous bare symbol that resolves to exactly one in-repo node).
  - **Quality caveat:** PDF/DOCX-graph resolution is documented as notably lower-quality than markdown-graph resolution. Plaintext extraction loses the explicit link semantics that markdown provides, so `MENTIONS` edges are best-effort and may exhibit lower recall and precision than equivalent markdown edges. Absence of relationships is not a failure.
  - Plain-text (.txt) files follow the same minimum-viable approach as PDF/DOCX.
- **FR-4.3** **Wikilink and reference resolution precedence** for `[[target]]` and similar references is, in order, first-match-wins:
  1. Document title (front-matter title, or first H1).
  2. Path stem (filename without extension, relative to the folder root).
  3. Section anchor within any document.
  4. Code symbol (qualified name in the repository's code graph).
  An unresolved reference is recorded as a dangling `LINKS_TO` edge with no target; it is not a failure.
- **FR-4.4** **Cross-repository / cross-folder resolution is out of scope in v1.** All `MENTIONS`, `LINKS_TO`, and wikilink resolution is **intra-repository only**. References that would resolve only by crossing into another indexed repository are recorded as dangling. (Cross-repo linking is captured as future work — see Section 5 / Section 7.)
- **FR-4.5** Doc-graph extraction is implemented for local-folder repositories first. Phase 6 WatchedFolder is not retroactively migrated to the new extraction; it may adopt this capability in a later phase.
- **FR-4.6** The graph schema accommodates both code-derived and document-derived relationships in the same repository's graph. Queries via existing graph MCP tools transparently traverse both.
- **FR-4.7** **Shared markdown parse with chunker — coverage invariant.** The doc-graph extractor MAY share its markdown parse with the document chunker for performance, **but only if the entire document remains represented in the chunk/embedding output.** Sharing the parse MUST NOT cause any region of a markdown file to be omitted from semantic-search coverage. This is an explicit acceptance criterion: every byte / every section of every indexed markdown file must be represented by at least one chunk after the shared-parse refactor. A regression test is required (see FR-4.8).
- **FR-4.8** **Coverage regression test (mandatory).** A test in the v1 deliverable MUST take a representative markdown corpus (including documents with code blocks, tables, frontmatter, deeply nested headings, and trailing content after the last heading) and assert that the union of indexed chunk byte-ranges fully covers each source document with no gaps. The test MUST run as part of CI and MUST fail if any document has uncovered regions.

### 4.5 Watching

- **FR-5.1** Filesystem watching is **enabled by default** for local-folder repositories in v1. Users may opt out at registration or disable per-folder afterward.
- **FR-5.2** Watching reuses the Phase 6 `chokidar`-based infrastructure via a shared event router. The router inspects the folder ID on each event and dispatches to the appropriate pipeline (Phase 6 WatchedFolder docs-only path, or local-folder repository full path).
- **FR-5.3** Debounce, batching, and queueing semantics match Phase 6's processing-queue defaults. Per-folder overrides are supported.
- **FR-5.4** Watcher errors (permissions, ENOSPC on inotify watches, etc.) are surfaced in `get_update_status` and do not crash the MCP server.

### 4.6 Incremental updates

- **FR-6.1** `trigger_incremental_update` against a local-folder repository re-scans the folder, computes per-file fingerprints, and updates only changed/added/deleted files.
- **FR-6.2** Deletions are detected and pruned from the index and graph.
- **FR-6.3** Rate limiting (1 update per repository per 5 minutes) applies identically to local-folder repositories.

### 4.7 Drift detection

- **FR-7.1** If a registered folder's absolute path no longer exists or is no longer readable at update time, the repository's status is set to `drift_detected` (the existing status surface). The error message identifies the missing path and instructs the user to re-register.
- **FR-7.2** Drift is reported via `get_update_status` and surfaced in `list_indexed_repositories`.

### 4.8 Size guardrails

- **FR-8.1** At registration, the system performs a fast count + size estimate of the candidate folder (respecting `.gitignore` and user-supplied excludes).
- **FR-8.2** **Soft warning thresholds:** > 10,000 files OR > 1 GB total. The user is shown the estimate and prompted to confirm (CLI) or receives a warning in the registration job result (MCP).
- **FR-8.3** **Hard refusal thresholds:** > 100,000 files OR > 10 GB total. Registration is refused unless `--force` is supplied.
- **FR-8.4** Symlinks excluded from estimation when `--follow-symlinks` is off (default).

---

## 5. Non-Goals

1. **Cross-machine portability.** A local-folder repository's index is valid only on the host that registered it. Sharing the index across machines is out of scope.
2. **Two-way sync.** This is read-only ingestion; the system never writes to the source folder.
3. **Replacing git-sourced repositories.** Both source types are first-class and coexist.
4. **Auto-discovery.** No "scan my home directory and find code" behavior. Registration is always explicit.
5. **Mid-flight repointing.** Moving a registered folder requires deregister + re-register. Drift detection covers the failure mode; in-place rename support is a future enhancement.
6. **Cloud / network-share sources.** OneDrive, Google Drive, SMB, and other remote sources are deferred.
7. **Automatic Phase 6 WatchedFolder migration.** WatchedFolders remain documents-only with their existing surface. Users who want graph tools on a folder must register it as a local-folder repository.
8. **`.pkmignore` filter file.** Not in v1. Users use `--exclude` globs and `.gitignore`.
9. **Public-tier local folders.** Refused at registration to prevent accidental disclosure of private content.
10. **Cross-repository / cross-folder linking.** All wikilink, `LINKS_TO`, and `MENTIONS` resolution is intra-repository in v1. References that would only resolve by crossing into another indexed repository are recorded as dangling. Cross-repo linking is captured as an explicit future-roadmap item (see Section 7).

---

## 6. Decisions Log

These are the closed decisions from the product/architect review pass. Each entry records the question, the decision, and the brief rationale.

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Code only, or docs too? | **Both. Plus graph extraction applies to documents, not just code.** | User explicitly: *"Why wouldn't graph be able to index docs too? It isn't as structured as code but there are logical connections. If so then don't treat a folder differently."* Markdown links, heading hierarchies, wikilinks, and cross-references to code symbols are first-class graph relationships. Code retains AST precision; docs get link/reference extraction. |
| 2 | Folder identity model | **Absolute path is the canonical dedup key; user-supplied name is the display key.** | Path is unambiguous and stable for a given host. Name remains user-friendly and is the handle used in MCP tool calls. |
| 3 | Multi-machine portability | **Out of scope. Indexes are host-local.** | Local-folder paths are inherently host-bound; cross-machine sharing introduces complexity (path remapping, content hashing as identity) that is not justified for v1. |
| 4 | Watching in v1 | **Yes. Included in v1.** Reuse Phase 6 chokidar via a shared event router that dispatches by folder ID. | User explicitly: *"do it now."* Phase 6 already has the watching infrastructure; the marginal cost is the routing layer. |
| 5 | Filtering rules | **Honor `.gitignore` if present. No `.pkmignore` in v1. Default include set = existing `DEFAULT_EXTENSIONS`.** | Reuses an established mental model (`.gitignore`) and the existing extension whitelist. Avoids inventing a new filter mechanism prematurely. |
| 6 | Phase 6 WatchedFolder reconciliation | **Option (a): keep both. No migration. Document the difference.** | Avoids a destabilizing data migration. Users who need graph tools on a folder re-register as a local-folder repository. WatchedFolder may adopt doc-graph extraction in a future phase. |
| 7 | Security / instance tier | **Default `private`. `public` registration is refused.** | Local folders very often contain confidential or personal data. Refusing `public` is a safe default; users who genuinely want a public-tier folder are forced to make an explicit, deliberate choice in a future phase. |
| 8 | Identifier collisions | **Reject. Require explicit `--name`.** | Auto-suffixing creates silent ambiguity. An explicit name keeps repository identifiers predictable across the MCP surface. |
| 9 | Size guardrails | **Soft warn at 10K files / 1 GB. Hard refuse at 100K files / 10 GB unless `--force`.** | Protects users from accidentally indexing a home directory or system root, while leaving an escape hatch for legitimately large repositories. |
| 10 | Registration behavior | **Asynchronous, returns a job ID; progress via `get_update_status`.** | Matches the existing git-clone registration pattern; consistency at the MCP surface. |
| 11 | Drift surfacing | **Use the existing `drift_detected` status when a registered folder is moved or deleted.** | Reuses an established status surface; users do not need to learn a new error vocabulary. |
| 12 | Symlinks | **Off by default. `--follow-symlinks` opt-in.** | Symlink loops, escapes from the folder root, and unbounded fan-out are real risks. Off-by-default is the safe choice. |
| 13 | Update history schema | **Commit SHA field becomes optional; local-folder updates record a content fingerprint instead.** | The schema must accommodate both source types. Optional commit SHA is the minimal change. |
| 14 | CLI surface | **Single verb. `cli index <path-or-url>` auto-detects.** | Avoids a parallel surface (`index-folder`) and matches the user's stated mental model: "a folder is just another kind of source." |
| 15 | Cross-repo `MENTIONS` / wikilink resolution | **Intra-repo only in v1. Cross-repo linking added to future roadmap.** | User: *"we could flag a feature to add later about linking repositories/folders."* Keeps v1 resolver scope bounded; dangling references are recorded so future cross-repo resolution can backfill without re-ingesting. |
| 16 | Wikilink resolution precedence | **Doc title → path stem → section anchor → code symbol. First match wins.** | Most-specific-to-least-specific ordering matches user mental models from tools like Obsidian. Deterministic and explainable. |
| 17 | Section node visibility | **Internal-only in v1. Not surfaced through `get_architecture`.** | Section nodes are useful for traversal but would clutter architecture overviews. Defer surfacing until we have a UX answer for how to render heading hierarchies alongside code modules. |
| 18 | Markdown parser reuse between chunker and graph extractor | **Allowed, with a hard coverage invariant: the entire document MUST remain represented in chunks.** A regression test asserting full byte/section coverage of every indexed markdown file is mandatory in v1. | User: *"so long as the entire doc is being indexed."* Performance win is real, but cannot come at the cost of dropping content from semantic search. |
| 19 | PDF/DOCX-graph extraction in v1 | **In scope for v1 (user override of architect recommendation).** Minimum-viable: file-level entities + outbound `MENTIONS` to known code symbols. Documented quality caveat: notably lower resolution than markdown. | User: *"Add it anyway."* Architect estimated +~400 LoC / +1 PR. Doing it now keeps the doc-graph story coherent across formats from day one rather than leaving PDF/DOCX as a second-class citizen. |
| 20 | Retroactive doc-graph for Phase 6 WatchedFolder | **Confirmed deferred. Not part of this PRD.** | Already covered by decision 6. Re-confirmed during final review. |

---

## 7. Phasing

The user's decision to include watching in v1 collapses the originally proposed v1 / v1.1 split. There is a single v1 deliverable.

### v1 (current scope)

- Local-folder registration (CLI + MCP) with auto-detection in `cli index`.
- Async registration with job ID and `get_update_status` progress.
- Absolute-path dedup + user-supplied name as display key.
- Full pipeline routing: code → AST/graph; docs → document/graph.
- Markdown-graph extraction: documents, headings (internal-only), explicit anchors, `LINKS_TO` (markdown links + `[[wikilinks]]`), `CONTAINS` (heading hierarchy), `MENTIONS` (code-symbol cross-references).
- Wikilink/reference resolution precedence: doc title → path stem → section anchor → code symbol; first match wins.
- **PDF / DOCX / plaintext minimum-viable graph extraction:** file-level entities + outbound `MENTIONS` to known code symbols, with a documented quality caveat (lower resolution than markdown).
- Cross-repository linking is **intra-repo only in v1**; unresolved cross-repo references are recorded as dangling for future backfill.
- Shared markdown parse between chunker and doc-graph extractor is permitted, gated on a mandatory full-coverage regression test (every byte of every indexed markdown file represented by at least one chunk).
- All graph MCP tools work against local-folder repositories.
- `.gitignore` honored; user `--include` / `--exclude` globs; default `DEFAULT_EXTENSIONS` whitelist.
- Filesystem watching enabled by default, reusing Phase 6 chokidar via a shared event router.
- Incremental updates with content-fingerprint detection.
- Drift detection via existing `drift_detected` status.
- Soft and hard size guardrails (10K/1GB warn, 100K/10GB refuse without `--force`).
- Default `private` tier; `public` refused.
- Symlinks off by default; `--follow-symlinks` opt-in.
- Update-history schema accepts optional commit SHA.

### Future phases (deferred)

- **Cross-repository / cross-folder linking.** Resolve `MENTIONS`, `LINKS_TO`, and wikilinks across repository boundaries so that, e.g., a note in one local-folder repository can graph-link to a code symbol in a separate git-sourced repository. v1 records unresolved cross-repo references as dangling so they can be backfilled without re-ingesting.
- **Surfacing section/heading nodes in `get_architecture`.** Once we have a UX answer for blending document hierarchies with code module hierarchies.
- **Higher-quality PDF/DOCX-graph extraction.** Layout-aware parsing, table-of-contents-derived hierarchy, citation extraction.
- **Phase 6 WatchedFolder adoption of document-graph extraction** (retroactive uplift; explicitly deferred per Decision 20).
- `.pkmignore` filter file.
- Cross-machine index portability (likely via content-hash identity and path-remapping metadata).
- In-place folder-rename detection (avoid forced re-registration).
- Cloud / network-share sources (OneDrive, Google Drive, SMB).

---

## 8. Open Items

All product-level questions raised during review have been answered (see Decisions Log entries 1–20). Items remaining for the architect to resolve in the technical design — none of which block PRD sign-off — are limited to:

1. **Watcher event router design.** The shared router that dispatches between Phase 6 WatchedFolder and local-folder repositories is a new component. The architect should specify its placement, interface, and ownership of the chokidar instance.
2. **Concurrency limits for very large registrations.** The hard cap (100K files) implies long-running ingest jobs. The architect should specify per-job concurrency limits and resumability behavior on process restart, consistent with the existing interrupted-update-recovery surface.

(The previously open items on doc-graph extraction depth, wikilink/code-symbol resolution precedence, and PDF/DOCX scope have been resolved in Decisions Log entries 15–19 and reflected in FR-4.1 through FR-4.8.)

---

*This PRD is the product anchor for the Local Folder as Repository capability. The technical design follows in a companion architecture document.*
