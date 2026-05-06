# ADR-0008: `repositories.json` Path Model for Cross-OS Migration Portability

**Status:** Accepted (revised 2026-04-23 — Option D promoted into V1 scope)

**Date:** 2026-04-23

**Deciders:** Architecture Team

**Technical Story:** Migration bundles must restore cleanly across operating systems and install locations. PRD v1.1 FR-1.9 mandates: *"A backup from Windows restored on Linux (or vice versa) must result in a functional system with correct semantic+graph search, with at most a single documented re-configuration step."* The current `repositories.json` stores absolute OS-native paths (e.g., `"C:\\src\\PersonalKnowledgeMCP\\data\\repositories\\PersonalKnowledgeMCP"`), which silently break on any cross-OS or cross-install-location restore.

## Context and Problem Statement

`data/repositories.json` is the source-of-truth metadata store. Each entry currently holds `localPath` as an absolute OS-native path to the cloned repo directory. Inspection of a live `data/repositories.json` on the project's own checkout:

```json
{
  "name": "PersonalKnowledgeMCP",
  "localPath": "C:\\src\\PersonalKnowledgeMCP\\data\\repositories\\PersonalKnowledgeMCP",
  ...
}
```

This path is used by `RepositoryCloner`, `IncrementalUpdatePipeline`, `InterruptedUpdateRecoveryService`, `remove-command.ts`, and the ingestion service to locate files on disk for re-clone, `git pull`, and filesystem scanning. On a target machine with a different install location (`/home/user/pk-mcp/data/repositories/...`) or a different OS entirely, those paths are meaningless — the code will fail on the first re-clone or `git pull`.

Additionally, the existing `src/cli/utils/dependency-init.ts` reads `CLONE_PATH` env (defaulting to `./data/repositories`) and `DATA_PATH` env (defaulting to `./data`), but these defaults are resolved once at service startup and never reflected back into the stored `localPath` field. The result is that `repositories.json` is tightly coupled to the specific machine and install location that produced it.

### Related current state

- `src/config/instance-config.ts` already has a per-instance `dataPath` field (e.g., `./data/private`). This is promising — a "data root" concept exists — but V1 scope is single-instance (default profile), so the immediate concern is a single data-root variable.
- `RepositoryCloner` (`src/ingestion/repository-cloner.ts`) takes `clonePath` at construction time (default `./data/repositories`) and joins it with `repoName` to produce the target path.
- `remove-command.ts` already validates that `localPath` lives under the configured `CLONE_PATH` as a security check (prevents path escape). Any path-model change must preserve this boundary.
- `sanitizeCollectionName` and `collectionName` are already stable and do not need rewriting.
- `updateHistory` entries contain no paths — safe to round-trip unchanged.

## Decision Drivers

- **Cross-OS portability**: A Windows-produced archive must restore on Linux and vice versa with zero manual path-editing.
- **Cross-install portability**: A user who installs the MCP in `C:\src\pk-mcp` on one machine and `~/tools/pk-mcp` on another must be able to migrate between them with a single configuration step.
- **Backward compatibility**: Existing installations have absolute paths in their `repositories.json`. The upgrade to the new path model must not require users to re-index.
- **Security boundary preservation**: `remove-command.ts`'s path-escape check (ensuring `localPath` is under the configured clone directory) must continue to work.
- **Simplicity**: We are one person with one codebase; we cannot afford a sprawling path-abstraction layer.
- **Resilience to user re-location**: Users who move the data directory after initial setup should not have to regenerate metadata.
- **Minimal refactor**: The pattern must be cheap to introduce. Large writer-side refactors compete with the migration feature's V1 scope.

## Considered Options

### Option A: Rewrite-on-Restore (paths stay absolute)

**Description:** Keep `localPath` as an absolute path in `repositories.json`. On restore, the migration tool rewrites all `localPath` entries to target-machine-appropriate absolute paths using the target's configured data root.

