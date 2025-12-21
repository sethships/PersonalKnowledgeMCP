# Partial Failure Handling Guide

This guide explains how to handle partial failures during repository updates - when some files fail to process while others succeed.

## Overview

The Personal Knowledge MCP system is designed to be resilient:
- **Continues processing** when individual files fail
- **Collects all errors** for review at the end
- **Saves partial progress** so successful work isn't lost
- **Provides actionable guidance** for each error type

## Understanding Partial Failures

### CLI Output Example

```
$ bun run cli update my-api

✔ Updated my-api (commit abc1234)
  Added: 3 files | Modified: 8 files | Deleted: 1 file
  Chunks: +45 -12

⚠ 2 files had errors:
  • src/deleted.ts: ENOENT: no such file or directory
    → File was deleted between pull and processing. Safe to ignore.
  • src/invalid.ts: Unexpected token at line 42
    → Source file has syntax errors. Fix the file and retry.

  Use --verbose to see all errors
```

### What Happens During a Partial Failure

1. **File-by-file processing**: Each file is processed independently
2. **Error isolation**: A failure in one file doesn't affect others
3. **Error collection**: All errors are accumulated in an array
4. **Completion**: Update finishes with both successes and failures reported
5. **History recording**: Status is marked as "partial" in update history

## Common Error Types and Actions

| Error Pattern | Guidance | Action Required |
|--------------|----------|-----------------|
| `ENOENT` / `no such file` | File was deleted between pull and processing | None - safe to ignore |
| `permission denied` / `EACCES` | Permission denied | Check file permissions |
| `Unexpected token` / `syntax error` | Source file has syntax errors | Fix the file and retry |
| `Failed to chunk` | File could not be split into chunks | Check file format |
| `File too large` / `size limit` | File exceeds size limit | Add to excludePatterns or increase limit |
| `rate limit` / `429` / `too many requests` | Rate limited by API | Wait 60 seconds and retry |
| `Path traversal` | Security issue detected | Investigate repository for malicious paths |
| `embedding failed` / `openai error` | Embedding API error | Check OPENAI_API_KEY and API status |
| `401` / `unauthorized` / `invalid key` | API authentication failed | Verify API key is valid |
| `chromadb` / `connection refused` | ChromaDB connection issue | Verify ChromaDB is running: `docker ps` |
| `ETIMEDOUT` / `socket hang up` | Network error | Check connectivity and retry |
| `Renamed file missing previousPath` | Renamed file missing old path info | Re-run full re-index with `--force` |

## Using the Verbose Flag

By default, only the first 3 errors are shown to keep output manageable. Use `--verbose` to see all errors:

```bash
# Show all errors (no truncation)
bun run cli update my-api --verbose

# Combine with JSON output for scripting
bun run cli update my-api --json --verbose
```

### JSON Output with Errors

When using `--json` output, each error includes guidance:

```json
{
  "status": "updated",
  "repository": "my-api",
  "commitSha": "abc1234567890",
  "stats": {
    "filesAdded": 3,
    "filesModified": 8,
    "filesDeleted": 1,
    "chunksUpserted": 45,
    "chunksDeleted": 12,
    "durationMs": 2340
  },
  "errors": [
    {
      "path": "src/deleted.ts",
      "error": "ENOENT: no such file or directory",
      "guidance": "File was deleted between pull and processing. Safe to ignore."
    },
    {
      "path": "src/invalid.ts",
      "error": "Unexpected token at line 42",
      "guidance": "Source file has syntax errors. Fix the file and retry."
    }
  ]
}
```

## When to Be Concerned

### Safe to Ignore

These errors typically resolve themselves or indicate non-issues:

- **ENOENT errors**: File was deleted during update - completely normal in active repos
- **Rate limit errors**: Will resolve with retry after waiting
- **Network timeouts**: Retry usually succeeds
- **Empty file errors**: No content to index

### Requires Investigation

These errors indicate potential problems that should be addressed:

- **Syntax errors in source files**: Code is broken, needs fixing
- **Permission denied errors**: File system access issues
- **Path traversal warnings**: Potential security issue in repository
- **Consistent embedding failures**: API key or service issues

### Requires Re-indexing

When these conditions occur, a full re-index is recommended:

- **Large number of errors** (>10% of files)
- **Renamed file missing previousPath**: Metadata inconsistency
- **Force push detected**: History rewritten, incremental update impossible

```bash
# Force a complete re-index
bun run cli update my-api --force
```

## Checking Update Status

After an update with errors, check the repository status:

```bash
bun run cli status
```

Expected output:
```
┌────────────────────────┬────────┬─────────┬─────────────────────┬──────────┐
│ Repository             │ Files  │ Chunks  │ Last Indexed        │ Status   │
├────────────────────────┼────────┼─────────┼─────────────────────┼──────────┤
│ my-api                 │ 45     │ 320     │ 2025-12-20 10:00:00 │ ⚠ partial│
└────────────────────────┴────────┴─────────┴─────────────────────┴──────────┘
```

### Status Values

| Status | Description |
|--------|-------------|
| `✓ ready` | All files indexed successfully |
| `⚠ partial` | Some files failed, most succeeded |
| `✗ error` | Update failed completely |
| `⟳ indexing` | Update in progress |

## Programmatic Error Handling

When building automation around updates, use the JSON output:

```bash
# Capture update result
result=$(bun run cli update my-api --json)

# Check status
status=$(echo "$result" | jq -r '.status')
error_count=$(echo "$result" | jq '.errors | length')

if [ "$status" = "failed" ]; then
  echo "Update failed completely"
  exit 1
elif [ "$error_count" -gt 0 ]; then
  echo "Update succeeded with $error_count errors"
  # Log errors for review
  echo "$result" | jq '.errors[] | "\(.path): \(.error)"'
else
  echo "Update succeeded completely"
fi
```

## Debugging Partial Failures

### Enable Debug Logging

For detailed troubleshooting:

```bash
LOG_LEVEL=debug bun run cli update my-api --verbose
```

### Trace by Correlation ID

Each update has a unique correlation ID. Find it in logs and trace:

```bash
# Find all logs for a specific update
cat logs.json | jq 'select(.correlationId == "update-1734367200-a3c9f")'

# Find file-level errors
cat logs.json | jq 'select(.operation == "pipeline_file_error")'
```

### Common Debug Patterns

```bash
# Find slowest operations
cat logs.json | jq 'select(.durationMs > 1000) | {operation, durationMs, path}'

# Find all errors with types
cat logs.json | jq 'select(.level == "error" or .level == "warn") | {msg, errorType, path}'
```

## Best Practices

1. **Check errors after updates**: Always review error output, especially after major changes
2. **Use --verbose for investigation**: When troubleshooting, see all errors
3. **Use --json for automation**: Parse structured output in scripts
4. **Monitor partial status**: Repositories with frequent partial status may need attention
5. **Force re-index periodically**: Clean slate helps resolve accumulated issues

## Related Documentation

- [Main Troubleshooting Guide](../troubleshooting.md) - General troubleshooting
- [Logging Reference](../logging-reference.md) - Log schema and fields
- [Update Operations](../troubleshooting.md#troubleshooting-update-operations) - Detailed update debugging

---

**Last Updated**: 2025-12-20
