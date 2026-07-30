import { useState, type CSSProperties, type JSX } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Wordmark } from './Wordmark.tsx';
import { CartIcon } from './CartIcon.tsx';

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
  { to: '/history', label: 'Đơn của tôi' },
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

        {mobileNavOpen && (
          <div style={navOverlay} role="dialog" aria-modal="true" aria-label="Điều hướng">
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
const MEDIA_CSS = `
.shop-hd-desktop { display: none; }
.shop-hd-mobile { display: block; }
@media (min-width: 768px) {
  .shop-hd-desktop { display: flex; }
  .shop-hd-mobile { display: none; }
}
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

const navOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--z-overlay)' as unknown as number,
  background: 'var(--bg-surface)',
  padding: 'var(--sp-6) var(--gutter)',
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
