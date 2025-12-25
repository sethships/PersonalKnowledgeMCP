# ADR-0001: Incremental Update Trigger Strategy

**Status:** Accepted

**Date:** 2025-12-25

**Deciders:** Seth B, Claude Code

**Technical Story:** Phase 4 - Automation Pipeline, Incremental Updates Architecture

## Context and Problem Statement

When PRs are merged to indexed repositories, the semantic search index needs to be updated to reflect the new code state. We need to decide how and when these incremental updates should be triggered. The system should maintain index freshness without requiring manual intervention while supporting various deployment scenarios.

## Decision Drivers

- **Consistency**: Index should accurately reflect the main branch state
- **Automation**: Minimize human dependency for routine updates
- **Reliability**: Updates should happen regardless of how PRs are merged
- **Flexibility**: Support different project deployment scenarios
- **Simplicity**: Avoid over-engineering for MVP

## Considered Options

### Option A: Agent-Triggered Updates (pr-complete workflow)

**Description:** Updates triggered by Claude Code agent as part of the `/pr-complete` skill workflow after merging a PR.

**Pros:**
- Developer has immediate control
- Works without CI/CD infrastructure
- Can provide instant feedback ("index updated")
- Simple to implement

**Cons:**
- Relies on human discipline (must remember to run it)
- Index drifts if someone merges via GitHub UI directly
- Different developers = inconsistent behavior
- Couples indexing to a specific tool (Claude Code)

### Option B: CI/CD Pipeline on Merge to Main

**Description:** GitHub Actions workflow triggers incremental update after PR is merged to main, post-test gate.

**Pros:**
- Fully automated - no human dependency
- Index always reflects actual main branch state
- Works regardless of how PR was merged (CLI, GitHub UI, auto-merge)
- Separation of concerns (dev workflow vs. infrastructure)
- Can be gated behind test success

**Cons:**
- Adds CI complexity and runtime
- Requires credentials/secrets in CI
- Failure handling needed (what if indexing fails post-merge?)
- Slight delay between merge and index availability

### Option C: Webhook-Triggered Updates

**Description:** GitHub webhooks notify the MCP service when PRs are merged, triggering immediate updates.

**Pros:**
- Real-time updates (seconds after merge)
- No polling overhead
- GitHub-native pattern

**Cons:**
- Requires public endpoint (ngrok, Tailscale Funnel, or cloud deployment)
- Webhook configuration per repository
- Security considerations (signature verification, rate limiting)
- More complex infrastructure requirements

## Decision Outcome

**Chosen option:** "Option B: CI/CD Pipeline on Merge to Main", because it provides the best balance of automation, consistency, and reliability for knowledge management systems.

For a knowledge system, **consistency and automation matter more than immediacy**. The index should reflect truth (what's in main), not what developers remember to do.

**Secondary recommendation:** Document Option A for projects that cannot use CI/CD or need immediate local updates as a project-level alternative.

### Positive Consequences

- Index always stays synchronized with main branch
- No dependency on specific developer tools or workflows
- Works with any merge method (squash, merge, rebase, GitHub UI, CLI)
- Separation of concerns: dev workflow remains clean
- Natural evolution path to webhooks (same endpoint, different trigger)

### Negative Consequences

- Requires CI/CD infrastructure and configuration
- Small delay between merge and index availability
- Need to handle CI failures gracefully
- Requires secrets management in CI environment

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| CI job fails silently | Add alerting/notifications on failure; CLI status shows stale index |
| Secrets exposure in CI | Use GitHub encrypted secrets; minimal scope tokens |
| Long CI runtime | Incremental updates are fast (<1 min); run as separate job |
| Index drift on CI failure | Implement retry logic; fall back to full re-index on repeated failures |

## Implementation Notes

### CI/CD Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  PR Merged  │────▶│  CI Pipeline │────▶│  Index Service  │
│  to main    │     │  (post-test) │     │  (incremental)  │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Only changed │
                    │ files since  │
                    │ last index   │
                    └──────────────┘
```

### What `/pr-complete` Should Do

When using CI/CD for indexing:
- Clean up branches, close issues (current behavior)
- Log that indexing will happen via CI
- NOT trigger indexing directly (avoid duplication)

### Project-Level Alternative

Projects without CI/CD infrastructure or requiring immediate updates can implement agent-triggered updates by adding index update to their `/pr-complete` skill. See `docs/integration/agent-triggered-updates.md` for guidance.

## Links

- [Incremental Updates Architecture Plan](../incremental-updates-plan.md)
- [CI/CD Integration Guide](../../integration/cicd-index-updates.md)
- [Agent-Triggered Updates Guide](../../integration/agent-triggered-updates.md)

## Validation Criteria

1. Index reflects main branch state within 5 minutes of merge
2. No index drift over 1-week period with multiple merges
3. CI job completes in under 2 minutes for typical PRs
4. Graceful handling of CI failures with clear error reporting
