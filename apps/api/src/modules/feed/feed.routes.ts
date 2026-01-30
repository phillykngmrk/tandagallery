import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { feedQuerySchema, paginationSchema } from '@aggragif/shared';
import { db } from '../../lib/db.js';
import { mediaItems, likes } from '@aggragif/db/schema';
import { desc, eq, and, isNull, gte, sql } from 'drizzle-orm';
import { getProxyUrls } from '../../lib/proxy-urls.js';

// Cursor utilities
function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function decodeCursor<T>(cursor: string): T | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export async function feedRoutes(app: FastifyInstance) {
  // Optional auth: try to decode JWT but don't require it
  app.addHook('onRequest', async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      // Not authenticated — that's fine for public routes
    }
  });

  // Main feed (infinite scroll)
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = feedQuerySchema.parse(request.query);
    const userId = (request.user as { sub?: string } | undefined)?.sub;

    // Decode cursor
    const cursorData = query.cursor
      ? decodeCursor<{ id: string; createdAt: string }>(query.cursor)
      : null;

    // Build query — sorted by most recently ingested (createdAt)
    const items = await db.query.mediaItems.findMany({
      where: (m, { and, eq, isNull, lt }) => and(
        eq(m.isHidden, false),
        isNull(m.deletedAt),
        query.type ? eq(m.mediaType, query.type) : undefined,
        cursorData ? lt(m.createdAt, new Date(cursorData.createdAt)) : undefined,
        query.tag ? sql`${mediaItems.tags} @> ${JSON.stringify([query.tag])}::jsonb` : undefined,
      ),
      orderBy: (m, { desc }) => [desc(m.createdAt)],
      limit: query.limit + 1, // Fetch one extra to check hasMore
      columns: {
        id: true,
        mediaType: true,
        title: true,
        mediaUrls: true,
        durationMs: true,
        width: true,
        height: true,
        likeCount: true,
        commentCount: true,
        postedAt: true,
        createdAt: true,
        tags: true,
      },
    });

    // Check if there are more items
    const hasMore = items.length > query.limit;
    const resultItems = hasMore ? items.slice(0, -1) : items;

    // Get user's likes if authenticated
    let userLikes: Set<string> = new Set();

    if (userId && resultItems.length > 0) {
      const itemIds = resultItems.map(i => i.id);

      const likeResults = await db.query.likes.findMany({
        where: (l, { and, eq, inArray }) => and(
          eq(l.userId, userId),
          inArray(l.mediaItemId, itemIds),
        ),
        columns: { mediaItemId: true },
      });

      userLikes = new Set(likeResults.map(l => l.mediaItemId));
    }

    // Transform results
    const lastItem = resultItems[resultItems.length - 1];
    const nextCursor = hasMore && lastItem
      ? encodeCursor({ id: lastItem.id, createdAt: lastItem.createdAt?.toISOString() })
      : null;

    return {
      items: resultItems.map(item => ({
        id: item.id,
        type: item.mediaType,
        title: item.title,
        ...getProxyUrls(item.id, item.mediaUrls as { original: string; thumbnail?: string }),
        duration: item.durationMs ? Math.floor(item.durationMs / 1000) : null,
        width: item.width,
        height: item.height,
        likeCount: item.likeCount,
        commentCount: item.commentCount,
        publishedAt: item.postedAt?.toISOString() || null,
        isLiked: userId ? userLikes.has(item.id) : null,
        tags: (item.tags as string[]) || [],
      })),
      pagination: {
        nextCursor,
        hasMore,
      },
    };
  });

  // Tags listing
  app.get('/tags', async () => {
    const result = await db.execute(sql`
      SELECT jsonb_array_elements_text(tags) as tag, COUNT(*) as count
      FROM media_items
      WHERE is_hidden = false AND deleted_at IS NULL AND tags != '[]'::jsonb
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 200
    `);

    return {
      tags: result.rows.map((r: Record<string, unknown>) => ({
        name: r.tag as string,
        count: Number(r.count),
      })),
    };
  });

  // Most viewed feed with time period filter
  app.get('/trending', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = paginationSchema.parse(request.query);
    const { period = 'week' } = request.query as { period?: string };
    const userId = (request.user as { sub?: string } | undefined)?.sub;

    // Map period to date cutoff
    const periodMs: Record<string, number> = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };
    const cutoffMs = periodMs[period];
    const cutoffDate = cutoffMs ? new Date(Date.now() - cutoffMs) : undefined;

    const conditions = [
      eq(mediaItems.isHidden, false),
      isNull(mediaItems.deletedAt),
    ];
    if (cutoffDate) {
      conditions.push(gte(mediaItems.postedAt, cutoffDate));
    }

    // Use offset-based pagination for view-sorted results
    const offset = query.cursor ? parseInt(query.cursor, 10) : 0;

    const items = await db.query.mediaItems.findMany({
      where: and(...conditions),
      orderBy: (m, { desc }) => [desc(m.likeCount), desc(m.postedAt)],
      limit: query.limit + 1,
      offset,
      columns: {
        id: true,
        mediaType: true,
        title: true,
        mediaUrls: true,
        durationMs: true,
        width: true,
        height: true,
        likeCount: true,
        commentCount: true,
        viewCount: true,
        postedAt: true,
        tags: true,
      },
    });

    const hasMore = items.length > query.limit;
    const resultItems = hasMore ? items.slice(0, -1) : items;

    // Get user's likes
    let userLikes: Set<string> = new Set();

    if (userId && resultItems.length > 0) {
      const itemIds = resultItems.map(i => i.id);

      const likeResults = await db.query.likes.findMany({
        where: (l, { and: a, eq: e, inArray }) => a(
          e(l.userId, userId),
          inArray(l.mediaItemId, itemIds),
        ),
        columns: { mediaItemId: true },
      });

      userLikes = new Set(likeResults.map(l => l.mediaItemId));
    }

    const nextOffset = offset + query.limit;

    return {
      items: resultItems.map(item => ({
        id: item.id,
        type: item.mediaType,
        title: item.title,
        ...getProxyUrls(item.id, item.mediaUrls as { original: string; thumbnail?: string }),
        duration: item.durationMs ? Math.floor(item.durationMs / 1000) : null,
        width: item.width,
        height: item.height,
        likeCount: item.likeCount,
        commentCount: item.commentCount,
        viewCount: item.viewCount,
        publishedAt: item.postedAt?.toISOString() || null,
        isLiked: userId ? userLikes.has(item.id) : null,
        tags: (item.tags as string[]) || [],
      })),
      pagination: {
        nextCursor: hasMore ? String(nextOffset) : null,
        hasMore,
      },
    };
  });

  // Search
  app.get('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { q?: string; type?: string; cursor?: string; limit?: number };
    const searchQuery = query.q?.trim();

    if (!searchQuery) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Search query is required',
      });
    }

    const limit = Math.min(Math.max(query.limit || 20, 1), 50);

    // Simple search on title and caption
    const items = await db.query.mediaItems.findMany({
      where: (m, { and, eq, isNull, or, ilike }) => and(
        eq(m.isHidden, false),
        isNull(m.deletedAt),
        query.type ? eq(m.mediaType, query.type) : undefined,
        or(
          ilike(m.title, `%${searchQuery}%`),
          ilike(m.caption, `%${searchQuery}%`),
        ),
      ),
      orderBy: (m, { desc }) => [desc(m.likeCount), desc(m.postedAt)],
      limit: limit + 1,
      columns: {
        id: true,
        mediaType: true,
        title: true,
        mediaUrls: true,
        durationMs: true,
        width: true,
        height: true,
        likeCount: true,
        commentCount: true,
        postedAt: true,
      },
    });

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, -1) : items;

    return {
      items: resultItems.map(item => ({
        id: item.id,
        type: item.mediaType,
        title: item.title,
        ...getProxyUrls(item.id, item.mediaUrls as { original: string; thumbnail?: string }),
        duration: item.durationMs ? Math.floor(item.durationMs / 1000) : null,
        width: item.width,
        height: item.height,
        likeCount: item.likeCount,
        commentCount: item.commentCount,
        publishedAt: item.postedAt?.toISOString() || null,
        isLiked: null,
      })),
      pagination: {
        nextCursor: null,
        hasMore,
      },
    };
  });
}
