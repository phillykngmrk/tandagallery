'use client';

import { useState, useRef, useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mediaApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Comment } from '@aggragif/shared';

interface CommentsDrawerProps {
  mediaId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function CommentsDrawer({ mediaId, isOpen, onClose }: CommentsDrawerProps) {
  const { isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Fetch comments
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['comments', mediaId],
    queryFn: async ({ pageParam }) => {
      if (!mediaId) throw new Error('No media ID');
      return mediaApi.getComments(mediaId, { cursor: pageParam, limit: 20 });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
    enabled: !!mediaId && isOpen,
  });

  // Post comment mutation
  const postCommentMutation = useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId?: string }) => {
      if (!mediaId) throw new Error('No media ID');
      return mediaApi.createComment(mediaId, content, parentId);
    },
    onSuccess: () => {
      setNewComment('');
      setReplyingTo(null);
      queryClient.invalidateQueries({ queryKey: ['comments', mediaId] });
    },
  });

  // Auto-focus input when replying
  useEffect(() => {
    if (replyingTo && inputRef.current) {
      inputRef.current.focus();
    }
  }, [replyingTo]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || postCommentMutation.isPending) return;

    postCommentMutation.mutate({
      content: newComment.trim(),
      parentId: replyingTo?.id,
    });
  };

  const allComments = data?.pages.flatMap((page) => page.items) || [];

  // Group comments by parent
  const topLevelComments = allComments.filter((c) => !c.parentId);
  const repliesMap = new Map<string, Comment[]>();
  allComments.forEach((comment) => {
    if (comment.parentId) {
      const existing = repliesMap.get(comment.parentId) || [];
      repliesMap.set(comment.parentId, [...existing, comment]);
    }
  });

  const formatTime = (date: Date | string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-[200] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 bottom-0 w-full max-w-md bg-[var(--bg)] z-[201] transform transition-transform duration-500 ease-[var(--ease-out-expo)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--bg)] border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
          <h2 className="text-title">Comments</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Comments list */}
        <div className="flex-1 overflow-y-auto px-6 py-4" style={{ height: 'calc(100vh - 140px)' }}>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full skeleton" />
                    <div className="w-24 h-4 skeleton" />
                  </div>
                  <div className="w-full h-12 skeleton" />
                </div>
              ))}
            </div>
          ) : allComments.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-caption">No comments yet</p>
              {isAuthenticated && (
                <p className="text-caption mt-1">Be the first to comment</p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {topLevelComments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  replies={repliesMap.get(comment.id) || []}
                  formatTime={formatTime}
                  onReply={isAuthenticated ? setReplyingTo : undefined}
                  currentUserId={user?.id}
                />
              ))}

              {hasNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full py-3 text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                >
                  {isFetchingNextPage ? 'Loading...' : 'Load more comments'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Comment input */}
        {isAuthenticated ? (
          <form onSubmit={handleSubmit} className="sticky bottom-0 bg-[var(--bg)] border-t border-[var(--border)] p-4">
            {replyingTo && (
              <div className="flex items-center justify-between mb-2 px-2">
                <span className="text-xs text-[var(--muted)]">
                  Replying to @{replyingTo.user?.username}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="text-xs text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  Cancel
                </button>
              </div>
            )}
            <div className="flex gap-3">
              <textarea
                ref={inputRef}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 auth-input resize-none"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              <button
                type="submit"
                disabled={!newComment.trim() || postCommentMutation.isPending}
                className="btn btn-primary px-4"
              >
                {postCommentMutation.isPending ? (
                  <span className="inline-block w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="sticky bottom-0 bg-[var(--bg)] border-t border-[var(--border)] p-4 text-center">
            <p className="text-caption mb-2">Sign in to comment</p>
            <a href="/auth/login" className="btn text-sm py-2 px-4">
              Sign in
            </a>
          </div>
        )}
      </div>
    </>
  );
}

interface CommentItemProps {
  comment: Comment;
  replies: Comment[];
  formatTime: (date: Date | string) => string;
  onReply?: (comment: Comment) => void;
  currentUserId?: string;
}

function CommentItem({ comment, replies, formatTime, onReply, currentUserId }: CommentItemProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[var(--border)] flex items-center justify-center text-xs font-medium text-[var(--muted)]">
            {(comment.user?.displayName || comment.user?.username || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium">
              {comment.user?.displayName || comment.user?.username || 'Unknown'}
            </span>
            <span className="text-xs text-[var(--muted)] ml-2">
              {formatTime(comment.createdAt)}
            </span>
          </div>
        </div>

        <p className="text-sm text-[var(--fg)] pl-10">{comment.content}</p>

        <div className="flex items-center gap-4 pl-10">
          <button className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
                clipRule="evenodd"
              />
            </svg>
            {comment.likeCount > 0 && comment.likeCount}
          </button>
          {onReply && (
            <button
              onClick={() => onReply(comment)}
              className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >
              Reply
            </button>
          )}
        </div>
      </div>

      {/* Replies */}
      {replies.length > 0 && (
        <div className="pl-10 space-y-4 border-l border-[var(--border)] ml-4">
          {replies.map((reply) => (
            <div key={reply.id} className="pl-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-[var(--border)] flex items-center justify-center text-xs font-medium text-[var(--muted)]">
                  {(reply.user?.displayName || reply.user?.username || 'U').charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium">
                  {reply.user?.displayName || reply.user?.username || 'Unknown'}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {formatTime(reply.createdAt)}
                </span>
              </div>
              <p className="text-sm text-[var(--fg)]">{reply.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
