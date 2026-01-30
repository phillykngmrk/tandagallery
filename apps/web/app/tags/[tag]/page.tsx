import type { Metadata } from 'next';
import { TagPageClient } from './client';

interface Props {
  params: Promise<{ tag: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);

  return {
    title: `${decodedTag} GIFs & Videos`,
    description: `Browse the best ${decodedTag} GIFs and short videos. Curated ${decodedTag} content updated continuously on T & A Gallery.`,
    alternates: {
      canonical: `/tags/${tag}`,
    },
    openGraph: {
      title: `${decodedTag} GIFs & Videos | T & A Gallery`,
      description: `Browse the best ${decodedTag} GIFs and short videos.`,
    },
  };
}

export default async function TagPage({ params }: Props) {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${decodedTag} GIFs & Videos`,
    description: `Curated ${decodedTag} GIFs and short videos on T & A Gallery.`,
    url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tandagallery.com'}/tags/${tag}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <TagPageClient tag={decodedTag} />
    </>
  );
}
