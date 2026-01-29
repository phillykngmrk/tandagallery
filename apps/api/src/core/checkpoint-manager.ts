import { db } from '../lib/db.js';
import { checkpoints, threads } from '@aggragif/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Catch-up cursor for resuming partial runs
 */
export interface CatchUpCursor {
  currentPage: number;
  startedAt: string;
  itemsIngested: number;
  reason: 'page_cap' | 'timeout' | 'error';
}

/**
 * Checkpoint state for a thread
 */
export interface CheckpointState {
  threadId: string;
  lastSeenItemId: string | null;
  lastSeenFingerprint: string | null;
  lastSeenPage: number | null;
  lastSeenTimestamp: Date | null;
  catchUpCursor: CatchUpCursor | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
}

/**
 * Item identifier for checkpoint comparison
 */
export interface ItemIdentifier {
  externalId: string;
  fingerprint: string;
  timestamp: Date;
  pageNumber?: number;
}

/**
 * Result of comparing an item to the checkpoint
 */
export type ComparisonResult =
  | { status: 'new' }
  | { status: 'seen'; matchedBy: 'id' | 'fingerprint' | 'timestamp' }
  | { status: 'older'; reason: string };

/**
 * Checkpoint Manager
 *
 * Handles loading, saving, and comparing checkpoint state for incremental ingestion.
 * Ensures we only process new items and can resume from partial runs.
 */
export class CheckpointManager {
  /**
   * Load checkpoint state for a thread
   */
  async loadCheckpoint(threadId: string): Promise<CheckpointState | null> {
    const checkpoint = await db.query.checkpoints.findFirst({
      where: (c, { eq }) => eq(c.threadId, threadId),
    });

    if (!checkpoint) {
      return null;
    }

    return {
      threadId: checkpoint.threadId,
      lastSeenItemId: checkpoint.lastSeenItemId,
      lastSeenFingerprint: checkpoint.lastSeenFingerprint,
      lastSeenPage: checkpoint.lastSeenPage,
      lastSeenTimestamp: checkpoint.lastSeenTimestamp,
      catchUpCursor: checkpoint.catchUpCursor as CatchUpCursor | null,
      lastRunAt: checkpoint.lastRunAt,
      lastSuccessAt: checkpoint.lastSuccessAt,
      consecutiveFailures: checkpoint.consecutiveFailures,
    };
  }

  /**
   * Initialize checkpoint for a new thread (first run)
   */
  async initializeCheckpoint(threadId: string): Promise<CheckpointState> {
    // Verify thread exists
    const thread = await db.query.threads.findFirst({
      where: (t, { eq }) => eq(t.id, threadId),
    });

    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    // Create initial checkpoint
    await db.insert(checkpoints).values({
      threadId,
      consecutiveFailures: 0,
    }).onConflictDoNothing();

    return {
      threadId,
      lastSeenItemId: null,
      lastSeenFingerprint: null,
      lastSeenPage: null,
      lastSeenTimestamp: null,
      catchUpCursor: null,
      lastRunAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
    };
  }

  /**
   * Get or create checkpoint for a thread
   */
  async getOrCreateCheckpoint(threadId: string): Promise<CheckpointState> {
    const existing = await this.loadCheckpoint(threadId);
    if (existing) {
      return existing;
    }
    return this.initializeCheckpoint(threadId);
  }

  /**
   * Compare an item against the checkpoint to determine if it's new
   *
   * Priority:
   * 1. External ID match (most reliable)
   * 2. Fingerprint match (fallback for ID changes)
   * 3. Timestamp comparison (last resort)
   */
  compareItem(item: ItemIdentifier, checkpoint: CheckpointState): ComparisonResult {
    // If no checkpoint data, everything is new
    if (!checkpoint.lastSeenItemId && !checkpoint.lastSeenFingerprint && !checkpoint.lastSeenTimestamp) {
      return { status: 'new' };
    }

    // Primary: Check external ID
    if (checkpoint.lastSeenItemId && item.externalId === checkpoint.lastSeenItemId) {
      return { status: 'seen', matchedBy: 'id' };
    }

    // Secondary: Check fingerprint
    if (checkpoint.lastSeenFingerprint && item.fingerprint === checkpoint.lastSeenFingerprint) {
      return { status: 'seen', matchedBy: 'fingerprint' };
    }

    // Tertiary: Check timestamp (with small tolerance for clock skew)
    if (checkpoint.lastSeenTimestamp) {
      const checkpointTime = checkpoint.lastSeenTimestamp.getTime();
      const itemTime = item.timestamp.getTime();
      const tolerance = 60 * 1000; // 1 minute tolerance

      if (itemTime <= checkpointTime - tolerance) {
        return { status: 'older', reason: 'timestamp_before_checkpoint' };
      }
    }

    return { status: 'new' };
  }

