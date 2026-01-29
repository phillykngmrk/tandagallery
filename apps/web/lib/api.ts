import type { PaginatedResponse, MediaItemSummary, MediaItemDetail, Comment } from '@aggragif/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let isRefreshing = false;
let refreshPromise: Promise<void> | null = null;

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  _retry = true,
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include', // Send httpOnly cookies
  });

  // Auto-refresh on 401
  if (response.status === 401 && _retry) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      }).then((res) => {
        if (!res.ok) throw new Error('Refresh failed');
      }).finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }

    try {
      await refreshPromise;
      // Retry original request once
      return request<T>(endpoint, options, false);
    } catch {
      throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: 'Unknown Error',
      message: 'An unexpected error occurred',
    }));
    throw new ApiError(response.status, error.code || 'UNKNOWN', error.message);
  }

  return response.json();
}

// Feed API
export const feedApi = {
  getFeed: (params?: { cursor?: string; limit?: number; type?: string; tag?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.type) searchParams.set('type', params.type);
    if (params?.tag) searchParams.set('tag', params.tag);

    const query = searchParams.toString();
    return request<PaginatedResponse<MediaItemSummary>>(
      `/feed${query ? `?${query}` : ''}`
    );
  },

  getTrending: (params?: { cursor?: string; limit?: number; period?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.period) searchParams.set('period', params.period);

    const query = searchParams.toString();
    return request<PaginatedResponse<MediaItemSummary>>(
      `/feed/trending${query ? `?${query}` : ''}`
    );
  },

  getTags: () => {
    return request<{ tags: Array<{ name: string; count: number }> }>('/feed/tags');
  },

  search: (params: { q: string; type?: string; cursor?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    searchParams.set('q', params.q);
    if (params.type) searchParams.set('type', params.type);
    if (params.cursor) searchParams.set('cursor', params.cursor);
    if (params.limit) searchParams.set('limit', params.limit.toString());

    return request<PaginatedResponse<MediaItemSummary>>(
      `/feed/search?${searchParams.toString()}`
    );
  },
};

// Media API
export const mediaApi = {
  getById: (id: string) => {
    return request<MediaItemDetail>(`/media/${id}`);
  },

  like: (id: string, action?: 'like' | 'unlike') => {
    return request<{ isLiked: boolean; likeCount: number }>(`/media/${id}/like`, {
      method: 'PUT',
      body: action ? JSON.stringify({ action }) : undefined,
    });
  },

  favorite: (id: string, action?: 'add' | 'remove') => {
    return request<{ isFavorited: boolean; favoriteCount: number }>(
      `/media/${id}/favorite`,
      {
        method: 'PUT',
        body: action ? JSON.stringify({ action }) : undefined,
      }
    );
  },

  getComments: (id: string, params?: { cursor?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return request<PaginatedResponse<Comment>>(
      `/media/${id}/comments${query ? `?${query}` : ''}`
    );
  },

  createComment: (id: string, content: string, parentId?: string) => {
    return request<Comment>(`/media/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, parentId }),
    });
  },
};

// User API
export const userApi = {
  getFavorites: (params?: { cursor?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return request<PaginatedResponse<MediaItemSummary>>(
      `/me/favorites${query ? `?${query}` : ''}`
    );
  },

  getLikes: (params?: { cursor?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return request<PaginatedResponse<MediaItemSummary>>(
      `/me/likes${query ? `?${query}` : ''}`
    );
  },
};

// Auth API
export const authApi = {
  login: (email: string, password: string) => {
    return request<{
      user: { id: string; email: string; username: string; displayName: string | null; avatarUrl?: string | null; role?: string };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  register: (email: string, username: string, password: string, displayName?: string) => {
    return request<{
      user: { id: string; email: string; username: string; displayName: string | null };
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password, displayName }),
    });
  },

  logout: () => {
    return request<{ success: boolean }>('/auth/logout', {
      method: 'POST',
    });
  },

  refresh: () => {
    return request<{ success: boolean }>('/auth/refresh', {
      method: 'POST',
    }, false); // Don't retry refresh itself
  },

  getMe: () => {
    return request<{
      id: string;
      email: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      bio: string | null;
      role: string;
    }>('/auth/me');
  },
};

export { ApiError };
