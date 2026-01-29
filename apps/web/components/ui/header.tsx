'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/trending', label: 'Trending' },
  { href: '/favorites', label: 'Favorites' },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-800 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 items-center px-4">
        {/* Logo */}
        <Link href="/" className="mr-6 flex items-center space-x-2">
          <span className="text-xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
            Tits & Ass Gallery
          </span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center space-x-6 text-sm font-medium">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'transition-colors hover:text-foreground/80',
                pathname === item.href
                  ? 'text-foreground'
                  : 'text-foreground/60'
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search */}
        <div className="mr-4">
          <input
            type="search"
            placeholder="Search..."
            className="h-9 w-64 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-sm placeholder:text-neutral-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        {/* Auth buttons */}
        <div className="flex items-center space-x-2">
          <Link
            href="/auth/login"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground/80 hover:text-foreground"
          >
            Log in
          </Link>
          <Link
            href="/auth/register"
            className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
