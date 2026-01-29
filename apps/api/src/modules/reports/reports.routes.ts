import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../lib/db.js';
import { reports } from '@aggragif/db/schema';

export async function reportRoutes(app: FastifyInstance) {
  // POST /api/v1/reports — submit a content report (auth required)
  app.post('', {
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
    const userId = (request.user as { sub: string }).sub;
    const { targetType, targetId, reason, details } = request.body as {
      targetType: string;
      targetId: string;
      reason: string;
      details?: string;
    };

    if (!targetType || !targetId || !reason) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'targetType, targetId, and reason are required',
      });
    }

    await db.insert(reports).values({
      reporterId: userId,
      targetType,
      targetId,
      reason,
      description: details || null,
    });

    return reply.status(201).send({ success: true });
  });
}
