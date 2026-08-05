import { useState, type CSSProperties, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Wordmark } from './Wordmark.tsx';
import { CartIcon, CART_ICON_CSS } from './CartIcon.tsx';

/**
 * Header sticky của apps/shop — 2 biến thể desktop/mobile (D-22 giả định #8).
 *
 * Kiến trúc bắt buộc: 2 khối DOM riêng (`.shop-hd-desktop` / `.shop-hd-mobile`)
 * ẩn/hiện bằng CSS `@media` (breakpoint ~768px) qua 1 thẻ `<style>` — KHÔNG
 * dùng hook đo kích thước màn hình bằng JS hay lắng nghe sự kiện đổi cỡ cửa
 * sổ, để tránh nhấp nháy giữa 2 layout lúc mount.
 *
 * Ô tìm kiếm ghi trạng thái vào URL qua `useSearchParams` (key `q`), theo mẫu
 * `apps/web/src/pages/AdminAuditPage.tsx`. Lý do: `MenuPage` (plan 08-09) đọc
 * lại `q` để lọc client-side (D-03) mà không cần context/prop drilling xuyên
 * `<Outlet/>`. Gõ ở trang khác `/` thì điều hướng về `/?q=...`.
 */
type Props = {
  cartCount: number;
  /** Chưa dùng ở plan 08-04 — thanh giỏ hàng nổi (component riêng, plan sau) đọc giá trị này. */
  cartTotal: number;
};

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/', label: 'Trang chủ' },
  { to: '/top', label: 'Món bán chạy' },
  { to: '/history', label: 'Đơn của tôi' },
  { to: '/guide', label: 'Hướng dẫn' },
];

export function Header({ cartCount }: Props): JSX.Element {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [query, setQuery] = useState(() => params.get('q') ?? '');

  const applyQuery = (value: string): void => {
    setQuery(value);
    if (location.pathname === '/') {
      const next = new URLSearchParams(params);
      if (value) next.set('q', value);
      else next.delete('q');
      setParams(next, { replace: true });
    } else {
      const next = new URLSearchParams();
      if (value) next.set('q', value);
      navigate(next.toString() ? `/?${next.toString()}` : '/');
    }
  };

  return (
    <header style={headerStyle}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{MEDIA_CSS}</style>
      {/* Nhịp nảy của badge số món — nhúng 1 lần ở đây cho cả 2 CartIcon bên dưới. */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{CART_ICON_CSS}</style>

      {/* ── Desktop ──────────────────────────────────────────────────── */}
      <div className="shop-hd-desktop" style={desktopBar}>
        <Link to="/" style={logoLink} aria-label="Về trang chủ">
          <Wordmark variant="bare" />
        </Link>

        <nav style={desktopNav} aria-label="Điều hướng chính">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => (isActive ? { ...navLink, ...navLinkActive } : navLink)}
            >
              {item.label.toUpperCase()}
            </NavLink>
          ))}
        </nav>

        <div style={desktopRight}>
          <input
            type="search"
            value={query}
            onChange={(e) => applyQuery(e.target.value)}
            placeholder="Tìm món..."
            aria-label="Tìm món"
            style={desktopSearchInput}
          />
          <Link to="/cart" aria-label="Xem giỏ hàng" style={cartLink}>
            <CartIcon count={cartCount} size={24} />
          </Link>
        </div>
      </div>

      {/* ── Mobile ───────────────────────────────────────────────────── */}
      <div className="shop-hd-mobile" style={mobileBar}>
        <div style={mobileRow}>
          <Link to="/" style={logoLink} aria-label="Về trang chủ">
            <Wordmark variant="bare" size="var(--fs-md)" />
          </Link>

          <div style={mobileRight}>
            <button
              type="button"
              aria-label="Tìm món"
              style={iconButton}
              onClick={() => setMobileSearchOpen(true)}
            >
              <SearchGlyph />
            </button>
            <Link to="/cart" aria-label="Xem giỏ hàng" style={{ ...iconButton, textDecoration: 'none' }}>
              <CartIcon count={cartCount} />
            </Link>
            <button
              type="button"
              aria-label="Mở menu điều hướng"
              aria-expanded={mobileNavOpen}
              style={iconButton}
              onClick={() => setMobileNavOpen(true)}
            >
              <HamburgerGlyph />
            </button>
          </div>
        </div>

        {mobileSearchOpen && (
          <div style={searchOverlay} role="search">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => applyQuery(e.target.value)}
              placeholder="Tìm món..."
              aria-label="Tìm món"
              style={mobileSearchInput}
            />
            <button type="button" style={cancelButton} onClick={() => setMobileSearchOpen(false)}>
              Huỷ
            </button>
          </div>
        )}

        {mobileNavOpen &&
          /* Drawer trượt từ phải che ~80% bề ngang (chỉ đạo 2026-08-04) — 20% còn lại
             là backdrop mờ, bấm vào là đóng. Animation chỉ transform/opacity, thời lượng
             từ --dur-*, nên tự tắt khi người dùng bật "giảm chuyển động".

             PORTAL ra document.body: header sticky có z-index riêng nên tạo stacking
             context — để drawer bên trong thì --z-overlay bị "nhốt" ở tầng header và
             THUA nút CTA dính đáy (--z-sticky-cta) trên /cart, /checkout. Ra body thì
             overlay 300 > cta 210, drawer đè lên nút "TIẾP TỤC"/"ĐẶT HÀNG" đúng ý đồ
             phân tầng trong tokens.css. */
          createPortal(
          <div
            className="shop-nav-backdrop"
            style={navBackdrop}
            onClick={() => setMobileNavOpen(false)}
          >
            <div
              className="shop-nav-drawer"
              style={navDrawer}
              role="dialog"
              aria-modal="true"
              aria-label="Điều hướng"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Đóng menu điều hướng"
                style={closeNavButton}
                onClick={() => setMobileNavOpen(false)}
              >
                <CloseGlyph />
              </button>
              <nav style={mobileNavList} aria-label="Điều hướng chính">
                {NAV_ITEMS.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMobileNavOpen(false)}
                    style={({ isActive }) =>
                      isActive ? { ...mobileNavLink, ...navLinkActive } : mobileNavLink
                    }
                  >
                    {item.label.toUpperCase()}
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>,
          document.body,
        )}
      </div>
    </header>
  );
}

