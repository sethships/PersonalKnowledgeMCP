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
    `Run 'bun run cli update ${repository} --force' to re-index and recover.`
  );
}
