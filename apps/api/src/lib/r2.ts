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
 * Download media from a source URL and upload it to R2.
 * Returns the CDN URL, or null if R2 is not configured or download fails.
 */
export async function downloadAndUploadToR2(
  itemId: string,
  variant: 'original' | 'thumb',
  sourceUrl: string,
  fetchFn: (url: string) => Promise<Response>,
): Promise<string | null> {
  if (!s3) return null;

  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetchFn(sourceUrl);
    if (!res.ok) {
      console.warn(`R2 pre-cache: HTTP ${res.status} for ${sourceUrl}`);
      return null;
    }

    // Check content-length before buffering
    const cl = res.headers.get('content-length');
    if (cl && parseInt(cl, 10) > MAX_SIZE) {
      console.warn(`R2 pre-cache: skipping ${sourceUrl} (${cl} bytes exceeds limit)`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_SIZE) {
      console.warn(`R2 pre-cache: skipping ${sourceUrl} (${buffer.length} bytes exceeds limit)`);
      return null;
    }

    // Correct content-type for mislabeled videos
    const rawCt = res.headers.get('content-type') || (variant === 'thumb' ? 'image/jpeg' : 'video/mp4');
    const isVideo = sourceUrl.endsWith('.mp4') || sourceUrl.endsWith('.webm');
    const contentType = (isVideo && rawCt.startsWith('image/')) ? 'video/mp4' : rawCt;

    return await uploadToR2(itemId, variant, buffer, contentType);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.warn(`R2 pre-cache: timeout downloading ${sourceUrl}`);
    } else {
      console.warn(`R2 pre-cache: failed for ${sourceUrl}:`, err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
