/**
 * Repository ingestion module.
 *
 * Handles cloning GitHub repositories and scanning files for indexing into the knowledge base.
 *
 * @module ingestion
 */

export { RepositoryCloner } from "./repository-cloner.js";
export { FileScanner } from "./file-scanner.js";
export { FileChunker } from "./file-chunker.js";
export { DEFAULT_EXTENSIONS } from "./default-extensions.js";
export { detectLanguage, SUPPORTED_LANGUAGES } from "./language-detector.js";
export type { ProgrammingLanguage } from "./language-detector.js";
export type {
  CloneOptions,
  CloneResult,
  RepositoryClonerConfig,
  ScanOptions,
  FileInfo,
  FileScannerConfig,
  FileChunk,
  ChunkerConfig,
} from "./types.js";
export {
  RepositoryError,
  ValidationError,
  CloneError,
  AuthenticationError,
  FileScanError,
  ChunkingError,
} from "./errors.js";
