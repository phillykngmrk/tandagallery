'use client';

import { useState } from 'react';
import { InfiniteFeed } from '@/components/feed/infinite-feed';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
] as const;

export function MostViewedClient() {
  const [period, setPeriod] = useState('week');

  return (
    <div className="min-h-screen">
      {/* Hero section */}
      <section className="container-wide py-16 md:py-24">
        <div className="max-w-3xl">
          <h1 className="text-display mb-6 fade-in">
            Most Viewed
          </h1>
        </div>

        {/* Time filter buttons */}
        <div className="flex flex-wrap gap-2 mt-8 fade-in fade-in-delay-2">
          {PERIODS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPeriod(value)}
              className={`px-4 py-2 text-sm border transition-colors ${
                period === value
                  ? 'border-[var(--fg)] text-[var(--fg)] bg-[var(--fg)]/10'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)] hover:border-[var(--fg)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="divider" />

      {/* Feed section */}
      <section className="py-1">
        <InfiniteFeed type="trending" period={period} />
      </section>
    </div>
  );
}
