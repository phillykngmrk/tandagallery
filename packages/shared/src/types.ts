/**
 * Shared types used across frontend and backend
 */

// Media types
export type MediaType = 'image' | 'gif' | 'video';

// User roles
export type UserRole = 'user' | 'moderator' | 'admin';

// Media item status
export type MediaStatus = 'active' | 'hidden' | 'removed';

// Comment status
export type CommentStatus = 'active' | 'hidden' | 'removed' | 'flagged';

// Report reasons
export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'hate_speech'
  | 'violence'
  | 'nudity'
  | 'copyright'
  | 'misinformation'
  | 'other';

// Report status
export type ReportStatus =
  | 'pending'
  | 'reviewing'
  | 'resolved_valid'
  | 'resolved_invalid'
  | 'dismissed';

// Pagination
export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    totalCount?: number;
  };
}

// Media item summary (for feeds)
export interface MediaItemSummary {
  id: string;
  type: MediaType;
  title: string | null;
  thumbnailUrl: string;
  mediaUrl: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  likeCount: number;
  commentCount: number;
  publishedAt: string | null;
  isLiked: boolean | null;
  tags?: string[];
}

// Media item detail
export interface MediaItemDetail extends MediaItemSummary {
  description: string | null;
  author: string | null;
  authorUrl: string | null;
  permalink: string;
  tags: string[];
  viewCount: number;
  isCommentsLocked: boolean;
  ingestedAt: string;
}

// User profile
export interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
}

// Comment
export interface Comment {
  id: string;
  content: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  parentId: string | null;
  replyCount: number;
  likeCount: number;
  isEdited: boolean;
  createdAt: string;
  replies?: Comment[];
}

// Auth tokens
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

// API error response
export interface ApiError {
  error: string;
  message: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
}
