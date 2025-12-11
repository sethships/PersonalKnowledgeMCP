# [Feature] Repository Cloner Implementation

## Description

Implement the `RepositoryCloner` component that clones GitHub repositories for indexing. This component handles both public and private repositories, with authentication via GitHub Personal Access Token (PAT).

## Requirements

From PRD FR-3 and SDD Section 6.4:
- Clone public repositories via HTTPS
- Clone private repositories using PAT authentication
- Support shallow clones for faster initial indexing
- Store cloned repositories in configurable directory
- Extract repository name from URL

## Acceptance Criteria

### Implementation (`src/ingestion/repository-cloner.ts`)
- [ ] `RepositoryCloner` class implemented
- [ ] Uses `simple-git` npm package for Git operations
- [ ] Clone operations:
  - [ ] `clone(url: string, options?: CloneOptions): Promise<string>`
  - [ ] Returns path to cloned repository
  - [ ] Supports shallow clone (depth=1) by default
  - [ ] Supports branch specification
  - [ ] Supports `fresh` option to force re-clone
- [ ] Authentication:
  - [ ] Reads `GITHUB_PAT` from environment
  - [ ] Builds authenticated URL: `https://{PAT}:x-oauth-basic@github.com/...`
  - [ ] PAT never logged or exposed in errors
- [ ] URL handling:
  - [ ] Validates GitHub URL format
  - [ ] Extracts repository name from URL
  - [ ] Handles URLs with/without `.git` suffix
- [ ] File system:
  - [ ] Clone target: `{REPO_CLONE_PATH}/{repo-name}`
  - [ ] Skip clone if directory exists (unless `fresh: true`)
  - [ ] Create parent directories if needed
- [ ] Error handling:
  - [ ] Invalid URL format
  - [ ] Authentication failure (private repo without PAT)
  - [ ] Clone failure (network, permissions)
  - [ ] Repository not found (404)

### Configuration
- [ ] `REPO_CLONE_PATH` env var (default: `./data/repos`)
- [ ] `GITHUB_PAT` env var (optional, required for private repos)

### Interfaces

```typescript
interface CloneOptions {
  name?: string;      // Override auto-detected name
  branch?: string;    // Specific branch to clone
  shallow?: boolean;  // Shallow clone (default: true)
  fresh?: boolean;    // Force re-clone (default: false)
}

interface CloneResult {
  path: string;       // Local path to cloned repo
  name: string;       // Repository name
  branch: string;     // Branch that was cloned
}
```

## Technical Notes

### URL Pattern Validation

```typescript
function validateGitHubUrl(url: string): boolean {
  const pattern = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
  return pattern.test(url);
}
```

### Repository Name Extraction

```typescript
function extractRepoName(url: string): string {
  // https://github.com/user/repo-name.git -> repo-name
  // https://github.com/user/repo-name -> repo-name
  const match = url.match(/\/([^\/]+?)(\.git)?$/);
  if (!match) throw new Error('Invalid repository URL');
  return match[1];
}
```

### Authenticated URL Building

```typescript
function buildAuthenticatedUrl(url: string, pat: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === 'github.com' && pat) {
    parsed.username = pat;
    parsed.password = 'x-oauth-basic';
  }
  return parsed.toString();
}
```

### simple-git Usage

```typescript
import simpleGit, { SimpleGit } from 'simple-git';

const git: SimpleGit = simpleGit();

// Clone with options
await git.clone(authUrl, targetPath, ['--depth', '1', '--branch', 'main']);
```

### Windows Path Considerations
- Use `path.resolve()` for absolute paths
- Normalize paths with `path.normalize()`

## Testing Requirements

- [ ] Unit tests (80% coverage):
  - [ ] URL validation (valid/invalid patterns)
  - [ ] Repository name extraction
  - [ ] Authenticated URL building
  - [ ] Clone options handling
- [ ] Integration tests:
  - [ ] Clone public repository (use small test repo)
  - [ ] Skip existing clone
  - [ ] Fresh clone (delete and re-clone)
  - [ ] Shallow vs full clone
  - [ ] Branch specification
- [ ] Error handling tests:
  - [ ] Invalid URL
  - [ ] Repository not found
  - [ ] Network error simulation

**Note:** Private repo tests require manual testing with actual PAT.

## Definition of Done

- [ ] Implementation complete with TypeScript types
- [ ] Unit tests passing (80% coverage)
- [ ] Integration tests passing
- [ ] PAT never logged
- [ ] JSDoc comments on public methods
- [ ] Exported from ingestion module index

## Size Estimate

**Size:** M (Medium) - 4-6 hours

## Dependencies

- #1 Project Setup

## Blocks

- #9 Ingestion Service

## Labels

phase-1, P0, feature
