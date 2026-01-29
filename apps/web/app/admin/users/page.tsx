'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserRole } from '@aggragif/shared';

interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: UserRole;
  isActive: boolean;
  isBanned: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  likeCount: number;
  commentCount: number;
}

interface UsersResponse {
  items: User[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number;
  };
}

async function fetchUsers(params: { search?: string; cursor?: string }): Promise<UsersResponse> {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('search', params.search);
  if (params.cursor) searchParams.set('cursor', params.cursor);
  searchParams.set('limit', '50');

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/admin/users?${searchParams.toString()}`,
    {
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch users');
  }

  return response.json();
}

async function moderateUser(data: { userId: string; action: 'ban' | 'unban' | 'warn' | 'change_role'; role?: UserRole }) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}/admin/users/${data.userId}/moderate`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: data.action,
        role: data.role,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to moderate user');
  }

  return response.json();
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Debounce search
  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout((window as unknown as { searchTimeout?: NodeJS.Timeout }).searchTimeout);
    (window as unknown as { searchTimeout?: NodeJS.Timeout }).searchTimeout = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'users', debouncedSearch],
    queryFn: () => fetchUsers({ search: debouncedSearch }),
  });

  const moderateMutation = useMutation({
    mutationFn: moderateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setSelectedUser(null);
    },
  });

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-500/10 text-purple-400';
      case 'moderator':
        return 'bg-blue-500/10 text-blue-400';
      default:
        return 'bg-[var(--fg)]/10 text-[var(--muted)]';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-title mb-2">Users</h1>
          <p className="text-caption">
            {data?.pagination.totalCount?.toLocaleString() ?? '—'} total users
          </p>
        </div>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by username or email..."
          className="auth-input max-w-md"
        />
      </div>

      {/* Users table */}
      <div className="border border-[var(--border)] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="px-4 py-3 text-xs font-medium text-[var(--muted)]">User</th>
              <th className="px-4 py-3 text-xs font-medium text-[var(--muted)]">Role</th>
              <th className="px-4 py-3 text-xs font-medium text-[var(--muted)]">Status</th>
              <th className="px-4 py-3 text-xs font-medium text-[var(--muted)]">Activity</th>
              <th className="px-4 py-3 text-xs font-medium text-[var(--muted)]">Joined</th>
              <th className="px-4 py-3 text-xs font-medium text-[var(--muted)]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3">
                    <div className="w-32 h-4 skeleton" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-16 h-4 skeleton" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-16 h-4 skeleton" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-20 h-4 skeleton" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-24 h-4 skeleton" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-16 h-4 skeleton" />
                  </td>
                </tr>
              ))
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-red-400">
                  Failed to load users
                </td>
              </tr>
            ) : data?.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-caption">
                  No users found
                </td>
              </tr>
            ) : (
              data?.items.map((user) => (
                <tr key={user.id} className="hover:bg-[var(--fg)]/5">
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">
                        {user.displayName || user.username}
                      </p>
                      <p className="text-xs text-[var(--muted)]">@{user.username}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 ${getRoleBadgeColor(user.role)}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.isBanned ? (
                      <span className="text-xs px-2 py-0.5 bg-red-500/10 text-red-400">
                        Banned
                      </span>
                    ) : user.isActive ? (
                      <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400">
                        Active
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-yellow-500/10 text-yellow-400">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">
                    {user.likeCount} likes · {user.commentCount} comments
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedUser(user)}
                      className="text-xs text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* User detail modal */}
      {selectedUser && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[200]"
            onClick={() => setSelectedUser(null)}
          />
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-[var(--bg)] border-l border-[var(--border)] z-[201] overflow-y-auto">
            <div className="sticky top-0 bg-[var(--bg)] border-b border-[var(--border)] px-6 py-4 flex items-center justify-between">
              <h2 className="text-title">User Details</h2>
              <button
                onClick={() => setSelectedUser(null)}
                className="p-2 -mr-2 text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* User info */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-[var(--border)] flex items-center justify-center text-xl font-medium text-[var(--muted)]">
                  {(selectedUser.displayName || selectedUser.username).charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium">{selectedUser.displayName || selectedUser.username}</p>
                  <p className="text-sm text-[var(--muted)]">@{selectedUser.username}</p>
                  <p className="text-xs text-[var(--muted)]">{selectedUser.email}</p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 border border-[var(--border)]">
                  <p className="text-xs text-[var(--muted)]">Likes</p>
                  <p className="text-lg font-medium">{selectedUser.likeCount}</p>
                </div>
                <div className="p-3 border border-[var(--border)]">
                  <p className="text-xs text-[var(--muted)]">Comments</p>
                  <p className="text-lg font-medium">{selectedUser.commentCount}</p>
                </div>
                <div className="p-3 border border-[var(--border)]">
                  <p className="text-xs text-[var(--muted)]">Role</p>
                  <p className="text-lg font-medium capitalize">{selectedUser.role}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3 pt-4 border-t border-[var(--border)]">
                <p className="text-caption">Actions</p>
                <div className="space-y-2">
                  {selectedUser.isBanned ? (
                    <button
                      onClick={() =>
                        moderateMutation.mutate({ userId: selectedUser.id, action: 'unban' })
                      }
                      disabled={moderateMutation.isPending}
                      className="btn w-full justify-center text-green-400 border-green-500/50 hover:bg-green-500/10"
                    >
                      Unban User
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        moderateMutation.mutate({ userId: selectedUser.id, action: 'ban' })
                      }
                      disabled={moderateMutation.isPending}
                      className="btn w-full justify-center text-red-400 border-red-500/50 hover:bg-red-500/10"
                    >
                      Ban User
                    </button>
                  )}

                  {selectedUser.role === 'user' && (
                    <button
                      onClick={() =>
                        moderateMutation.mutate({
                          userId: selectedUser.id,
                          action: 'change_role',
                          role: 'moderator',
                        })
                      }
                      disabled={moderateMutation.isPending}
                      className="btn w-full justify-center"
                    >
                      Promote to Moderator
                    </button>
                  )}

                  {selectedUser.role === 'moderator' && (
                    <button
                      onClick={() =>
                        moderateMutation.mutate({
                          userId: selectedUser.id,
                          action: 'change_role',
                          role: 'user',
                        })
                      }
                      disabled={moderateMutation.isPending}
                      className="btn w-full justify-center"
                    >
                      Demote to User
                    </button>
                  )}
                </div>

                {moderateMutation.isError && (
                  <p className="text-sm text-red-400">Failed to perform action</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
