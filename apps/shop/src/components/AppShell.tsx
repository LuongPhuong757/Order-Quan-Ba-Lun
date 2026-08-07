import { Suspense, useEffect, type CSSProperties, type JSX } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header.tsx';
import { Footer } from './Footer.tsx';
import { RouteFallback } from './RouteFallback.tsx';
import { ActiveOrderBar } from './ActiveOrderBar.tsx';
import { useCart } from '../lib/cart-store.ts';
import { trackPageView } from '../lib/analytics.ts';

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
  const { pathname } = useLocation();

  // Thống kê truy cập (2026-08-05). Đặt ở đây vì AppShell là layout DUY NHẤT bọc cả 7 route
  // (main.tsx) — mỗi trang tự gọi thì sẽ có trang bị quên.
  //
  // Nằm trong `useEffect` (chạy SAU khi trang đã vẽ) và `trackPageView` không await gì, nên
  // không có nhánh nào của việc đo này chen được vào trước nội dung khách đang chờ.
  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  return (
    <div style={shell}>
      <Header cartCount={count} cartTotal={subtotal} />
      {/* NGOÀI `<main>` và full-bleed: thanh này là một dải chạy hết bề ngang ngay dưới header,
          không phải một khối nội dung trong cột. Tự ẩn khi khách không có đơn nào đang chạy —
          xem `ActiveOrderBar`. Cố ý KHÔNG sticky: header đã dính rồi, dính thêm một dải nữa là
          ăn mất chiều cao màn hình điện thoại cho một thông tin liếc-qua. */}
      <ActiveOrderBar />
      {/* `Suspense` đặt Ở ĐÂY, quanh `<Outlet/>` — không quanh cả `<div style={shell}>` — để lúc
          chunk của route đang tải thì Header / ActiveOrderBar / Footer VẪN ĐỨNG NGUYÊN. Bọc ra
          ngoài là cả trang trắng mỗi lần đổi tab, đúng cái cảm giác "web lag" cần tránh. */}
      <main style={main}>
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
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

// `<main>` là NƠI DUY NHẤT đặt lề trái/phải cho vùng nội dung. Trang con chỉ khai
// padding DỌC (`var(--sp-6) 0`), không khai --gutter lần nữa — trước 2026-08-05 sáu
// trang đều khai lại nên lề thành 32px/bên trên mobile, cột nội dung teo còn 311px
// trên máy 375px và mọi thứ bị dồn vào nhau.
const main: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: '0 var(--gutter)',
};
