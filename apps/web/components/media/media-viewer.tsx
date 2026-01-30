'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MediaItemSummary } from '@aggragif/shared';
import { CommentsDrawer } from '@/components/comments/comments-drawer';
import { ReportModal } from '@/components/moderation/report-modal';
import { mediaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface MediaViewerProps {
  item: MediaItemSummary | null;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

export function MediaViewer({
  item,
  onClose,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
}: MediaViewerProps) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const likeMutatedRef = useRef(false);
  const isLikedRef = useRef(false);
  const [showComments, setShowComments] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mediaContainerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOpen = item !== null;
  const isVideo = item?.type === 'video' || item?.type === 'gif';

  // Keep ref in sync with state
  useEffect(() => {
    isLikedRef.current = isLiked;
  }, [isLiked]);

  // Reset state when navigating to a different item (by ID), not on every prop reference change
  const itemId = item?.id;
  useEffect(() => {
    if (item) {
      // Don't overwrite optimistic state if we just mutated
      if (!likeMutatedRef.current) {
        setLikeCount(item.likeCount);
        setIsLiked(item.isLiked === true);
      }
    } else {
      setIsFullscreen(false);
      likeMutatedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // Fullscreen mouse-move show/hide controls
  const handleMouseMove = useCallback(() => {
    if (!isFullscreen) return;
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 2000);
  }, [isFullscreen]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Hide controls shortly after entering fullscreen
  useEffect(() => {
    if (isFullscreen) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setShowControls(false), 2000);
    } else {
      setShowControls(true);
    }
  }, [isFullscreen]);

  // Like mutation with optimistic update (uses ref to avoid stale closure)
  const likeMutation = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error('No item');
      const wasLiked = isLikedRef.current;
      return mediaApi.like(item.id, wasLiked ? 'unlike' : 'like');
    },
    onMutate: async () => {
      const wasLiked = isLikedRef.current;
      likeMutatedRef.current = true;
      setIsLiked(!wasLiked);
      setLikeCount((prev) => (wasLiked ? prev - 1 : prev + 1));
      return { wasLiked };
    },
    onError: (_err, _vars, context) => {
      likeMutatedRef.current = false;
      if (context) {
        setIsLiked(context.wasLiked);
        setLikeCount((prev) => (context.wasLiked ? prev + 1 : prev - 1));
      }
    },
    onSuccess: (data) => {
      setIsLiked(data.isLiked);
      setLikeCount(data.likeCount);
      // Update feed cache in-place instead of refetching (avoids stale data overwriting optimistic update)
      queryClient.setQueriesData<{ pages: { items: { id: string; isLiked: boolean | null; likeCount: number }[] }[] }>(
        { queryKey: ['feed'] },
        (old) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((i) =>
                i.id === item?.id ? { ...i, isLiked: data.isLiked, likeCount: data.likeCount } : i
              ),
            })),
          };
        },
      );
    },
  });

  const handleLike = () => {
    if (!isAuthenticated) {
      window.location.href = '/auth/login';
      return;
    }
    likeMutation.mutate();
  };

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          if (isFullscreen) {
            setIsFullscreen(false);
          } else {
            onClose();
          }
          break;
        case 'f':
          setIsFullscreen((v) => !v);
          break;
        case 'ArrowRight':
          if (hasNext && onNext) onNext();
          break;
        case 'ArrowLeft':
          if (hasPrevious && onPrevious) onPrevious();
          break;
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'm':
          setIsMuted((m) => !m);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasNext, hasPrevious, onNext, onPrevious, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Track whether we pushed a history entry for the viewer
  const pushedHistoryRef = useRef(false);
  const closingViaPopstateRef = useRef(false);

  // Push media URL to history when item opens
  useEffect(() => {
    if (item) {
      window.history.pushState({ mediaViewer: true }, '', `/media/${item.id}`);
      pushedHistoryRef.current = true;
    }
  }, [item]);

  // When viewer closes (via X or Escape), go back in history to restore URL
  useEffect(() => {
    if (!isOpen && pushedHistoryRef.current && !closingViaPopstateRef.current) {
      window.history.back();
      pushedHistoryRef.current = false;
    }
    closingViaPopstateRef.current = false;
  }, [isOpen]);

  // Close viewer on browser back button
  useEffect(() => {
    const handlePopState = () => {
      if (isOpen) {
        closingViaPopstateRef.current = true;
        pushedHistoryRef.current = false;
        onClose();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isOpen, onClose]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    const total = videoRef.current.duration;
    setProgress((current / total) * 100);
    setDuration(total);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = percent * videoRef.current.duration;
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!item) return null;

  // Shared media element
  const mediaElement = isVideo ? (
    <>
      <video
        key={item.id}
        ref={videoRef}

        className="w-full h-full object-contain"
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        muted={isMuted}
        loop
        playsInline
        onCanPlay={(e) => {
          (e.target as HTMLVideoElement).play().catch(() => {});
        }}
      >
        <source src={item.mediaUrl} type="video/mp4" />
      </video>

      {/* Video controls — hidden in fullscreen (controlled by hover overlay instead) */}
      <div className="video-controls" style={isFullscreen ? { display: 'none' } : undefined}>
        <div className="video-progress" onClick={handleProgressClick}>
          <div className="video-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="text-white hover:opacity-70 transition-opacity">
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <button onClick={() => setIsMuted(!isMuted)} className="text-white hover:opacity-70 transition-opacity">
              {isMuted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
              )}
            </button>
            <span className="video-time">{formatTime(videoRef.current?.currentTime || 0)} / {formatTime(duration)}</span>
          </div>
          <button onClick={() => setIsFullscreen(!isFullscreen)} className="text-white hover:opacity-70 transition-opacity">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          </button>
        </div>
      </div>
    </>
  ) : (
    <Image
      src={item.mediaUrl}
      alt={item.title || 'Media item'}
      fill
      sizes="100vw"
      className="object-contain"
      priority
      unoptimized
    />
  );

  // Fullscreen lightbox view
  if (isFullscreen) {
    return (
      <>
        <div
          className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
          onMouseMove={handleMouseMove}
          style={{ cursor: showControls ? 'default' : 'none' }}
        >
          {/* Media fills viewport */}
          <div ref={mediaContainerRef} className={`w-full h-full ${isVideo ? 'video-container' : 'relative'}`}>
            {mediaElement}
          </div>

          {/* Hover controls overlay */}
          <div
            className="fixed inset-0 z-[101] pointer-events-none transition-opacity duration-300"
            style={{ opacity: showControls ? 1 : 0 }}
          >
            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start pointer-events-auto bg-gradient-to-b from-black/60 to-transparent">
              <h2 className="text-white text-lg font-medium truncate mr-4">
                {item.title || ''}
              </h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="p-2 text-white/70 hover:text-white transition-colors"
                  aria-label="Exit fullscreen"
                  title="Exit fullscreen (F)"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                  </svg>
                </button>
                <button
                  onClick={onClose}
                  className="p-2 text-white/70 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="absolute bottom-0 left-0 right-0 pointer-events-auto bg-gradient-to-t from-black/60 to-transparent">
              {/* Video controls in fullscreen */}
              {isVideo && (
                <div className="px-6 pt-4">
                  <div className="video-progress mb-2" onClick={handleProgressClick} style={{ position: 'relative', height: '4px', background: 'rgba(255,255,255,0.3)', cursor: 'pointer', borderRadius: '2px' }}>
                    <div className="video-progress-bar" style={{ width: `${progress}%`, height: '100%', background: 'white', borderRadius: '2px' }} />
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-4">
                      <button onClick={togglePlay} className="text-white hover:opacity-70 transition-opacity">
                        {isPlaying ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        )}
                      </button>
                      <button onClick={() => setIsMuted(!isMuted)} className="text-white hover:opacity-70 transition-opacity">
                        {isMuted ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                        )}
                      </button>
                      <span className="text-white/70 text-xs font-mono">{formatTime(videoRef.current?.currentTime || 0)} / {formatTime(duration)}</span>
                    </div>
                    <button onClick={() => setIsFullscreen(false)} className="text-white hover:opacity-70 transition-opacity">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-center gap-4 px-6 pb-6 pt-2">
                <button onClick={handleLike} className={`p-2 transition-colors ${isLiked ? 'text-red-500' : 'text-white/70 hover:text-white'}`}>
                  <HeartIcon className="w-5 h-5" />
                </button>
                <button onClick={() => setShowComments(true)} className="p-2 text-white/70 hover:text-white transition-colors">
                  <CommentIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Nav arrows */}
            {hasPrevious && onPrevious && (
              <button
                onClick={onPrevious}
                className="absolute left-6 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white transition-colors pointer-events-auto"
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
            )}
            {hasNext && onNext && (
              <button
                onClick={onNext}
                className="absolute right-6 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white transition-colors pointer-events-auto"
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            )}
          </div>
        </div>

        <CommentsDrawer mediaId={item?.id || null} isOpen={showComments} onClose={() => setShowComments(false)} />
        <ReportModal isOpen={showReport} onClose={() => setShowReport(false)} targetType="media" targetId={item?.id || ''} />
      </>
    );
  }

  // Default scrollable overlay view
  return (
    <>
      {/* Backdrop */}
      <div
        className={`overlay-backdrop ${isOpen ? 'active' : ''}`}
        onClick={onClose}
      />

      {/* Content */}
      <div
        ref={overlayRef}
        className={`overlay-content ${isOpen ? 'active' : ''}`}
      >
        <div className="min-h-screen bg-[var(--bg)]">
          {/* Close button */}
          <button
            onClick={onClose}
            className="fixed top-6 right-6 z-50 p-2 text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            aria-label="Close"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>

          {/* Fullscreen button */}
          <button
            onClick={() => setIsFullscreen(true)}
            className="fixed top-6 right-16 z-50 p-2 text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            aria-label="Fullscreen"
            title="Fullscreen (F)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          </button>

          {/* Navigation arrows */}
          {hasPrevious && onPrevious && (
            <button
              onClick={onPrevious}
              className="fixed left-6 top-1/2 -translate-y-1/2 z-50 p-3 text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
              aria-label="Previous"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}

          {hasNext && onNext && (
            <button
              onClick={onNext}
              className="fixed right-6 top-1/2 -translate-y-1/2 z-50 p-3 text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
              aria-label="Next"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}

          {/* Main content */}
          <div className="container-wide py-20">
            <div className="max-w-7xl mx-auto">
              {/* Media */}
              <div ref={mediaContainerRef} tabIndex={-1} className={`video-container mb-8 ${isVideo ? 'aspect-video' : 'relative w-full'}`} style={!isVideo ? { minHeight: '50vh', maxHeight: '85vh' } : undefined}>
                {mediaElement}
              </div>

              {/* Info section */}
              <div className="grid md:grid-cols-[1fr,300px] gap-8">
                {/* Left: Title and description */}
                <div>
                  {item.title && (
                    <h1 className="text-title mb-4">{item.title}</h1>
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
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={handleLike}
                      disabled={likeMutation.isPending}
                      className={`btn ${isLiked ? 'btn-primary' : ''}`}
                    >
                      <HeartIcon className="w-4 h-4" />
                      {isLiked ? 'Liked' : 'Like'}
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

                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[var(--muted)]">Tags</span>
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map((tag: string) => (
                          <Link
                            key={tag}
                            href={`/tags/${encodeURIComponent(tag)}`}
                            className="text-xs font-mono px-2 py-1 border border-[var(--border)] hover:bg-[var(--fg)] hover:text-[var(--bg)] transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {tag}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="divider" />

                  <a
                    href="#"
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
      </div>

      {/* Comments drawer */}
      <CommentsDrawer
        mediaId={item?.id || null}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
      />

      {/* Report modal */}
      <ReportModal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        targetType="media"
        targetId={item?.id || ''}
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

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
    </svg>
  );
}
