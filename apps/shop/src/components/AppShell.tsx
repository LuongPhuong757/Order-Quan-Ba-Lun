import type { CSSProperties, JSX } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header.tsx';
import { Footer } from './Footer.tsx';
import { useCart } from '../lib/cart-store.ts';

/**
 * Layout chung của apps/shop: `<Header/>` sticky + `<main>` bọc `<Outlet/>` +
 * `<Footer/>`.
 *
 * KHÔNG còn thanh giỏ hàng nổi ở đáy (component `FloatingCart` đã bỏ hẳn theo
 * yêu cầu chủ quán): icon giỏ + badge số món ở `Header` đã là đường vào `/cart`
 * trên cả mobile lẫn desktop, thanh nổi lặp lại thông tin đó và che mất nội
 * dung cuối trang. Vì vậy `shell` cũng không cần chừa `padding-bottom` nữa.
 *
 * Không đặt logic nghiệp vụ ở đây — chỉ hiển thị lại dữ liệu từ hook giỏ hàng.
 */
export function AppShell(): JSX.Element {
  const { count, subtotal } = useCart();

  return (
    <div style={shell}>
      <Header cartCount={count} cartTotal={subtotal} />
      <main style={main}>
        <Outlet />
      </main>
      <Footer />
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
