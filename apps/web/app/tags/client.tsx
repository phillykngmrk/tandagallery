'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { feedApi } from '@/lib/api';

export function TagsClient() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tags'],
    queryFn: () => feedApi.getTags(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="min-h-screen">
      {/* Hero section */}
      <section className="container-wide py-16 md:py-24">
        <div className="max-w-3xl">
          <h1 className="text-display mb-6 fade-in">
            Tags
          </h1>
          <p className="text-body text-[var(--muted)] max-w-xl fade-in fade-in-delay-1">
            Browse content by tag.
          </p>
        </div>
      </section>

      {/* Divider */}
      <div className="divider" />

      {/* Tags grid */}
      <section className="container-wide py-12">
        {isLoading ? (
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ width: 120, height: 44 }} />
            ))}
          </div>
        ) : isError ? (
          <p className="text-caption">Failed to load tags</p>
        ) : !data?.tags?.length ? (
          <p className="text-caption">No tags found</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {data.tags.map((tag) => (
              <Link
                key={tag.name}
                href={`/tags/${encodeURIComponent(tag.name)}`}
                className="tag-item"
              >
                <span>{tag.name}</span>
                <span className="text-[var(--muted)] text-xs ml-2 font-mono">{tag.count}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
