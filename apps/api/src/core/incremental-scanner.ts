import { db } from '../lib/db.js';
import { mediaItems, mediaAssets, ingestRuns, blockedMedia } from '@aggragif/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { checkpointManager, type CheckpointState, type ItemIdentifier } from './checkpoint-manager.js';
import { generateFingerprint, isValidDuration } from './deduplication.js';
import type { BaseAdapter, ScrapedItem, ScanResult } from '../adapters/base-adapter.js';
import { isR2Enabled, downloadAndUploadToR2 } from '../lib/r2.js';
import { buildSourceHeaders, safeFetchMedia, isAllowedUrl } from '../lib/media-fetcher.js';

/**
 * Configuration for the incremental scanner
 */
export interface ScannerConfig {
  /** Maximum pages to scan per run (prevents runaway scans) */
  maxPagesPerRun: number;
  /** Maximum items to process per run */
  maxItemsPerRun: number;
  /** Timeout for the entire scan in milliseconds */
  scanTimeoutMs: number;
  /** Maximum video/gif duration in milliseconds */
  maxDurationMs: number;
  /** Maximum age of items to ingest in milliseconds (default: 2 days) */
  maxItemAgeMs: number;
}

const DEFAULT_CONFIG: ScannerConfig = {
  maxPagesPerRun: 10,
  maxItemsPerRun: 100,
  scanTimeoutMs: 5 * 60 * 1000, // 5 minutes
  maxDurationMs: 10 * 60 * 1000, // 10 minutes
  maxItemAgeMs: 0, // No age limit - ingest all content for Most Viewed
};

/**
 * Result of an ingestion run
 */
export interface IngestRunResult {
  status: 'complete' | 'partial' | 'caught_up' | 'failed';
  pagesScanned: number;
  itemsFound: number;
  itemsNew: number;
  itemsDuplicate: number;
  itemsFailed: number;
  newestItem: ItemIdentifier | null;
  error?: string;
  resumePage?: number;
}

/**
 * Incremental Scanner
 *
 * Core algorithm for efficiently fetching only new content from sources.
 *
 * Strategy:
 * 1. Load checkpoint for thread (last seen item ID/fingerprint)
 * 2. If catch-up cursor exists, resume from saved page
 * 3. Otherwise, start from latest page and walk backward
 * 4. Stop when we hit the checkpoint (seen item) or reach limits
 * 5. Commit items via idempotent upsert
 * 6. Update checkpoint with newest item
 */
export class IncrementalScanner {
  private config: ScannerConfig;

