'use client';

import Link from 'next/link';
import { InfiniteFeed } from '@/components/feed/infinite-feed';

interface TagPageClientProps {
  tag: string;
}

export function TagPageClient({ tag }: TagPageClientProps) {
  return (
    <div className="min-h-screen">
      {/* Hero section */}
      <section className="container-wide py-16 md:py-24">
        <div className="max-w-3xl">
          <Link href="/tags" className="text-caption hover:text-[var(--fg)] transition-colors mb-4 inline-block">
            &larr; All Tags
          </Link>
          <h1 className="text-display mb-6 fade-in">
            {tag}
          </h1>
        </div>
      </section>

      {/* Divider */}
      <div className="divider" />

      {/* Feed section */}
      <section className="py-1">
        <InfiniteFeed tag={tag} />
      </section>
    </div>
  );
}
