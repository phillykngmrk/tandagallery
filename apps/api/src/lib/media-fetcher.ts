/**
 * Shared media fetching utilities.
 * Used by both the proxy route and the ingestion pre-cacher.
 */

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0';

const ALLOWED_HOSTS = [
  'jpg6.su',
  'simp6.selti-delivery.ru',
  'abwcandyshop.com',
  'r2.cloudflarestorage.com',
  'redgifs.com',
  'thumbs4.redgifs.com',
  'thumbs44.redgifs.com',
  'i.redd.it',
  'i.imgur.com',
  'preview.redd.it',
  'v.redd.it',
];

/**
 * Check if a URL is in the SSRF allowlist.
 */
export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'].includes(parsed.hostname)) return false;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Build auth/referer headers for fetching media from a source URL.
 */
export function buildSourceHeaders(
  sourceUrl: string,
  scraperConfig?: { headers?: Record<string, string> } | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    ...(scraperConfig?.headers || {}),
  };

  if (sourceUrl.includes('redgifs.com')) {
    headers['Referer'] = 'https://www.redgifs.com/';
    headers['Origin'] = 'https://www.redgifs.com';
  }

  return headers;
}

/**
 * Fetch a media URL with redirect validation (SSRF-safe).
 */
export async function safeFetchMedia(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(url, { headers, redirect: 'manual', signal });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw new Error('Redirect with no location');
    const resolved = new URL(location, url).toString();
    if (!isAllowedUrl(resolved)) throw new Error('Redirect target not allowed');
    return fetch(resolved, { headers, redirect: 'manual', signal });
  }

  return res;
}

/**
 * Correct content-type for videos that sources mislabel.
 * RedGifs "gif" items return image/gif but are actually mp4.
 */
export function correctContentType(rawContentType: string, url: string): string {
  const isVideo = url.endsWith('.mp4') || url.endsWith('.webm');
  if (isVideo && rawContentType.startsWith('image/')) {
    return 'video/mp4';
  }
  return rawContentType;
}
