'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { userApi } from '@/lib/api';
import { MediaCard } from '@/components/feed/media-card';
import { MediaViewer } from '@/components/media/media-viewer';
import type { MediaItemSummary } from '@aggragif/shared';

type Tab = 'likes' | 'favorites';

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('likes');

  const [selectedItem, setSelectedItem] = useState<MediaItemSummary | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

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
    enabled: isAuthenticated && activeTab === 'likes',
  });

  const favoritesQuery = useInfiniteQuery({
    queryKey: ['favorites'],
    queryFn: async ({ pageParam }) => {
      return userApi.getFavorites({ cursor: pageParam, limit: 24 });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
    enabled: isAuthenticated && activeTab === 'favorites',
  });

  const activeQuery = activeTab === 'likes' ? likesQuery : favoritesQuery;
  const allItems = activeQuery.data?.pages.flatMap((page) => page.items) || [];

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry?.isIntersecting && activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
        activeQuery.fetchNextPage();
      }
    },
    [activeQuery]
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
  };

  // Clear selection when switching tabs
  useEffect(() => {
    handleClose();
  }, [activeTab]);

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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'likes', label: 'Likes' },
    { id: 'favorites', label: 'Favorites' },
  ];

  const likeCount = likesQuery.data?.pages[0]?.items.length ?? 0;
  const favCount = favoritesQuery.data?.pages[0]?.items.length ?? 0;

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

            {/* Tabs */}
            <div className="flex gap-6 border-b border-[var(--border)] fade-in fade-in-delay-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`pb-4 text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'text-[var(--fg)] border-b border-[var(--fg)]'
                      : 'text-[var(--muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Tab content */}
        <section className="py-1">
          {activeQuery.isLoading ? (
            <div className="feed-grid">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="media-card">
                  <div className="media-card-inner skeleton" />
                </div>
              ))}
            </div>
          ) : activeQuery.isError ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-[var(--fg)] mb-2">Failed to load</p>
              <p className="text-caption">
                {activeQuery.error instanceof Error ? activeQuery.error.message : 'Unknown error'}
              </p>
            </div>
          ) : allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center fade-in">
              <p className="text-[var(--fg)] mb-2">
                {activeTab === 'likes' ? 'No likes yet' : 'No favorites yet'}
              </p>
              <p className="text-caption mb-6">
                {activeTab === 'likes'
                  ? 'Items you like will appear here'
                  : 'Save items from the feed to build your collection'}
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
                    onSelect={handleSelectItem}
                  />
                ))}
              </div>

              <div ref={loadMoreRef} className="flex justify-center py-12">
                {activeQuery.isFetchingNextPage ? (
                  <div className="flex items-center gap-3 text-caption">
                    <span className="inline-block w-4 h-4 border border-[var(--border)] border-t-[var(--fg)] rounded-full animate-spin" />
                    Loading
                  </div>
                ) : activeQuery.hasNextPage ? (
                  <div className="h-8" />
                ) : (
                  <p className="text-caption">
                    {allItems.length} {activeTab === 'likes' ? 'liked' : 'saved'} {allItems.length === 1 ? 'item' : 'items'}
                  </p>
                )}
              </div>
            </>
          )}
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
