import {
  BaseAdapter,
  type SourceConfig,
  type ScrapedItem,
  type ScanResult,
  type PageInfo,
  registerAdapter,
} from './base-adapter.js';

const ITEMS_PER_PAGE = 40;

/**
 * RedGifs API Adapter
 *
 * Uses the RedGifs v2 JSON API to fetch GIFs/videos from user profiles.
 * Obtains a temporary auth token automatically.
 */
export class RedGifsAdapter extends BaseAdapter {
  private authToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: SourceConfig) {
    super(config);
  }

  /** Check if this thread targets a tag search vs a user profile */
  private isTagSearch(): boolean {
    return this.config.externalId.startsWith('tag:');
  }

  /** Check if this thread targets the explore/trending endpoint */
  private isExplore(): boolean {
    return this.config.externalId.startsWith('explore:');
  }

  /** Get the API URL based on thread type */
  private getSearchUrl(count: number, page: number): string {
    if (this.isExplore()) {
      const order = this.config.externalId.slice(8) || 'trending'; // remove 'explore:' prefix
      return `https://api.redgifs.com/v2/gifs/trending?order=${encodeURIComponent(order)}&count=${count}&page=${page}`;
    }
    if (this.isTagSearch()) {
      const tag = this.config.externalId.slice(4); // remove 'tag:' prefix
      return `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(tag)}&order=trending&count=${count}&page=${page}`;
    }
    const username = this.config.externalId;
    return `https://api.redgifs.com/v2/users/${username}/search?order=new&count=${count}&page=${page}`;
  }

  getName(): string {
    return 'redgifs';
  }

  private async getToken(): Promise<string> {
    if (this.authToken && Date.now() < this.tokenExpiry) {
      return this.authToken;
    }

    const res = await fetch('https://api.redgifs.com/v2/auth/temporary', {
      headers: { 'User-Agent': this.getUserAgent() },
    });

    if (!res.ok) {
      throw new Error(`Failed to get RedGifs auth token: HTTP ${res.status}`);
    }

    const data = await res.json() as { token: string };
    this.authToken = data.token;
    // Tokens last ~24h, refresh after 1h to be safe
    this.tokenExpiry = Date.now() + 60 * 60 * 1000;
    return this.authToken;
  }

  private async apiFetch(url: string, retries = 3): Promise<unknown> {
    const token = await this.getToken();
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': this.getUserAgent(),
      },
    });

    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      const delay = Math.max(retryAfter * 1000, 5000) * (4 - retries); // escalating backoff
      console.warn(`RedGifs 429 rate limited, waiting ${delay}ms before retry (${retries} left)`);
      await new Promise(r => setTimeout(r, delay));
      return this.apiFetch(url, retries - 1);
    }

    if (!res.ok) {
      throw new Error(`RedGifs API error: HTTP ${res.status} for ${url}`);
    }

    return res.json();
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      const data = await this.apiFetch(
        this.getSearchUrl(1, 1)
      ) as { total?: number };

      if (data.total === undefined) {
        return { valid: false, error: 'Could not read user feed' };
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
    const data = await this.apiFetch(
      this.getSearchUrl(ITEMS_PER_PAGE, 1)
    ) as { total: number; pages: number };

    const pages = Math.max(1, data.pages);

    // RedGifs page 1 = newest. Scanner walks backward from latestPage → 1,
    // so we set latestPage = pages and map directly (no reverse needed since
    // we want scanner page 1 = redgifs page 1 = newest).
    return {
      latestPage: pages,
      totalPages: pages,
      totalItems: data.total,
    };
  }

  async scanPage(pageNumber: number): Promise<ScanResult> {
    await this.respectRateLimit();

    // Scanner walks backward from latestPage → 1.
    // RedGifs page 1 = newest, which is what we want first.
    // Pass pageNumber directly — no reverse mapping needed.
    const redgifsPage = Math.max(1, pageNumber);

    const data = await this.apiFetch(
      this.getSearchUrl(ITEMS_PER_PAGE, redgifsPage)
    ) as {
      gifs: RedGifItem[];
      pages: number;
      total: number;
    };

    const items = this.parseApiResponse(data.gifs);

    return {
      items,
      pageNumber,
      hasMorePages: pageNumber > 1,
      totalItems: data.total,
    };
  }

  // Required by abstract class but not used for API-based adapter
  protected buildPageUrl(pageNumber: number): string {
    return this.getSearchUrl(ITEMS_PER_PAGE, pageNumber);
  }

  protected parsePageContent(_html: string, _pageNumber: number): ScrapedItem[] {
    return []; // Not used - we parse JSON directly
  }

  protected extractPaginationInfo(_html: string) {
    return { currentPage: 1, hasNextPage: false }; // Not used
  }

  private parseApiResponse(gifs: RedGifItem[]): ScrapedItem[] {
    const items: ScrapedItem[] = [];

    for (const gif of gifs) {
      const mediaUrl = gif.urls?.hd || gif.urls?.sd;
      if (!mediaUrl) continue;

      items.push({
        externalId: gif.id,
        permalink: `https://www.redgifs.com/watch/${gif.id}`,
        postedAt: new Date(gif.createDate * 1000),
        author: gif.userName || 'unknown',
        authorUrl: gif.userName ? `https://www.redgifs.com/users/${gif.userName}` : undefined,
        caption: gif.description || undefined,
        mediaType: 'gif',
        mediaUrl,
        thumbnailUrl: gif.urls?.thumbnail || gif.urls?.poster || undefined,
        durationMs: gif.duration ? Math.round(gif.duration * 1000) : undefined,
        width: gif.width || undefined,
        height: gif.height || undefined,
        tags: gif.tags || undefined,
        sourceMetrics: {
          likes: gif.likes,
          views: gif.views,
        },
      });
    }

    return items;
  }
}

interface RedGifItem {
  id: string;
  createDate: number;
  userName?: string;
  description?: string;
  duration?: number;
  width?: number;
  height?: number;
  likes?: number;
  views?: number;
  tags?: string[];
  urls?: {
    hd?: string;
    sd?: string;
    thumbnail?: string;
    poster?: string;
    silent?: string;
  };
}

// Register the adapter
registerAdapter('redgifs', RedGifsAdapter);
