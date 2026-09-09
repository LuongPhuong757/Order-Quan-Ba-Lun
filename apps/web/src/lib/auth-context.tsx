import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api } from './api.ts';
import { notificationStore } from './notification-store.ts';

export type Role = 'admin' | 'order' | 'kitchen' | 'report';

export type AuthUser = {
  sub: string;
  name: string;            // username (login name)
  full_name: string;       // họ và tên hiển thị, fallback về username
  is_owner: boolean;
  role: Role | null;       // 'admin' | 'order' | 'kitchen' | 'report' | null (chưa gán)
};

/** Default landing page sau khi login theo role. */
export function defaultLandingPath(role: Role | null): string {
  if (role === 'kitchen') return '/kitchen';
  if (role === 'order') return '/orders';
  // Báo cáo: KHÔNG phải `/orders` — role này không order được, mở ra màn order là mở ra một
  // màn toàn nút bấm bấm vào là 403. Dashboard là nơi liệt kê đường vào từng báo cáo.
  if (role === 'report') return '/dashboard';
  return '/orders';  // admin
}

/** `false` = tài khoản CHỈ ĐỌC (role Báo cáo) → ẩn mọi nút tạo/sửa/xoá/thanh toán.
 *
 * Chỉ để màn hình đỡ bày ra thứ bấm vào là lỗi — KHÔNG phải hàng rào bảo mật. Hàng rào thật
 * nằm ở BE (`read-only-role.ts`): role đó gửi POST/PUT/PATCH/DELETE nào cũng ăn 403. Nên quên
 * ẩn một nút thì hậu quả là một thông báo lỗi xấu, không phải dữ liệu bị sửa. */
export function useCanWrite(): boolean {
  const { user } = useAuth();
  return user?.role !== 'report';
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
        // Xoá noti của user cũ nếu đổi tài khoản (chạy TRƯỚC setUser → trước khi
        // ReadyListener kịp backfill cho user mới).
        notificationStore.ensureOwner(res.data.data.sub);
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
