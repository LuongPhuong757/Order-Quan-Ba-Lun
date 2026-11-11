// Điều hướng chính của trang quản lý (làm lại 2026-11-10, chủ quán chốt từng điểm):
//
// - < 1024px (điện thoại + iPad dọc): menu dưới TỐI ĐA 5 ô, không cuộn ngang nữa. Bản cũ 9 mục
//   rộng 594px trên màn 373px — Bàn, Online, NCC, N/viên nằm ngoài mép, không dấu hiệu gì để biết
//   còn mục mà vuốt. Vai nào > 5 mục thì ô cuối là "Thêm" mở một tấm danh sách; "Thêm" có chấm đỏ
//   khi bên trong có việc cần xử lý.
// - ≥ 1024px: SIDEBAR trái 220px (thu gọn còn 64px chỉ icon), mỗi mục 44px, đủ tên + badge. Bỏ
//   menu dưới: ở 1920px mỗi ô rộng 211px chữ 13px, chuột phải kéo xuống tận đáy để đổi trang.
// - Header: TÊN TRANG ở vị trí chính (bản cũ ẩn mọi h1, không ai biết mình đang ở đâu). Màn gốc
//   (ô trên menu dưới) có avatar bên trái; màn con có ← (chỉ < 1024px — máy tính đã có sidebar).
//   Đăng xuất chuyển vào menu avatar và phải xác nhận (nút đỏ cũ sát chuông, dễ chạm nhầm giữa ca).
// - Tên đầy đủ, không viết tắt bằng "/" (bỏ H/đơn, L/sử, N/viên, T/khoản).
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './ui/Icon.tsx';
import { Sheet } from './ui/Sheet.tsx';
import { initialOf } from '../lib/initials.ts';

export type NavRole = 'admin' | 'order' | 'kitchen' | 'report';

/** Số đếm của các mục. `null` = chưa biết / vai này không đếm. */
export type NavBadges = {
  openTables: number | null;
  kitchenPending: number | null;
  onlineWaiting: number | null;
  pendingDeliveries: number | null;
};

type BadgeKey = keyof NavBadges;

type NavItem = {
  to: string;
  /** Tên đầy đủ — sidebar và tấm "Thêm". */
  label: string;
  /** Tên trên menu dưới điện thoại (một từ nếu cần, không dấu "/"). */
  short: string;
  icon: IconName;
  badge?: BadgeKey;
};

const ITEMS = {
  orders: { to: '/orders', label: 'Gọi món', short: 'Gọi món', icon: 'order', badge: 'openTables' },
  kitchen: { to: '/kitchen', label: 'Bếp', short: 'Bếp', icon: 'bep', badge: 'kitchenPending' },
  receipt: { to: '/custom-receipt', label: 'Phiếu', short: 'Phiếu', icon: 'hoa-don' },
  online: { to: '/admin/online-orders', label: 'Đơn online', short: 'Online', icon: 'online', badge: 'onlineWaiting' },
  history: { to: '/history', label: 'Lịch sử', short: 'Lịch sử', icon: 'lich-su' },
  menu: { to: '/menu', label: 'Thực đơn', short: 'Thực đơn', icon: 'menu' },
  tables: { to: '/tables', label: 'Bàn', short: 'Bàn', icon: 'ban' },
  suppliers: { to: '/suppliers', label: 'Nhà cung cấp', short: 'NCC', icon: 'ncc', badge: 'pendingDeliveries' },
  users: { to: '/admin/users', label: 'Nhân viên', short: 'Nhân viên', icon: 'nhan-vien' },
  reports: { to: '/dashboard', label: 'Báo cáo', short: 'Báo cáo', icon: 'bao-cao' },
  analytics: { to: '/admin/analytics', label: 'Truy cập', short: 'Truy cập', icon: 'thong-ke' },
  // Cài đặt (2026-11-11): màn riêng, chỉ admin. Mục CUỐI ở cả sidebar lẫn tấm "Thêm" — sửa vài lần
  // một tháng, không được chen lên trước những màn dùng trong ca.
  settings: { to: '/settings', label: 'Cài đặt', short: 'Cài đặt', icon: 'cai-dat' },
} satisfies Record<string, NavItem>;

