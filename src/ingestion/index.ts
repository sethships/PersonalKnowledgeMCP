/**
 * Repository ingestion module.
 *
 * Handles cloning GitHub repositories and scanning files for indexing into the knowledge base.
 *
 * @module ingestion
 */

export { RepositoryCloner } from "./repository-cloner.js";
export { FileScanner } from "./file-scanner.js";
export type {
  CloneOptions,
  CloneResult,
  RepositoryClonerConfig,
  ScanOptions,
  FileInfo,
  FileScannerConfig,
} from "./types.js";
export {
  RepositoryError,
  ValidationError,
  CloneError,
  AuthenticationError,
  FileScanError,
} from "./errors.js";
