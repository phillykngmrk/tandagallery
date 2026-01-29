import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { sources, threads, ingestRuns, mediaItems, users, comments, reports, blockedMedia, moderationActions } from '@aggragif/db/schema';
import { eq, desc, and, isNull, sql, count, gte, lte } from 'drizzle-orm';
import { getProxyUrls } from '../../lib/proxy-urls.js';
import { isR2Enabled, downloadAndUploadToR2 } from '../../lib/r2.js';
import { buildSourceHeaders, safeFetchMedia, isAllowedUrl } from '../../lib/media-fetcher.js';
import {
  getQueueStats,
  triggerIngestionNow,
  triggerThreadIngestion,
  pauseIngestion,
  resumeIngestion,
} from '../../queue/scheduler.js';
import { getCircuitBreakerStates } from '../../resilience/circuit-breaker.js';
import { getRateLimiterStates, globalConcurrencyLimiter } from '../../resilience/rate-limiter.js';

/**
 * Admin routes for managing ingestion and moderation
 * All routes require admin role
 */
export async function adminRoutes(app: FastifyInstance) {
  // Auth middleware - require admin role
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const user = request.user as { role?: string };
      if (user.role !== 'admin') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Admin access required',
        });
      }
    } catch {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }
  });

  // =========================================================================
  // DASHBOARD
  // =========================================================================

  /**
   * GET /admin/dashboard/stats
   * Get overview stats for the admin dashboard
   */
  app.get('/dashboard/stats', async () => {
    const [
      mediaCount,
      userCount,
      commentCount,
      pendingReportCount,
      activeJobs,
      lastRun,
    ] = await Promise.all([
      db.select({ count: count() }).from(mediaItems).where(isNull(mediaItems.deletedAt)),
      db.select({ count: count() }).from(users).where(isNull(users.deletedAt)),
      db.select({ count: count() }).from(comments).where(isNull(comments.deletedAt)),
      db.select({ count: count() }).from(reports).where(eq(reports.status, 'pending')),
      db.select({ count: count() }).from(ingestRuns).where(eq(ingestRuns.status, 'running')),
      db.query.ingestRuns.findFirst({
        orderBy: [desc(ingestRuns.startedAt)],
        columns: { startedAt: true },
      }),
    ]);

    return {
      totalMedia: mediaCount[0]?.count ?? 0,
      totalUsers: userCount[0]?.count ?? 0,
      totalComments: commentCount[0]?.count ?? 0,
      pendingReports: pendingReportCount[0]?.count ?? 0,
      activeIngestionJobs: activeJobs[0]?.count ?? 0,
      lastIngestionRun: lastRun?.startedAt?.toISOString() ?? null,
    };
  });

  // =========================================================================
  // INGESTION STATUS
  // =========================================================================

  /**
   * GET /admin/ingestion/status
   * Get overall ingestion status and queue stats
   */
  app.get('/ingestion/status', async () => {
    const [queueStats, sources_count, threads_count, recent_runs] = await Promise.all([
      getQueueStats(),
      db.select().from(sources).where(eq(sources.enabled, true)),
      db.select().from(threads).where(eq(threads.enabled, true)),
      db.query.ingestRuns.findMany({
        orderBy: [desc(ingestRuns.startedAt)],
        limit: 10,
        with: {
          thread: { columns: { externalId: true } },
          source: { columns: { name: true } },
        },
      }),
    ]);

    return {
      queues: queueStats,
      circuitBreakers: getCircuitBreakerStates(),
      rateLimiters: getRateLimiterStates(),
      concurrency: {
        active: globalConcurrencyLimiter.getActive(),
        waiting: globalConcurrencyLimiter.getWaiting(),
      },
      counts: {
        enabledSources: sources_count.length,
        enabledThreads: threads_count.length,
      },
      recentRuns: recent_runs.map(run => ({
        id: run.id,
        source: run.source?.name,
        thread: run.thread?.externalId,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        itemsNew: run.itemsNew,
        itemsFailed: run.itemsFailed,
        error: run.errorSummary,
      })),
    };
  });

  // =========================================================================
  // SOURCES MANAGEMENT
  // =========================================================================

  /**
   * GET /admin/ingestion/sources
   * List all sources
   */
  app.get('/ingestion/sources', async () => {
    const allSources = await db.query.sources.findMany({
      where: isNull(sources.deletedAt),
      with: {
        threads: {
          where: isNull(threads.deletedAt),
          columns: { id: true, enabled: true },
        },
      },
    });

    return allSources.map(s => ({
      id: s.id,
      name: s.name,
      baseUrl: s.baseUrl,
      mode: s.mode,
      enabled: s.enabled,
      threadCount: s.threads.length,
      enabledThreadCount: s.threads.filter(t => t.enabled).length,
      rateLimitConfig: s.rateLimitConfig,
      scraperConfig: s.scraperConfig,
      createdAt: s.createdAt,
    }));
  });

  /**
   * POST /admin/ingestion/sources
   * Create a new source
   */
  const scraperConfigSchema = z.object({
    selectors: z.object({
      itemContainer: z.string(),
      item: z.string(),
      itemId: z.union([z.string(), z.object({ attr: z.string(), selector: z.string().optional() })]),
      permalink: z.union([z.string(), z.object({ attr: z.string(), selector: z.string().optional() })]),
      timestamp: z.union([z.string(), z.object({ attr: z.string(), selector: z.string().optional(), format: z.string().optional() })]),
      author: z.union([z.string(), z.object({ attr: z.string(), selector: z.string().optional() })]),
      authorUrl: z.union([z.string(), z.object({ attr: z.string() })]).optional(),
      title: z.string().optional(),
      caption: z.string().optional(),
      media: z.union([z.string(), z.object({ attr: z.string() })]),
      mediaUrlAttr: z.string().optional(),
      thumbnail: z.union([z.string(), z.object({ attr: z.string() })]).optional(),
      width: z.union([z.string(), z.object({ attr: z.string() })]).optional(),
      height: z.union([z.string(), z.object({ attr: z.string() })]).optional(),
      duration: z.union([z.string(), z.object({ attr: z.string() })]).optional(),
      tags: z.string().optional(),
      currentPage: z.union([z.string(), z.object({ attr: z.string() })]).optional(),
      totalPages: z.union([z.string(), z.object({ attr: z.string() })]).optional(),
      nextPage: z.string().optional(),
      lastPage: z.union([z.string(), z.object({ attr: z.string() })]).optional(),
    }),
    urlPattern: z.object({
      basePath: z.string(),
      pageStyle: z.enum(['query', 'path', 'offset']),
      pageParam: z.string().optional(),
      pathFormat: z.string().optional(),
      itemsPerPage: z.number().optional(),
    }),
    dateFormat: z.string().optional(),
    newestFirst: z.boolean().optional(),
    headers: z.record(z.string()).optional(),
  }).optional();

  const createSourceSchema = z.object({
    name: z.string().min(1).max(255),
    baseUrl: z.string().url(),
    mode: z.string().default('generic-html'),
    rateLimitConfig: z.object({
      requestsPerMinute: z.number().min(1).max(600).default(30),
      burstSize: z.number().optional(),
      crawlDelay: z.number().optional(),
    }).optional(),
    scraperConfig: scraperConfigSchema,
    userAgent: z.string().optional(),
    enabled: z.boolean().default(true),
  });

  app.post('/ingestion/sources', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createSourceSchema.parse(request.body);

    const [source] = await db.insert(sources).values({
      name: body.name,
      baseUrl: body.baseUrl,
      mode: body.mode,
      rateLimitConfig: body.rateLimitConfig || { requestsPerMinute: 30 },
      scraperConfig: body.scraperConfig,
      userAgent: body.userAgent,
      enabled: body.enabled,
    }).returning();

    return reply.status(201).send(source);
  });

  /**
   * PATCH /admin/ingestion/sources/:id
   * Update a source
   */
  app.patch('/ingestion/sources/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = createSourceSchema.partial().parse(request.body);

    const [source] = await db.update(sources)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, id))
      .returning();

    if (!source) {
      return reply.status(404).send({ error: 'Not Found', message: 'Source not found' });
    }

    return source;
  });

  /**
   * DELETE /admin/ingestion/sources/:id
   * Soft delete a source
   */
  app.delete('/ingestion/sources/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    await db.update(sources)
      .set({ deletedAt: new Date(), enabled: false })
      .where(eq(sources.id, id));

    return { success: true };
  });

  // =========================================================================
  // THREADS MANAGEMENT
  // =========================================================================

  /**
   * GET /admin/ingestion/threads
   * List all threads (optionally filtered by source)
   */
  app.get('/ingestion/threads', async (request: FastifyRequest) => {
    const { sourceId } = request.query as { sourceId?: string };

    const conditions = [isNull(threads.deletedAt)];
    if (sourceId) {
      conditions.push(eq(threads.sourceId, sourceId));
    }

    const allThreads = await db.query.threads.findMany({
      where: and(...conditions),
      with: {
        source: { columns: { name: true } },
        checkpoint: true,
      },
    });

    return allThreads.map(t => ({
      id: t.id,
      sourceId: t.sourceId,
      sourceName: t.source?.name,
      externalId: t.externalId,
      url: t.url,
      displayName: t.displayName,
      enabled: t.enabled,
      priority: t.priority,
      checkpoint: t.checkpoint ? {
        lastSeenItemId: t.checkpoint.lastSeenItemId,
        lastRunAt: t.checkpoint.lastRunAt,
        lastSuccessAt: t.checkpoint.lastSuccessAt,
        consecutiveFailures: t.checkpoint.consecutiveFailures,
        hasCatchUpCursor: !!t.checkpoint.catchUpCursor,
      } : null,
      createdAt: t.createdAt,
    }));
  });

  /**
   * POST /admin/ingestion/threads
   * Create a new thread
   */
  const createThreadSchema = z.object({
    sourceId: z.string().uuid(),
    externalId: z.string().min(1).max(512),
    url: z.string().url(),
    displayName: z.string().optional(),
    enabled: z.boolean().default(true),
    priority: z.number().min(0).max(10).default(0),
  });

  app.post('/ingestion/threads', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createThreadSchema.parse(request.body);

    const [thread] = await db.insert(threads).values({
      sourceId: body.sourceId,
      externalId: body.externalId,
      url: body.url,
      displayName: body.displayName,
      enabled: body.enabled,
      priority: body.priority,
    }).returning();

    return reply.status(201).send(thread);
  });

  /**
   * PATCH /admin/ingestion/threads/:id
   * Update a thread
   */
  app.patch('/ingestion/threads/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = createThreadSchema.partial().parse(request.body);

    const [thread] = await db.update(threads)
      .set({
        ...body,
        updatedAt: new Date(),
      })
      .where(eq(threads.id, id))
      .returning();

    if (!thread) {
      return reply.status(404).send({ error: 'Not Found', message: 'Thread not found' });
    }

    return thread;
  });

  /**
   * DELETE /admin/ingestion/threads/:id
   * Soft delete a thread
   */
  app.delete('/ingestion/threads/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    await db.update(threads)
      .set({ deletedAt: new Date(), enabled: false })
      .where(eq(threads.id, id));

    return { success: true };
  });

  // =========================================================================
  // INGESTION CONTROL
  // =========================================================================

  /**
   * POST /admin/ingestion/trigger
   * Trigger immediate ingestion for all threads
   */
  app.post('/ingestion/trigger', async () => {
    await triggerIngestionNow();
    return { success: true, message: 'Ingestion triggered for all enabled threads' };
  });

  /**
   * POST /admin/ingestion/trigger/:threadId
   * Trigger immediate ingestion for a specific thread
   */
  app.post('/ingestion/trigger/:threadId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { threadId } = request.params as { threadId: string };

    try {
      await triggerThreadIngestion(threadId);
      return { success: true, message: `Ingestion triggered for thread ${threadId}` };
    } catch (error) {
      return reply.status(404).send({
        error: 'Not Found',
        message: error instanceof Error ? error.message : 'Thread not found',
      });
    }
  });

  /**
   * POST /admin/ingestion/pause
   * Pause all ingestion
   */
  app.post('/ingestion/pause', async () => {
    await pauseIngestion();
    return { success: true, message: 'Ingestion paused' };
  });

  /**
   * POST /admin/ingestion/resume
   * Resume ingestion
   */
  app.post('/ingestion/resume', async () => {
    await resumeIngestion();
    return { success: true, message: 'Ingestion resumed' };
  });

  // =========================================================================
  // INGEST RUNS HISTORY
  // =========================================================================

  /**
   * GET /admin/ingestion/runs
   * Get ingestion run history
   */
  app.get('/ingestion/runs', async (request: FastifyRequest) => {
    const { threadId, status, limit = '50' } = request.query as {
      threadId?: string;
      status?: string;
      limit?: string;
    };

    const conditions = [];
    if (threadId) conditions.push(eq(ingestRuns.threadId, threadId));
    if (status) conditions.push(eq(ingestRuns.status, status));

    const runs = await db.query.ingestRuns.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(ingestRuns.startedAt)],
      limit: Math.min(parseInt(limit, 10), 200),
      with: {
        thread: { columns: { externalId: true, displayName: true } },
        source: { columns: { name: true } },
      },
    });

    return runs.map(run => ({
      id: run.id,
      source: run.source?.name,
      thread: run.thread?.displayName || run.thread?.externalId,
      threadId: run.threadId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      pagesScanned: run.pagesScanned,
      itemsFound: run.itemsFound,
      itemsNew: run.itemsNew,
      itemsDuplicate: run.itemsDuplicate,
      itemsFailed: run.itemsFailed,
      error: run.errorSummary,
    }));
  });

  // =========================================================================
  // RUN MEDIA PREVIEW
  // =========================================================================

  /**
   * GET /admin/ingestion/runs/:runId/media
   * Get media items ingested during a specific run
   */
  app.get('/ingestion/runs/:runId/media', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };

    // Get the run to find threadId and time range
    const run = await db.query.ingestRuns.findFirst({
      where: eq(ingestRuns.id, runId),
    });

    if (!run) {
      return reply.status(404).send({ error: 'Not Found', message: 'Run not found' });
    }

    if (!run.threadId) {
      return { items: [] };
    }

    // Query media items created during this run's time window
    const conditions = [
      eq(mediaItems.threadId, run.threadId),
      gte(mediaItems.createdAt, run.startedAt),
      isNull(mediaItems.deletedAt),
    ];

    if (run.finishedAt) {
      // Add a 5-second buffer after finishedAt for items committed near the end
      const bufferEnd = new Date(run.finishedAt.getTime() + 5000);
      conditions.push(lte(mediaItems.createdAt, bufferEnd));
    }

    const items = await db.select()
      .from(mediaItems)
      .where(and(...conditions))
      .orderBy(desc(mediaItems.createdAt))
      .limit(100);

    return {
      items: items.map(item => {
        const urls = getProxyUrls(item.id, item.mediaUrls as { original: string; thumbnail?: string });
        return {
          id: item.id,
          externalItemId: item.externalItemId,
          title: item.title,
          mediaType: item.mediaType,
          mediaUrl: urls.mediaUrl,
          thumbnailUrl: urls.thumbnailUrl,
          width: item.width,
          height: item.height,
          postedAt: item.postedAt,
          isHidden: item.isHidden,
        };
      }),
    };
  });

  // =========================================================================
  // MEDIA MANAGEMENT
  // =========================================================================

  /**
   * DELETE /admin/media/:id
   * Soft-delete a media item and block it from re-ingestion
   */
  app.delete('/media/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string };

    // Find the media item
    const item = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, id),
    });

    if (!item) {
      return reply.status(404).send({ error: 'Not Found', message: 'Media item not found' });
    }

    // Soft-delete the media item
    await db.update(mediaItems)
      .set({
        deletedAt: new Date(),
        isHidden: true,
        hiddenReason: 'admin_removed',
        hiddenAt: new Date(),
        hiddenBy: user.sub,
      })
      .where(eq(mediaItems.id, id));

    // Add to blocklist to prevent re-ingestion
    await db.insert(blockedMedia)
      .values({
        threadId: item.threadId,
        externalItemId: item.externalItemId,
        fingerprint: item.fingerprint,
        reason: 'admin_removed',
        blockedBy: user.sub,
      })
      .onConflictDoNothing();

    // Audit log
    await db.insert(moderationActions)
      .values({
        moderatorId: user.sub,
        targetType: 'media_item',
        targetId: id,
        action: 'remove',
        reason: 'admin_removed',
        previousState: { isHidden: item.isHidden, deletedAt: item.deletedAt },
        newState: { isHidden: true, deletedAt: new Date() },
      });

    return { success: true };
  });

  /**
   * GET /admin/media
   * List media items for moderation (with pagination)
   */
  app.get('/media', async (request: FastifyRequest) => {
    const { cursor, limit = '50', search } = request.query as {
      cursor?: string;
      limit?: string;
      search?: string;
    };

    const pageLimit = Math.min(parseInt(limit, 10), 100);
    const conditions = [isNull(mediaItems.deletedAt)];

    if (cursor) {
      conditions.push(lte(mediaItems.createdAt, new Date(cursor)));
    }

    const items = await db.select({
      id: mediaItems.id,
      title: mediaItems.title,
      mediaType: mediaItems.mediaType,
      mediaUrls: mediaItems.mediaUrls,
      width: mediaItems.width,
      height: mediaItems.height,
      postedAt: mediaItems.postedAt,
      createdAt: mediaItems.createdAt,
      isHidden: mediaItems.isHidden,
      author: mediaItems.author,
      threadId: mediaItems.threadId,
    })
      .from(mediaItems)
      .where(and(...conditions))
      .orderBy(desc(mediaItems.createdAt))
      .limit(pageLimit + 1);

    const hasMore = items.length > pageLimit;
    const pageItems = hasMore ? items.slice(0, pageLimit) : items;

    return {
      items: pageItems.map(item => {
        const urls = getProxyUrls(item.id, item.mediaUrls as { original: string; thumbnail?: string });
        return {
          id: item.id,
          title: item.title,
          mediaType: item.mediaType,
          mediaUrl: urls.mediaUrl,
          thumbnailUrl: urls.thumbnailUrl,
          width: item.width,
          height: item.height,
          postedAt: item.postedAt,
          createdAt: item.createdAt,
          isHidden: item.isHidden,
          author: item.author,
        };
      }),
      pagination: {
        hasMore,
        nextCursor: hasMore && pageItems.length > 0
          ? pageItems[pageItems.length - 1]!.createdAt.toISOString()
          : null,
      },
    };
  });

  // ── R2 cache backfill ─────────────────────────────────────────────
  // POST /admin/backfill-r2
  // Downloads uncached media and uploads to R2 in batches.
  // Runs in background — returns immediately.
  let backfillRunning = false;

  app.post('/backfill-r2', async (request, reply) => {
    if (!isR2Enabled()) {
      return reply.status(400).send({ error: 'R2 not configured' });
    }
    if (backfillRunning) {
      return reply.status(409).send({ error: 'Backfill already running' });
    }

    backfillRunning = true;
    const BATCH = 50;
    const CONCURRENCY = 5;
    let processed = 0;
    let cached = 0;
    let failed = 0;

    // Run in background
    (async () => {
      try {
        let offset = 0;
        while (true) {
          const items = await db.query.mediaItems.findMany({
            where: (m, { and, isNull }) => and(
              isNull(m.deletedAt),
              sql`NOT (${m.mediaUrls}::jsonb ? 'cdnOriginal')`,
            ),
            columns: { id: true, mediaUrls: true },
            with: {
              thread: {
                columns: { sourceId: true },
                with: { source: { columns: { id: true, scraperConfig: true } } },
              },
            },
            limit: BATCH,
          });

          if (items.length === 0) break;

          // Process in chunks of CONCURRENCY
          for (let i = 0; i < items.length; i += CONCURRENCY) {
            const chunk = items.slice(i, i + CONCURRENCY);
            await Promise.allSettled(chunk.map(async (item) => {
              const urls = item.mediaUrls as { original: string; thumbnail?: string };
              const sc = item.thread?.source?.scraperConfig as { headers?: Record<string, string> } | null;

              const cdnUpdates: Record<string, string> = {};

              // Original
              if (urls.original && isAllowedUrl(urls.original)) {
                const headers = buildSourceHeaders(urls.original, sc);
                const cdnUrl = await downloadAndUploadToR2(
                  item.id, 'original', urls.original,
                  (url) => safeFetchMedia(url, headers),
                );
                if (cdnUrl) cdnUpdates.cdnOriginal = cdnUrl;
              }

              // Thumbnail
              if (urls.thumbnail && isAllowedUrl(urls.thumbnail)) {
                const headers = buildSourceHeaders(urls.thumbnail, sc);
                const cdnUrl = await downloadAndUploadToR2(
                  item.id, 'thumb', urls.thumbnail,
                  (url) => safeFetchMedia(url, headers),
                );
                if (cdnUrl) cdnUpdates.cdnThumbnail = cdnUrl;
              }

              if (Object.keys(cdnUpdates).length > 0) {
                await db.update(mediaItems)
                  .set({ mediaUrls: sql`${mediaItems.mediaUrls} || ${JSON.stringify(cdnUpdates)}::jsonb` })
                  .where(eq(mediaItems.id, item.id))
                  .execute();
                cached++;
              } else {
                failed++;
              }
              processed++;
            }));
          }

          console.log(`[Backfill] Progress: ${processed} processed, ${cached} cached, ${failed} failed`);
        }

        console.log(`[Backfill] Done: ${processed} processed, ${cached} cached, ${failed} failed`);
      } catch (err) {
        console.error('[Backfill] Error:', err);
      } finally {
        backfillRunning = false;
      }
    })();

    return { status: 'started', message: 'R2 backfill started in background' };
  });

  app.get('/backfill-r2/status', async () => {
    const [result] = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE media_urls::text LIKE '%cdnOriginal%') AS cached
      FROM media_items WHERE deleted_at IS NULL
    `);
    return {
      running: backfillRunning,
      total: Number(result.total),
      cached: Number(result.cached),
      uncached: Number(result.total) - Number(result.cached),
    };
  });
}
