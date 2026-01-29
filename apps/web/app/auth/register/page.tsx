'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const router = useRouter();
  const { register, isLoading: authLoading } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    displayName: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (formData.username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    setIsSubmitting(true);

    try {
      await register({
        email: formData.email,
        username: formData.username,
        password: formData.password,
        displayName: formData.displayName || undefined,
      });
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-12 fade-in">
          <h1 className="text-title mb-2">Create account</h1>
          <p className="text-caption">
            Join the community. It only takes a moment.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 fade-in fade-in-delay-1">
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
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              className="auth-input"
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="username" className="block text-caption">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              value={formData.username}
              onChange={handleChange}
              className="auth-input"
              placeholder="username"
              required
              autoComplete="username"
              pattern="[a-zA-Z0-9_]+"
              title="Letters, numbers, and underscores only"
            />
            <p className="text-xs text-[var(--muted)]">
              Letters, numbers, and underscores only
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="displayName" className="block text-caption">
              Display name <span className="text-[var(--muted)]">(optional)</span>
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              value={formData.displayName}
              onChange={handleChange}
              className="auth-input"
              placeholder="Your Name"
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="block text-caption">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              className="auth-input"
              placeholder="••••••••"
              required
              autoComplete="new-password"
              minLength={8}
            />
            <p className="text-xs text-[var(--muted)]">
              At least 8 characters
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="block text-caption">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange}
              className="auth-input"
              placeholder="••••••••"
              required
              autoComplete="new-password"
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
                Creating account
              </span>
            ) : (
              'Create account'
            )}
          </button>
        </form>

        <div className="mt-8 text-center fade-in fade-in-delay-2">
          <p className="text-caption">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-[var(--fg)] hover:underline">
              Sign in
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
