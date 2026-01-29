'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useCallback, useState } from 'react';
import { feedApi } from '@/lib/api';
import { MediaCard } from './media-card';
import { MediaViewer } from '../media/media-viewer';
import type { MediaItemSummary } from '@aggragif/shared';

interface InfiniteFeedProps {
  type?: 'recent' | 'trending';
  mediaType?: string;
  period?: string;
  tag?: string;
}

export function InfiniteFeed({ type = 'recent', mediaType, period, tag }: InfiniteFeedProps) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Selected item for overlay viewer
  const [selectedItem, setSelectedItem] = useState<MediaItemSummary | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: ['feed', type, mediaType, period, tag],
    queryFn: async ({ pageParam }) => {
      if (type === 'trending') {
        return feedApi.getTrending({ cursor: pageParam, limit: 48, period });
      }
      return feedApi.getFeed({ cursor: pageParam, limit: 48, type: mediaType, tag });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
    staleTime: 60 * 1000, // 1 minute
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
      rootMargin: '800px',
      threshold: 0,
    });

    observerRef.current.observe(element);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleObserver]);

  const allItems = (() => {
    const items = data?.pages.flatMap((page) => page.items) || [];
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  })();

  // Handle item selection
  const handleSelectItem = (item: MediaItemSummary) => {
    const index = allItems.findIndex((i) => i.id === item.id);
    setSelectedItem(item);
    setSelectedIndex(index);
  };

  // Navigate to next/previous
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
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="feed-grid">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="media-card">
            <div className="media-card-inner skeleton" />
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-[var(--fg)] mb-2">Failed to load feed</p>
        <p className="text-caption">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  // Empty state
  if (allItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-[var(--fg)] mb-2">No items yet</p>
        <p className="text-caption">Check back later for new content</p>
      </div>
    );
  }

  return (
    <>
      {/* Grid */}
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

      {/* Load more trigger */}
      <div ref={loadMoreRef} className="flex justify-center py-12">
        {isFetchingNextPage ? (
          <div className="flex items-center gap-3 text-caption">
            <span className="inline-block w-4 h-4 border border-[var(--border)] border-t-[var(--fg)] rounded-full animate-spin" />
            Loading
          </div>
        ) : hasNextPage ? (
          <div className="h-8" />
        ) : (
          <p className="text-caption">End of feed</p>
        )}
      </div>

      {/* Media viewer overlay */}
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
