import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/db.js';
import { mediaItems, likes, favorites, comments, sources } from '@aggragif/db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { getProxyUrls } from '../../lib/proxy-urls.js';

// In-memory cache for proxied images (URL -> {data, contentType, fetchedAt})
const proxyCache = new Map<string, { data: Buffer; contentType: string; fetchedAt: number }>();
const PROXY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function mediaRoutes(app: FastifyInstance) {
  /**
   * GET /media/proxy/:id
   * Proxy an image through the API with source authentication.
   * Fetches the full-size image using source cookies and streams it to the client.
   */
  app.get('/proxy/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { thumb?: string };
    const wantThumbnail = query.thumb === '1';

    // Look up media item with its source
    const item = await db.query.mediaItems.findFirst({
      where: (m, { and, eq, isNull }) => and(
        eq(m.id, id),
        isNull(m.deletedAt),
      ),
      columns: { id: true, mediaUrls: true },
      with: {
        thread: {
          columns: { sourceId: true },
          with: {
            source: {
              columns: { id: true, scraperConfig: true },
            },
          },
        },
      },
    });

    if (!item) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const mediaUrls = item.mediaUrls as { original: string; thumbnail?: string };
    const targetUrl = wantThumbnail
      ? (mediaUrls.thumbnail || mediaUrls.original)
      : mediaUrls.original;

    if (!targetUrl) {
      return reply.status(404).send({ error: 'No media URL' });
    }

    // Check cache
    const cacheKey = `${id}:${wantThumbnail ? 'thumb' : 'full'}`;
    const cached = proxyCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < PROXY_CACHE_TTL) {
      reply.header('Content-Type', cached.contentType);
      reply.header('Cache-Control', 'public, max-age=300');
      reply.header('X-Proxy-Cache', 'HIT');
      return reply.send(cached.data);
    }

    // Get source headers/cookies
    const scraperConfig = item.thread?.source?.scraperConfig as { headers?: Record<string, string> } | null;
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0',
      ...(scraperConfig?.headers || {}),
    };

    // Add Referer for RedGifs URLs
    if (targetUrl.includes('redgifs.com')) {
      headers['Referer'] = 'https://www.redgifs.com/';
      headers['Origin'] = 'https://www.redgifs.com';
    }

    const isVideo = targetUrl.endsWith('.mp4') || targetUrl.endsWith('.webm');

    // Validate URL to prevent SSRF — only allow known external hosts
    const ALLOWED_HOSTS = [
      'jpg6.su',
      'simp6.selti-delivery.ru',
      'redgifs.com',
      'thumbs4.redgifs.com',
      'thumbs44.redgifs.com',
      'i.redd.it',
      'i.imgur.com',
      'preview.redd.it',
      'v.redd.it',
    ];

    function isAllowedUrl(url: string): boolean {
      try {
        const parsed = new URL(url);
        if (['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'].includes(parsed.hostname)) return false;
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
        // Check if hostname matches or is subdomain of allowed hosts
        return ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`));
      } catch {
        return false;
      }
    }

    if (!isAllowedUrl(targetUrl)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'URL not in allowlist' });
    }

    try {
      // Safe fetch with redirect validation
      async function safeFetch(url: string, opts: RequestInit): Promise<Response> {
        const res = await fetch(url, { ...opts, redirect: 'manual' });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) throw new Error('Redirect with no location');
          const resolved = new URL(location, url).toString();
          if (!isAllowedUrl(resolved)) throw new Error('Redirect target not allowed');
          return fetch(resolved, { ...opts, redirect: 'manual' });
        }
        return res;
      }

      // For video: stream with range request support
      if (isVideo) {
        const rangeHeader = request.headers.range;
        const fetchHeaders: Record<string, string> = { ...headers };
        if (rangeHeader) {
          fetchHeaders['Range'] = rangeHeader;
        }

        const response = await safeFetch(targetUrl, { headers: fetchHeaders });

        if (!response.ok && response.status !== 206) {
          return reply.status(502).send({
            error: 'Upstream Error',
            message: `Source returned HTTP ${response.status}`,
          });
        }

        const contentType = response.headers.get('content-type') || 'video/mp4';
        const contentLength = response.headers.get('content-length');
        const contentRange = response.headers.get('content-range');
        const acceptRanges = response.headers.get('accept-ranges');

        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'public, max-age=300');
        if (contentLength) reply.header('Content-Length', contentLength);
        if (contentRange) reply.header('Content-Range', contentRange);
        if (acceptRanges) reply.header('Accept-Ranges', acceptRanges);
        else reply.header('Accept-Ranges', 'bytes');

        reply.status(response.status); // 200 or 206
        const body = response.body;
        if (body) {
          return reply.send(body);
        }
        return reply.send(Buffer.from(await response.arrayBuffer()));
      }

      // For images: buffer and cache
      const response = await safeFetch(targetUrl, { headers });

      if (!response.ok) {
        return reply.status(502).send({
          error: 'Upstream Error',
          message: `Source returned HTTP ${response.status}`,
        });
      }

      let contentType = response.headers.get('content-type') || 'image/jpeg';
      let buffer = Buffer.from(await response.arrayBuffer());

      // If the "original" URL returned HTML instead of an image, fall back to thumbnail
      if (!wantThumbnail && contentType.includes('text/html') && mediaUrls.thumbnail && mediaUrls.thumbnail !== targetUrl && isAllowedUrl(mediaUrls.thumbnail)) {
        const fallbackRes = await safeFetch(mediaUrls.thumbnail, { headers });
        if (fallbackRes.ok) {
          const fallbackType = fallbackRes.headers.get('content-type') || 'image/jpeg';
          if (!fallbackType.includes('text/html')) {
            contentType = fallbackType;
            buffer = Buffer.from(await fallbackRes.arrayBuffer());
          }
        }
      }

      // Cache image content
      proxyCache.set(cacheKey, { data: buffer, contentType, fetchedAt: Date.now() });

      // Evict old entries periodically
      if (proxyCache.size > 500) {
        const now = Date.now();
        for (const [key, val] of proxyCache) {
          if (now - val.fetchedAt > PROXY_CACHE_TTL) proxyCache.delete(key);
        }
      }

      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'public, max-age=300');
      reply.header('X-Proxy-Cache', 'MISS');
      return reply.send(buffer);
    } catch (error) {
      return reply.status(502).send({
        error: 'Proxy Error',
        message: error instanceof Error ? error.message : 'Failed to fetch image',
      });
    }
  });
  // Get single media item
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request.user as { sub?: string } | undefined)?.sub;

    const item = await db.query.mediaItems.findFirst({
      where: (m, { and, eq, isNull }) => and(
        eq(m.id, id),
        eq(m.isHidden, false),
        isNull(m.deletedAt),
      ),
      with: {
        thread: {
          with: {
            source: {
              columns: { id: true, name: true },
            },
          },
        },
        assets: {
          orderBy: (a, { asc }) => [asc(a.position)],
        },
      },
    });

    if (!item) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Media item not found',
      });
    }

    // Get user's interaction state
    let isLiked: boolean | null = null;
    let isFavorited: boolean | null = null;

    if (userId) {
      const [like, favorite] = await Promise.all([
        db.query.likes.findFirst({
          where: (l, { and, eq }) => and(eq(l.userId, userId), eq(l.mediaItemId, id)),
        }),
        db.query.favorites.findFirst({
          where: (f, { and, eq }) => and(eq(f.userId, userId), eq(f.mediaItemId, id)),
        }),
      ]);
      isLiked = !!like;
      isFavorited = !!favorite;
    }

    // Increment view count (fire and forget)
    db.update(mediaItems)
      .set({ viewCount: sql`${mediaItems.viewCount} + 1` })
      .where(eq(mediaItems.id, id))
      .execute()
      .catch(() => {}); // Ignore errors

    const mediaUrls = item.mediaUrls as { original: string; thumbnail?: string; preview?: string };
    const proxyUrls = getProxyUrls(item.id, mediaUrls);

    return {
      id: item.id,
      externalId: item.externalItemId,
      type: item.mediaType,
      title: item.title,
      description: item.caption,
      thumbnailUrl: proxyUrls.thumbnailUrl,
      mediaUrl: proxyUrls.mediaUrl,
      duration: item.durationMs ? Math.floor(item.durationMs / 1000) : null,
      width: item.width,
      height: item.height,
      author: item.author,
      authorUrl: item.authorUrl,
      permalink: item.permalink,
      tags: (item.tags as string[]) || [],
      source: item.thread?.source || null,
      likeCount: item.likeCount,
      commentCount: item.commentCount,
      favoriteCount: item.favoriteCount,
      viewCount: item.viewCount,
      isCommentsLocked: item.commentsLocked,
      publishedAt: item.postedAt?.toISOString() || null,
      ingestedAt: item.createdAt.toISOString(),
      isLiked,
      isFavorited,
      assets: item.assets.map(a => ({
        id: a.id,
        url: a.cdnUrl || a.assetUrl,
        type: a.assetType,
        duration: a.durationMs ? Math.floor(a.durationMs / 1000) : null,
        width: a.width,
        height: a.height,
        position: a.position,
      })),
    };
  });

  // Like/unlike media item (idempotent)
  app.put('/:id/like', {
    preHandler: [async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }
    }],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request.user as { sub: string }).sub;
    const body = request.body as { action?: 'like' | 'unlike' } | undefined;

    // Check if media exists
    const item = await db.query.mediaItems.findFirst({
      where: (m, { and, eq, isNull }) => and(
        eq(m.id, id),
        eq(m.isHidden, false),
        isNull(m.deletedAt),
      ),
      columns: { id: true, likeCount: true },
    });

    if (!item) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Media item not found',
      });
    }

    // Check current like status
    const existingLike = await db.query.likes.findFirst({
      where: (l, { and, eq }) => and(eq(l.userId, userId), eq(l.mediaItemId, id)),
    });

    const shouldLike = body?.action
      ? body.action === 'like'
      : !existingLike; // Toggle if no explicit action

    if (shouldLike && !existingLike) {
      // Add like
      await db.insert(likes).values({ userId, mediaItemId: id });
      await db.update(mediaItems)
        .set({ likeCount: sql`${mediaItems.likeCount} + 1` })
        .where(eq(mediaItems.id, id));

      return {
        isLiked: true,
        likeCount: item.likeCount + 1,
      };
    } else if (!shouldLike && existingLike) {
      // Remove like
      await db.delete(likes).where(
        and(eq(likes.userId, userId), eq(likes.mediaItemId, id))
      );
      await db.update(mediaItems)
        .set({ likeCount: sql`GREATEST(${mediaItems.likeCount} - 1, 0)` })
        .where(eq(mediaItems.id, id));

      return {
        isLiked: false,
        likeCount: Math.max(item.likeCount - 1, 0),
      };
    }

    // No change needed
    return {
      isLiked: !!existingLike,
      likeCount: item.likeCount,
    };
  });

  // Favorite/unfavorite media item (idempotent)
  app.put('/:id/favorite', {
    preHandler: [async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }
    }],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request.user as { sub: string }).sub;
    const body = request.body as { action?: 'add' | 'remove' } | undefined;

    // Check if media exists
    const item = await db.query.mediaItems.findFirst({
      where: (m, { and, eq, isNull }) => and(
        eq(m.id, id),
        eq(m.isHidden, false),
        isNull(m.deletedAt),
      ),
      columns: { id: true, favoriteCount: true },
    });

    if (!item) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Media item not found',
      });
    }

    // Check current favorite status
    const existingFavorite = await db.query.favorites.findFirst({
      where: (f, { and, eq }) => and(eq(f.userId, userId), eq(f.mediaItemId, id)),
    });

    const shouldFavorite = body?.action
      ? body.action === 'add'
      : !existingFavorite;

    if (shouldFavorite && !existingFavorite) {
      await db.insert(favorites).values({ userId, mediaItemId: id });
      await db.update(mediaItems)
        .set({ favoriteCount: sql`${mediaItems.favoriteCount} + 1` })
        .where(eq(mediaItems.id, id));

      return {
        isFavorited: true,
        favoriteCount: item.favoriteCount + 1,
      };
    } else if (!shouldFavorite && existingFavorite) {
      await db.delete(favorites).where(
        and(eq(favorites.userId, userId), eq(favorites.mediaItemId, id))
      );
      await db.update(mediaItems)
        .set({ favoriteCount: sql`GREATEST(${mediaItems.favoriteCount} - 1, 0)` })
        .where(eq(mediaItems.id, id));

      return {
        isFavorited: false,
        favoriteCount: Math.max(item.favoriteCount - 1, 0),
      };
    }

    return {
      isFavorited: !!existingFavorite,
      favoriteCount: item.favoriteCount,
    };
  });

  // Get comments for media item
  app.get('/:id/comments', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { cursor?: string; limit?: number; includeReplies?: string };
    const limit = Math.min(Math.max(query.limit || 20, 1), 50);
    const includeReplies = query.includeReplies !== 'false';

    // Verify media exists
    const item = await db.query.mediaItems.findFirst({
      where: (m, { and, eq, isNull }) => and(
        eq(m.id, id),
        eq(m.isHidden, false),
        isNull(m.deletedAt),
      ),
      columns: { id: true },
    });

    if (!item) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Media item not found',
      });
    }

    // Get top-level comments
    const topLevelComments = await db.query.comments.findMany({
      where: (c, { and, eq, isNull }) => and(
        eq(c.mediaItemId, id),
        isNull(c.parentId),
        eq(c.isHidden, false),
        isNull(c.deletedAt),
      ),
      orderBy: (c, { asc }) => [asc(c.createdAt)],
      limit: limit + 1,
      with: {
        user: {
          columns: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        ...(includeReplies ? {
          replies: {
            where: (r, { and, eq, isNull }) => and(
              eq(r.isHidden, false),
              isNull(r.deletedAt),
            ),
            orderBy: (r, { asc }) => [asc(r.createdAt)],
            limit: 3, // First 3 replies
            with: {
              user: {
                columns: { id: true, username: true, displayName: true, avatarUrl: true },
              },
            },
          },
        } : {}),
      },
    });

    const hasMore = topLevelComments.length > limit;
    const resultComments = hasMore ? topLevelComments.slice(0, -1) : topLevelComments;

    return {
      items: resultComments.map(comment => ({
        id: comment.id,
        content: comment.body,
        user: comment.user,
        parentId: comment.parentId,
        replyCount: comment.replyCount,
        likeCount: comment.likeCount,
        isEdited: comment.isEdited,
        createdAt: comment.createdAt.toISOString(),
        replies: includeReplies && 'replies' in comment
          ? (comment.replies as typeof topLevelComments).map(reply => ({
              id: reply.id,
              content: reply.body,
              user: reply.user,
              parentId: reply.parentId,
              replyCount: 0,
              likeCount: reply.likeCount,
              isEdited: reply.isEdited,
              createdAt: reply.createdAt.toISOString(),
            }))
          : undefined,
      })),
      pagination: {
        nextCursor: null,
        hasMore,
      },
    };
  });

  // Create comment
  app.post('/:id/comments', {
    preHandler: [async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }
    }],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = (request.user as { sub: string }).sub;
    const body = request.body as { content: string; parentId?: string };

    if (!body.content || body.content.trim().length === 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Comment content is required',
      });
    }

    if (body.content.length > 2000) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Comment content must be 2000 characters or less',
      });
    }

    // Verify media exists and comments not locked
    const item = await db.query.mediaItems.findFirst({
      where: (m, { and, eq, isNull }) => and(
        eq(m.id, id),
        eq(m.isHidden, false),
        isNull(m.deletedAt),
      ),
      columns: { id: true, commentsLocked: true },
    });

    if (!item) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Media item not found',
      });
    }

    if (item.commentsLocked) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Comments are locked on this item',
      });
    }

    // If replying, verify parent exists and is top-level
    if (body.parentId) {
      const parent = await db.query.comments.findFirst({
        where: (c, { and, eq, isNull }) => and(
          eq(c.id, body.parentId!),
          isNull(c.deletedAt),
        ),
        columns: { id: true, parentId: true },
      });

      if (!parent) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Parent comment not found',
        });
      }

      if (parent.parentId !== null) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Cannot reply to a reply (only 1 level of threading allowed)',
        });
      }
    }

    // Create comment
    const [newComment] = await db.insert(comments).values({
      mediaItemId: id,
      userId,
      parentId: body.parentId || null,
      body: body.content.trim(),
    }).returning();

    if (!newComment) {
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create comment',
      });
    }

    // Update counts
    await db.update(mediaItems)
      .set({ commentCount: sql`${mediaItems.commentCount} + 1` })
      .where(eq(mediaItems.id, id));

    if (body.parentId) {
      await db.update(comments)
        .set({ replyCount: sql`${comments.replyCount} + 1` })
        .where(eq(comments.id, body.parentId));
    }

    // Get user info
    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, userId),
      columns: { id: true, username: true, displayName: true, avatarUrl: true },
    });

    return {
      id: newComment.id,
      content: newComment.body,
      user,
      parentId: newComment.parentId,
      replyCount: 0,
      likeCount: 0,
      isEdited: false,
      createdAt: newComment.createdAt.toISOString(),
    };
  });
}
