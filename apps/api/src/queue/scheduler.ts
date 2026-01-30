import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { redis } from '../lib/redis.js';
import { db } from '../lib/db.js';
import { sources, threads } from '@aggragif/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { IncrementalScanner } from '../core/incremental-scanner.js';
import { getAdapter, type SourceConfig } from '../adapters/base-adapter.js';
import { getCircuitBreaker } from '../resilience/circuit-breaker.js';
import { getRateLimiter, fromRequestsPerMinute, globalConcurrencyLimiter } from '../resilience/rate-limiter.js';

// Import adapters to register them
import '../adapters/generic-html-adapter.js';
import '../adapters/redgifs-adapter.js';
import '../adapters/reddit-adapter.js';

/**
 * Job data for ingestion tasks
 */
interface IngestionJobData {
  threadId: string;
  sourceId: string;
  sourceName: string;
  baseUrl: string;
  threadUrl: string;
  externalId: string;
  rateLimitConfig: {
    requestsPerMinute: number;
    burstSize?: number;
    crawlDelay?: number;
  };
  userAgent?: string;
  adapterConfig?: Record<string, unknown>;
  priority?: number;
  isCatchUp?: boolean;
}

/**
 * Job result from ingestion
 */
interface IngestionJobResult {
  threadId: string;
  status: string;
  pagesScanned: number;
  itemsNew: number;
  itemsDuplicate: number;
  itemsFailed: number;
  error?: string;
  durationMs: number;
}

// Queue names
const INGESTION_QUEUE = 'ingestion';
const SCHEDULER_QUEUE = 'scheduler';

// Queue instances
let ingestionQueue: Queue<IngestionJobData, IngestionJobResult>;
let schedulerQueue: Queue;
let ingestionWorker: Worker<IngestionJobData, IngestionJobResult>;
let schedulerWorker: Worker;
let queueEvents: QueueEvents;

/**
 * Initialize the job queues and workers
 */
export async function initializeQueues(): Promise<void> {
  // Create queues
  ingestionQueue = new Queue<IngestionJobData, IngestionJobResult>(INGESTION_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30000, // Start with 30s, then 60s, 120s
      },
      removeOnComplete: {
        count: 1000, // Keep last 1000 completed jobs
        age: 24 * 60 * 60, // Or 24 hours
      },
      removeOnFail: {
        count: 500, // Keep last 500 failed jobs
        age: 7 * 24 * 60 * 60, // Or 7 days
      },
    },
  });

  schedulerQueue = new Queue(SCHEDULER_QUEUE, {
    connection: redis,
  });

  // Create queue events for monitoring
  queueEvents = new QueueEvents(INGESTION_QUEUE, { connection: redis });

  // Create ingestion worker
  ingestionWorker = new Worker<IngestionJobData, IngestionJobResult>(
    INGESTION_QUEUE,
    processIngestionJob,
    {
      connection: redis,
      concurrency: 5, // Process 5 jobs concurrently
      limiter: {
        max: 10, // Max 10 jobs per interval
        duration: 60000, // Per minute
      },
    },
  );

  // Create scheduler worker
  schedulerWorker = new Worker(
    SCHEDULER_QUEUE,
    processSchedulerJob,
    {
      connection: redis,
      concurrency: 1,
    },
  );

  // Set up event handlers
  setupEventHandlers();

  // Schedule the main polling job
  await schedulePolling();

  console.log('Job queues initialized');
}

/**
 * Process an ingestion job
 */
