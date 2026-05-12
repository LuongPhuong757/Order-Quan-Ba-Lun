import { Routes, Route, Navigate, useLocation, NavLink, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth, defaultLandingPath, type Role } from './lib/auth-context.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { ConfirmProvider } from './components/ConfirmDialog.tsx';
import { ReLoginModal } from './components/ReLoginModal.tsx';
import { ReadyListener } from './components/ReadyListener.tsx';
import { NotificationBell } from './components/NotificationBell.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { RecoverPage } from './pages/RecoverPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { AdminUsersPage } from './pages/AdminUsersPage.tsx';
import { AdminAuditPage } from './pages/AdminAuditPage.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { OrdersPage } from './pages/OrdersPage.tsx';
import { MenuManagementPage } from './pages/MenuManagementPage.tsx';
import { KitchenPage } from './pages/KitchenPage.tsx';
import { TablesManagementPage } from './pages/TablesManagementPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
       <ConfirmProvider>
        <ReadyListener />
        <ReLoginModal />
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/recover" element={<RecoverPage />} />

          <Route element={<ProtectedShell />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/account" element={<AccountPage />} />

            {/* Order: admin + order + kitchen (bếp cần xem để biết món nào của bàn nào) */}
            <Route element={<RoleGate allow={['admin', 'order', 'kitchen']} />}>
              <Route path="/orders" element={<OrdersPage />} />
            </Route>

            {/* Bếp: admin + kitchen role */}
            <Route element={<RoleGate allow={['admin', 'kitchen']} />}>
              <Route path="/kitchen" element={<KitchenPage />} />
            </Route>

            {/* Admin-only: menu, tables, history, users, audit, dashboard */}
            <Route element={<RoleGate allow={['admin']} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/menu" element={<MenuManagementPage />} />
              <Route path="/tables" element={<TablesManagementPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/audit" element={<AdminAuditPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
       </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

// Khung màu quanh tên user thay vì text chip — gọn + dễ phân biệt khi liếc.
const ROLE_STYLE: Record<Role, { label: string; bg: string; border: string; text: string; icon: string }> = {
  admin:   { label: 'Admin', icon: '👑',    bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  order:   { label: 'Order', icon: '🍽',    bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  kitchen: { label: 'Bếp',   icon: '👨‍🍳', bg: '#d1fae5', border: '#10b981', text: '#065f46' },
};

function ProtectedShell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="container">
        <p style={{ textAlign: 'center', color: '#6b7280' }}>
          <span className="spinner" /> Đang xác thực...
        </p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to={`/login?returnUrl=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  const role = (user.role ?? (user.is_owner ? 'admin' : null)) as Role | null;
  const roleStyle = role ? ROLE_STYLE[role] : null;

  return (
    <>
      <header className="header">
        <span className="brand">
          <span className="brand-short">🍴</span>
          <span className="brand-text">Order Quán Bà Lùn</span>
          {/* Khung màu quanh tên user — màu nền + viền theo role:
              vàng = Admin, xanh dương = Order, xanh lá = Bếp */}
          <span
            className="user-chip"
            title={roleStyle ? `${roleStyle.icon} ${roleStyle.label} · ${user.full_name} (${user.name})` : user.full_name}
            style={roleStyle ? {
              background: roleStyle.bg,
              border: `2px solid ${roleStyle.border}`,
              color: roleStyle.text,
              fontWeight: 600,
            } : undefined}
          >
            {roleStyle?.icon ?? '👤'} {user.full_name || user.name}
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <NotificationBell />
          <button
            className="secondary btn-icon-only"
            onClick={logout}
            title="Đăng xuất"
            aria-label="Đăng xuất"
          >
            🚪<span className="btn-label">Đăng xuất</span>
          </button>
        </div>
      </header>
      <Outlet />
      {role === 'admin' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders" title="Order"><span className="nav-icon">🍽</span><span className="nav-label">Order</span></NavLink>
          <NavLink to="/kitchen" title="Bếp"><span className="nav-icon">👨‍🍳</span><span className="nav-label">Bếp</span></NavLink>
          <NavLink to="/menu" title="Menu"><span className="nav-icon">📋</span><span className="nav-label">Menu</span></NavLink>
          <NavLink to="/tables" title="Bàn"><span className="nav-icon">🪑</span><span className="nav-label">Bàn</span></NavLink>
          <NavLink to="/history" title="Lịch sử"><span className="nav-icon">📜</span><span className="nav-label">L/sử</span></NavLink>
          <NavLink to="/admin/users" title="Nhân viên"><span className="nav-icon">👥</span><span className="nav-label">N/viên</span></NavLink>
        </nav>
      )}
      {role === 'order' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders" title="Order"><span className="nav-icon">🍽</span><span className="nav-label">Order</span></NavLink>
          <NavLink to="/account" title="Tài khoản"><span className="nav-icon">⚙</span><span className="nav-label">T/khoản</span></NavLink>
        </nav>
      )}
      {role === 'kitchen' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/kitchen" title="Bếp"><span className="nav-icon">👨‍🍳</span><span className="nav-label">Bếp</span></NavLink>
          <NavLink to="/orders" title="Order"><span className="nav-icon">🍽</span><span className="nav-label">Order</span></NavLink>
          <NavLink to="/account" title="Tài khoản"><span className="nav-icon">⚙</span><span className="nav-label">T/khoản</span></NavLink>
        </nav>
      )}
    </>
  );
}

/** Redirect '/' về landing page tương ứng role hiện tại. */
function HomeRedirect() {
  const { user } = useAuth();
  const role = (user?.role ?? (user?.is_owner ? 'admin' : null)) as Role | null;
  return <Navigate to={defaultLandingPath(role)} replace />;
}

/** Gate cho phép vài role truy cập route. Role khác → redirect về landing của họ. */
function RoleGate({ allow }: { allow: Role[] }) {
  const { user } = useAuth();
  const loc = useLocation();
  const role = (user?.role ?? (user?.is_owner ? 'admin' : null)) as Role | null;
  if (!role) {
    // eslint-disable-next-line no-console
    console.warn('[RoleGate] No role — redirect /account', { path: loc.pathname, user });
    return <Navigate to="/account" replace />;
  }
  if (!allow.includes(role)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[RoleGate] Access DENIED: role='${role}' not in [${allow.join(',')}] for path=${loc.pathname}. Redirect → ${defaultLandingPath(role)}`,
    );
    return <Navigate to={defaultLandingPath(role)} replace />;
  }
  return <Outlet />;
}

function NotFound() {
  return (
    <div className="container">
      <div className="card" style={{ textAlign: 'center' }}>
        <h1>404</h1>
        <p style={{ color: '#6b7280' }}>Trang không tồn tại.</p>
        <NavLink to="/dashboard">← Về trang chính</NavLink>
      </div>
    </div>
  );
}
