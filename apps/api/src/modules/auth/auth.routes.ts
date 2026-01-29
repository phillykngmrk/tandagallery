import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { registerSchema, loginSchema } from '@aggragif/shared';
import { db } from '../../lib/db.js';
import { users, sessions } from '@aggragif/db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { config } from '../../config/index.js';

const IS_PROD = config.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: 'strict' as const,
  path: '/',
};

function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string) {
  reply.setCookie('access_token', accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: 15 * 60, // 15 minutes
  });
  reply.setCookie('refresh_token', refreshToken, {
    ...COOKIE_OPTIONS,
    path: '/api/v1/auth', // Only sent to auth endpoints
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie('access_token', { ...COOKIE_OPTIONS });
  reply.clearCookie('refresh_token', { ...COOKIE_OPTIONS, path: '/api/v1/auth' });
}

export async function authRoutes(app: FastifyInstance) {
  // Stricter rate limits for auth endpoints
  const authRateLimit = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  };

  // Register
  app.post('/register', authRateLimit, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.parse(request.body);

    // Check if email/username already exists
    const existingUser = await db.query.users.findFirst({
      where: (u, { or, eq }) => or(eq(u.email, body.email), eq(u.username, body.username)),
    });

    if (existingUser) {
      return reply.status(409).send({
        error: 'Conflict',
        message: existingUser.email === body.email
          ? 'Email already registered'
          : 'Username already taken',
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(body.password, 12);

    // Create user
    const [newUser] = await db.insert(users).values({
      email: body.email,
      username: body.username,
      displayName: body.displayName || body.username,
      passwordHash,
    }).returning({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
    });

    if (!newUser) {
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create user',
      });
    }

    // Generate tokens
    const accessToken = app.jwt.sign({
      sub: newUser.id,
      email: newUser.email,
      username: newUser.username,
      role: newUser.role,
    });

    const refreshToken = randomUUID();
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    // Store refresh token
    await db.insert(sessions).values({
      userId: newUser.id,
      refreshTokenHash,
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Set httpOnly cookies
    setAuthCookies(reply, accessToken, refreshToken);

    return {
      user: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        displayName: newUser.displayName,
        role: newUser.role,
        createdAt: newUser.createdAt,
      },
    };
  });

  // Login
  app.post('/login', authRateLimit, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);

    // Find user
    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, body.email),
    });

    if (!user || !user.passwordHash) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Check password
    const validPassword = await bcrypt.compare(body.password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Check if banned
    if (user.isBanned) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Account is banned',
      });
    }

    // Update last login
    await db.update(users)
      .set({
        lastLoginAt: new Date(),
        loginCount: (user.loginCount || 0) + 1,
      })
      .where(eq(users.id, user.id));

    // Generate tokens
    const accessToken = app.jwt.sign({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    });

    const refreshToken = randomUUID();
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    // Store refresh token
    await db.insert(sessions).values({
      userId: user.id,
      refreshTokenHash,
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Set httpOnly cookies
    setAuthCookies(reply, accessToken, refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        createdAt: user.createdAt,
      },
    };
  });

  // Refresh token endpoint — issues a new access token using the refresh token cookie
  app.post('/refresh', authRateLimit, async (request: FastifyRequest, reply: FastifyReply) => {
    const refreshToken = request.cookies.refresh_token;

    if (!refreshToken) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'No refresh token',
      });
    }

    // Find all non-revoked, non-expired sessions
    const activeSessions = await db.query.sessions.findMany({
      where: (s, { and, isNull, gt }) => and(
        isNull(s.revokedAt),
        gt(s.expiresAt, new Date()),
      ),
      with: {
        user: {
          columns: { id: true, email: true, username: true, role: true, isBanned: true },
        },
      },
    });

    // Find matching session by comparing bcrypt hashes
    let matchedSession: typeof activeSessions[0] | null = null;
    for (const session of activeSessions) {
      const matches = await bcrypt.compare(refreshToken, session.refreshTokenHash);
      if (matches) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) {
      clearAuthCookies(reply);
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }

    if (matchedSession.user.isBanned) {
      // Revoke the session
      await db.update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'banned' })
        .where(eq(sessions.id, matchedSession.id));
      clearAuthCookies(reply);
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Account is banned',
      });
    }

    // Rotate refresh token: revoke old, create new
    await db.update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'rotated' })
      .where(eq(sessions.id, matchedSession.id));

    const newRefreshToken = randomUUID();
    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);

    await db.insert(sessions).values({
      userId: matchedSession.user.id,
      refreshTokenHash: newRefreshTokenHash,
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Update last active
    await db.update(sessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(sessions.userId, matchedSession.user.id));

    // Issue new access token
    const accessToken = app.jwt.sign({
      sub: matchedSession.user.id,
      email: matchedSession.user.email,
      username: matchedSession.user.username,
      role: matchedSession.user.role,
    });

    setAuthCookies(reply, accessToken, newRefreshToken);

    return { success: true };
  });

  // Get current user (requires auth)
  app.get('/me', {
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
  }, async (request: FastifyRequest) => {
    const payload = request.user as { sub: string };

    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, payload.sub),
      columns: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        role: true,
        createdAt: true,
      },
    });

    return user;
  });

  // Logout
  app.post('/logout', {
    preHandler: [async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        // Even if JWT is expired, allow logout to clear cookies
      }
    }],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.user as { sub?: string } | undefined;

    if (payload?.sub) {
      // Revoke all sessions for user
      await db.update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'logout' })
        .where(eq(sessions.userId, payload.sub));
    }

    clearAuthCookies(reply);

    return { success: true };
  });
}
