import {
  BaseAdapter,
  type SourceConfig,
  type ScrapedItem,
  type ScrapedAsset,
  type ScanResult,
  type PageInfo,
  registerAdapter,
} from './base-adapter.js';

const ITEMS_PER_PAGE = 25; // Reddit returns ~25 posts per page

/**
 * Reddit Adapter
 *
 * Uses Reddit's public JSON API (no auth required) to fetch posts
 * from subreddits sorted by newest. Extracts media URLs from
 * Reddit's media metadata (images, gifs, videos).
 */
export class RedditAdapter extends BaseAdapter {
  private afterCursors: Map<number, string> = new Map();

  getName(): string {
    return 'reddit';
  }

  async validate(): Promise<{ valid: boolean; error?: string }> {
    try {
      const subreddit = this.config.externalId;
      const res = await this.redditFetch(
        `https://www.reddit.com/r/${subreddit}/new.json?&limit=1`
      );
      const data = res as RedditListing;
      if (!data?.data?.children) {
        return { valid: false, error: 'Could not read subreddit' };
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
    // Reddit uses cursor-based pagination (after=t3_xxx), not page numbers.
    // We simulate page numbers: page 1 = newest, page 2 = next batch, etc.
    // The scanner walks backward from latestPage → 1, so we set latestPage
    // to a reasonable depth (e.g., 10 pages = ~250 posts for first run).
    return {
      latestPage: 10,
      totalPages: 10,
    };
  }

  async scanPage(pageNumber: number): Promise<ScanResult> {
    await this.respectRateLimit();

    const subreddit = this.config.externalId;
    // Scanner walks backward: page 10 → 9 → ... → 1
    // We want page 10 (scanner's start) = newest, page 1 = oldest
    // So reverse-map: scanner page N → reddit page (totalPages - N + 1)
    const redditPage = 10 - pageNumber + 1;

    let url = `https://www.reddit.com/r/${subreddit}/new.json?&limit=${ITEMS_PER_PAGE}&raw_json=1`;

    // For pages beyond the first, use the 'after' cursor from previous page
    if (redditPage > 1) {
      const prevCursor = this.afterCursors.get(redditPage - 1);
      if (prevCursor) {
        url += `&after=${prevCursor}`;
      } else {
        // Need to fetch pages sequentially to get cursors
        await this.fetchUpToPage(redditPage);
        const cursor = this.afterCursors.get(redditPage - 1);
        if (cursor) {
          url += `&after=${cursor}`;
        }
      }
    }

    const data = await this.redditFetch(url) as RedditListing;
    const after = data.data?.after;
    if (after) {
      this.afterCursors.set(redditPage, after);
    }

    const items = this.parseRedditPosts(data.data?.children || []);

    return {
      items,
      pageNumber,
      hasMorePages: pageNumber > 1 && !!after,
    };
  }

  private async fetchUpToPage(targetPage: number): Promise<void> {
    const subreddit = this.config.externalId;

    for (let page = 1; page < targetPage; page++) {
      if (this.afterCursors.has(page)) continue;

      let url = `https://www.reddit.com/r/${subreddit}/new.json?&limit=${ITEMS_PER_PAGE}&raw_json=1`;
      if (page > 1) {
        const prevCursor = this.afterCursors.get(page - 1);
        if (prevCursor) url += `&after=${prevCursor}`;
      }

      await this.respectRateLimit();
      const data = await this.redditFetch(url) as RedditListing;
      const after = data.data?.after;
      if (after) {
        this.afterCursors.set(page, after);
      } else {
        break; // No more pages
      }
    }
  }

  private async redditFetch(url: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: {
        'User-Agent': this.getUserAgent(),
        'Accept': 'application/json',
      },
    });

    if (res.status === 429) {
      // Rate limited — wait and retry once
      await new Promise(r => setTimeout(r, 5000));
      const retry = await fetch(url, {
        headers: {
          'User-Agent': this.getUserAgent(),
          'Accept': 'application/json',
        },
      });
      if (!retry.ok) throw new Error(`Reddit API error: HTTP ${retry.status}`);
      return retry.json();
    }

    if (!res.ok) {
      throw new Error(`Reddit API error: HTTP ${res.status} for ${url}`);
    }

    return res.json();
  }

