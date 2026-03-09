/**
 * ListWatchedFoldersService implementation
 *
 * Business logic for listing watched folders and their status.
 * Combines FolderWatcherService runtime data with folder configuration
 * to provide a complete view for MCP clients.
 *
 * @module services/list-watched-folders-service
 */

import type { FolderWatcherService } from "./folder-watcher-service.js";
import type {
  ListWatchedFoldersService,
  ListWatchedFoldersResponse,
  WatchedFolderEntry,
} from "./list-watched-folders-types.js";

/**
 * Implementation of ListWatchedFoldersService
 *
 * Maps FolderWatcherService data to the MCP response format.
 * Document and image counts are currently 0 as the document store
 * is not yet implemented (Phase 6 ongoing).
 *
 * @example
 * ```typescript
 * const folderWatcher = new FolderWatcherService();
 * const service = new ListWatchedFoldersServiceImpl(folderWatcher);
 * const response = await service.listWatchedFolders();
 * ```
 */
export class ListWatchedFoldersServiceImpl implements ListWatchedFoldersService {
  constructor(private readonly folderWatcherService: FolderWatcherService) {}

  /**
   * List all configured watched folders and their current status
   *
   * @returns Response containing all watched folders with status information
   */
  async listWatchedFolders(): Promise<ListWatchedFoldersResponse> {
    // Async to match interface contract - future implementations will query document store
    const details = await Promise.resolve(this.folderWatcherService.getAllWatchedFolderDetails());

    const folders: WatchedFolderEntry[] = details.map((detail) => ({
      id: detail.folder.id,
      name: detail.folder.name,
      path: detail.folder.path,
      enabled: detail.folder.enabled,
      includePatterns: detail.folder.includePatterns ?? [],
      excludePatterns: detail.folder.excludePatterns ?? [],
      watcherStatus: detail.status,
      lastScanAt: detail.folder.lastScanAt ?? undefined,
      documentCount: 0, // Not yet implemented - Phase 6 document store pending
      imageCount: 0, // Not yet implemented - Phase 6 image store pending
    }));

    return { folders };
  }
}
