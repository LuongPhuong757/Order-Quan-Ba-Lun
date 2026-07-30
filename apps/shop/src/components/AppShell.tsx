import type { CSSProperties, JSX } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header.tsx';

/**
 * Layout chung của apps/shop: `<Header/>` sticky + `<main>` bọc `<Outlet/>`.
 *
 * Hợp đồng prop của Header chốt ngay ở đây (`cartCount`/`cartTotal`) để plan
 * 08-06 chỉ cần đổi nguồn dữ liệu sang `useCart()`, không phải sửa cấu trúc.
 */
export function AppShell(): JSX.Element {
  // TODO(plan-08-06): thay 0/0 bằng dữ liệu thật đọc từ useCart().
  const cartCount = 0;
  const cartTotal = 0;

  return (
    <div style={shell}>
      <Header cartCount={cartCount} cartTotal={cartTotal} />
      <main style={main}>
        <Outlet />
      </main>
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
