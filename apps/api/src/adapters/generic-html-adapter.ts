import * as cheerio from 'cheerio';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CheerioElement = cheerio.Cheerio<any>;
import {
  BaseAdapter,
  type SourceConfig,
  type ScrapedItem,
  type ScanResult,
  type PageInfo,
  registerAdapter,
} from './base-adapter.js';
import { inferMediaType } from '../core/deduplication.js';

/**
 * CSS selectors for extracting content from pages
 * Configure these based on the target site's HTML structure
 */
export interface HtmlSelectors {
  /** Container for all items on the page */
  itemContainer: string;
  /** Individual item within container */
  item: string;
  /** Item ID attribute or element */
  itemId: string | { attr: string };
  /** Permalink/link to item */
  permalink: string | { attr: string };
  /** Posted timestamp */
  timestamp: string | { attr: string; format?: string };
  /** Author username */
  author: string | { attr: string };
  /** Author profile link (optional) */
  authorUrl?: string | { attr: string };
  /** Title (optional) */
  title?: string;
  /** Caption/description (optional) */
  caption?: string;
  /** Primary media element */
  media: string | { attr: string };
  /** Media URL attribute (default: src) */
  mediaUrlAttr?: string;
  /** If true, use parent <a> href as the full-size media URL and <img src> as thumbnail */
  mediaParentLink?: boolean;
  /** Thumbnail element (optional) */
  thumbnail?: string | { attr: string };
  /** Width attribute/element (optional) */
  width?: string | { attr: string };
  /** Height attribute/element (optional) */
  height?: string | { attr: string };
  /** Duration for video/gif (optional) */
  duration?: string | { attr: string };
  /** Tags/categories (optional) */
  tags?: string;
  /** Pagination: current page */
  currentPage?: string | { attr: string };
  /** Pagination: total pages */
  totalPages?: string | { attr: string };
  /** Pagination: next page link */
  nextPage?: string;
  /** Pagination: last page link */
  lastPage?: string | { attr: string };
}

/**
 * URL pattern configuration for building page URLs
 */
export interface UrlPattern {
  /** Base path for the thread/board */
  basePath: string;
  /** Page parameter style */
  pageStyle: 'query' | 'path' | 'offset';
  /** Query parameter name (for query style) */
  pageParam?: string;
  /** Path segment format (for path style), use {page} placeholder */
  pathFormat?: string;
  /** Items per page (for offset style) */
  itemsPerPage?: number;
}

/**
 * Extended config for generic HTML adapter
 */
export interface GenericHtmlConfig {
  selectors: HtmlSelectors;
  urlPattern: UrlPattern;
  /** Custom date parsing function name or format */
  dateFormat?: string;
  /** Whether the source uses descending order (newest first) */
  newestFirst?: boolean;
  /** Custom headers to send with requests */
  headers?: Record<string, string>;
}

/**
 * Generic HTML Adapter
 *
 * A flexible adapter for scraping HTML pages from forums, image boards,
 * and other community thread websites. Configure with CSS selectors
 * that match the target site's HTML structure.
 */
export class GenericHtmlAdapter extends BaseAdapter {
  private htmlConfig: GenericHtmlConfig;

  constructor(config: SourceConfig) {
    super(config);

    if (!config.extra || typeof config.extra !== 'object') {
      throw new Error('GenericHtmlAdapter requires config.extra');
    }

    const extra = config.extra as unknown as GenericHtmlConfig;
    if (!extra.selectors || !extra.urlPattern) {
      throw new Error('GenericHtmlAdapter requires selectors and urlPattern in config.extra');
    }

    this.htmlConfig = extra;
  }

