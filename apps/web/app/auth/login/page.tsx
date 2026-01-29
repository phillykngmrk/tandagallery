'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-caption">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-12 fade-in">
          <h1 className="text-title mb-2">Sign in</h1>
          <p className="text-caption">
            Welcome back. Enter your credentials to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 fade-in fade-in-delay-1">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="block text-caption">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="auth-input"
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="block text-caption">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary w-full justify-center"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin" />
                Signing in
              </span>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <div className="mt-8 text-center fade-in fade-in-delay-2">
          <p className="text-caption">
            Don&apos;t have an account?{' '}
            <Link href="/auth/register" className="text-[var(--fg)] hover:underline">
              Create one
            </Link>
          </p>
        </div>

        <div className="mt-12 text-center fade-in fade-in-delay-3">
          <Link href="/" className="text-caption hover:text-[var(--fg)] transition-colors">
            ← Back to feed
          </Link>
        </div>
      </div>
    </div>
  );
}
