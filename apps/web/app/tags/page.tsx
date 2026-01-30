import type { Metadata } from 'next';
import { TagsClient } from './client';

export const metadata: Metadata = {
  title: 'Browse Tags — GIFs & Videos by Category',
  description: 'Explore GIFs and short videos organized by tags and categories. Find curated content across dozens of topics on T & A Gallery.',
  alternates: {
    canonical: '/tags',
  },
};

export default function TagsPage() {
  return <TagsClient />;
}
