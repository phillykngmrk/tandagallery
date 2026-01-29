import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { config } from './config/index.js';
import { redis } from './lib/redis.js';

// Route imports
import { feedRoutes } from './modules/feed/feed.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: config.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // Managed by frontend
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow media proxy
  });

  // CORS — support multiple origins (comma-separated FRONTEND_URL)
  const allowedOrigins = config.FRONTEND_URL.split(',').map(u => u.trim());
  await app.register(cors, {
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
  });

  // Cookies
  await app.register(cookie, {
    secret: config.JWT_SECRET,
  });

  // JWT — extract from httpOnly cookie first, fall back to Authorization header
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: config.JWT_EXPIRES_IN,
    },
    cookie: {
      cookieName: 'access_token',
      signed: false,
    },
  });

  // Rate limiting
  await app.register(rateLimit, {
    global: true,
    max: 500,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (request) => {
      // Use user ID if authenticated, otherwise IP
      const user = request.user as { sub?: string } | undefined;
      if (user?.sub) {
        return `rate:user:${user.sub}`;
      }
      return `rate:ip:${request.ip}`;
    },
  });

  // CSRF protection: verify Origin header on state-changing requests
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Invalid request origin',
      });
    }
  });

  // Health check
  app.get('/health', async () => {
    let redisStatus = 'unknown';
    try {
      const { redis } = await import('./lib/redis.js');
      const pong = await redis.ping();
      redisStatus = pong === 'PONG' ? 'connected' : 'error';
    } catch {
      redisStatus = 'disconnected';
    }
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      redis: redisStatus,
      queues: process.env.ENABLE_QUEUES !== 'false' ? 'enabled' : 'disabled',
    };
  });

  // API routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(feedRoutes, { prefix: '/api/v1/feed' });
  await app.register(mediaRoutes, { prefix: '/api/v1/media' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });

  // Global error handler
  app.setErrorHandler((err, request, reply) => {
    app.log.error(err);

    // Type guard for Fastify errors
    const error = err as {
      validation?: unknown;
      code?: string;
      statusCode?: number;
      name?: string;
      message?: string;
    };

    // Validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request parameters',
        details: error.validation,
      });
    }

    // JWT errors
    if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    // Rate limit errors
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: error.message || 'Rate limit exceeded',
      });
    }

    // Default error
    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : (error.name || 'Error'),
      message: config.NODE_ENV === 'production' && statusCode >= 500
        ? 'An unexpected error occurred'
        : (error.message || 'Unknown error'),
    });
  });

  return app;
}
