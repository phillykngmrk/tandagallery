import type { Metadata } from 'next';
import { MediaDetailClient } from './client';

interface Props {
  params: Promise<{ id: string }>;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tandagallery.com';

async function fetchMedia(id: string) {
  const apiBase = process.env.API_URL
    ? `${process.env.API_URL}/api/v1`
    : process.env.NEXT_PUBLIC_API_URL || '/api/v1';
  const response = await fetch(
    `${apiBase}/media/${id}`,
    { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) }
  );
  if (!response.ok) return null;
  return response.json();
}

// Server-side metadata generation for SEO
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const item = await fetchMedia(id);

    if (!item) {
      return {
        title: 'Media Not Found',
        description: 'This content may have been removed or is unavailable.',
      };
    }

    const title = item.title || `${item.type === 'video' ? 'Video' : item.type === 'gif' ? 'GIF' : 'Image'} on T & A Gallery`;
    const description = item.description || `View this ${item.type} on T & A Gallery. ${item.tags?.length ? `Tags: ${item.tags.join(', ')}` : ''}`.trim();
    const pageUrl = `${SITE_URL}/media/${id}`;

    return {
      title,
      description,
      alternates: {
        canonical: `/media/${id}`,
      },
      openGraph: {
        title,
        description,
        url: pageUrl,
        type: item.type === 'video' ? 'video.other' : 'article',
        images: [
          {
            url: item.thumbnailUrl,
            width: item.width || 800,
            height: item.height || 600,
            alt: item.title || `${item.type} media content`,
          },
        ],
        ...(item.type === 'video' && {
          videos: [
            {
              url: item.mediaUrl,
              width: item.width || 800,
              height: item.height || 600,
              type: 'video/mp4',
            },
          ],
        }),
      },
      twitter: {
        card: item.type === 'video' ? 'player' : 'summary_large_image',
        title,
        description,
        images: [item.thumbnailUrl],
      },
    };
  } catch {
    return {
      title: 'Media',
      description: 'View media on T & A Gallery',
    };
  }
}

export default async function MediaDetailPage({ params }: Props) {
  const { id } = await params;
  const item = await fetchMedia(id);

  // JSON-LD structured data for media items
  let jsonLd = null;
  if (item) {
    const isVideo = item.type === 'video' || item.type === 'gif';
    jsonLd = isVideo
      ? {
          '@context': 'https://schema.org',
          '@type': 'VideoObject',
          name: item.title || 'Video',
          description: item.description || `A ${item.type} on T & A Gallery`,
          thumbnailUrl: item.thumbnailUrl,
          contentUrl: item.mediaUrl,
          uploadDate: item.publishedAt || item.ingestedAt,
          duration: item.duration ? `PT${Math.floor(item.duration / 60)}M${Math.floor(item.duration % 60)}S` : undefined,
          width: item.width,
          height: item.height,
          interactionStatistic: [
            {
              '@type': 'InteractionCounter',
              interactionType: 'https://schema.org/LikeAction',
              userInteractionCount: item.likeCount,
            },
            {
              '@type': 'InteractionCounter',
              interactionType: 'https://schema.org/CommentAction',
              userInteractionCount: item.commentCount,
            },
            {
              '@type': 'InteractionCounter',
              interactionType: 'https://schema.org/WatchAction',
              userInteractionCount: item.viewCount,
            },
          ],
          ...(item.author && {
            author: {
              '@type': 'Person',
              name: item.author,
              ...(item.authorUrl && { url: item.authorUrl }),
            },
          }),
          keywords: item.tags?.join(', '),
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'ImageObject',
          name: item.title || 'Image',
          description: item.description || `An image on T & A Gallery`,
          contentUrl: item.mediaUrl,
          thumbnailUrl: item.thumbnailUrl,
          uploadDate: item.publishedAt || item.ingestedAt,
          width: item.width,
          height: item.height,
          ...(item.author && {
            author: {
              '@type': 'Person',
              name: item.author,
              ...(item.authorUrl && { url: item.authorUrl }),
            },
          }),
          keywords: item.tags?.join(', '),
        };
  }

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <MediaDetailClient id={id} />
    </>
  );
}
