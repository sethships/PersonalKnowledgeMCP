# Agent-Triggered Index Updates

**Alternative Approach** - For projects that require immediate updates or don't have CI/CD infrastructure.

## Overview

This guide explains how to configure your project to trigger index updates through Claude Code (or other AI agents) as part of the PR completion workflow. This is an **alternative approach** for situations where CI/CD-triggered updates aren't suitable.

### When to Use Agent-Triggered Updates

| Scenario | Recommendation |
|----------|----------------|
| Local-only development environment | Agent-triggered |
| No CI/CD infrastructure | Agent-triggered |
| Need immediate index updates | Agent-triggered |
| Air-gapped or restricted networks | Agent-triggered |
| Standard development with CI/CD | Use [CI/CD approach](./cicd-index-updates.md) instead |

### Trade-offs

**Pros:**
- Immediate feedback after PR completion
- Works without CI/CD infrastructure
- Developer has control over timing
- Simple setup - no CI configuration needed

**Cons:**
- Relies on developer discipline
- Index drifts if merges happen outside agent workflow
- Different developers may have inconsistent behavior
- Couples indexing to Claude Code usage

## Setup Options

### Option 1: Extend the `/pr-complete` Skill (Recommended)

Add index update to your project's CLAUDE.md to extend the built-in `/pr-complete` skill:

```markdown
## Project-Specific Workflow Extensions

### Post-PR-Complete: Update Knowledge Index

After running `/pr-complete`, always trigger an index update for this repository:

\`\`\`bash
# Run after PR is merged and branches are cleaned up
bun run --cwd /path/to/PersonalKnowledgeMCP cli update <repository-name>
\`\`\`

This ensures the semantic search index reflects the latest main branch state.
```

### Option 2: Create a Custom Skill

Create a project-specific skill that combines PR completion with index updates.

Add to your project's `.claude/skills/pr-complete-indexed.md`:

```markdown
---
description: Complete PR workflow with knowledge index update
argument-hint: "[PR number or URL]"
---

# PR Complete with Index Update

This skill extends the standard PR completion workflow to include updating the semantic search index.

## Workflow

1. **Verify PR is Merged**
   - Check PR status using GitHub MCP tools
   - Confirm merge to main/master branch

2. **Run Standard PR Complete**
   Execute the standard `/pr-complete` workflow:
   - Sync local repository with remote
   - Delete merged feature branch (local and remote)
   - Close linked issues

3. **Update Knowledge Index**
   Trigger incremental index update:
   \`\`\`bash
   bun run --cwd /path/to/PersonalKnowledgeMCP cli update <repository-name>
   \`\`\`

4. **Verify Index Status**
   Confirm the index was updated:
   \`\`\`bash
   bun run --cwd /path/to/PersonalKnowledgeMCP cli status <repository-name>
   \`\`\`

## Output
Report:
- PR completion status
- Index update results (files changed, chunks updated)
- Any warnings or errors
```

### Option 3: CLAUDE.md Reminder Pattern

For lightweight integration, add a reminder to your CLAUDE.md:

```markdown
## Post-Merge Checklist

After completing any PR merge, remind the developer to update the knowledge index:

> **Index Update Reminder**: Run `bun run cli update <repo>` in PersonalKnowledgeMCP
> to keep the semantic search index current.

If the developer confirms, execute:
\`\`\`bash
bun run --cwd /path/to/PersonalKnowledgeMCP cli update <repository-name>
\`\`\`
```

## CLI Reference

### Basic Update

```bash
# Update a specific repository
bun run cli update my-project

# Force full re-index (instead of incremental)
bun run cli update my-project --force

# Update all indexed repositories
bun run cli update-all
```

### Check Status

```bash
# View index status for a repository
bun run cli status my-project

# View all repositories
bun run cli status
```

### Example Output

```
Checking for updates to my-project...
  Commits: abc1234..def5678
  Files: +2 ~5 -1
  Chunks: +42 -8
  Duration: 12500ms

Index updated successfully.
```

## Integration with Claude Code Skills

### Detecting Repository Name

When building skills, detect the repository name dynamically:

```markdown
## Detect Repository

1. Check git remote:
   \`\`\`bash
   git remote get-url origin
   \`\`\`

2. Extract repository name from URL:
   - `https://github.com/owner/repo.git` → `repo`
   - `git@github.com:owner/repo.git` → `repo`

3. Use extracted name for index update command.
```

### Error Handling

Include error handling in your skill:

```markdown
## Handle Index Update Errors

If the index update fails:

1. **Repository Not Found**
   - The repository may not be indexed yet
   - Run: `bun run cli index <github-url>`

2. **Connection Error**
   - Check if ChromaDB is running: `docker ps | grep chroma`
   - Start if needed: `docker-compose up -d`

3. **Force Push Detected**
   - Index will automatically trigger full re-index
   - This is expected behavior, not an error

4. **Partial Failure**
   - Some files may have failed to index
   - Check logs for specific errors
   - Consider running with `--force` to re-index completely
```

## Hybrid Approach

For maximum reliability, combine both approaches:

1. **Primary**: CI/CD triggers updates on merge (catches all merges)
2. **Backup**: Agent triggers update in `/pr-complete` (immediate feedback)

The system is idempotent - running update twice is safe and the second run will report "no changes needed."

### Sample Hybrid CLAUDE.md Section

```markdown
## Index Update Strategy

This project uses CI/CD for automatic index updates, with agent-triggered updates as backup.

### After PR Completion

The CI pipeline will update the index automatically. However, for immediate feedback:

\`\`\`bash
bun run --cwd /path/to/PersonalKnowledgeMCP cli update <repository-name>
\`\`\`

This is safe to run even if CI has already updated the index - it will simply report "no changes needed."
```

## Troubleshooting

### Index Not Updating

1. **Verify repository is indexed**
   ```bash
   bun run cli status
   ```

2. **Check for pending changes**
   ```bash
   bun run cli status <repo> --verbose
   ```

3. **Force full re-index**
   ```bash
   bun run cli update <repo> --force
   ```

### "Repository Not Found" Error

The repository name must match exactly. Check registered name:

```bash
bun run cli status | grep -i <partial-name>
```

### Slow Updates

- Large PRs (>100 files) take longer
- Very large PRs (>500 files) trigger full re-index
- Check ChromaDB performance: `docker stats`

### Index Drift

If index seems out of sync:

1. Check last indexed commit:
   ```bash
   bun run cli status <repo>
   ```

2. Compare with current main:
   ```bash
   git log -1 --format=%H origin/main
   ```

3. Force re-index if needed:
   ```bash
   bun run cli update <repo> --force
   ```

## See Also

- [ADR-0001: Incremental Update Trigger Strategy](../architecture/adr/0001-incremental-update-trigger-strategy.md)
- [CI/CD Integration Guide](./cicd-index-updates.md) - Recommended approach
- [Incremental Updates Architecture](../architecture/incremental-updates-plan.md)
