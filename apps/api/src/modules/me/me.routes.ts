import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/db.js';
import { likes, favorites, mediaItems } from '@aggragif/db/schema';
import { eq, and, isNull, desc, lt } from 'drizzle-orm';
import { getProxyUrls } from '../../lib/proxy-urls.js';

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

export async function meRoutes(app: FastifyInstance) {
  // All /me routes require authentication
  app.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }
  });

  // GET /me/likes — paginated list of items the user has liked
  app.get('/likes', async (request: FastifyRequest) => {
    const userId = (request.user as { sub: string }).sub;
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit || '24', 10), 100);

    const cursorData = query.cursor
      ? decodeCursor<{ createdAt: string }>(query.cursor)
      : null;

    const userLikes = await db.query.likes.findMany({
      where: (l, { and, eq, lt: ltOp }) => and(
        eq(l.userId, userId),
        cursorData
          ? ltOp(l.createdAt, new Date(cursorData.createdAt))
          : undefined,
      ),
      orderBy: (l, { desc }) => [desc(l.createdAt)],
      limit: limit + 1,
      with: {
        mediaItem: true,
      },
    });

    const hasMore = userLikes.length > limit;
    const resultLikes = hasMore ? userLikes.slice(0, -1) : userLikes;

    const lastLike = resultLikes[resultLikes.length - 1];
    const nextCursor = hasMore && lastLike
      ? encodeCursor({ createdAt: lastLike.createdAt.toISOString() })
      : null;

    // Build user's favorite set for these items
    const itemIds = resultLikes.map(l => l.mediaItemId);
    let userFavorites: Set<string> = new Set();
    if (itemIds.length > 0) {
      const favResults = await db.query.favorites.findMany({
        where: (f, { and, eq, inArray }) => and(
          eq(f.userId, userId),
          inArray(f.mediaItemId, itemIds),
        ),
        columns: { mediaItemId: true },
      });
      userFavorites = new Set(favResults.map(f => f.mediaItemId));
    }

    return {
      items: resultLikes
        .filter(l => l.mediaItem && !l.mediaItem.isHidden && !l.mediaItem.deletedAt)
        .map(l => {
          const item = l.mediaItem!;
          return {
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
            isLiked: true, // They're in the likes list
            isFavorited: userFavorites.has(item.id),
            tags: (item.tags as string[]) || [],
          };
        }),
      pagination: {
        nextCursor,
        hasMore,
      },
    };
  });

  // GET /me/favorites — paginated list of items the user has favorited
  app.get('/favorites', async (request: FastifyRequest) => {
    const userId = (request.user as { sub: string }).sub;
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit || '24', 10), 100);

    const cursorData = query.cursor
      ? decodeCursor<{ createdAt: string }>(query.cursor)
      : null;

    const userFavs = await db.query.favorites.findMany({
      where: (f, { and, eq, lt: ltOp }) => and(
        eq(f.userId, userId),
        cursorData
          ? ltOp(f.createdAt, new Date(cursorData.createdAt))
          : undefined,
      ),
      orderBy: (f, { desc }) => [desc(f.createdAt)],
      limit: limit + 1,
      with: {
        mediaItem: true,
      },
    });

    const hasMore = userFavs.length > limit;
    const resultFavs = hasMore ? userFavs.slice(0, -1) : userFavs;

    const lastFav = resultFavs[resultFavs.length - 1];
    const nextCursor = hasMore && lastFav
      ? encodeCursor({ createdAt: lastFav.createdAt.toISOString() })
      : null;

    // Build user's likes set for these items
    const itemIds = resultFavs.map(f => f.mediaItemId);
    let userLikes: Set<string> = new Set();
    if (itemIds.length > 0) {
      const likeResults = await db.query.likes.findMany({
        where: (l, { and, eq, inArray }) => and(
          eq(l.userId, userId),
          inArray(l.mediaItemId, itemIds),
        ),
        columns: { mediaItemId: true },
      });
      userLikes = new Set(likeResults.map(l => l.mediaItemId));
    }

    return {
      items: resultFavs
        .filter(f => f.mediaItem && !f.mediaItem.isHidden && !f.mediaItem.deletedAt)
        .map(f => {
          const item = f.mediaItem!;
          return {
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
            isLiked: userLikes.has(item.id),
            isFavorited: true, // They're in the favorites list
            tags: (item.tags as string[]) || [],
          };
        }),
      pagination: {
        nextCursor,
        hasMore,
      },
    };
  });
}
