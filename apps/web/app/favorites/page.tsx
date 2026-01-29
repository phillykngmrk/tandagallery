'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { userApi } from '@/lib/api';
import { MediaCard } from '@/components/feed/media-card';
import { MediaViewer } from '@/components/media/media-viewer';
import { useState, useRef, useCallback } from 'react';
import type { MediaItemSummary } from '@aggragif/shared';

export default function FavoritesPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [selectedItem, setSelectedItem] = useState<MediaItemSummary | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login');
    }
  }, [authLoading, isAuthenticated, router]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: ['favorites'],
    queryFn: async ({ pageParam }) => {
      return userApi.getFavorites({ cursor: pageParam, limit: 24 });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
    enabled: isAuthenticated,
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    observerRef.current = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: '200px',
      threshold: 0,
    });

    observerRef.current.observe(element);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleObserver]);

  const allItems = data?.pages.flatMap((page) => page.items) || [];

  const handleSelectItem = (item: MediaItemSummary) => {
    const index = allItems.findIndex((i) => i.id === item.id);
    setSelectedItem(item);
    setSelectedIndex(index);
  };

  const handleNext = () => {
    if (selectedIndex < allItems.length - 1) {
      const nextItem = allItems[selectedIndex + 1];
      if (nextItem) {
        setSelectedItem(nextItem);
        setSelectedIndex(selectedIndex + 1);
      }
    }
  };

  const handlePrevious = () => {
    if (selectedIndex > 0) {
      const prevItem = allItems[selectedIndex - 1];
      if (prevItem) {
        setSelectedItem(prevItem);
        setSelectedIndex(selectedIndex - 1);
      }
    }
  };

  const handleClose = () => {
    setSelectedItem(null);
    setSelectedIndex(-1);
    window.history.pushState({}, '', '/favorites');
  };

  // Auth loading state
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-caption">Loading...</div>
      </div>
    );
  }

  // Not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  // Data loading state
  if (isLoading) {
    return (
      <div className="min-h-screen">
        <section className="container-wide py-16">
          <div className="max-w-3xl">
            <h1 className="text-display mb-6 fade-in">Favorites</h1>
            <p className="text-body text-[var(--muted)] fade-in fade-in-delay-1">
              Your saved collection
            </p>
          </div>
        </section>
        <div className="divider" />
        <section className="py-1">
          <div className="feed-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="media-card">
                <div className="media-card-inner skeleton" />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="min-h-screen">
        <section className="container-wide py-16">
          <div className="max-w-3xl">
            <h1 className="text-display mb-6">Favorites</h1>
          </div>
        </section>
        <div className="divider" />
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-[var(--fg)] mb-2">Failed to load favorites</p>
          <p className="text-caption">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  // Empty state
  if (allItems.length === 0) {
    return (
      <div className="min-h-screen">
        <section className="container-wide py-16">
          <div className="max-w-3xl">
            <h1 className="text-display mb-6 fade-in">Favorites</h1>
            <p className="text-body text-[var(--muted)] fade-in fade-in-delay-1">
              Your saved collection
            </p>
          </div>
        </section>
        <div className="divider" />
        <div className="flex flex-col items-center justify-center py-24 text-center fade-in fade-in-delay-2">
          <p className="text-[var(--fg)] mb-2">No favorites yet</p>
          <p className="text-caption mb-6">
            Save items from the feed to build your collection
          </p>
          <a href="/" className="btn">
            Browse feed
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen">
        <section className="container-wide py-16">
          <div className="max-w-3xl">
            <h1 className="text-display mb-6 fade-in">Favorites</h1>
            <p className="text-body text-[var(--muted)] fade-in fade-in-delay-1">
              {allItems.length} saved {allItems.length === 1 ? 'item' : 'items'}
            </p>
          </div>
        </section>

        <div className="divider" />

        <section className="py-1">
          <div className="feed-grid stagger-children">
            {allItems.map((item, index) => (
              <MediaCard
                key={item.id}
                item={item}
                index={index}
                onSelect={handleSelectItem}
              />
            ))}
          </div>

          <div ref={loadMoreRef} className="flex justify-center py-12">
            {isFetchingNextPage ? (
              <div className="flex items-center gap-3 text-caption">
                <span className="inline-block w-4 h-4 border border-[var(--border)] border-t-[var(--fg)] rounded-full animate-spin" />
                Loading
              </div>
            ) : hasNextPage ? (
              <div className="h-8" />
            ) : (
              <p className="text-caption">End of favorites</p>
            )}
          </div>
        </section>
      </div>

      <MediaViewer
        item={selectedItem}
        onClose={handleClose}
        onNext={handleNext}
        onPrevious={handlePrevious}
        hasNext={selectedIndex < allItems.length - 1}
        hasPrevious={selectedIndex > 0}
      />
    </>
  );
}
