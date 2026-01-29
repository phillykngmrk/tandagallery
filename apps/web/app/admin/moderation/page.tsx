'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReportReason, ReportStatus } from '@aggragif/shared';

interface Report {
  id: string;
  targetType: 'media' | 'comment' | 'user';
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  reporter: {
    id: string;
    username: string;
  };
  createdAt: string;
  target?: {
    id: string;
    title?: string;
    content?: string;
    username?: string;
    thumbnailUrl?: string;
  };
}

interface ReportsResponse {
  items: Report[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number;
  };
}

interface MediaItem {
  id: string;
  title: string | null;
  mediaType: 'image' | 'gif' | 'video';
  mediaUrl: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  postedAt: string;
  createdAt: string;
  isHidden: boolean;
  author: string | null;
}

interface MediaResponse {
  items: MediaItem[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

async function fetchReports(status: ReportStatus): Promise<ReportsResponse> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/admin/reports?status=${status}&limit=50`,
    {
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch reports');
  }

  return response.json();
}

async function resolveReport(data: {
  reportId: string;
  resolution: 'resolved_valid' | 'resolved_invalid' | 'dismissed';
  action?: string;
}) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/admin/reports/${data.reportId}/resolve`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resolution: data.resolution,
        action: data.action,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to resolve report');
  }

  return response.json();
}

async function fetchMedia(cursor?: string): Promise<MediaResponse> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  const params = new URLSearchParams({ limit: '50' });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${apiBase}/admin/media?${params}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch media');
  return res.json();
}

