'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Source {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  rateLimitRequests: number;
  rateLimitWindowMs: number;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'partial' | 'failed' | null;
  createdAt: string;
}

interface Thread {
  id: string;
  sourceId: string;
  externalId: string;
  url: string;
  enabled: boolean;
  priority: number;
  lastScannedAt: string | null;
  itemsIngested: number;
}

interface IngestionStats {
  totalSources: number;
  enabledSources: number;
  totalThreads: number;
  enabledThreads: number;
  totalItemsIngested: number;
  itemsIngestedToday: number;
  activeJobs: number;
  scheduledJobs: number;
}

interface IngestRun {
  id: string;
  sourceId: string;
  threadId: string | null;
  status: 'running' | 'completed' | 'failed' | 'partial';
  itemsFound: number;
  itemsNew: number;
  itemsFailed: number;
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
}

interface RunMediaItem {
  id: string;
  externalItemId: string;
  title: string | null;
  mediaType: 'image' | 'gif' | 'video';
  mediaUrl: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  postedAt: string;
  isHidden: boolean;
}

async function fetchRunMedia(runId: string): Promise<RunMediaItem[]> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';
  const res = await fetch(`${apiBase}/admin/ingestion/runs/${runId}/media`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch run media');
  const data = await res.json();
  return data.items;
}

async function deleteMediaItem(id: string): Promise<void> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';
  const res = await fetch(`${apiBase}/admin/media/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to delete media item');
}

async function fetchIngestionStatus(): Promise<{
  stats: IngestionStats;
  sources: Source[];
  recentRuns: IngestRun[];
}> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

  // Fetch status, sources, and runs in parallel
  const [statusRes, sourcesRes, runsRes] = await Promise.all([
    fetch(`${apiBase}/admin/ingestion/status`, {
      credentials: 'include',
    }),
    fetch(`${apiBase}/admin/ingestion/sources`, {
      credentials: 'include',
    }),
    fetch(`${apiBase}/admin/ingestion/runs?limit=10`, {
      credentials: 'include',
    }),
  ]);

  if (!statusRes.ok || !sourcesRes.ok || !runsRes.ok) {
    throw new Error('Failed to fetch ingestion status');
  }

  const [status, sources, runs] = await Promise.all([
    statusRes.json(),
    sourcesRes.json(),
    runsRes.json(),
  ]);

  // Map backend response to frontend interface
  return {
    stats: {
      totalSources: sources.length,
      enabledSources: status.counts?.enabledSources ?? 0,
      totalThreads: sources.reduce((acc: number, s: { threadCount?: number }) => acc + (s.threadCount ?? 0), 0),
      enabledThreads: status.counts?.enabledThreads ?? 0,
      totalItemsIngested: 0, // Not available from this endpoint
      itemsIngestedToday: runs.reduce((acc: number, r: { itemsNew?: number }) => acc + (r.itemsNew ?? 0), 0),
      activeJobs: runs.filter((r: { status?: string }) => r.status === 'running').length,
      scheduledJobs: status.queues?.scheduled ?? 0,
    },
    sources: sources.map((s: {
      id: string;
      name: string;
      baseUrl: string;
      enabled: boolean;
      rateLimitConfig?: { requestsPerMinute?: number };
      createdAt: string;
    }) => ({
      id: s.id,
      name: s.name,
      baseUrl: s.baseUrl,
      enabled: s.enabled,
      rateLimitRequests: s.rateLimitConfig?.requestsPerMinute ?? 30,
      rateLimitWindowMs: 60000,
      lastRunAt: null,
      lastRunStatus: null,
      createdAt: s.createdAt,
    })),
    recentRuns: runs.map((r: {
      id: string;
      source?: string;
      thread?: string;
      threadId?: string;
      status: string;
      itemsFound?: number;
      itemsNew?: number;
      itemsFailed?: number;
      startedAt: string;
      finishedAt?: string;
      error?: string;
    }) => ({
      id: r.id,
      sourceId: r.source ?? '',
      threadId: r.threadId ?? null,
      status: r.status as 'running' | 'completed' | 'failed' | 'partial',
      itemsFound: r.itemsFound ?? 0,
      itemsNew: r.itemsNew ?? 0,
      itemsFailed: r.itemsFailed ?? 0,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      errorSummary: r.error ?? null,
    })),
  };
}

async function fetchSourceThreads(sourceId: string): Promise<Thread[]> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/admin/ingestion/threads?sourceId=${sourceId}`,
    {
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch threads');
  }

  const threads = await response.json();
  // Map backend response to frontend interface
  return threads.map((t: {
    id: string;
    sourceId: string;
    externalId: string;
    url: string;
    enabled: boolean;
    priority: number;
    checkpoint?: { lastRunAt?: string };
  }) => ({
    id: t.id,
    sourceId: t.sourceId,
    externalId: t.externalId,
    url: t.url,
    enabled: t.enabled,
    priority: t.priority,
    lastScannedAt: t.checkpoint?.lastRunAt ?? null,
    itemsIngested: 0, // Not available from this endpoint
  }));
}

