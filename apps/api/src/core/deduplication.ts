import { createHash } from 'crypto';

/**
 * Input for generating a content fingerprint
 */
export interface FingerprintInput {
  /** Primary media URL (path component only) */
  mediaUrl: string;
  /** Author username or ID */
  author: string;
  /** Post timestamp (rounded to nearest hour) */
  timestamp: Date;
  /** Optional dimensions */
  width?: number;
  height?: number;
}

/**
 * Generate a content fingerprint for deduplication
 *
 * The fingerprint is used as a fallback when external IDs change or are unavailable.
 * It's designed to be stable across minor variations but unique enough to detect duplicates.
 *
 * Components:
 * - Media URL path (excludes domain/query params for stability)
 * - Author identifier
 * - Timestamp rounded to nearest hour (handles minor time variations)
 * - Dimensions if available (distinguishes different quality versions)
 *
 * @returns SHA256 hash truncated to 64 characters
 */
export function generateFingerprint(input: FingerprintInput): string {
  // Extract path from URL (removes domain and query params)
  const urlPath = extractUrlPath(input.mediaUrl);

  // Round timestamp to nearest hour for stability
  const roundedTimestamp = roundToHour(input.timestamp);

  // Build fingerprint components
  const components = [
    urlPath,
    input.author.toLowerCase().trim(),
    roundedTimestamp.toISOString(),
  ];

  // Add dimensions if present
  if (input.width && input.height) {
    components.push(`${input.width}x${input.height}`);
  }

  // Join and hash
  const data = components.join('|');
  const hash = createHash('sha256').update(data).digest('hex');

  // Truncate to 64 chars (still plenty for uniqueness)
  return hash.substring(0, 64);
}

/**
 * Extract the path component from a URL
 * Handles various URL formats and edge cases
 */
function extractUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    // Return path without query string
    return parsed.pathname;
  } catch {
    // If URL parsing fails, use as-is but remove common query patterns
    const withoutQuery = url.split('?')[0] ?? url;
    return withoutQuery.split('#')[0] ?? withoutQuery;
  }
}

/**
 * Round a date to the nearest hour
 */
function roundToHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

/**
 * Normalize a URL for comparison
 * Removes tracking parameters, normalizes protocol, etc.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove common tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'ref', 'source', 'fbclid', 'gclid', 'mc_cid', 'mc_eid',
    ];
    trackingParams.forEach(param => parsed.searchParams.delete(param));

    // Normalize to https
    parsed.protocol = 'https:';

    // Remove trailing slash from path
    if (parsed.pathname.endsWith('/') && parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Check if two URLs point to the same resource
 */
export function urlsMatch(url1: string, url2: string): boolean {
  return normalizeUrl(url1) === normalizeUrl(url2);
}

/**
 * Extract media type from URL or content-type
 */
export function inferMediaType(url: string, contentType?: string): 'image' | 'gif' | 'video' | 'unknown' {
  // Strip query params and hash for extension matching
  const urlPath = url.split('?')[0]?.split('#')[0]?.toLowerCase() || '';

  // Check by file extension (path only, no query params)
  if (urlPath.endsWith('.gif')) return 'gif';
  if (urlPath.endsWith('.mp4') || urlPath.endsWith('.webm') || urlPath.endsWith('.mov')) return 'video';
  if (urlPath.endsWith('.jpg') || urlPath.endsWith('.jpeg') || urlPath.endsWith('.png') || urlPath.endsWith('.webp') || urlPath.endsWith('.avif')) return 'image';

  // Check by content-type header
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes('image/gif')) return 'gif';
    if (ct.includes('video/')) return 'video';
    if (ct.includes('image/')) return 'image';
  }

  // Check URL patterns
  const urlLower = url.toLowerCase();
  if (urlLower.includes('.gif')) return 'gif';
  if (urlLower.includes('.mp4') || urlLower.includes('.webm')) return 'video';
  if (urlLower.includes('.jpg') || urlLower.includes('.jpeg') || urlLower.includes('.png') || urlLower.includes('.webp')) return 'image';

  return 'unknown';
}

/**
 * Validate media duration (max 30 seconds)
 */
export function isValidDuration(durationMs: number | undefined, maxMs = 30000): boolean {
  if (durationMs === undefined) return true; // Images don't have duration
  return durationMs > 0 && durationMs <= maxMs;
}
