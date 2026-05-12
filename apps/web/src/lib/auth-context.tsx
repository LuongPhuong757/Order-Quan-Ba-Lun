import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api } from './api.ts';

export type Role = 'admin' | 'order' | 'kitchen';

export type AuthUser = {
  sub: string;
  name: string;            // username (login name)
  full_name: string;       // họ và tên hiển thị, fallback về username
  is_owner: boolean;
  role: Role | null;       // 'admin' | 'order' | 'kitchen' | null (chưa gán)
};

/** Default landing page sau khi login theo role. */
export function defaultLandingPath(role: Role | null): string {
  if (role === 'kitchen') return '/kitchen';
  if (role === 'order') return '/orders';
  return '/orders';  // admin
}

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: AuthUser }>('/auth/me');
      if (res.status === 200 && res.data?.data) {
        setUser(res.data.data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // swallow
    }
    setUser(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthCtx.Provider value={{ user, loading, refresh, logout }}>{children}</AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be inside AuthProvider');
  return v;
}
