import type { Metadata } from 'next';
import { MediaDetailClient } from './client';

interface Props {
  params: Promise<{ id: string }>;
}

// Server-side metadata generation for SEO
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/media/${id}`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) {
      return {
        title: 'Media Not Found',
        description: 'This content may have been removed or is unavailable.',
      };
    }

    const item = await response.json();

    return {
      title: item.title || 'Media',
      description: item.description || `View this ${item.type} on Tits & Ass Gallery`,
      openGraph: {
        title: item.title || 'Media on Tits & Ass Gallery',
        description: item.description || `View this ${item.type} on Tits & Ass Gallery`,
        type: item.type === 'video' ? 'video.other' : 'article',
        images: [
          {
            url: item.thumbnailUrl,
            width: item.width || 800,
            height: item.height || 600,
            alt: item.title || 'Media thumbnail',
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
        title: item.title || 'Media on Tits & Ass Gallery',
        description: item.description || `View this ${item.type} on Tits & Ass Gallery`,
        images: [item.thumbnailUrl],
      },
    };
  } catch {
    return {
      title: 'Media',
      description: 'View media on Tits & Ass Gallery',
    };
  }
}

export default async function MediaDetailPage({ params }: Props) {
  const { id } = await params;
  return <MediaDetailClient id={id} />;
}