  private parseRedditPosts(children: RedditChild[]): ScrapedItem[] {
    const items: ScrapedItem[] = [];

    for (const child of children) {
      const post = child.data;
      if (!post) continue;

      // Skip self-posts (text only), stickied, removed
      if (post.is_self || post.stickied || post.removed_by_category) continue;

      const mediaInfo = this.extractMedia(post);
      if (!mediaInfo) continue;

      items.push({
        externalId: post.id,
        permalink: `https://www.reddit.com${post.permalink}`,
        postedAt: new Date(post.created_utc * 1000),
        author: post.author || '[deleted]',
        authorUrl: post.author ? `https://www.reddit.com/u/${post.author}` : undefined,
        title: post.title || undefined,
        caption: undefined,
        mediaType: mediaInfo.type,
        mediaUrl: mediaInfo.url,
        thumbnailUrl: mediaInfo.thumbnail,
        width: mediaInfo.width,
        height: mediaInfo.height,
        durationMs: mediaInfo.durationMs,
        assets: mediaInfo.assets,
        tags: post.link_flair_text ? [post.link_flair_text] : undefined,
        sourceMetrics: {
          likes: post.ups,
          comments: post.num_comments,
          views: undefined,
        },
      });
    }

    return items;
  }

  private extractMedia(post: RedditPost): {
    type: 'image' | 'gif' | 'video';
    url: string;
    thumbnail?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    assets?: ScrapedAsset[];
  } | null {
    // 1. Reddit-hosted video (v.redd.it)
    if (post.is_video && post.media?.reddit_video) {
      const rv = post.media.reddit_video;
      return {
        type: 'video',
        url: rv.fallback_url || rv.hls_url || rv.dash_url || '',
        thumbnail: this.getBestThumbnail(post),
        width: rv.width,
        height: rv.height,
        durationMs: rv.duration ? rv.duration * 1000 : undefined,
      };
    }

    // 2. Crosspost with video
    if (post.crosspost_parent_list?.length) {
      const xpost = post.crosspost_parent_list[0];
      if (xpost?.is_video && xpost.media?.reddit_video) {
        const rv = xpost.media.reddit_video;
        return {
          type: 'video',
          url: rv.fallback_url || rv.hls_url || rv.dash_url || '',
          thumbnail: this.getBestThumbnail(post),
          width: rv.width,
          height: rv.height,
          durationMs: rv.duration ? rv.duration * 1000 : undefined,
        };
      }
    }

    // 3. RedGifs / external video embeds
    if (post.media?.oembed || post.secure_media?.oembed) {
      const oembed = post.secure_media?.oembed || post.media?.oembed;
      if (oembed?.provider_name?.toLowerCase() === 'redgifs') {
        // Skip — we ingest RedGifs directly via the RedGifs adapter
        return null;
      }
    }

    // 4. Reddit gallery (multiple images)
    if (post.is_gallery && post.media_metadata) {
      // Use gallery_data.items for ordering if available, otherwise iterate metadata
      const orderedIds: string[] = post.gallery_data?.items?.map(i => i.media_id) ||
        Object.keys(post.media_metadata);

      const allAssets: ScrapedAsset[] = [];
      let primaryUrl: string | null = null;
      let primaryType: 'image' | 'gif' = 'image';
      let primaryWidth: number | undefined;
      let primaryHeight: number | undefined;

      for (const mediaId of orderedIds) {
        const media = post.media_metadata[mediaId];
        if (!media) continue;
        const m = media as RedditMediaMeta;
        if (m.status !== 'valid') continue;
        const source = m.s;
        if (!source) continue;

        const assetUrl = source.gif || source.u;
        const assetType: 'image' | 'gif' = source.gif ? 'gif' : 'image';
        if (!assetUrl) continue;

        allAssets.push({
          url: assetUrl,
          type: assetType,
          width: source.x,
          height: source.y,
        });

        // First valid asset becomes the primary media
        if (!primaryUrl) {
          primaryUrl = assetUrl;
          primaryType = assetType;
          primaryWidth = source.x;
          primaryHeight = source.y;
        }
      }

      if (!primaryUrl) return null;

      return {
        type: primaryType,
        url: primaryUrl,
        thumbnail: this.getBestThumbnail(post),
        width: primaryWidth,
        height: primaryHeight,
        assets: allAssets.length > 1 ? allAssets : undefined,
      };
    }

    // 5. Direct image/gif URL
    const url = post.url_overridden_by_dest || post.url || '';

    if (/\.(gif)$/i.test(url)) {
      return {
        type: 'gif',
        url,
        thumbnail: this.getBestThumbnail(post),
        width: post.preview?.images?.[0]?.source?.width,
        height: post.preview?.images?.[0]?.source?.height,
      };
    }

    if (/\.(jpe?g|png|webp)$/i.test(url) || url.includes('i.redd.it') || url.includes('i.imgur.com')) {
      // For i.redd.it/i.imgur links without extension, still treat as image
      return {
        type: 'image',
        url,
        thumbnail: this.getBestThumbnail(post),
        width: post.preview?.images?.[0]?.source?.width,
        height: post.preview?.images?.[0]?.source?.height,
      };
    }

    // 6. Reddit preview with gif variant (mp4)
    if (post.preview?.images?.[0]?.variants?.mp4?.source?.url) {
      const mp4 = post.preview.images[0].variants.mp4.source;
      return {
        type: 'gif',
        url: mp4.url,
        thumbnail: this.getBestThumbnail(post),
        width: mp4.width,
        height: mp4.height,
      };
    }

    // 7. Reddit preview with gif variant (gif)
    if (post.preview?.images?.[0]?.variants?.gif?.source?.url) {
      const gif = post.preview.images[0].variants.gif.source;
      return {
        type: 'gif',
        url: gif.url,
        thumbnail: this.getBestThumbnail(post),
        width: gif.width,
        height: gif.height,
      };
    }

    // 8. Imgur gifv → mp4
    if (url.includes('imgur.com') && url.endsWith('.gifv')) {
      return {
        type: 'gif',
        url: url.replace('.gifv', '.mp4'),
        thumbnail: this.getBestThumbnail(post),
      };
    }

    return null;
  }