**Pros:**
- Zero change to the writer side (no code modification in ingestion, cloner, pipelines).
- Zero change to the runtime reader side (every consumer still receives an absolute path).
- Focused, minimally-invasive change contained to the restore adapter.
- Existing installs need no data migration — the first backup they take still has absolute paths, and the first restore rewrites them.

**Cons:**
- Brittle to post-restore user relocations. If the user restores into `/home/user/pk-mcp/data/...` and later moves the directory to `/opt/pk-mcp/data/...`, `repositories.json` is stale and the user hits "missing local clone" errors on the next `update-all` — the same problem we started with.
- Every new field that stores a path (future features) has to remember to be rewritten by the restore tool. Bug magnet.
- Does not solve the *local* problem of paths being machine-absolute even within a single install — just defers the pain.
- Doesn't help the "what if the user changes `DATA_PATH`" case at all.

### Option B: Tokenized Storage (store `{{DATA_ROOT}}/...`, resolve at read time)

**Description:** On write, replace the data-root prefix with a token (e.g., `{{DATA_ROOT}}`) before persisting to `repositories.json`. On every read, resolve the token against the current configured data root.

Example stored form:
```json
{
  "name": "PersonalKnowledgeMCP",
  "localPath": "{{DATA_ROOT}}/repositories/PersonalKnowledgeMCP",
  ...
}
```

**Pros:**
- `repositories.json` is fully portable between machines, OSes, and install locations. No restore-time rewrite needed.
- Post-restore user relocations "just work" because resolution happens on every read.
- Uniform invariant: stored paths are always tokenized. Easier to reason about.
- Forward-compatible with multi-instance post-V1 — each instance's tokenized paths resolve against its own configured data root.
- The `.json` file remains diff-friendly across machines.

**Cons:**
- Requires refactor of writers to tokenize before write (the centralized writer is `RepositoryMetadataStoreImpl.updateRepository`, so the change surface is small).
- Requires every reader that uses `localPath` to resolve through a helper (not automatic — consumers have to opt in).
- Existing installs' `repositories.json` files contain absolute paths, so we need a one-time migration step (or tolerance-on-read for legacy absolute paths).
- Path separators inside the stored token form: do we store POSIX style (`/`) exclusively and resolve to the target OS style on read? Yes — that decision goes in the Implementation section and avoids new cross-OS bugs.

### Option C: Configurable Data Root + Relative Paths Under It

**Description:** Store paths as relative strings under the configured data root (e.g., `"repositories/PersonalKnowledgeMCP"` rather than tokenized or absolute). Readers join with the current `DATA_ROOT` from config.

**Pros:**
- Simplest representation; no synthetic token syntax.
- Cross-OS portable by default (POSIX separators in storage, resolve at read).
- Same writer refactor footprint as Option B.

**Cons:**
- Less self-describing than tokenized form (a reader seeing `"repositories/foo"` has to know the convention; `"{{DATA_ROOT}}/repositories/foo"` is unambiguous).
- No way to store a path that escapes the data root (e.g., a local-path-based indexing source that lives elsewhere) without reintroducing absolute paths or adding a second field. Current code supports `isLocalPath` detection for local paths outside the clone directory — those paths would need a different storage treatment.
- Less future-proof: if we ever add a second root (e.g., `{{CACHE_ROOT}}`, `{{MODELS_ROOT}}`), this scheme has no room for it.

### Option D: Hybrid — Tokenized Under Data Root, Absolute for User-Supplied Local Paths

**Description:** Use Option B's tokenization for anything inside the configured data root. For local-path-based ingestion sources (where the user points at a repo outside the data root, which is already supported via `isLocalPath` in `src/utils/path-utils.ts`), keep the absolute path as-is and mark the entry with an `isExternalPath: true` flag. On restore across machines, external-path entries are re-pointed to a target equivalent (via a restore-time prompt or a config file) or flagged as broken.

