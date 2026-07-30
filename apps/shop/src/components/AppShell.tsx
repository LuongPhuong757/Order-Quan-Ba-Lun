import type { CSSProperties, JSX } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header.tsx';
import { Footer } from './Footer.tsx';
import { FloatingCart } from './FloatingCart.tsx';
import { useCart } from '../lib/cart-store.ts';

/**
 * Layout chung của apps/shop: `<Header/>` sticky + `<main>` bọc `<Outlet/>` +
 * `<Footer/>` + `<FloatingCart/>` mobile-only sau cùng.
 *
 * Không đặt logic nghiệp vụ ở đây — chỉ hiển thị lại dữ liệu từ hook giỏ hàng.
 */
export function AppShell(): JSX.Element {
  const { count, subtotal } = useCart();

  return (
    <div style={count > 0 ? shellWithFloatingCart : shell}>
      <Header cartCount={count} cartTotal={subtotal} />
      <main style={main}>
        <Outlet />
      </main>
      {/* Footer nằm NGOÀI <main> nên chừa chỗ cho thanh giỏ nổi phải đặt ở
          `shell`, không đặt ở `main` — nếu đặt ở `main` thì thanh nổi che mất
          số điện thoại quán ở footer. */}
      <Footer />
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

// Giỏ có món → chừa chỗ cho thanh nổi mobile, tránh che nội dung cuối trang.
const shellWithFloatingCart: CSSProperties = {
  ...shell,
  paddingBottom: 'calc(var(--sticky-cta-h) + var(--safe-bottom) + var(--sp-4))',
};

const main: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: '0 var(--gutter)',
};
