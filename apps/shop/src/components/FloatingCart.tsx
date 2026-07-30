import type { CSSProperties, JSX } from 'react';
import { Link } from 'react-router-dom';
import { formatVnd } from '../lib/cart-store.ts';

/**
 * Thanh giỏ hàng nổi — MOBILE-ONLY (UI-SPEC "Giỏ hàng nổi" / D-22 giả định #9).
 *
 * Desktop không cần thanh nổi riêng vì header luôn hiện sẵn — badge số lượng
 * trên icon giỏ hàng ở `Header` đã đủ (xem `CartIcon.tsx`). Ẩn/hiện bằng CSS
 * `@media` qua 1 thẻ `<style>`, cùng cách `Header.tsx` làm ở plan 08-04 —
 * KHÔNG dùng JS đo kích thước màn hình để tránh nhấp nháy giữa 2 layout.
 *
 * Ẩn hoàn toàn khi `count === 0` — không hiện thanh rỗng.
 */
type Props = {
  count: number;
  subtotal: number;
};

export function FloatingCart({ count, subtotal }: Props): JSX.Element | null {
  if (count <= 0) return null;

  return (
    <>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{MEDIA_CSS}</style>
      <Link to="/cart" className="shop-floating-cart" style={bar} aria-label="Xem giỏ hàng">
        <span style={left}>
          {count} món · {formatVnd(subtotal)}
        </span>
        <span style={right}>Xem giỏ hàng →</span>
      </Link>
    </>
  );
}

const MEDIA_CSS = `
.shop-floating-cart { display: flex; }
@media (min-width: 768px) {
  .shop-floating-cart { display: none; }
}
`;

const bar: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 'var(--z-floating-cart)' as unknown as number,
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  minHeight: 'var(--sticky-cta-h)',
  padding: `var(--sp-3) var(--gutter)`,
  paddingBottom: 'calc(var(--sp-3) + var(--safe-bottom))',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  boxShadow: 'var(--shadow-float)',
  textDecoration: 'none',
  fontFamily: 'var(--font-body)',
};

const left: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const right: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  whiteSpace: 'nowrap',
};
