'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { mediaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CommentsDrawer } from '@/components/comments/comments-drawer';
import { ReportModal } from '@/components/moderation/report-modal';

interface MediaDetailClientProps {
  id: string;
}

export function MediaDetailClient({ id }: MediaDetailClientProps) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [showComments, setShowComments] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likeCount, setLikeCount] = useState(0);

  const { data: item, isLoading, isError, error } = useQuery({
    queryKey: ['media', id],
    queryFn: () => mediaApi.getById(id),
    enabled: !!id,
  });

  // Sync state with fetched data
  useEffect(() => {
    if (item) {
      setLikeCount(item.likeCount);
      setIsLiked(item.isLiked ?? false);
      setIsFavorited(item.isFavorited ?? false);
    }
  }, [item]);

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: async () => {
      return mediaApi.like(id, isLiked ? 'unlike' : 'like');
    },
    onMutate: async () => {
      setIsLiked(!isLiked);
      setLikeCount((prev) => (isLiked ? prev - 1 : prev + 1));
    },
    onError: () => {
      setIsLiked(isLiked);
      setLikeCount((prev) => (isLiked ? prev + 1 : prev - 1));
    },
    onSuccess: (data) => {
      setIsLiked(data.isLiked);
      setLikeCount(data.likeCount);
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  // Favorite mutation
  const favoriteMutation = useMutation({
    mutationFn: async () => {
      return mediaApi.favorite(id, isFavorited ? 'remove' : 'add');
    },
    onMutate: async () => {
      setIsFavorited(!isFavorited);
    },
    onError: () => {
      setIsFavorited(isFavorited);
    },
    onSuccess: (data) => {
      setIsFavorited(data.isFavorited);
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });

  const handleLike = () => {
    if (!isAuthenticated) {
      window.location.href = '/auth/login';
      return;
    }
    likeMutation.mutate();
  };

  const handleFavorite = () => {
    if (!isAuthenticated) {
      window.location.href = '/auth/login';
      return;
    }
    favoriteMutation.mutate();
  };

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
          <div className="max-w-5xl mx-auto">
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

  const isVideo = item.type === 'video';

  return (
    <>
      <div className="min-h-screen">
        <section className="container-wide py-8">
          <Link href="/" className="text-caption hover:text-[var(--fg)] transition-colors">
            ← Back to feed
          </Link>
        </section>

        <div className="container-wide pb-16">
          <div className="max-w-5xl mx-auto">
            {/* Media */}
            <div className={`video-container mb-8 ${isVideo ? 'aspect-video' : 'relative flex items-center justify-center'}`} style={!isVideo ? { minHeight: '50vh', maxHeight: '85vh' } : undefined}>
              {isVideo ? (
                <video
                  className="w-full h-full object-contain"

                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                >
                  <source src={item.mediaUrl} type="video/mp4" />
                </video>
              ) : (
                <img
                  src={item.mediaUrl}
                  alt={item.title || 'Media item'}
                  className="max-w-full max-h-[85vh] object-contain"
                  loading="eager"
                />
              )}
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
                  <span className="flex items-center gap-2">
                    <HeartIcon className="w-4 h-4" />
                    {likeCount.toLocaleString()} likes
                  </span>
                  <button
                    onClick={() => setShowComments(true)}
                    className="flex items-center gap-2 hover:text-[var(--fg)] transition-colors"
                  >
                    <CommentIcon className="w-4 h-4" />
                    {item.commentCount.toLocaleString()} comments
                  </button>
                  <span>{item.viewCount.toLocaleString()} views</span>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleLike}
                    disabled={likeMutation.isPending}
                    className={`btn ${isLiked ? 'btn-primary' : ''}`}
                  >
                    <HeartIcon className="w-4 h-4" />
                    {isLiked ? 'Liked' : 'Like'}
                  </button>
                  <button
                    onClick={handleFavorite}
                    disabled={favoriteMutation.isPending}
                    className={`btn ${isFavorited ? 'btn-primary' : ''}`}
                  >
                    <BookmarkIcon className="w-4 h-4" />
                    {isFavorited ? 'Saved' : 'Save'}
                  </button>
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
                      if (navigator.share) {
                        navigator.share({
                          title: item.title || 'Check this out',
                          url: window.location.href,
                        });
                      } else {
                        navigator.clipboard.writeText(window.location.href);
                      }
                    }}
                  >
                    <ShareIcon className="w-4 h-4" />
                    Share
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
function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
        clipRule="evenodd"
      />
    </svg>
  );
}

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

function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
    </svg>
  );
}