function SearchGlyph(): JSX.Element {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function HamburgerGlyph(): JSX.Element {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseGlyph(): JSX.Element {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}

// 2 khối DOM ẩn/hiện bằng CSS-only breakpoint — không JS resize listener.
// + animation mở drawer điều hướng mobile: backdrop mờ dần vào, drawer trượt từ phải
// (chỉ transform/opacity — rule layout-transition). Chỉ có animation VÀO: đóng là
// unmount thẳng, không giữ state chờ animation ra để khỏi phức tạp hoá component.
const MEDIA_CSS = `
.shop-hd-desktop { display: none; }
.shop-hd-mobile { display: block; }
@media (min-width: 768px) {
  .shop-hd-desktop { display: flex; }
  .shop-hd-mobile { display: none; }
  /* Drawer đã portal ra body (không còn nằm trong .shop-hd-mobile) nên phải tự ẩn
     ở desktop — giữ hành vi cũ khi đang mở drawer mà phóng to cửa sổ. */
  .shop-nav-backdrop { display: none; }
}
@keyframes shop-nav-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes shop-nav-drawer-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.shop-nav-backdrop { animation: shop-nav-backdrop-in var(--dur-base) var(--ease-out); }
.shop-nav-drawer { animation: shop-nav-drawer-in var(--dur-slow) var(--ease-out); }
`;

const headerStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 'var(--z-sticky-header)' as unknown as number,
  background: 'var(--bg-surface)',
  borderBottom: '1px solid var(--border-subtle)',
  paddingTop: 'var(--safe-top)',
  boxShadow: 'var(--shadow-sticky)',
};

const logoLink: CSSProperties = {
  display: 'inline-flex',
  textDecoration: 'none',
};

/* ── Desktop ─────────────────────────────────────────────────────────── */

const desktopBar: CSSProperties = {
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-6)',
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: `var(--sp-3) var(--gutter-lg)`,
};

const desktopNav: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-6)',
};

const navLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 'var(--tap-min)',
  textDecoration: 'none',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  color: 'var(--text-strong)',
  borderBottom: '2px solid transparent',
};

const navLinkActive: CSSProperties = {
  color: 'var(--brand-600)',
  borderBottom: '2px solid var(--brand-600)',
};

const desktopRight: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-4)',
};

const desktopSearchInput: CSSProperties = {
  width: '240px',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-input)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
};

const cartLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  color: 'var(--text-strong)',
  textDecoration: 'none',
};

/* ── Mobile ──────────────────────────────────────────────────────────── */

const mobileBar: CSSProperties = {
  position: 'relative',
  padding: `var(--sp-3) var(--gutter)`,
};

const mobileRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const mobileRight: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
};

const iconButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-strong)',
  cursor: 'pointer',
};

const searchOverlay: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  zIndex: 'var(--z-overlay)' as unknown as number,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--gutter)',
  background: 'var(--bg-surface)',
  borderBottom: '1px solid var(--border-subtle)',
  boxShadow: 'var(--shadow-sticky)',
};

const mobileSearchInput: CSSProperties = {
  flex: 1,
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-input)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-sunken)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
};

const cancelButton: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: 'none',
  background: 'transparent',
  color: 'var(--brand-600)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

// Backdrop phủ toàn màn nhưng chỉ để hứng chạm-đóng + làm mờ nền — drawer bên trong
// mới là khối nội dung, rộng 80% (kẹp 320px để máy tính bảng không có drawer khổng lồ).
const navBackdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--z-overlay)' as unknown as number,
  background: 'var(--bg-overlay)',
};

const navDrawer: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: '80%',
  maxWidth: '320px',
  background: 'var(--bg-surface)',
  padding: 'calc(var(--sp-6) + var(--safe-top)) var(--gutter) var(--sp-6)',
  boxShadow: 'var(--shadow-float)',
  overflowY: 'auto',
};

const closeNavButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-strong)',
  cursor: 'pointer',
  marginBottom: 'var(--sp-4)',
};

const mobileNavList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const mobileNavLink: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 'var(--tap-min)',
  textDecoration: 'none',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  color: 'var(--text-strong)',
};
