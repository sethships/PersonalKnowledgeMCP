/**
 * Index Completeness Checker Service
 *
 * Compares the stored file count in repository metadata against the actual
 * number of eligible files on disk, detecting incomplete indexes that may
 * have diverged during incremental updates.
 *
 * @module services/index-completeness-checker
 */

import type { Logger } from "pino";
import { getComponentLogger } from "../logging/index.js";
import type { FileScanner } from "../ingestion/file-scanner.js";
import type { RepositoryInfo } from "../repositories/types.js";
import type {
  CompletenessCheckResult,
  CompletenessThresholds,
} from "./index-completeness-types.js";

/**
 * Default thresholds for completeness detection.
 *
 * A repository is flagged as incomplete if:
 * - More than 20% of eligible files are missing, OR
 * - More than 50 files are missing
 */
export const DEFAULT_COMPLETENESS_THRESHOLDS: CompletenessThresholds = {
  completenessThresholdPercent: 20,
  completenessThresholdAbsolute: 50,
};

/**
 * Service that checks whether a repository index is complete by comparing
 * stored file counts against actual eligible files on disk.
 *
 * Designed to be non-blocking: errors during the check are captured in the
 * result rather than thrown, so callers can safely use this without
 * disrupting the main update workflow.
 *
 * @example
 * ```typescript
 * const checker = new IndexCompletenessChecker(fileScanner);
 * const result = await checker.checkCompleteness(repo);
 *
 * if (result.status === "incomplete") {
 *   console.warn(`Index incomplete: ${result.missingFileCount} files missing`);
 * }
 * ```
 */
export class IndexCompletenessChecker {
  private _logger: Logger | null = null;
  private readonly thresholds: CompletenessThresholds;

  /**
   * Create an index completeness checker.
   *
   * @param fileScanner - File scanner to count eligible files on disk
   * @param thresholds - Optional custom thresholds (defaults: 20%, 50 files)
   */
  constructor(
    private readonly fileScanner: FileScanner,
    thresholds?: Partial<CompletenessThresholds>
  ) {
    this.thresholds = {
      ...DEFAULT_COMPLETENESS_THRESHOLDS,
      ...thresholds,
    };

    if (this.thresholds.completenessThresholdPercent < 0) {
      throw new Error("completenessThresholdPercent must be non-negative");
    }
    if (this.thresholds.completenessThresholdAbsolute < 0) {
      throw new Error("completenessThresholdAbsolute must be non-negative");
    }
  }

  /** Get logger instance (lazy initialization). */
  private get logger(): Logger {
    if (!this._logger) {
      this._logger = getComponentLogger("services:index-completeness-checker");
    }
    return this._logger;
  }

  /**
   * Check completeness of a repository index.
   *
   * Compares the stored `fileCount` in repository metadata against the number
   * of eligible files found on disk by the file scanner. Never throws; errors
   * are captured in the returned result with `status: "error"`.
   *
   * @param repo - Repository metadata containing fileCount and scan config
   * @returns Completeness check result (never throws)
   */
  async checkCompleteness(repo: RepositoryInfo): Promise<CompletenessCheckResult> {
    const startTime = Date.now();

    try {
      this.logger.debug(
        { repository: repo.name, indexedFileCount: repo.fileCount },
        "Starting completeness check"
      );

      // Scan disk to count eligible files
      const eligibleFiles = await this.fileScanner.scanFiles(repo.localPath, {
        includeExtensions: repo.includeExtensions,
        excludePatterns: repo.excludePatterns,
      });

      const eligibleFileCount = eligibleFiles.length;
      const indexedFileCount = repo.fileCount;

      // More indexed than on disk is not flagged (could be stale deletions)
      const missingFileCount = Math.max(0, eligibleFileCount - indexedFileCount);

      // Calculate divergence percentage (avoid division by zero)
      const divergencePercent =
        eligibleFileCount > 0 ? Math.round((missingFileCount / eligibleFileCount) * 1000) / 10 : 0;

      // Determine status based on thresholds (OR logic: either threshold triggers)
      const exceedsPercent = divergencePercent > this.thresholds.completenessThresholdPercent;
      const exceedsAbsolute = missingFileCount > this.thresholds.completenessThresholdAbsolute;
      const status = exceedsPercent || exceedsAbsolute ? "incomplete" : "complete";

      const durationMs = Date.now() - startTime;

      this.logger.info(
        {
          repository: repo.name,
          status,
          indexedFileCount,
          eligibleFileCount,
          missingFileCount,
          divergencePercent,
          durationMs,
        },
        "Completeness check finished"
      );

      return {
        status,
        indexedFileCount,
        eligibleFileCount,
        missingFileCount,
        divergencePercent,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        { repository: repo.name, error: errorMessage, durationMs },
        "Completeness check failed"
      );

      return {
        status: "error",
        indexedFileCount: repo.fileCount,
        eligibleFileCount: 0,
        missingFileCount: 0,
        divergencePercent: 0,
        durationMs,
        errorMessage,
      };
    }
  }
}
