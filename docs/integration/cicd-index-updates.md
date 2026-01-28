# CI/CD Pipeline Integration for Index Updates

**Recommended Approach** - Keep your semantic search index automatically synchronized with your main branch.

## Overview

This guide explains how to configure your CI/CD pipeline (GitHub Actions) to automatically trigger incremental index updates when PRs are merged to your main branch. This is the **recommended approach** for maintaining index freshness.

### Why CI/CD Triggered Updates?

| Benefit | Description |
|---------|-------------|
| **Consistency** | Index always reflects the actual main branch state |
| **Automation** | No human intervention required |
| **Reliability** | Works regardless of merge method (CLI, GitHub UI, auto-merge) |
| **Separation** | Dev workflow stays clean; indexing is infrastructure |

## Prerequisites

1. Repository indexed in Personal Knowledge MCP
2. Personal Knowledge MCP service accessible from CI (local runner or network access)
3. GitHub repository with Actions enabled

## GitHub Actions Workflow

### Basic Setup

Create `.github/workflows/update-knowledge-index.yml` in your repository:

```yaml
name: Update Knowledge Index

on:
  push:
    branches:
      - main
      - master
  workflow_dispatch:  # Allow manual triggers

jobs:
  update-index:
    name: Update Semantic Search Index
    runs-on: ubuntu-latest
    # Only run after all other checks pass
    needs: [test, build]  # Adjust based on your workflow

    steps:
      - name: Trigger Index Update
        run: |
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.MCP_API_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"repository": "${{ github.repository }}"}' \
            "${{ secrets.MCP_SERVICE_URL }}/api/repositories/update"
        env:
          MCP_SERVICE_URL: ${{ secrets.MCP_SERVICE_URL }}
          MCP_API_TOKEN: ${{ secrets.MCP_API_TOKEN }}
```

### With Self-Hosted Runner (Local MCP Service)

If your MCP service runs locally, use a self-hosted runner:

```yaml
name: Update Knowledge Index

on:
  push:
    branches: [main]

jobs:
  update-index:
    name: Update Semantic Search Index
    runs-on: self-hosted

    steps:
      - name: Update Index via CLI
        run: |
          cd /path/to/PersonalKnowledgeMCP
          bun run cli update ${{ github.event.repository.name }}

      - name: Report Status
        if: always()
        run: |
          if [ $? -eq 0 ]; then
            echo "::notice::Index updated successfully"
          else
            echo "::warning::Index update failed - will retry on next merge"
          fi
```

### Standalone Workflow (No Dependencies)

For repositories where you want indexing to run independently:

```yaml
name: Update Knowledge Index

on:
  push:
    branches: [main]
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - '.github/**'

jobs:
  update-index:
    name: Update Semantic Search Index
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for accurate diff

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Clone MCP Tools
        run: |
          git clone --depth 1 https://github.com/sethships/PersonalKnowledgeMCP.git /tmp/mcp
          cd /tmp/mcp && bun install

      - name: Update Index
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          CHROMADB_URL: ${{ secrets.CHROMADB_URL }}
          DATA_PATH: /tmp/mcp-data
        run: |
          cd /tmp/mcp
          bun run cli update ${{ github.event.repository.name }} \
            --base-commit ${{ github.event.before }} \
            --head-commit ${{ github.sha }}

      - name: Update Status
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '⚠️ Knowledge index update failed. The index may be stale until the next successful update.'
            })
```

## Required Secrets

Configure these secrets in your repository (Settings > Secrets and variables > Actions):

| Secret | Description | Example |
|--------|-------------|---------|
| `MCP_SERVICE_URL` | URL to MCP service API | `http://localhost:3000` or `https://mcp.internal` |
| `MCP_API_TOKEN` | Authentication token for MCP service | Generated via `bun run cli token create` |
| `OPENAI_API_KEY` | OpenAI API key for embeddings | `sk-...` |
| `CHROMADB_URL` | ChromaDB server URL | `http://localhost:8000` |

