/**
 * Asset within a media item (for galleries/albums)
 */
export interface ScrapedAsset {
  url: string;
  type: 'image' | 'gif' | 'video' | 'thumbnail';
  durationMs?: number;
  width?: number;
  height?: number;
}

/**
 * A scraped media item from a source
 */
export interface ScrapedItem {
  /** Unique identifier from the source (post ID, permalink, etc.) */
  externalId: string;
  /** Generated content fingerprint (set by scanner) */
  fingerprint?: string;
  /** Direct link to original post */
  permalink: string;
  /** When the content was originally posted */
  postedAt: Date;
  /** Author username/handle */
  author: string;
  /** Link to author profile */
  authorUrl?: string;
  /** Post title if available */
  title?: string;
  /** Post description/caption */
  caption?: string;
  /** Primary media type */
  mediaType: 'image' | 'gif' | 'video';
  /** Primary media URL */
  mediaUrl: string;
  /** Thumbnail URL */
  thumbnailUrl?: string;
  /** Duration in milliseconds (for video/gif) */
  durationMs?: number;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Additional assets (for galleries) */
  assets?: ScrapedAsset[];
  /** Tags/categories */
  tags?: string[];
  /** Original engagement counts from source */
  sourceMetrics?: {
    likes?: number;
    comments?: number;
    views?: number;
  };
}

/**
 * Result of scanning a single page
 */
export interface ScanResult {
  /** Items found on this page (ordered newest to oldest) */
  items: ScrapedItem[];
  /** Current page number */
  pageNumber: number;
  /** Whether there are more pages to scan */
  hasMorePages: boolean;
  /** Total items on source (if available) */
  totalItems?: number;
}

/**
 * Page information from the source
 */
export interface PageInfo {
  /** Latest/newest page number */
  latestPage: number;
  /** Total number of pages (if known) */
  totalPages?: number;
  /** Total items across all pages (if known) */
  totalItems?: number;
}

/**
 * Source configuration passed to adapters
 */
export interface SourceConfig {
  /** Source ID in our database */
  sourceId: string;
  /** Thread ID in our database */
  threadId: string;
  /** Base URL of the source */
  baseUrl: string;
  /** Thread-specific URL or path */
  threadUrl: string;
  /** External ID of the thread (board name, tag, etc.) */
  externalId: string;
  /** Rate limit configuration */
  rateLimit: {
    requestsPerMinute: number;
    burstSize?: number;
    crawlDelay?: number;
  };
  /** Custom user agent */
  userAgent?: string;
  /** Additional source-specific config */
  extra?: Record<string, unknown>;
}

/**
 * Base adapter interface for source scrapers
 *
 * Each source (forum, image board, etc.) implements this interface
 * to provide source-specific scraping logic while using the common
 * incremental scanning algorithm.
 */
export abstract class BaseAdapter {
  protected config: SourceConfig;

  constructor(config: SourceConfig) {
    this.config = config;
  }

  /**
   * Get information about the latest page
   * Used to determine where to start scanning
   */
  abstract getLatestPage(): Promise<PageInfo>;

  /**
   * Scan a specific page and extract items
   * Items should be returned newest to oldest
   *
   * @param pageNumber - The page to scan (1-indexed)
   */
  abstract scanPage(pageNumber: number): Promise<ScanResult>;

  /**
   * Validate that the source is accessible and configured correctly
   * Called before starting a scan
   */
  abstract validate(): Promise<{ valid: boolean; error?: string }>;

  /**
   * Get the adapter name for logging/metrics
   */
  abstract getName(): string;

  /**
   * Build the URL for a specific page
   */
  protected abstract buildPageUrl(pageNumber: number): string;

  /**
   * Parse the raw page content into structured items
   */
  protected abstract parsePageContent(html: string, pageNumber: number): ScrapedItem[];

  /**
   * Extract pagination info from the page
   */
  protected abstract extractPaginationInfo(html: string): {
    currentPage: number;
    totalPages?: number;
    hasNextPage: boolean;
  };

  /**
   * Get the configured rate limit delay in milliseconds
   */
  protected getRateLimitDelay(): number {
    const { requestsPerMinute, crawlDelay } = this.config.rateLimit;

    // Use explicit crawl delay if set
    if (crawlDelay) {
      return crawlDelay;
    }

    // Calculate from requests per minute
    return Math.ceil(60000 / requestsPerMinute);
  }

  /**
   * Get the user agent to use for requests
   */
  protected getUserAgent(): string {
    return this.config.userAgent ||
      'AggragifBot/1.0 (Media Aggregator; +https://aggragif.com/bot)';
  }

  /**
   * Sleep for the configured rate limit delay
   */
  protected async respectRateLimit(): Promise<void> {
    const delay = this.getRateLimitDelay();
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Registry of available adapters by source name
 */
export const adapterRegistry = new Map<string, new (config: SourceConfig) => BaseAdapter>();

/**
 * Register an adapter for a source type
 */
export function registerAdapter(name: string, adapter: new (config: SourceConfig) => BaseAdapter): void {
  adapterRegistry.set(name, adapter);
}

/**
 * Get an adapter for a source type
 */
// Map common mode names to adapter names
const MODE_ALIASES: Record<string, string> = {
  'scrape': 'generic-html',
  'html': 'generic-html',
  'api': 'redgifs',
};

export function getAdapter(name: string, config: SourceConfig): BaseAdapter | null {
  const resolvedName = MODE_ALIASES[name] || name;
  const AdapterClass = adapterRegistry.get(resolvedName);
  if (!AdapterClass) {
    return null;
  }
  return new AdapterClass(config);
}
