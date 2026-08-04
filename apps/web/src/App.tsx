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
import { OnlineOrdersPage } from './pages/OnlineOrdersPage.tsx';
import { useOnlineWaitingCount } from './lib/online-waiting-badge.ts';

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

            {/* Đơn hàng online: admin + order + kitchen — D-02 ghi đè M2.D-33, ai đang ở máy thì
                duyệt. Kiểm soát bù trừ là audit log ghi rõ người duyệt.
                ⚠ PHẢI nằm ngoài block RoleGate allow={['admin']} bên dưới — nhét vào đó là
                chặn lại role order/kitchen, đúng cái D-02 vừa bỏ.
                Tab "Cài đặt" bên trong trang này CHỈ admin thấy — gate ở `OnlineOrdersPage`,
                không gate ở đây, vì hàng chờ và cài đặt nay dùng chung 1 route. */}
            <Route element={<RoleGate allow={['admin', 'order', 'kitchen']} />}>
              <Route path="/admin/online-orders" element={<OnlineOrdersPage />} />
            </Route>

            {/* Bếp: admin + kitchen role */}
            <Route element={<RoleGate allow={['admin', 'kitchen']} />}>
              <Route path="/kitchen" element={<KitchenPage />} />
              {/* Menu: bếp quản lý tình trạng hết/còn (nút sửa/xoá/tạo gate theo is_owner) */}
              <Route path="/menu" element={<MenuManagementPage />} />
            </Route>

            {/* Nhật ký bàn: admin (đầy đủ) + order + bếp (48h gần nhất).
                Order và bếp thấy giá món / tổng bill / thông tin thanh toán như nhau;
                chỉ TỔNG DOANH THU nhiều bàn là riêng admin (/orders/stats có AdminGuard).
                Giới hạn thực thi ở BE — xem staffHistoryWindowMs ở orders.controller. */}
            <Route element={<RoleGate allow={['admin', 'order', 'kitchen']} />}>
              <Route path="/history" element={<HistoryPage />} />
            </Route>

            {/* Admin-only: tables, users, audit, dashboard */}
            <Route element={<RoleGate allow={['admin']} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/tables" element={<TablesManagementPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/audit" element={<AdminAuditPage />} />
              {/* `/admin/settings` cũ đã gộp thành tab của màn Đơn hàng online (2026-08-03).
                  Giữ redirect vì bookmark, link trong Dashboard và ảnh chụp màn hình trong
                  `08-UAT.md`/`09-UAT.md` đều đang trỏ vào URL này. */}
              <Route
                path="/admin/settings"
                element={<Navigate to="/admin/online-orders?view=settings" replace />}
              />
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
  // Role tính TRƯỚC các early-return vì hook đếm đơn chờ phải chạy ở mọi lần render.
  const role = (user?.role ?? (user?.is_owner ? 'admin' : null)) as Role | null;
  // Badge số đơn online đang chờ trên nút "Online" — cả 3 role đều duyệt được (D-02) nên có
  // role là bật. SSE + đếm sống ở shell để đứng ở TRANG NÀO badge cũng nhảy realtime.
  const waitingCount = useOnlineWaitingCount(role !== null);
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
            style={{ color: '#dc2626' }}
          >
            {/* Lucide log-out: arrow pointing out of door — clear semantic, không phụ thuộc OS emoji */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="btn-label">Đăng xuất</span>
          </button>
        </div>
      </header>
      <Outlet />
      {role === 'admin' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders" title="Order"><span className="nav-icon">🍽</span><span className="nav-label">Order</span></NavLink>
          {/* Nhãn "Online" chứ không phải "H/chờ": trang nay gồm cả hàng chờ và cài đặt nhận đơn,
              và "Online" phân biệt rõ với "Order" (đơn tại quán) ngay cạnh nó. */}
          <NavLink to="/admin/online-orders" title="Đơn hàng online — hàng chờ duyệt + cài đặt nhận đơn"><span className="nav-icon">🛎</span><span className="nav-label">Online</span><NavBadge count={waitingCount} /></NavLink>
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
          {/* Hàng chờ duyệt — D-02 cho cả 3 role duyệt được, nên nav cũng phải có ở cả 3.
              Role này KHÔNG thấy tab Cài đặt nên title chỉ nói về hàng chờ. */}
          <NavLink to="/admin/online-orders" title="Đơn hàng online — hàng chờ duyệt"><span className="nav-icon">🛎</span><span className="nav-label">Online</span><NavBadge count={waitingCount} /></NavLink>
          {/* Nhật ký bàn 48h gần nhất — KHÔNG có doanh thu (BE chặn /orders/stats) */}
          <NavLink to="/history" title="Nhật ký bàn (48h)"><span className="nav-icon">📜</span><span className="nav-label">N/ký</span></NavLink>
          <NavLink to="/account" title="Tài khoản"><span className="nav-icon">👤</span><span className="nav-label">T/khoản</span></NavLink>
        </nav>
      )}
      {role === 'kitchen' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/kitchen" title="Bếp"><span className="nav-icon">👨‍🍳</span><span className="nav-label">Bếp</span></NavLink>
          <NavLink to="/admin/online-orders" title="Đơn hàng online — hàng chờ duyệt"><span className="nav-icon">🛎</span><span className="nav-label">Online</span><NavBadge count={waitingCount} /></NavLink>
          <NavLink to="/orders" title="Order"><span className="nav-icon">🍽</span><span className="nav-label">Order</span></NavLink>
          <NavLink to="/menu" title="Menu"><span className="nav-icon">📋</span><span className="nav-label">Menu</span></NavLink>
          {/* Nhật ký bàn 48h — giống nhân viên order, KHÔNG có tổng doanh thu */}
          <NavLink to="/history" title="Nhật ký bàn (48h)"><span className="nav-icon">📜</span><span className="nav-label">N/ký</span></NavLink>
          <NavLink to="/account" title="Tài khoản"><span className="nav-icon">👤</span><span className="nav-label">T/khoản</span></NavLink>
        </nav>
      )}
    </>
  );
}

/** Hình tròn đỏ đếm đơn online đang chờ duyệt, neo ở góc trên-PHẢI của ô "Online" trong nav
 * dưới. `count` null/0 → không vẽ gì (thà không có số còn hơn hiện số sai).
 *
 * Style INLINE + `position:absolute` có chủ đích: badge tuyệt đối không được chiếm chỗ trong
 * flex column của nav item (icon/label) — bản đầu để class chờ CSS, lúc CSS chưa nạp con số
 * rơi xuống thành dòng thứ 3 làm vỡ cả thanh nav. Neo `position:relative` nằm ở `.nav-bottom a`. */
function NavBadge({ count }: { count: number | null }) {
  if (count === null || count <= 0) return null;
  return (
    <span
      aria-label={`${count} đơn online đang chờ duyệt`}
      style={{
        position: 'absolute',
        top: 2,
        left: 'calc(50% + 6px)',
        background: '#dc2626',
        color: 'white',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        minWidth: 16,
        height: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 4px',
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
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
