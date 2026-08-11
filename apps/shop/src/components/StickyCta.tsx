import type { CSSProperties, JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Thanh CTA dính đáy dùng chung cho nút "TIẾP TỤC" (bước 1 `/cart`, plan 08-11) và
 * "ĐẶT HÀNG" (bước 2 `/checkout`, plan 08-12).
 *
 * Mobile: `position: sticky; bottom: 0` — dính đáy màn hình khi đang cuộn giữa trang,
 * nhưng vì vẫn nằm TRONG luồng tài liệu (cuối nội dung trang, trước `<Footer/>`), cuộn
 * hết trang thì thanh dừng lại phía TRÊN footer thay vì đè lên footer (bug 2026-08-04,
 * bản `fixed` cũ che mất footer). Full-bleed bằng margin âm bù lớp gutter của `<main>`
 * trong `AppShell`, bo góc 0, nền `--brand-600`.
 * Desktop (≥768px): không dính — nút bình thường nằm trong luồng tài liệu (trong card
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

// Mobile: sticky đáy màn hình, full-bleed bằng margin âm 1 lớp gutter mỗi bên.
// MỘT lớp chứ không phải hai (2026-08-05): CartPage/CheckoutPage đã bỏ --gutter ngang
// khỏi div trang, giờ chỉ còn đúng lớp padding của `<main>` trong AppShell để bù. Để
// nguyên hệ số 2 cũ thì thanh tràn ra ngoài viewport và sinh cuộn ngang.
// Desktop: trở về luồng tài liệu bình thường (trang gọi component này đặt nó bên
// trong card, không cần full-bleed nữa).
const MEDIA_CSS = `
.shop-sticky-cta-bar {
  position: sticky;
  bottom: 0;
  margin-left: calc(-1 * var(--gutter));
  margin-right: calc(-1 * var(--gutter));
  width: calc(100% + 2 * var(--gutter));
}
.shop-sticky-cta-btn {
  border-radius: 0;
}
@media (min-width: 768px) {
  .shop-sticky-cta-bar {
    position: static;
    margin-left: 0;
    margin-right: 0;
    width: 100%;
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
  // Thanh nay nằm trong luồng (sticky/static) nên tự lo khoảng cách với khối phía trên,
  // các trang không cần chèn margin quanh nó nữa.
  marginTop: 'var(--sp-6)',
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

/**
 * Màu ĐẶC, KHÔNG `opacity` (sửa 2026-08-11).
 *
 * Thanh này `position: sticky` — nó nằm ĐÈ lên nội dung đang cuộn phía dưới. `opacity: .5` làm mờ
 * cả nút lẫn chữ, nên khách nhìn xuyên qua thấy ô "số nhà, thôn/xóm" trôi ngay dưới dòng chữ
 * "ĐẶT HÀNG": trông như giao diện vỡ chứ không đọc ra là nút đang khoá. Đây là điểm khác biệt so
 * với mọi chỗ khác trong app còn dùng `--opacity-disabled` — những chỗ đó nằm trong luồng trang,
 * không có gì chạy phía sau, nên làm mờ vẫn đúng.
 */
const buttonDisabled: CSSProperties = {
  background: 'var(--disabled-600)',
  color: 'var(--text-on-disabled)',
  cursor: 'not-allowed',
};