/** `main` = các ô trên menu dưới (≤ 4 nếu có `more`); `more` = trong tấm "Thêm"; `sidebar` = đủ
 *  mọi mục theo thứ tự làm việc cho máy rộng. Chủ quán chốt 2026-11-10. */
const NAV: Record<NavRole, { main: NavItem[]; more: NavItem[]; sidebar: NavItem[] }> = {
  admin: {
    // Hai mục có việc gấp (Bếp, Online — kèm số đếm) ra ngoài; Nhân viên/Thực đơn ít dùng trong ca
    // vào "Thêm" (chủ quán đổi 2026-11-10, lần 2).
    main: [ITEMS.orders, ITEMS.kitchen, ITEMS.online, ITEMS.history],
    more: [
      ITEMS.reports, ITEMS.receipt, ITEMS.menu, ITEMS.tables, ITEMS.suppliers, ITEMS.users, ITEMS.settings,
    ],
    sidebar: [
      ITEMS.orders, ITEMS.kitchen, ITEMS.receipt, ITEMS.online, ITEMS.history,
      ITEMS.menu, ITEMS.tables, ITEMS.suppliers, ITEMS.users, ITEMS.reports, ITEMS.settings,
    ],
  },
  order: {
    main: [ITEMS.orders, ITEMS.online, ITEMS.receipt, ITEMS.history],
    more: [],
    sidebar: [ITEMS.orders, ITEMS.online, ITEMS.receipt, ITEMS.history],
  },
  kitchen: {
    main: [ITEMS.kitchen, ITEMS.orders, ITEMS.online, ITEMS.receipt],
    more: [ITEMS.menu, ITEMS.history],
    sidebar: [ITEMS.kitchen, ITEMS.orders, ITEMS.online, ITEMS.receipt, ITEMS.menu, ITEMS.history],
  },
  report: {
    main: [ITEMS.reports, ITEMS.history, ITEMS.suppliers, ITEMS.analytics],
    more: [],
    sidebar: [ITEMS.reports, ITEMS.history, ITEMS.suppliers, ITEMS.analytics],
  },
};

/** Tên trang trên header. Màn Order là "Sơ đồ bàn" dù mục menu ghi "Gọi món" (chủ quán chốt). */
const TITLES: Record<string, string> = {
  '/orders': 'Sơ đồ bàn',
  '/custom-receipt': 'Hoá đơn tự do',
  '/custom-receipt/history': 'Phiếu đã in',
  '/admin/online-orders': 'Đơn online',
  '/kitchen': 'Bếp',
  '/menu': 'Thực đơn',
  '/history': 'Lịch sử',
  '/tables': 'Bàn',
  '/suppliers': 'Nhà cung cấp',
  '/admin/users': 'Nhân viên',
  '/dashboard': 'Báo cáo',
  '/admin/analytics': 'Truy cập',
  '/admin/bank-ledger': 'Sổ ngân hàng',
  '/admin/audit': 'Nhật ký thao tác',
  '/account': 'Tài khoản',
  '/mau-giao-dien': 'Mẫu giao diện',
  '/settings': 'Cài đặt',
};

export function pageTitle(pathname: string): string {
  return TITLES[pathname] ?? 'Quán Bà Lùn';
}

/** Màn gốc = một ô trên menu dưới của vai này → header hiện avatar; còn lại là màn con → ←. */
export function isRootPage(role: NavRole, pathname: string): boolean {
  return NAV[role].main.some((it) => it.to === pathname);
}

function badgeOf(it: NavItem, badges: NavBadges): number {
  return it.badge ? badges[it.badge] ?? 0 : 0;
}

/** Đỏ = việc phải làm; xanh = chỉ để biết (số bàn đang mở). Chỉ đỏ mới làm "Thêm" hiện chấm. */
const toneOf = (it: NavItem): 'alert' | 'info' => (it.badge === 'openTables' ? 'info' : 'alert');