## API Endpoint Reference

### POST /api/repositories/update

Triggers an incremental update for a repository.

**Request:**
```json
{
  "repository": "owner/repo-name",
  "force": false
}
```

**Response (Success):**
```json
{
  "status": "completed",
  "repository": "my-api",
  "previousCommit": "abc1234",
  "newCommit": "def5678",
  "stats": {
    "filesAdded": 2,
    "filesModified": 5,
    "filesDeleted": 1,
    "chunksUpserted": 42,
    "chunksDeleted": 8,
    "durationMs": 12500
  }
}
```

**Response (No Changes):**
```json
{
  "status": "no_changes",
  "repository": "my-api",
  "message": "Repository already up to date"
}
```

## Error Handling

### Retry on Failure

Add retry logic for transient failures:

```yaml
- name: Update Index with Retry
  uses: nick-fields/retry@v2
  with:
    timeout_minutes: 5
    max_attempts: 3
    retry_wait_seconds: 30
    command: |
      curl -X POST \
        -H "Authorization: Bearer ${{ secrets.MCP_API_TOKEN }}" \
        -H "Content-Type: application/json" \
        -d '{"repository": "${{ github.repository }}"}' \
        "${{ secrets.MCP_SERVICE_URL }}/api/repositories/update"
```

### Notification on Failure

Notify team when indexing fails:

```yaml
- name: Notify on Failure
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "⚠️ Knowledge index update failed for ${{ github.repository }}",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Index Update Failed*\nRepository: `${{ github.repository }}`\nCommit: `${{ github.sha }}`\nWorkflow: <${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Run>"
            }
          }
        ]
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

## Monitoring Index Health

### Check Index Status

Add a status check to your workflow:

```yaml
- name: Verify Index Status
  run: |
    STATUS=$(curl -s -H "Authorization: Bearer ${{ secrets.MCP_API_TOKEN }}" \
      "${{ secrets.MCP_SERVICE_URL }}/api/repositories/${{ github.event.repository.name }}/status")

    echo "Index Status: $STATUS"

    # Check if index is stale (more than 24 hours old)
    LAST_INDEXED=$(echo $STATUS | jq -r '.lastIndexedAt')
    # Add staleness check logic here
```

### Scheduled Health Check

Run periodic checks to catch drift:

```yaml
name: Index Health Check

on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM

jobs:
  check-index:
    runs-on: ubuntu-latest
    steps:
      - name: Check All Repositories
        run: |
          curl -H "Authorization: Bearer ${{ secrets.MCP_API_TOKEN }}" \
            "${{ secrets.MCP_SERVICE_URL }}/api/repositories/status" | \
            jq '.repositories[] | select(.isStale == true) | .name'
```

## Best Practices

1. **Run after tests pass**: Gate index updates behind your test suite
2. **Use path filters**: Skip indexing for docs-only or config-only changes
3. **Set timeouts**: Prevent hung jobs from blocking other workflows
4. **Monitor failures**: Set up alerts for failed index updates
5. **Periodic full reindex**: Schedule weekly full reindex as safety net

## Troubleshooting

### Index Update Times Out

- Check network connectivity to MCP service
- Verify ChromaDB is running and accessible
- Review file count - large changes (>500 files) trigger full reindex

### Authentication Failures

- Verify `MCP_API_TOKEN` secret is set correctly
- Check token hasn't expired
- Ensure token has appropriate permissions

### Index Shows Stale Data

- Check workflow run history for failures
- Verify the correct branch is being tracked
- Run manual update: `bun run cli update <repo> --force`

## See Also

- [ADR-0001: Incremental Update Trigger Strategy](../architecture/adr/0001-incremental-update-trigger-strategy.md)
- [Agent-Triggered Updates](./agent-triggered-updates.md) - Alternative for projects without CI/CD
- [Incremental Updates Architecture](../architecture/incremental-updates-plan.md)
