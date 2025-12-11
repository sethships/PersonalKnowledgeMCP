# [Feature] CLI Commands Implementation

## Description

Implement the command-line interface for repository management and testing. The CLI provides commands for indexing repositories, searching, checking status, and removing repositories.

## Requirements

From PRD FR-7:
- `index <repository-url>` - Clone and index a repository
- `search <query>` - Perform semantic search (for testing)
- `status` - Show indexed repositories and system status
- `remove <repository-name>` - Remove repository from index
- `--help` documentation for all commands

## Acceptance Criteria

### CLI Framework (`src/cli.ts`)
- [ ] Uses `commander` npm package
- [ ] Program name: `pk-mcp` (personal-knowledge-mcp)
- [ ] Version from package.json
- [ ] Global options:
  - [ ] `--verbose` / `-v` - Enable verbose logging
  - [ ] `--help` / `-h` - Show help

### index Command
- [ ] Syntax: `pk-mcp index <repository-url> [options]`
- [ ] Options:
  - [ ] `--name <name>` - Override repository name
  - [ ] `--branch <branch>` - Specify branch to clone
  - [ ] `--shallow` / `--no-shallow` - Shallow clone (default: shallow)
- [ ] Behavior:
  - [ ] Validates URL format
  - [ ] Shows progress during indexing
  - [ ] Reports success with file/chunk counts
  - [ ] Reports errors with helpful messages
- [ ] Example: `pk-mcp index https://github.com/user/my-repo.git --branch main`

### search Command
- [ ] Syntax: `pk-mcp search <query> [options]`
- [ ] Options:
  - [ ] `--limit <number>` - Max results (default: 10)
  - [ ] `--threshold <number>` - Min similarity (default: 0.7)
  - [ ] `--repo <name>` - Filter to specific repository
  - [ ] `--json` - Output as JSON
- [ ] Behavior:
  - [ ] Performs semantic search
  - [ ] Displays results with file path, snippet, similarity
  - [ ] Shows query timing
- [ ] Example: `pk-mcp search "authentication middleware" --limit 5`

### status Command
- [ ] Syntax: `pk-mcp status [options]`
- [ ] Options:
  - [ ] `--json` - Output as JSON
- [ ] Behavior:
  - [ ] Lists all indexed repositories
  - [ ] Shows file count, chunk count, last indexed
  - [ ] Shows repository status (ready/indexing/error)
  - [ ] Shows summary statistics
  - [ ] Shows service health (ChromaDB connection)
- [ ] Example: `pk-mcp status`

### remove Command
- [ ] Syntax: `pk-mcp remove <repository-name> [options]`
- [ ] Options:
  - [ ] `--force` / `-f` - Skip confirmation
  - [ ] `--delete-files` - Also delete cloned files
- [ ] Behavior:
  - [ ] Prompts for confirmation (unless --force)
  - [ ] Removes from ChromaDB
  - [ ] Removes metadata
  - [ ] Optionally deletes cloned files
- [ ] Example: `pk-mcp remove my-repo --force`

### health Command (bonus)
- [ ] Syntax: `pk-mcp health`
- [ ] Shows service health status
- [ ] Checks ChromaDB connectivity
- [ ] Checks OpenAI API (optional ping)

## Technical Notes

### Commander Setup

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('pk-mcp')
  .description('Personal Knowledge MCP - Semantic code search')
  .version('1.0.0');

program
  .command('index <url>')
  .description('Index a GitHub repository')
  .option('-n, --name <name>', 'Override repository name')
  .option('-b, --branch <branch>', 'Branch to clone')
  .option('--shallow', 'Shallow clone (default)', true)
  .option('--no-shallow', 'Full clone')
  .action(async (url, options) => {
    await indexCommand(url, options);
  });

// ... other commands

program.parse();
```

### Progress Display

```typescript
function showProgress(progress: IndexProgress): void {
  const { phase, filesProcessed, totalFiles } = progress;
  const percent = Math.round((filesProcessed / totalFiles) * 100);

  // Clear line and rewrite
  process.stdout.write(`\r${phase}: ${filesProcessed}/${totalFiles} (${percent}%)`);
}
```

### Table Output for Status

```typescript
function displayStatus(repos: RepositoryInfo[]): void {
  console.log('\nIndexed Repositories:');
  console.log('─'.repeat(80));
  console.log(
    'Name'.padEnd(20) +
    'Files'.padStart(8) +
    'Chunks'.padStart(10) +
    'Status'.padStart(12) +
    'Last Indexed'.padStart(25)
  );
  console.log('─'.repeat(80));

  for (const repo of repos) {
    console.log(
      repo.name.padEnd(20) +
      String(repo.file_count).padStart(8) +
      String(repo.chunk_count).padStart(10) +
      repo.status.padStart(12) +
      repo.last_indexed.padStart(25)
    );
  }
}
```

### Error Display

```typescript
function showError(message: string, details?: string): void {
  console.error(`\nError: ${message}`);
  if (details) {
    console.error(`Details: ${details}`);
  }
  process.exit(1);
}
```

### Package.json bin Entry

```json
{
  "bin": {
    "pk-mcp": "./dist/cli.js"
  }
}
```

### Running Locally

```bash
# During development
npx ts-node src/cli.ts index https://github.com/user/repo.git

# After build
node dist/cli.js index https://github.com/user/repo.git

# After npm link
pk-mcp index https://github.com/user/repo.git
```

## Testing Requirements

- [ ] Unit tests for command parsing (85% coverage):
  - [ ] Valid command arguments
  - [ ] Option parsing
  - [ ] Help text generation
- [ ] Integration tests:
  - [ ] index command with test repository
  - [ ] search command with indexed data
  - [ ] status command output format
  - [ ] remove command confirmation flow
- [ ] Error handling:
  - [ ] Invalid URL
  - [ ] Repository not found
  - [ ] Missing required arguments

## Definition of Done

- [ ] All four commands implemented
- [ ] Help text for all commands
- [ ] Progress display during indexing
- [ ] JSON output option where applicable
- [ ] Unit tests passing (85% coverage)
- [ ] Integration tests passing
- [ ] Package.json bin entry configured

## Size Estimate

**Size:** M (Medium) - 6-8 hours

## Dependencies

- #1 Project Setup (commander dependency)
- #9 Ingestion Service (for index command)
- #10 Search Service (for search command)
- #5 Repository Metadata Store (for status/remove)

## Blocks

- None (end-user interface)

## Labels

phase-1, P0, feature
