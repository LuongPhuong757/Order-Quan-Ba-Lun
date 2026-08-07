import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, NavLink, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth, defaultLandingPath, type Role } from './lib/auth-context.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { ConfirmProvider } from './components/ConfirmDialog.tsx';
import { ReLoginModal } from './components/ReLoginModal.tsx';
import { ReadyListener } from './components/ReadyListener.tsx';
import { NotificationBell } from './components/NotificationBell.tsx';
import { useOnlineWaitingCount } from './lib/online-waiting-badge.ts';
import { useOpenTablesCount } from './lib/open-tables-badge.ts';

// ─── Tách chunk theo route (2026-08-07, ngân sách bundle) ────────────────────
// Trước đây 14 trang nằm trong MỘT file .js 1.095 KB. Nghĩa là anh bếp mở màn Bếp trên điện
// thoại phải tải kèm Dashboard, Thống kê truy cập, Nhật ký audit, Quản lý nhân viên — những
// màn role của anh còn KHÔNG CÓ QUYỀN vào. Mỗi trang một chunk thì mỗi role chỉ tải phần mình dùng.
//
// Tất cả đều lazy, kể cả trang đăng nhập: không trang nào là "trang ai cũng vào" ở đây (landing
// khác nhau theo role — xem `defaultLandingPath`), nên chừa một trang ra làm eager chỉ khiến
// 2/3 số role tải thừa. Bù lại bằng `PREFETCH_BY_ROLE` phía dưới.
//
// Các trang đều `export function` (không phải default) nên phải map `.then` sang `{ default }`.
const LoginPage = lazy(() => import('./pages/LoginPage.tsx').then((m) => ({ default: m.LoginPage })));
const SetupPage = lazy(() => import('./pages/SetupPage.tsx').then((m) => ({ default: m.SetupPage })));
const RecoverPage = lazy(() =>
  import('./pages/RecoverPage.tsx').then((m) => ({ default: m.RecoverPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.tsx').then((m) => ({ default: m.DashboardPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/AdminUsersPage.tsx').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminAuditPage = lazy(() =>
  import('./pages/AdminAuditPage.tsx').then((m) => ({ default: m.AdminAuditPage })),
);
const AdminAnalyticsPage = lazy(() =>
  import('./pages/AdminAnalyticsPage.tsx').then((m) => ({ default: m.AdminAnalyticsPage })),
);
const AccountPage = lazy(() =>
  import('./pages/AccountPage.tsx').then((m) => ({ default: m.AccountPage })),
);
const OrdersPage = lazy(() =>
  import('./pages/OrdersPage.tsx').then((m) => ({ default: m.OrdersPage })),
);
const MenuManagementPage = lazy(() =>
  import('./pages/MenuManagementPage.tsx').then((m) => ({ default: m.MenuManagementPage })),
);
const KitchenPage = lazy(() =>
  import('./pages/KitchenPage.tsx').then((m) => ({ default: m.KitchenPage })),
);
const TablesManagementPage = lazy(() =>
  import('./pages/TablesManagementPage.tsx').then((m) => ({ default: m.TablesManagementPage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage.tsx').then((m) => ({ default: m.HistoryPage })),
);
const OnlineOrdersPage = lazy(() =>
  import('./pages/OnlineOrdersPage.tsx').then((m) => ({ default: m.OnlineOrdersPage })),
);

/**
 * Những màn mỗi role bấm vào NHIỀU NHẤT trong một buổi làm — kéo sẵn về khi máy rảnh.
 *
 * Nhân viên ở quán nhảy qua lại giữa 2-3 màn này suốt buổi. Để mỗi lần bấm là một vòng request
 * thì đúng lúc đông khách lại thành "máy đang nghĩ". Nạp trước lúc rảnh thì lần bấm nào cũng
 * tức thì, mà lần tải đầu vẫn chỉ gồm chunk của màn đang mở.
 *
 * CHỈ liệt kê màn mà role đó THẬT SỰ có quyền vào (đối chiếu `RoleGate` trong `App`) — kéo sẵn
 * một màn rồi bị chặn ở cửa là tốn băng thông 4G của quán không đổi lấy gì.
 */
const PREFETCH_BY_ROLE: Record<Role, Array<() => Promise<unknown>>> = {
  admin: [
    () => import('./pages/OrdersPage.tsx'),
    () => import('./pages/OnlineOrdersPage.tsx'),
    () => import('./pages/KitchenPage.tsx'),
  ],
  order: [() => import('./pages/OrdersPage.tsx'), () => import('./pages/OnlineOrdersPage.tsx')],
  kitchen: [
    () => import('./pages/KitchenPage.tsx'),
    () => import('./pages/OnlineOrdersPage.tsx'),
    () => import('./pages/OrdersPage.tsx'),
  ],
};

/** Vỏ chờ trong lúc chunk của một trang đang về. Dùng lại đúng khung `.container`/`.spinner`
 * của màn "Đang xác thực..." để không xuất hiện một kiểu loading thứ hai trong cùng app.
 * `.spinner` global có viền trắng (dựng cho nút màu) → phải đổi sang xám, không thì trên nền
 * trắng của trang là không thấy gì cả. */
function PageFallback() {
  return (
    <div className="container" role="status">
      <p style={{ textAlign: 'center', color: '#6b7280' }}>
        <span className="spinner" style={{ borderColor: '#d1d5db', borderTopColor: 'transparent' }} />{' '}
        Đang tải...
      </p>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
       <ConfirmProvider>
        <ReadyListener />
        <ReLoginModal />
        {/* `Suspense` NGOÀI này chỉ phục vụ 3 route công khai (setup/login/recover) và 404 —
            lúc đó chưa có header/nav nên hiện vỏ chờ toàn trang là đúng.
            Route đã đăng nhập có `Suspense` RIÊNG bên trong `ProtectedShell`, bọc `<Outlet/>`,
            nên header và nav dưới đứng nguyên khi đổi màn. React lấy boundary GẦN NHẤT, nên cái
            trong luôn thắng cái ngoài — không sợ chớp cả trang. */}
        <Suspense fallback={<PageFallback />}>
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
              {/* Thống kê truy cập trang khách (2026-08-05). Admin-only và KHÔNG có trong
                  nav dưới: nav admin đã 7 mục, thêm mục thứ 8 là bóp nhỏ tất cả trên điện
                  thoại. Đường vào là thẻ ở Dashboard. */}
              <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
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
        </Suspense>
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
  // Badge số bàn đang mở trên nút "Order" — cả 3 role đều có nút này ở nav dưới. Cũng phải tính
  // TRƯỚC early-return vì cùng lý do trên.
  const openTablesCount = useOpenTablesCount(role !== null);

  /**
   * Số đơn chờ duyệt lên TIÊU ĐỀ TAB (2026-08-06): `(3) Đơn mới · …`.
   *
   * Máy ở quán gần như luôn mở nhiều tab, và tab quản trị thường nằm ở nền trong khi nhân viên
   * đang làm việc khác. Badge đỏ ở nav dưới chỉ thấy được khi đã nhìn vào tab này, còn chuông thì
   * trình duyệt hay chặn cho tới khi có thao tác đầu tiên — tiêu đề tab là kênh duy nhất còn lại
   * khi tab bị che, và nó không tốn thêm request nào (dùng lại đúng con số của badge).
   *
   * Phải nằm ở đây (`ProtectedShell`) chứ không phải trong màn Đơn hàng online: đứng ở trang nào
   * cũng phải thấy, kể cả khi nhân viên đang ở màn Bếp.
   */
  useEffect(() => {
    // Giữ ĐÚNG chuỗi trong `apps/web/index.html` — hai chỗ lệch nhau thì tiêu đề tab đổi một cái
    // khi app mount xong, và người dùng thấy tab "nhảy chữ" mà không hiểu vì sao.
    const base = 'Admin · Quán Bà Lùn';
    document.title = waitingCount && waitingCount > 0 ? `(${waitingCount}) Đơn mới · ${base}` : base;
    // Trả tiêu đề về nguyên trạng khi rời khu vực đã đăng nhập (đăng xuất) — để lại "(3) Đơn mới"
    // trên màn hình đăng nhập là nói về dữ liệu người vừa đăng xuất không còn quyền xem.
    return () => {
      document.title = base;
    };
  }, [waitingCount]);

  /**
   * Nạp trước chunk của những màn role này dùng nhiều nhất (xem `PREFETCH_BY_ROLE`).
   *
   * Chạy khi máy rảnh nên KHÔNG giành băng thông với dữ liệu của màn đang mở. Bọc trong
   * `requestIdleCallback` (Safari iOS chưa có → fallback `setTimeout`), và huỷ ở cleanup để
   * lúc đăng xuất ngay sau khi vào thì không còn kéo tiếp chunk của role vừa rời.
   *
   * `.catch` im lặng có chủ ý: đây chỉ là nạp trước. Mất mạng giữa đường thì không được phép
   * nổi lên một toast lỗi nào cả — lát nữa `React.lazy` mới là lần tải thật, và nó tự báo.
   */
  useEffect(() => {
    if (!role) return;
    const run = () => PREFETCH_BY_ROLE[role].forEach((load) => void load().catch(() => {}));
    // `typeof window.requestIdleCallback` chứ KHÔNG dùng `'requestIdleCallback' in window`: lib.dom
    // khai hàm này là luôn có, nên `in` làm TS thu hẹp nhánh dưới thành `never` rồi báo
    // "Property 'setTimeout' does not exist on type 'never'". Kiểm typeof chỉ thu hẹp thuộc tính đó.
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 2000);
    return () => window.clearTimeout(id);
  }, [role]);

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
          {/* "QUẢN TRỊ" phải có mặt ngay trong header: nhân viên mở cả trang khách lẫn trang
              này trên cùng máy, và hai bên trước đây đều chỉ ghi tên quán. */}
          <span className="brand-text">Quán Bà Lùn · QUẢN TRỊ</span>
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
      {/* Bọc quanh `<Outlet/>` chứ không quanh cả `<>...</>`: đổi màn thì header và nav dưới
          PHẢI đứng yên. Bọc ra ngoài là mất luôn thanh nav mỗi lần bấm, nhân viên mất điểm tựa. */}
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
      {role === 'admin' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders" title="Order"><span className="nav-icon">🍽</span><span className="nav-label">Order</span><NavBadge count={openTablesCount} label="bàn đang mở" tone="info" /></NavLink>
          {/* Nhãn "Online" chứ không phải "H/chờ": trang nay gồm cả hàng chờ và cài đặt nhận đơn,
              và "Online" phân biệt rõ với "Order" (đơn tại quán) ngay cạnh nó. */}
          <NavLink to="/admin/online-orders" title="Đơn hàng online — hàng chờ duyệt + cài đặt nhận đơn"><span className="nav-icon">🛎</span><span className="nav-label">Online</span><NavBadge count={waitingCount} label="đơn online đang chờ duyệt" /></NavLink>
          <NavLink to="/kitchen" title="Bếp"><span className="nav-icon">👨‍🍳</span><span className="nav-label">Bếp</span></NavLink>
          <NavLink to="/menu" title="Menu"><span className="nav-icon">📋</span><span className="nav-label">Menu</span></NavLink>
          <NavLink to="/tables" title="Bàn"><span className="nav-icon">🪑</span><span className="nav-label">Bàn</span></NavLink>
          <NavLink to="/history" title="Lịch sử"><span className="nav-icon">📜</span><span className="nav-label">L/sử</span></NavLink>
          <NavLink to="/admin/users" title="Nhân viên"><span className="nav-icon">👥</span><span className="nav-label">N/viên</span></NavLink>
        </nav>
      )}
      {role === 'order' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/orders" title="Order"><span className="nav-icon">🍽</span><span className="nav-label">Order</span><NavBadge count={openTablesCount} label="bàn đang mở" tone="info" /></NavLink>
          {/* Hàng chờ duyệt — D-02 cho cả 3 role duyệt được, nên nav cũng phải có ở cả 3.
              Role này KHÔNG thấy tab Cài đặt nên title chỉ nói về hàng chờ. */}
          <NavLink to="/admin/online-orders" title="Đơn hàng online — hàng chờ duyệt"><span className="nav-icon">🛎</span><span className="nav-label">Online</span><NavBadge count={waitingCount} label="đơn online đang chờ duyệt" /></NavLink>
          {/* Nhật ký bàn 48h gần nhất — KHÔNG có doanh thu (BE chặn /orders/stats) */}
          <NavLink to="/history" title="Nhật ký bàn (48h)"><span className="nav-icon">📜</span><span className="nav-label">N/ký</span></NavLink>
          <NavLink to="/account" title="Tài khoản"><span className="nav-icon">👤</span><span className="nav-label">T/khoản</span></NavLink>
        </nav>
      )}
      {role === 'kitchen' && (
        <nav className="nav-bottom" aria-label="Điều hướng chính">
          <NavLink to="/kitchen" title="Bếp"><span className="nav-icon">👨‍🍳</span><span className="nav-label">Bếp</span></NavLink>
          <NavLink to="/admin/online-orders" title="Đơn hàng online — hàng chờ duyệt"><span className="nav-icon">🛎</span><span className="nav-label">Online</span><NavBadge count={waitingCount} label="đơn online đang chờ duyệt" /></NavLink>
          <NavLink to="/orders" title="Order"><span className="nav-icon">🍽</span><span className="nav-label">Order</span><NavBadge count={openTablesCount} label="bàn đang mở" tone="info" /></NavLink>
          <NavLink to="/menu" title="Menu"><span className="nav-icon">📋</span><span className="nav-label">Menu</span></NavLink>
          {/* Nhật ký bàn 48h — giống nhân viên order, KHÔNG có tổng doanh thu */}
          <NavLink to="/history" title="Nhật ký bàn (48h)"><span className="nav-icon">📜</span><span className="nav-label">N/ký</span></NavLink>
          <NavLink to="/account" title="Tài khoản"><span className="nav-icon">👤</span><span className="nav-label">T/khoản</span></NavLink>
        </nav>
      )}
    </>
  );
}

/** Hình tròn đếm, neo ở góc trên-PHẢI của một ô trong nav dưới. `count` null/0 → không vẽ gì
 * (thà không có số còn hơn hiện số sai).
 *
 * Màu phân biệt VIỆC PHẢI LÀM với THÔNG TIN: đỏ = đơn online đang chờ duyệt (khách đang đợi,
 * phải bấm), xanh = số bàn đang mở (chỉ để biết, không ai phải làm gì). Hai badge nằm cạnh nhau
 * trên cùng thanh nav nên cùng màu đỏ là nhân viên liếc qua tưởng cả hai đều cần xử lý.
 *
 * Style INLINE + `position:absolute` có chủ đích: badge tuyệt đối không được chiếm chỗ trong
 * flex column của nav item (icon/label) — bản đầu để class chờ CSS, lúc CSS chưa nạp con số
 * rơi xuống thành dòng thứ 3 làm vỡ cả thanh nav. Neo `position:relative` nằm ở `.nav-bottom a`. */
function NavBadge({
  count,
  label,
  tone = 'alert',
}: {
  count: number | null;
  /** Đọc cho screen reader, dạng "3 <label>". */
  label: string;
  tone?: 'alert' | 'info';
}) {
  if (count === null || count <= 0) return null;
  return (
    <span
      aria-label={`${count} ${label}`}
      style={{
        position: 'absolute',
        top: 2,
        left: 'calc(50% + 6px)',
        background: tone === 'alert' ? '#dc2626' : '#2563eb',
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