async function processIngestionJob(
  job: Job<IngestionJobData, IngestionJobResult>,
): Promise<IngestionJobResult> {
  const startTime = Date.now();
  const { threadId, sourceId, sourceName, baseUrl, threadUrl, externalId, rateLimitConfig, userAgent, adapterConfig } = job.data;

  console.log(`[Ingestion] Starting job for thread ${threadId} (${externalId})`);

  try {
    // Check circuit breaker
    const circuitBreaker = getCircuitBreaker(sourceId);
    if (!circuitBreaker.isAllowed()) {
      return {
        threadId,
        status: 'circuit_open',
        pagesScanned: 0,
        itemsNew: 0,
        itemsDuplicate: 0,
        itemsFailed: 0,
        error: 'Circuit breaker is open',
        durationMs: Date.now() - startTime,
      };
    }

    // Get rate limiter
    const rateLimiter = getRateLimiter(sourceId, fromRequestsPerMinute(
      rateLimitConfig.requestsPerMinute,
      rateLimitConfig.burstSize,
    ));

    // Build adapter config
    const config: SourceConfig = {
      sourceId,
      threadId,
      baseUrl,
      threadUrl,
      externalId,
      rateLimit: rateLimitConfig,
      userAgent,
      extra: adapterConfig,
    };

    // Get adapter
    const adapter = getAdapter(sourceName, config);
    if (!adapter) {
      throw new Error(`No adapter found for source type: ${sourceName}`);
    }

    // Validate adapter
    const validation = await adapter.validate();
    if (!validation.valid) {
      throw new Error(`Adapter validation failed: ${validation.error}`);
    }

    // Run scan with circuit breaker and rate limiter protection
    const result = await circuitBreaker.execute(async () => {
      return globalConcurrencyLimiter.execute(async () => {
        const scanner = new IncrementalScanner();
        return scanner.scan(threadId, sourceId, adapter);
      });
    });

    console.log(`[Ingestion] Completed job for thread ${threadId}: ${result.status}, ${result.itemsNew} new items`);

    // Schedule catch-up job if partial
    if (result.status === 'partial' && result.resumePage) {
      await scheduleCatchUpJob(job.data, result.resumePage);
    }

    return {
      threadId,
      status: result.status,
      pagesScanned: result.pagesScanned,
      itemsNew: result.itemsNew,
      itemsDuplicate: result.itemsDuplicate,
      itemsFailed: result.itemsFailed,
      error: result.error,
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Ingestion] Job failed for thread ${threadId}:`, errorMessage);

    return {
      threadId,
      status: 'failed',
      pagesScanned: 0,
      itemsNew: 0,
      itemsDuplicate: 0,
      itemsFailed: 0,
      error: errorMessage,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Process the scheduler job (triggers ingestion for all enabled threads)
 */
async function processSchedulerJob(): Promise<void> {
  console.log('[Scheduler] Starting scheduled ingestion run');

  try {
    // Get all enabled threads with their sources
    const enabledThreads = await db.query.threads.findMany({
      where: and(
        eq(threads.enabled, true),
        isNull(threads.deletedAt),
      ),
      with: {
        source: true,
      },
      orderBy: (t, { desc }) => [desc(t.priority)],
    });

    if (enabledThreads.length === 0) {
      console.log('[Scheduler] No enabled threads found');
      return;
    }

    console.log(`[Scheduler] Queuing ${enabledThreads.length} threads for ingestion`);

    // Queue jobs for each thread
    for (const thread of enabledThreads) {
      const source = thread.source;
      if (!source || !source.enabled) continue;

      const jobData: IngestionJobData = {
        threadId: thread.id,
        sourceId: source.id,
        sourceName: source.mode, // 'scrape' or adapter name
        baseUrl: source.baseUrl,
        threadUrl: thread.url,
        externalId: thread.externalId,
        rateLimitConfig: source.rateLimitConfig as {
          requestsPerMinute: number;
          burstSize?: number;
          crawlDelay?: number;
        },
        userAgent: source.userAgent ?? undefined,
        priority: thread.priority,
        adapterConfig: source.scraperConfig as Record<string, unknown> | undefined,
      };

      await ingestionQueue.add(
        `ingest-${thread.id}`,
        jobData,
        {
          priority: 10 - (thread.priority || 0), // Higher priority = lower number
          jobId: `ingest-${thread.id}-${Date.now()}`, // Prevent duplicates
        },
      );
    }

    console.log('[Scheduler] All jobs queued');

  } catch (error) {
    console.error('[Scheduler] Failed to queue jobs:', error);
    throw error;
  }
}

/**
 * Schedule a catch-up job for partial runs
 */
async function scheduleCatchUpJob(data: IngestionJobData, resumePage: number): Promise<void> {
  await ingestionQueue.add(
    `catchup-${data.threadId}`,
    {
      ...data,
      isCatchUp: true,
    },
    {
      delay: 60000, // 1 minute delay
      priority: 5, // Higher priority than regular jobs
      jobId: `catchup-${data.threadId}-${Date.now()}`,
    },
  );
  console.log(`[Scheduler] Scheduled catch-up job for thread ${data.threadId} at page ${resumePage}`);
}

/**
 * Schedule the main polling job
 */
async function schedulePolling(): Promise<void> {
  // Remove existing scheduled jobs
  const repeatableJobs = await schedulerQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await schedulerQueue.removeRepeatableByKey(job.key);
  }

  // Schedule new polling job using configured interval
  const pollInterval = parseInt(process.env.INGEST_POLL_INTERVAL_MS || '600000', 10);
  await schedulerQueue.add(
    'poll-all',
    {},
    {
      repeat: {
        every: pollInterval,
      },
      jobId: 'poll-all',
    },
  );

  console.log(`[Scheduler] Polling scheduled every ${pollInterval / 60000} minutes`);
}

/**
 * Set up event handlers for monitoring
 */
function setupEventHandlers(): void {
  queueEvents.on('completed', ({ jobId, returnvalue }) => {
    try {
      const result = (typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue) as IngestionJobResult;
      if (result?.itemsNew && result.itemsNew > 0) {
        console.log(`[Queue] Job ${jobId} completed: ${result.itemsNew} new items`);
      }
    } catch {
      // Ignore parse errors
    }
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`[Queue] Job ${jobId} failed:`, failedReason);
  });

  queueEvents.on('stalled', ({ jobId }) => {
    console.warn(`[Queue] Job ${jobId} stalled`);
  });

  ingestionWorker.on('error', (error) => {
    console.error('[Worker] Ingestion worker error:', error);
  });

  schedulerWorker.on('error', (error) => {
    console.error('[Worker] Scheduler worker error:', error);
  });
}

/**
 * Trigger immediate ingestion for all threads
 */
export async function triggerIngestionNow(): Promise<void> {
  await schedulerQueue.add('poll-all-immediate', {}, { jobId: `poll-immediate-${Date.now()}` });
  console.log('[Scheduler] Triggered immediate ingestion');
}

/**
 * Trigger ingestion for a specific thread
 */
export async function triggerThreadIngestion(threadId: string): Promise<void> {
  const thread = await db.query.threads.findFirst({
    where: eq(threads.id, threadId),
    with: { source: true },
  });

  if (!thread || !thread.source) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const jobData: IngestionJobData = {
    threadId: thread.id,
    sourceId: thread.source.id,
    sourceName: thread.source.mode,
    baseUrl: thread.source.baseUrl,
    threadUrl: thread.url,
    externalId: thread.externalId,
    rateLimitConfig: thread.source.rateLimitConfig as {
      requestsPerMinute: number;
      burstSize?: number;
      crawlDelay?: number;
    },
    userAgent: thread.source.userAgent ?? undefined,
    priority: thread.priority,
    adapterConfig: thread.source.scraperConfig as Record<string, unknown> | undefined,
  };

  await ingestionQueue.add(
    `ingest-${thread.id}-manual`,
    jobData,
    {
      priority: 1, // Highest priority for manual triggers
      jobId: `ingest-${thread.id}-manual-${Date.now()}`,
    },
  );

  console.log(`[Scheduler] Triggered manual ingestion for thread ${threadId}`);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  ingestion: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  scheduler: {
    waiting: number;
    active: number;
  };
}> {
  const [ingestionStats, schedulerStats] = await Promise.all([
    ingestionQueue.getJobCounts(),
    schedulerQueue.getJobCounts(),
  ]);

  return {
    ingestion: {
      waiting: ingestionStats.waiting ?? 0,
      active: ingestionStats.active ?? 0,
      completed: ingestionStats.completed ?? 0,
      failed: ingestionStats.failed ?? 0,
      delayed: ingestionStats.delayed ?? 0,
    },
    scheduler: {
      waiting: schedulerStats.waiting ?? 0,
      active: schedulerStats.active ?? 0,
    },
  };
}

/**
 * Pause all ingestion
 */
export async function pauseIngestion(): Promise<void> {
  await ingestionQueue.pause();
  console.log('[Scheduler] Ingestion paused');
}

/**
 * Resume ingestion
 */
export async function resumeIngestion(): Promise<void> {
  await ingestionQueue.resume();
  console.log('[Scheduler] Ingestion resumed');
}

/**
 * Gracefully shutdown queues
 */
export async function shutdownQueues(): Promise<void> {
  console.log('[Scheduler] Shutting down queues...');

  await Promise.all([
    ingestionWorker?.close(),
    schedulerWorker?.close(),
    queueEvents?.close(),
    ingestionQueue?.close(),
    schedulerQueue?.close(),
  ]);

  console.log('[Scheduler] Queues shut down');
}
