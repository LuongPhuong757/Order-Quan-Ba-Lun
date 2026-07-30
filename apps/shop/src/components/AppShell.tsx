import type { CSSProperties, JSX } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header.tsx';
import { FloatingCart } from './FloatingCart.tsx';
import { useCart } from '../lib/cart-store.ts';

/**
 * Layout chung của apps/shop: `<Header/>` sticky + `<main>` bọc `<Outlet/>` +
 * `<FloatingCart/>` mobile-only sau `<main>`.
 *
 * Không đặt logic nghiệp vụ ở đây — chỉ hiển thị lại dữ liệu từ hook giỏ hàng.
 */
export function AppShell(): JSX.Element {
  const { count, subtotal } = useCart();

  return (
    <div style={shell}>
      <Header cartCount={count} cartTotal={subtotal} />
      <main style={count > 0 ? mainWithFloatingCart : main}>
        <Outlet />
      </main>
      <FloatingCart count={count} subtotal={subtotal} />
    </div>
  );
}

const shell: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-page)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
};

const main: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: '0 var(--gutter)',
};

// Giỏ có món → chừa chỗ cho thanh nổi mobile, tránh che nội dung cuối trang.
const mainWithFloatingCart: CSSProperties = {
  ...main,
  paddingBottom: 'calc(var(--sticky-cta-h) + var(--safe-bottom) + var(--sp-4))',
};
