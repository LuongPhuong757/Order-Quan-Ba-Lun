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

            {/* Order: admin + order role */}
            <Route element={<RoleGate allow={['admin', 'order']} />}>
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

  return (
    <>
      <header className="header">
        <span className="brand">Order Quán Bà Lùn</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <NotificationBell />
          <button className="secondary" onClick={logout} style={{ padding: '6px 12px' }}>
            Đăng xuất
          </button>
        </div>
      </header>
      <Outlet />
      {role === 'admin' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders">🍽 Order</NavLink>
          <NavLink to="/kitchen">👨‍🍳 Bếp</NavLink>
          <NavLink to="/menu">📋 Menu</NavLink>
          <NavLink to="/tables">🪑 Bàn</NavLink>
          <NavLink to="/history">📜 LS</NavLink>
          <NavLink to="/admin/users">👥 NV</NavLink>
        </nav>
      )}
      {role === 'order' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders">🍽 Order</NavLink>
          <NavLink to="/account">⚙ TK</NavLink>
        </nav>
      )}
      {role === 'kitchen' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/kitchen">👨‍🍳 Bếp</NavLink>
          <NavLink to="/account">⚙ TK</NavLink>
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
  const role = (user?.role ?? (user?.is_owner ? 'admin' : null)) as Role | null;
  if (!role) return <Navigate to="/account" replace />;
  if (!allow.includes(role)) return <Navigate to={defaultLandingPath(role)} replace />;
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
