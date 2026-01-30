'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { userApi } from '@/lib/api';
import { MediaCard } from '@/components/feed/media-card';

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login');
    }
  }, [authLoading, isAuthenticated, router]);

  const likesQuery = useInfiniteQuery({
    queryKey: ['my-likes'],
    queryFn: async ({ pageParam }) => {
      return userApi.getLikes({ cursor: pageParam, limit: 24 });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
    enabled: isAuthenticated,
  });

  const allItems = likesQuery.data?.pages.flatMap((page) => page.items) || [];

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry?.isIntersecting && likesQuery.hasNextPage && !likesQuery.isFetchingNextPage) {
        likesQuery.fetchNextPage();
      }
    },
    [likesQuery]
  );

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    observerRef.current = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: '400px',
      threshold: 0,
    });

    observerRef.current.observe(element);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleObserver]);


  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-caption">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  return (
    <>
      <div className="min-h-screen">
        <section className="container-wide py-16">
          <div className="max-w-3xl">
            {/* Profile header */}
            <div className="flex items-start gap-6 mb-8 fade-in">
              <div className="w-20 h-20 bg-[var(--border)] flex items-center justify-center text-2xl font-medium text-[var(--muted)]">
                {(user.displayName || user.username).charAt(0).toUpperCase()}
              </div>

              <div className="flex-1">
                <h1 className="text-title mb-1">
                  {user.displayName || user.username}
                </h1>
                <p className="text-caption mb-3">@{user.username}</p>
              </div>
            </div>

            <h2 className="text-sm text-[var(--muted)] mb-4 fade-in fade-in-delay-1">Liked items</h2>
          </div>
        </section>

        {/* Likes content */}
        <section className="py-1">
          {likesQuery.isLoading ? (
            <div className="feed-grid">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="media-card">
                  <div className="media-card-inner skeleton" />
                </div>
              ))}
            </div>
          ) : likesQuery.isError ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-[var(--fg)] mb-2">Failed to load</p>
              <p className="text-caption">
                {likesQuery.error instanceof Error ? likesQuery.error.message : 'Unknown error'}
              </p>
            </div>
          ) : allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center fade-in">
              <p className="text-[var(--fg)] mb-2">No likes yet</p>
              <p className="text-caption mb-6">
                Items you like will appear here
              </p>
              <Link href="/" className="btn">
                Browse feed
              </Link>
            </div>
          ) : (
            <>
              <div className="feed-grid stagger-children">
                {allItems.map((item, index) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    index={index}

                  />
                ))}
              </div>

              <div ref={loadMoreRef} className="flex justify-center py-12">
                {likesQuery.isFetchingNextPage ? (
                  <div className="flex items-center gap-3 text-caption">
                    <span className="inline-block w-4 h-4 border border-[var(--border)] border-t-[var(--fg)] rounded-full animate-spin" />
                    Loading
                  </div>
                ) : likesQuery.hasNextPage ? (
                  <div className="h-8" />
                ) : (
                  <p className="text-caption">
                    {allItems.length} liked {allItems.length === 1 ? 'item' : 'items'}
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

    </>
  );
}
