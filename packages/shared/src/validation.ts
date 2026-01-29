import { z } from 'zod';

/**
 * Shared validation schemas
 */

// Pagination
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Auth
export const registerSchema = z.object({
  email: z.string().email(),
  username: z.string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z.string().min(8).max(128),
  displayName: z.string().max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Comments
export const createCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().uuid().optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(2000),
});

// Reports
export const createReportSchema = z.object({
  targetType: z.enum(['media_item', 'comment', 'user']),
  targetId: z.string().uuid(),
  reason: z.enum([
    'spam',
    'harassment',
    'hate_speech',
    'violence',
    'nudity',
    'copyright',
    'misinformation',
    'other',
  ]),
  description: z.string().max(1000).optional(),
});

// Profile
export const updateProfileSchema = z.object({
  displayName: z.string().max(100).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
});

// Feed query
export const feedQuerySchema = paginationSchema.extend({
  type: z.enum(['image', 'gif', 'video']).optional(),
  tag: z.string().optional(),
  sort: z.enum(['recent', 'popular', 'trending']).default('recent'),
});

// Search query
export const searchQuerySchema = paginationSchema.extend({
  q: z.string().min(1).max(100),
  type: z.enum(['image', 'gif', 'video']).optional(),
});

// Type exports
export type PaginationInput = z.infer<typeof paginationSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type FeedQueryInput = z.infer<typeof feedQuerySchema>;
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
