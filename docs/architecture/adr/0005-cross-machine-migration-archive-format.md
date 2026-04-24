# ADR-0005: Cross-Machine Migration Archive Format

**Status:** Proposed

**Date:** 2026-04-23

**Deciders:** Architecture Team

**Technical Story:** Cross-Machine Migration feature — portable backup/restore spanning ChromaDB, FalkorDB, and repository metadata. See [DB-Migration-Design.md](../DB-Migration-Design.md).

## Context and Problem Statement

The Personal Knowledge MCP holds user state across three independent stores: ChromaDB (vector), FalkorDB (graph), and repository metadata (`data/repositories.json`, optionally cloned source under `data/repos/`, instance configuration). To move between machines or disaster-recover, users need a single portable artifact that captures all three stores atomically enough to restore to a consistent working state.

We need to choose the on-disk representation of a migration bundle. The choice is load-bearing for integrity verification, cross-platform parity, selective restore, version compatibility checks, and eventual encryption support.

## Decision Drivers

- **Portability**: One file to copy to USB / cloud / scp between machines
- **Cross-platform parity**: Windows (PowerShell) and Linux/macOS (bash) must produce/consume byte-identical archives
- **Integrity verification**: Per-component and whole-archive checksums; tamper-evident if possible
- **Selective restore**: Must be able to inspect and partially restore (e.g., ChromaDB only) without rehydrating everything
- **Version awareness**: Must encode source store versions, schema versions, and tool version to gate incompatible restores
- **Streamability**: Large backups (multi-GB embeddings) must not require 2x disk space for pack/unpack
- **Forward compatibility**: Format must tolerate new stores (e.g., PostgreSQL document store in Phase 4) without breaking old readers
- **Align with existing conventions**: Existing `scripts/backup-chromadb.*` already produces `.tar.gz` with sidecar `.sha256` and `.metadata.json` — minimize divergence

## Considered Options

### Option 1: Single `.tar.gz` with Internal Directory Tree and Manifest

**Description:** One tarball named `pk-mcp-migration-<timestamp>-<instance>.tar.gz` containing a structured tree:

```
pk-mcp-migration/
  manifest.json                 # machine-readable metadata (versions, hashes, inventory)
  README.txt                    # human-readable quick-start
  stores/
    chromadb/
      chromadb-data.tar         # raw volume tar (no inner gzip — outer gzip covers it)
      chromadb-data.sha256
    falkordb/
      dump.rdb                  # Redis RDB snapshot (see ADR-0006)
      dump.rdb.sha256
      falkordb-version.txt
    repositories/
      repositories.json
      instance-config.json      # sanitized (secrets stripped)
      repos/                    # optional cloned source (flag-gated)
  signatures/
    manifest.json.sha256        # root-of-trust hash
```

**Pros:**
- Single file to move; one checksum to verify at the envelope level
- Directory tree is self-describing and diff-friendly before compression
- Works natively on every platform (tar is universal; `bsdtar` on Windows 10+)
- Aligns with existing ChromaDB backup conventions
- `tar tzf` lets you inspect contents without extracting
- Inner per-store checksums enable selective restore with integrity checking
- Streams well — `tar --to-stdout ... | sha256sum` on extract

**Cons:**
- Not random-access: selective restore still has to scan through the archive
- No built-in encryption (handled at outer layer per ADR TODO)
- Tarball permission/owner bits differ subtly between GNU tar, bsdtar, and 7-Zip — pin to POSIX ustar with known owner
- Double-compression risk if inner files are already compressed (RDB files are not, but future additions might be)

### Option 2: Zip Archive

**Description:** Use `.zip` as the outer container. Native on Windows, `unzip` on Linux/macOS.

**Pros:**
- First-class Windows Explorer support (no 3rd-party tool needed)
- Random-access to individual entries without scanning
- Built-in per-entry CRC32 and optional AES encryption

**Cons:**
- Deflate is less efficient than gzip for highly compressible text (JSON metadata, repository source)
- Zip64 required for >4 GB archives; some older tools choke
- Filename encoding has historically been platform-inconsistent (cp437 vs. UTF-8)
- Breaks convention with existing ChromaDB backup scripts

### Option 3: Directory Tree (Uncompressed) with External Archive-on-Demand

**Description:** Restore tool reads from an unpacked directory. User archives/unarchives manually (rsync, scp, etc.).

**Pros:**
- Maximum flexibility; rsync-friendly for incremental sync
- No packaging/unpackaging overhead

**Cons:**
- Not a single portable artifact — contradicts the core requirement
- Fragile: partial copies or accidental deletions produce silent corruption
- No atomic transfer semantics
- No obvious integrity boundary

### Option 4: Custom Binary Container

**Description:** Roll a custom format (magic bytes + header + concatenated chunks + trailer).

