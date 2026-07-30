import type { CSSProperties, JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Thanh CTA dính đáy dùng chung cho nút "TIẾP TỤC" (bước 1 `/cart`, plan 08-11) và
 * "ĐẶT HÀNG" (bước 2 `/checkout`, plan 08-12).
 *
 * Mobile: `position: fixed` đáy màn hình, full-width, bo góc 0, nền `--brand-600`.
 * Desktop (≥768px): không fixed — nút bình thường nằm trong luồng tài liệu (trong card
 * ở trang dùng nó). Chuyển đổi bằng `@media` trong thẻ `<style>` (cùng khuôn
 * `Header.tsx`/`FloatingCart.tsx`), KHÔNG dùng JS đo kích thước màn hình.
 *
 * `to` → render `<Link>`; `onClick` → render `<button>`. Không nhận cả hai cùng lúc:
 * nếu có `to` thì bỏ qua `onClick`. Khi `disabled`: LUÔN render nút khoá (kể cả khi có
 * `to`) để chắc chắn không điều hướng được — 3 nhánh JSX literal riêng (cùng kỹ thuật
 * `BannerNotice.tsx` dùng cho `role`) để thuộc tính ARIA khoá nút xuất hiện đúng 1 lần
 * literal trong file, dễ kiểm tĩnh bằng grep.
 *
 * `hint`: dòng giải thích hiện ngay TRÊN nút (không phải placeholder che khuất) — nút
 * khoá mà không nói lý do là bẫy người dùng (điểm bắt buộc của plan 08-11).
 *
 * z-index của thanh này phải cao hơn thanh giỏ hàng nổi của `FloatingCart.tsx` để nút
 * "TIẾP TỤC"/"ĐẶT HÀNG" luôn nhận được thao tác chạm, không bị thanh giỏ hàng nổi (cũng
 * dính đáy, cùng `AppShell`) che mất trên `/cart`/`/checkout` khi giỏ có món.
 */
type Props = {
  label: string;
  onClick?: () => void;
  to?: string;
  disabled?: boolean;
  hint?: ReactNode;
};

export function StickyCta({ label, onClick, to, disabled = false, hint }: Props): JSX.Element {
  let content: JSX.Element;

  if (disabled) {
    content = (
      <button
        type="button"
        className="shop-sticky-cta-btn"
        style={{ ...button, ...buttonDisabled }}
        disabled
        aria-disabled="true"
      >
        {label}
      </button>
    );
  } else if (to) {
    content = (
      <Link to={to} className="shop-sticky-cta-btn" style={button}>
        {label}
      </Link>
    );
  } else {
    content = (
      <button type="button" className="shop-sticky-cta-btn" style={button} onClick={onClick}>
        {label}
      </button>
    );
  }

  return (
    <div className="shop-sticky-cta-bar" style={bar}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{MEDIA_CSS}</style>
      {hint && <p style={hintStyle}>{hint}</p>}
      {content}
    </div>
  );
}

// Mobile: dính đáy toàn màn hình. Desktop: trở về luồng tài liệu bình thường
// (trang gọi component này đặt nó bên trong card, không cần full-bleed nữa).
const MEDIA_CSS = `
.shop-sticky-cta-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
}
.shop-sticky-cta-btn {
  border-radius: 0;
}
@media (min-width: 768px) {
  .shop-sticky-cta-bar {
    position: static;
    box-shadow: none !important;
  }
  .shop-sticky-cta-btn {
    border-radius: var(--r-button);
  }
}
`;

const bar: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  zIndex: 'var(--z-sticky-cta)' as unknown as number,
  boxShadow: 'var(--shadow-sheet)',
};

const hintStyle: CSSProperties = {
  margin: 0,
  padding: `var(--sp-2) var(--gutter)`,
  background: 'var(--bg-surface)',
  borderTop: '1px solid var(--border-subtle)',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-caption)',
  textAlign: 'center',
};

const button: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: 'var(--sticky-cta-h)',
  paddingBottom: 'var(--safe-bottom)',
  border: 'none',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  textTransform: 'uppercase',
  textDecoration: 'none',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  cursor: 'pointer',
  boxSizing: 'border-box',
};

const buttonDisabled: CSSProperties = {
  opacity: 'var(--opacity-disabled)',
  cursor: 'not-allowed',
};
