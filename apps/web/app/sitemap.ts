import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tandagallery.com';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const apiBase = process.env.API_URL
    ? `${process.env.API_URL}/api/v1`
    : process.env.NEXT_PUBLIC_API_URL || '/api/v1';

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/trending`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/tags`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
  ];

  // Dynamic media pages
  let mediaPages: MetadataRoute.Sitemap = [];
  try {
    const response = await fetch(`${apiBase}/feed?limit=200`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      mediaPages = data.items.map((item: { id: string; publishedAt?: string }) => ({
        url: `${SITE_URL}/media/${item.id}`,
        lastModified: item.publishedAt ? new Date(item.publishedAt) : new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }));
    }
  } catch {
    // Sitemap generation should not fail if API is down
  }

  // Dynamic tag pages
  let tagPages: MetadataRoute.Sitemap = [];
  try {
    const response = await fetch(`${apiBase}/feed/tags`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      tagPages = data.tags.map((tag: { name: string }) => ({
        url: `${SITE_URL}/tags/${encodeURIComponent(tag.name)}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.6,
      }));
    }
  } catch {
    // Sitemap generation should not fail if API is down
  }

  return [...staticPages, ...mediaPages, ...tagPages];
}
