import { Suspense, type CSSProperties, type JSX } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useDineInCart } from '../lib/dine-in-cart-store.ts';
import { CartIcon, CART_ICON_CSS } from './CartIcon.tsx';
import { Wordmark } from './Wordmark.tsx';
import { RouteFallback } from './RouteFallback.tsx';

/**
 * Khung cho luồng GỌI MÓN TẠI BÀN (M4) — CỐ Ý không dùng `AppShell` của web đặt online.
 *
 * `AppShell` mang theo đúng những thứ khách ngồi bàn không cần và không nên thấy:
 *
 *  - Điều hướng sang "Đơn của tôi" / "Bảng xếp hạng" / "Hướng dẫn đặt hàng" — toàn bộ nói về
 *    đặt hàng từ xa. Khách đang ngồi trong quán bấm vào là rơi ra khỏi luồng đang làm.
 *  - `ClosedNotice` — popup "quán đang tạm ngưng nhận đơn online" phủ toàn màn hình. Với người
 *    đang ngồi ăn thì câu đó vừa sai vừa làm họ tưởng không gọi được món (xem docblock
 *    `public/create-cart.ts`: luồng này CỐ Ý không gate theo công tắc online).
 *  - Chân trang với phí giao hàng, bán kính giao, hướng dẫn đặt ship.
 *  - Icon giỏ trỏ `/cart` — giỏ ONLINE, khác giỏ tại bàn (xem `dine-in-cart-store.ts`).
 *
 * Nên khung này chỉ có đúng hai thứ: đường về menu, và icon giỏ trỏ giỏ TẠI BÀN. Ít lựa chọn
 * hơn là đúng ý đồ — khách chỉ có một việc cần làm ở đây.
 */
export function DineInShell(): JSX.Element {
  const { count } = useDineInCart();
  const { pathname } = useLocation();

  // Trên chính trang giỏ thì icon giỏ là đường dẫn về chỗ đang đứng — ẩn đi thay vì để một
  // nút không làm gì.
  const onCartPage = pathname.startsWith('/tai-ban/gio');

  return (
    <div style={shell}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{CART_ICON_CSS}</style>

      <header style={header}>
        <Link to="/tai-ban" style={brandLink} aria-label="Về danh sách món">
          <Wordmark size="var(--fs-md)" />
        </Link>
        <span style={badge}>Gọi món tại bàn</span>
        {!onCartPage && (
          <Link to="/tai-ban/gio" aria-label="Xem giỏ món đã chọn" style={cartLink}>
            <CartIcon count={count} size={24} />
          </Link>
        )}
      </header>

      <main style={main}>
        {/* Suspense nằm ở ĐÂY, quanh `Outlet` — giống `AppShell`. Nhờ vậy khi khách đổi giữa
            menu → giỏ → mã, phần khung (header + icon giỏ) đứng yên và chỉ vùng nội dung hiện
            khối chờ; đặt Suspense ở ngoài khung thì cả header cũng nháy mất mỗi lần đổi trang. */}
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
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

const header: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-3) var(--sp-4)',
  background: 'var(--bg-surface)',
  borderBottom: '1px solid var(--border-subtle)',
};

const brandLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
  color: 'inherit',
};

/** Nhãn cho khách biết mình đang ở luồng tại bàn, không phải web đặt ship — hai luồng trông
 * gần giống nhau nên phải nói ra, không thì khách chờ shipper. */
const badge: CSSProperties = {
  marginLeft: 'auto',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--bg-sunken)',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
};

const cartLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Vùng bấm tối thiểu: icon giỏ cao 24px, bọc nguyên si thì cả vùng chạm chỉ 24px — hụt so
  // với ngón tay. Đo được bằng script kiểm giao diện (2026-09-11), không nhìn ra bằng mắt.
  minWidth: 'var(--tap-min)',
  minHeight: 'var(--tap-min)',
  textDecoration: 'none',
  color: 'inherit',
};

const main: CSSProperties = {
  paddingBottom: 'var(--sp-8)',
};
