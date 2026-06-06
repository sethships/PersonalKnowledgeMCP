/**
 * Drift recovery hint formatter.
 *
 * Shared between the sync (`trigger_incremental_update`) and async
 * (`get_update_status` / `JobTracker`) MCP response paths so the
 * user-facing recovery message stays identical as the two call sites
 * evolve.
 *
 * @module mcp/tools/utils/drift-recovery-hint
 */

/**
 * Build the recovery-hint string shown to MCP callers when a repository
 * returns `status: "drift_detected"`.
 */
export function buildDriftRecoveryHint(repository: string): string {
  return (
    `Index drift detected: HEAD SHA matches the tracked commit but the index is incomplete. ` +
    `Run 'bun run cli repair ${repository}' to re-embed only the missing files (use ` +
    `'--dry-run' first to inspect them), or 'bun run cli update ${repository} --force' for a ` +
    `full re-index when divergence is large.`
  );
}