async function triggerIngestion(_sourceId: string, threadId?: string) {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

  // Use thread-specific endpoint if threadId provided, otherwise trigger all
  const endpoint = threadId
    ? `${apiBase}/admin/ingestion/trigger/${threadId}`
    : `${apiBase}/admin/ingestion/trigger`;

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to trigger ingestion');
  }

  return response.json();
}

async function toggleSource(sourceId: string, enabled: boolean) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/admin/ingestion/sources/${sourceId}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to toggle source');
  }

  return response.json();
}

async function createSource(data: {
  name: string;
  baseUrl: string;
  mode: string;
  rateLimitRequests: number;
  scraperConfig?: ScraperConfig;
}) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/admin/ingestion/sources`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: data.name,
        baseUrl: data.baseUrl,
        mode: data.mode,
        rateLimitConfig: {
          requestsPerMinute: data.rateLimitRequests,
        },
        scraperConfig: data.scraperConfig,
        enabled: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to create source');
  }

  return response.json();
}

async function createThread(data: {
  sourceId: string;
  externalId: string;
  url: string;
  displayName?: string;
  priority?: number;
}) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/admin/ingestion/threads`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceId: data.sourceId,
        externalId: data.externalId,
        url: data.url,
        displayName: data.displayName,
        priority: data.priority ?? 0,
        enabled: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to create thread');
  }

  return response.json();
}

