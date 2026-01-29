import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';

const isConfigured =
  config.R2_ACCOUNT_ID &&
  config.R2_ACCESS_KEY_ID &&
  config.R2_SECRET_ACCESS_KEY &&
  config.R2_BUCKET &&
  config.R2_PUBLIC_URL;

const s3 = isConfigured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID!,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

/**
 * Returns true if R2 is configured and available.
 */
export function isR2Enabled(): boolean {
  return s3 !== null;
}

/**
 * Build the R2 object key for a media item.
 * Format: media/<itemId>/original.<ext> or media/<itemId>/thumb.jpg
 */
function objectKey(itemId: string, variant: 'original' | 'thumb', contentType?: string): string {
  const ext = variant === 'thumb'
    ? 'jpg'
    : extensionFromContentType(contentType || 'video/mp4');
  return `media/${itemId}/${variant}.${ext}`;
}

function extensionFromContentType(ct: string): string {
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  return 'bin';
}

/**
 * Upload a buffer to R2 and return the public CDN URL.
 */
export async function uploadToR2(
  itemId: string,
  variant: 'original' | 'thumb',
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string | null> {
  if (!s3) return null;

  const key = objectKey(itemId, variant, contentType);

  await s3.send(new PutObjectCommand({
    Bucket: config.R2_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${config.R2_PUBLIC_URL}/${key}`;
}

/**
 * Check if an object already exists in R2.
 */
export async function existsInR2(
  itemId: string,
  variant: 'original' | 'thumb',
): Promise<boolean> {
  if (!s3) return false;

  // We don't know the exact extension, so check common ones
  const variants = variant === 'thumb'
    ? ['jpg']
    : ['mp4', 'webm', 'gif', 'jpg', 'png', 'webp'];

  for (const ext of variants) {
    try {
      await s3.send(new HeadObjectCommand({
        Bucket: config.R2_BUCKET!,
        Key: `media/${itemId}/${variant}.${ext}`,
      }));
      return true;
    } catch {
      // Not found, try next
    }
  }
  return false;
}

/**
 * Get the CDN URL for an item if it exists in R2.
 * Returns null if not cached.
 */
export function getCdnUrl(itemId: string, variant: 'original' | 'thumb', contentType?: string): string {
  const key = objectKey(itemId, variant, contentType);
  return `${config.R2_PUBLIC_URL}/${key}`;
}
