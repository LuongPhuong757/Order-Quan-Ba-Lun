import { Suspense, lazy, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, NavLink, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth, defaultLandingPath, type Role } from './lib/auth-context.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { ConfirmProvider } from './components/ConfirmDialog.tsx';
import { ReLoginModal } from './components/ReLoginModal.tsx';
import { ReadyListener } from './components/ReadyListener.tsx';
import { NotificationBell } from './components/NotificationBell.tsx';
import { useOnlineWaitingCount } from './lib/online-waiting-badge.ts';
import { usePendingDeliveriesCount } from './lib/pending-deliveries-badge.ts';
import { useOpenTablesCount } from './lib/open-tables-badge.ts';
import { useKitchenPendingCount } from './lib/kitchen-pending-badge.ts';
import { useStaleUnpaid } from './lib/stale-unpaid.ts';
import { StaleTableBanner } from './components/StaleTableBanner.tsx';
import { useGuestPending } from './lib/guest-pending.ts';
import { GuestQrBanner } from './components/GuestQrBanner.tsx';
import { PhoneAlertBar } from './components/PhoneAlertBar.tsx';
import { useIsPhone } from './components/ui/use-is-phone.ts';
import { AppHeader, AvatarMenu, BottomNav, Sidebar } from './components/AppNav.tsx';
import { Icon, type IconName } from './components/ui/Icon.tsx';

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
const PrintBridgePage = lazy(() =>
  import('./pages/PrintBridgePage.tsx').then((m) => ({ default: m.PrintBridgePage })),
);
const SetupPage = lazy(() => import('./pages/SetupPage.tsx').then((m) => ({ default: m.SetupPage })));
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage.tsx').then((m) => ({ default: m.DashboardPage })),
);
const AdminUsersPage = lazy(() =>
  import('./pages/AdminUsersPage.tsx').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminAuditPage = lazy(() =>
  import('./pages/AdminAuditPage.tsx').then((m) => ({ default: m.AdminAuditPage })),
);
// Trang mẫu giao diện (Đợt 0 đồng bộ giao diện, 2026-11-09): bấm thử component chung trước khi
// áp vào màn thật. Chỉ admin; tách chunk riêng nên không làm nặng màn nào khác.
const UiSamplePage = lazy(() =>
  import('./pages/UiSamplePage.tsx').then((m) => ({ default: m.UiSamplePage })),
);
const BankLedgerPage = lazy(() =>
  import('./pages/BankLedgerPage.tsx').then((m) => ({ default: m.BankLedgerPage })),
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
const CustomReceiptPage = lazy(() =>
  import('./pages/CustomReceiptPage.tsx').then((m) => ({ default: m.CustomReceiptPage })),
);
const CustomReceiptHistoryPage = lazy(() =>
  import('./pages/CustomReceiptHistoryPage.tsx').then((m) => ({ default: m.CustomReceiptHistoryPage })),
);
const OnlineOrdersPage = lazy(() =>
  import('./pages/OnlineOrdersPage.tsx').then((m) => ({ default: m.OnlineOrdersPage })),
);
const SuppliersPage = lazy(() =>
  import('./pages/SuppliersPage.tsx').then((m) => ({ default: m.SuppliersPage })),
);
const NccPortalPage = lazy(() =>
  import('./pages/NccPortalPage.tsx').then((m) => ({ default: m.NccPortalPage })),
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
  // Bếp: KHÔNG kéo sẵn Đơn online nữa (2026-09-15). Chunk đó 62 KB, gấp 3 lần chính màn Bếp, và
  // trên 4G nó chiếm đường truyền ~1 giây đúng lúc màn Bếp đang tải dữ liệu lần đầu. Bếp vẫn
  // vào được Đơn online, chỉ là lần bấm đầu tiên mới tải — việc đó vài lần một ca, không đáng
  // đổi lấy màn chính chậm ở mọi lần mở app.
  kitchen: [() => import('./pages/KitchenPage.tsx'), () => import('./pages/OrdersPage.tsx')],
  // Máy in: KHÔNG kéo sẵn gì. Nó chỉ mở đúng một màn (`/print-bridge`, nằm ngoài
  // `ProtectedShell`) và bị BE chặn ở mọi đường khác — kéo trước màn nào cũng là tải một chunk
  // để rồi ăn 403 ở cửa.
  print: [],
  // Báo cáo: 3 màn duy nhất role này vào được ngoài Dashboard (màn đầu tiên, đã tải sẵn) và
  // Tài khoản. KHÔNG kéo OrdersPage/KitchenPage — role này bị chặn ở cửa hai màn đó.
  report: [
    () => import('./pages/HistoryPage.tsx'),
    () => import('./pages/SuppliersPage.tsx'),
    () => import('./pages/AdminAnalyticsPage.tsx'),
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
        {/* `Suspense` NGOÀI này chỉ phục vụ 2 route công khai (setup/login) và 404 —
            lúc đó chưa có header/nav nên hiện vỏ chờ toàn trang là đúng.
            Route đã đăng nhập có `Suspense` RIÊNG bên trong `ProtectedShell`, bọc `<Outlet/>`,
            nên header và nav dưới đứng nguyên khi đổi màn. React lấy boundary GẦN NHẤT, nên cái
            trong luôn thắng cái ngoài — không sợ chớp cả trang. */}
        <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          {/* `/recover` (mã khôi phục) đã BỎ 2026-11-09 — link cũ rơi vào trang 404 bên dưới. */}
          {/* Cổng nhà cung cấp (2026-09-05, bước 4). NGOÀI `ProtectedShell` một cách cố ý: NCC
              không phải nhân viên, không có role, và tự xác thực bằng phiên riêng
              (`x-supplier-token`). Nhét vào trong đó là bắt họ đăng nhập bằng tài khoản nội bộ. */}
          <Route path="/ncc" element={<NccPortalPage />} />

          {/* Cầu in cho máy POS Android nối máy in bằng USB (2026-09-19). NGOÀI `ProtectedShell`
              vì cùng lý do với `/ncc`: đây là một CHIẾC MÁY đặt ở quầy chạy suốt ngày, không
              phải một con người. Nó tự xác thực bằng token thiết bị (`x-print-token`). Bắt nó
              đăng nhập bằng tài khoản nhân viên nghĩa là tài khoản đó mở vĩnh viễn trên một máy
              ai cũng chạm được, và mọi thao tác của máy mang tên người ấy trong nhật ký. */}
          <Route path="/print-bridge" element={<PrintBridgePage />} />

          <Route element={<ProtectedShell />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/account" element={<AccountPage />} />

            {/* Order: admin + order + kitchen (bếp cần xem để biết món nào của bàn nào) */}
            <Route element={<RoleGate allow={['admin', 'order', 'kitchen']} />}>
              <Route path="/orders" element={<OrdersPage />} />
            </Route>

            {/* Hoá đơn tự do (M6): admin + order + kitchen — chủ quán chốt "ai cũng in được".
                `report` KHÔNG: tài khoản đó chỉ để xem số, không đứng quầy.
                Màn này không tạo đơn, không đụng doanh thu — xem docs/MILESTONE-06. */}
            <Route element={<RoleGate allow={['admin', 'order', 'kitchen']} />}>
              <Route path="/custom-receipt" element={<CustomReceiptPage />} />
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
                Order và bếp KHÔNG thấy con số tiền nào — chỉ món, số phần, ai làm gì lúc nào
                (chủ quán chốt 2026-10-20, mở lại sau đợt "bảo trì" 2026-10-18). Xem
                `canSeeMoney` ở HistoryPage. Giới hạn 48h thực thi ở BE — xem
                staffHistoryWindowMs ở orders.controller. */}
            <Route element={<RoleGate allow={['admin', 'order', 'kitchen', 'report']} />}>
              <Route path="/history" element={<HistoryPage />} />
            </Route>

            {/* Quyền Báo cáo (2026-09-09): CHỈ ĐỌC số liệu toàn quán. Dùng lại đúng 3 màn admin
                thay vì dựng màn riêng — số liệu và cách lọc y hệt, tách ra là hai bản phải sửa
                song song mãi mãi. Nút thao tác trong các màn đó bị ẩn theo `canWrite`.
                Gate ở đây CHỈ giấu đường đi; hàng rào thật là `read-only-role.ts` ở BE — role
                này gửi POST/PUT/PATCH/DELETE nào cũng ăn 403, gõ thẳng URL cũng vậy. */}
            <Route element={<RoleGate allow={['admin', 'report']} />}>
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              {/* Thống kê truy cập trang khách (2026-08-05). KHÔNG có trong nav dưới: nav admin
                  đã 7 mục, thêm mục thứ 8 là bóp nhỏ tất cả trên điện thoại. Đường vào là thẻ ở
                  Dashboard. */}
              <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
            </Route>

            {/* Admin-only: bàn, nhân viên, nhật ký hệ thống, cài đặt nhận đơn.

                Nhà cung cấp / dashboard / analytics đã chuyển lên block Báo cáo bên trên
                (2026-09-09) — chúng là màn ĐỌC số liệu, `report` xem được, nhưng nút thao tác
                bên trong vẫn admin-only.
                Còn lại ở đây là những màn mà bản thân việc XEM cũng chỉ admin: nhật ký hệ thống
                (ai làm gì), danh sách nhân viên, và các màn quản trị có thao tác là chính. */}
            {/* Sổ giao dịch ngân hàng (2026-09-23) — CHỈ admin, và KHÔNG có trong nav dưới: nav
                đã 8 mục, thêm mục thứ 9 là bóp nhỏ tất cả trên điện thoại (cùng lý do đã để
                Thống kê truy cập ngoài nav). Đường vào là nút ở khối "Ngân hàng đã báo về" của
                màn Lịch sử — đúng chỗ người ta đang đứng khi thấy một con số đáng ngờ. */}
            <Route element={<RoleGate allow={['admin']} />}>
              <Route path="/admin/bank-ledger" element={<BankLedgerPage />} />
            </Route>

            <Route element={<RoleGate allow={['admin']} />}>
              {/* Phiếu đã in (2026-11-10): màn riêng có URL để tải lại / Back về đúng chỗ. Chỉ admin —
                  API danh sách + ảnh có AdminGuard. */}
              <Route path="/custom-receipt/history" element={<CustomReceiptHistoryPage />} />
              <Route path="/tables" element={<TablesManagementPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/audit" element={<AdminAuditPage />} />
              <Route path="/mau-giao-dien" element={<UiSamplePage />} />
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
const ROLE_STYLE: Record<Role, { label: string; bg: string; border: string; text: string; icon: IconName }> = {
  admin:   { label: 'Admin', icon: 'quan-tri',    bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  order:   { label: 'Order', icon: 'order',    bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  kitchen: { label: 'Bếp',   icon: 'bep', bg: '#d1fae5', border: '#10b981', text: '#065f46' },
  report:  { label: 'Báo cáo', icon: 'bao-cao', bg: '#ede9fe', border: '#8b5cf6', text: '#5b21b6' },
  print:   { label: 'Máy in', icon: 'in',  bg: '#e5e7eb', border: '#6b7280', text: '#374151' },
};

function ProtectedShell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  // Role tính TRƯỚC các early-return vì hook đếm đơn chờ phải chạy ở mọi lần render.
  const role = (user?.role ?? (user?.is_owner ? 'admin' : null)) as Role | null;
  // Badge số đơn online đang chờ trên nút "Online" — cả 3 role đều duyệt được (D-02) nên có
  // role là bật. SSE + đếm sống ở shell để đứng ở TRANG NÀO badge cũng nhảy realtime.
  // `report` không có nút Online (BE cũng chặn) → không bật, tránh 403 lặp mỗi nhịp đếm.
  const waitingCount = useOnlineWaitingCount(role !== null && role !== 'report');
  // Badge số bàn đang mở trên nút "Order" — cả 3 role đều có nút này ở nav dưới. Cũng phải tính
  // TRƯỚC early-return vì cùng lý do trên.
  const openTablesCount = useOpenTablesCount(role !== null && role !== 'report');
  // Phiếu nhập chờ duyệt (2026-10-23) — chỉ admin duyệt được nên chỉ admin đếm.
  const pendingDeliveriesCount = usePendingDeliveriesCount(role === 'admin');
  // Badge số món đang chờ bếp làm trên nút "Bếp" — chỉ admin và role kitchen có nút này ở nav
  // dưới, role `order` không có nên không bật (bật thừa = mỗi máy order thêm 1 request/5s cho một
  // con số không ai nhìn thấy).
  const kitchenPendingCount = useKitchenPendingCount(role === 'admin' || role === 'kitchen');
  // Dải "bàn ngồi quá lâu chưa thanh toán" (2026-10-12) — CHỈ ở màn Order và Bếp (chủ quán sửa:
  // hiện ở mọi màn là quá nhiều). Poll cũng chỉ chạy khi đứng ở hai màn này. Hai màn đó chỉ
  // admin/order/kitchen vào được (RoleGate) nên không cần gác role riêng.
  const onStaleBannerScreen = loc.pathname === '/orders' || loc.pathname === '/kitchen';
  const isPhone = useIsPhone();
  const staleUnpaid = useStaleUnpaid(role !== null && onStaleBannerScreen);
  // Dải "khách gọi QR" (2026-10-19) — cùng hai màn với dải trên. Màn Order tự poll; màn Bếp thì
  // KitchenPage đã kéo cùng endpoint trong nhịp 2 giây của nó và publish vào store, nên ở đó hook
  // chỉ đọc (`poll=false`) — không gọi trùng.
  const guestPending = useGuestPending(role !== null && loc.pathname === '/orders');

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
    // TUẦN TỰ từng chunk, không bắn cả loạt: ba chunk cùng lúc trên 4G giành băng thông với
    // chính dữ liệu của màn đang mở (đo 2026-09-14: lúc màn Bếp mở, các chunk kéo sẵn chiếm
    // ~1 giây đường truyền). Một chunk hỏng thì bỏ qua và kéo tiếp chunk sau.
    const run = () => {
      void PREFETCH_BY_ROLE[role].reduce<Promise<unknown>>(
        (chain, load) => chain.then(() => load().catch(() => {})),
        Promise.resolve(),
      );
    };
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

  /* Thanh nav dưới CUỘN NGANG trên điện thoại (xem `.nav-bottom` trong styles.css): số mục sẽ
     còn tăng, chia đều chỗ mãi thì tới lúc mỗi mục chỉ còn cái emoji không đọc được. Đánh đổi
     của việc cuộn là mục đang mở có thể nằm ngoài tầm nhìn — admin đang ở "N/viên" (mục thứ 7)
     mà thanh nav chỉ hiện tới mục thứ 5 thì không còn điểm tựa "mình đang ở đâu".
     Nên mỗi lần đổi route thì kéo mục đang sáng vào giữa. `inline: 'center'` chứ không phải
     'nearest': mục ở giữa cho thấy luôn cả mục trước và mục sau, tức là thấy được rằng thanh
     này còn trượt được. `block: 'nearest'` để không làm cuộn dọc cả trang. */
  useEffect(() => {
    const active = document.querySelector<HTMLElement>('.nav-bottom a[aria-current="page"]');
    if (!active) return;
    const bar = active.parentElement;
    // Chỉ cuộn khi thanh thật sự tràn — trang vừa đủ mục thì gọi cũng vô hại nhưng thừa.
    if (!bar || bar.scrollWidth <= bar.clientWidth) return;
    active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [loc.pathname, role]);

  /* Chiều cao header → biến CSS `--header-h`, để các dải cảnh báo (dính NGAY DƯỚI header từ
     2026-11-09) biết phải đứng ở đâu. Đo bằng ResizeObserver chứ không ghi cứng: header cao khác
     nhau theo bề rộng màn và theo dải đỏ môi trường dev. Màn Bếp không có header → bỏ biến. */
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = headerRef.current;
    // Màn Bếp không có header; lúc đang xác thực / chưa đăng nhập header cũng chưa dựng.
    if (loc.pathname === '/kitchen' || !el) {
      root.style.removeProperty('--header-h');
      return;
    }
    const sync = () => root.style.setProperty('--header-h', `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--header-h');
    };
  }, [loc.pathname, loading, user]);

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
  const navBadges = {
    openTables: openTablesCount,
    kitchenPending: kitchenPendingCount,
    onlineWaiting: waitingCount,
    pendingDeliveries: pendingDeliveriesCount,
  };
  /* Màn Bếp (`/kitchen`) chạy FULL-SCREEN: nó tự dựng đúng một thanh nút ở đáy (← quay về
     Order, lọc nhóm, làm mới, hướng dẫn, thông báo, đăng xuất) nên header + nav dưới ở đây
     chỉ ăn chỗ của danh sách món. Bếp đứng cách iPad cả mét, mỗi ~60px lấy lại được là thêm
     một món nhìn thấy — mà bỏ lỡ món mới là việc tốn kém nhất ở màn này.
     CHỈ áp cho `/kitchen`: mọi màn khác giữ nguyên header + nav. Rời màn bếp là cả hai
     hiện lại, nên nút ← không phải đường ra một chiều. */
  const isKds = loc.pathname === '/kitchen';


  return (
    <>
      {!isKds && role && role !== 'print' && user && (
        /* Header mới (chủ quán 2026-11-10): TÊN TRANG ở giữa, avatar (màn gốc) hoặc ← (màn con)
           bên trái, chuông bên phải. Đăng xuất nằm trong menu avatar — xem components/AppNav.tsx. */
        <AppHeader
          role={role}
          headerRef={headerRef}
          avatar={
            <AvatarMenu
              fullName={user.full_name || user.name}
              roleLabel={roleStyle?.label ?? ''}
              onLogout={logout}
            />
          }
          right={<NotificationBell />}
        />
      )}
      {/* Dải cảnh báo nằm DƯỚI header (chủ quán 2026-11-09). */}
      {/* ĐIỆN THOẠI: một dòng gộp, bấm mở danh sách (2026-11-09 — hai dải dính cũ cộng header +
          nav dưới chiếm ~25% màn). iPad / máy tính: giữ hai dải như cũ. */}
      {onStaleBannerScreen && isPhone && (
        <PhoneAlertBar guestPending={guestPending} stale={staleUnpaid} canApprove={loc.pathname === '/orders'} />
      )}
      {/* QR TRƯỚC dải đỏ: khách đang đứng chờ là việc phải làm NGAY. Chỉ màn Order duyệt được. */}
      {onStaleBannerScreen && !isPhone && (
        <GuestQrBanner data={guestPending} canApprove={loc.pathname === '/orders'} />
      )}
      {onStaleBannerScreen && !isPhone && <StaleTableBanner data={staleUnpaid} />}
      {/* Bọc quanh `<Outlet/>` chứ không quanh cả `<>...</>`: đổi màn thì header và nav dưới
          PHẢI đứng yên. Bọc ra ngoài là mất luôn thanh nav mỗi lần bấm, nhân viên mất điểm tựa. */}
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
      {!isKds && role && role !== 'print' && (
        <>
          {/* < 1024px: menu dưới tối đa 5 ô (+ "Thêm"); ≥ 1024px: sidebar trái. CSS lo việc ẩn/hiện
              theo bề rộng nên cả hai cùng dựng — không phải nghe resize. */}
          <BottomNav role={role} badges={navBadges} />
          <Sidebar role={role} badges={navBadges} />
        </>
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