export default function IngestionPage() {
  const queryClient = useQueryClient();
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [showAddSource, setShowAddSource] = useState(false);
  const [showAddThread, setShowAddThread] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'ingestion', 'status'],
    queryFn: fetchIngestionStatus,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ['admin', 'ingestion', 'threads', selectedSource?.id],
    queryFn: () => (selectedSource ? fetchSourceThreads(selectedSource.id) : Promise.resolve([])),
    enabled: !!selectedSource,
  });

  const triggerMutation = useMutation({
    mutationFn: ({ sourceId, threadId }: { sourceId: string; threadId?: string }) =>
      triggerIngestion(sourceId, threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ sourceId, enabled }: { sourceId: string; enabled: boolean }) =>
      toggleSource(sourceId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] });
    },
  });

  const createSourceMutation = useMutation({
    mutationFn: createSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] });
      setShowAddSource(false);
    },
  });

  const createThreadMutation = useMutation({
    mutationFn: createThread,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] });
      setShowAddThread(false);
    },
  });

  const { data: runMedia, isLoading: runMediaLoading } = useQuery({
    queryKey: ['admin', 'ingestion', 'run-media', expandedRunId],
    queryFn: () => fetchRunMedia(expandedRunId!),
    enabled: !!expandedRunId,
  });

  const deleteMediaMutation = useMutation({
    mutationFn: deleteMediaItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion', 'run-media', expandedRunId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] });
    },
  });

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'success':
      case 'completed':
        return 'text-green-400';
      case 'partial':
        return 'text-yellow-400';
      case 'failed':
        return 'text-red-400';
      case 'running':
        return 'text-blue-400';
      default:
        return 'text-[var(--muted)]';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-title mb-2">Ingestion Status</h1>
        <p className="text-caption">Monitor and manage content ingestion</p>
      </div>

      {/* Error banner */}
      {isError && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          Unable to connect to ingestion API. The backend may not be running or the endpoints are not implemented yet.
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 border border-[var(--border)]">
          <p className="text-caption mb-1">Active Sources</p>
          <p className="text-xl font-medium">
            {isLoading || isError ? '—' : `${data?.stats?.enabledSources ?? 0}/${data?.stats?.totalSources ?? 0}`}
          </p>
        </div>
        <div className="p-4 border border-[var(--border)]">
          <p className="text-caption mb-1">Active Threads</p>
          <p className="text-xl font-medium">
            {isLoading || isError ? '—' : `${data?.stats?.enabledThreads ?? 0}/${data?.stats?.totalThreads ?? 0}`}
          </p>
        </div>
        <div className="p-4 border border-[var(--border)]">
          <p className="text-caption mb-1">Items Today</p>
          <p className="text-xl font-medium text-green-400">
            {isLoading || isError ? '—' : `+${(data?.stats?.itemsIngestedToday ?? 0).toLocaleString()}`}
          </p>
        </div>
        <div className="p-4 border border-[var(--border)]">
          <p className="text-caption mb-1">Active Jobs</p>
          <p className="text-xl font-medium">
            {isLoading || isError ? '—' : (data?.stats?.activeJobs ?? 0)}
          </p>
        </div>
      </div>

      {/* Sources list */}
      <div className="border border-[var(--border)]">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium">Sources</h2>
          <button
            onClick={() => setShowAddSource(true)}
            className="px-3 py-1 text-xs border border-[var(--border)] hover:border-[var(--fg)] transition-colors"
          >
            + Add Source
          </button>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="w-32 h-5 skeleton" />
                <div className="flex-1 h-4 skeleton" />
                <div className="w-20 h-8 skeleton" />
              </div>
            ))
          ) : isError ? (
            <div className="p-4 text-[var(--muted)] text-sm">No sources available - API not connected</div>
          ) : !data?.sources || data?.sources.length === 0 ? (
            <div className="p-8 text-center text-caption">No sources configured</div>
          ) : (
            data?.sources.map((source) => (
              <div
                key={source.id}
                className={`p-4 flex items-center gap-4 cursor-pointer transition-colors ${
                  selectedSource?.id === source.id
                    ? 'bg-[var(--fg)]/5'
                    : 'hover:bg-[var(--fg)]/5'
                }`}
                onClick={() => setSelectedSource(selectedSource?.id === source.id ? null : source)}
              >
                {/* Status indicator */}
                <div
                  className={`w-2 h-2 rounded-full ${
                    source.enabled ? 'bg-green-400' : 'bg-[var(--muted)]'
                  }`}
                />

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{source.name}</p>
                  <p className="text-xs text-[var(--muted)] truncate">{source.baseUrl}</p>
                </div>

                {/* Last run */}
                <div className="text-right">
                  <p className={`text-xs ${getStatusColor(source.lastRunStatus)}`}>
                    {source.lastRunStatus || 'Never run'}
                  </p>
                  {source.lastRunAt && (
                    <p className="text-xs text-[var(--muted)]">
                      {new Date(source.lastRunAt).toLocaleString()}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation.mutate({ sourceId: source.id, enabled: !source.enabled });
                    }}
                    disabled={toggleMutation.isPending}
                    className={`px-3 py-1 text-xs border transition-colors ${
                      source.enabled
                        ? 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]'
                        : 'border-green-500/50 text-green-400 hover:bg-green-500/10'
                    }`}
                  >
                    {source.enabled ? 'Pause' : 'Enable'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerMutation.mutate({ sourceId: source.id });
                    }}
                    disabled={triggerMutation.isPending || !source.enabled}
                    className="px-3 py-1 text-xs border border-[var(--border)] hover:border-[var(--fg)] transition-colors disabled:opacity-50"
                  >
                    Run Now
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Selected source threads */}
      {selectedSource && (
        <div className="border border-[var(--border)]">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="text-sm font-medium">Threads for {selectedSource.name}</h2>
            <button
              onClick={() => setShowAddThread(true)}
              className="px-3 py-1 text-xs border border-[var(--border)] hover:border-[var(--fg)] transition-colors"
            >
              + Add Thread
            </button>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {threadsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-4 flex items-center gap-4">
                  <div className="flex-1 h-4 skeleton" />
                  <div className="w-20 h-4 skeleton" />
                </div>
              ))
            ) : threads?.length === 0 ? (
              <div className="p-8 text-center text-caption">No threads configured</div>
            ) : (
              threads?.map((thread) => (
                <div key={thread.id} className="p-4 flex items-center gap-4">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      thread.enabled ? 'bg-green-400' : 'bg-[var(--muted)]'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{thread.url}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {thread.itemsIngested.toLocaleString()} items ingested
                    </p>
                  </div>
                  <button
                    onClick={() => triggerMutation.mutate({ sourceId: selectedSource.id, threadId: thread.id })}
                    disabled={triggerMutation.isPending || !thread.enabled}
                    className="px-3 py-1 text-xs border border-[var(--border)] hover:border-[var(--fg)] transition-colors disabled:opacity-50"
                  >
                    Run
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Recent runs */}
      <div className="border border-[var(--border)]">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">Recent Runs</h2>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="w-20 h-4 skeleton" />
                <div className="flex-1 h-4 skeleton" />
                <div className="w-16 h-4 skeleton" />
              </div>
            ))
          ) : isError || !data?.recentRuns || data?.recentRuns.length === 0 ? (
            <div className="p-8 text-center text-caption">No recent runs</div>
          ) : (
            data?.recentRuns.slice(0, 10).map((run) => (
              <div key={run.id}>
                <div
                  className="p-4 flex items-center gap-4 cursor-pointer hover:bg-[var(--fg)]/5 transition-colors"
                  onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className={`text-[var(--muted)] shrink-0 transition-transform ${expandedRunId === run.id ? 'rotate-90' : ''}`}
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  <span className={`text-xs font-medium ${getStatusColor(run.status)}`}>
                    {run.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--muted)]">
                      {new Date(run.startedAt).toLocaleString()}
                      {run.finishedAt && ` → ${new Date(run.finishedAt).toLocaleTimeString()}`}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <span className="text-green-400">+{run.itemsNew}</span>
                    {run.itemsFailed > 0 && (
                      <span className="text-red-400 ml-2">-{run.itemsFailed}</span>
                    )}
                  </div>
                  {run.errorSummary && (
                    <span
                      className="text-xs text-red-400 truncate max-w-[200px]"
                      title={run.errorSummary}
                    >
                      {run.errorSummary}
                    </span>
                  )}
                </div>

                {/* Expanded media grid */}
                {expandedRunId === run.id && (
                  <div className="px-4 pb-4 border-t border-[var(--border)] bg-[var(--fg)]/[0.02]">
                    {runMediaLoading ? (
                      <div className="py-6 text-center text-caption">Loading media...</div>
                    ) : !runMedia || runMedia.length === 0 ? (
                      <div className="py-6 text-center text-caption">No media items in this run</div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 pt-3">
                        {runMedia.map((item) => (
                          <div key={item.id} className="group relative aspect-square bg-[var(--border)] overflow-hidden">
                            {item.mediaType === 'video' ? (
                              <video
                                src={item.mediaUrl}
                                poster={item.thumbnailUrl}

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
                            {/* Delete button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Delete this item? It will be blocked from re-ingestion.')) {
                                  deleteMediaMutation.mutate(item.id);
                                }
                              }}
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
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Source Modal */}
      {showAddSource && (
        <AddSourceModal
          onClose={() => setShowAddSource(false)}
          onSubmit={(data) => createSourceMutation.mutate(data)}
          isLoading={createSourceMutation.isPending}
          error={createSourceMutation.error}
        />
      )}

      {/* Add Thread Modal */}
      {showAddThread && selectedSource && (
        <AddThreadModal
          sourceId={selectedSource.id}
          sourceName={selectedSource.name}
          onClose={() => setShowAddThread(false)}
          onSubmit={(data) => createThreadMutation.mutate(data)}
          isLoading={createThreadMutation.isPending}
          error={createThreadMutation.error}
        />
      )}
    </div>
  );
}

// Scraper config type
interface ScraperConfig {
  selectors: {
    itemContainer: string;
    item: string;
    itemId: string | { attr: string };
    permalink: string | { attr: string };
    timestamp: string | { attr: string };
    author: string | { attr: string };
    media: string | { attr: string };
    title?: string;
    caption?: string;
    thumbnail?: string | { attr: string };
    tags?: string;
  };
  urlPattern: {
    basePath: string;
    pageStyle: 'query' | 'path' | 'offset';
    pageParam?: string;
    pathFormat?: string;
    itemsPerPage?: number;
  };
  newestFirst?: boolean;
}

// Add Source Modal Component
function AddSourceModal({
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    baseUrl: string;
    mode: string;
    rateLimitRequests: number;
    scraperConfig?: ScraperConfig;
  }) => void;
  isLoading: boolean;
  error: Error | null;
}) {
  const [formData, setFormData] = useState({
    name: '',
    baseUrl: '',
    mode: 'scrape',
    rateLimitRequests: 30,
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scraperConfig, setScraperConfig] = useState<ScraperConfig>({
    selectors: {
      itemContainer: '',
      item: '',
      itemId: '',
      permalink: '',
      timestamp: '',
      author: '',
      media: '',
    },
    urlPattern: {
      basePath: '/',
      pageStyle: 'query',
      pageParam: 'page',
    },
    newestFirst: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Only include scraperConfig if selectors are filled in
    const hasConfig = scraperConfig.selectors.itemContainer && scraperConfig.selectors.item;
    onSubmit({
      ...formData,
      scraperConfig: hasConfig ? scraperConfig : undefined,
    });
  };

  const updateSelector = (key: keyof typeof scraperConfig.selectors, value: string) => {
    setScraperConfig(prev => ({
      ...prev,
      selectors: { ...prev.selectors, [key]: value },
    }));
  };

  const updateUrlPattern = (key: keyof typeof scraperConfig.urlPattern, value: string | number) => {
    setScraperConfig(prev => ({
      ...prev,
      urlPattern: { ...prev.urlPattern, [key]: value },
    }));
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[200]" onClick={onClose} />
      <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-[var(--bg)] border border-[var(--border)] w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="text-title">Add Source</h2>
            <button onClick={onClose} className="p-2 -mr-2 text-[var(--muted)] hover:text-[var(--fg)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="name" className="block text-caption">Name</label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Reddit, Giphy"
                  className="auth-input"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="rateLimit" className="block text-caption">Rate Limit (req/min)</label>
                <input
                  id="rateLimit"
                  type="number"
                  min="1"
                  max="120"
                  value={formData.rateLimitRequests}
                  onChange={(e) => setFormData({ ...formData, rateLimitRequests: parseInt(e.target.value) || 30 })}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="baseUrl" className="block text-caption">Base URL</label>
              <input
                id="baseUrl"
                type="url"
                value={formData.baseUrl}
                onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                placeholder="https://example.com"
                className="auth-input"
                required
              />
            </div>

            {/* Advanced configuration toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
              Scraper Configuration (CSS Selectors)
            </button>

            {showAdvanced && (
              <div className="space-y-4 p-4 border border-[var(--border)] bg-[var(--fg)]/5">
                <p className="text-xs text-[var(--muted)]">
                  Configure CSS selectors to extract content from the source. Use browser DevTools to inspect the page HTML.
                </p>

                {/* URL Pattern */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">URL Pattern</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Base Path</label>
                      <input
                        type="text"
                        value={scraperConfig.urlPattern.basePath}
                        onChange={(e) => updateUrlPattern('basePath', e.target.value)}
                        placeholder="/gifs"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Page Style</label>
                      <select
                        value={scraperConfig.urlPattern.pageStyle}
                        onChange={(e) => updateUrlPattern('pageStyle', e.target.value)}
                        className="auth-input text-sm"
                      >
                        <option value="query">Query (?page=2)</option>
                        <option value="path">Path (/page/2)</option>
                        <option value="offset">Offset (?offset=20)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Page Param</label>
                      <input
                        type="text"
                        value={scraperConfig.urlPattern.pageParam || ''}
                        onChange={(e) => updateUrlPattern('pageParam', e.target.value)}
                        placeholder="page"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Items per Page</label>
                      <input
                        type="number"
                        value={scraperConfig.urlPattern.itemsPerPage || ''}
                        onChange={(e) => updateUrlPattern('itemsPerPage', parseInt(e.target.value) || 20)}
                        placeholder="20"
                        className="auth-input text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* CSS Selectors */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">CSS Selectors</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Item Container *</label>
                      <input
                        type="text"
                        value={scraperConfig.selectors.itemContainer}
                        onChange={(e) => updateSelector('itemContainer', e.target.value)}
                        placeholder=".posts, #content"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Item *</label>
                      <input
                        type="text"
                        value={scraperConfig.selectors.item}
                        onChange={(e) => updateSelector('item', e.target.value)}
                        placeholder=".post, article"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Item ID *</label>
                      <input
                        type="text"
                        value={typeof scraperConfig.selectors.itemId === 'string' ? scraperConfig.selectors.itemId : ''}
                        onChange={(e) => updateSelector('itemId', e.target.value)}
                        placeholder="data-id or .id"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Permalink *</label>
                      <input
                        type="text"
                        value={typeof scraperConfig.selectors.permalink === 'string' ? scraperConfig.selectors.permalink : ''}
                        onChange={(e) => updateSelector('permalink', e.target.value)}
                        placeholder="a.link"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Timestamp *</label>
                      <input
                        type="text"
                        value={typeof scraperConfig.selectors.timestamp === 'string' ? scraperConfig.selectors.timestamp : ''}
                        onChange={(e) => updateSelector('timestamp', e.target.value)}
                        placeholder="time, .date"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Author *</label>
                      <input
                        type="text"
                        value={typeof scraperConfig.selectors.author === 'string' ? scraperConfig.selectors.author : ''}
                        onChange={(e) => updateSelector('author', e.target.value)}
                        placeholder=".author, .username"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Media *</label>
                      <input
                        type="text"
                        value={typeof scraperConfig.selectors.media === 'string' ? scraperConfig.selectors.media : ''}
                        onChange={(e) => updateSelector('media', e.target.value)}
                        placeholder="img, video, .media"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Title (optional)</label>
                      <input
                        type="text"
                        value={scraperConfig.selectors.title || ''}
                        onChange={(e) => updateSelector('title', e.target.value)}
                        placeholder="h2, .title"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Caption (optional)</label>
                      <input
                        type="text"
                        value={scraperConfig.selectors.caption || ''}
                        onChange={(e) => updateSelector('caption', e.target.value)}
                        placeholder=".caption, .description"
                        className="auth-input text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs text-[var(--muted)]">Tags (optional)</label>
                      <input
                        type="text"
                        value={scraperConfig.selectors.tags || ''}
                        onChange={(e) => updateSelector('tags', e.target.value)}
                        placeholder=".tag, .category"
                        className="auth-input text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Order */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="newestFirst"
                    checked={scraperConfig.newestFirst}
                    onChange={(e) => setScraperConfig(prev => ({ ...prev, newestFirst: e.target.checked }))}
                    className="rounded"
                  />
                  <label htmlFor="newestFirst" className="text-sm text-[var(--muted)]">
                    Source shows newest items first
                  </label>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error.message}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn flex-1">
                Cancel
              </button>
              <button type="submit" disabled={isLoading} className="btn btn-primary flex-1">
                {isLoading ? 'Adding...' : 'Add Source'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// Add Thread Modal Component
function AddThreadModal({
  sourceId,
  sourceName,
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  sourceId: string;
  sourceName: string;
  onClose: () => void;
  onSubmit: (data: { sourceId: string; externalId: string; url: string; displayName?: string; priority?: number }) => void;
  isLoading: boolean;
  error: Error | null;
}) {
  const [formData, setFormData] = useState({
    url: '',
    externalId: '',
    displayName: '',
    priority: 0,
  });

  // Auto-generate externalId from URL
  const handleUrlChange = (url: string) => {
    setFormData({
      ...formData,
      url,
      externalId: url.replace(/https?:\/\/[^/]+/, '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100) || 'thread',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      sourceId,
      url: formData.url,
      externalId: formData.externalId,
      displayName: formData.displayName || undefined,
      priority: formData.priority,
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[200]" onClick={onClose} />
      <div className="fixed inset-0 z-[201] flex items-center justify-center p-4">
        <div className="bg-[var(--bg)] border border-[var(--border)] w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <div>
              <h2 className="text-title">Add Thread</h2>
              <p className="text-xs text-[var(--muted)]">to {sourceName}</p>
            </div>
            <button onClick={onClose} className="p-2 -mr-2 text-[var(--muted)] hover:text-[var(--fg)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="threadUrl" className="block text-caption">Thread URL</label>
              <input
                id="threadUrl"
                type="url"
                value={formData.url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://example.com/feed/gifs"
                className="auth-input"
                required
              />
              <p className="text-xs text-[var(--muted)]">The specific page/feed to scrape</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="externalId" className="block text-caption">External ID</label>
              <input
                id="externalId"
                type="text"
                value={formData.externalId}
                onChange={(e) => setFormData({ ...formData, externalId: e.target.value })}
                placeholder="gifs-top"
                className="auth-input"
                required
              />
              <p className="text-xs text-[var(--muted)]">Unique identifier for this thread</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="displayName" className="block text-caption">
                Display Name <span className="text-[var(--muted)]">(optional)</span>
              </label>
              <input
                id="displayName"
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="Top GIFs"
                className="auth-input"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="priority" className="block text-caption">Priority</label>
              <input
                id="priority"
                type="number"
                min="0"
                max="10"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                className="auth-input"
              />
              <p className="text-xs text-[var(--muted)]">Higher = checked more frequently (0-10)</p>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error.message}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="btn flex-1">
                Cancel
              </button>
              <button type="submit" disabled={isLoading} className="btn btn-primary flex-1">
                {isLoading ? 'Adding...' : 'Add Thread'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
