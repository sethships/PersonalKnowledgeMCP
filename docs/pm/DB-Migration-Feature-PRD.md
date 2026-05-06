# Cross-Machine Database Migration PRD - Personal Knowledge MCP

**Version:** 1.2
**Date:** April 23, 2026
**Status:** Draft
**Author:** Product Team
**Parent Document:** [High-level Personal Knowledge MCP PRD](../High-level-Personal-Knowledge-MCP-PRD.md)

---

## Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | April 23, 2026 | Initial draft: full-instance snapshots, FalkorDB parity, integrity verification, multi-instance awareness, optional encryption. |
| 1.1 | April 23, 2026 | **V1 scope revision** in response to engineering feasibility review (`docs/architecture/DB-Migration-Implementation-Notes.md`). Three stakeholder-approved changes: (1) multi-instance awareness deferred to V1.x — FalkorDB topology does not support per-instance deployment today and that prerequisite work is out of scope for this feature; (2) optional passphrase encryption (`--encrypt`) deferred to V1.x; (3) `--include-repos-source` deferred to V1.x. Added a new V1 functional requirement mandating path flexibility so cross-OS and cross-install-location restores work without hand-editing. V1 now ships single-instance (`default` profile) only. Deferred user stories and requirements preserved under new "V1.x / Deferred" subsections so backlog is intact. |
| 1.2 | April 23, 2026 | **Stakeholder decisions folded in** (three of four; the fourth — FalkorDB version detection — is architecture-only and does not affect this PRD). (1) `watched-folders.json` is now an explicit V1 archive payload artifact (new FR-1.10; US-1 acceptance criteria extended). (2) Secret stripping policy is re-stated as **allowlist-based** rather than blocklist-based — FR-1.5 and §9 reworded; the architect owns the exact allowlist. (3) External-path support (ADR-0008 Option D, `isExternalPath`) is promoted into V1 with explicit diagnostic behavior on restore (new FR-1.11 / US-11). Open questions §12 cleaned up: Q7 (include-repos-source), T12 (watched-folders inclusion), and the external-path question closed; Option D note moved out of "deferred" framing in §13. No changes to deferred items (multi-instance, encryption, `--include-repos-source`). |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [User Personas](#4-user-personas)
5. [User Stories and Use Cases](#5-user-stories-and-use-cases)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [User Experience](#8-user-experience)
9. [Security and Threat Model](#9-security-and-threat-model)
10. [Success Metrics](#10-success-metrics)
11. [Risks and Mitigations](#11-risks-and-mitigations)
12. [Open Questions for Architecture and Engineering](#12-open-questions-for-architecture-and-engineering)
13. [Future Considerations](#13-future-considerations)

---

## 1. Executive Summary

This PRD defines a **Cross-Machine Database Migration** capability for the Personal Knowledge MCP system. The feature allows a user to export the full state of an indexed knowledgebase on one machine and restore it on another, without re-cloning source repositories, re-parsing code, or re-generating embeddings.

### The Core Value Proposition

Indexing a non-trivial corpus is expensive in both wall-clock time and embedding provider cost (when using cloud embeddings such as OpenAI). Re-indexing 10+ repositories on a new laptop can take hours and consume real dollars. Today, users who move to a new machine have two bad options:

1. **Re-index from source** — slow, costly, and produces subtly different embeddings if provider versions drift.
2. **Manually `docker volume` tar the data directories** — brittle, undocumented, and easy to get wrong (especially when metadata state in `data/repositories.json` drifts from database state).

This feature replaces both with a supported, first-class workflow: **one command to export, one command to import**, covering all three storage backends (ChromaDB, FalkorDB, metadata) as a single consistent snapshot.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Migration unit | Full single-instance snapshot (V1: `default` profile only) | Simplest mental model; matches current single-FalkorDB topology |
| Archive scope | ChromaDB data + FalkorDB data + `data/repositories.json` + instance config manifest | Covers all state required to resume querying without re-indexing |
| Archive format | Single compressed tarball (`.tar.gz`) with a versioned manifest | Cross-platform, well-understood, standard tooling |
| Cross-OS / cross-install portability | Required in V1 (see FR-1.9) | A Windows archive must restore on Linux (and vice versa) without hand-editing paths |
| Selective migration (per-repo) | Out of scope for V1 | Complex consistency guarantees; deferred once full-snapshot is proven |
| Multi-instance scoping (Private/Work/Public) | **Deferred to V1.x** | FalkorDB is shared across instances in today's topology; true per-instance migration requires prerequisite infrastructure work outside this feature's scope |
| Secrets handling | `.env` files **excluded** from archive | Secrets must be re-provided on target machine (reduces blast radius) |
| Encryption at rest | **Deferred to V1.x** | Users can wrap the tarball with `age` / `openssl` / `7z` themselves in the interim; avoiding a crypto choice keeps V1 lean |
| Version compatibility | Target-machine version must match source-machine major.minor | Avoids silent schema drift; explicit upgrade path in a later version |
| CLI surface | New top-level command group: `pk-mcp migrate export` / `pk-mcp migrate import` | Matches existing CLI style (`graph migrate`, `update-all`, etc.) |

### Why Now

V1.0 is complete and the product is in active daily use. Two operational gaps motivate this feature:

1. **FalkorDB has no backup/restore scripts.** `docs/docker-operations.md` explicitly flags this: "Neo4j-specific backup/restore scripts will be replaced with FalkorDB equivalents in a future update." Leaving this unaddressed means any machine move today silently drops the graph.
2. **No unified story across the three stores.** ChromaDB has scripts; FalkorDB does not; `data/repositories.json` is copied by hand; Kubernetes PVCs have no documented migration path. Users cannot trust that a move is complete.

---

## 2. Problem Statement

### 2.1 Current State

| Store | Backup Tooling | Restore Tooling | Cross-Machine Guidance |
|-------|----------------|-----------------|------------------------|
| ChromaDB (Docker volume `chromadb-data`) | `scripts/backup-chromadb.{sh,ps1}` | `scripts/restore-chromadb.{sh,ps1}` | None documented |
| FalkorDB (Docker volume `falkordb-data`) | **None** (Neo4j scripts exist but are stale) | **None** | None documented |
| Repository metadata (`data/repositories.json`) | None (plain JSON, copied manually) | None | None |
| Per-instance config (`docker-compose.yml` profiles, `.env`) | Version-controlled / manual | Manual | None |
| Kubernetes PVC (`kubernetes/base/mcp-service/pvc.yaml`) | Not addressed | Not addressed | None |

### 2.2 User Pain Points

**P1: "I got a new laptop and need my knowledgebase back."**
The user has indexed 5–10 active projects plus college notes on their old machine. Re-indexing from scratch means cloning every repo, re-running AST parsers, and paying for every embedding again. Time cost: hours. Money cost: real OpenAI charges. Correctness cost: embeddings may differ if the provider has silently updated its model since the original indexing.

**P2: "My FalkorDB container just got wiped and I have no backup."**
Because FalkorDB has no scripts, a user who followed the existing operational guide for ChromaDB (`./scripts/backup-chromadb.sh`) and assumed the graph was similarly covered will be wrong. The graph must be re-populated from parsed source, which requires the repositories to still be present and correctly linked in `repositories.json`.

**P3: "I want my work instance on my work laptop and my private instance on my home laptop, and I want to move them independently."**
Multi-instance users need migration to respect instance boundaries. Today there is no tooling that says "take just the `work` profile's data and move it."

**P4: "I can't tell if the move worked."**
Even after a manual `docker volume` tar-and-copy, the user has no way to verify that the target machine has exactly the same indexed state — same repo SHAs, same chunk counts, same graph node counts — as the source.

**P5: "My home lab died and I'm restoring from cold storage."**
This is the disaster-recovery variant of P1. The user wants periodic snapshots they can archive to cloud cold storage (S3 Glacier, Azure Archive, etc.) and restore after hardware failure.

### 2.3 Why This Is A Product Problem, Not Just An Ops Problem

The existing `scripts/` directory treats each store as an isolated concern. That's correct at the operational layer but wrong at the product layer: **the user's mental model is a single knowledgebase, not three databases**. A migration feature that doesn't restore all three stores to a mutually-consistent point-in-time is, from the user's perspective, broken — even if each individual `.tar.gz` file restored cleanly.

---

## 3. Goals and Non-Goals

### 3.1 Goals

**Primary Goals (V1):**
1. **Full-instance export (single-instance / `default` profile)**: Produce a single, portable archive representing the complete queryable state of the MCP deployment running under the `default` Docker Compose profile.
2. **Full-instance import**: Restore an archive onto a target machine such that all MCP queries (semantic search, graph traversal, status, update-all) return the same results as on the source machine.
3. **FalkorDB parity**: Deliver the FalkorDB backup/restore capability that is currently missing, bringing the graph store to parity with ChromaDB for the shared/default deployment.
4. **Metadata coherence**: Capture `data/repositories.json` and instance configuration manifest within the archive so the target machine's metadata view agrees with its database state.
5. **Integrity verification**: After import, the user can run a single command that verifies the restored state matches what was exported (chunk counts, node counts, repo SHAs).
6. **Cross-OS and cross-install portability**: Archives produced on Windows restore cleanly on Linux/macOS (and vice versa), and archives restore cleanly into a different install directory than the source, without requiring the user to hand-edit paths or metadata. At most one documented re-configuration step is acceptable (e.g., confirming the target data root) — silent misconfiguration is not.

**Secondary Goals (V1):**
7. **Dry-run mode**: Preview what an import will do (repositories restored, chunks added, conflicts detected) before committing.
8. **Forward reference from `docs/docker-operations.md`**: Replace the stale Neo4j references with a pointer to this feature.

**Deferred Goals (V1.x / Future — see §13):**
- **Optional passphrase encryption** of archives at rest. Rationale: users can wrap the tarball with `age` / `openssl` / `7z` in the interim; picking a crypto scheme and cross-platform tooling is its own decision and delays V1. (See deferred US-6.)
- **Multi-instance awareness** (per-tier Private / Work / Public archives). Rationale: FalkorDB is not deployed per-instance in today's Docker Compose topology; true per-instance migration requires prerequisite infrastructure work outside this feature. (See deferred US-5.)
- **`--include-repos-source`** (bundling cloned source trees). Rationale: cross-OS portability of raw git worktrees has platform-specific landmines (symlinks, CRLF, `.git/config` absolute paths) that the minimal V1 should not take on. (See deferred FR-1.6.)

### 3.2 Non-Goals

1. **Incremental / differential backups**: V1 is full-snapshot only. Diff-based migration is a future enhancement.
2. **Per-repository selective migration**: V1 moves the whole `default`-profile instance. Moving "just the PersonalKnowledgeMCP repo's data" out is deferred.
3. **Live replication / real-time sync between machines**: This is migration, not HA clustering.
4. **Cross-version migration with schema changes**: Target machine must be on the same `major.minor` version as source. We will document this constraint; we will not build automatic schema upgrades in this feature.
5. **Cloud storage integration**: The archive is a local file. Uploading to S3/Azure/GCS is the user's responsibility (it's a tarball, so any tool works).
6. **`.env` / secret migration**: Secrets are explicitly excluded. The user re-provides them on the target machine.
7. **Embedding provider switching**: If the source used OpenAI embeddings and the target has no OpenAI key, search will still work against the restored embeddings, but new indexing on the target requires a valid provider. This feature does not re-embed.
8. **Kubernetes operator / automated PVC migration**: We document the manual PVC migration path as a guidance appendix but do not build a k8s-native operator in V1.
9. **GUI / web admin interface**: CLI only, matching existing project conventions.
10. **Partial-failure auto-rollback during import**: On import failure, we surface clear error state and require the user to choose recovery. Automatic transactional rollback across three databases is out of scope.
11. **Per-instance / multi-tier export in V1**: Explicitly deferred to V1.x. V1 operates on the `default` profile only; any `--instance` flag surface is reserved for the deferred work and must be explicitly rejected or marked experimental if partially present.

---

## 4. User Personas

The primary persona from the parent PRD (*The AI-Augmented Technical Expert*) applies. This feature surfaces three specific contexts for that persona:

### 4.1 Persona: Machine-Mover (Primary)

**Profile:** The same solo developer described in the parent PRD. They have a home lab and a work laptop, and they rotate hardware every 2–3 years. They have 5–10 actively-indexed repositories plus a college notes corpus.

**Context:** Switching from an old MacBook to a new one. Switching from a home desktop to a NAS-hosted deployment. Moving from on-prem home lab to a cloud VM because they're traveling for a month.

**Primary concerns:** Time cost, embedding API cost, and correctness (same search results on the new machine).

**Success for this persona:** One command on the old machine, one command on the new machine, done in under an hour for a typical corpus.

### 4.2 Persona: Disaster-Recovery Operator (Primary)

**Profile:** Same user, different hat. They treat their knowledgebase as valuable enough to back up, because re-creating it costs hours and dollars.

**Context:** Weekly snapshot to a NAS cold-storage directory. Monthly replication to cloud cold storage. Ad-hoc snapshot before a risky upgrade.

**Primary concerns:** Archive portability (still restorable 6 months from now), size (cloud storage has costs), and confidence that a restore will actually work (not silently corrupt).

**Success for this persona:** They can schedule exports and trust that any single archive, taken alone, is sufficient to rebuild the instance.

### 4.3 Persona: Future Team Member (Secondary / Forward-Looking)

**Profile:** A future colleague or collaborator who needs to bootstrap their own instance from a shared baseline (once the project supports collaborative use).

**Context:** "Here's last week's export of the `Public` instance — start from this instead of re-indexing from scratch."

**Primary concerns:** Trust boundary (archives may contain code from repos they don't have local clones of), and a clear understanding of what state they're inheriting.

**Success for this persona:** Import completes and the new teammate can immediately run queries against the shared corpus.

*Note: This persona's full requirements are out of scope for MVP (the parent PRD defers collaborative features). Listed here to ensure MVP decisions don't foreclose it.*

---

## 5. User Stories and Use Cases

### 5.1 Primary User Stories

#### US-1: Export a Full Instance
**As a** developer moving to a new machine
**I want to** produce a single archive file containing the complete state of my MCP instance
**So that** I can move it to the new machine and resume work without re-indexing.

**Acceptance Criteria:**
- One CLI command produces one archive file with a predictable name (e.g., `pk-mcp-<instance>-<timestamp>.tar.gz`).
- Archive contains ChromaDB data, FalkorDB data, repository metadata (`data/repositories.json`), watched-folder configuration (`watched-folders.json`), and a manifest describing what's inside.
- Archive contents are governed by an allowlist (FR-1.5); secrets such as `.env`, auth tokens, and API keys are not on the allowlist and are therefore excluded.
- After restore, any watched folders configured on the source machine appear in `pk-mcp` status output and behave identically to their source-machine configuration, subject to FR-1.9 (path flexibility) and FR-1.11 (external-path diagnostics where applicable).
- Command prints the archive path, size, and an integrity hash (SHA-256) on completion.
- Command succeeds regardless of which Docker Compose profile is active (default / private / work / public).
- Command warns if any of the three stores is unreachable and offers to abort or continue with a partial archive (explicitly labeled).

#### US-2: Import a Full Instance
**As a** developer on a new machine
**I want to** restore a previously-exported archive
**So that** I can run queries immediately without re-indexing.

**Acceptance Criteria:**
- One CLI command accepts an archive path and restores all three stores.
- Pre-flight check verifies target machine version matches archive version (major.minor).
- Pre-flight check warns if target machine has non-empty data stores (requires `--force` to overwrite, or `--merge` if supported post-MVP).
- Command prints a post-restore summary: repositories restored, total chunks, graph node count, provider(s) used.
- After successful import, `pk-mcp status` and `pk-mcp search "<query>"` work identically to the source machine.

#### US-3: Restore the Missing FalkorDB Backup Path
**As a** user following the documented backup procedure
**I want** FalkorDB backup/restore scripts that work analogously to the existing ChromaDB scripts
**So that** my routine backups are not silently missing the graph.

**Acceptance Criteria:**
- `scripts/backup-falkordb.{sh,ps1}` and `scripts/restore-falkordb.{sh,ps1}` exist and work standalone (for users who don't want the full migration archive flow).
- `docs/docker-operations.md` is updated to replace stale Neo4j references with FalkorDB commands and a forward pointer to the full migration feature.
- Stale `backup-neo4j.*` / `restore-neo4j.*` / `test-backup-restore-neo4j.*` scripts are removed or clearly deprecated.

#### US-4: Verify Integrity After Import
**As a** cautious user who just completed a migration
**I want to** run a single command that verifies the target machine's state matches the archive
**So that** I can trust the migration before deleting the source machine's data.

**Acceptance Criteria:**
- A verification command compares, per repository: indexed commit SHA, chunk count, graph node count, embedding provider used.
- Output clearly labels each repository as `MATCH` / `MISMATCH` / `MISSING` and exits non-zero if any are not `MATCH`.
- Verification can be run independently of the import flow (e.g., "verify my last archive still matches my current state").

#### US-5 (Cross-OS / Cross-Install Restore) — V1
**As a** developer moving between a Windows laptop and a Linux workstation (or simply reinstalling the MCP under a different directory)
**I want** the archive to restore correctly regardless of the target machine's OS or install path
**So that** I'm not forced to hand-edit metadata files or manually copy directories to make my knowledgebase work on the new machine.

**Acceptance Criteria:**
- A backup produced on Windows can be restored on Linux (or macOS) and vice versa, yielding a working instance with semantic search and graph traversal returning equivalent results.
- A backup restored on a machine whose MCP install lives at a different path than the source machine does not require the user to edit `data/repositories.json` or any other archive file.
- At most one documented, user-facing re-configuration step is permitted (e.g., confirming the target data root at import time, or setting it via an env var / flag). Silent misconfiguration — where the import appears to succeed but operations like `update-all` or `status` fail due to stale paths — is explicitly forbidden.
- Documentation states exactly which re-configuration step (if any) is required and when it's required.
- The mechanism by which portability is achieved (path tokenization, rewrite-on-restore, configurable data root, etc.) is an architecture decision; see `docs/architecture/DB-Migration-Design.md` for the chosen approach.

#### US-11 (External-Path Entries Survive Restore) — V1
**As a** developer who indexes content from arbitrary filesystem locations outside the MCP data root (e.g., a research corpus on a secondary drive, a college-notes folder under my home directory, a working copy at `D:\research\corpus` or `/home/me/notes`)
**I want** those external-path entries to be carried in the archive and restored with clear, actionable behavior on the target machine
**So that** my knowledgebase is not silently reduced to only data-root-managed repositories when I move machines, and so that I am told — not silently surprised — when a source-machine path doesn't exist on the target.

**Acceptance Criteria:**
- If an external-path entry (repository or watched folder indexed from a path outside the MCP data root) is present in the archive, the import process recognizes it as external (see ADR-0008 Option D, `isExternalPath` flag) and handles it distinctly from data-root-managed entries.
- **If the external path exists on the target machine at the same absolute location, the entry is restored and functional with no user intervention.**
- **If the external path does not exist on the target machine, the import produces a clear, actionable diagnostic** — naming the missing path, the affected entry, and at minimum one of the following remediation options: skip the entry with a warning and continue the import; remap the entry to a new path supplied by the user; or abort the import. Silent data loss (the entry disappears without being reported) or silent broken state (the entry is restored but will fail on the next operation) is a defect.
- The diagnostic is surfaced in a form consumable by both interactive and scripted use (e.g., a machine-readable summary at exit plus human-readable output during the run).
- The chosen UX mechanism (interactive prompt, `--remap` flag, fail-fast default with `--skip-missing-external` opt-in, or a combination) is an implementation decision; the PRD fixes only the outcome requirement above.

### 5.2 Secondary User Stories

#### US-7: Dry-Run Import
**As a** user about to import into a machine that already has data
**I want to** preview what the import will do
**So that** I can avoid clobbering something I care about.

**Acceptance Criteria:**
- Import `--dry-run` lists: repositories in archive, repositories already on target, expected conflicts, expected disk usage delta.
- Dry-run makes no writes to any store.

#### US-8: Scheduled Backup for DR
**As a** DR-minded user
**I want** the export command to be easy to schedule via Task Scheduler or cron
**So that** I can have weekly archives replicated to cold storage.

**Acceptance Criteria:**
- Export command is non-interactive when all inputs are provided via flags or env vars.
- Exit code is 0 on success, non-zero with a documented code table on failure.
- Exports are idempotent within a timestamp granularity (two exports at the same second don't collide).

#### US-9: Archive Inspection Without Import
**As a** user evaluating an old archive
**I want to** inspect the manifest and see what's inside
**So that** I can decide whether it's worth restoring.

**Acceptance Criteria:**
- An inspection command prints the manifest (version, timestamp, repository list with SHAs and chunk counts) without touching any database.
- Remains forward-compatible with the deferred encryption feature (inspection should continue to work on encrypted archives once that ships in V1.x; V1 operates on unencrypted archives only).

#### US-10: Kubernetes PVC Guidance
**As a** user running the MCP in Kubernetes
**I want** guidance on how to use this feature with PVCs
**So that** I can move between clusters or restore after a PVC deletion.

**Acceptance Criteria:**
- Documentation covers: run export as a Job against the live cluster, copy the archive out via `kubectl cp`, run import on the new cluster via a Job against empty PVCs.
- We do NOT build a k8s operator in V1; we provide working manifests and a runbook only.

### 5.3 Deferred User Stories (V1.x / Future)

*These stories are preserved for backlog continuity. They are out of scope for V1 but expected to land in a follow-up iteration. Rationale summaries appear beneath each; see §13 for the full deferred feature list.*

#### US-D1: Multi-Instance Migration (deferred from V1 — was US-5 in v1.0)
**As a** user running Private, Work, and Public instances side by side
**I want to** export each instance as a separate archive
**So that** I can move them independently (e.g., Work moves to the work laptop, Private stays on the home machine).

**Rationale for deferral:** FalkorDB is not currently deployed per-instance in `docker-compose.yml` (contrast with ChromaDB, which has `chromadb-private`, `chromadb-work`, `chromadb-public` services). True per-tier graph isolation is a prerequisite infrastructure change that lives outside this feature's scope. Shipping `--instance` scoping without that change would either silently co-mingle graph data across tiers or ship a half-measure that confuses users. See `docs/architecture/DB-Migration-Implementation-Notes.md` §2.2 for the code-level confirmation.

**Acceptance Criteria (unchanged, to be re-validated when unblocked):**
- Export command accepts an explicit `--instance <name>` flag that scopes the archive to a single Docker Compose profile's data (including per-instance FalkorDB, once available).
- If no instance is specified and multiple are running, the command fails with a helpful error listing the available instances rather than silently picking one.
- Archive manifest records which instance it came from.
- Import refuses to restore an archive into a different instance name unless `--target-instance <name>` is explicitly passed, and logs the rename for audit.

#### US-D2: Encrypted Archive (deferred from V1 — was US-6 in v1.0)
**As a** user storing archives on cloud cold storage
**I want** the archive to be encrypted with a passphrase I control
**So that** my embeddings and any captured source metadata are not readable by the storage provider.

**Rationale for deferral:** Choosing a crypto scheme with clean Windows + Linux + macOS parity (`age` vs. `openssl` vs. Bun-native AES-256-GCM with KDF) is its own design decision. Deferring lets V1 ship sooner. Users can wrap the resulting tarball with their own tool in the interim.

**Acceptance Criteria (unchanged):**
- Export command accepts `--encrypt` flag and prompts for (or reads from env) a passphrase.
- Encrypted archives have a distinct file extension (e.g., `.tar.gz.enc`) or manifest marker.
- Import command auto-detects encrypted archives and prompts for passphrase.
- Algorithm is a widely-adopted authenticated scheme (AES-256-GCM or equivalent); we do not invent crypto.
- Passphrase is never logged and never written to disk.

#### US-D3: Self-Contained Archive with Cloned Source (deferred from V1)
**As a** user who wants a single archive that can be restored entirely offline
**I want** the option to include `data/repositories/` cloned source trees in the archive
**So that** the target machine does not need network access to re-clone.

**Rationale for deferral:** Bundling raw git worktrees raises cross-platform portability issues (symlinks that don't translate between Linux and Windows, CRLF translation artifacts, absolute paths in `.git/config`) that the minimal V1 should not own. Users who need this today can tar `data/repositories/` themselves alongside the V1 archive.

### 5.4 Use Case Scenarios

**Scenario 1: Laptop Refresh (Windows → macOS)**
```
User: New MacBook arrived. Old Windows laptop has 8 repos indexed against OpenAI embeddings.

Old machine (Windows):
  pk-mcp migrate export --output C:\backups\snapshot.tar.gz
  # 4.2 GB archive produced in 90 seconds.

User copies archive via Thunderbolt / rsync / whatever.

New machine (macOS):
  # Fresh install of PersonalKnowledgeMCP, docker-compose up -d, empty stores.
  pk-mcp migrate import ~/Desktop/snapshot.tar.gz
  pk-mcp migrate verify ~/Desktop/snapshot.tar.gz
  # All 8 repos show MATCH.

Total time: under 10 minutes. Zero OpenAI calls. Zero re-indexing.
Cross-OS path differences (C:\... -> /Users/...) are handled by the import flow
without requiring the user to edit any files. (See FR-1.9 / US-5.)
```

**Scenario 2: Disaster Recovery**
```
User has weekly scheduled export to NAS, monthly replication to Azure Archive.

Home lab SSD fails. User restores from last week's NAS archive:
  pk-mcp migrate import /mnt/nas/backups/pk-mcp-default-2026-04-16.tar.gz

User lost ~1 week of repo updates, which are cheap to re-pull via update-all.
User did NOT lose weeks of indexing work or embedding spend.
```

**Scenario 3: Pre-Upgrade Safety Snapshot**
```
User about to run "pk-mcp graph migrate" for a schema update.
Takes a snapshot first:
  pk-mcp migrate export --output ~/pre-upgrade.tar.gz

Upgrade goes sideways.
  pk-mcp migrate import ~/pre-upgrade.tar.gz --force
User is back to known-good state.
```

**Scenario 4 (Deferred — V1.x): Multi-Instance Split**
*Captured here for backlog continuity; not supported in V1. See deferred US-D1.*
```
User runs all three instances on the home desktop.
Getting a dedicated work laptop; wants only the Work instance to move.

Home desktop:
  pk-mcp migrate export --instance work --output ~/work-instance.tar.gz

Work laptop:
  pk-mcp migrate import ~/work-instance.tar.gz --instance work
```

---

## 6. Functional Requirements

### 6.1 Archive Contents and Structure

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-1.1 | Archive contains a full, consistent snapshot of ChromaDB data | P0 |
| FR-1.2 | Archive contains a full, consistent snapshot of FalkorDB data | P0 |
| FR-1.3 | Archive contains `data/repositories.json` in a form that is valid on import across any supported OS and install path (see FR-1.9) | P0 |
| FR-1.4 | Archive contains a top-level manifest (JSON) with: archive version, schema version, source profile (`default` in V1), source hostname (optional, user-suppressible), source OS, timestamp, embedding provider(s) used, per-repository summary (name, URL, branch, indexed commit SHA, chunk count, graph node count), and an integrity hash for each payload | P0 |
| FR-1.5 | **Archive contents are governed by an allowlist, not a blocklist.** The set of files and configuration fields included in the archive is defined by an explicit allowlist; any artifact not on the allowlist is excluded by default. This posture ensures that future config surfaces (new fields, new files) do not silently leak secrets or sensitive data merely because they were not anticipated by a deny list. Known exclusions driven by this policy include `.env` files, bearer tokens, OAuth client secrets, and any ambient credentials. The architect owns the exact allowlist specification; the PRD mandates only the policy.<br><br>**Auth-store exclusion (sub-requirement, added 2026-05-05 per ADR-0007 H-1):** The three persistent auth stores written by the long-lived MCP HTTP server — `tokens.json` (bearer tokens), `oidc-sessions.json` (OIDC session state), `user-mappings.json` (claim-to-instance mappings) — are explicitly excluded from the archive. They are gated by the migration lock so writes do not tear during snapshot, but their content is not migrated. The archive's `README.txt` calls out that auth state must be re-bootstrapped on the destination. | P0 |
| FR-1.6 | Archive **excludes** raw cloned source repositories under `data/repositories/`. *(V1: always excluded. Optional inclusion deferred to V1.x per US-D3.)* | P0 |
| FR-1.7 | Archive is a single file (tarball with gzip compression by default) | P0 |
| FR-1.8 | Archive filename follows a predictable convention: `pk-mcp-default-<YYYYMMDD-HHMMSS>.tar.gz` in V1. The naming convention reserves room for a future instance segment once multi-instance ships (V1.x). | P0 |
| FR-1.9 | **Path flexibility across OS and install location.** Any filesystem paths captured in the archive (notably the `localPath` field in `data/repositories.json`, and any analogous paths in configuration or metadata) must not be restored verbatim onto the target machine. The backup/restore flow must produce a working instance on a target whose OS (Windows/Linux/macOS) or MCP install directory differs from the source, without the user hand-editing any archive or data file. At most one documented user-facing configuration step is permitted (e.g., confirming or supplying the target data root). Silent misconfiguration — import reports success but downstream commands fail due to stale source-machine paths — is a defect. The specific mechanism (path tokenization, rewrite-on-restore, configurable data root, or a combination) is an architecture decision; cross-reference the architect's resolution in `docs/architecture/DB-Migration-Design.md`. | P0 |
| FR-1.10 | **Archive includes `watched-folders.json`** (watched-folder configuration for Phase 6 document ingestion). The payload is tiny and omitting it would cause watched-folder configurations to silently vanish on restore, forcing the user to re-register every watched folder. Restore must preserve watched-folder entries subject to FR-1.9's path-flexibility requirement (watched-folder paths are machine-specific filesystem locations and must survive cross-OS / cross-install restore via the same mechanism as other stored paths, or produce the diagnostic described in FR-1.11 where an external path cannot be honored on the target). | P0 |
| FR-1.11 | **External-path entries are supported in V1** (ADR-0008 Option D, `isExternalPath` flag). Users sometimes ingest repositories or watched folders from arbitrary filesystem locations outside the MCP data root — e.g., `D:\research\corpus` on Windows or `/home/user/notes` on Linux. These entries must survive export/import alongside data-root-managed entries. On restore, if an external-path entry references a path that does not exist on the target machine, the import must produce a **clear, actionable diagnostic** rather than silently succeeding into a broken state. See FR-3.10 for the required import behavior and US-11 for the user-visible contract. Cross-reference `docs/architecture/adr/0008-repositories-json-path-model.md` for the mechanism. | P0 |

### 6.2 Export Command

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-2.1 | CLI command `pk-mcp migrate export` produces an archive of the `default`-profile deployment | P0 |
| FR-2.2 | *(Deferred to V1.x)* Accepts `--instance <name>` to scope to one Docker Compose profile. In V1 the command operates on `default` only; any `--instance` value other than `default` (or equivalent) must fail fast with a clear "not yet supported" message. | Deferred |
| FR-2.3 | Accepts `--output <path>` with a sensible default (`./backups/`) | P0 |
| FR-2.4 | *(Deferred to V1.x, per US-D3)* Accepts `--include-repos-source` to bundle cloned repositories. Not implemented in V1; users tar `data/repositories/` themselves if they need this today. | Deferred |
| FR-2.5 | *(Deferred to V1.x, per US-D2)* Accepts `--encrypt` to produce a passphrase-encrypted archive. Not implemented in V1; users encrypt the resulting tarball with their own tool in the interim. | Deferred |
| FR-2.6 | Ensures consistency by pausing writes to the three stores during export (e.g., quiescing the ingestion pipeline, using DB-native snapshot mechanisms, or stopping the containers for the minimum required window) — the specific mechanism is an architecture decision | P0 |
| FR-2.7 | Fails cleanly if any store is unreachable, with actionable error messages | P0 |
| FR-2.8 | Non-interactive by default. *(V1 has no interactive prompts; the passphrase prompt returns with `--encrypt` in V1.x.)* | P0 |
| FR-2.9 | Prints a summary on completion: path, size, SHA-256, duration, repositories included | P0 |
| FR-2.10 | Supports a `--quiet` mode for scheduled / scripted use | P1 |

### 6.3 Import Command

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-3.1 | CLI command `pk-mcp migrate import <archive>` restores an archive into the `default` profile | P0 |
| FR-3.2 | Pre-flight checks: version compatibility, archive integrity (hash verification), target store state | P0 |
| FR-3.3 | *(Deferred to V1.x)* Accepts `--instance <name>` and `--target-instance <name>` for cross-instance restore. V1 restores into `default` only. | Deferred |
| FR-3.4 | Accepts `--dry-run` to preview without writing | P0 |
| FR-3.5 | Refuses to overwrite non-empty stores without `--force` | P0 |
| FR-3.6 | On partial failure, leaves the system in a documented state (target stores not silently half-restored); does not attempt automatic cross-database rollback | P0 |
| FR-3.7 | Prints a post-restore summary matching the archive manifest | P0 |
| FR-3.8 | After successful import, `pk-mcp status`, `pk-mcp search`, and graph MCP tools return results consistent with the source machine | P0 |
| FR-3.9 | Import honors FR-1.9: restoring a Windows-produced archive onto Linux (or vice versa), or onto a different install path, succeeds without the user hand-editing archive contents. At most one user-facing re-configuration step is permitted and must be clearly documented. | P0 |
| FR-3.10 | **Import handles external-path entries (FR-1.11) explicitly.** If the archive contains any entry marked as an external path (`isExternalPath: true`) that does not resolve on the target machine, the import must surface a clear, actionable diagnostic per entry — naming the missing path, the affected repository or watched-folder entry, and the remediation options (skip-with-warning, remap to a new path, or abort). The import must not silently succeed with broken entries, and must not silently drop entries without surfacing them. The specific UX (interactive prompt, `--remap <src>=<dst>` flag, fail-fast by default with opt-in `--skip-missing-external`, or a combination) is left to the architect and CLI implementer; the PRD mandates only that silent data loss or silent broken state is a defect. | P0 |

### 6.4 Verification Command

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-4.1 | CLI command `pk-mcp migrate verify <archive>` compares archive manifest to current machine state | P0 |
| FR-4.2 | Per-repository reporting: MATCH / MISMATCH / MISSING, with reasons for non-matches | P0 |
| FR-4.3 | Exit code reflects overall status (0 all match, non-zero otherwise) | P0 |
| FR-4.4 | Can run standalone without an import having just occurred | P1 |

### 6.5 Inspection Command

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-5.1 | CLI command `pk-mcp migrate inspect <archive>` prints the manifest | P1 |
| FR-5.2 | Works on encrypted archives (manifest is either unencrypted or decryptable with passphrase while payload stays encrypted) | P1 |
| FR-5.3 | Makes zero writes to any data store | P1 |

### 6.6 Standalone FalkorDB Scripts (Parity Fix)

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-6.1 | `scripts/backup-falkordb.sh` and `.ps1` produce a standalone FalkorDB backup, analogous to existing ChromaDB scripts | P0 |
| FR-6.2 | `scripts/restore-falkordb.sh` and `.ps1` restore a standalone FalkorDB backup | P0 |
| FR-6.3 | Stale Neo4j scripts are removed or marked deprecated with a pointer to FalkorDB equivalents | P0 |
| FR-6.4 | `docs/docker-operations.md` is updated to reflect FalkorDB commands and to forward-reference this PRD's broader migration flow | P0 |

### 6.7 Manifest Schema (Product-Level Description)

The manifest is a JSON document describing the archive's contents. Exact schema is an architecture decision, but must include at minimum:

- `archiveVersion` (semver) — format of this archive, independent of product version
- `productVersion` (semver) — Personal Knowledge MCP version that produced the archive
- `createdAt` (ISO 8601)
- `sourceInstance` (string: `default` in V1; reserved for `private` / `work` / `public` when multi-instance ships in V1.x)
- `embeddingProviders` (array of provider identifiers used in this instance)
- `repositories` (array of per-repo objects: name, URL, branch, last indexed SHA, chunk count, graph node count, file count)
- `payloadHashes` (per-payload SHA-256 for integrity verification)
- `encryption` (null or encryption scheme identifier, never the passphrase itself)

This manifest is itself the contract. Future schema changes must be additive or explicitly versioned.

---

## 7. Non-Functional Requirements

### 7.1 Performance Targets

| Target | Value | Notes |
|--------|-------|-------|
| Export time, small instance (1–2 repos, <1K files total) | <30 seconds | Includes any required write-quiescing window |
| Export time, medium instance (5–10 repos, 1K–10K files total) | <5 minutes | Typical primary-persona case |
| Export time, large instance (large monolith + several smaller repos) | <30 minutes | Should scale roughly linearly with data size |
| Import time | Within 2× export time | Validation and integrity checks add overhead |
| Quiesce window (writes paused during export) | <30 seconds for medium instance | Long pauses disrupt active Claude Code sessions |
| Archive size vs. raw volume data | <1.2× after compression | We rely on gzip; don't expect miracles on already-compressed embeddings |

### 7.2 Portability and Compatibility

- Archives produced on Windows (PowerShell 7 + Docker Desktop) must restore on Linux (bash + Docker) and vice versa. No platform-specific binary formats in the archive.
- Archive format version follows semver. Minor version bumps are backward-compatible (a 1.1 reader reads 1.0 archives). Major version bumps are not.
- Product version compatibility: MVP requires source and target to agree on `major.minor`. The import command refuses to proceed otherwise with a clear error pointing to an upgrade path.

### 7.3 Resource Constraints

- Export must not require more than 2× the total data size in free disk space during archive creation (we cannot assume huge free disk on the user's machine).
- Import must not require more than 2× the archive size in free disk during extraction.
- Neither command should push RAM usage above ~2 GB for typical home-lab hardware.

### 7.4 Observability

- Export and import emit structured progress information (percent complete or phase indicators) so users know the process isn't hung.
- Errors are logged with sufficient context to diagnose without reproducing (which store failed, which phase, which file, underlying error).
- A `--verbose` flag surfaces per-step timing for performance diagnosis.

### 7.5 Reliability and Idempotence

- Re-running an export with the same output path and the same timestamp granularity should not silently overwrite a previous archive without confirmation or a unique-ifying suffix.
- An interrupted export (Ctrl+C, crash, power loss) must not leave a partial archive that looks valid. Partial archives are either deleted or clearly marked invalid in their manifest.
- An interrupted import leaves target stores in a documented state; the user can either retry or manually reset.

---

## 8. User Experience

### 8.1 Command Surface

New top-level command group, consistent with existing CLI patterns (`graph migrate`, `update-all`, etc.). V1 surface:

```
pk-mcp migrate export   [--output <path>] [--dry-run] [--quiet]
pk-mcp migrate import   <archive> [--dry-run] [--force]
pk-mcp migrate verify   <archive>
pk-mcp migrate inspect  <archive>
```

Reserved for V1.x (not accepted in V1; commands fail fast with a "not yet supported" message if supplied):

```
  --instance <name>          # multi-instance scoping (US-D1)
  --target-instance <name>   # cross-instance restore (US-D1)
  --include-repos-source     # bundle cloned source trees (US-D3)
  --encrypt                  # passphrase-encrypted archive (US-D2)
```

### 8.2 Success Experience

**Export success output (sketch):**
```
Exporting MCP instance (default profile)...
  [1/4] Quiescing write paths....................... done (2.1s)
  [2/4] Snapshotting ChromaDB....................... done (12.4s)
  [3/4] Snapshotting FalkorDB....................... done (3.8s)
  [4/4] Packaging metadata and manifest............. done (0.9s)

Archive:   /Users/seth/backups/pk-mcp-default-20260423-142301.tar.gz
Size:      4.2 GB
SHA-256:   a8f3...c91d
Duration:  19.2s
Contents:  8 repositories, 12,488 chunks, 47,301 graph nodes

Secrets (.env, tokens) were NOT included. Re-provide them on the target machine.
```

**Import success output (sketch):**
```
Importing archive: pk-mcp-default-20260423-142301.tar.gz

Pre-flight checks:
  Archive integrity................................. OK
  Product version compatibility..................... OK (1.0.x source, 1.0.x target)
  Target instance state............................. OK (empty)

  [1/4] Extracting archive.......................... done
  [2/4] Restoring ChromaDB.......................... done
  [3/4] Restoring FalkorDB.......................... done
  [4/4] Restoring repository metadata............... done

Restored: 8 repositories, 12,488 chunks, 47,301 graph nodes
Next steps: run 'pk-mcp migrate verify <archive>' to confirm state parity.
```

### 8.3 Failure Experience

Every failure mode has an actionable error message. Examples:

- **Target stores non-empty:** "Target ChromaDB contains existing data for repositories [A, B]. Pass `--force` to overwrite, or run `pk-mcp migrate import --dry-run` to preview the merge."
- **Version mismatch:** "Archive was produced by PersonalKnowledgeMCP 1.0.x. Target machine is on 2.0.x. Cross-major-version restore is not supported. See docs/migration/version-upgrade.md."
- **Missing Docker service:** "FalkorDB container is not running. Start it with `docker-compose up -d falkordb` and retry."
- **Bad passphrase on encrypted archive:** "Could not decrypt archive (incorrect passphrase or corrupted file)."

### 8.4 Multi-Instance Considerations *(Deferred to V1.x)*

Multi-instance export/import is not part of V1. When the feature lands in V1.x (once FalkorDB per-instance topology is in place), the following guidance applies. Captured here so V1 architecture does not foreclose the design:

- Commands that operate instance-scoped must either infer the instance unambiguously (one active profile) or require explicit `--instance`. Never silently act on the wrong instance.
- Archive filenames should include the instance name so a directory of backups is self-describing.
- Users running all three instances on one machine must be able to export each independently without interfering with the others' queries (quiesce is per-instance).

**V1 behavior:** V1 operates on the `default` Docker Compose profile. The user is not asked to think about instances at all. If a user has the repository configured with non-default profiles running, V1 still snapshots only the `default` deployment and the UX message makes this explicit.

### 8.5 First-Time User Journey

1. User installs on new machine, runs `docker-compose up -d`.
2. User copies archive to machine (via whatever mechanism they prefer — rsync, cloud sync, USB).
3. User runs `pk-mcp migrate inspect <archive>` — sees what's in it.
4. User runs `pk-mcp migrate import <archive>` — restoration completes.
5. User runs `pk-mcp migrate verify <archive>` — all repos show MATCH.
6. User runs `pk-mcp status` — sees familiar repository list.
7. User runs a query from Claude Code — results match the source machine.
8. User re-provides secrets (OpenAI key, etc.) in `.env` only if they want to run `update-all` or new indexing.

At no point does the user need to understand that three separate databases are involved.

---

## 9. Security and Threat Model

### 9.1 Archive Content Policy — Allowlist, Not Blocklist

**The set of artifacts included in an archive is governed by an explicit allowlist (FR-1.5).** Any file, configuration field, or metadata element not on the allowlist is excluded by default. This is a deliberate posture choice: a blocklist ("exclude known-secret fields") fails open — a newly-added config field that happens to contain a secret will leak until someone remembers to add it to the blocklist. An allowlist fails closed — a new field is invisible to the archive until deliberately added. The architect owns the exact allowlist contents; the PRD mandates only the policy.

### 9.2 What's In an Archive (Allowlisted)

- **ChromaDB data** — embeddings (vectors). Derived data, but potentially reversible to source-like content with adversarial effort.
- **FalkorDB data** — graph structure: function names, class names, import relationships. Reveals codebase topology even without source.
- **Repository metadata** (`data/repositories.json`) — repo URLs, branches, commit SHAs, file counts. Reveals *what* the user has indexed, which may itself be sensitive (e.g., the existence of a private repo).
- **Watched-folder configuration** (`watched-folders.json`) — watched-folder entries, including any external-path entries marked per FR-1.11.
- **Instance configuration manifest** — the subset of deployment configuration needed to reconstruct a working instance on the target, scoped to what the allowlist explicitly permits.
- **Optionally, source mirrors** — *deferred to V1.x (US-D3)*. V1 archives never include `data/repositories/` cloned trees.

### 9.3 What's Excluded (By Virtue of Not Being Allowlisted)

Because exclusion is the default, everything not explicitly allowlisted is excluded. Common categories that remain excluded include:

- `.env` files and any file matching a secrets pattern.
- API keys, OAuth client secrets, bearer tokens for the MCP HTTP transport.
- Any ambient credentials (SSH keys, GitHub tokens) used by the ingestion pipeline.
- Any newly-introduced configuration field that has not been deliberately added to the allowlist — even if that field is benign, it stays out until reviewed.

### 9.4 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Archive stolen from user's disk | *V1: user responsibility* — archives are unencrypted. Users sensitive to this wrap the tarball with `age`, `openssl`, `7z`, or similar. *V1.x: built-in passphrase encryption (US-D2).* Documentation clearly states V1 archives are unencrypted. |
| Archive stolen from cloud storage | Same as above. Strongly recommend users encrypt before uploading archives to cloud cold storage in V1. |
| Malicious archive imported | Pre-flight integrity checks (manifest hash verification). We do NOT sign archives in V1 (no PKI); we rely on the user's trust in the archive's provenance. Flag for future: signed archives. |
| Cross-instance data leak | Not applicable in V1 (single-instance only). When multi-instance ships (V1.x), explicit `--target-instance` will be required for cross-instance restore. |
| Secret leak via archive | `.env` and secrets explicitly excluded; documented clearly in UX. Users re-provide secrets on target. |
| Embedding data reveals source | Accepted risk in V1; mitigated by user-managed outer encryption. Built-in encryption arrives in V1.x. |

### 9.5 Explicit Security Non-Goals

- No PKI / code-signing of archives in V1. Signed archives are a future enhancement.
- No built-in archive encryption in V1 (deferred to V1.x, US-D2). Users wrap archives with their own tool if confidentiality matters.
- No server-side / cloud-side key management (applies when built-in encryption ships).
- No compliance certifications (parent PRD already excludes HIPAA/SOC2 from MVP).

---

## 10. Success Metrics

### 10.1 Primary Metrics

**Adoption and Correctness:**
- **Successful round-trip rate**: % of export→import cycles where `verify` returns all-MATCH. Target: >99% for same-version restores.
- **Cross-OS round-trip rate**: % of Windows↔Linux (and Windows↔macOS) round trips where `verify` returns all-MATCH with at most one documented re-configuration step. Target: >99%. (Directly measures FR-1.9 / US-5.)
- **Time savings vs. re-index**: Measured against full re-index of the same corpus. Target: migration completes in <10% of re-index time for a medium instance.
- **Cost savings vs. re-embed**: For users on cloud embedding providers, measured API spend saved. Target: near-zero cloud spend for a migration (only incidental status calls, if any).
- **FalkorDB backup parity**: % of users who have a recent (<7 day) FalkorDB backup of their `default` deployment. Target: >90% within 3 months of release (measured via opt-in telemetry or self-report).

### 10.2 Secondary Metrics

**Operational:**
- **Export duration, p95**: <5 minutes for medium instances.
- **Quiesce window, p95**: <30 seconds for medium instances.
- **Archive size / raw data size**: <1.2× after compression.
- **Dry-run usage rate before first real import**: Ideally high, since it indicates user confidence-building.

**Documentation:**
- **Stale Neo4j references in docs**: Target: zero. All references updated to FalkorDB + migration feature.
- **Support-style questions about "how do I move my data"**: Target: drops to near-zero once feature ships.

### 10.3 Anti-Goals (Signals We Did It Wrong)

- Users report silent data loss after a migration → we failed on integrity verification.
- Users ask "does the archive include my OpenAI key?" → we failed on UX clarity.
- Users run `docker volume` tar commands anyway → we failed on CLI discoverability or trust.
- Users have to hand-edit `data/repositories.json` to make a cross-OS or cross-install restore work → we failed on FR-1.9.
- Users assume `--instance` works in V1 and silently move the wrong data → we failed on CLI error messaging for deferred flags.

---

## 11. Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Consistency across three stores is hard to guarantee during export | High | High | Architecture must choose a quiesce strategy explicitly. Document the chosen consistency model clearly. Export quiesces writes; users understand a brief unavailability window. |
| FalkorDB snapshot primitives differ from Neo4j's, and existing familiarity is wrong | High | High | Architect must validate FalkorDB-native snapshot mechanisms early. Do not assume Neo4j procedures transfer. |
| Archive sizes are large (embeddings dominate) | Medium | High | Accept this; document expected sizes; do not over-engineer compression. `--include-repos-source` deferred to V1.x to avoid further bloating V1 archives. |
| Version mismatch on target machine creates confusion | Medium | Medium | Explicit pre-flight check with actionable error. No silent best-effort restore. |
| Cross-platform / cross-install path issues (Windows vs. Linux paths, different install directory) | **High** | **High** | Addressed by FR-1.9. Architect picks the mechanism (tokenization, rewrite-on-restore, configurable data root, or hybrid) and cross-OS + cross-install restore is tested explicitly in CI. Silent misconfiguration is a shipping blocker. |
| Partial-failure states confuse users | High | Medium | On any failure, print exactly which phases completed and which did not, and what state the target is in. No automatic rollback attempts across DBs. |
| Growing archive size over time makes routine DR impractical | Medium | Low | Deferred to incremental backup in a future version. Document as a known limitation for now. |
| Users store unencrypted V1 archives in insecure locations | High | Medium | Documentation highlights the risk and recommends users wrap archives with `age` / `openssl` / `7z` until built-in encryption ships in V1.x. |
| Users expect `--instance` scoping in V1 | Medium | Medium | V1 CLI rejects non-default `--instance` values with a clear "deferred to V1.x" message and points to the backlog item. Docs lead with "single-instance V1" framing. |
| Kubernetes users expect this to "just work" with PVCs | Medium | Medium | Ship a documented PVC runbook, not an operator. Set expectations clearly in the k8s section of docs. |

---

## 12. Open Questions for Architecture and Engineering

These are the product-level questions that surfaced while writing this PRD. They need answers from the architect / engineering team before implementation:

### 12.1 Consistency Model (Highest Priority)

**Q1:** What consistency guarantees do we provide across the three stores during export?

**Context:** ChromaDB, FalkorDB, and `repositories.json` are updated by different code paths. A naive sequential snapshot can capture ChromaDB at T=0 and FalkorDB at T=1, which may disagree if ingestion runs between them.

**Options to evaluate:**
- **(a) Stop-the-world:** Pause all writes (or stop containers) for the duration of the export. Simplest, guaranteed consistent, but introduces an availability window.
- **(b) Application-level quiesce:** Block the ingestion pipeline via a write lock held by the export command. Fine-grained; requires the app to cooperate.
- **(c) DB-native consistent snapshots:** Use whatever each DB offers (ChromaDB persistence flush + FalkorDB `SAVE`/`BGSAVE` equivalent). Fastest, but requires per-store understanding.
- **(d) Accept slight inconsistency:** Rely on idempotent retry in future update-all runs to reconcile. Weakest guarantee; may be acceptable for a single-user personal system.

**Why it matters for product:** The user needs a clear mental model. "Your queries will be unavailable for ~30 seconds during export" is a very different UX contract from "export is non-blocking but the archive may lag reality by a few seconds."

### 12.2 Archive Format and Cross-Platform Paths (RESOLVED at product level, architect picks mechanism)

**Q2 (product outcome — RESOLVED):** The product requires that Windows↔Linux↔macOS moves and moves across different install directories work without the user hand-editing archive files. This is now captured as **FR-1.9** and **US-5** with explicit acceptance criteria. Silent misconfiguration is a defect, not a warning.

**Q2 (mechanism — OPEN for architect):** The feasibility review (`docs/architecture/DB-Migration-Implementation-Notes.md` §2.5) confirmed that `data/repositories.json` stores absolute OS-native paths (`C:\src\PersonalKnowledgeMCP\data\repositories\...` on this checkout), so direct byte-identical restore across machines is not viable. The architect picks one of:

- Tokenized placeholders (`${DATA_DIR}/repositories/...`) resolved on read.
- Relative paths with a resolver rooted at a configurable data root.
- Rewrite-on-restore based on the target machine's configured data directory.
- Some combination (e.g., tokenize on export, rewrite into the target's configured root on import).

**Why it matters for product:** The mechanism must be invisible to the user. FR-1.9 permits at most one documented re-configuration step (such as confirming the target data root) — zero would be preferable. Update the architecture doc with the chosen approach and cross-reference it from the PRD.

### 12.3 Version Compatibility Strategy (High Priority)

**Q3:** What exactly does "same major.minor" mean in practice, given that the product has three databases that can evolve independently?

**Context:** A product version might not change, but a ChromaDB image upgrade or a FalkorDB schema migration could make an older archive unrestorable. Do we tie archive version to product version, to per-store schema versions, or to a hybrid?

**Sub-questions:**
- If the user upgrades the product between export and import, should we refuse, warn, or attempt forward-migration?
- How do we handle the Phase 6 transition (adding PostgreSQL for document metadata)? Does a pre-Phase-6 archive restore cleanly on a post-Phase-6 machine (ignoring PostgreSQL) or not?

**Why it matters for product:** The user's trust in the feature depends on predictable compatibility. "Sometimes it works, sometimes it doesn't" is worse than a clear "supported: yes/no" matrix.

### 12.4 Lower-Priority Open Questions

**Q4:** Should the archive format itself be pluggable (e.g., support zip, zstd) or is `.tar.gz` sufficient for MVP?

**Q5:** Does FalkorDB have a reliable `SAVE` / consistent-snapshot primitive we can rely on, or do we need to stop the container for every export? If the latter, does that change the UX promise?

**Q6:** How should the feature interact with an in-flight `update-all` operation? Block the export, or refuse to start one?

**Q7:** *(Resolved for V1)* `--include-repos-source` is deferred to V1.x (US-D3). V1 documents "if you want a fully self-contained archive, tar `data/repositories/` yourself alongside."

**Q8:** *(Not applicable in V1)* Multi-instance exports are deferred to V1.x (US-D1). When revived: for multi-instance exports, is there value in a "super-archive" that bundles all three instances, or should users always produce per-instance archives and manage them separately? Leaning toward per-instance only; worth confirming when the feature is scoped.

**Q9:** What's the right retention story? Do we ship any automated pruning of old archives in the default backup directory, or leave that entirely to the user?

**Q10:** For Kubernetes deployments, should the import/export be deliverable as pre-built Jobs in `kubernetes/base/`, or is runbook documentation enough for MVP?

**Q11:** *(Resolved for V1)* `watched-folders.json` is included in the V1 archive payload (FR-1.10). Previously listed as design note T12 in the architecture doc; now a hard product requirement.

**Q12:** *(Resolved for V1)* Archive contents are governed by an allowlist, not a blocklist (FR-1.5, §9.1). The exact allowlist specification is an architecture deliverable.

**Q13:** *(Resolved for V1)* External-path entries (ADR-0008 Option D, `isExternalPath`) are in V1 scope (FR-1.11, FR-3.10, US-11). Previously framed as a V1.x deferral in ADR-0008; now promoted into V1 with explicit diagnostic requirements on restore.

---

## 13. Future Considerations

### 13.1 V1.x — Near-Term Deferrals

These were originally scoped for V1 but were pulled out in the v1.1 revision. They remain committed for a V1.x follow-up. Each has a one-line rationale so sprint planning has clean scope boundaries.

1. **Multi-instance migration (`--instance`, `--target-instance`, per-tier archives)** — blocked on FalkorDB per-instance deployment being added to `docker-compose.yml` and `instance-config.ts`; prerequisite infrastructure work lives outside this feature. (US-D1, FR-2.2, FR-3.3.)
2. **Optional passphrase encryption (`--encrypt`)** — requires picking a cross-platform crypto tool/scheme; deferred to keep V1 lean. Users wrap archives with their own tool in the interim. (US-D2, FR-2.5.)
3. **`--include-repos-source` (bundle cloned source trees)** — cross-OS portability of raw git worktrees has symlink / CRLF / `.git/config` landmines that V1 avoids. Users tar `data/repositories/` manually if they need offline restore today. (US-D3, FR-1.6.)

### 13.2 Longer-Term Future

Features intentionally deferred past V1.x:

1. **Incremental / differential archives**: Export only what's changed since the last archive. Enables cheap frequent backups.
2. **Per-repository selective migration**: Move one repo's data out of a larger instance, or merge one repo into an existing instance.
3. **Signed archives**: PKI-backed signatures so users can verify an archive came from a trusted source.
4. **Cross-version migration with schema upgrades**: An archive taken on v1.0 restored into v2.0 via automatic schema-forward-migration.
5. **Cloud-native archive targets**: First-class `s3://`, `az://`, `gs://` output paths with resumable uploads.
6. **Kubernetes operator**: A CRD-driven "PKMigration" resource that handles export/import as k8s Jobs with status conditions.
7. **Automated scheduled exports via the CLI itself**: A `pk-mcp migrate schedule` subcommand that registers OS-native scheduled tasks. (V1: users wire up cron / Task Scheduler themselves.)
8. **Live replication between instances**: Continuous streaming replication for HA / multi-site deployments. This is a fundamentally different product capability from migration.
9. **Embedding re-encoding on import**: For users who want to migrate *and* switch embedding providers in one step. Non-trivial — effectively a full re-index — but useful.
10. **Integration with Phase 6 document store**: Once PostgreSQL is live for document metadata, the archive must extend to cover it. Schema must be designed with this in mind.

---

**Document History:**
- v1.0 — Initial draft covering full-instance snapshots, FalkorDB parity, integrity verification, multi-instance awareness, optional encryption (April 23, 2026).
- v1.1 — V1 scope revision in response to engineering feasibility review (April 23, 2026). Deferred multi-instance, built-in encryption, and `--include-repos-source` to V1.x. Added FR-1.9 / US-5 for cross-OS and cross-install path flexibility as a V1 hard requirement. Updated scope tables, CLI surface, success metrics, risks, and open questions accordingly. See Revision History at the top of the document.
- v1.2 — Stakeholder decisions folded in (April 23, 2026). Added FR-1.10 (`watched-folders.json` included in V1 archive), FR-1.11 and FR-3.10 and US-11 (external-path support with explicit restore-time diagnostic), and re-stated FR-1.5 / §9 as an allowlist-based content policy. Closed open questions Q11/Q12/Q13 in §12. The fourth stakeholder decision (FalkorDB version detection) is architecture-only and not reflected here.
