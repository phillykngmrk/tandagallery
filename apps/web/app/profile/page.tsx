'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

type Tab = 'activity' | 'likes' | 'comments';

export default function ProfilePage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('activity');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login');
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-caption">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'activity', label: 'Activity' },
    { id: 'likes', label: 'Likes' },
    { id: 'comments', label: 'Comments' },
  ];

  return (
    <div className="min-h-screen">
      <section className="container-wide py-16">
        <div className="max-w-3xl">
          {/* Profile header */}
          <div className="flex items-start gap-6 mb-8 fade-in">
            {/* Avatar */}
            <div className="w-20 h-20 bg-[var(--border)] flex items-center justify-center text-2xl font-medium text-[var(--muted)]">
              {(user.displayName || user.username).charAt(0).toUpperCase()}
            </div>

            {/* Info */}
            <div className="flex-1">
              <h1 className="text-title mb-1">
                {user.displayName || user.username}
              </h1>
              <p className="text-caption mb-3">@{user.username}</p>
              <p className="text-caption">
                Member since {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-8 mb-8 fade-in fade-in-delay-1">
            <Link href="/favorites" className="group">
              <span className="block text-title">—</span>
              <span className="text-caption group-hover:text-[var(--fg)] transition-colors">
                Favorites
              </span>
            </Link>
            <div>
              <span className="block text-title">—</span>
              <span className="text-caption">Likes</span>
            </div>
            <div>
              <span className="block text-title">—</span>
              <span className="text-caption">Comments</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-6 border-b border-[var(--border)] fade-in fade-in-delay-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-4 text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'text-[var(--fg)] border-b border-[var(--fg)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Tab content */}
      <section className="container-wide py-8">
        <div className="max-w-3xl">
          {activeTab === 'activity' && (
            <div className="text-center py-12 fade-in">
              <p className="text-caption">Your recent activity will appear here</p>
            </div>
          )}

          {activeTab === 'likes' && (
            <div className="text-center py-12 fade-in">
              <p className="text-caption mb-4">Content you&apos;ve liked will appear here</p>
              <Link href="/" className="btn">
                Browse feed
              </Link>
            </div>
          )}

          {activeTab === 'comments' && (
            <div className="text-center py-12 fade-in">
              <p className="text-caption">Your comments will appear here</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