  getName(): string {
    return 'generic-html';
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Try to fetch the first page
      const url = this.buildPageUrl(1);
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.getUserAgent(),
          ...this.htmlConfig.headers,
        },
      });

      if (!response.ok) {
        return {
          valid: false,
          error: `HTTP ${response.status} from ${url}`,
        };
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Check if we can find items
      const items = $(this.htmlConfig.selectors.itemContainer)
        .find(this.htmlConfig.selectors.item);

      if (items.length === 0) {
        return {
          valid: false,
          error: 'No items found with configured selectors',
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getLatestPage(): Promise<PageInfo> {
    await this.respectRateLimit();

    // Fetch the first page to get pagination info
    const url = this.buildPageUrl(1);
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.getUserAgent(),
        ...this.htmlConfig.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching page info`);
    }

    const html = await response.text();
    const pagination = this.extractPaginationInfo(html);

    return {
      latestPage: pagination.totalPages ?? 1,
      totalPages: pagination.totalPages,
    };
  }

  async scanPage(pageNumber: number): Promise<ScanResult> {
    await this.respectRateLimit();

    const url = this.buildPageUrl(pageNumber);
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.getUserAgent(),
        ...this.htmlConfig.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching page ${pageNumber}`);
    }

    const html = await response.text();
    const items = this.parsePageContent(html, pageNumber);
    const pagination = this.extractPaginationInfo(html);

    // If source is oldest-first, reverse to get newest-first
    if (!this.htmlConfig.newestFirst) {
      items.reverse();
    }

    return {
      items,
      pageNumber,
      hasMorePages: pagination.hasNextPage,
      totalItems: undefined,
    };
  }

  protected buildPageUrl(pageNumber: number): string {
    const { basePath, pageStyle, pageParam, pathFormat, itemsPerPage } = this.htmlConfig.urlPattern;
    // Use threadUrl if available, otherwise construct from baseUrl + basePath
    const threadUrl = this.config.threadUrl || this.config.baseUrl;
    const baseUrl = basePath && basePath !== '/'
      ? new URL(basePath, this.config.baseUrl)
      : new URL(threadUrl);

    // Page 1 is the default page - no pagination suffix needed
    if (pageNumber <= 1) {
      return baseUrl.toString();
    }

    switch (pageStyle) {
      case 'query':
        baseUrl.searchParams.set(pageParam || 'page', String(pageNumber));
        break;

      case 'path':
        if (pathFormat) {
          baseUrl.pathname = pathFormat.replace('{page}', String(pageNumber));
        } else {
          // Default: append page-N (XenForo style)
          const path = baseUrl.pathname.replace(/\/$/, '');
          baseUrl.pathname = `${path}/page-${pageNumber}`;
        }
        break;

      case 'offset':
        const offset = (pageNumber - 1) * (itemsPerPage || 20);
        baseUrl.searchParams.set(pageParam || 'offset', String(offset));
        break;
    }

    return baseUrl.toString();
  }

  protected parsePageContent(html: string, pageNumber: number): ScrapedItem[] {
    const $ = cheerio.load(html);
    const items: ScrapedItem[] = [];
    const selectors = this.htmlConfig.selectors;

    $(selectors.itemContainer).find(selectors.item).each((_, element) => {
      try {
        const $item = $(element);

        // Extract item ID
        const externalId = this.extractValue($item, selectors.itemId);
        if (!externalId) return;

        // Extract permalink
        const permalink = this.extractValue($item, selectors.permalink);
        if (!permalink) return;

        // Extract timestamp
        const timestampRaw = this.extractValue($item, selectors.timestamp);
        const postedAt = this.parseTimestamp(timestampRaw);
        if (!postedAt) return;

        // Extract author
        const author = this.extractValue($item, selectors.author) || 'anonymous';

        // Extract optional fields shared across all images in the post
        const authorUrl = selectors.authorUrl
          ? this.extractValue($item, selectors.authorUrl)
          : undefined;
        const title = selectors.title
          ? this.extractValue($item, selectors.title)
          : undefined;
        const caption = selectors.caption
          ? this.extractValue($item, selectors.caption)
          : undefined;
        const width = selectors.width
          ? parseInt(this.extractValue($item, selectors.width) || '0', 10) || undefined
          : undefined;
        const height = selectors.height
          ? parseInt(this.extractValue($item, selectors.height) || '0', 10) || undefined
          : undefined;
        const durationMs = selectors.duration
          ? this.parseDuration(this.extractValue($item, selectors.duration))
          : undefined;
        const tags = selectors.tags
          ? $item.find(selectors.tags).map((_, t) => $(t).text().trim()).get()
          : undefined;

        const absolutePermalink = new URL(permalink, this.config.baseUrl).toString();
        const absoluteAuthorUrl = authorUrl
          ? new URL(authorUrl, this.config.baseUrl).toString()
          : undefined;

        if (selectors.mediaParentLink) {
          // Iterate ALL media elements to capture every image in the post
          const $mediaElements = typeof selectors.media === 'string'
            ? $item.find(selectors.media)
            : $item;

          const seenUrls = new Set<string>();

          $mediaElements.each((imgIdx, mediaEl) => {
            const $mediaEl = $(mediaEl);
            // Get the <img src> as thumbnail
            const autoThumb = $mediaEl.attr('src') || $mediaEl.attr('data-src') || undefined;
            // Get parent <a> href as full-size URL
            let mediaUrl: string | undefined;
            const $parentLink = $mediaEl.closest('a');
            if ($parentLink.length > 0) {
              mediaUrl = $parentLink.attr('href') || undefined;
            }
            // Fallback to img src if no parent link
            let thumbnailUrl = autoThumb;
            if (!mediaUrl) {
              mediaUrl = autoThumb;
              thumbnailUrl = undefined;
            }
            if (!mediaUrl) return;

            // Deduplicate within the same post
            const fullUrl = new URL(mediaUrl, this.config.baseUrl).toString();
            if (seenUrls.has(fullUrl)) return;
            seenUrls.add(fullUrl);

            // Determine media type
            let mediaType = inferMediaType(mediaUrl);
            if (mediaType === 'unknown' && thumbnailUrl) {
              mediaType = inferMediaType(thumbnailUrl);
            }
            if (mediaType === 'unknown' && mediaUrl.includes('/attachments/')) {
              mediaType = 'image';
            }
            if (mediaType === 'unknown') return;

            // Use indexed externalId for multi-image posts
            const itemExternalId = $mediaElements.length > 1
              ? `${externalId}-img-${imgIdx}`
              : externalId;

            const absoluteThumbnailUrl = thumbnailUrl
              ? new URL(thumbnailUrl, this.config.baseUrl).toString()
              : undefined;

            items.push({
              externalId: itemExternalId,
              permalink: absolutePermalink,
              postedAt,
              author,
              authorUrl: absoluteAuthorUrl,
              title,
              caption,
              mediaType: mediaType as 'image' | 'gif' | 'video',
              mediaUrl: fullUrl,
              thumbnailUrl: absoluteThumbnailUrl,
              durationMs,
              width,
              height,
              tags,
            });
          });
        } else {
          const mediaUrl = this.extractMediaUrl($item, selectors.media, selectors.mediaUrlAttr);
          if (!mediaUrl) return;

          let mediaType = inferMediaType(mediaUrl);
          if (mediaType === 'unknown') return;

          const thumbnailUrl = selectors.thumbnail
            ? this.extractMediaUrl($item, selectors.thumbnail)
            : undefined;

          const absoluteMediaUrl = new URL(mediaUrl, this.config.baseUrl).toString();
          const absoluteThumbnailUrl = thumbnailUrl
            ? new URL(thumbnailUrl, this.config.baseUrl).toString()
            : undefined;

          items.push({
            externalId,
            permalink: absolutePermalink,
            postedAt,
            author,
            authorUrl: absoluteAuthorUrl,
            title,
            caption,
            mediaType: mediaType as 'image' | 'gif' | 'video',
            mediaUrl: absoluteMediaUrl,
            thumbnailUrl: absoluteThumbnailUrl,
            durationMs,
            width,
            height,
            tags,
          });
        }
      } catch (error) {
        // Skip malformed items
        console.warn('Failed to parse item:', error);
      }
    });

    return items;
  }

  protected extractPaginationInfo(html: string): {
    currentPage: number;
    totalPages?: number;
    hasNextPage: boolean;
  } {
    const $ = cheerio.load(html);
    const selectors = this.htmlConfig.selectors;

    let currentPage = 1;
    let totalPages: number | undefined;
    let hasNextPage = false;

    // Extract current page
    if (selectors.currentPage) {
      const current = this.extractValue($('body'), selectors.currentPage);
      if (current) {
        currentPage = parseInt(current, 10) || 1;
      }
    }

    // Extract total pages
    if (selectors.totalPages) {
      const total = this.extractValue($('body'), selectors.totalPages);
      if (total) {
        totalPages = parseInt(total, 10);
      }
    } else if (selectors.lastPage) {
      // Try to get from last page link
      const lastPageHref = this.extractValue($('body'), selectors.lastPage);
      if (lastPageHref) {
        const match = lastPageHref.match(/\d+/);
        if (match) {
          totalPages = parseInt(match[0], 10);
        }
      }
    }

    // Fallback: scan pagination nav links for highest page number
    if (!totalPages) {
      let maxPage = 1;
      // Only look within pagination containers
      $('.pageNav a[href], .pagination a[href], nav.pages a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        // Match /page-N pattern (XenForo style)
        const pageMatch = href.match(/\/page-(\d+)/);
        if (pageMatch && pageMatch[1]) {
          const num = parseInt(pageMatch[1], 10);
          if (num > maxPage) maxPage = num;
        }
        // Match ?page=N pattern
        const queryMatch = href.match(/[?&]page=(\d+)/);
        if (queryMatch && queryMatch[1]) {
          const num = parseInt(queryMatch[1], 10);
          if (num > maxPage) maxPage = num;
        }
      });
      if (maxPage > 1) {
        totalPages = maxPage;
      }
    }

    // Determine if there's a next page
    if (selectors.nextPage) {
      hasNextPage = $(selectors.nextPage).length > 0;
    } else if (totalPages) {
      hasNextPage = currentPage < totalPages;
    }

    return { currentPage, totalPages, hasNextPage };
  }

  /**
   * Extract a value from an element using a selector config
   */
  private extractValue(
    $element: CheerioElement,
    selector: string | { attr: string; selector?: string } | undefined,
  ): string | undefined {
    if (!selector) return undefined;

    if (typeof selector === 'string') {
      // Simple selector - get text content
      const found = $element.find(selector);
      if (found.length > 0) {
        return found.first().text().trim();
      }
      // Maybe it's on the element itself
      return $element.text().trim();
    }

    // Object selector with optional child selector
    if ('attr' in selector) {
      if (selector.selector) {
        // Find child element first, then get attribute
        const found = $element.find(selector.selector);
        if (found.length > 0) {
          return found.first().attr(selector.attr)?.trim();
        }
        return undefined;
      }
      // Get attribute from element itself
      return $element.attr(selector.attr)?.trim();
    }

    return undefined;
  }

  /**
   * Extract media URL from an element
   */
  private extractMediaUrl(
    $element: CheerioElement,
    selector: string | { attr: string } | undefined,
    urlAttr = 'src',
  ): string | undefined {
    if (!selector) return undefined;

    let $media: CheerioElement;

    if (typeof selector === 'string') {
      $media = $element.find(selector);
    } else {
      $media = $element;
    }

    if ($media.length === 0) return undefined;

    // Try multiple common attributes
    const attrs = [urlAttr, 'src', 'data-src', 'href', 'data-url'];
    for (const attr of attrs) {
      const url = $media.attr(attr);
      if (url && !url.startsWith('data:')) {
        return url.trim();
      }
    }

    return undefined;
  }

  /**
   * Parse a timestamp string into a Date
   */
  private parseTimestamp(raw: string | undefined): Date | null {
    if (!raw) return null;

    // Try ISO format first
    const isoDate = new Date(raw);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    // Try Unix timestamp (seconds)
    const unixSeconds = parseInt(raw, 10);
    if (!isNaN(unixSeconds) && unixSeconds > 1000000000 && unixSeconds < 2000000000) {
      return new Date(unixSeconds * 1000);
    }

    // Try Unix timestamp (milliseconds)
    const unixMs = parseInt(raw, 10);
    if (!isNaN(unixMs) && unixMs > 1000000000000) {
      return new Date(unixMs);
    }

    // Try relative time parsing (e.g., "2 hours ago")
    const relativeMatch = raw.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
    if (relativeMatch && relativeMatch[1] && relativeMatch[2]) {
      const value = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2].toLowerCase();
      const now = new Date();

      const multipliers: Record<string, number> = {
        second: 1000,
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000,
      };

      return new Date(now.getTime() - value * (multipliers[unit] || 0));
    }

    return null;
  }

  /**
   * Parse a duration string into milliseconds
   */
  private parseDuration(raw: string | undefined): number | undefined {
    if (!raw) return undefined;

    // Try mm:ss format
    const mmssMatch = raw.match(/(\d+):(\d+)/);
    if (mmssMatch && mmssMatch[1] && mmssMatch[2]) {
      const minutes = parseInt(mmssMatch[1], 10);
      const seconds = parseInt(mmssMatch[2], 10);
      return (minutes * 60 + seconds) * 1000;
    }

    // Try seconds only
    const secondsMatch = raw.match(/(\d+)\s*s/i);
    if (secondsMatch && secondsMatch[1]) {
      return parseInt(secondsMatch[1], 10) * 1000;
    }

    // Try raw number (assume seconds)
    const rawNum = parseFloat(raw);
    if (!isNaN(rawNum)) {
      return rawNum * 1000;
    }

    return undefined;
  }
}

// Register the adapter
registerAdapter('generic-html', GenericHtmlAdapter);
