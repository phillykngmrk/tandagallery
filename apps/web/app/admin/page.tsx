'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

interface DashboardStats {
  totalMedia: number;
  totalUsers: number;
  totalComments: number;
  pendingReports: number;
  activeIngestionJobs: number;
  lastIngestionRun: string | null;
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/admin/dashboard/stats`,
    {
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch stats');
  }

  return response.json();
}

export default function AdminDashboardPage() {
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['admin', 'dashboard', 'stats'],
    queryFn: fetchDashboardStats,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const statCards = [
    {
      label: 'Total Media',
      value: isError ? '—' : (stats?.totalMedia ?? '—'),
      href: '/admin/media',
      color: 'text-blue-400',
    },
    {
      label: 'Total Users',
      value: isError ? '—' : (stats?.totalUsers ?? '—'),
      href: '/admin/users',
      color: 'text-green-400',
    },
    {
      label: 'Total Comments',
      value: isError ? '—' : (stats?.totalComments ?? '—'),
      href: '/admin/comments',
      color: 'text-purple-400',
    },
    {
      label: 'Pending Reports',
      value: isError ? '—' : (stats?.pendingReports ?? '—'),
      href: '/admin/moderation',
      color: 'text-red-400',
      highlight: !isError && (stats?.pendingReports ?? 0) > 0,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-title mb-2">Dashboard</h1>
        <p className="text-caption">Overview of your platform</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className={`p-6 border transition-colors ${
              card.highlight
                ? 'border-red-500/50 bg-red-500/5 hover:bg-red-500/10'
                : 'border-[var(--border)] hover:border-[var(--muted)]'
            }`}
          >
            <p className="text-caption mb-2">{card.label}</p>
            <p className={`text-2xl font-medium ${card.color}`}>
              {isLoading ? (
                <span className="inline-block w-12 h-7 skeleton" />
              ) : (
                typeof card.value === 'number' ? card.value.toLocaleString() : card.value
              )}
            </p>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent activity */}
        <div className="border border-[var(--border)] p-6">
          <h2 className="text-sm font-medium mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full skeleton" />
                  <div className="flex-1 h-4 skeleton" />
                </div>
              ))
            ) : (
              <p className="text-caption text-center py-4">Activity feed coming soon</p>
            )}
          </div>
        </div>

        {/* Ingestion status */}
        <div className="border border-[var(--border)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">Ingestion Status</h2>
            <Link
              href="/admin/ingestion"
              className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >
              View all →
            </Link>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-caption">Active Jobs</span>
              <span className="text-sm font-medium">
                {isLoading ? (
                  <span className="inline-block w-8 h-5 skeleton" />
                ) : isError ? (
                  '—'
                ) : (
                  stats?.activeIngestionJobs ?? 0
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption">Last Run</span>
              <span className="text-sm text-mono">
                {isLoading ? (
                  <span className="inline-block w-24 h-5 skeleton" />
                ) : isError ? (
                  '—'
                ) : stats?.lastIngestionRun ? (
                  new Date(stats.lastIngestionRun).toLocaleString()
                ) : (
                  'Never'
                )}
              </span>
            </div>
            <div className="pt-2">
              <Link href="/admin/ingestion" className="btn w-full justify-center text-sm">
                Manage Ingestion
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          Unable to connect to admin API. The backend may not be running or the endpoints are not implemented yet.
        </div>
      )}
    </div>
  );
}