**Pros:**
- Covers the real-world scope: data-root-managed clones use tokens; user-specified external paths are transparent about their unportability.
- `isExternalPath` is a NEW stored attribute on `RepositoryInfo` that captures *where the indexed content lives on disk* (under `CLONE_ROOT` vs not). It is **independent of** `isLocalPath(url)` from `src/utils/path-utils.ts`, which captures *what kind of source URL the user supplied*. The two are correlated in common cases but not equivalent: a `file://` URL with a localPath under `CLONE_ROOT` has `isLocalPath(url)===true` and `isExternalPath===false`.
- Lets the restore flow ask the user "this archive was indexed against `/home/alice/my-repo` which doesn't exist on this machine — where should I point it?" in a controlled way.

**Cons:**
- More complex than Option B; two classes of path to maintain.
- Requires that the type system capture the distinction (`localPath` is currently just a `string`).
- Restore-time UX is more involved (interactive prompt or config mapping).

## Decision Outcome

**Chosen option: Option D — Hybrid tokenized model. Clone-managed paths use `{{CLONE_ROOT}}`/`{{DATA_ROOT}}` tokens (Option B behavior); user-supplied external paths are stored verbatim and marked with an `isExternalPath: true` flag so restore can handle them deliberately.**

Status note: this ADR was originally proposed with Option B as the chosen option and Option D flagged as a follow-up. Following stakeholder review on 2026-04-23, Option D is promoted into V1 scope because real user workflows include ingesting from arbitrary local paths (not just cloned git repositories), and those entries must also survive cross-OS/cross-install restore. This ADR is revised accordingly and moves to **Accepted**.

Rationale:

