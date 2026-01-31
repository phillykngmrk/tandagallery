'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [time, setTime] = useState<string>('');
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Live time display
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
          timeZoneName: 'short',
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Scroll progress
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      setScrollProgress(progress);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { href: '/', label: 'Feed' },
    { href: '/trending', label: 'Most Viewed' },
    { href: '/tags', label: 'Tags' },
  ];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setShowSearch(false);
    setSearchQuery('');
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const toggleSearch = () => {
    setShowSearch((prev) => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      return !prev;
    });
    setSearchQuery('');
  };

  const handleLogout = async () => {
    await logout();
    setShowUserMenu(false);
  };

  return (
    <>
      {/* Progress bar */}
      <div
        className="progress-bar"
        style={{ transform: `scaleX(${scrollProgress / 100})` }}
      />

      <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="container-wide">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link href="/" className="text-title tracking-tight">
              T & A Gallery
            </Link>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-8">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link text-sm ${
                    pathname === item.href ? 'active' : ''
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-6">
              {/* Search */}
              <div className="flex items-center">
                {showSearch && (
                  <form onSubmit={handleSearchSubmit} className="mr-3">
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onBlur={() => {
                        if (!searchQuery.trim()) setShowSearch(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setShowSearch(false);
                          setSearchQuery('');
                        }
                      }}
                      placeholder="Search..."
                      className="w-40 md:w-56 bg-transparent border-b border-[var(--border)] focus:border-[var(--fg)] text-sm text-[var(--fg)] placeholder:text-[var(--muted)] outline-none py-1 transition-colors"
                    />
                  </form>
                )}
                <button
                  onClick={toggleSearch}
                  className="text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                  aria-label="Search"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </button>
              </div>
              {/* Live time */}
              <span className="live-time hidden lg:block">
                {time}
              </span>

              {/* Auth section */}
              {isLoading ? (
                <div className="w-16 h-8 skeleton" />
              ) : isAuthenticated ? (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                  >
                    <span className="hidden sm:inline">
                      {user?.displayName || user?.username}
                    </span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className={`transition-transform ${showUserMenu ? 'rotate-180' : ''}`}
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>

                  {showUserMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowUserMenu(false)}
                      />
                      <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--card-bg)] border border-[var(--border)] z-50">
                        <div className="py-1">
                          <Link
                            href="/profile"
                            className="block px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)]/50 transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            Profile
                          </Link>
                          {user?.role === 'admin' && (
                            <Link
                              href="/admin"
                              className="block px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)]/50 transition-colors"
                              onClick={() => setShowUserMenu(false)}
                            >
                              Admin
                            </Link>
                          )}
                          <div className="divider my-1" />
                          <button
                            onClick={handleLogout}
                            className="w-full text-left px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)]/50 transition-colors"
                          >
                            Sign out
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <Link href="/auth/login" className="btn text-sm py-2 px-4">
                  Sign in
                </Link>
              )}

              {/* Mobile menu button */}
              <button
                className="md:hidden p-2 -mr-2"
                aria-label="Menu"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M3 6h14M3 10h14M3 14h14" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom border */}
        <div className="divider" />
      </header>

      {/* Spacer for fixed header */}
      <div className="h-16 md:h-20" />
    </>
  );
}
