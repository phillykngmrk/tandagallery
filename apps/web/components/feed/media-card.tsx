'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import type { MediaItemSummary } from '@aggragif/shared';

interface MediaCardProps {
  item: MediaItemSummary;
  index: number;
  onSelect: (item: MediaItemSummary) => void;
}

export function MediaCard({ item, index, onSelect }: MediaCardProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [imgSrc, setImgSrc] = useState(item.thumbnailUrl);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Format index with leading zeros [01], [02], etc.
  const formattedIndex = `[${String(index + 1).padStart(2, '0')}]`;

  // Format duration as mm:ss
  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isAnimated = item.type === 'video';

  // Handle hover for video preview
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (videoRef.current && isAnimated) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <article
      className="media-card"
      onClick={() => onSelect(item)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item);
        }
      }}
    >
      <div className="media-card-inner">
        {/* Thumbnail image */}
        <Image
          src={imgSrc}
          alt={item.title || 'Media item'}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 25vw, 20vw"
          className={`media-card-image ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            if (imgSrc !== item.thumbnailUrl) {
              setImgSrc(item.thumbnailUrl);
            }
          }}
          priority={index < 8}
          unoptimized
        />

        {/* Video preview on hover (for animated content) */}
        {isAnimated && (
          <video
            ref={videoRef}
            className="media-card-image object-cover"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: isHovered ? 1 : 0,
              transition: 'opacity 0.2s',
              pointerEvents: 'none',
            }}
            muted
            loop
            playsInline
            preload="none"
            onCanPlay={() => {
              if (isHovered && videoRef.current) {
                videoRef.current.play().catch(() => {});
              }
            }}
          >
            <source src={item.mediaUrl} type="video/mp4" />
          </video>
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
              <HeartIcon className="w-3.5 h-3.5" />
              {formatCount(item.likeCount)}
            </span>
            <span className="flex items-center gap-1">
              <CommentIcon className="w-3.5 h-3.5" />
              {formatCount(item.commentCount)}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

// Format large numbers (1.2k, 3.4M)
function formatCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toString();
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