function Badge({ count, tone }: { count: number; tone: 'alert' | 'info' }) {
  if (count <= 0) return null;
  return (
    <span className={tone === 'alert' ? 'an-badge' : 'an-badge an-badge--info'} aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function ItemInner({ it, badges, label }: { it: NavItem; badges: NavBadges; label: string }) {
  const n = badgeOf(it, badges);
  return (
    <>
      <span className="an-icon">
        <Icon name={it.icon} size={22} />
        <Badge count={n} tone={toneOf(it)} />
      </span>
      <span className="an-label">{label}</span>
      {n > 0 && <span className="visually-hidden">{` (${n})`}</span>}
    </>
  );
}

/** Menu dưới, chỉ < 1024px (CSS ẩn ở máy rộng). Giữ class `nav-bottom`: vài màn đo chiều cao
 *  thanh này qua selector đó để đặt thanh dính của mình ngay trên nó. */
export function BottomNav({ role, badges }: { role: NavRole; badges: NavBadges }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  const { main, more } = NAV[role];
  // Khớp cả màn CON của một mục trong "Thêm" (vd /custom-receipt/history thuộc Phiếu).
  const moreActive = more.some((it) => loc.pathname === it.to || loc.pathname.startsWith(`${it.to}/`));
  const moreAlert = more.some((it) => toneOf(it) === 'alert' && badgeOf(it, badges) > 0);
  useEffect(() => setMoreOpen(false), [loc.pathname]);

  return (
    <>
      <nav className="nav-bottom an-tabbar" aria-label="Điều hướng chính">
        {main.map((it) => (
          <NavLink key={it.to} to={it.to} className="an-tab">
            <ItemInner it={it} badges={badges} label={it.short} />
          </NavLink>
        ))}
        {more.length > 0 && (
          <button
            type="button"
            className={moreActive ? 'an-tab active' : 'an-tab'}
            aria-current={moreActive ? 'page' : undefined}
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
          >
            <span className="an-icon">
              <Icon name="them-thao-tac" size={22} />
              {moreAlert && <span className="an-dot" aria-hidden="true" />}
            </span>
            <span className="an-label">Thêm</span>
            {moreAlert && <span className="visually-hidden"> (có việc cần xử lý)</span>}
          </button>
        )}
      </nav>
      {moreOpen && (
        <Sheet title="Thêm" onClose={() => setMoreOpen(false)}>
          <div className="an-more">
            {more.map((it) => (
              <NavLink key={it.to} to={it.to} className="an-more__item">
                <ItemInner it={it} badges={badges} label={it.label} />
                <Icon name="mui-ten-phai" size={20} />
              </NavLink>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

// Đổi khoá (v2, 2026-11-10): máy nào đã lỡ lưu "thu gọn" từ bản đầu thì nay về MẶC ĐỊNH MỞ RỘNG —
// chủ quán thấy sidebar chỉ có icon, không đoán được mục nào.
const SB_KEY = 'an-sidebar-thu-v2';

/** Sidebar trái, chỉ ≥ 1024px. Trạng thái thu gọn nhớ theo MÁY (localStorage) — người dùng máy
 *  tính quầy chọn một lần. Bề rộng đẩy nội dung qua biến `--sb-w` (class trên <html>). */
export function Sidebar({ role, badges }: { role: NavRole; badges: NavBadges }) {
  const [thu, setThu] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SB_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('co-sidebar');
    root.classList.toggle('sidebar-thu', thu);
    try {
      localStorage.setItem(SB_KEY, thu ? '1' : '0');
    } catch {
      /* chế độ riêng tư — không nhớ được thì thôi */
    }
    return () => root.classList.remove('co-sidebar', 'sidebar-thu');
  }, [thu]);

  return (
    <aside className="an-sidebar" aria-label="Điều hướng chính">
      <div className="an-sidebar__brand">
        <img src="/favicon.svg" width={32} height={32} alt="" />
        <span className="an-sidebar__name">Quán Bà Lùn</span>
      </div>
      <nav className="an-sidebar__list">
        {NAV[role].sidebar.map((it) => (
          // Thu gọn chỉ còn icon → `title` cho chuột di lên thấy tên mục (máy tính có chuột; điện
          // thoại không dùng sidebar nên quy tắc "không tooltip" của app không bị phá).
          <NavLink
            key={it.to}
            to={it.to}
            className="an-side-item"
            aria-label={thu ? it.label : undefined}
            title={thu ? it.label : undefined}
          >
            <ItemInner it={it} badges={badges} label={it.label} />
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        className="an-side-item an-sidebar__toggle"
        onClick={() => setThu((v) => !v)}
        aria-label={thu ? 'Mở rộng menu' : 'Thu gọn menu'}
        title={thu ? 'Mở rộng menu' : undefined}
      >
        <span className="an-icon">
          <span className="an-chevron" aria-hidden="true">{thu ? '›' : '‹'}</span>
        </span>
        <span className="an-label">Thu gọn</span>
      </button>
    </aside>
  );
}

const initials = initialOf;

/** Avatar + menu tài khoản: tên, vai trò, Tài khoản, Đăng xuất (có xác nhận). */
export function AvatarMenu({
  fullName,
  roleLabel,
  onLogout,
}: {
  fullName: string;
  roleLabel: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const navigate = useNavigate();
  const closeAll = () => {
    setConfirm(false);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className="an-avatar"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Tài khoản: ${fullName}`}
      >
        {initials(fullName)}
      </button>
      {open && !confirm && (
        <Sheet title="Tài khoản" giuaKhiRong onClose={closeAll}>
          <div className="an-acc">
            <div className="an-acc__who">
              <span className="an-avatar an-avatar--lon" aria-hidden="true">
                {initials(fullName)}
              </span>
              <div>
                <div className="an-acc__name">{fullName}</div>
                <div className="an-acc__role">{roleLabel}</div>
              </div>
            </div>
            <button
              type="button"
              className="an-acc__row"
              onClick={() => {
                closeAll();
                navigate('/account');
              }}
            >
              <Icon name="tai-khoan" size={22} />
              <span>Tài khoản · đổi mật khẩu</span>
              <Icon name="mui-ten-phai" size={20} />
            </button>
            <button type="button" className="an-acc__row" onClick={() => setConfirm(true)}>
              <Icon name="dang-xuat" size={22} />
              <span>Đăng xuất</span>
            </button>
          </div>
        </Sheet>
      )}
      {confirm && (
        <Sheet
          title="Đăng xuất?"
          giuaKhiRong
          onClose={closeAll}
          footer={
            <div className="an-confirm-foot">
              <button type="button" className="an-btn an-btn--vien" onClick={closeAll}>
                Ở lại
              </button>
              <button type="button" className="an-btn an-btn--chinh" onClick={onLogout}>
                Đăng xuất
              </button>
            </div>
          }
        >
          <p className="an-confirm-text">{fullName} sẽ thoát khỏi máy này. Muốn vào lại phải đăng nhập.</p>
        </Sheet>
      )}
    </>
  );
}

/** Header mới: [avatar | ←] [TÊN TRANG] [chuông (+ avatar ở màn con trên máy rộng)]. */
export function AppHeader({
  role,
  avatar,
  right,
  headerRef,
}: {
  role: NavRole;
  avatar: ReactNode;
  right: ReactNode;
  headerRef: React.Ref<HTMLElement>;
}) {
  const loc = useLocation();
  const navigate = useNavigate();
  const root = isRootPage(role, loc.pathname);
  const goBack = () => {
    // Mở thẳng bằng link (không có lịch sử trong app) thì ← về màn gốc đầu tiên của vai.
    if (window.history.length > 1) navigate(-1);
    else navigate(NAV[role].main[0].to);
  };
  return (
    <header className="header an-header" ref={headerRef}>
      <div className="an-header__left">
        {root ? (
          avatar
        ) : (
          <>
            <button type="button" className="an-iconbtn an-chi-hep" onClick={goBack} aria-label="Quay lại">
              <Icon name="mui-ten-trai" size={24} />
            </button>
            {/* Máy rộng không có ← (đã có sidebar) — giữ avatar ở chỗ đó. */}
            <span className="an-chi-rong">{avatar}</span>
          </>
        )}
      </div>
      <h1 className="an-title">{pageTitle(loc.pathname)}</h1>
      <div className="an-header__right">{right}</div>
    </header>
  );
}
