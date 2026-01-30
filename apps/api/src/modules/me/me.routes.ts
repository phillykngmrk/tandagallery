import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/db.js';
import { likes } from '@aggragif/db/schema';
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
            isLiked: true,
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
