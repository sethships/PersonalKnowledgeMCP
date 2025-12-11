/**
 * Repository ingestion module.
 *
 * Handles cloning GitHub repositories for indexing into the knowledge base.
 *
 * @module ingestion
 */

export { RepositoryCloner } from "./repository-cloner.js";
export type { CloneOptions, CloneResult, RepositoryClonerConfig } from "./types.js";
export { RepositoryError, ValidationError, CloneError, AuthenticationError } from "./errors.js";
