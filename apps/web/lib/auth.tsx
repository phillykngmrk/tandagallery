'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { authApi } from './api';

interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; password: string; displayName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user on mount — cookies are sent automatically
  useEffect(() => {
    const loadUser = async () => {
      try {
        const userData = await authApi.getMe();
        setUser(userData);
      } catch {
        // Not authenticated or token expired — try refresh
        try {
          await authApi.refresh();
          const userData = await authApi.getMe();
          setUser(userData);
        } catch {
          // No valid session
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadUser();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    setUser({
      ...response.user,
      avatarUrl: response.user.avatarUrl ?? null,
      role: response.user.role ?? 'user',
    });
  }, []);

  const register = useCallback(async (data: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
  }) => {
    const response = await authApi.register(
      data.email,
      data.username,
      data.password,
      data.displayName
    );
    setUser({
      ...response.user,
      avatarUrl: null,
      role: 'user',
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors
    } finally {
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const userData = await authApi.getMe();
      setUser(userData);
    } catch {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
