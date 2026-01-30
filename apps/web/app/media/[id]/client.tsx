'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mediaApi } from '@/lib/api';
import { CommentsDrawer } from '@/components/comments/comments-drawer';
import { ReportModal } from '@/components/moderation/report-modal';

interface MediaDetailClientProps {
  id: string;
}

export function MediaDetailClient({ id }: MediaDetailClientProps) {
  const router = useRouter();

  const [showComments, setShowComments] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [mediaError, setMediaError] = useState(false);

  const { data: item, isLoading, isError, error } = useQuery({
    queryKey: ['media', id],
    queryFn: () => mediaApi.getById(id),
    enabled: !!id,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  const { data: adjacent } = useQuery({
    queryKey: ['media-adjacent', id],
    queryFn: () => mediaApi.getAdjacent(id),
    enabled: !!id,
  });

  // Keyboard navigation (left/right arrows)
  const navigatePrev = useCallback(() => {
    if (adjacent?.prev) router.push(`/media/${adjacent.prev.id}`);
  }, [adjacent?.prev, router]);

  const navigateNext = useCallback(() => {
    if (adjacent?.next) router.push(`/media/${adjacent.next.id}`);
  }, [adjacent?.next, router]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') navigatePrev();
      if (e.key === 'ArrowRight') navigateNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigatePrev, navigateNext]);

  // Sync media error state when item changes
  const itemId = item?.id;
  useEffect(() => {
    if (item) {
      setMediaError(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <section className="container-wide py-16">
          <Link href="/" className="text-caption hover:text-[var(--fg)] transition-colors">
            ← Back to feed
          </Link>
        </section>
        <div className="container-wide pb-16">
          <div className="max-w-7xl mx-auto">
            <div className="aspect-video skeleton mb-8" />
            <div className="space-y-4">
              <div className="w-64 h-8 skeleton" />
              <div className="w-48 h-5 skeleton" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="min-h-screen">
        <section className="container-wide py-16">
          <Link href="/" className="text-caption hover:text-[var(--fg)] transition-colors">
            ← Back to feed
          </Link>
        </section>
        <div className="container-wide py-24 text-center">
          <h1 className="text-title mb-4">Media not found</h1>
          <p className="text-caption mb-8">
            {error instanceof Error ? error.message : 'This item may have been removed.'}
          </p>
          <Link href="/" className="btn btn-primary">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const isActualGif = item.mediaUrl?.endsWith('.gif') ?? false;
  const isVideo = (item.type === 'video' || item.type === 'gif') && !isActualGif;

  return (
    <>
      <div className="min-h-screen">
        <section className="container-wide pt-8 pb-4">
          <Link href="/" className="text-caption hover:text-[var(--fg)] transition-colors">
            ← Back to feed
          </Link>
        </section>

        <div className="container-wide pb-20">
          <div className="max-w-7xl mx-auto">
            {/* Media with navigation */}
            <div className="relative mb-8">
              {/* Prev arrow */}
              {adjacent?.prev && (
                <button
                  onClick={navigatePrev}
                  className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-10 h-10 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white/70 hover:text-white transition-all rounded-full backdrop-blur-sm"
                  aria-label="Previous"
                >
                  <ChevronLeftIcon className="w-5 h-5" />
                </button>
              )}
              {/* Next arrow */}
              {adjacent?.next && (
                <button
                  onClick={navigateNext}
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 w-10 h-10 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white/70 hover:text-white transition-all rounded-full backdrop-blur-sm"
                  aria-label="Next"
                >
                  <ChevronRightIcon className="w-5 h-5" />
                </button>
              )}

            <div className={`video-container ${isVideo ? 'aspect-video' : 'relative flex items-center justify-center'}`} style={!isVideo ? { minHeight: '50vh', maxHeight: '85vh' } : undefined}>
              {mediaError ? (
                <div className="flex flex-col items-center justify-center gap-4 py-20 text-[var(--muted)]">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-caption">Failed to load media</p>
                  <button
                    onClick={() => setMediaError(false)}
                    className="btn text-xs"
                  >
                    Retry
                  </button>
                </div>
              ) : isVideo ? (
                <video
                  className="w-full h-full object-contain"
                  src={item.mediaUrl}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  onError={() => setMediaError(true)}
                />
              ) : (
                <img
                  src={item.mediaUrl}
                  alt={item.title ? `${item.title} - ${item.type}` : `${item.type === 'gif' ? 'GIF' : item.type === 'video' ? 'Video' : 'Image'} content on T & A Gallery`}
                  className="max-w-full max-h-[85vh] object-contain"
                  loading="eager"
                  onError={() => setMediaError(true)}
                />
              )}
            </div>
            </div>

            {/* Info section */}
            <div className="grid md:grid-cols-[1fr,300px] gap-8">
              {/* Left: Title and description */}
              <div>
                {item.title && (
                  <h1 className="text-title mb-4">{item.title}</h1>
                )}

                {item.description && (
                  <p className="text-body text-[var(--muted)] mb-4">
                    {item.description}
                  </p>
                )}

                <div className="flex items-center gap-6 text-caption mb-6">
                  <button
                    onClick={() => setShowComments(true)}
                    className="flex items-center gap-2 hover:text-[var(--fg)] transition-colors"
                  >
                    <CommentIcon className="w-4 h-4" />
                    {item.commentCount.toLocaleString()} comments
                  </button>
                  <span>{(item.viewCount ?? 0).toLocaleString()} views</span>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setShowComments(true)}
                    className="btn"
                  >
                    <CommentIcon className="w-4 h-4" />
                    Comment
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const url = encodeURIComponent(window.location.href);
                      const text = encodeURIComponent(item.title || 'Check this out');
                      window.open(`https://x.com/intent/tweet?url=${url}&text=${text}`, '_blank');
                    }}
                  >
                    <XIcon className="w-4 h-4" />
                    Share on X
                  </button>
                </div>

                {/* Tags */}
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-6">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 text-xs border border-[var(--border)] text-[var(--muted)]"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Metadata */}
              <div className="space-y-4 text-caption">
                <div className="divider md:hidden" />

                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Type</span>
                  <span className="text-mono uppercase">{item.type}</span>
                </div>

                {item.duration && (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted)]">Duration</span>
                    <span className="text-mono">{formatTime(item.duration)}</span>
                  </div>
                )}

                {item.width && item.height && (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted)]">Dimensions</span>
                    <span className="text-mono">{item.width} × {item.height}</span>
                  </div>
                )}

                {item.publishedAt && (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted)]">Published</span>
                    <span className="text-mono">
                      {new Date(item.publishedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}

                {item.author && (
                  <div className="flex justify-between">
                    <span className="text-[var(--muted)]">Author</span>
                    {item.authorUrl ? (
                      <a
                        href={item.authorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[var(--fg)] transition-colors"
                      >
                        {item.author}
                      </a>
                    ) : (
                      <span>{item.author}</span>
                    )}
                  </div>
                )}

                <div className="divider" />

                <a
                  href={item.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                >
                  View original source →
                </a>

                <button
                  onClick={() => setShowReport(true)}
                  className="block text-[var(--muted)] hover:text-red-400 transition-colors text-left"
                >
                  Report content
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comments drawer */}
      <CommentsDrawer
        mediaId={id}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
      />

      {/* Report modal */}
      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        targetType="media"
        targetId={id}
      />
    </>
  );
}

// Icons
function CommentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}
