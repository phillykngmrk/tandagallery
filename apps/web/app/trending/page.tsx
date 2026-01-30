import type { Metadata } from 'next';
import { MostViewedClient } from './client';

export const metadata: Metadata = {
  title: 'Most Viewed GIFs & Videos — Trending Now',
  description: 'See the most viewed GIFs and short videos on T & A Gallery. Discover trending and popular content sorted by view count.',
  alternates: {
    canonical: '/trending',
  },
};

export default function TrendingPage() {
  return <MostViewedClient />;
}