async function deleteMediaItem(id: string): Promise<void> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  const res = await fetch(`${apiBase}/admin/media/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to delete media item');
}

const REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate_speech: 'Hate Speech',
  violence: 'Violence',
  nudity: 'Nudity',
  copyright: 'Copyright',
  misinformation: 'Misinformation',
  other: 'Other',
};

const STATUS_TABS: { value: ReportStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'resolved_valid', label: 'Resolved (Valid)' },
  { value: 'resolved_invalid', label: 'Resolved (Invalid)' },
  { value: 'dismissed', label: 'Dismissed' },
];

export default function ModerationPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'reports' | 'media'>('reports');
  const [activeStatus, setActiveStatus] = useState<ReportStatus>('pending');
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'reports', activeStatus],
    queryFn: () => fetchReports(activeStatus),
    enabled: activeTab === 'reports',
  });

  const { data: mediaData, isLoading: mediaLoading, isError: mediaError } = useQuery({
    queryKey: ['admin', 'media'],
    queryFn: () => fetchMedia(),
    enabled: activeTab === 'media',
  });

  const deleteMediaMutation = useMutation({
    mutationFn: deleteMediaItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'media'] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: resolveReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
      setSelectedReport(null);
    },
  });

  const handleResolve = (resolution: 'resolved_valid' | 'resolved_invalid' | 'dismissed', action?: string) => {
    if (!selectedReport) return;
    resolveMutation.mutate({
      reportId: selectedReport.id,
      resolution,
      action,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-title mb-2">Moderation</h1>
        <p className="text-caption">Review reports and manage media content</p>
      </div>

      {/* Top-level tabs: Reports / Media */}
      <div className="flex gap-4 border-b border-[var(--border)]">
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'reports'
              ? 'text-[var(--fg)] border-b-2 border-[var(--fg)]'
              : 'text-[var(--muted)] hover:text-[var(--fg)]'
          }`}
        >
          Reports
        </button>
        <button
          onClick={() => setActiveTab('media')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'media'
              ? 'text-[var(--fg)] border-b-2 border-[var(--fg)]'
              : 'text-[var(--muted)] hover:text-[var(--fg)]'
          }`}
        >
          Media
        </button>
      </div>

      {/* Media tab */}
      {activeTab === 'media' && (
        <div>
          {mediaLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="aspect-square skeleton" />
              ))}
            </div>
          ) : mediaError ? (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              Failed to load media. Please refresh.
            </div>
          ) : !mediaData?.items.length ? (
            <div className="text-center py-12 text-caption">No media items</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {mediaData.items.map((item) => (
                <div key={item.id} className="group relative aspect-square bg-[var(--border)] overflow-hidden">
                  {item.mediaType === 'video' ? (
                    <video
                      src={item.mediaUrl}
                      poster={item.thumbnailUrl}
                      crossOrigin="anonymous"
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    />
                  ) : (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title || ''}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                  {/* Type badge */}
                  <span className="absolute top-1 left-1 px-1 py-0.5 text-[10px] bg-black/70 text-white">
                    {item.mediaType}
                  </span>
                  {/* Info overlay on hover */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[10px] text-white truncate">{item.title || item.author || 'Untitled'}</p>
                    <p className="text-[9px] text-white/60">{new Date(item.postedAt).toLocaleDateString()}</p>
                  </div>
                  {/* Delete button */}
                  <button
                    onClick={() => {
                      if (confirm('Delete this item? It will be blocked from re-ingestion.')) {
                        deleteMediaMutation.mutate(item.id);
                      }
                    }}
                    disabled={deleteMediaMutation.isPending}
                    className="absolute top-1 right-1 p-1 bg-red-600/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete & block"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reports tab */}
      {activeTab === 'reports' && (
      <>
      {/* Status tabs */}
      <div className="flex gap-2 border-b border-[var(--border)] overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveStatus(tab.value)}
            className={`px-4 py-2 text-sm whitespace-nowrap transition-colors ${
              activeStatus === tab.value
                ? 'text-[var(--fg)] border-b-2 border-[var(--fg)]'
                : 'text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            {tab.label}
            {tab.value === 'pending' && data?.pagination.totalCount ? (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400">
                {data.pagination.totalCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Reports list */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border border-[var(--border)] p-4">
              <div className="flex gap-4">
                <div className="w-16 h-16 skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="w-32 h-4 skeleton" />
                  <div className="w-full h-4 skeleton" />
                  <div className="w-24 h-3 skeleton" />
                </div>
              </div>
            </div>
          ))
        ) : isError ? (
          <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            Failed to load reports. Please refresh the page.
          </div>
        ) : data?.items.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-caption">No {activeStatus.replace('_', ' ')} reports</p>
          </div>
        ) : (
          data?.items.map((report) => (
            <button
              key={report.id}
              onClick={() => setSelectedReport(report)}
              className={`w-full text-left border transition-colors p-4 ${
                selectedReport?.id === report.id
                  ? 'border-[var(--fg)] bg-[var(--fg)]/5'
                  : 'border-[var(--border)] hover:border-[var(--muted)]'
              }`}
            >
              <div className="flex gap-4">
                {/* Thumbnail */}
                {report.target?.thumbnailUrl && (
                  <div className="w-16 h-16 bg-[var(--border)] shrink-0">
                    <img
                      src={report.target.thumbnailUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 bg-[var(--fg)]/10 text-[var(--muted)]">
                      {report.targetType}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-red-500/10 text-red-400">
                      {REASON_LABELS[report.reason]}
                    </span>
                  </div>
                  <p className="text-sm truncate">
                    {report.target?.title || report.target?.content || report.target?.username || `ID: ${report.targetId}`}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    Reported by @{report.reporter.username} · {new Date(report.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
      </>
      )}

      {/* Report detail modal */}
      {selectedReport && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[200]"
            onClick={() => setSelectedReport(null)}
          />
          <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-[var(--bg)] border-l border-[var(--border)] z-[201] overflow-y-auto">
            <div className="sticky top-0 bg-[var(--bg)] border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
              <h2 className="text-title">Report Details</h2>
              <button
                onClick={() => setSelectedReport(null)}
                className="p-2 -mr-2 text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Target preview */}
              {selectedReport.target?.thumbnailUrl && (
                <div className="aspect-video bg-[var(--border)]">
                  <img
                    src={selectedReport.target.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              {/* Report info */}
              <div className="space-y-4">
                <div>
                  <p className="text-caption mb-1">Target Type</p>
                  <p className="text-sm">{selectedReport.targetType}</p>
                </div>
                <div>
                  <p className="text-caption mb-1">Reason</p>
                  <p className="text-sm">{REASON_LABELS[selectedReport.reason]}</p>
                </div>
                {selectedReport.details && (
                  <div>
                    <p className="text-caption mb-1">Details</p>
                    <p className="text-sm">{selectedReport.details}</p>
                  </div>
                )}
                <div>
                  <p className="text-caption mb-1">Reporter</p>
                  <p className="text-sm">@{selectedReport.reporter.username}</p>
                </div>
                <div>
                  <p className="text-caption mb-1">Reported At</p>
                  <p className="text-sm">{new Date(selectedReport.createdAt).toLocaleString()}</p>
                </div>
              </div>

              {/* Actions */}
              {activeStatus === 'pending' || activeStatus === 'reviewing' ? (
                <div className="space-y-3 pt-4 border-t border-[var(--border)]">
                  <p className="text-caption">Take Action</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => handleResolve('resolved_valid', 'hide')}
                      disabled={resolveMutation.isPending}
                      className="btn btn-primary justify-center"
                    >
                      Hide Content
                    </button>
                    <button
                      onClick={() => handleResolve('resolved_valid', 'remove')}
                      disabled={resolveMutation.isPending}
                      className="btn justify-center bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20"
                    >
                      Remove Content
                    </button>
                    <button
                      onClick={() => handleResolve('resolved_invalid')}
                      disabled={resolveMutation.isPending}
                      className="btn justify-center"
                    >
                      Mark Invalid
                    </button>
                    <button
                      onClick={() => handleResolve('dismissed')}
                      disabled={resolveMutation.isPending}
                      className="btn justify-center"
                    >
                      Dismiss
                    </button>
                  </div>
                  {resolveMutation.isError && (
                    <p className="text-sm text-red-400">Failed to resolve report</p>
                  )}
                </div>
              ) : (
                <div className="pt-4 border-t border-[var(--border)]">
                  <p className="text-caption">
                    Status: <span className="text-[var(--fg)]">{selectedReport.status.replace('_', ' ')}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
