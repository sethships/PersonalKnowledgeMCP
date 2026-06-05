/**
 * Streaming SHA-256 helper for files.
 *
 * Extracted from `IngestionService` and `LocalFolderChangeDetector` (PR #573
 * review L-2). The two call sites previously duplicated the same Promise-
 * wrapped Node stream pattern; this module is the single source of truth.
 *
 * Streaming (rather than `readFile` → `createHash().update`) keeps memory flat
 * regardless of file size, which matters because the manifest writer hashes
 * every indexed file at registration and large generated assets occasionally
 * appear in user folders.
 *
 * @module ingestion/sha256-stream
 */

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

/**
 * Compute the streaming SHA-256 of a file. Returns a 64-character lowercase
 * hex digest.
 *
 * @param absolutePath Absolute path to the file.
 * @returns Promise resolving to the hex digest. Rejects with the underlying
 *   filesystem error if the file cannot be read.
 */
export function streamSha256(absolutePath: string): Promise<string> {
  return new Promise<string>((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
    stream.on("error", rejectHash);
  });
}