**Pros:**
- Purpose-built for random access + integrity + versioning
- Can embed signing/encryption natively

**Cons:**
- NIH. Tar solves this. We do not need another format.
- Every future consumer (backup viewer, migration tester) must implement a parser

## Decision Outcome

**Chosen option:** **Option 1 — single `.tar.gz` with internal directory tree and top-level `manifest.json`.**

Rationale:

1. **Convention continuity** — matches existing `scripts/backup-chromadb.*` style; users already know `.tar.gz + .sha256 + .metadata.json` pattern.
2. **Cross-platform** — `tar` is available on Windows 10 1803+ via bsdtar, and all UNIX systems. PowerShell 7 can invoke it; bash can invoke it. No third-party dependencies.
3. **Streamable** — large archives (multi-GB) pack/unpack without 2x staging if we pipe through a tmpfile rather than extract-and-copy.
4. **Extensible** — adding `stores/postgres/` in Phase 4 is a manifest edit, not a format break.
5. **Tooling parity** — integrity verification (sha256) and signing (detached GPG, future) layer cleanly on top of a single file.

### Manifest schema (v1)

```json
{
  "schemaVersion": "1.0",
  "manifestVersion": 1,
  "createdAt": "2026-04-23T14:23:05Z",
  "source": {
    "hostname": "dev-laptop",
    "platform": "win32",
    "pkMcpVersion": "1.0.4",
    "instance": "default"
  },
  "stores": {
    "chromadb": {
      "included": true,
      "image": "chromadb/chroma:0.6.3",
      "volumeName": "chromadb-data",
      "artifact": "stores/chromadb/chromadb-data.tar",
      "sha256": "...",
      "sizeBytes": 1048576000
    },
    "falkordb": {
      "included": true,
      "image": "falkordb/falkordb:v4.4.1",
      "artifact": "stores/falkordb/dump.rdb",
      "sha256": "...",
      "sizeBytes": 52428800,
      "backupMethod": "bgsave"
    },
    "repositories": {
      "included": true,
      "repositoriesJsonSha256": "...",
      "includedClonedSource": false,
      "repoCount": 7
    }
  },
  "options": {
    "encrypted": false,
    "encryptionAlgorithm": null,
    "compression": "gzip"
  },
  "integrity": {
    "algorithm": "sha256",
    "manifestHashAlgorithm": "sha256"
  }
}
```

A sibling `<archive>.sha256` covers the whole tarball; `manifest.json` covers every inner artifact. Verification is two-step: envelope hash, then manifest-declared hashes.

### Positive Consequences

- Single file to transfer; simple mental model
- Extension path is obvious for new stores
- Integrity boundary at every level (envelope, per-store, manifest)
- Convention matches prior art in the repo

### Negative Consequences

- No random-access to individual stores without scanning; acceptable because full restore is the common path
- Users on stripped-down Windows (pre-1803) need to install bsdtar; acknowledged, low prevalence

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| GNU tar vs bsdtar metadata differences causing "same file different hash" | Use `--format=ustar --sort=name --mtime=@<epoch>` for deterministic output; test round-trip on both |
| Partial/interrupted tar extraction leaves half-restored state | Restore to staging directory first; atomic move into place; rollback on any store failure |
| Large archives (>10 GB) fail on 32-bit tar | Require GNU tar with large-file support; detect and fail early with clear message |
| Manifest version drift between producer and consumer | `manifestVersion` integer; reader rejects unknown major; minor bumps are additive |

## Implementation Notes

- File naming convention: `pk-mcp-migration-<YYYYMMDD-HHMMSS>-<instance>.tar.gz`
- Sidecar: `<archive>.sha256` for envelope-level check, matching existing pattern
- TODO: Determine whether to embed a detached minisign/GPG signature for provenance — deferred to a follow-up ADR if signing is prioritized
- TODO: Decide on deterministic-output flags across bsdtar (Windows) and GNU tar (Linux) — may need a wrapper that normalizes to a single canonical form

## Links

- [DB-Migration-Design.md](../DB-Migration-Design.md) — Overall migration design
- [ADR-0006: FalkorDB Backup Strategy](0006-falkordb-backup-strategy.md)
- [ADR-0007: Cross-Store Consistency Model](0007-cross-store-consistency-model.md)
- `scripts/backup-chromadb.sh` — Existing ChromaDB backup convention this ADR extends

## Validation Criteria

- Archive produced on Windows and extracted on Linux (and vice-versa) yields byte-identical store contents
- Envelope `.sha256` verifies successfully on any platform with standard tools
- Manifest schema validates against published JSON Schema
- A v1.0 archive opened by a v2.x reader produces a clear "supported" or "incompatible" verdict, never silent data loss
