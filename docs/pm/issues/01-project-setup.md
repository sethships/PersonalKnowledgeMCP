# [Infrastructure] Project Setup and Tooling Configuration

## Description

Initialize the Node.js/TypeScript project with all required tooling, configuration files, and directory structure as defined in the Phase 1 SDD.

This is the foundation issue that must be completed before any other development work can begin.

## Requirements

From PRD FR-* and SDD Section 14:
- Node.js 20+ with TypeScript 5.3+
- npm as package manager
- Jest with ts-jest for testing
- ESLint with TypeScript rules
- Prettier for code formatting
- TypeScript strict mode enabled

## Acceptance Criteria

- [ ] `package.json` created with all dependencies from SDD Section 7.2 and 7.3
- [ ] `tsconfig.json` configured per SDD Section 7.1 specifications
- [ ] `.eslintrc.json` configured with TypeScript rules
- [ ] `.prettierrc` configured for consistent formatting
- [ ] `jest.config.js` configured with ts-jest
- [ ] Directory structure created per SDD Section 14.1:
  - `src/` with subdirectories (mcp, services, providers, storage, ingestion, config, logging, types)
  - `tests/` with subdirectories (unit, integration, e2e, fixtures, helpers)
  - `config/` for configuration files
  - `data/` directory (gitignored)
- [ ] `.env.example` created with all environment variables from SDD Section 8.3
- [ ] `.gitignore` updated to exclude `data/`, `dist/`, `node_modules/`, `.env`
- [ ] `npm install` succeeds without errors
- [ ] `npm run build` succeeds (TypeScript compilation)
- [ ] `npm run lint` runs without configuration errors
- [ ] `npm test` runs (even if no tests yet)

## Technical Notes

### Core Dependencies (from SDD 7.2)
```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "openai": "^4.0.0",
  "chromadb": "^1.8.0",
  "simple-git": "^3.22.0",
  "glob": "^10.0.0",
  "ignore": "^5.3.0",
  "zod": "^3.22.0",
  "pino": "^8.17.0",
  "commander": "^12.0.0"
}
```

### Dev Dependencies (from SDD 7.3)
```json
{
  "typescript": "^5.3.0",
  "jest": "^29.7.0",
  "ts-jest": "^29.1.0",
  "@types/node": "^20.0.0",
  "eslint": "^8.56.0",
  "@typescript-eslint/eslint-plugin": "^6.0.0",
  "@typescript-eslint/parser": "^6.0.0",
  "prettier": "^3.2.0"
}
```

### TypeScript Config (from SDD 7.1)
- Target: ES2022
- Module: NodeNext
- Strict mode: enabled
- Source maps: enabled

## Testing Requirements

- [ ] Verify TypeScript compilation with sample file
- [ ] Verify Jest runs with sample test
- [ ] Verify ESLint runs without errors on sample file

## Definition of Done

- [ ] All configuration files committed
- [ ] Directory structure in place
- [ ] All npm scripts work
- [ ] README updated with setup instructions
- [ ] No linting errors
- [ ] CI-ready (can be built in clean environment)

## Size Estimate

**Size:** M (Medium) - 4-6 hours

## Dependencies

- None (first issue)

## Blocks

- All other Phase 1 issues

## Labels

phase-1, P0, infrastructure
