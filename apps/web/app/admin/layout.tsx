'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

const ADMIN_NAV = [
  { href: '/admin', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/admin/moderation', label: 'Moderation', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { href: '/admin/ingestion', label: 'Ingestion', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' },
  { href: '/admin/users', label: 'Users', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || (user?.role !== 'admin' && user?.role !== 'moderator'))) {
      router.push('/');
    }
  }, [isLoading, isAuthenticated, user, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-caption">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated || (user?.role !== 'admin' && user?.role !== 'moderator')) {
    return null;
  }

  return (
    <div className="min-h-screen">
      {/* Admin header */}
      <div className="bg-[var(--card-bg)] border-b border-[var(--border)]">
        <div className="container-wide">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-4">
              <Link href="/admin" className="text-sm font-medium">
                Admin Panel
              </Link>
              <span className="text-xs px-2 py-0.5 bg-[var(--fg)]/10 text-[var(--muted)]">
                {user?.role}
              </span>
            </div>
            <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors">
              ← Back to site
            </Link>
          </div>
        </div>
      </div>

      <div className="container-wide py-6">
        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className="w-48 shrink-0">
            <nav className="space-y-1">
              {ADMIN_NAV.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? 'text-[var(--fg)] bg-[var(--fg)]/5'
                        : 'text-[var(--muted)] hover:text-[var(--fg)]'
                    }`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={item.icon} />
                    </svg>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