1. **Directly satisfies FR-1.9 for both path classes.** A Windows archive restored on Linux works for both clone-managed and external-path entries; the system handles each class deterministically instead of silently breaking external-path rows.
2. **Also solves the "user moved their data directory" problem** (Option B's original benefit is preserved for the clone-managed class). External paths are a separate concern, cleanly separated by the `isExternalPath` flag.
3. **Minimal writer-side surface.** The only writer for `repositories.json` is `RepositoryMetadataStoreImpl.updateRepository`. The change is: tokenize when the path is under a known root; stamp `isExternalPath: true` and store verbatim otherwise.
4. **Bounded reader-side change.** Readers that touch `localPath` are a small set — `RepositoryCloner.cloneRepository` / `updateToLatest`, `remove-command.ts`, `InterruptedUpdateRecoveryService`, and the pipeline's file-system scan. Each calls a single `resolveRepositoryPath(repo, roots)` helper; the helper treats external-path entries as already-resolved.
5. **Backward compatibility is cheap.** The read helper accepts both tokenized and absolute paths. Legacy absolute paths under a known root get rewritten to tokenized form on next write; legacy absolute paths outside all known roots are treated as external (and stamped with the flag) on next write.
6. **Restore-side handling is explicit, not implicit.** External-path entries are never silently "rewritten to something that looks plausible"; the user is asked, or the entry is marked broken, or it's skipped — see restore behavior below.

### Configuration surface

- **Current state (keep):**
  - `DATA_PATH` env (default `./data`) — resolved absolutely at service startup.
  - `CLONE_PATH` env (default `./data/repositories`) — resolved absolutely at service startup.
- **Post-V1 multi-instance (already exists):**
  - `src/config/instance-config.ts` per-instance `dataPath`.
  - V1 reuses the single-instance defaults; the tokenized representation is forward-compatible.

- **Canonical tokens (V1):**
  - `{{DATA_ROOT}}` — resolves to the current process's configured `DATA_PATH` (absolute).
  - `{{CLONE_ROOT}}` — resolves to the current process's configured `CLONE_PATH` (absolute). When `CLONE_PATH` is a subdirectory of `DATA_PATH` (the default case), `{{CLONE_ROOT}}` is preferred so that storing `{{CLONE_ROOT}}/PersonalKnowledgeMCP` doesn't hard-code the `repositories/` subdirectory.
- Additional tokens may be added additively later (`{{CACHE_ROOT}}`, etc.) without breaking older readers as long as the resolver returns the correct path.

### On-disk representation rules

- Paths are stored with **POSIX separators** (`/`) regardless of host OS when tokenized.
- Paths are tokenized (under a known root) **or** stored verbatim with `isExternalPath: true` (outside all known roots). These are the only two legal stored forms post-Option-D.
- External paths retain their **OS-native separators** on disk. They are not round-tripped through POSIX normalization because the whole point is "this is a machine-specific path"; the on-disk representation should match what the user typed and what the local filesystem expects.
- `repositories.json` gains a top-level `pathFormat: "tokenized-v1"` marker. Readers that see this marker know tokenization is in effect (and that the `isExternalPath` flag is authoritative). Readers seeing the legacy format (no marker, absolute paths) continue to work.

### Record shape examples

Clone-managed entry (default case):
```json
{
  "name": "PersonalKnowledgeMCP",
  "localPath": "{{CLONE_ROOT}}/PersonalKnowledgeMCP",
  "isExternalPath": false,
  ...
}
```

External-path entry (user pointed at a local directory outside the clone root):
```json
{
  "name": "my-local-research-corpus",
  "localPath": "D:\\research\\corpus",
  "isExternalPath": true,
  "externalPathOrigin": { "os": "win32", "sourceMachine": "kaiju-laptop" },
  ...
}
```

- `externalPathOrigin` is informational metadata captured at ingestion time. It helps the restore flow surface a useful "this path came from a Windows machine" prompt without the user having to guess. The `sourceMachine` sub-field is best-effort (`os.hostname()`); it is not a security boundary.
- Omission of `isExternalPath` on a record read from a legacy file is treated as `false` if the path resolves under a known root after tokenization, and `true` otherwise. On next write the field is materialized explicitly.

### Resolve/tokenize helpers

A new module `src/repositories/path-resolver.ts` provides:

```typescript
export interface PathRoots {
  dataRoot: string;   // absolute
  cloneRoot: string;  // absolute
}

export interface StoredPathForm {
  localPath: string;            // tokenized or verbatim
  isExternalPath: boolean;
  externalPathOrigin?: { os: NodeJS.Platform; sourceMachine?: string };
}

// Called by RepositoryMetadataStoreImpl.updateRepository before write.
export function tokenizePath(absolutePath: string, roots: PathRoots): StoredPathForm;

// Called by consumers of RepositoryInfo.localPath.
export function resolveRepositoryPath(stored: StoredPathForm, roots: PathRoots): string;
```

- `tokenizePath` prefers the most-specific root (`CLONE_ROOT` over `DATA_ROOT`). If the path escapes every known root, it returns `{ localPath: absolutePath, isExternalPath: true, externalPathOrigin: { os: process.platform, sourceMachine: os.hostname() } }`.
- `resolveRepositoryPath` on an external entry returns `stored.localPath` unchanged (no token substitution). Callers are expected to handle `fs.access`-style existence checks themselves; this helper does not stat the filesystem.

### Backward compatibility and data migration

- **On read**, `resolveRepositoryPath` accepts both tokenized and absolute paths. An absolute path that is under a known root is resolved to its current-machine equivalent by tokenizing-then-resolving (handles the "I moved my data directory" case for legacy data). An absolute path outside all known roots is returned verbatim and treated as external.
- **On write**, `RepositoryMetadataStoreImpl.updateRepository` always normalizes: paths under a known root become tokenized; paths outside every known root are stamped with `isExternalPath: true` and stored verbatim.
- **No explicit data migration step is needed** for existing installs. The system is self-healing on the first incremental update after upgrade — legacy rows are either tokenized or stamped external on the next write.
- The migration archive's `repositories.json` is always normalized regardless of the source's legacy state: the backup tool runs the tokenizer during snapshot assembly. This guarantees clone-managed archives are portable, and external-path entries are explicitly marked so restore can handle them deliberately.

### Archive writer behavior for external-path entries

- **Included in the archive.** External-path entries are still useful on restore (the user may be restoring onto the same machine, or onto a machine where they've pre-created the same directory layout). Silently dropping them would be more surprising than including them.
- **Manifest-noted.** The archive's `manifest.json` includes a `repositories.externalPaths` summary: a list of `{ name, localPath, externalPathOrigin }` records for each external entry. Restore reads this first to decide prompting, without having to parse the whole `repositories.json`.
- **Content not bundled.** The files referenced by an external path are **not** copied into the archive. This matches the existing design philosophy (the `--include-repos-source` flag is deferred out of V1) and keeps the archive size predictable. The user is responsible for making sure the external directory exists on the target.

### Restore-side behavior for external-path entries

On restore, each external-path entry is checked for existence on the target machine:

1. **Path exists on target at the same location.** Proceed. Log at info level.
2. **Path does not exist; interactive shell (TTY).** Prompt the user with:
   - "Repository `my-local-research-corpus` was indexed from `D:\research\corpus` on a Windows machine. This path does not exist on this machine. Provide a new path, skip this entry, or remove it from the index?"
   - Options: `[p]ath` (prompt for new absolute path, validated for existence), `[s]kip` (leave entry in `repositories.json` but mark as broken via a new `pathStatus: "broken"` field — index remains but ingestion refuses until repaired), `[r]emove` (delete from `repositories.json` and leave the ChromaDB/FalkorDB entries orphaned, cleaned up on next `pk-mcp maintenance` run).
3. **Path does not exist; non-interactive (CI, `--yes`).** **Fail-fast** (exit non-zero, list missing external paths) per code-review fix M-4 (revised 2026-05-05). Aligns with PRD FR-3.10's "must not silently succeed with broken entries" contract.
   - **`--skip-missing-external` opt-in flag.** When explicitly passed, restores the old "skip with exit 0 and warning per entry" semantics; the entry is left in place with `pathStatus: "broken"` and the user can repair it later via `pk-mcp repo repath <name> <new-path>`. The opt-in flag preserves the personal-laptop-move ergonomic for users who want it.
4. **`--external-path-map <file>`.** Power-user flag accepting a JSON/YAML mapping of `{ name: newPath }`. Any entry in the map is re-pointed without prompting. Entries not in the map fall through to step 1/2/3. This is the scripted migration path.

The `pathStatus: "broken"` marker is read by `RepositoryCloner.updateToLatest` and other writers; they refuse to operate on a broken entry until the user runs `pk-mcp repo repath` to fix it. This prevents silent partial failures deep inside a long-running update.

### Security boundary for external paths

- External paths skip the `remove-command.ts` "must be under `CLONE_PATH`" check by design — they're explicitly not under the clone root. Instead, they inherit a weaker invariant: the path must have been stored with `isExternalPath: true` (so a caller cannot smuggle an arbitrary absolute path through a code path that expects clone-managed input).
- The restore-time prompt validates the user-supplied new path with `fs.realpath` and refuses paths containing `..` segments after resolution. This is a defense against a malicious archive that somehow included a suspicious `localPath`; the target user is in the loop, but we don't let them trivially shoot themselves.
- External-path ingestion already exists in the codebase via `isLocalPath`; the security posture there is unchanged — users are trusted to point at their own directories.

### Security boundary preservation

The `remove-command.ts` check that `localPath` lives under `CLONE_PATH` continues to work with tokenized input: resolve first, then validate against the configured `CLONE_PATH`. The check becomes slightly more robust because the token makes the intended root explicit.

### Multi-OS path separator handling at resolve time

- On write: replace OS-native separators with `/` in the stored token form.
- On read: `path.join(root, relativeTail)` produces OS-native output; no extra normalization is needed in consumers.
- Tests must cover both directions: a Windows-produced `{{CLONE_ROOT}}/PersonalKnowledgeMCP` resolves correctly on Linux, and vice versa.

### Positive Consequences

- `repositories.json` is portable between OSes, between install locations, and tolerates post-restore user relocations.
- Migration archive is OS-neutral by construction; no restore-time rewrite step needed.
- Backward compatible — no data migration for existing installs.
- Writer surface is small (one module).
- Token vocabulary extends naturally as new roots are added.

### Negative Consequences

- Every consumer of `localPath` must call `resolveRepositoryPath`. There is no language-level guarantee this happens; mitigated by a narrow change list (four to five call-sites) and unit tests that exercise the resolve path.
- Legacy archive (pre-ADR-0008) restored into a post-ADR-0008 install works (legacy absolute paths are resolved) but the user gets a different UX (legacy paths are machine-specific unless they happen to be under the target's `CLONE_ROOT`). Documented.
- External-path handling adds interactive restore UX. A non-TTY restore with broken external paths is a soft failure, which means users of automation pipelines need to preflight the environment or pass `--external-path-map`. Documented and surfaced in the restore output.
- Two path classes means two storage shapes and two code paths in the helpers. Complexity cost accepted because silent breakage on restore for external-path users would be a correctness bug.

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| A consumer uses `localPath` directly without resolving | Concentrate consumption in `RepositoryCloner` and one pipeline helper; code review checklist; unit test that seeds a tokenized entry and asserts each consumer path works. |
| Legacy absolute-path entries on an upgraded machine where `CLONE_ROOT` changed mid-upgrade | On read, an absolute path that isn't under the current `CLONE_ROOT` but looks like it should be (e.g., older `./data/repos/` vs. newer `./data/repositories/`) is resolved heuristically by matching the final path segment (repo name) against known clones. Log at warn level. |
| Archive produced from a multi-root install (post-V1) tokenizes against the wrong root | Tokenizer prefers the most-specific (deepest) root. Tests cover nested-root cases. |
| User manually edits `repositories.json` and breaks tokenization | Reader tolerates absolute paths and rewrites on next update. No hard failure. |
| Cross-tool integration (`neo4j-driver` legacy, `FalkorDBAdapter`) emits paths from different resolver contexts | Graph-side entities reference repo name, not path. Only `repositories.json` holds paths; graph writes are unaffected. |
| A user supplies an external path that happens to fall under the target's `CLONE_ROOT` during restore re-pointing | Validator rejects — external paths must not resolve under `CLONE_ROOT` (otherwise the clone-managed vs external distinction is meaningless). Prompt asks for a different location. |
| Malicious archive carries `isExternalPath: true` with a path like `/etc` or `C:\Windows` | Restore flow shows the prompt as normal; user sees the path and declines. Skip/remove options offered. No automatic re-pointing of external paths under any flag combination. |

## Implementation Notes

- The `pathFormat` marker gate only affects the metadata file's top-level structure; individual record shape is unchanged.
- Tokenizer should be case-sensitive on Unix, case-insensitive on Windows (match filesystem semantics) when deciding whether a path is under a known root.
- On Windows, `C:\src\PersonalKnowledgeMCP\data\repositories` and `c:/src/personalknowledgemcp/data/repositories` refer to the same location; the tokenizer normalizes both before prefix-matching.
- **Windows long-path handling**: Strip the `\\?\` long-path prefix before tokenization on Windows. Tests in PR-06 cover paths exceeding 260 chars to prevent the prefix-comparison failure mode.
- `resolveRepositoryPath` must not resolve symlinks by default — preserve the caller's intent.
- The migration tool's archive writer passes the *source machine's* `PathRoots` to the tokenizer at snapshot time, and the restore tool's reader passes the *target machine's* `PathRoots` to the resolver. There is no global singleton for `PathRoots` — it's always injected — so tests can exercise arbitrary root configurations.
- TODO: Decide whether to expose `PATH_ROOTS` diagnostics via a `pk-mcp status --verbose` extension so users can quickly see what `{{CLONE_ROOT}}` resolves to. Out of scope for the ADR but a small quality-of-life add.
- TODO: Phase 6 (document ingestion) will add paths for watched folders. Apply the same tokenization scheme to `watched-folders.json` when that lands.

## Refactor Sizing

T-shirt scale (not a schedule).

> *Revised 2026-05-05 — code-review fix M-3: schema-change row added below.*

| Component | Size |
|-----------|------|
| **`RepositoryInfo` schema change**: (1) add `isExternalPath: boolean` (and optional `externalPathOrigin`, `pathStatus`) to the `RepositoryInfo` interface in `src/repositories/types.ts`; (2) update the Zod validation schema in `src/repositories/metadata-store.ts`; (3) update every test fixture that builds a `RepositoryInfo` to include the new fields | M |
| `src/repositories/path-resolver.ts` (new module, tokenize + resolve helpers, tests) | S |
| `RepositoryMetadataStoreImpl.updateRepository` — tokenize or mark external before write | S |
| `RepositoryMetadataStoreImpl.loadMetadata` — tolerate legacy absolute paths, add `pathFormat` marker handling, materialize `isExternalPath` on legacy reads | S |
| `RepositoryCloner.cloneRepository / updateToLatest` — call resolver on entry; refuse broken external entries | S |
| `remove-command.ts` — resolve then validate against `CLONE_PATH`; skip validation for `isExternalPath` entries | S |
| `InterruptedUpdateRecoveryService` — resolve when reading | S |
| `IncrementalUpdatePipeline` file-scan paths — resolve when reading | S |
| Migration-tool restore flow — external-path prompt/skip/remove UX, `--external-path-map` support, `manifest.json` `externalPaths` summary | M |
| `pk-mcp repo repath <name> <new-path>` CLI subcommand (design-level only in V1; implementation can slip to a fast-follow if time-pressed) | S |
| Unit tests for cross-OS round-trip, legacy-entry tolerance, multi-root preference, external-path round-trip, broken-path refusal | M |
| Migration-tool integration: tokenize at snapshot, resolve at restore, external-path manifest summary | S |
| Docs update (README section + ADR cross-links) | S |

Overall scope: **M** — contained to the metadata store, the cloner, a handful of consumers, the migration tool's archive I/O, and a single new CLI subcommand. No writer-path refactor required elsewhere.

## Links

- [ADR-0005: Cross-Machine Migration Archive Format](0005-cross-machine-migration-archive-format.md)
- [ADR-0007: Cross-Store Consistency Model](0007-cross-store-consistency-model.md)
- [DB-Migration-Design.md](../DB-Migration-Design.md) — Path-flexibility section
- [DB-Migration-Implementation-Notes.md](../DB-Migration-Implementation-Notes.md) §2.5 — prior analysis that drove this ADR
- `src/config/instance-config.ts` — existing per-instance `dataPath` seam (post-V1 multi-instance)
- `src/repositories/metadata-store.ts` — the single writer that will be instrumented
- `src/ingestion/repository-cloner.ts` — the primary consumer

## Validation Criteria

- A `repositories.json` produced on Windows with tokenized paths, copied to a Linux install with a different `DATA_PATH`, restored via the migration tool, yields a working `pk-mcp status` and `pk-mcp search` with no manual path edits for clone-managed entries.
- A legacy `repositories.json` containing absolute Windows paths loads cleanly on the same Windows host after upgrade (backward compatibility).
- A legacy `repositories.json` with absolute paths is rewritten on the next `updateRepository` call: under-root paths become tokenized; outside-root paths become `isExternalPath: true`.
- `remove-command.ts` path-escape security check continues to refuse paths outside the resolved `CLONE_PATH` for clone-managed entries, and is bypassed (as designed) for `isExternalPath` entries.
- `pathFormat: "tokenized-v1"` marker is present in any metadata file written by post-ADR-0008 code.
- Unit test asserts that the set of consumer call-sites that read `localPath` is exhaustively covered by `resolveRepositoryPath` invocations (can be enforced by a grep-based test that looks for bare `localPath` reads outside the resolver).
- An archive containing an `isExternalPath: true` entry whose `localPath` does not exist on the target, restored in interactive mode, surfaces a prompt and accepts `skip`/`remove`/new-path responses. The resulting `repositories.json` reflects the chosen response.
- An archive containing an `isExternalPath: true` entry restored with `--yes` and no `--external-path-map` completes with a non-zero warning count but exit code 0, and the entry is left in place with `pathStatus: "broken"`.
- An archive restored with `--external-path-map` re-points mapped entries without prompting and fails loudly if a mapped target path does not exist.
