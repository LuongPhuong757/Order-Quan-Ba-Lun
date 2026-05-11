import { Routes, Route, Navigate, useLocation, NavLink, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth-context.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { ReLoginModal } from './components/ReLoginModal.tsx';
import { ReadyListener } from './components/ReadyListener.tsx';
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

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ReadyListener />
        <ReLoginModal />
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/recover" element={<RecoverPage />} />

          <Route element={<ProtectedShell />}>
            <Route path="/" element={<Navigate to="/orders" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/menu" element={<MenuManagementPage />} />
            <Route path="/kitchen" element={<KitchenPage />} />
            <Route element={<OwnerOnly />}>
              <Route path="/tables" element={<TablesManagementPage />} />
            </Route>
            <Route element={<OwnerOnly />}>
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/audit" element={<AdminAuditPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
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
  return (
    <>
      <header className="header">
        <span className="brand">Order Quán Bà Lùn</span>
        <button className="secondary" onClick={logout} style={{ padding: '6px 12px' }}>
          Đăng xuất
        </button>
      </header>
      <Outlet />
      {user.is_owner && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders">🍽 Order</NavLink>
          <NavLink to="/kitchen">👨‍🍳 Bếp</NavLink>
          <NavLink to="/menu">📋 Menu</NavLink>
          <NavLink to="/tables">🪑 Bàn</NavLink>
          <NavLink to="/admin/users">👥 NV</NavLink>
        </nav>
      )}
      {!user.is_owner && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders">🍽 Order</NavLink>
          <NavLink to="/kitchen">👨‍🍳 Bếp</NavLink>
          <NavLink to="/menu">📋 Menu</NavLink>
          <NavLink to="/account">⚙ Tài khoản</NavLink>
        </nav>
      )}
    </>
  );
}

function OwnerOnly() {
  const { user } = useAuth();
  if (!user?.is_owner) return <Navigate to="/dashboard" replace />;
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