  /**
   * Check if we should resume from a catch-up cursor
   */
  hasCatchUpCursor(checkpoint: CheckpointState): boolean {
    return checkpoint.catchUpCursor !== null;
  }

  /**
   * Get the starting page for scanning
   * Returns catch-up page if resuming, otherwise null for latest page
   */
  getStartingPage(checkpoint: CheckpointState): number | null {
    if (checkpoint.catchUpCursor) {
      return checkpoint.catchUpCursor.currentPage;
    }
    return null; // Signal to start from latest
  }

  /**
   * Update checkpoint after successful ingestion run
   */
  async updateCheckpointSuccess(
    threadId: string,
    newestItem: ItemIdentifier | null,
    pageNumber?: number,
  ): Promise<void> {
    const now = new Date();

    await db.update(checkpoints)
      .set({
        lastSeenItemId: newestItem?.externalId ?? undefined,
        lastSeenFingerprint: newestItem?.fingerprint ?? undefined,
        lastSeenPage: pageNumber ?? undefined,
        lastSeenTimestamp: newestItem?.timestamp ?? undefined,
        catchUpCursor: null, // Clear catch-up on success
        lastRunAt: now,
        lastSuccessAt: now,
        consecutiveFailures: 0,
        updatedAt: now,
      })
      .where(eq(checkpoints.threadId, threadId));
  }

  /**
   * Save catch-up cursor for partial run (hit page cap)
   */
  async saveCatchUpCursor(
    threadId: string,
    currentPage: number,
    itemsIngested: number,
    reason: CatchUpCursor['reason'],
  ): Promise<void> {
    const now = new Date();
    const cursor: CatchUpCursor = {
      currentPage,
      startedAt: now.toISOString(),
      itemsIngested,
      reason,
    };

    await db.update(checkpoints)
      .set({
        catchUpCursor: cursor,
        lastRunAt: now,
        updatedAt: now,
      })
      .where(eq(checkpoints.threadId, threadId));
  }

  /**
   * Update checkpoint after failed run
   */
  async updateCheckpointFailure(threadId: string): Promise<number> {
    const now = new Date();

    const checkpoint = await this.loadCheckpoint(threadId);
    const newFailureCount = (checkpoint?.consecutiveFailures ?? 0) + 1;

    await db.update(checkpoints)
      .set({
        lastRunAt: now,
        consecutiveFailures: newFailureCount,
        updatedAt: now,
      })
      .where(eq(checkpoints.threadId, threadId));

    return newFailureCount;
  }

  /**
   * Clear catch-up cursor without updating other state
   */
  async clearCatchUpCursor(threadId: string): Promise<void> {
    await db.update(checkpoints)
      .set({
        catchUpCursor: null,
        updatedAt: new Date(),
      })
      .where(eq(checkpoints.threadId, threadId));
  }

  /**
   * Check if thread should be skipped due to too many failures.
   * Auto-resets after a cooldown period (1 hour) so threads can recover
   * from transient source errors.
   */
  shouldSkipDueToFailures(checkpoint: CheckpointState, maxFailures = 5): boolean {
    if (checkpoint.consecutiveFailures < maxFailures) {
      return false;
    }

    // Auto-reset if last run was over 1 hour ago
    const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
    if (checkpoint.lastRunAt) {
      const timeSinceLastRun = Date.now() - checkpoint.lastRunAt.getTime();
      if (timeSinceLastRun >= COOLDOWN_MS) {
        return false; // Allow retry — the caller will reset failures on success
      }
    }

    return true;
  }

  /**
   * Reset failure count and clear stuck catch-up cursor so a thread
   * can start fresh from the latest page.
   */
  async resetFailures(threadId: string): Promise<void> {
    await db.update(checkpoints)
      .set({
        consecutiveFailures: 0,
        catchUpCursor: null,
        updatedAt: new Date(),
      })
      .where(eq(checkpoints.threadId, threadId));
  }
}

// Singleton instance
export const checkpointManager = new CheckpointManager();
