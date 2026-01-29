import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { resolve } from 'path';

// Load .env from root
dotenvConfig({ path: resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

  // Server
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),

  // CORS
  FRONTEND_URL: z.string(),

  // Public-facing API base URL (used for constructing proxy URLs returned to clients)
  API_PUBLIC_URL: z.string().optional(),

  // Ingestion
  INGEST_POLL_INTERVAL_MS: z.coerce.number().default(600000), // 10 minutes
  INGEST_MAX_PAGES_PER_RUN: z.coerce.number().default(10),
  INGEST_MAX_CONCURRENT_SOURCES: z.coerce.number().default(5),

  // Cloudflare R2 (optional — if set, media is cached to CDN)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),

  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;

export type Config = typeof config;