  private getBestThumbnail(post: RedditPost): string | undefined {
    // Use highest-resolution preview image
    const images = post.preview?.images?.[0];
    if (images?.source?.url) {
      return images.source.url;
    }
    // Fall back to Reddit's thumbnail — but skip tiny thumbs.redditmedia.com
    if (post.thumbnail && post.thumbnail !== 'default' && post.thumbnail !== 'self' && post.thumbnail !== 'nsfw' && !post.thumbnail.includes('thumbs.redditmedia.com')) {
      return post.thumbnail;
    }
    return undefined;
  }

  // Required by abstract class but not used for API-based adapter
  protected buildPageUrl(_pageNumber: number): string {
    return '';
  }

  protected parsePageContent(_html: string, _pageNumber: number): ScrapedItem[] {
    return [];
  }

  protected extractPaginationInfo(_html: string) {
    return { currentPage: 1, hasNextPage: false };
  }
}

// --- Reddit JSON API Types ---

interface RedditListing {
  data?: {
    children: RedditChild[];
    after?: string;
    before?: string;
  };
}

interface RedditChild {
  kind: string;
  data?: RedditPost;
}

interface RedditPost {
  id: string;
  name: string; // fullname like t3_abc123
  title?: string;
  author?: string;
  permalink: string;
  url?: string;
  url_overridden_by_dest?: string;
  created_utc: number;
  ups: number;
  num_comments: number;
  is_self: boolean;
  is_video: boolean;
  is_gallery?: boolean;
  stickied: boolean;
  removed_by_category?: string;
  link_flair_text?: string;
  thumbnail?: string;
  media?: {
    reddit_video?: RedditVideo;
    oembed?: { provider_name?: string };
  };
  secure_media?: {
    reddit_video?: RedditVideo;
    oembed?: { provider_name?: string };
  };
  media_metadata?: Record<string, unknown>;
  preview?: {
    images?: Array<{
      source?: { url: string; width: number; height: number };
      resolutions?: Array<{ url: string; width: number; height: number }>;
      variants?: {
        gif?: { source?: { url: string; width: number; height: number } };
        mp4?: { source?: { url: string; width: number; height: number } };
      };
    }>;
  };
  crosspost_parent_list?: RedditPost[];
  gallery_data?: {
    items: Array<{ media_id: string; id: number }>;
  };
}

interface RedditVideo {
  fallback_url?: string;
  hls_url?: string;
  dash_url?: string;
  width?: number;
  height?: number;
  duration?: number;
}

interface RedditMediaMeta {
  status: string;
  s?: {
    u?: string; // image URL
    gif?: string; // gif URL
    mp4?: string; // mp4 URL
    x?: number; // width
    y?: number; // height
  };
}

// Register the adapter
registerAdapter('reddit', RedditAdapter);
