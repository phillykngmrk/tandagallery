'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { MediaItemSummary } from '@aggragif/shared';
import { useVisibility } from '@/hooks/use-visibility';

interface MediaCardProps {
  item: MediaItemSummary;
  index: number;
}

export function MediaCard({ item, index }: MediaCardProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [imgSrc, setImgSrc] = useState(item.thumbnailUrl);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cardRef, isVisible, isNear] = useVisibility<HTMLAnchorElement>();

  // Actual .gif files can't play in <video> tags — treat them as images
  const isActualGif = item.mediaUrl.endsWith('.gif');
  // Gifs and short videos (<10s) autoplay; longer videos play on hover
  const isPlayable = (item.type === 'video' || item.type === 'gif') && !isActualGif;
  const isShort = item.type === 'gif' || (item.duration != null && item.duration < 10);
  const shouldAutoplay = isPlayable && isShort;

  // Three-tier preload: far=none, near=metadata, visible+autoplay=auto
  const preloadStrategy = !isNear ? 'none' : (isVisible && shouldAutoplay) ? 'auto' : 'metadata';

  // Play/pause autoplay videos based on visibility
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !shouldAutoplay) return;
    if (isVisible) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [isVisible, shouldAutoplay]);

  // Format index with leading zeros [01], [02], etc.
  const formattedIndex = `[${String(index + 1).padStart(2, '0')}]`;

  // Format duration as mm:ss
  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (videoRef.current && isPlayable && !shouldAutoplay) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (videoRef.current && !shouldAutoplay) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <Link
      ref={cardRef}
      href={`/media/${item.id}`}
      className="media-card block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="media-card-inner">
        {/* Thumbnail image */}
        <Image
          src={imgSrc}
          alt={item.title ? `${item.title} - ${item.type}` : `${item.type === 'gif' ? 'GIF' : item.type === 'video' ? 'Video' : 'Image'} content`}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 25vw, 20vw"
          className={`media-card-image ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            if (imgSrc !== item.thumbnailUrl) {
              setImgSrc(item.thumbnailUrl);
            }
          }}
          priority={index < 6}
          unoptimized
        />

        {/* Animated GIF overlay: load actual .gif when near viewport */}
        {isActualGif && isNear && (
          <img
            src={item.mediaUrl}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        )}

        {/* Video preview: always mounted for playable items, src set lazily */}
        {isPlayable && (
          <video
            ref={videoRef}
            className="media-card-image object-cover"
            src={isNear ? item.mediaUrl : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: shouldAutoplay || isHovered ? 1 : 0,
              transition: 'opacity 0.2s',
              pointerEvents: 'none',
              willChange: shouldAutoplay || isHovered ? 'opacity' : 'auto',
            }}
            muted
            loop
            playsInline
            preload={preloadStrategy}
          />
        )}

        {/* Loading skeleton */}
        {!isLoaded && (
          <div className="absolute inset-0 skeleton" />
        )}

        {/* Overlay gradient */}
        <div className="media-card-overlay" />

        {/* Index number */}
        <span className="media-card-index">{formattedIndex}</span>

        {/* Type badge */}
        {item.type !== 'image' && (
          <span className="media-card-badge">
            {item.type === 'gif' ? 'GIF' : formatDuration(item.duration ?? undefined)}
          </span>
        )}

        {/* Content on hover */}
        <div className="media-card-content">
          {item.title && (
            <h3 className="text-white text-sm font-medium line-clamp-2 mb-1">
              {item.title}
            </h3>
          )}
          <div className="flex items-center gap-3 text-white/70 text-xs">
            <span className="flex items-center gap-1">
              <EyeIcon className="w-3.5 h-3.5" />
              {formatCount(item.viewCount ?? 0)}
            </span>
            <span className="flex items-center gap-1">
              <CommentIcon className="w-3.5 h-3.5" />
              {formatCount(item.commentCount)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Format large numbers (1.2k, 3.4M)
function formatCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toString();
}

// Icons
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
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
