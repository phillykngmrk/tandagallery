/**
 * Determines whether a media URL needs to be proxied through the API.
 * Attachment page URLs (e.g., /attachments/slug.123/) require authentication
 * and can't be loaded directly by the browser.
 */
function needsProxy(url: string): boolean {
  // Proxy everything except known public CDNs that load fine in the browser
  const publicHosts = ['simp6.selti-delivery.ru'];
  try {
    const host = new URL(url).hostname;
    if (publicHosts.includes(host)) return false;
  } catch {
    // Invalid URL, proxy it
  }
  return true;
}

/**
 * Returns proxy URLs for a media item's images.
 * If the URL doesn't need proxying (e.g., direct image file), returns it as-is.
 */
export function getProxyUrls(
  itemId: string,
  mediaUrls: { original: string; thumbnail?: string; cdnOriginal?: string; cdnThumbnail?: string },
  apiBase?: string,
): { mediaUrl: string; thumbnailUrl: string } {
  if (!apiBase && !process.env.API_PUBLIC_URL) {
    throw new Error('API_PUBLIC_URL environment variable is required for proxy URL generation');
  }
  const base = apiBase || `${process.env.API_PUBLIC_URL}/api/v1/media`;

  const originalUrl = mediaUrls.original;
  const thumbUrl = mediaUrls.thumbnail || originalUrl;

  return {
    // Prefer CDN URL if already cached on R2
    mediaUrl: mediaUrls.cdnOriginal
      || (needsProxy(originalUrl) ? `${base}/proxy/${itemId}` : originalUrl),
    thumbnailUrl: mediaUrls.cdnThumbnail
      || (needsProxy(thumbUrl) ? `${base}/proxy/${itemId}?thumb=1` : thumbUrl),
  };
}
