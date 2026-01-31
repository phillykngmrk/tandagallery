'use client';

import { InfiniteFeed } from '@/components/feed/infinite-feed';

interface SearchClientProps {
  query: string;
}

export function SearchClient({ query }: SearchClientProps) {
  return (
    <div className="min-h-screen">
      {/* Hero section */}
      <section className="container-wide py-16 md:py-24">
        <div className="max-w-3xl">
          {query ? (
            <h1 className="text-display mb-6 fade-in">
              Results for &ldquo;{query}&rdquo;
            </h1>
          ) : (
            <h1 className="text-display mb-6 fade-in">Search</h1>
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="divider" />

      {/* Feed section */}
      <section className="py-1">
        {query ? (
          <InfiniteFeed type="search" searchQuery={query} />
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[var(--fg)] mb-2">Enter a search term</p>
            <p className="text-caption">Use the search bar above to find content</p>
          </div>
        )}
      </section>
    </div>
  );
}