  constructor(config: Partial<ScannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run incremental scan for a thread
   */
  async scan(
    threadId: string,
    sourceId: string,
    adapter: BaseAdapter,
  ): Promise<IngestRunResult> {
    const startTime = Date.now();
    let ingestRunId: string | null = null;

    try {
      // Start ingest run log
      const [run] = await db.insert(ingestRuns).values({
        sourceId,
        threadId,
        status: 'running',
      }).returning({ id: ingestRuns.id });
      ingestRunId = run?.id ?? null;

      // Load or create checkpoint
      const checkpoint = await checkpointManager.getOrCreateCheckpoint(threadId);

      // Check if we should skip due to failures
      if (checkpointManager.shouldSkipDueToFailures(checkpoint)) {
        const result: IngestRunResult = {
          status: 'failed',
          pagesScanned: 0,
          itemsFound: 0,
          itemsNew: 0,
          itemsDuplicate: 0,
          itemsFailed: 0,
          newestItem: null,
          error: `Skipped due to ${checkpoint.consecutiveFailures} consecutive failures`,
        };
        await this.finalizeRun(ingestRunId, result, checkpoint);
        return result;
      }

      // If we had failures but passed the cooldown, reset and start fresh
      if (checkpoint.consecutiveFailures > 0) {
        console.log(`[Scanner] Resetting ${checkpoint.consecutiveFailures} failures for thread ${threadId} after cooldown`);
        await checkpointManager.resetFailures(threadId);
        checkpoint.consecutiveFailures = 0;
        checkpoint.catchUpCursor = null;
      }

      // Determine starting page
      const startPage = checkpointManager.getStartingPage(checkpoint);

      // Run the scan
      const result = await this.performScan(
        threadId,
        adapter,
        checkpoint,
        startPage,
        startTime,
      );

      // Finalize
      await this.finalizeRun(ingestRunId, result, checkpoint);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update failure count and clear stuck catch-up cursor so next retry starts fresh
      await checkpointManager.updateCheckpointFailure(threadId);
      await checkpointManager.clearCatchUpCursor(threadId);

      const result: IngestRunResult = {
        status: 'failed',
        pagesScanned: 0,
        itemsFound: 0,
        itemsNew: 0,
        itemsDuplicate: 0,
        itemsFailed: 0,
        newestItem: null,
        error: errorMessage,
      };

      if (ingestRunId) {
        await this.finalizeRun(ingestRunId, result, null);
      }

      return result;
    }
  }

  /**
   * Perform the actual scanning loop
   */
  private async performScan(
    threadId: string,
    adapter: BaseAdapter,
    checkpoint: CheckpointState,
    startPage: number | null,
    startTime: number,
  ): Promise<IngestRunResult> {
    const itemBuffer: ScrapedItem[] = [];
    let pagesScanned = 0;
    let itemsFound = 0;
    let hitCheckpoint = false;
    let newestItem: ItemIdentifier | null = null;
    let currentPage = startPage;

    // Get total pages if starting fresh
    if (currentPage === null) {
      const pageInfo = await adapter.getLatestPage();
      currentPage = pageInfo.latestPage;
    }

    // Scan pages backward
    while (currentPage >= 1 && pagesScanned < this.config.maxPagesPerRun) {
      // Check timeout
      if (Date.now() - startTime > this.config.scanTimeoutMs) {
        // Save catch-up cursor and return partial
        await checkpointManager.saveCatchUpCursor(
          threadId,
          currentPage,
          itemBuffer.length,
          'timeout',
        );

        return this.buildResult('partial', pagesScanned, itemsFound, itemBuffer, newestItem, currentPage);
      }

      // Fetch page
      const scanResult = await adapter.scanPage(currentPage);
      pagesScanned++;
      itemsFound += scanResult.items.length;

      // Process items (newest first on each page)
      for (const item of scanResult.items) {
        // Generate identifier
        const identifier: ItemIdentifier = {
          externalId: item.externalId,
          fingerprint: generateFingerprint({
            mediaUrl: item.mediaUrl,
            author: item.author,
            timestamp: item.postedAt,
            width: item.width,
            height: item.height,
          }),
          timestamp: item.postedAt,
          pageNumber: currentPage,
        };

        // Track newest item (first item we see)
        if (!newestItem) {
          newestItem = identifier;
        }

        // Compare to checkpoint
        const comparison = checkpointManager.compareItem(identifier, checkpoint);

        if (comparison.status === 'seen') {
          // Hit checkpoint - we've caught up
          hitCheckpoint = true;
          break;
        }

        if (comparison.status === 'older') {
          // Item is older than checkpoint - skip but continue
          // (in case of out-of-order items)
          continue;
        }

        // Validate item
        if (!this.isValidItem(item)) {
          continue;
        }

        // Add to buffer
        itemBuffer.push({ ...item, fingerprint: identifier.fingerprint });

        // Check item limit
        if (itemBuffer.length >= this.config.maxItemsPerRun) {
          // Save catch-up cursor
          await checkpointManager.saveCatchUpCursor(
            threadId,
            currentPage,
            itemBuffer.length,
            'page_cap',
          );

          // Commit buffered items
          const commitResult = await this.commitItems(threadId, itemBuffer, adapter.getSourceConfig().extra);

          return {
            status: 'partial',
            pagesScanned,
            itemsFound,
            itemsNew: commitResult.inserted,
            itemsDuplicate: commitResult.duplicates,
            itemsFailed: commitResult.failed,
            newestItem,
            resumePage: currentPage,
          };
        }
      }

      if (hitCheckpoint) {
        break;
      }

      // Check if all items on this page are too old - stop scanning backward
      if (scanResult.items.length > 0 && this.config.maxItemAgeMs > 0) {
        const oldestOnPage = scanResult.items[scanResult.items.length - 1];
        if (oldestOnPage?.postedAt) {
          const age = Date.now() - oldestOnPage.postedAt.getTime();
          if (age > this.config.maxItemAgeMs) {
            console.log(`[Scanner] All items on page ${currentPage} are older than max age, stopping`);
            break;
          }
        }
      }

      // Move to previous page
      currentPage--;
    }

    // Commit all buffered items
    const commitResult = await this.commitItems(threadId, itemBuffer, adapter.getSourceConfig().extra);

    // Determine final status
    let status: IngestRunResult['status'];
    if (hitCheckpoint) {
      status = 'complete';
    } else if (pagesScanned >= this.config.maxPagesPerRun && currentPage >= 1) {
      // Hit page cap without finding checkpoint
      await checkpointManager.saveCatchUpCursor(
        threadId,
        currentPage,
        itemBuffer.length,
        'page_cap',
      );
      status = 'partial';
    } else {
      // Scanned all available pages
      status = 'caught_up';
    }

    // Update checkpoint on success
    if (status !== 'partial') {
      await checkpointManager.updateCheckpointSuccess(threadId, newestItem, currentPage ?? undefined);
    }

    return {
      status,
      pagesScanned,
      itemsFound,
      itemsNew: commitResult.inserted,
      itemsDuplicate: commitResult.duplicates,
      itemsFailed: commitResult.failed,
      newestItem,
      resumePage: status === 'partial' ? currentPage ?? undefined : undefined,
    };
  }

  /**
   * Validate an item meets our criteria
   */
  private isValidItem(item: ScrapedItem): boolean {
    // Must have media URL
    if (!item.mediaUrl) {
      return false;
    }

    // Check duration for videos/gifs
    if (item.durationMs !== undefined) {
      if (!isValidDuration(item.durationMs, this.config.maxDurationMs)) {
        return false;
      }
    }

    // Must have valid type
    if (!['image', 'gif', 'video'].includes(item.mediaType)) {
      return false;
    }

    // Check item age - skip items older than maxItemAgeMs
    if (item.postedAt && this.config.maxItemAgeMs > 0) {
      const age = Date.now() - item.postedAt.getTime();
      if (age > this.config.maxItemAgeMs) {
        return false;
      }
    }

    return true;
  }

  /**
   * Commit items to database using idempotent upsert
   */
  private async commitItems(
    threadId: string,
    items: ScrapedItem[],
    scraperConfig?: Record<string, unknown>,
  ): Promise<{ inserted: number; duplicates: number; failed: number }> {
    if (items.length === 0) {
      return { inserted: 0, duplicates: 0, failed: 0 };
    }

    let inserted = 0;
    let duplicates = 0;
    let failed = 0;

    for (const item of items) {
      try {
        // Check blocklist — skip items that were admin-deleted
        const blocked = await db.query.blockedMedia.findFirst({
          where: and(
            eq(blockedMedia.threadId, threadId),
            eq(blockedMedia.externalItemId, item.externalId),
          ),
        });
        if (blocked) {
          duplicates++;
          continue;
        }

        // Duration cap: skip videos/GIFs longer than 30 seconds
        const MAX_DURATION_MS = 30_000;
        if (
          (item.mediaType === 'video' || item.mediaType === 'gif') &&
          item.durationMs != null &&
          item.durationMs > MAX_DURATION_MS
        ) {
          console.log(`[Scanner] Skipping item ${item.externalId} (duration ${item.durationMs}ms exceeds 30s cap)`);
          continue;
        }

        // Insert media item (ON CONFLICT DO NOTHING for idempotency)
        const result = await db.insert(mediaItems).values({
          threadId,
          externalItemId: item.externalId,
          fingerprint: item.fingerprint!,
          permalink: item.permalink,
          postedAt: item.postedAt,
          author: item.author,
          authorUrl: item.authorUrl,
          title: item.title,
          caption: item.caption,
          mediaType: item.mediaType,
          mediaUrls: {
            original: item.mediaUrl,
            thumbnail: item.thumbnailUrl,
          },
          durationMs: item.durationMs,
          width: item.width,
          height: item.height,
          tags: item.tags || [],
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
        }).onConflictDoUpdate({
          target: [mediaItems.threadId, mediaItems.externalItemId],
          set: {
            // Don't overwrite user-generated counts on re-ingestion
          },
        }).returning({ id: mediaItems.id });

        const insertedItem = result[0];
        if (insertedItem) {
          inserted++;

          // Insert media assets if present
          if (item.assets && item.assets.length > 0) {
            for (let i = 0; i < item.assets.length; i++) {
              const asset = item.assets[i];
              if (asset) {
                await db.insert(mediaAssets).values({
                  mediaItemId: insertedItem.id,
                  assetUrl: asset.url,
                  assetType: asset.type,
                  durationMs: asset.durationMs,
                  width: asset.width,
                  height: asset.height,
                  position: i,
                }).onConflictDoNothing();
              }
            }
          }

          // Pre-cache media to R2 CDN
          if (isR2Enabled()) {
            try {
              const sc = scraperConfig as { headers?: Record<string, string> } | undefined;
              const cdnUpdates: Record<string, string> = {};

              // Download and upload original
              if (item.mediaUrl && isAllowedUrl(item.mediaUrl)) {
                const headers = buildSourceHeaders(item.mediaUrl, sc);
                const cdnUrl = await downloadAndUploadToR2(
                  insertedItem.id, 'original', item.mediaUrl,
                  (url) => safeFetchMedia(url, headers),
                );
                if (cdnUrl) cdnUpdates.cdnOriginal = cdnUrl;
              }

              // Download and upload thumbnail
              if (item.thumbnailUrl && isAllowedUrl(item.thumbnailUrl)) {
                const headers = buildSourceHeaders(item.thumbnailUrl, sc);
                const cdnUrl = await downloadAndUploadToR2(
                  insertedItem.id, 'thumb', item.thumbnailUrl,
                  (url) => safeFetchMedia(url, headers),
                );
                if (cdnUrl) cdnUpdates.cdnThumbnail = cdnUrl;
              }

              // Update DB with CDN URLs
              if (Object.keys(cdnUpdates).length > 0) {
                await db.update(mediaItems)
                  .set({ mediaUrls: sql`${mediaItems.mediaUrls} || ${JSON.stringify(cdnUpdates)}::jsonb` })
                  .where(eq(mediaItems.id, insertedItem.id))
                  .execute();
              }
            } catch (r2Err) {
              console.warn(`[R2] Pre-cache failed for item ${insertedItem.id}:`, r2Err);
            }
          }
        } else {
          duplicates++;
        }
      } catch (error) {
        failed++;
        console.error('Failed to insert item:', item.externalId, error);
      }
    }

    return { inserted, duplicates, failed };
  }

  /**
   * Build a result object
   */
  private buildResult(
    status: IngestRunResult['status'],
    pagesScanned: number,
    itemsFound: number,
    items: ScrapedItem[],
    newestItem: ItemIdentifier | null,
    resumePage?: number,
  ): IngestRunResult {
    return {
      status,
      pagesScanned,
      itemsFound,
      itemsNew: 0, // Will be updated after commit
      itemsDuplicate: 0,
      itemsFailed: 0,
      newestItem,
      resumePage,
    };
  }

  /**
   * Finalize the ingest run record
   */
  private async finalizeRun(
    runId: string | null,
    result: IngestRunResult,
    checkpointBefore: CheckpointState | null,
  ): Promise<void> {
    if (!runId) return;

    const checkpointAfter = checkpointBefore
      ? await checkpointManager.loadCheckpoint(checkpointBefore.threadId)
      : null;

    await db.update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: result.status,
        pagesScanned: result.pagesScanned,
        itemsFound: result.itemsFound,
        itemsNew: result.itemsNew,
        itemsDuplicate: result.itemsDuplicate,
        itemsFailed: result.itemsFailed,
        errorSummary: result.error,
        checkpointBefore: checkpointBefore,
        checkpointAfter: checkpointAfter,
      })
      .where(eq(ingestRuns.id, runId));
  }
}

// Singleton with default config
export const scanner = new IncrementalScanner();
